/** Fold plugin-owned native tool history into transcript rows.
 *
 * Browser-safe fold over the activity sidecar: one row per native tool launch,
 * oldest first, plus first observations and thought/text rows. A launch
 * completion (or failure) is the launch tool's own outcome; it never claims a
 * child outcome, and no row is ever inferred from thought text. Reuses the
 * canonical fold, so display state cannot drift from durable state.
 *
 * The subscription retains one fold and one Activity sequence cursor per
 * connection and session: it pages from Activity sequence cursor 0, then
 * requests only records after its cursor. Epoch, row routing, and text merging
 * survive page boundaries. An Activity stale cursor resets to 0 and pages
 * again. A backlog deeper than one poll's page budget continues on the next
 * poll instead of transferring the whole history.
 */
import {
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_REQUEST_TELEMETRY,
  ANTIGRAVITY_USAGE_SNAPSHOTS,
  ANTIGRAVITY_AGENT_OBSERVED,
  ANTIGRAVITY_AGENT_TEXT,
  ANTIGRAVITY_USER_QUESTION_ANSWER,
  type AntigravityToolOwnership,
  ANTIGRAVITY_TOOL_START,
  foldAntigravityToolEvent,
  type AntigravityToolState,
} from '../tool-events.js'
import { callAcpSettingsRpc } from '../client-contract.js'
import {
  ACTIVITY_READ_AFTER_ENDPOINT,
  ACTIVITY_STALE_CURSOR,
  ANTIGRAVITY_FULL_ACCESS_AUTHORIZED,
  decodeActivityPage,
  type AntigravityActivityPage,
  type AntigravityActivityRecord,
} from '../activity-contract.js'
import {
  getNativeHistoryStore as getRetainedNativeHistoryStore,
  StaleNativeHistoryCursorError,
  type NativeHistoryAdapter,
  type NativeHistoryStore,
} from '@deepseek-ai/dsh-acp-provider/native-history'
export { NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES, NATIVE_HISTORY_POLL_MS } from '@deepseek-ai/dsh-acp-provider/native-history'

/** One folded row: stable key, display state, and last-event time. */
export interface AntigravityToolRowData {
  readonly key: string
  readonly epoch: number
  readonly state: AntigravityToolState
  readonly time: string
  readonly firstSeenAt: string
}

/** Retained fold row: display state updates in place as later records arrive. */
export interface NativeActivityRow {
  readonly key: string
  readonly epoch: number
  state: AntigravityToolState
  time: string
  readonly firstSeenAt: string
}

export interface AntigravityAgentData {
  readonly key: string
  readonly epoch: number
  readonly firstSeenAt: string
  readonly ownership: AntigravityToolOwnership
}

/** Sidecar thought/text row, parent or child. */
export interface AntigravityAgentTextRow {
  readonly key: string
  readonly epoch: number
  readonly firstSeenAt: string
  readonly trajectoryId: string
  readonly parentTrajectoryId?: string
  readonly kind: 'text' | 'thought'
  readonly text: string
}

/** Retained text row: adjacent same-key deltas append in place across pages. */
export interface NativeActivityTextRow {
  readonly key: string
  readonly epoch: number
  readonly firstSeenAt: string
  readonly trajectoryId: string
  readonly parentTrajectoryId?: string
  readonly kind: 'text' | 'thought'
  text: string
}

/** Fold state retained across incremental pages and replaced when paging from Activity sequence cursor 0. */
export interface NativeActivityFoldState {
  readonly rows: NativeActivityRow[]
  readonly indexById: Map<string, number>
  readonly agents: Map<string, AntigravityAgentData>
  readonly texts: NativeActivityTextRow[]
  epoch: number
}

/** Empty fold state for a new retained fold; epoch 0 until the first session-ready record.
 * @returns Mutable fold state owned by one subscription.
 */
export function createNativeActivityFoldState(): NativeActivityFoldState {
  return { rows: [], indexById: new Map(), agents: new Map(), texts: [], epoch: 0 }
}

/** Apply decoded records in seq order to retained fold state.
 * The caller keeps records ordered; rows, agents, and text merge into that state, so
 * an incremental page behaves exactly like the same records in a full history.
 * @param state - State retained across pages.
 * @param records - Decoded records continuing after the state's last record.
 * @returns The same state, updated.
 */
