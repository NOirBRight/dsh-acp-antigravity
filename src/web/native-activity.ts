/** Fold plugin-owned native tool history into transcript rows.
 *
 * Pure browser-safe fold over the activity/read sidecar: one row per native
 * tool launch, oldest first. A launch completion (or failure) is the launch
 * tool's own outcome; it never claims a child outcome, and no row is ever
 * inferred from thought text. Reuses the canonical fold, so display state
 * cannot drift from durable state.
 */
import {
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_AGENT_OBSERVED,
  type AntigravityToolOwnership,
  ANTIGRAVITY_TOOL_START,
  foldAntigravityToolEvent,
  type AntigravityToolState,
} from '../tool-events.js'
import { ACP_SETTINGS_RPC_CHANNEL } from '../client-contract.js'
import {
  ACTIVITY_ENDPOINT,
  ANTIGRAVITY_FULL_ACCESS_AUTHORIZED,
  decodeActivityHistory,
  type AntigravityActivityRecord,
} from '../activity-contract.js'

/** One folded row: stable key, display state, and last-event time. */
export interface AntigravityToolRowData {
  readonly key: string
  readonly epoch: number
  readonly state: AntigravityToolState
  readonly time: string
  readonly firstSeenAt: string
}

export interface AntigravityAgentData {
  readonly key: string
  readonly epoch: number
  readonly firstSeenAt: string
  readonly ownership: AntigravityToolOwnership
}

/** Fold first observations independently of tool launches, including zero-tool children.
 * @param records - Decoded sidecar history in sequence order.
 * @returns Agent observations scoped to native runtime epochs.
 */
export function foldAgentRecords(records: readonly AntigravityActivityRecord[]): AntigravityAgentData[] {
  const agents = new Map<string, AntigravityAgentData>()
  let epoch = 0
  for (const record of records) {
    if (record.type === ANTIGRAVITY_SESSION_READY) { epoch += 1; continue }
    if (record.type !== ANTIGRAVITY_AGENT_OBSERVED) continue
    const key = `${epoch}\n${record.data.trajectoryId}`
    if (!agents.has(key)) agents.set(key, { key: String(record.seq), epoch, firstSeenAt: record.time, ownership: record.data })
  }
  return [...agents.values()]
}

/** Minimal RPC face the transcript container needs: logical-channel call with caller cancellation. */
export interface ActivityRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
    readonly ok: boolean
    readonly value?: unknown
    readonly error?: { readonly message: string }
  }>
}

/** Fold history records into display rows, oldest first.
 * Native tool ids can repeat across startups: the (epoch, tool id) pair only
 * routes updates, while every new row keys on its record seq, so ids
 * containing newlines can never collide.
 * @param records - Decoded history records in seq order.
 * @returns Display rows, oldest first, keyed by record seq.
 */
export function foldActivityRecords(records: readonly AntigravityActivityRecord[]): readonly AntigravityToolRowData[] {
  const rows: { key: string; epoch: number; state: AntigravityToolState; time: string; firstSeenAt: string }[] = []
  const indexById = new Map<string, number>()
  let epoch = 0
  for (const record of records) {
    if (record.type === ANTIGRAVITY_SESSION_READY) {
      epoch += 1
      continue
    }
    if (record.type === ANTIGRAVITY_AGENT_OBSERVED || record.type === ANTIGRAVITY_FULL_ACCESS_AUTHORIZED) continue
    const id = String(epoch) + '\n' + record.data.toolId
    if (record.type === ANTIGRAVITY_TOOL_START) {
      indexById.set(id, rows.length)
      rows.push({ key: String(record.seq), epoch, state: record.data, time: record.time, firstSeenAt: record.time })
      continue
    }
    const index = indexById.get(id)
    if (index === undefined) {
      indexById.set(id, rows.length)
      rows.push({
        key: String(record.seq),
        epoch,
        state: foldAntigravityToolEvent(undefined, { type: record.type, data: record.data }),
        time: record.time,
        firstSeenAt: record.time,
      })
      continue
    }
    const current = rows[index]
    if (current === undefined) continue
    current.state = foldAntigravityToolEvent(current.state, { type: record.type, data: record.data })
    current.time = record.time
  }
  // Unowned pending previews remain in the approval UI until native execution supplies their placement.
  return rows.filter(row => row.state.status !== 'pending' || row.state.ownership !== undefined)
}

/** Read one session history over RPC and fold it into rows.
 * Throws fail-closed on transport failure or corrupt history; aborts
 * propagate so the caller can drop stale generations.
 * @param rpc - Logical-channel RPC face.
 * @param sessionId - DSH session scoping the sidecar read.
 * @param signal - Caller cancellation for a superseded session or unmount.
 * @returns Folded tools and observed agents for this session only.
 */
