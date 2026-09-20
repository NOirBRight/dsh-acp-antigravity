import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_ENDPOINT,
  ACTIVITY_READ_AFTER_ENDPOINT,
  ACTIVITY_SCHEMA_VERSION,
  ACTIVITY_STALE_CURSOR,
  decodeActivityHistory,
  decodeActivityPage,
} from '../src/activity-contract.js'
import {
  NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES,
  NATIVE_HISTORY_POLL_MS,
  applyActivityRecords,
  createNativeActivityFoldState,
  foldActivityRecords,
  foldAgentRecords,
  foldAgentTextRecords,
  getNativeHistoryStore,
  type ActivityRpc,
} from '../src/web/native-activity.js'

const SESSION = 'session-1'

type Reply = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
type SeqRecord = { readonly seq: number }

function afterSeqOf(payload: unknown): number {
  return typeof payload === 'object' && payload !== null && typeof (payload as { afterSeq?: unknown }).afterSeq === 'number'
    ? (payload as { afterSeq: number }).afterSeq
    : -1
}

function rpcFace(reply: (endpoint: string, payload: unknown) => Reply): { rpc: ActivityRpc; calls: Array<{ endpoint: string; payload: unknown }> } {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const rpc: ActivityRpc = {
    call: async (_channel, endpoint, payload) => {
      calls.push({ endpoint, payload })
      return reply(endpoint, payload)
    },
  }
  return { rpc, calls }
}

function at(seq: number): string {
  return new Date(Date.UTC(2026, 8, 19, 0, 0, 0, seq)).toISOString()
}

const ready = (seq: number): SeqRecord => ({ seq, time: at(seq), type: 'antigravity/session-ready', data: { provider: 'antigravity' } }) as SeqRecord
const start = (seq: number, toolId: string, ownership?: unknown): SeqRecord => ({ seq, time: at(seq), type: 'antigravity/tool-start', data: { toolId, name: 'shell', status: 'pending', ...(ownership === undefined ? {} : { ownership }) } }) as SeqRecord
const update = (seq: number, toolId: string, status: string, ownership?: unknown): SeqRecord => ({ seq, time: at(seq), type: 'antigravity/tool-update', data: { toolId, status, ...(ownership === undefined ? {} : { ownership }) } }) as SeqRecord
const text = (seq: number, value: string, kind: 'text' | 'thought' = 'thought'): SeqRecord => ({ seq, time: at(seq), type: 'antigravity/agent-text', data: { trajectoryId: 'traj-1', kind, text: value } }) as SeqRecord

const owned = { trajectoryId: 'traj-1' }
const page = (records: readonly unknown[], nextCursor: number, hasMore: boolean): Reply => ({ ok: true, value: { version: 1, records, nextCursor, hasMore } })
const stale = (): Reply => ({ ok: false, error: { code: ACTIVITY_STALE_CURSOR, message: 'Antigravity activity cursor is stale; the history must be reloaded.' } })
const forbiddenFullRead = (): Reply => ({ ok: false, error: { code: 'internal', message: 'full read is forbidden in this test' } })

function pageFrom(records: readonly SeqRecord[], afterSeq: number, limit = records.length): Reply {
  const slice = records.filter(record => record.seq > afterSeq).slice(0, limit)
  const nextCursor = slice.at(-1)?.seq ?? afterSeq
  const hasMore = records.some(record => record.seq > nextCursor)
  return page(slice, nextCursor, hasMore)
}

function pagingFace(initial: readonly SeqRecord[], limit = initial.length) {
  const records = [...initial]
  const { rpc, calls } = rpcFace((endpoint, payload) => {
    if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
    return pageFrom(records, afterSeqOf(payload), limit)
  })
  return { rpc, calls, records }
}

/** Drain the promise chain a poll schedules; no timers involved. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()
}

/** Run the next poll: the store schedules it one poll interval ahead. */
async function pollAgain(): Promise<void> {
  await vi.advanceTimersByTimeAsync(NATIVE_HISTORY_POLL_MS)
  await settle()
}

