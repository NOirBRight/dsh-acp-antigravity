/** Cordis host plugin: External Agents Settings through settings.section RPC. */
import { ExternalAgentProviderRegistry, providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { ExternalAgentSettingsEditorRegistry } from '@deepseek-ai/dsh-acp-provider/settings'
import { join } from 'node:path'
import type { ActivityBindingHostContext } from './activity-binding.js'
import { AntigravityActivityStore, type AntigravityActivityEvent } from './activity-store.js'
import type { AcpAntigravitySettingsConfig, AcpSettingsRow, AcpSettingsSnapshot } from './client-contract.js'
import { deriveAntigravityHarnessPath, validateAntigravityInstallation } from './installation.js'
import { openDefaultBrowser } from './browser.js'
import { createAntigravityLlmBridge } from './llm-bridge.js'
import { installManagedAntigravityRuntime, type ManagedInstallProgress } from './managed-install.js'
import { probeAntigravityInstallation } from './probe.js'
import { installAntigravityProvider, type InstalledAntigravityProvider } from './plugin.js'
import { createAntigravityQuotaReader, type AntigravityQuotaReader } from './quota.js'
import { registerAcpSettingsRpc } from './rpc.js'
import { dshHome, loadPersistedConfig, savePersistedConfig } from './store.js'
import type { AntigravityAuthorizationRequest } from './types.js'
import { ANTIGRAVITY_SESSION_READY, type AntigravityToolEvent } from './tool-events.js'

/** Loader-supplied Settings values. Empty paths stay on the page until the user locates them. */
export interface DshPluginConfig {
  readonly executablePath?: string
  readonly harnessPath?: string
  readonly stateDirectory?: string
  readonly instanceId?: string
  readonly model?: string
  readonly enabled?: boolean
}

/** Host context used by the Settings RPC plugin. */
export interface DshPluginContext extends ActivityBindingHostContext {
  effect(fn: () => unknown, name?: string): void
  inject?(deps: string[], fn: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: (providers: string[], adapter: unknown) => () => void } }) => void): void
  get?(name: string): unknown
  connection: { rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>): unknown } }
}

export const name = 'dsh-acp-antigravity'
export const inject = ['connection']

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
    enabled: merged.enabled !== false,
  }
}

function agentFor(ctx: DshPluginContext, sessionId: string | undefined): unknown {
  const agents = ctx.get?.('agents') as { get?: (id: string) => unknown; roots?: () => unknown[] } | undefined
  return (sessionId === undefined ? undefined : agents?.get?.(sessionId)) ?? agents?.roots?.()[0]
}

function toProviderConfig(config: AcpAntigravitySettingsConfig) {
  return {
    executablePath: config.executablePath,
    harnessPath: config.harnessPath,
    stateDirectory: config.stateDirectory,
    instanceId: providerInstanceId(config.instanceId),
    ...(config.model === undefined ? {} : { model: config.model }),
  }
}

