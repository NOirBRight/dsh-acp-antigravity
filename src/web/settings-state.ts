/** Merge live health/catalog data without overwriting unsaved configuration edits. */
import type { AcpSettingsRow } from '../client-contract.ts'

export function mergeSettingsDraft(current: AcpSettingsRow | undefined, incoming: AcpSettingsRow | undefined, dirty: boolean): AcpSettingsRow | undefined {
  if (!dirty || current === undefined || incoming === undefined || current.instanceId !== incoming.instanceId || current.stateDirectory !== incoming.stateDirectory) return incoming
  const next = { ...incoming, enabled: current.enabled, executablePath: current.executablePath, harnessPath: current.harnessPath }
  if (current.model === undefined) delete next.model
  else next.model = current.model
  return next
}