describe('native history subscription', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('pages from Activity sequence cursor 0, then transfers only records after the cursor', async () => {
    const { rpc, calls, records } = pagingFace([ready(1), start(2, 't1', owned)])
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    expect(store.getSnapshot().rows.map(row => row.key)).toEqual(['2'])

    records.push(update(3, 't1', 'completed', owned))
    await pollAgain()
    expect(store.getSnapshot().rows.map(row => [row.key, row.state.status])).toEqual([['2', 'completed']])
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT).map(call => call.payload)).toEqual([
      { sessionId: SESSION, afterSeq: 0 },
      { sessionId: SESSION, afterSeq: 2 },
    ])
  })

  it('keeps snapshot identity while a poll returns no new records', async () => {
    const { rpc } = pagingFace([ready(1), start(2, 't1', owned)])
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    const first = store.getSnapshot()
    await pollAgain()
    await pollAgain()
    expect(store.getSnapshot()).toBe(first)
  })

  it('retains pending unowned rows and reveals them at their original key once owned', async () => {
    const { rpc, records } = pagingFace([ready(1), start(2, 't1')])
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    // Unowned pending previews stay out of the transcript but never leave the fold.
    expect(store.getSnapshot().rows).toEqual([])

    records.push(update(3, 't1', 'running', owned))
    await pollAgain()
    expect(store.getSnapshot().rows.map(row => [row.key, row.state.status])).toEqual([['2', 'running']])
  })

  it('carries epoch and text merging across page boundaries', async () => {
    const { rpc } = rpcFace((endpoint, payload) => {
      if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
      const afterSeq = afterSeqOf(payload)
      if (afterSeq === 0) return page([ready(1), text(2, 'a')], 2, true)
      if (afterSeq === 2) return page([text(3, 'b'), text(4, 'c', 'text'), ready(5), text(6, 'd'), start(7, 't2', owned)], 7, false)
      return page([], afterSeq, false)
    })
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    const snapshot = store.getSnapshot()
    // Adjacent same-kind deltas merge across the page boundary; a new kind and a new
    // epoch each start their own row.
    expect(snapshot.texts.map(row => [row.key, row.epoch, row.kind, row.text])).toEqual([
      ['2', 1, 'thought', 'ab'],
      ['4', 1, 'text', 'c'],
      ['6', 2, 'thought', 'd'],
    ])
    expect(snapshot.rows.map(row => [row.key, row.epoch])).toEqual([['7', 2]])
  })

  it('follows bounded pages within one poll', async () => {
    const { rpc, calls } = rpcFace((endpoint, payload) => {
      if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
      const afterSeq = afterSeqOf(payload)
      if (afterSeq === 0) return page([ready(1)], 1, true)
      if (afterSeq === 1) return page([start(2, 't1', owned)], 2, true)
      if (afterSeq === 2) return page([update(3, 't1', 'completed', owned)], 3, false)
      return page([], afterSeq, false)
    })
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    expect(store.getSnapshot().rows.map(row => [row.key, row.state.status])).toEqual([['2', 'completed']])
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT)).toHaveLength(3)
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
  })

  it('pages from Activity sequence cursor 0 again after an Activity stale cursor', async () => {
    let wave = 1
    const { rpc, calls } = rpcFace((endpoint, payload) => {
      if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
      const afterSeq = afterSeqOf(payload)
      if (wave === 1 && afterSeq > 0) {
        wave = 2
        return stale()
      }
      if (wave === 2) return pageFrom([ready(1), start(2, 't9', owned), update(3, 't9', 'completed', owned)], afterSeq)
      return pageFrom([ready(1), start(2, 't1', owned)], afterSeq)
    })
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    expect(store.getSnapshot().rows.map(row => row.state.status)).toEqual(['pending'])
    await pollAgain()
    expect(store.getSnapshot().rows.map(row => [row.key, row.state.status])).toEqual([['2', 'completed']])
    expect(store.getSnapshot().error).toBeUndefined()
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT).map(call => afterSeqOf(call.payload))).toEqual([0, 2, 0])
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
  })

  it('continues paging on the next poll when the backlog exceeds the page budget', async () => {
    let seq = 0
    const { rpc, calls } = rpcFace(endpoint => {
      if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
      seq += 1
      return page([start(seq, 't' + String(seq), owned)], seq, true)
    })
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT)).toHaveLength(NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES)
    expect(store.getSnapshot().rows).toHaveLength(NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES)

    await pollAgain()
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT)).toHaveLength(NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES * 2)
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
    expect(store.getSnapshot().rows).toHaveLength(NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES * 2)
  })

  it('never requests a full read for a history deeper than one poll', async () => {
    const pageLimit = 3
    const total = NATIVE_HISTORY_MAX_FOLLOW_UP_PAGES * pageLimit + 2
    const records = [ready(1), ...Array.from({ length: total - 1 }, (_, index) => start(index + 2, 't' + String(index + 2), owned))]
    const { rpc, calls } = pagingFace(records, pageLimit)
    const store = getNativeHistoryStore(rpc, SESSION)
    const rowCounts: number[] = []
    store.subscribe(() => { rowCounts.push(store.getSnapshot().rows.length) })
    await settle()
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
    expect(store.getSnapshot().rows.length).toBeLessThan(total - 1)
    expect(store.getSnapshot().rows.length).toBeGreaterThan(0)
    expect(rowCounts[0]).toBeGreaterThan(0)

    await pollAgain()
    expect(store.getSnapshot().rows).toHaveLength(total - 1)
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
  })

  it('clears retained rows when an Activity stale cursor recovers an empty history', async () => {
    let wave = 1
    const { rpc, calls } = rpcFace((endpoint, payload) => {
      if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
      const afterSeq = afterSeqOf(payload)
      if (wave === 1 && afterSeq > 0) {
        wave = 2
        return stale()
      }
      if (wave === 2) return pageFrom([], afterSeq)
      return pageFrom([ready(1), start(2, 't1', owned)], afterSeq)
    })
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    expect(store.getSnapshot().rows.map(row => row.key)).toEqual(['2'])
    await pollAgain()
    expect(store.getSnapshot().rows).toEqual([])
    expect(store.getSnapshot().error).toBeUndefined()
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT).map(call => afterSeqOf(call.payload))).toEqual([0, 2, 0])
  })

  it('surfaces a failed read and recovers on refresh', async () => {
    let failing = true
    const { rpc, calls } = rpcFace((endpoint, payload) => {
      if (endpoint !== ACTIVITY_READ_AFTER_ENDPOINT) return forbiddenFullRead()
      if (failing) return { ok: false, error: { code: 'internal', message: 'Antigravity activity history is unavailable' } }
      return pageFrom([ready(1), start(2, 't1', owned)], afterSeqOf(payload))
    })
    const store = getNativeHistoryStore(rpc, SESSION)
    store.subscribe(() => undefined)
    await settle()
    expect(store.getSnapshot()).toMatchObject({ rows: [], error: 'Antigravity activity history is unavailable' })

    failing = false
    store.refresh()
    await settle()
    expect(store.getSnapshot().error).toBeUndefined()
    expect(store.getSnapshot().rows.map(row => row.key)).toEqual(['2'])
    expect(calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
    expect(calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT)).toHaveLength(2)
  })

  it('retains displayed history across session switches and resumes after its Activity sequence cursor', async () => {
    const { rpc, calls, records } = pagingFace([ready(1), start(2, 't1', owned), text(3, 'thinking')])
    const store = getNativeHistoryStore(rpc, SESSION)
    const unsubscribe = store.subscribe(() => undefined)
    await settle()
    const displayed = store.getSnapshot()
    unsubscribe()
    await pollAgain()
    expect(calls).toHaveLength(1)
    records.push(update(4, 't1', 'completed', owned), text(5, ' more'))

    const remounted = getNativeHistoryStore(rpc, SESSION)
    expect(remounted.getSnapshot()).toBe(displayed)
    const stop = remounted.subscribe(() => undefined)
    expect(remounted.getSnapshot()).toBe(displayed)
    await settle()
    expect(remounted.getSnapshot().rows.map(row => [row.key, row.state.status])).toEqual([['2', 'completed']])
    expect(remounted.getSnapshot().texts.map(row => row.text)).toEqual(['thinking more'])
    expect(calls.map(call => [call.endpoint, call.payload])).toEqual([
      [ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: SESSION, afterSeq: 0 }],
      [ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: SESSION, afterSeq: 3 }],
    ])
    stop()
  })

  it('retains the first page when navigation cancels the initial page cycle', async () => {
    let release: ((reply: Reply) => void) | undefined
    const held = new Promise<Reply>(resolve => { release = resolve })
    const cursors: number[] = []
    let pendingSignal: AbortSignal | undefined
    const rpc: ActivityRpc = {
      call: async (_channel, _endpoint, payload, signal) => {
        cursors.push(afterSeqOf(payload))
        if (cursors.length === 1) return page([ready(1), start(2, 't1', owned)], 2, true)
        if (cursors.length === 2) { pendingSignal = signal; return held }
        return page([], afterSeqOf(payload), false)
      },
    }
    const store = getNativeHistoryStore(rpc, SESSION)
    const stop = store.subscribe(() => undefined)
    await settle()
    const displayed = store.getSnapshot()
    expect(displayed.rows.map(row => row.key)).toEqual(['2'])
    stop()
    expect(pendingSignal?.aborted).toBe(true)
    const stopAgain = store.subscribe(() => undefined)
    expect(store.getSnapshot()).toBe(displayed)
    await settle()
    expect(cursors).toEqual([0, 2, 2])
    expect(store.getSnapshot().rows.map(row => row.key)).toEqual(['2'])
    release?.(page([update(3, 't1', 'completed', owned)], 3, false))
    await settle()
    expect(store.getSnapshot().rows.map(row => row.state.status)).toEqual(['pending'])
    stopAgain()
  })

  it('shares one poll across views and isolates another session', async () => {
    const { rpc, calls } = pagingFace([ready(1), start(2, 't1', owned)])
    const store = getNativeHistoryStore(rpc, SESSION)
    const stopFirst = store.subscribe(() => undefined)
    const stopSecond = getNativeHistoryStore(rpc, SESSION).subscribe(() => undefined)
    await settle()
    expect(calls).toHaveLength(1)
    expect(getNativeHistoryStore(rpc, 'other-session').getSnapshot().rows).toEqual([])
    stopFirst()
    await pollAgain()
    expect(calls).toHaveLength(2)
    stopSecond()
    await pollAgain()
    expect(calls).toHaveLength(2)
  })

  it('never applies an initial page superseded by unsubscribe', async () => {
    const calls: string[] = []
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    const rpc: ActivityRpc = {
      call: async (_channel, endpoint) => {
        calls.push(endpoint)
        if (calls.length === 1) await held
        return page([ready(1), start(2, 't1', owned)], 2, false)
      },
    }
    const store = getNativeHistoryStore(rpc, SESSION)
    const unsubscribe = store.subscribe(() => undefined)
    await settle()
    unsubscribe()
    release?.()
    await settle()
    // No page was accepted: the superseded response must not establish a fold.
    expect(store.getSnapshot().rows).toEqual([])

    store.subscribe(() => undefined)
    await settle()
    expect(calls).toEqual([ACTIVITY_READ_AFTER_ENDPOINT, ACTIVITY_READ_AFTER_ENDPOINT])
    expect(store.getSnapshot().rows.map(row => row.key)).toEqual(['2'])
  })

  it('gives a reconnecting connection its own pages from Activity sequence cursor 0', async () => {
    const first = pagingFace([ready(1), start(2, 't1', owned)])
    const second = pagingFace([ready(1), start(2, 't1', owned), update(3, 't1', 'completed', owned)])
    const store = getNativeHistoryStore(first.rpc, SESSION)
    const unsubscribe = store.subscribe(() => undefined)
    await settle()
    unsubscribe()

    const reconnected = getNativeHistoryStore(second.rpc, SESSION)
    reconnected.subscribe(() => undefined)
    await settle()
    expect(reconnected.getSnapshot().rows.map(row => [row.key, row.state.status])).toEqual([['2', 'completed']])
    expect(second.calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
    expect(first.calls.filter(call => call.endpoint === ACTIVITY_ENDPOINT)).toHaveLength(0)
    expect(second.calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT)).toHaveLength(1)
    expect(first.calls.filter(call => call.endpoint === ACTIVITY_READ_AFTER_ENDPOINT)).toHaveLength(1)
  })
})