/** Mount the Antigravity provider and the External Agents Settings RPC. */
export async function apply(ctx: DshPluginContext, config: DshPluginConfig = {}): Promise<void> {
  const home = dshHome()
  const activity = new AntigravityActivityStore(join(home, 'plugin-data', 'antigravity', 'history'))
  const { installActivityBindingGuard } = await import('./activity-binding.js')
  installActivityBindingGuard(ctx, activity)
  const appendActivity = (sessionId: string | undefined, events: readonly AntigravityActivityEvent[]): void => {
    if (sessionId === undefined) throw new Error('Native activity requires an explicit DSH session id')
    try {
      activity.append(sessionId, events)
    } catch {
      throw new Error('Unable to persist Antigravity activity; native execution stopped.')
    }
  }
  let live = resolvePluginConfig(config, loadPersistedConfig(home))
  let authorizationUrl: string | undefined
  let probeMessage: string | undefined
  let install: ManagedInstallProgress | undefined
  let installJob: Promise<void> | undefined
  let signingIn = false
  let signInJob: Promise<void> | undefined
  const registry = new ExternalAgentProviderRegistry()
  const editors = new ExternalAgentSettingsEditorRegistry()
  let installed: InstalledAntigravityProvider | undefined
  let models: { id: string; name: string }[] = []
  let quotaReader: AntigravityQuotaReader = createAntigravityQuotaReader(toProviderConfig(live), { getRuntimeVersion: () => installed?.provider.health.version })

  const mount = async (next: AcpAntigravitySettingsConfig): Promise<void> => {
    await installed?.dispose()
    installed = undefined
    authorizationUrl = undefined
    live = next
    quotaReader.invalidate()
    quotaReader = createAntigravityQuotaReader(toProviderConfig(next), { getRuntimeVersion: () => installed?.provider.health.version })
    installed = installAntigravityProvider(
      { externalAgents: registry, settingsEditors: editors },
      toProviderConfig(next),
      { onAuthorizationUrl: (request: AntigravityAuthorizationRequest) => {
        authorizationUrl = request.authorizationUrl
        try { openDefaultBrowser(request.authorizationUrl) } catch { /* Settings still shows the URL if the desktop opener is missing. */ }
      } },
    )
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
      models,
      installed: !('status' in await validateAntigravityInstallation(toProviderConfig(live))),
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
      ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
    }
    return { title: 'External Agents', rows: [row], ...(install === undefined ? {} : { install: { phase: install.phase, downloadedBytes: install.downloadedBytes, totalBytes: install.totalBytes, message: install.message } }), ...(signingIn ? { signingIn: true } : {}) }
  }

  await mount(live)
  if (typeof ctx.inject === 'function') {
    ctx.inject(['llm'], (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: (providers: string[], adapter: unknown) => () => void } }) => {
      const adapter = createAntigravityLlmBridge(() => installed?.provider, () => models, next => { models = [...next] }, {
        ask: async request => {
          const service = ctx.get?.('userQuestions') as { ask?: (payload: Record<string, unknown>) => Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }> } | undefined
          if (service?.ask === undefined) return { answers: [] }
          const agent = agentFor(ctx, request.sessionId)
          const { sessionId: _ignored, ...rest } = request
          return service.ask({ ...rest, ...(agent === undefined ? {} : { agent }) })
        },
        appendSessionReady: sessionId => { appendActivity(sessionId, [{ type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }]) },
        appendToolEvents: (sessionId, events: readonly AntigravityToolEvent[]) => { appendActivity(sessionId, events) },
      })
      scope.effect(() => scope.llm.registerAdapter(['antigravity'], adapter))
    })
  }
  registerAcpSettingsRpc(ctx, {
    snapshot,
    quota: () => quotaReader.snapshot(),
    readActivity: sessionId => activity.read(sessionId),
    catalog: async () => {
      if (installed === undefined) return { groups: [] }
      if ('status' in await validateAntigravityInstallation(toProviderConfig(live))) return { groups: [] }
      if (models.length === 0) {
        try { models = (await installed.provider.listModels()).map(model => ({ id: String(model.id), name: model.name })) }
        catch { return { groups: [] } }
      }
      if (models.length === 0) return { groups: [] }
      return { groups: [{ id: String(installed.provider.info.id), name: live.instanceId === 'default' ? 'Antigravity' : 'Antigravity (' + live.instanceId + ')', models: models.map(model => ({ id: model.id, name: model.name })) }] }
    },
    applyConfig: async next => {
      await mount(next)
      savePersistedConfig(home, next)
    },
    run: async (action, value, signal) => {
      if (installed === undefined) throw new Error('Antigravity provider is unavailable')
      const editor = editors.require(installed.provider.info.id, providerInstanceId(live.instanceId))
      if (action === 'refresh-models') {
        const listed = await installed.provider.listModels(signal)
        models = listed.map(model => ({ id: String(model.id), name: model.name }))
        return models
      }
      if (action === 'pick-harness-sibling' && typeof value === 'string') {
        return { path: deriveAntigravityHarnessPath(value) }
      }
      if (action === 'open-login') {
        if (authorizationUrl === undefined) throw new Error('Antigravity sign-in URL is not available yet')
        openDefaultBrowser(authorizationUrl)
        return { opened: true }
      }
      if (action === 'sign-in') {
        if (signInJob === undefined) {
          signingIn = true
          const provider = installed.provider
          signInJob = provider.signIn().then(async () => {
            try { models = (await provider.listModels()).map(model => ({ id: String(model.id), name: model.name })) } catch { /* picker stays empty until a later catalog load */ }
          }).catch(() => undefined).finally(() => { signingIn = false; signInJob = undefined; quotaReader.invalidate() })
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
      if (action === 'sign-in' || action === 'sign-out') {
        try {
          return await editor.run(action, signal)
        } finally {
          quotaReader.invalidate()
        }
      }
      return editor.run(action, signal)
    },
  })
  ctx.effect(() => () => { quotaReader.invalidate(); void installed?.dispose() }, 'dsh-acp-antigravity: provider')
}
