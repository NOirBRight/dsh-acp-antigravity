/** Cordis host plugin: External Agents Settings through settings.section RPC. */
import { ExternalAgentProviderRegistry, providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { ExternalAgentSettingsEditorRegistry } from '@deepseek-ai/dsh-acp-provider/settings'
import { join } from 'node:path'
import { allowDshRuntime } from './compatibility.js'
import type { ActivityBindingHostContext } from './activity-binding.js'
import { ANTIGRAVITY_FULL_ACCESS_AUTHORIZED, nativeSessionBinding } from './activity-contract.js'
import { AntigravityActivityStore, type AntigravityActivityEvent } from './activity-store.js'
import { AntigravityActivityCoalescer } from './activity-coalescer.js'
import type { AcpAntigravitySettingsConfig, AcpSettingsRow, AcpSettingsSnapshot } from './client-contract.js'
import { deriveAntigravityHarnessPath, validateAntigravityInstallation } from './installation.js'
import { openDefaultBrowser } from './browser.js'
import { applyCatalogOverlay, collapseAntigravityModels } from './catalog.js'
import { enrichNativeCatalog } from './enrich.js'
import { loadModelsDevFacts } from './models-dev.js'
import type { ModelFacts } from './model-metadata.js'
import { createAntigravityLlmBridge } from './llm-bridge.js'
import { installManagedAntigravityRuntime, type ManagedInstallProgress } from './managed-install.js'
import { probeAntigravityInstallation } from './probe.js'
import { installAntigravityProvider, type InstalledAntigravityProvider } from './plugin.js'
import { createAntigravityQuotaReader, type AntigravityQuotaReader } from './quota.js'
import { registerAcpSettingsRpc } from './rpc.js'
import { clearPersistedModelFacts, dshHome, loadPersistedConfig, loadPersistedModelFacts, loadPersistedModels, savePersistedConfig, savePersistedModelFacts, savePersistedModels } from './store.js'
import { parseAntigravityCallbackUrl } from './auth.js'
import type { AntigravityAuthorizationRequest } from './types.js'
import { ANTIGRAVITY_SESSION_READY, type AntigravityToolEvent } from './tool-events.js'

/** One ordered, bounded activity writer for a history root. */
export function createAntigravityActivityWriter(rootDirectory: string): {
  readonly store: AntigravityActivityStore
  append(sessionId: string | undefined, events: readonly AntigravityActivityEvent[]): void
  flush(sessionId: string): void
  flushAll(): void
  release(sessionId: string): void
  pendingCount(sessionId: string): number
} {
  const store = new AntigravityActivityStore(rootDirectory)
  const coalescer = new AntigravityActivityCoalescer({
    append: (sessionId, events) => {
      try {
        store.append(sessionId, events)
      } catch {
        throw new Error('Unable to persist Antigravity activity; native execution stopped.')
      }
    },
  })
  return {
    store,
    append: (sessionId, events) => {
      if (sessionId === undefined) throw new Error('Native activity requires an explicit DSH session id')
      coalescer.append(sessionId, events)
    },
    flush: sessionId => { coalescer.flush(sessionId) },
    flushAll: () => { coalescer.flushAll() },
    release: sessionId => { coalescer.release(sessionId) },
    pendingCount: sessionId => coalescer.pendingCount(sessionId),
  }
}

/** Loader-supplied Settings values. Empty paths stay on the page until the user locates them. */
export interface DshPluginConfig {
  readonly executablePath?: string
  readonly harnessPath?: string
  readonly stateDirectory?: string
  readonly instanceId?: string
  /** Deadline for native initialization, OAuth and model discovery; defaults to 30 seconds. */
  readonly modelDiscoveryTimeoutMs?: number
  readonly model?: string
  readonly enabled?: boolean
}

type PlanModeService = {
  get?(agent: unknown): { active: boolean; pending?: boolean }
  set(agent: unknown, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
}

/** Host context used by the Settings RPC plugin. */
export interface DshPluginContext extends ActivityBindingHostContext {
  on: ActivityBindingHostContext['on'] & ((event: 'session/disposed', listener: (session: { readonly id: string }) => void | Promise<void>) => () => void)
  logger: { warn(message: string): void }
  effect(fn: () => unknown, name?: string): void
  inject?(deps: string[], fn: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: (providers: string[], adapter: unknown) => () => void }; connection: DshPluginContext['connection']; modelSwitch?: { adapters: { register: (entry: { provider: string; role: 'agent' }) => () => void } } }) => void): void
  get?(name: string): unknown
  connection: { rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>): unknown } }
  /** Cordis emit. Present on the host root; tests may omit it. */
  emit?(event: 'llm/adapters-updated'): void
}