describe('retained fold', () => {
  it('matches the pure full-history folds and keeps its rows in state', () => {
    const wire = [ready(1), start(2, 't1'), update(3, 't1', 'running', owned), text(4, 'a'), text(5, 'b')]
    const full = decodeActivityHistory({ version: ACTIVITY_SCHEMA_VERSION, records: wire }).records
    // The pure folds are thin wrappers over one retained reducer, so both paths agree.
    expect(foldActivityRecords(full).map(row => [row.key, row.state.status])).toEqual([['2', 'running']])
    expect(foldAgentTextRecords(full).map(row => row.text)).toEqual(['ab'])
    expect(foldAgentRecords(full)).toEqual([])

    const state = createNativeActivityFoldState()
    applyActivityRecords(state, decodeActivityPage({ version: ACTIVITY_SCHEMA_VERSION, records: wire.slice(0, 3), nextCursor: 3, hasMore: true }, 0).records)
    expect(state.rows.map(row => row.key)).toEqual(['2'])
    applyActivityRecords(state, decodeActivityPage({ version: ACTIVITY_SCHEMA_VERSION, records: wire.slice(3), nextCursor: 5, hasMore: false }, 3).records)
    expect(state.rows.map(row => row.key)).toEqual(['2'])
    expect(state.texts.map(row => row.text)).toEqual(['ab'])
  })
})
