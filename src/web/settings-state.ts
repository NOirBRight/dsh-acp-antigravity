/** Card state for the state-driven Settings UI. Derived only from the live snapshot row. */
import type { AcpCatalogModel, AcpSettingsRow } from '../client-contract.ts'

/** Visible installation and account setup step. */
export type AntigravityCardState = 'loading' | 'missing' | 'login' | 'connected'

/** How this Settings page is being reached. Google loopback only auto-completes on `local`. */
export type AntigravityAccessKind = 'local' | 'lan' | 'remote' | 'app'

/** Classify the browser that opened Settings. App WebView wins over hostname. */
export function antigravityAccessKind(hostname: string, userAgent = ''): AntigravityAccessKind {
  const ua = userAgent.toLowerCase()
  if (ua.includes('; wv)') || ua.includes('dsh-mobile') || ua.includes('dshmobile')) return 'app'
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return 'local'
  const parts = host.split('.')
  if (parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part))) {
    const octets = parts.map(Number)
    if (octets.every(n => n <= 255) && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31))) return 'lan'
  }
  return 'remote'
}

/** Locale key for the access-kind login hint. */
export function antigravityAccessHintKey(kind: AntigravityAccessKind): 'accessLocal' | 'accessLan' | 'accessRemote' | 'accessApp' {
  if (kind === 'local') return 'accessLocal'
  if (kind === 'lan') return 'accessLan'
  if (kind === 'app') return 'accessApp'
  return 'accessRemote'
}

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

/** Name every catalog field the save payload must store as a user override.
 *
 * The payload replaces the stored override set, so a field is stored when either
 * of two things holds: the row differs from the snapshot it was edited from (a new
 * edit), or that snapshot already stored the field and the edit left it alone. The
 * second case is what keeps an earlier save from being cleared by any later save
 * the user makes without touching that field.
 *
 * The row's own flags are a client-side signal, not storage: false means the user
 * restored the field to discovery, so the field is dropped instead of carried over.
 * @param model - the row about to be persisted.
 * @param baseline - the same row in the last accepted snapshot, absent for a row the user added.
 * @returns fields to write, or undefined when the row stores no override.
 */
export function catalogOverrideFlags(model: AcpCatalogModel, baseline: AcpCatalogModel | undefined): Record<string, boolean> | undefined {
  const flags: Record<string, boolean> = {}
  const stored = baseline?.overrides ?? {}
  const field = (name: string, differs: boolean): void => {
    if (model.overrides?.[name] === false) return
    if (differs || stored[name] === true) flags[name] = true
  }
  field('name', model.name !== baseline?.name)
  field('vision', model.vision !== baseline?.vision)
  field('thinking', model.thinking !== baseline?.thinking)
  field('contextWindow', model.contextWindow !== baseline?.contextWindow)
  field('output', model.maxOutputTokens !== baseline?.maxOutputTokens)
  field('defaultEffort', model.reasoning?.defaultEffort !== baseline?.reasoning?.defaultEffort)
  return Object.keys(flags).length === 0 ? undefined : flags
}

/** Merge live health/catalog data without overwriting unsaved configuration edits. */
export function mergeSettingsDraft(current: AcpSettingsRow | undefined, incoming: AcpSettingsRow | undefined, dirty: boolean): AcpSettingsRow | undefined {
  if (!dirty || current === undefined || incoming === undefined || current.instanceId !== incoming.instanceId || current.stateDirectory !== incoming.stateDirectory) return incoming
  const next = { ...incoming, enabled: current.enabled, executablePath: current.executablePath, harnessPath: current.harnessPath, models: current.models }
  if (current.model === undefined) delete next.model
  else next.model = current.model
  return next
}
