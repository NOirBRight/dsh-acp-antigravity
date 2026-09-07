/** Card state for the state-driven Settings UI. Derived only from the live snapshot row. */
import type { AcpSettingsRow } from '../client-contract.ts'

/** Visible installation and account setup step. */
export type AntigravityCardState = 'loading' | 'missing' | 'login' | 'connected'

/** Resolve setup from probe-backed installation and provider authentication status. */
export function resolveAntigravityCardState(row: AcpSettingsRow | undefined): AntigravityCardState {
  if (row === undefined) return 'loading'
  if (!row.installed) return 'missing'
  if (!row.authenticated) return 'login'
  return 'connected'
}

/** Whether a live snapshot invalidates retained account quota.
 * @param previous - Last accepted row, absent on first paint.
 * @param incoming - Newly received authentication and profile state.
 * @returns True on logout, missing provider, or a known profile change.
 */
export function shouldClearQuota(previous: AcpSettingsRow | undefined, incoming: AcpSettingsRow | undefined): boolean {
  return !incoming?.authenticated || (previous !== undefined && (previous.instanceId !== incoming.instanceId || previous.stateDirectory !== incoming.stateDirectory))
}

/** Merge live health/catalog data without overwriting unsaved configuration edits. */
export function mergeSettingsDraft(current: AcpSettingsRow | undefined, incoming: AcpSettingsRow | undefined, dirty: boolean): AcpSettingsRow | undefined {
  if (!dirty || current === undefined || incoming === undefined || current.instanceId !== incoming.instanceId || current.stateDirectory !== incoming.stateDirectory) return incoming
  const next = { ...incoming, enabled: current.enabled, executablePath: current.executablePath, harnessPath: current.harnessPath }
  if (current.model === undefined) delete next.model
  else next.model = current.model
  return next
}