export async function loadActivityHistory(rpc: ActivityRpc, sessionId: string, signal?: AbortSignal): Promise<NativeHistorySnapshot> {
  const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, ACTIVITY_ENDPOINT, { sessionId }, signal)
  if (!result.ok) throw new Error(result.error?.message ?? 'Antigravity activity history is unavailable')
  const { records } = decodeActivityHistory(result.value)
  return { rows: foldActivityRecords(records), agents: foldAgentRecords(records) }
}

/** Poll interval for the session-scoped native history subscription. */
export const NATIVE_HISTORY_POLL_MS = 1000

/** Snapshot shared by every mounted turn container in one session. */
export interface NativeHistorySnapshot {
  readonly rows: readonly AntigravityToolRowData[]
  readonly agents: readonly AntigravityAgentData[]
  readonly error?: string
}

interface NativeHistoryEntry {
  snapshot: NativeHistorySnapshot
  listeners: Set<() => void>
  timer: ReturnType<typeof setTimeout> | undefined
  controller: AbortController | undefined
}

/** One entry per live connection and session: keying by the RPC face keeps
 * concurrent connections from sharing or resurrecting each other's history.
 * Entries are lightweight once unsubscribed (empty snapshot, no timer), so
 * React StrictMode remounts reuse them without holding full histories.
 */
const nativeHistoryStores = new WeakMap<ActivityRpc, Map<string, NativeHistoryEntry>>()

function entryFor(rpc: ActivityRpc, sessionId: string): NativeHistoryEntry {
  let bySession = nativeHistoryStores.get(rpc)
  if (bySession === undefined) {
    bySession = new Map()
    nativeHistoryStores.set(rpc, bySession)
  }
  let entry = bySession.get(sessionId)
  if (entry === undefined) {
    entry = { snapshot: { rows: [], agents: [] }, listeners: new Set(), timer: undefined, controller: undefined }
    bySession.set(sessionId, entry)
  }
  return entry
}

function notifyEntry(entry: NativeHistoryEntry): void {
  for (const listener of [...entry.listeners]) listener()
}

async function pollNativeHistory(sessionId: string, entry: NativeHistoryEntry, rpc: ActivityRpc): Promise<void> {
  if (entry.controller !== undefined || entry.listeners.size === 0) return
  const controller = new AbortController()
  entry.controller = controller
  try {
    const snapshot = await loadActivityHistory(rpc, sessionId, controller.signal)
    if (entry.controller !== controller) return
    entry.snapshot = snapshot
  } catch (caught) {
    if (entry.controller !== controller) return
    const message = caught instanceof Error ? caught.message : 'Antigravity activity history is unavailable'
    entry.snapshot = { ...entry.snapshot, error: message }
  } finally {
    if (entry.controller !== controller) return
    entry.controller = undefined
  }
  notifyEntry(entry)
  scheduleNativeHistory(sessionId, entry, rpc)
}

function scheduleNativeHistory(sessionId: string, entry: NativeHistoryEntry, rpc: ActivityRpc): void {
  if (entry.listeners.size === 0) return
  if (entry.timer !== undefined) return
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    void pollNativeHistory(sessionId, entry, rpc)
  }, NATIVE_HISTORY_POLL_MS)
}

/** Session-scoped abortable subscription over native history: one poll loop
 * per connection and session no matter how many turn containers mount, so
 * trailing records after a turn ends still arrive while any native view stays
 * mounted. Late tool updates never move rows (partition keys on firstSeenAt).
 * Refresh and resubscribe cancel the active read and start a new one, so a
 * superseded promise can never stall the loop. No new framework dependency:
 * plain subscribe/getSnapshot for useSyncExternalStore.
 * @param rpc - Logical-channel RPC face scoping the store lifetime.
 * @param sessionId - DSH session scoping the sidecar read.
 * @returns Shared subscribe/getSnapshot/refresh triple.
 */
export function getNativeHistoryStore(rpc: ActivityRpc, sessionId: string): {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => NativeHistorySnapshot
  readonly refresh: () => void
} {
  const entry = entryFor(rpc, sessionId)
  return {
    subscribe: (listener: () => void): (() => void) => {
      entry.listeners.add(listener)
      if (entry.listeners.size === 1) void pollNativeHistory(sessionId, entry, rpc)
      else scheduleNativeHistory(sessionId, entry, rpc)
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) {
          if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined }
          entry.controller?.abort()
          entry.controller = undefined
          entry.snapshot = { rows: [], agents: [] }
        }
      }
    },
    getSnapshot: (): NativeHistorySnapshot => entry.snapshot,
    refresh: (): void => {
      entry.controller?.abort()
      entry.controller = undefined
      if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined }
      if (entry.listeners.size > 0) void pollNativeHistory(sessionId, entry, rpc)
    },
  }
}
