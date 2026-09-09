/** Per-turn native tool container mounted in the Chat transcript.
 *
 * One instance per turn renders that turn's sidecar rows through the pure
 * row renderer. Display only: never a DSH tool-call block, so the loop
 * never executes native tools. Rows come from one session-scoped shared
 * history subscription, so trailing records after a turn ends still arrive
 * while any native view stays mounted; each container partitions by the
 * loaded Chat timeline (public uiConversation binding, target "chat") and
 * marks rows outside its actual Core window as unattributed.
 */
import React, { useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { InjectFace, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { getNativeHistoryStore, type ActivityRpc, type AntigravityToolRowData } from './native-activity.js'
import { isOwnedByTurn, nextStartMs, rowsForTurnWindow, type TurnStart } from './native-turn.js'
import { NativeActivityNode } from './NativeActivityNode.js'
import { groupNativeActivity } from './native-tree.js'
import type { AcpSettingsKey } from './locales.ts'

export interface NativeTurnFace {
  t: (key: AcpSettingsKey) => string
  conversationT: TranslateNS<'conversation'>
  rpc: ActivityRpc
  sessionId: SessionId
  uiConversation: UiConversation
}

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }
const head: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' }
const errorText: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' }
const EMPTY_NATIVE_ROWS: readonly AntigravityToolRowData[] = []

const retry: CSSProperties = {
  minHeight: 36, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, padding: '7px 10px',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', cursor: 'pointer', marginLeft: 8,
}

export function NativeTurnContainer(props: { readonly node: ChatNode<'antigravity-native'> } & InjectFace<NativeTurnFace>): ReactNode {
  const { turn, startMs, endMs } = props.node.data
  const chatSource: {
    readonly subscribe: (listener: () => void) => () => void
    readonly getSnapshot: () => ChatSnapshot | undefined
  } = useMemo(
    () => props.uiConversation.binding(props.sessionId).target('chat'),
    [props.uiConversation, props.sessionId],
  )
  const chatSnapshot = useSyncExternalStore(chatSource.subscribe, chatSource.getSnapshot)
  const historyStore = useMemo(
    () => getNativeHistoryStore(props.rpc, props.sessionId),
    [props.rpc, props.sessionId],
  )
  const history = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot)
  const orderedStarts: readonly TurnStart[] = useMemo(() => {
    const timeline = chatSnapshot?.timeline
    if (timeline === undefined) return []
    const out: TurnStart[] = []
    for (const item of timeline.turnOrder) {
      const ms = timeline.turns.get(item)?.start?.time
      if (typeof ms === 'number' && Number.isFinite(ms)) out.push({ turn: item, startMs: ms })
    }
    return out
  }, [chatSnapshot])
  const knownIndex = orderedStarts.findIndex(item => item.turn === turn)
  const followingStartMs = knownIndex >= 0 ? nextStartMs(orderedStarts, turn) : null
  const includeEarlier = knownIndex === 0
  const rows = useMemo(() => {
    // Fail closed while the turn is absent from the loaded timeline: guessing
    // an unbounded window would duplicate rows another container owns.
    if (knownIndex < 0) return EMPTY_NATIVE_ROWS
    return rowsForTurnWindow(history.rows, startMs, followingStartMs, Date.now(), includeEarlier)
  }, [history.rows, startMs, followingStartMs, includeEarlier, knownIndex])
  const branches = useMemo(() => groupNativeActivity(rows, knownIndex < 0 ? [] :
    rowsForTurnWindow(history.agents, startMs, followingStartMs, Date.now(), includeEarlier),
  knownIndex < 0 ? [] : rowsForTurnWindow(history.texts ?? [], startMs, followingStartMs, Date.now(), includeEarlier)),
  [rows, history.agents, history.texts, knownIndex, startMs, followingStartMs, includeEarlier])
  if (branches.length === 0 && history.error === undefined) return null
  const label = rows.length > 0
    ? props.t('activityTools').replace('{count}', String(rows.length))
    : undefined
  return <section data-antigravity-native-turn={turn} style={wrap}>
    {label === undefined ? null : <p style={head}>{label}</p>}
    {branches.map(branch => {
      const ms = Date.parse(branch.kind === 'tool' ? branch.row.firstSeenAt : branch.kind === 'text' ? branch.firstSeenAt : branch.firstSeenAt)
      const unattributed = !isOwnedByTurn(ms, startMs, endMs)
      return <React.Fragment key={branch.key}>
        {unattributed ? <p data-native-unattributed style={head}>{props.t('activityBetweenTurns')}</p> : null}
        <NativeActivityNode branch={branch} t={props.t} conversationT={props.conversationT} />
      </React.Fragment>
    })}
    {history.error === undefined ? null : <p role="alert" style={errorText}>{history.error}
      <button type="button" style={retry} onClick={() => { historyStore.refresh() }}>{props.t('activityRetry')}</button>
    </p>}
  </section>
}
