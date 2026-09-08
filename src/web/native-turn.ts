/** Per-turn native activity container for the Chat transcript.
 *
 * Matches only standard turn/start and turn/end session events: no custom
 * Core event is written or required. Each turn owns one container node whose
 * display window is derived from the loaded Chat timeline (public
 * uiConversation binding, target "chat"): partition native rows by firstSeenAt
 * against loaded turn starts so gaps and trailing records never vanish when
 * the next turn loads. The node body reads the plugin-owned activity/read RPC
 * through a session-scoped shared store; Core session logs stay untouched.
 */
import type {
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AntigravityToolRowData } from './native-activity.js'

/** One turn's native activity window: turn/end wall clock while the turn is open. */
export interface AntigravityNativeTurn {
  readonly turn: number
  /** turn/start wall clock, unix epoch milliseconds. */
  readonly startMs: number
  /** turn/end wall clock, unix epoch milliseconds; null while the turn is open. */
  readonly endMs: number | null
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Per-turn native tool container: windowed sidecar rows, never DSH tool calls. */
    'antigravity-native': AntigravityNativeTurn
  }
}

/** Folded row definition registered on the Chat conversation target. */
export const nativeTurnDefinition: ConversationNodeDefinition<AntigravityNativeTurn> = {
  kind: 'antigravity-native',
  target: 'chat',
  match: event => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('Antigravity native turn starts on turn/start')
    void context
    return { turn: match.event.data.turn, startMs: match.event.time, endMs: null }
  },
  update: (context, match) => match.event.type === 'turn/end'
    ? { ...context.state, endMs: match.event.time }
    : context.state,
  publication: () => 'immediate',
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'antigravity-native',
      id: context.id,
      target: 'chat',
      anchorSeq: anchorOf(context),
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    }
  },
}

/** One loaded turn start in timeline order. */
export interface TurnStart {
  readonly turn: number
  readonly startMs: number
}

/** Next loaded turn start after the current turn, or null when current is last/unknown.
 * @param orderedStarts - Loaded turn starts in timeline order.
 * @param currentTurn - Turn number owning the querying container.
 * @returns Next start wall clock, or null.
 */
export function nextStartMs(orderedStarts: readonly TurnStart[], currentTurn: number): number | null {
  const index = orderedStarts.findIndex(item => item.turn === currentTurn)
  if (index < 0) return null
  return orderedStarts[index + 1]?.startMs ?? null
}

/** Whether a row is owned by its turn's actual Core window (vs recorded between turns).
 * @param firstSeenMs - Row firstSeenAt wall clock.
 * @param startMs - Owning turn/start wall clock.
 * @param endMs - Owning turn/end wall clock, or null for the open turn.
 * @returns True when the row falls inside Core [start, end).
 */
export function isOwnedByTurn(firstSeenMs: number, startMs: number, endMs: number | null): boolean {
  if (!Number.isFinite(firstSeenMs) || !Number.isFinite(startMs)) return false
  if (firstSeenMs < startMs) return false
  return endMs === null || firstSeenMs < endMs
}

/** Rows partitioned to one turn by loaded starts, oldest first.
 * Later tool updates do not move a row into another turn (callers pass
 * firstSeenAt-derived rows). The earliest loaded turn may include earlier
 * records (explicitly unassigned); each following turn takes
 * [start, nextStart); the last turn is unbounded to now. Gaps and trailing
 * records therefore never vanish, and loading the next turn re-partitions
 * without duplicates.
 * @param rows - Folded session rows in seq order.
 * @param startMs - Owning turn/start wall clock.
 * @param nextStartMsValue - Next loaded turn/start wall clock, or null for last/unknown.
 * @param nowMs - Now for the open-ended window; defaults to the wall clock.
 * @param includeEarlier - True for the earliest loaded turn: include records before startMs.
 * @returns The owning turn's rows.
 */
export function rowsForTurnWindow<T extends { readonly firstSeenAt: string }>(
  rows: readonly T[],
  startMs: number,
  nextStartMsValue: number | null,
  nowMs: number = Date.now(),
  includeEarlier = false,
): readonly T[] {
  return rows.filter(row => {
    const ms = Date.parse(row.firstSeenAt)
    if (!Number.isFinite(ms)) return false
    if (!includeEarlier && ms < startMs) return false
    if (nextStartMsValue !== null) return ms < nextStartMsValue
    return ms <= nowMs
  })
}

function anchorOf(context: ConversationNodeContext<AntigravityNativeTurn>): number {
  const seq = context.start?.event.seq ?? context.matches[0]?.event.seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : 0
}
