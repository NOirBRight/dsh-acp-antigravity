import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationNodeContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  isOwnedByTurn,
  nativeTurnDefinition,
  nextStartMs,
  rowsForTurnWindow,
  type AntigravityNativeTurn,
} from '../src/web/native-turn.js'
import type { AntigravityToolRowData } from '../src/web/native-activity.js'

function turnStart(seq: number, time: number, turn: number) {
  return { type: 'turn/start', seq: SessionSeq(seq), time, data: { turn } } as const
}

function turnEnd(seq: number, time: number, turn: number) {
  return { type: 'turn/end', seq: SessionSeq(seq), time, data: { turn, reason: { kind: 'completed' } } } as const
}

function stepStart(seq: number, time: number, turn: number) {
  return { type: 'step/start', seq: SessionSeq(seq), time, data: { turn, step: 1 } } as const
}

function context(state: AntigravityNativeTurn | undefined, startSeq: number) {
  const event = turnStart(startSeq, 1000, 3)
  return {
    key: 'antigravity-native:3',
    kind: 'antigravity-native',
    id: '3',
    matches: [{ event, role: 'start', location: { kind: 'unresolved' } }],
    start: { event, role: 'start', location: { kind: 'unresolved' } },
    state,
    current: new Map(),
  } as ConversationNodeContext<AntigravityNativeTurn>
}

function row(key: string, time: string): AntigravityToolRowData {
  return {
    key,
    epoch: 1,
    state: { toolId: key, name: 'N', status: 'completed' },
    time,
    firstSeenAt: time,
  }
}

describe('Antigravity native turn definition', () => {
  it('starts on turn/start and updates on turn/end only', () => {
    expect(nativeTurnDefinition.kind).toBe('antigravity-native')
    expect(nativeTurnDefinition.target).toBe('chat')
    expect(nativeTurnDefinition.match(turnStart(10, 1000, 3))).toEqual({ id: '3', role: 'start' })
    expect(nativeTurnDefinition.match(turnEnd(20, 2000, 3))).toEqual({ id: '3', role: 'update' })
    expect(nativeTurnDefinition.match(stepStart(11, 1100, 3))).toEqual({ id: '3', role: 'update' })
  })

  it('opens a window on start and closes it on end', () => {
    const event = turnStart(10, 1000, 3)
    const state = nativeTurnDefinition.start(context(undefined, 10), { event, role: 'start', location: { kind: 'unresolved' } }, { previous: () => undefined })
    expect(state).toEqual({ turn: 3, startMs: 1000, endMs: null })
    const end = turnEnd(20, 2000, 3)
    const closed = nativeTurnDefinition.update(
      { ...context(state, 10), state },
      { event: end, role: 'update', location: { kind: 'unresolved' } },
    )
    expect(closed).toEqual({ turn: 3, startMs: 1000, endMs: 2000 })
  })

  it('starts without retaining prior state; gaps partition by loaded starts', () => {
    const event = turnStart(32, 1788752617150, 2)
    const state = nativeTurnDefinition.start(context(undefined, 32), { event, role: 'start', location: { kind: 'unresolved' } }, { previous: () => undefined } as never)
    expect(state).toEqual({ turn: 2, startMs: 1788752617150, endMs: null })
  })

  it('partitions actual gap records without loss or duplicates', () => {
    const starts = [
      { turn: 1, startMs: 1788752300312 },
      { turn: 2, startMs: 1788752617150 },
    ]
    expect(nextStartMs(starts, 1)).toBe(1788752617150)
    expect(nextStartMs(starts, 2)).toBeNull()
    expect(nextStartMs(starts, 9)).toBeNull()
    // 42ms after turn1 end 1788752345412; two more before turn2 start.
    const gap1 = row('25', '2026-09-07T03:39:05.454Z')
    const gap2 = row('27', '2026-09-07T03:43:09.777Z')
    const gap3 = row('29', '2026-09-07T03:43:18.224Z')
    const inTurn = row('in', '2026-09-07T03:45:49.568Z')
    const trailing = row('trail', '2026-09-07T03:53:10.000Z')
    const all = [gap1, gap2, gap3, inTurn, trailing]
    const first = rowsForTurnWindow(all, 1788752300312, 1788752617150, 1788753181615, true)
    const second = rowsForTurnWindow(all, 1788752617150, null, 1788753181615 + 60_000, false)
    expect(first.map(item => item.key)).toEqual(['25', '27', '29'])
    expect(second.map(item => item.key)).toEqual(['in', 'trail'])
    // Ownership: gaps and trailing are explicitly unassigned, in-turn rows owned.
    expect(isOwnedByTurn(Date.parse(gap1.firstSeenAt), 1788752300312, 1788752345412)).toBe(false)
    expect(isOwnedByTurn(Date.parse(inTurn.firstSeenAt), 1788752617150, 1788753181615)).toBe(true)
    expect(isOwnedByTurn(Date.parse(trailing.firstSeenAt), 1788752617150, 1788753181615)).toBe(false)
  })

  it('keeps all 185 sidecar rows across two windows with no overlap', () => {
    const base = Date.parse('2026-09-07T03:38:27.884Z')
    const rows = Array.from({ length: 185 }, (_, index) => row(String(index), new Date(base + index * 1000).toISOString()))
    const split = Date.parse('2026-09-07T03:43:37.150Z')
    const first = rowsForTurnWindow(rows, base, split, split, true)
    const second = rowsForTurnWindow(rows, split, null, base + 185 * 1000 + 60_000, false)
    expect(first.length + second.length).toBe(185)
    expect(new Set([...first, ...second].map(item => item.key)).size).toBe(185)
  })

  it('rejects a non-start match at start and keeps state on other updates', () => {
    const event = turnEnd(20, 2000, 3)
    expect(() => nativeTurnDefinition.start(context(undefined, 10), { event, role: 'start', location: { kind: 'unresolved' } }, { previous: () => undefined })).toThrow()
    const state: AntigravityNativeTurn = { turn: 3, startMs: 1000, endMs: null }
    const step = stepStart(11, 1100, 3)
    expect(nativeTurnDefinition.update({ ...context(state, 10), state }, { event: step, role: 'update', location: { kind: 'unresolved' } })).toBe(state)
  })

  it('publishes immediately so the open turn stays live', () => {
    const event = turnStart(10, 1000, 3)
    expect(nativeTurnDefinition.publication?.({ event, role: 'start', location: { kind: 'unresolved' } })).toBe('immediate')
  })


  it('freezes the stream anchor on the first assistant chunk, not the final message', () => {
    const start = turnStart(10, 1000, 3)
    const step = stepStart(11, 1100, 3)
    const chunk = { type: 'assistant/chunk', seq: SessionSeq(12), time: 1200, data: { turn: 3 } } as const
    const later = { type: 'assistant/chunk', seq: SessionSeq(18), time: 1800, data: { turn: 3 } } as const
    const message = { type: 'assistant/message', seq: SessionSeq(20), time: 2000, data: { turn: 3 } } as const
    const loc = { kind: 'unresolved' as const }
    const ctx = {
      ...context({ turn: 3, startMs: 1000, endMs: 2000 }, 10),
      matches: [
        { event: start, role: 'start' as const, location: loc },
        { event: step, role: 'update' as const, location: loc },
        { event: chunk, role: 'update' as const, location: loc },
        { event: later, role: 'update' as const, location: loc },
        { event: message, role: 'update' as const, location: loc },
      ],
    }
    expect(nativeTurnDefinition.buildViewNode?.(ctx)).toMatchObject({ anchorSeq: 12 })
  })

  it('builds one chat node anchored at the turn start', () => {
    const state: AntigravityNativeTurn = { turn: 3, startMs: 1000, endMs: 2000 }
    const node = nativeTurnDefinition.buildViewNode?.(context(state, 10))
    expect(node).toMatchObject({
      key: 'antigravity-native:3',
      kind: 'antigravity-native',
      id: '3',
      target: 'chat',
      anchorSeq: 10,
      visibility: 'visible',
      data: state,
    })
    expect(nativeTurnDefinition.buildViewNode?.(context(undefined, 10))).toBeNull()
  })
})