export const name = 'dsh-acp-antigravity'
export const inject = ['connection', 'webServer']

function defaultStateDirectory(): string {
  return join(dshHome(), 'profiles', 'web', 'antigravity')
}

function resolvePluginConfig(config: DshPluginConfig, persisted?: AcpAntigravitySettingsConfig): AcpAntigravitySettingsConfig {
  const merged = { ...config, ...persisted }
  const instanceId = (merged.instanceId ?? 'default').trim() || 'default'
  return {
    executablePath: merged.executablePath ?? '',
    harnessPath: merged.harnessPath ?? '',
    stateDirectory: (merged.stateDirectory ?? '').trim() || defaultStateDirectory(),
    instanceId,
    ...(merged.model === undefined || merged.model.trim() === '' ? {} : { model: merged.model.trim() }),
    ...(merged.modelDiscoveryTimeoutMs === undefined ? {} : { modelDiscoveryTimeoutMs: merged.modelDiscoveryTimeoutMs }),
    enabled: merged.enabled !== false,
    ...(merged.catalogOrder === undefined ? {} : { catalogOrder: merged.catalogOrder }),
    ...(merged.catalogOverrides === undefined ? {} : { catalogOverrides: merged.catalogOverrides }),
  }
}

/** Identity the composer picker must reload for. Path edits do not change it. */
function catalogStamp(config: { catalogOrder?: readonly string[]; catalogOverrides?: unknown }): string {
  return JSON.stringify([config.catalogOrder ?? null, config.catalogOverrides ?? null])
}

function agentFor(ctx: DshPluginContext, sessionId: string | undefined): unknown {
  if (sessionId === undefined) return undefined
  const agents = ctx.get?.('agents') as { get?: (id: string) => unknown } | undefined
  return agents?.get?.(sessionId)
}

function planModeFor(agent: { ctx?: { reflect?: { store?: Record<PropertyKey, { name?: string; value?: unknown; fiber?: { state?: number } }> } } }): PlanModeService | undefined {
  const store = agent.ctx?.reflect?.store
  if (store === undefined) return undefined
  const matches = Reflect.ownKeys(store).map(key => store[key])
    .filter(entry => entry?.name === 'planMode' && entry.fiber?.state === 2 && typeof (entry.value as { set?: unknown } | undefined)?.set === 'function')
  // ponytail: require one controller until DSH exposes an exact preset-owned resolver.
  return matches.length === 1 ? matches[0]!.value as PlanModeService : undefined
}

/** File-effect policy modes shared with the sandbox-policy service (structural, no new dependency). */
type SandboxPolicyMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * Resolve the authoritative sandbox policy for the exact session. A missing
 * service, unresolvable session, failed read, or unknown shape fails closed;
 * user and tool text never selects policy. No first-root fallback.
 */
