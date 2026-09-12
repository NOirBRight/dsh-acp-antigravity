/** Opaque native cursors bound to the account profile and workspace. */
import { createHash } from 'node:crypto'
import { resumeCursor, type ExternalAgentProviderId, type ExternalAgentResumeCursor } from '@deepseek-ai/dsh-acp-provider'
import { resolveAntigravityProfileDirectory } from './auth.js'
import { isRecord, stringValue } from './decode.js'
import type { AntigravityProviderConfig } from './types.js'

/** Identify the profile and working directory that can resume one native conversation.
 * @param config - Native profile configuration.
 * @param cwd - Absolute native working directory.
 * @returns An opaque scope digest, not a credential or account identity.
 */
export function antigravitySessionScope(config: AntigravityProviderConfig, cwd: string): string {
  return createHash('sha256').update(JSON.stringify([resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId), cwd])).digest('hex')
}

/** Encode a native id without exposing profile paths in history.
 * @param provider - Provider owning the native session.
 * @param nativeId - Native session identifier.
 * @param scope - Profile/workspace digest.
 * @returns A provider-owned resume cursor.
 */
export function encodeAntigravityCursor(provider: ExternalAgentProviderId, nativeId: string, scope: string): ExternalAgentResumeCursor {
  return resumeCursor(provider, JSON.stringify({ v: 1, nativeId, scope }))
}

/** Reject missing, legacy, or cross-profile cursors instead of creating a context-free conversation.
 * @param cursor - Persisted opaque native cursor.
 * @param scope - Expected profile/workspace digest.
 * @returns The native id, or throws when the cursor cannot safely resume.
 */
export function decodeAntigravityCursor(cursor: ExternalAgentResumeCursor, scope: string): string {
  let value: unknown
  try { value = JSON.parse(cursor.value) } catch { throw new Error('Native history has no resumable cursor; start a new DSH session.') }
  const nativeId = isRecord(value) ? stringValue(value.nativeId) : undefined
  if (!isRecord(value) || value.v !== 1 || nativeId === undefined || value.scope !== scope) {
    throw new Error('Native history cannot resume in this profile or workspace; restore its configuration or start a new DSH session.')
  }
  return nativeId
}