export function applyActivityRecords(state: NativeActivityFoldState, records: readonly AntigravityActivityRecord[]): NativeActivityFoldState {
  for (const record of records) {
    if (record.type === ANTIGRAVITY_SESSION_READY) {
      state.epoch += 1
      continue
    }
    if (record.type === ANTIGRAVITY_AGENT_OBSERVED) {
      const key = `${state.epoch}\n${record.data.trajectoryId}`
      if (!state.agents.has(key)) state.agents.set(key, { key: String(record.seq), epoch: state.epoch, firstSeenAt: record.time, ownership: record.data })
      continue
    }
    if (record.type === ANTIGRAVITY_AGENT_TEXT) {
      const last = state.texts.at(-1)
      if (last !== undefined && last.epoch === state.epoch && last.kind === record.data.kind && last.trajectoryId === record.data.trajectoryId && last.parentTrajectoryId === record.data.parentTrajectoryId) {
        last.text += record.data.text
        continue
      }
      state.texts.push({
        key: String(record.seq),
        epoch: state.epoch,
        firstSeenAt: record.time,
        trajectoryId: record.data.trajectoryId,
        ...(record.data.parentTrajectoryId === undefined ? {} : { parentTrajectoryId: record.data.parentTrajectoryId }),
        kind: record.data.kind,
        text: record.data.text,
      })
      continue
    }
    if (record.type === ANTIGRAVITY_USER_QUESTION_ANSWER || record.type === ANTIGRAVITY_FULL_ACCESS_AUTHORIZED || record.type === ANTIGRAVITY_REQUEST_TELEMETRY || record.type === ANTIGRAVITY_USAGE_SNAPSHOTS) continue
    // Native tool ids can repeat across startups: the (epoch, tool id) pair only
    // routes updates, while every new row keys on its record seq, so ids
    // containing newlines can never collide.
    const id = String(state.epoch) + '\n' + record.data.toolId
    if (record.type === ANTIGRAVITY_TOOL_START) {
      state.indexById.set(id, state.rows.length)
      state.rows.push({ key: String(record.seq), epoch: state.epoch, state: record.data, time: record.time, firstSeenAt: record.time })
      continue
    }
    const index = state.indexById.get(id)
    if (index === undefined) {
      state.indexById.set(id, state.rows.length)
      state.rows.push({
        key: String(record.seq),
        epoch: state.epoch,
        state: foldAntigravityToolEvent(undefined, { type: record.type, data: record.data }),
        time: record.time,
        firstSeenAt: record.time,
      })
      continue
    }
    const current = state.rows[index]
    if (current === undefined) continue
    current.state = foldAntigravityToolEvent(current.state, { type: record.type, data: record.data })
    current.time = record.time
  }
  return state
}

/** Rows a snapshot exposes: unowned pending previews remain in the fold until native execution supplies their placement.
 * @param rows - Retained fold rows, including rows the transcript must not show yet.
 * @returns The visible subset, in fold order.
 */
export function visibleActivityRows(rows: readonly AntigravityToolRowData[]): readonly AntigravityToolRowData[] {
  return rows.filter(row => row.state.status !== 'pending' || row.state.ownership !== undefined)
}

/** Fold first observations independently of tool launches, including zero-tool children.
 * @param records - Decoded sidecar history in sequence order.
 * @returns Agent observations scoped to native runtime epochs.
 */
export function foldAgentRecords(records: readonly AntigravityActivityRecord[]): AntigravityAgentData[] {
  return [...applyActivityRecords(createNativeActivityFoldState(), records).agents.values()]
}

/** Fold sidecar thought/text records in sequence order, coalescing adjacent
 * same-kind deltas on one trajectory.
 * @param records - Decoded sidecar history.
 * @returns Text rows scoped to native runtime epochs.
 */
export function foldAgentTextRecords(records: readonly AntigravityActivityRecord[]): AntigravityAgentTextRow[] {
  return applyActivityRecords(createNativeActivityFoldState(), records).texts
}

/** Fold history records into display rows, oldest first.
 * @param records - Decoded history records in seq order.
 * @returns Display rows, oldest first, keyed by record seq.
 */
export function foldActivityRecords(records: readonly AntigravityActivityRecord[]): readonly AntigravityToolRowData[] {
  return visibleActivityRows(applyActivityRecords(createNativeActivityFoldState(), records).rows)
}

/** Minimal RPC face the transcript container needs: logical-channel call with caller cancellation. */
export interface ActivityRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
    readonly ok: boolean
    readonly value?: unknown
    readonly error?: { readonly code?: string; readonly message: string }
  }>
}

/** Read one bounded page strictly after the retained cursor. */
async function loadActivityPage(rpc: ActivityRpc, sessionId: string, afterSeq: number, signal: AbortSignal): Promise<AntigravityActivityPage> {
  const result = await callAcpSettingsRpc(rpc, ACTIVITY_READ_AFTER_ENDPOINT, { sessionId, afterSeq }, signal)
  if (!result.ok) {
    const message = result.error?.message ?? 'Antigravity activity history is unavailable'
    if (result.error?.code === ACTIVITY_STALE_CURSOR) throw new StaleNativeHistoryCursorError(message)
    throw new Error(message)
  }
  return decodeActivityPage(result.value, afterSeq)
}

/** Snapshot shared by every mounted turn container in one session. */
export interface NativeHistorySnapshot {
  readonly rows: readonly AntigravityToolRowData[]
  readonly agents: readonly AntigravityAgentData[]
  readonly texts: readonly AntigravityAgentTextRow[]
  readonly error?: string
}

function snapshotOf(state: NativeActivityFoldState, error?: string): NativeHistorySnapshot {
  return {
    rows: visibleActivityRows(state.rows),
    agents: [...state.agents.values()],
    texts: state.texts.slice(),
    ...(error === undefined ? {} : { error }),
  }
}

/** Session-scoped retained subscription over bounded native history pages. */
export function getNativeHistoryStore(rpc: ActivityRpc, sessionId: string): NativeHistoryStore<NativeHistorySnapshot> {
  const adapter: NativeHistoryAdapter<AntigravityActivityRecord, NativeActivityFoldState, NativeHistorySnapshot> = {
    load: (cursor, signal) => loadActivityPage(rpc, sessionId, cursor, signal),
    createState: createNativeActivityFoldState,
    apply: applyActivityRecords,
    snapshot: snapshotOf,
  }
  return getRetainedNativeHistoryStore(rpc, sessionId, adapter)
}
