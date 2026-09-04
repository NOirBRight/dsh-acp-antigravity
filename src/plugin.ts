import type { ExternalAgentProviderRegistry } from '@deepseek-ai/dsh-acp-provider'
import { ExternalAgentSettingsEditorRegistry } from '@deepseek-ai/dsh-acp-provider/settings'
import { AntigravityProvider, type AntigravityProviderDependencies } from './provider.js'
import { createAntigravitySettingsEditor } from './settings.js'
import type { AntigravityProviderConfig } from './types.js'

/** Host methods required by the out-of-tree composition adapter. */
export interface AntigravityPluginHost {
  readonly externalAgents: ExternalAgentProviderRegistry
  readonly settingsEditors?: ExternalAgentSettingsEditorRegistry
}
/** Installed provider and its quiescent disposer. */
export interface InstalledAntigravityProvider {
  readonly provider: AntigravityProvider
  readonly dispose: () => Promise<void>
}
/** Install one Antigravity provider and its live provider-owned Settings card. */
export function installAntigravityProvider(host: AntigravityPluginHost, config: AntigravityProviderConfig, dependencies?: AntigravityProviderDependencies): InstalledAntigravityProvider {
  const provider = new AntigravityProvider(config, dependencies)
  const disposeEditor = host.settingsEditors?.register(createAntigravitySettingsEditor(config, provider))
  let disposeProvider: () => Promise<void>
  try { disposeProvider = host.externalAgents.register(provider) } catch (error) { disposeEditor?.(); throw error }
  let active = true
  return {
    provider,
    dispose: async () => {
      if (!active) return
      active = false
      disposeEditor?.()
      await disposeProvider()
    },
  }
}
