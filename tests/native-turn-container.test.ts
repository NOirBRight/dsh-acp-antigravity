/**
 * Lifecycle regression for the session-scoped native history subscription.
 *
 * Scope honesty: the real getNativeHistoryStore runs against a fake RPC face
 * with fake timers (no React stand-ins, no mounted browser). Partitioning and
 * ownership use the real rowsForTurnWindow/isOwnedByTurn pure functions, so
 * serial polling, abort, retry, late-after-end stability, next-turn ownership
 * and the actual 185-row gap shape are proven at the unit level; mounted
 * browser placement is verified separately on a live GUI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANTIGRAVITY_TOOL_START, ANTIGRAVITY_TOOL_UPDATE } from '../src/tool-events.js'
import type { AntigravityActivityRecord } from '../src/activity-contract.js'
import { getNativeHistoryStore } from '../src/web/native-activity.js'
import { isOwnedByTurn, rowsForTurnWindow } from '../src/web/native-turn.js'

const T0 = '2026-09-07T03:38:25.046Z'
const T1 = '2026-09-07T03:38:27.884Z'

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Native history shared subscription', () => {
  it('polls serially with one flight per session no matter how many turns mount', async () => {
    const rpc = { call: vi.fn().mockImplementation(() => new Promise(() => {})) }
    const store = getNativeHistoryStore(rpc, 'session-serial-poll')
    const seen: number[][] = []
    const un1 = store.subscribe(() => { seen.push([store.getSnapshot().rows.length]) })
    const un2 = store.subscribe(() => {})
    try {
      expect(rpc.call).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5_000)
      // Second tick fires while the first flight is still pending: still one call.
      expect(rpc.call).toHaveBeenCalledTimes(1)
      expect(seen.length).toBe(0)
    } finally {
      un1()
      un2()
    }
  })

  it('aborts the in-flight read on last unsubscribe without a stale publish', async () => {
    let captured: AbortSignal | undefined
    const rpc = {
      call: vi.fn().mockImplementation((_c: string, _e: string, _p: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        captured = signal
        signal?.addEventListener('abort', () => { reject(signal.reason) })
      })),
    }
    const store = getNativeHistoryStore(rpc, 'session-abort-unsub')
    const seen: number[] = []
    const un = store.subscribe(() => { seen.push(store.getSnapshot().rows.length) })
    expect(rpc.call).toHaveBeenCalledTimes(1)
    un()
    expect(captured?.aborted).toBe(true)
    await flush()
    expect(seen).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(rpc.call).toHaveBeenCalledTimes(1)
  })

  it('retry refresh re-reads after a loader failure and clears the error', async () => {
    const failRecord: AntigravityActivityRecord = { seq: 3, time: T1, type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'tool-9', status: 'failed', error: 'boom' } }
    const good = {
      version: 1,
      records: [
        { seq: 1, time: T0, type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
        { seq: 2, time: T1, type: ANTIGRAVITY_TOOL_START, data: { toolId: 'tool-1', name: 'Read', status: 'running' } },
        failRecord,
      ],
    }
    let calls = 0
    const rpc = {
      call: vi.fn().mockImplementation(() => {
        calls += 1
        return calls === 1
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ ok: true, value: good })
      }),
    }
    const store = getNativeHistoryStore(rpc, 'session-retry-refresh')
    const un = store.subscribe(() => {})
    try {
      await flush()
      expect(store.getSnapshot().error).toBe('boom')
      expect(store.getSnapshot().rows).toHaveLength(0)
      store.refresh()
      await flush()
      expect(rpc.call).toHaveBeenCalledTimes(2)
      expect(store.getSnapshot().error).toBeUndefined()
      expect(store.getSnapshot().rows).toHaveLength(2)
    } finally {
      un()
    }
  })

  it('refresh during a pending read restarts instead of stalling', async () => {
    const pending: { resolve: (v: unknown) => void, signal: AbortSignal | undefined }[] = []
    const good = {
      version: 1,
      records: [
        { seq: 1, time: T0, type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
        { seq: 2, time: T1, type: ANTIGRAVITY_TOOL_START, data: { toolId: 'tool-1', name: 'Read', status: 'running' } },
      ],
    }
    const rpc = {
      call: vi.fn().mockImplementation((_c: string, _e: string, _p: unknown, signal?: AbortSignal) => new Promise(resolve => {
        pending.push({ resolve, signal })
      })),
    }
    const store = getNativeHistoryStore(rpc, 'session-refresh-inflight')
    const un = store.subscribe(() => {})
    try {
      expect(rpc.call).toHaveBeenCalledTimes(1)
      store.refresh()
      await flush()
      // The aborted first flight never settles the loop: the refresh flight starts at once.
      expect(rpc.call).toHaveBeenCalledTimes(2)
      pending[0]?.resolve({ ok: true, value: good })
      await flush()
      expect(store.getSnapshot().rows).toHaveLength(0)
      pending[1]?.resolve({ ok: true, value: good })
      await flush()
      expect(store.getSnapshot().rows).toHaveLength(1)
      expect(store.getSnapshot().error).toBeUndefined()
    } finally {
      un()
    }
  })

  it('resubscribe during a pending read restarts instead of stalling', async () => {
    const pending: { resolve: (v: unknown) => void }[] = []
    const good = {
      version: 1,
      records: [
        { seq: 1, time: T0, type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
        { seq: 2, time: T1, type: ANTIGRAVITY_TOOL_START, data: { toolId: 'tool-1', name: 'Read', status: 'running' } },
      ],
    }
    const rpc = {
      call: vi.fn().mockImplementation(() => new Promise(resolve => {
        pending.push({ resolve })
      })),
    }
    const store = getNativeHistoryStore(rpc, 'session-resub-inflight')
    const un1 = store.subscribe(() => {})
    expect(rpc.call).toHaveBeenCalledTimes(1)
    un1()
    const un2 = store.subscribe(() => {})
    try {
      expect(rpc.call).toHaveBeenCalledTimes(2)
      pending[0]?.resolve({ ok: true, value: good })
      await flush()
      expect(store.getSnapshot().rows).toHaveLength(0)
      pending[1]?.resolve({ ok: true, value: good })
      await flush()
      expect(store.getSnapshot().rows).toHaveLength(1)
    } finally {
      un2()
    }
  })

  it('keeps late results with their first-seen turn and excludes the next boundary', () => {
    const late = { key: 'late', state: { toolId: 'late', name: 'N', status: 'completed' as const }, time: new Date(2500).toISOString(), firstSeenAt: new Date(1100).toISOString() }
    const boundary = { key: 'next', state: { toolId: 'next', name: 'N', status: 'completed' as const }, time: new Date(2000).toISOString(), firstSeenAt: new Date(2000).toISOString() }
    expect(rowsForTurnWindow([late, boundary], 1000, 2000, 3000, true).map(item => item.key)).toEqual(['late'])
    expect(rowsForTurnWindow([late, boundary], 2000, 3000, 3000, false).map(item => item.key)).toEqual(['next'])
  })

  it('shows gaps and trailing as unattributed without loss across next-turn re-partition', () => {
    const gap = { key: '25', state: { toolId: 't', name: 'N', status: 'completed' as const }, time: '2026-09-07T03:39:05.454Z', firstSeenAt: '2026-09-07T03:39:05.454Z' }
    const inTurn = { key: 'in', state: { toolId: 'u', name: 'N', status: 'completed' as const }, time: '2026-09-07T03:45:49.568Z', firstSeenAt: '2026-09-07T03:45:49.568Z' }
    const trailing = { key: 'trail', state: { toolId: 'v', name: 'N', status: 'completed' as const }, time: '2026-09-07T03:53:10.000Z', firstSeenAt: '2026-09-07T03:53:10.000Z' }
    const all = [gap, inTurn, trailing]
    const first = rowsForTurnWindow(all, 1788752300312, 1788752617150, 1788753181615, true)
    const second = rowsForTurnWindow(all, 1788752617150, null, 1788753181615 + 60_000, false)
    expect(first.map(item => item.key)).toEqual(['25'])
    expect(second.map(item => item.key)).toEqual(['in', 'trail'])
    expect(isOwnedByTurn(Date.parse(gap.firstSeenAt), 1788752300312, 1788752345412)).toBe(false)
    expect(isOwnedByTurn(Date.parse(inTurn.firstSeenAt), 1788752617150, 1788753181615)).toBe(true)
    expect(isOwnedByTurn(Date.parse(trailing.firstSeenAt), 1788752617150, 1788753181615)).toBe(false)
    expect(new Set([...first, ...second].map(item => item.key)).size).toBe(3)
  })

  it('keeps all 185 sidecar rows with no overlap when the next turn loads', () => {
    const base = Date.parse('2026-09-07T03:38:27.884Z')
    const mk = (index: number): { key: string, state: { toolId: string, name: string, status: 'completed' }, time: string, firstSeenAt: string } => {
      const at = new Date(base + index * 1000).toISOString()
      return { key: String(index), state: { toolId: String(index), name: 'N', status: 'completed' }, time: at, firstSeenAt: at }
    }
    const rows = Array.from({ length: 185 }, (_, index) => mk(index))
    const split = Date.parse('2026-09-07T03:43:37.150Z')
    const first = rowsForTurnWindow(rows, base, split, split, true)
    const second = rowsForTurnWindow(rows, split, null, base + 185 * 1000 + 60_000, false)
    expect(first.length + second.length).toBe(185)
    expect(new Set([...first, ...second].map(item => item.key)).size).toBe(185)
  })
})
