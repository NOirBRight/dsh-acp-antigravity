/** Cordis host plugin: External Agents Settings through settings.section RPC. */
import { ExternalAgentProviderRegistry, providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { ExternalAgentSettingsEditorRegistry } from '@deepseek-ai/dsh-acp-provider/settings'
import { join } from 'node:path'
import type { AcpAntigravitySettingsConfig, AcpSettingsRow, AcpSettingsSnapshot } from './client-contract.js'
import { deriveAntigravityHarnessPath } from './installation.js'
import { installManagedAntigravityRuntime, type ManagedInstallProgress } from './managed-install.js'
import { probeAntigravityInstallation } from './probe.js'
import { installAntigravityProvider, type InstalledAntigravityProvider } from './plugin.js'
import { registerAcpSettingsRpc } from './rpc.js'
import { dshHome, loadPersistedConfig, savePersistedConfig } from './store.js'
import type { AntigravityAuthorizationRequest } from './types.js'

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
export interface DshPluginContext {
  effect(fn: () => unknown, name?: string): void
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
  let live = resolvePluginConfig(config, loadPersistedConfig(home))
  let authorizationUrl: string | undefined
  let probeMessage: string | undefined
  let install: ManagedInstallProgress | undefined
  let installJob: Promise<void> | undefined
  const registry = new ExternalAgentProviderRegistry()
  const editors = new ExternalAgentSettingsEditorRegistry()
  let installed: InstalledAntigravityProvider | undefined
  let models: { id: string; name: string }[] = []

  const mount = async (next: AcpAntigravitySettingsConfig): Promise<void> => {
    await installed?.dispose()
    installed = undefined
    authorizationUrl = undefined
    live = next
    installed = installAntigravityProvider(
      { externalAgents: registry, settingsEditors: editors },
      toProviderConfig(next),
      { onAuthorizationUrl: (request: AntigravityAuthorizationRequest) => { authorizationUrl = request.authorizationUrl } },
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
      installed: editor?.status.installed ?? (health !== undefined && health.status !== 'missing-installation' && health.status !== 'invalid-installation'),
      authenticated: editor?.status.authenticated ?? health?.status === 'ready',
      live: editor?.status.live ?? false,
      ready: editor?.status.ready ?? health?.status === 'ready',
      ...((): { message?: string } => { const message = editor?.status.message ?? health?.message ?? probeMessage; return message === undefined ? {} : { message } })(),
      ...(health?.version === undefined ? {} : { version: health.version }),
      ...(health?.profileDirectory === undefined ? {} : { profileDirectory: health.profileDirectory }),
      ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
    }
    return { title: 'External Agents', rows: [row], ...(install === undefined ? {} : { install: { phase: install.phase, downloadedBytes: install.downloadedBytes, totalBytes: install.totalBytes, message: install.message } }) }
  }

  await mount(live)
  registerAcpSettingsRpc(ctx, {
    snapshot,
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
        if (found.executablePath !== undefined && found.harnessPath !== undefined) {
          const next = { ...live, executablePath: found.executablePath, harnessPath: found.harnessPath }
          await mount(next)
          savePersistedConfig(home, next)
        }
        return found
      }
      return editor.run(action, signal)
    },
  })
  ctx.effect(() => () => { void installed?.dispose() }, 'dsh-acp-antigravity: provider')
}