describe('rowsForTurnWindow', () => {
  const rows = [row('1', '2026-09-07T03:38:27.884Z'), row('2', '2026-09-07T03:45:49.568Z')]

  it('keeps only rows first seen before the next loaded start', () => {
    expect(rowsForTurnWindow(rows, Date.parse('2026-09-07T03:38:00.000Z'), Date.parse('2026-09-07T03:40:00.000Z')).map(item => item.key)).toEqual(['1'])
  })

  it('leaves the last window unbounded to now', () => {
    const now = Date.parse('2026-09-07T03:40:00.000Z')
    expect(rowsForTurnWindow(rows, Date.parse('2026-09-07T03:38:00.000Z'), null, now).map(item => item.key)).toEqual(['1'])
    expect(rowsForTurnWindow(rows, Date.parse('2026-09-07T03:38:00.000Z'), null, Date.parse('2026-09-07T04:00:00.000Z'))).toHaveLength(2)
  })

  it('keeps late results with their original turn and excludes the next boundary', () => {
    const late = { ...row('late', new Date(1100).toISOString()), time: new Date(2500).toISOString() }
    const boundary = row('next', new Date(2000).toISOString())
    expect(rowsForTurnWindow([late, boundary], 1000, 2000).map(item => item.key)).toEqual(['late'])
    expect(rowsForTurnWindow([late, boundary], 2000, 3000).map(item => item.key)).toEqual(['next'])
  })

  it('drops rows with unparseable times', () => {
    expect(rowsForTurnWindow([row('9', 'not-a-time')], 0, null, 10).map(item => item.key)).toEqual([])
  })
})
