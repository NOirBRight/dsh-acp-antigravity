import { providerId } from '@deepseek-ai/dsh-acp-provider'
import type { ExternalAgentSettingsEditor, ExternalAgentSettingsEditorSnapshot, ExternalAgentSettingsField, ExternalAgentSettingsStatus } from '@deepseek-ai/dsh-acp-provider/settings'
import { AntigravityProvider } from './provider.js'
import type { AntigravityHealth, AntigravityProviderConfig } from './types.js'

/** Provider-specific Settings document; it contains paths, never credentials. */
export interface AntigravitySettingsDocument {
  readonly instanceId: string
  readonly executablePath: string
  readonly harnessPath: string
  readonly stateDirectory: string
  readonly authMethod: 'oauth-personal'
}
/** Convert provider configuration into a persistable, secret-free Settings document. */
export function toAntigravitySettings(config: AntigravityProviderConfig): AntigravitySettingsDocument {
  return { instanceId: config.instanceId, executablePath: config.executablePath, harnessPath: config.harnessPath, stateDirectory: config.stateDirectory, authMethod: config.authMethod ?? 'oauth-personal' }
}
/** Convert provider health into the generic Settings status without claiming readiness from liveness. */
function settingsStatus(health: AntigravityHealth, live: boolean): ExternalAgentSettingsStatus {
  const installed = health.status !== 'missing-installation' && health.status !== 'invalid-installation'
  const authenticated = health.status === 'ready'
  const ready = health.status === 'ready'
  return { installed, authenticated, live, ready, ...(health.message === undefined ? {} : { message: health.message }) }
}
/** Build a live provider-owned Settings card with validation and OAuth actions. */
export function createAntigravitySettingsEditor(config: AntigravityProviderConfig, provider: AntigravityProvider): ExternalAgentSettingsEditor {
  const id = providerId(config.instanceId === 'default' ? 'antigravity' : 'antigravity:' + config.instanceId)
  return {
    provider: id,
    instanceId: config.instanceId,
    snapshot(): ExternalAgentSettingsEditorSnapshot {
      const health = provider.health
      const fields: ExternalAgentSettingsField[] = [
        { key: 'executablePath', label: 'Antigravity ACP executable', kind: 'text', value: config.executablePath },
        { key: 'harnessPath', label: 'localharness_external executable', kind: 'text', value: config.harnessPath },
        { key: 'stateDirectory', label: 'Private profile directory', kind: 'text', value: config.stateDirectory },
        { key: 'status', label: 'Installation and account status', kind: 'status', value: health.message ?? health.status },
        ...(health.version === undefined ? [] : [{ key: 'version', label: 'Detected ACP version', kind: 'status' as const, value: health.version }]),
        { key: 'selectedModel', label: 'Selected model', kind: 'status', value: health.model ?? config.model ?? 'account default' },
        { key: 'fullAccessWarning', label: 'Full-access warning', kind: 'status', value: 'Requires explicit confirmation and an audit event before startup. Antigravity native terminal access may reach paths outside DSH client-filesystem roots.' },
      ]
      return {
        provider: id,
        instanceId: config.instanceId,
        title: config.instanceId === 'default' ? 'Antigravity' : 'Antigravity (' + config.instanceId + ')',
        status: settingsStatus(health, provider.live),
        fields,
        actions: [
          { id: 'validate-installation', label: 'Validate installation', run: async () => provider.validateInstallation() },
          { id: 'refresh-models', label: 'Refresh models', run: async () => provider.listModels() },
          { id: 'sign-in', label: 'Sign in with personal Google OAuth', run: async value => provider.signIn(value instanceof AbortSignal ? value : undefined) },
          { id: 'sign-out', label: 'Sign out and close native session', run: async value => provider.signOut(value instanceof AbortSignal ? value : undefined) },
        ],
      }
    },
    run(action: string, value?: unknown): Promise<unknown> {
      const selected = this.snapshot().actions.find(candidate => candidate.id === action)
      if (selected === undefined) return Promise.reject(new Error('Antigravity Settings action is unavailable: ' + action))
      return selected.run(value)
    },
  }
}