function resolveSandboxPolicy(ctx: DshPluginContext, sessionId: string | undefined): { mode: SandboxPolicyMode; workspaceRoot: string } | undefined {
  const policy = ctx.get?.('sandboxPolicy') as { resolve?: (request?: { session?: unknown }) => { mode?: unknown; workspaceRoot?: unknown } } | undefined
  if (typeof policy?.resolve !== 'function') return undefined
  const agents = ctx.get?.('agents') as { get?: (id: string) => { session?: unknown } | undefined } | undefined
  const session = sessionId === undefined ? undefined : agents?.get?.(sessionId)?.session
  if (session === undefined) return undefined
  let resolved: { mode?: unknown; workspaceRoot?: unknown }
  try {
    resolved = policy.resolve({ session })
  } catch {
    // Unreadable sandbox policy fails closed to approval-required at the bridge.
    return undefined
  }
  if (resolved.mode !== 'read-only' && resolved.mode !== 'workspace-write' && resolved.mode !== 'danger-full-access') return undefined
  if (typeof resolved.workspaceRoot !== 'string' || resolved.workspaceRoot === '') return undefined
  return { mode: resolved.mode, workspaceRoot: resolved.workspaceRoot }
}

/** Closed approval outcome shared with the bridge (structural, no new dependency). */
export type NativeApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Native permission ask routed through the canonical approval service. */
export interface NativeApprovalInput {
  readonly sessionId: string | undefined
  readonly toolName: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

/**
 * Ask the canonical approval service for one native permission. Routes the exact
 * session agent; the service enforces session policy and audits itself. Never
 * passes a native tool id as the Core call id. A missing service or session
 * cancels; a throwing service is unavailable. Generic ask is not consulted.
 */
export async function requestNativeApproval(ctx: DshPluginContext, input: NativeApprovalInput): Promise<NativeApprovalOutcome> {
  const service = ctx.get?.('approval') as { request?: (req: { agent: unknown; toolName: string; reason?: string; signal?: AbortSignal }) => Promise<NativeApprovalOutcome> } | undefined
  const agent = agentFor(ctx, input.sessionId)
  if (typeof service?.request !== 'function' || agent === undefined) return 'cancelled'
  try {
    return await service.request({
      agent,
      toolName: input.toolName,
      ...(input.reason === undefined || input.reason === '' ? {} : { reason: input.reason }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch {
    // A throwing approval service cannot grant or deny; the bridge treats this as unavailable.
    return 'unavailable'
  }
}

function toProviderConfig(config: AcpAntigravitySettingsConfig) {
  return {
    executablePath: config.executablePath,
    harnessPath: config.harnessPath,
    stateDirectory: config.stateDirectory,
    instanceId: providerInstanceId(config.instanceId),
    ...(config.modelDiscoveryTimeoutMs === undefined ? {} : { modelDiscoveryTimeoutMs: config.modelDiscoveryTimeoutMs }),
    ...(config.model === undefined ? {} : { model: config.model }),
  }
}

/** Mount the Antigravity provider and the External Agents Settings RPC. */
export async function apply(ctx: DshPluginContext, config: DshPluginConfig = {}): Promise<void> {
  if (!allowDshRuntime(ctx.logger, 'dsh-acp-antigravity', ['@deepseek-ai/dsh-session'])) return
  ctx.inject?.(['modelSwitch'], scope => {
    const runtime = scope.modelSwitch
    if (runtime !== undefined) scope.effect(() => runtime.adapters.register({ provider: 'antigravity', role: 'agent' }))
  })
  const home = dshHome()
  const activity = createAntigravityActivityWriter(join(home, 'plugin-data', 'antigravity', 'history'))
  const { installActivityBindingGuard } = await import('./activity-binding.js')
  installActivityBindingGuard(ctx, activity.store, sessionId => {
    const agent = agentFor(ctx, sessionId) as { session?: { snapshotEvents?: () => readonly { readonly type: string; readonly data?: unknown }[] } } | undefined
    return agent?.session?.snapshotEvents?.()
  })
  const appendActivity = (sessionId: string | undefined, events: readonly AntigravityActivityEvent[]): void => {
    activity.append(sessionId, events)
  }
  let live = resolvePluginConfig(config, loadPersistedConfig(home))
  let authorizationUrl: string | undefined
  let pendingAuthorization: AntigravityAuthorizationRequest | undefined
  let probeMessage: string | undefined
  let install: ManagedInstallProgress | undefined
  let installJob: Promise<void> | undefined
  let signingIn = false
  let signInJob: Promise<void> | undefined
  const registry = new ExternalAgentProviderRegistry({
    auditFullAccess: entry => appendActivity(entry.session, [{ type: ANTIGRAVITY_FULL_ACCESS_AUTHORIZED, data: entry }]),
  })
  let bridge: ReturnType<typeof createAntigravityLlmBridge> | undefined
  const planCommitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let changing = false
  const editors = new ExternalAgentSettingsEditorRegistry()
  let installed: InstalledAntigravityProvider | undefined
  let models: { id: string; name: string }[] = loadPersistedModels(home)
  let modelFacts = new Map<string, ModelFacts>()
  let declaredDefaultModelId: string | undefined
  const AUTH_TIMEOUT_MS = 10 * 60 * 1000
  let authAttempt: { status: 'pending' | 'failed' | 'expired'; authorizationUrl?: string; expiresAt: number; message?: string } | undefined
  let signInAbort: AbortController | undefined
  const bindFacts = (): void => {
    const stored = loadPersistedModelFacts(home, live.instanceId, live.stateDirectory)
    modelFacts = stored === undefined ? new Map() : new Map(Object.entries(stored.facts))
    declaredDefaultModelId = stored?.defaultAgentModelId
  }
  bindFacts()
  let quotaReader: AntigravityQuotaReader = createAntigravityQuotaReader(toProviderConfig(live), { getRuntimeVersion: () => installed?.provider.health.version })

  const mount = async (next: AcpAntigravitySettingsConfig): Promise<void> => {
    if (changing) throw new Error('Antigravity configuration is changing')
    changing = true
    const previous = installed
    installed = undefined
    try {
      await bridge?.reset()
      await previous?.dispose()
      models = loadPersistedModels(home)
      authorizationUrl = undefined
      pendingAuthorization = undefined
      authAttempt = undefined
      signInAbort?.abort()
      signInAbort = undefined
      live = next
      bindFacts()
      quotaReader.invalidate()
      quotaReader = createAntigravityQuotaReader(toProviderConfig(next), { getRuntimeVersion: () => installed?.provider.health.version })
      installed = installAntigravityProvider(
        { externalAgents: registry, settingsEditors: editors },
        toProviderConfig(next),
        { onAuthorizationUrl: (request: AntigravityAuthorizationRequest) => {
          pendingAuthorization = request
          authorizationUrl = request.authorizationUrl
          if (authAttempt !== undefined) authAttempt = { ...authAttempt, authorizationUrl: request.authorizationUrl }
          // The pinned runtime already calls webbrowser.open before printing this URL.
          // Opening it again here is the second tab. Settings still offers Open login page.
        } },
      )
    } finally { changing = false }
  }

  const snapshot = async (): Promise<AcpSettingsSnapshot> => {
    const editor = installed === undefined ? undefined : editors.require(installed.provider.info.id, providerInstanceId(live.instanceId)).snapshot()
    const health = installed?.provider.health
    const row: AcpSettingsRow = {
      provider: String(installed?.provider.info.id ?? 'antigravity'),
      instanceId: live.instanceId,
      title: editor?.title ?? (live.instanceId === 'default' ? 'Antigravity' : 'Antigravity (' + live.instanceId + ')'),
      enabled: live.enabled,
      executablePath: live.executablePath,
      harnessPath: live.harnessPath,
      stateDirectory: live.stateDirectory,
      ...(live.model === undefined ? {} : { model: live.model }),
      ...(live.modelDiscoveryTimeoutMs === undefined ? {} : { modelDiscoveryTimeoutMs: live.modelDiscoveryTimeoutMs }),
      models: applyCatalogOverlay(collapseAntigravityModels(models, modelFacts, declaredDefaultModelId), live.catalogOrder, live.catalogOverrides),
      ...(declaredDefaultModelId === undefined ? {} : { declaredDefaultModelId }),
      installed: !('status' in await validateAntigravityInstallation(toProviderConfig(live))),
      ...(health?.status === 'error' ? { probeFailed: true } : {}),
      authenticated: editor?.status.authenticated ?? health?.status === 'ready',
      live: editor?.status.live ?? false,
      ready: editor?.status.ready ?? health?.status === 'ready',
      ...((): { message?: string } => {
        const managed = live.executablePath.trim() !== '' && live.harnessPath.trim() !== ''
        const message = editor?.status.message ?? health?.message ?? (managed ? undefined : probeMessage)
        return message === undefined ? {} : { message }
      })(),
      ...(health?.version === undefined ? {} : { version: health.version }),
      ...(health?.profileDirectory === undefined ? {} : { profileDirectory: health.profileDirectory }),
      ...(function authFields() {
        const authenticated = editor?.status.authenticated ?? health?.status === 'ready'
        if (authenticated) return {}
        const attempt = authAttempt === undefined ? undefined : {
          status: (Date.now() > authAttempt.expiresAt ? 'expired' : authAttempt.status) as 'pending' | 'failed' | 'expired',
          ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
          expiresAt: new Date(authAttempt.expiresAt).toISOString(),
          ...(authAttempt.message === undefined ? {} : { message: authAttempt.message }),
        }
        return {
          ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
          ...(attempt === undefined ? {} : { authAttempt: attempt }),
        }
      })(),
    }
    return { title: 'External Agents', rows: [row], ...(install === undefined ? {} : { install: { phase: install.phase, downloadedBytes: install.downloadedBytes, totalBytes: install.totalBytes, message: install.message } }), ...(signingIn ? { signingIn: true } : {}) }
  }

  const refreshCatalog = async (signal?: AbortSignal): Promise<void> => {
    if (installed === undefined) return
    const listed = await installed.provider.listModels(signal)
    models = listed.map(model => ({ id: String(model.id), name: model.name }))
    savePersistedModels(home, models)
    try {
      const ccpa = await quotaReader.listModels(signal)
      declaredDefaultModelId = ccpa.defaultAgentModelId
      const overlay = await loadModelsDevFacts(models.map(model => model.id), signal === undefined ? {} : { signal }).catch(() => new Map()) // models.dev miss: keep upstream facts only
      modelFacts = enrichNativeCatalog(models, ccpa, overlay)
      savePersistedModelFacts(home, {
        version: 1,
        instanceId: live.instanceId,
        stateDirectory: live.stateDirectory,
        observedAt: new Date().toISOString(),
        ...(declaredDefaultModelId === undefined ? {} : { defaultAgentModelId: declaredDefaultModelId }),
        facts: Object.fromEntries(modelFacts),
      })
    } catch {
      // ACP names stay listed; missing facts remain unknown rather than guessed.
    }
  }
  await mount(live)
  void refreshCatalog().catch(() => undefined) // catalog probe: UI still shows last snapshot
  if (typeof ctx.inject === 'function') {
    ctx.inject(['llm'], scope => {
      const adapter = createAntigravityLlmBridge({ registry, getProvider: () => changing || !live.enabled ? undefined : installed?.provider }, () => models, next => { models = [...next]; savePersistedModels(home, models) }, {
        ask: async request => {
          const service = ctx.get?.('userQuestions') as { ask?: (payload: Record<string, unknown>) => Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }> } | undefined
          if (service?.ask === undefined) return { answers: [] }
          const agent = agentFor(ctx, request.sessionId)
          const { sessionId: _ignored, ...rest } = request
          return service.ask({ ...rest, ...(agent === undefined ? {} : { agent }) })
        },
        appendSessionReady: (sessionId, ref) => { appendActivity(sessionId, [{ type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity', ref } }]) },
        loadSession: id => nativeSessionBinding(activity.store.read(id), id),
        appendToolEvents: (sessionId, events: readonly AntigravityToolEvent[]) => { appendActivity(sessionId, events) },
        flushActivity: sessionId => { activity.flush(sessionId) },
        flushActivityAll: () => { activity.flushAll() },
        releaseActivity: sessionId => { activity.release(sessionId) },
        isPlanMode: sessionId => {
          const agent = agentFor(ctx, sessionId) as { session: unknown } | undefined
          const projections = ctx.get?.('sessionProjections') as { stateOf(session: unknown, key: 'plan'): { active: boolean } | undefined } | undefined
          return agent !== undefined && projections?.stateOf(agent.session, 'plan')?.active === true
        },
        setPlanMode: (sessionId, active) => {
          const agent = agentFor(ctx, sessionId) as { session?: unknown; ctx?: { reflect?: { store?: Record<PropertyKey, { name?: string; value?: unknown; fiber?: { state?: number } }> } } } | undefined
          const planMode = agent === undefined ? undefined : planModeFor(agent)
          if (agent?.session === undefined || sessionId === undefined || planMode === undefined || planMode.set(agent, active) !== 'queued') return
          const arm = (check: () => void): void => {
            // ponytail: Plan exposes no turn-idle subscription; replace this low-frequency poll when it does.
            const timer = setTimeout(check, 50)
            ;(timer as { unref?: () => void }).unref?.()
            planCommitTimers.set(sessionId, timer)
          }
          const settle = (): void => {
            planCommitTimers.delete(sessionId)
            const projections = ctx.get?.('sessionProjections') as {
              stateOf(session: unknown, key: 'turnBoundary'): { openTurnStartSeq: number | null } | undefined
            } | undefined
            if (projections?.stateOf(agent.session, 'turnBoundary')?.openTurnStartSeq != null) {
              arm(settle)
              return
            }
            if (planMode.get?.(agent).active === active) return
            planMode.set(agent, !active) // cancel the queued choice now that the Host turn is idle
            planMode.set(agent, active)
          }
          const pending = planCommitTimers.get(sessionId)
          if (pending !== undefined) clearTimeout(pending)
          arm(settle)
        },
        resolveSelectedModel: sessionId => {
          const agent = agentFor(ctx, sessionId) as { session?: unknown } | undefined
          if (agent === undefined) return undefined
          type Selection = { provider?: string; model?: string; reasoningEffort?: string }
          const projections = ctx.get?.('sessionProjections') as {
            stateOf(session: unknown, key: 'modelSelection'): { pending?: Selection | null; lastUsed?: Selection | null } | undefined
          } | undefined
          const state = agent.session === undefined ? undefined : projections?.stateOf(agent.session, 'modelSelection')
          const selected = state?.pending ?? state?.lastUsed
          if (selected === undefined || selected === null) return undefined
          if (selected.provider !== undefined && selected.provider !== 'antigravity') throw new Error('Antigravity native turn refused: ' + selected.provider + '/' + (selected.model ?? ''))
          if (selected.model === undefined || selected.model === '') throw new Error('Antigravity native turn refused: invalid model selection')
          return { model: selected.model, ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }) }
        },
        readImage: async (attachment, signal) => {
          const store = ctx.get?.('attachments') as { readImage?: (ref: unknown, signal?: AbortSignal) => Promise<{ data: Uint8Array; ref: { mediaType: string; name?: string } }> } | undefined
          if (store?.readImage === undefined) throw new Error('Antigravity image input requires the durable attachment service')
          const stored = await store.readImage(attachment, signal)
          return { data: stored.data, mimeType: stored.ref.mediaType, ...(typeof stored.ref.name === 'string' ? { name: stored.ref.name } : {}) }
        },
        resolvePolicy: sessionId => resolveSandboxPolicy(ctx, sessionId),
        requestApproval: input => requestNativeApproval(ctx, input),
      }, () => modelFacts, () => ({
        ...(declaredDefaultModelId === undefined ? {} : { declaredDefaultModelId }),
        ...(live.catalogOrder === undefined ? {} : { order: live.catalogOrder }),
        ...(live.catalogOverrides === undefined ? {} : { overrides: live.catalogOverrides }),
      }))
      bridge = adapter
      scope.effect(() => {
        const unregister = scope.llm.registerAdapter(['antigravity'], adapter)
        return async () => {
          unregister()
          if (bridge === adapter) bridge = undefined
          await adapter.dispose()
        }
      })
    })
  }
  ctx.on('session/disposed', async session => {
    try { activity.release(session.id) }
    catch (error) { console.error('dsh-acp-antigravity: activity flush during session disposal failed', error) }
    await bridge?.release(session.id)
  })
  // The settings channel must register through an injected connection scope:
  // reading ctx.connection on the plugin root ctx throws without inject on the
  // target host and takes the whole profile down at load.
  if (typeof ctx.inject !== 'function') throw new Error('dsh-acp-antigravity requires host ctx.inject')
  ctx.inject(['connection', 'webServer'], scope => registerAcpSettingsRpc(scope, {
    snapshot,
    quota: () => quotaReader.snapshot(),
    readActivity: sessionId => activity.store.read(sessionId),
    readActivityAfter: (sessionId, afterSeq) => activity.store.readActivityPage(sessionId, afterSeq),
    catalog: async () => {
      if (installed === undefined) return { groups: [] }
      if ('status' in await validateAntigravityInstallation(toProviderConfig(live))) return { groups: [] }
      if (models.length === 0) return { groups: [] }
      return { groups: [{ id: String(installed.provider.info.id), name: live.instanceId === 'default' ? 'Antigravity' : 'Antigravity (' + live.instanceId + ')', models: applyCatalogOverlay(collapseAntigravityModels(models, modelFacts, declaredDefaultModelId), live.catalogOrder, live.catalogOverrides) }] }
    },
    applyConfig: async next => {
      const catalogChanged = catalogStamp(live) !== catalogStamp(next)
      const remount = next.executablePath !== live.executablePath || next.harnessPath !== live.harnessPath || next.stateDirectory !== live.stateDirectory || next.instanceId !== live.instanceId
      if (remount) await mount(next)
      else live = next
      savePersistedConfig(home, next)
      // The composer picker caches session.modelCatalog until this event. Plugin
      // saves do not touch the core settings document, so nothing else invalidates it.
      if (catalogChanged) ctx.emit?.('llm/adapters-updated')
    },
    run: async (action, value, signal) => {
      if (changing) throw new Error('Antigravity configuration is changing')
      if (installed === undefined) throw new Error('Antigravity provider is unavailable')
      const editor = editors.require(installed.provider.info.id, providerInstanceId(live.instanceId))
      if (action === 'refresh-models') {
        await refreshCatalog(signal)
        ctx.emit?.('llm/adapters-updated')
        return collapseAntigravityModels(models, modelFacts, declaredDefaultModelId)
      }
      if (action === 'pick-harness-sibling' && typeof value === 'string') {
        return { path: deriveAntigravityHarnessPath(value) }
      }
      if (action === 'open-login') {
        if (authorizationUrl === undefined) throw new Error('Antigravity sign-in URL is not available yet')
        openDefaultBrowser(authorizationUrl)
        return { opened: true }
      }
      if (action === 'cancel-login') {
        signInAbort?.abort()
        signInAbort = undefined
        signingIn = false
        signInJob = undefined
        pendingAuthorization = undefined
        authorizationUrl = undefined
        authAttempt = undefined
        return { cancelled: true }
      }
      if (action === 'complete-login') {
        if (typeof value !== 'string') throw new Error('Antigravity callback URL is invalid')
        if (pendingAuthorization === undefined || !signingIn || authAttempt === undefined) throw new Error('Antigravity sign-in is not waiting for a callback')
        if (Date.now() > authAttempt.expiresAt) {
          authAttempt = { status: 'expired', expiresAt: Date.now(), message: 'Antigravity sign-in expired.' }
          throw new Error('Antigravity sign-in expired.')
        }
        const pending = pendingAuthorization
        pendingAuthorization = undefined
        const callback = parseAntigravityCallbackUrl(value, pending)
        const response = await fetch(callback, { redirect: 'error', signal: signal ?? AbortSignal.timeout(5000) })
        await response.arrayBuffer().catch(() => undefined) // drain body so the socket can close
        return { delivered: true }
      }
      if (action === 'sign-in') {
        if (signInJob === undefined) {
          signingIn = true
          signInAbort = new AbortController()
          const timeout = AbortSignal.timeout(AUTH_TIMEOUT_MS)
          const combined = signal === undefined ? AbortSignal.any([signInAbort.signal, timeout]) : AbortSignal.any([signInAbort.signal, timeout, signal])
          authAttempt = { status: 'pending', expiresAt: Date.now() + AUTH_TIMEOUT_MS }
          const provider = installed.provider
          signInJob = provider.signIn(combined).then(async () => {
            authorizationUrl = undefined
            pendingAuthorization = undefined
            authAttempt = undefined
            try { await refreshCatalog() } catch { /* picker stays empty until a later catalog load */ }
          }).catch(() => {
            if (authAttempt !== undefined) authAttempt = { status: combined.aborted ? 'expired' : 'failed', expiresAt: authAttempt.expiresAt, message: combined.aborted ? 'Antigravity sign-in expired.' : 'Antigravity sign-in failed.' }
          }).finally(() => { signingIn = false; signInJob = undefined; signInAbort = undefined; quotaReader.invalidate() })
        }
        return { started: true }
      }
      if (action === 'install-runtime') {
        if (installJob === undefined) {
          installJob = (async () => {
            const result = await installManagedAntigravityRuntime({
              home,
              onProgress: progress => { install = progress },
            })
            install = result
            if (result.phase === 'succeeded' && result.executablePath !== undefined && result.harnessPath !== undefined) {
              const next = { ...live, executablePath: result.executablePath, harnessPath: result.harnessPath }
              await mount(next)
              savePersistedConfig(home, next)
            }
          })().finally(() => { installJob = undefined })
        }
        return install ?? { phase: 'downloading', downloadedBytes: 0, totalBytes: 0, message: 'Starting Antigravity install.' }
      }
      if (action === 'probe-installation') {
        const found = await probeAntigravityInstallation()
        probeMessage = found.message
        const empty = live.executablePath.trim() === '' || live.harnessPath.trim() === ''
        if (empty && found.executablePath !== undefined && found.harnessPath !== undefined) {
          const next = { ...live, executablePath: found.executablePath, harnessPath: found.harnessPath }
          await mount(next)
          savePersistedConfig(home, next)
        }
        return found
      }
      // Sign-in is handled above with a coalesced provider.signIn job; only sign-out reaches the editor here.
      if (action === 'sign-out') {
        changing = true
        try {
          await bridge?.reset()
          return await editor.run(action, signal)
        } finally {
          models = []
          modelFacts = new Map()
          declaredDefaultModelId = undefined
          clearPersistedModelFacts(home)
          authorizationUrl = undefined
          pendingAuthorization = undefined
          authAttempt = undefined
          changing = false
          quotaReader.invalidate()
        }
      }
      return editor.run(action, signal)
    },
  }))
  ctx.effect(() => async () => {
    changing = true
    for (const timer of planCommitTimers.values()) clearTimeout(timer)
    planCommitTimers.clear()
    quotaReader.invalidate()
    try { activity.flushAll() }
    catch (error) { console.error('dsh-acp-antigravity: activity flush during teardown failed', error) }
    await bridge?.dispose()
    await installed?.dispose()
  }, 'dsh-acp-antigravity: provider')
}
