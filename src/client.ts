import { createAntigravitySettingsEditor } from './settings.js'
import type { AntigravityProvider } from './provider.js'
import type { AntigravityProviderConfig } from './types.js'

/** Client-plugin metadata consumed by a DSH web profile adapter. */
export const ANTIGRAVITY_CLIENT_PLUGIN_ID = 'dsh-acp-antigravity'

/** Provider-owned Settings card factory; generic Settings owns placement and persistence. */
export function createAntigravityClientContribution(config: AntigravityProviderConfig, provider: AntigravityProvider) {
  return { id: ANTIGRAVITY_CLIENT_PLUGIN_ID, settingsEditor: createAntigravitySettingsEditor(config, provider) }
}
