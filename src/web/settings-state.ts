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

/** Override flags one editor patch adds: the fields the user just set to a value.
 *
 * The editor reports only what changed, which is the single piece of edit evidence a
 * row outside the accepted snapshot has; a patch that clears a field sets no flag.
 * @param patch - the catalog patch handed to the card.
 * @returns flag names to merge into the row, or undefined when the patch set nothing.
 */
export function patchedOverrideFlags(patch: Readonly<Record<string, unknown>>): Record<string, boolean> | undefined {
  const flags: Record<string, boolean> = {}
  for (const field of ['name', 'vision', 'thinking', 'contextWindow', 'defaultEffort']) {
    if (patch[field] !== undefined) flags[field] = true
  }
  return Object.keys(flags).length === 0 ? undefined : flags
}

/** Name every catalog field the save payload must store as a user override.
 *
 * The payload replaces the stored override set, so a field is stored when either
 * of two things holds: the row differs from the snapshot it was edited from (a new
 * edit), or that snapshot already stored the field and the edit left it alone. The
 * second case is what keeps an earlier save from being cleared by any later save
 * the user makes without touching that field.
 *
 * Three states share one flag map, and only these meanings are supported:
 * `true` the field is stored as a user override; `false` the user restored it, so
 * it must not be stored; an absent key the field is untouched. A `true` the snapshot
 * does not corroborate stores nothing: the map is a client signal for actions, and
 * the snapshot is the only record of what was actually written.
 *
 * A row the baseline does not carry is either brand new or absent from the saved
 * membership. There the editor's `true` is the only evidence of a user edit, and a
 * value discovery supplied without one stays the catalog's: adopting a discovered
 * model must not freeze the facts it was built from. A caller with no snapshot at
 * all must not call this: it has nothing to compare against and keeps the row's own
 * flags instead.
 * @param model - the row about to be persisted.
 * @param baseline - the same row in the last accepted snapshot, or undefined when that snapshot does not carry it.
 * @returns fields to write, or undefined when the row stores no override.
 */
export function catalogOverrideFlags(model: AcpCatalogModel, baseline: AcpCatalogModel | undefined): Record<string, boolean> | undefined {
  const flags: Record<string, boolean> = {}
  const stored = baseline?.overrides ?? {}
  const store = (name: string, differs: boolean): void => {
    if (model.overrides?.[name] === false) return
    if (differs || stored[name] === true) flags[name] = true
  }
  /** A row the baseline lacks: the editor's own `true` is the only edit evidence. */
  const storeEdit = (name: string, source: string, differs: boolean): void => {
    if (baseline !== undefined) return store(name, differs)
    if (model.overrides?.[name] === true) return store(name, true)
    // Discovery supplied the value and nothing says the user changed it: storing it
    // would freeze a fact the catalog owns and block its later updates.
    if (model.sources?.[source] !== undefined) return
    store(name, differs)
  }
  // A name is never a discovery fact, so it is always the user's own.
  store('name', model.name !== baseline?.name)
  storeEdit('vision', 'vision', model.vision !== baseline?.vision)
  storeEdit('thinking', 'thinking', model.thinking !== baseline?.thinking)
  storeEdit('contextWindow', 'contextWindow', model.contextWindow !== baseline?.contextWindow)
  storeEdit('output', 'maxOutputTokens', model.maxOutputTokens !== baseline?.maxOutputTokens)
  storeEdit('defaultEffort', 'defaultEffort', model.reasoning?.defaultEffort !== baseline?.reasoning?.defaultEffort)
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
