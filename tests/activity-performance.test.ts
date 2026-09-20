/** Deterministic performance regression harness for Antigravity native activity (#12).
 *
 * The reported workload was four concurrent sessions, thousands of appends, and
 * kilobyte-scale records, where every append re-read and re-decoded the whole
 * per-session JSONL history and blocked the event loop for seconds. This file
 * pins the fix with structural assertions first — how many records an append
 * decodes, how much the browser transfers per poll, how many records stay
 * buffered — and only then with generous wall-clock ceilings, so a slow CI box
 * cannot turn a regression test into a flake and a fast box cannot hide the
 * regression.
 *
 * `decodeActivityRecord` is the store's own decode seam, so counting its calls
 * counts the real O(history) work: the pre-fix append path spent one call per
 * historical line on every append, the bounded path spends none after the
 * one-time cursor initialization.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_ENDPOINT,
  ACTIVITY_PAGE_RECORD_LIMIT,
  ACTIVITY_READ_AFTER_ENDPOINT,
  ACTIVITY_SCHEMA_VERSION,
  ACTIVITY_STALE_CURSOR,
  decodeActivityHistory,
  decodeActivityPage,
} from '../src/activity-contract.js'
import { ACTIVITY_MAX_PENDING_RECORDS } from '../src/activity-coalescer.js'
import { AntigravityActivityStore, type AntigravityActivityEvent } from '../src/activity-store.js'
import { createAntigravityActivityWriter } from '../src/dsh-plugin.js'
import { createAcpSettingsRpcHandler, type AcpSettingsRpcDeps } from '../src/rpc.js'
import { foldAgentTextRecords } from '../src/web/native-activity.js'
import { ANTIGRAVITY_AGENT_TEXT, ANTIGRAVITY_TOOL_START } from '../src/tool-events.js'

/** Every decode the store performs, counted at the seam the store itself uses. */
const decodeCounter = vi.hoisted(() => ({ lines: 0 }))

vi.mock('../src/activity-contract.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/activity-contract.js')>()
  return {
    ...actual,
    decodeActivityRecord: (line: string, seq: number) => {
      decodeCounter.lines += 1
      return actual.decodeActivityRecord(line, seq)
    },
  }
})

/** Four concurrent native turns, as reported. */
const SESSIONS = ['session-a', 'session-b', 'session-c', 'session-d'] as const
/** Historical records primed per session before the measured window, ~1 KiB each. */
const PRIMED_RECORDS = 400
/** Appends per session in the measured window. */
const MEASURED_APPENDS = 300
/** One bulky durable record; the reported records were ~4 KiB, scaled down for test time. */
const RECORD_PAYLOAD = 'x'.repeat(1024)
/**
 * Event-loop stall ceiling: the pre-fix behavior blocked for multiple seconds,
 * the bounded one stays in the low milliseconds, so this only has to sit far
 * below a second to be decisive.
 * ponytail: approximate wall-clock ceiling with ~50x headroom on the observed
 * cost; the deterministic assertion is `decodeCounter.lines === 0`, so tighten
 * this only if a real machine still clears it comfortably.
 */
const STALL_BUDGET_MS = 250
/** Heartbeat period; the measured gap is what a stalled loop reports. */
const HEARTBEAT_MS = 5

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'antigravity-perf-'))
}

/** One bulky, non-coalescible durable record, so each append is a real store write. */
function bulkyStart(index: number, session: string): AntigravityActivityEvent {
  return {
    type: ANTIGRAVITY_TOOL_START,
    data: { toolId: session + '-tool-' + String(index), name: 'Shell', status: 'running', input: RECORD_PAYLOAD },
  }
}

function textDelta(session: string, text: string): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_AGENT_TEXT, data: { trajectoryId: session + '-root', kind: 'text', text } }
}

/** Largest gap between heartbeat ticks while a workload runs, tail included. */
function heartbeat(): { stop: () => number } {
  let last = performance.now()
  let longest = 0
  const timer = setInterval(() => {
    const now = performance.now()
    longest = Math.max(longest, now - last)
    last = now
  }, HEARTBEAT_MS)
  return {
    stop: () => {
      clearInterval(timer)
      return Math.max(longest, performance.now() - last)
    },
  }
}

/** Let timers run, so the heartbeat observes stalls instead of one long block. */
function yieldToTimers(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 1) })
}

/** One append per session per step, yielding periodically like real event arrival. */
async function driveFourSessions(store: AntigravityActivityStore, steps: number): Promise<void> {
  for (let index = 0; index < steps; index++) {
    for (const session of SESSIONS) store.append(session, [bulkyStart(index, session)])
    if ((index & 31) === 31) await yieldToTimers()
  }
}

function timeAppends(store: AntigravityActivityStore, appends: number): number {
  const started = performance.now()
  for (let index = 0; index < appends; index++) {
    for (const session of SESSIONS) store.append(session, [bulkyStart(index, session)])
  }
  return performance.now() - started
}

/** Durable records of one session, read back from the JSONL file the store wrote. */
function durableRecords(root: string, session: string): ReturnType<AntigravityActivityStore['read']>['records'] {
  const file = join(root, createHash('sha256').update(session, 'utf8').digest('hex') + '.jsonl')
  const lines = readFileSync(file, 'utf8').split('\n')
  expect(lines.pop()).toBe('')
  return decodeActivityHistory({
    version: ACTIVITY_SCHEMA_VERSION,
    records: lines.map(line => JSON.parse(line) as unknown),
  }).records
}

describe('native activity append cost', () => {
  it('never decodes history on an append once the session cursor exists', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    for (let index = 0; index < PRIMED_RECORDS; index++) store.append('dsh', [bulkyStart(index, 'dsh')])
    // A fresh history decodes nothing at all, not even on the first append.
    expect(decodeCounter.lines).toBe(0)

    decodeCounter.lines = 0
    for (let index = 0; index < MEASURED_APPENDS; index++) store.append('dsh', [bulkyStart(index, 'dsh')])
    expect(decodeCounter.lines).toBe(0)

    // A restart over the same root validates the whole history exactly once,
    // then goes back to O(1) appends with the sequence continued.
    const records = PRIMED_RECORDS + MEASURED_APPENDS
    const restarted = new AntigravityActivityStore(root)
    decodeCounter.lines = 0
    restarted.append('dsh', [bulkyStart(records, 'dsh')])
    expect(decodeCounter.lines).toBe(records)
    decodeCounter.lines = 0
    restarted.append('dsh', [bulkyStart(records + 1, 'dsh')])
    expect(decodeCounter.lines).toBe(0)
    expect(restarted.read('dsh').records.map(record => record.seq)).toEqual(
      Array.from({ length: records + 2 }, (_, index) => index + 1),
    )
  })

  it('keeps the early and late append windows within one bounded cost', () => {
    const earlyMs = timeAppends(new AntigravityActivityStore(tempRoot()), MEASURED_APPENDS)

    const grown = new AntigravityActivityStore(tempRoot())
    timeAppends(grown, PRIMED_RECORDS)
    decodeCounter.lines = 0
    const lateMs = timeAppends(grown, MEASURED_APPENDS)
    expect(decodeCounter.lines).toBe(0)

    // ponytail: approximate per-append ratio with a 4x ceiling and 50us slack on
    // top of the deterministic "no decode work at all" assertion above.
    const writes = MEASURED_APPENDS * SESSIONS.length
    expect(lateMs / writes).toBeLessThanOrEqual(earlyMs / writes * 4 + 0.05)
  })

  it('would have failed on a whole-history-per-append store', () => {
    const store = new AntigravityActivityStore(tempRoot())
    for (let index = 0; index < PRIMED_RECORDS; index++) store.append('dsh', [bulkyStart(index, 'dsh')])

    // Reference of the pre-fix append: one full validation read per append. The
    // decode counter grows with history — exactly what the assertions above
    // forbid — and one such read extrapolated over the harness workload already
    // exceeds the stall budget the harness enforces on the real path.
    decodeCounter.lines = 0
    const legacyAppends = 8
    for (let index = 0; index < legacyAppends; index++) store.read('dsh')
    expect(decodeCounter.lines).toBeGreaterThanOrEqual(legacyAppends * PRIMED_RECORDS)

    const started = performance.now()
    store.read('dsh')
    const legacyPerAppend = performance.now() - started
    expect(legacyPerAppend * MEASURED_APPENDS * SESSIONS.length).toBeGreaterThan(STALL_BUDGET_MS)
  })

  it('measures a real stall with the same heartbeat it uses as a ceiling', () => {
    // Self-check: the probe must observe a blocked loop, otherwise the budget
    // above could pass vacuously.
    const beats = heartbeat()
    const until = performance.now() + 60
    while (performance.now() < until) { /* block the event loop on purpose */ }
    expect(beats.stop()).toBeGreaterThan(30)
  })
})

describe('four concurrent sessions', () => {
  it('stays responsive and keeps every session ordered and independent', async () => {
    const store = new AntigravityActivityStore(tempRoot())
    await driveFourSessions(store, PRIMED_RECORDS)

    const beats = heartbeat()
    decodeCounter.lines = 0
    await driveFourSessions(store, MEASURED_APPENDS)
    const stall = beats.stop()

    // Deterministic: an append never reads any session's history, its own or another's.
    expect(decodeCounter.lines).toBe(0)
    expect(stall).toBeLessThan(STALL_BUDGET_MS)

    for (const session of SESSIONS) {
      const records = store.read(session).records
      expect(records).toHaveLength(PRIMED_RECORDS + MEASURED_APPENDS)
      expect(records.map(record => record.seq)).toEqual(
        Array.from({ length: PRIMED_RECORDS + MEASURED_APPENDS }, (_, index) => index + 1),
      )
      expect(records.slice(PRIMED_RECORDS).map(record => record.type === ANTIGRAVITY_TOOL_START ? record.data.toolId : '')).toEqual(
        Array.from({ length: MEASURED_APPENDS }, (_, index) => session + '-tool-' + String(index)),
      )
    }
  })
})

describe('bounded pending memory under a high-volume flood', () => {
  it('keeps buffers bounded, preserves every delta, and reports the counters', async () => {
    const root = tempRoot()
    const writer = createAntigravityActivityWriter(root)
    const delta = 'y'.repeat(512)
    const deltasPerSession = 2000
    const expected = delta.repeat(deltasPerSession)
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onRejection)
    let peakPending = 0
    try {
      for (let index = 0; index < deltasPerSession; index++) {
        for (const session of SESSIONS) {
          writer.append(session, [textDelta(session, delta)])
          peakPending = Math.max(peakPending, writer.pendingCount(session))
        }
      }
      writer.flushAll()
      await yieldToTimers()
    } finally {
      process.off('unhandledRejection', onRejection)
    }

    expect(peakPending).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_RECORDS)
    expect(rejections).toEqual([])

    for (const session of SESSIONS) {
      const records = durableRecords(root, session)
      expect(records.length).toBeGreaterThan(0)
      expect(records.length).toBeLessThan(deltasPerSession)
      expect(records.every(record => record.type === ANTIGRAVITY_AGENT_TEXT)).toBe(true)
      // Exact visible text, in order, with no duplication from a retried flush.
      expect(foldAgentTextRecords(records).map(row => row.text).join('')).toBe(expected)
    }
  })

  it('bounds buffered bytes when JSON escaping multiplies the payload', () => {
    const root = tempRoot()
    const writer = createAntigravityActivityWriter(root)
    // A control character serializes to six bytes, so 40 records of 4 KiB text
    // would be ~960 KiB of buffer without a byte ceiling. Distinct trajectories
    // never merge, so the byte ceiling is the only bound doing the work here.
    const hostile = '\u0000'.repeat(4096)
    const arrivals = 40
    for (let index = 0; index < arrivals; index++) {
      writer.append('dsh', [{ type: ANTIGRAVITY_AGENT_TEXT, data: { trajectoryId: 'trajectory-' + String(index), kind: 'text', text: hostile } }])
      expect(writer.pendingCount('dsh')).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_RECORDS)
    }
    // The byte ceiling forced a durable batch before the explicit flush.
    expect(durableRecords(root, 'dsh').length).toBeGreaterThan(0)
    writer.flushAll()

    // Force-flushing is not dropping: every hostile record is durable, intact.
    const records = durableRecords(root, 'dsh')
    expect(records).toHaveLength(arrivals)
    expect(records.every(record => record.type === ANTIGRAVITY_AGENT_TEXT && record.data.text === hostile)).toBe(true)
  })
})

describe('bounded browser read path', () => {
  /** Settings RPC handler over one real store, as the host plugin wires it. */
  function handlerFor(store: AntigravityActivityStore) {
    const deps = {
      snapshot: async () => ({ rows: [] }),
      catalog: async () => ({ groups: [] }),
      quota: async () => ({}),
      readActivity: (sessionId: string) => store.read(sessionId),
      readActivityAfter: (sessionId: string, afterSeq: number) => store.readActivityPage(sessionId, afterSeq),
      applyConfig: async () => undefined,
      run: async () => undefined,
    }
    return createAcpSettingsRpcHandler(deps as unknown as AcpSettingsRpcDeps)
  }

  it('transfers only records after the cursor and bounds every page', async () => {
    const writer = createAntigravityActivityWriter(tempRoot())
    const total = ACTIVITY_PAGE_RECORD_LIMIT + 120
    for (let index = 0; index < total; index++) writer.append('dsh', [bulkyStart(index, 'dsh')])
    const call = handlerFor(writer.store)

    // Bootstrap is the one accepted full-history transfer.
    const bootstrap = await call(ACTIVITY_ENDPOINT, { sessionId: 'dsh' })
    expect(bootstrap.ok).toBe(true)
    expect(decodeActivityHistory(bootstrap.ok ? bootstrap.value : undefined).records).toHaveLength(total)

    // Every following poll moves the cursor and never re-sends a seen record.
    let cursor = 0
    let polls = 0
    let transferred = 0
    for (;;) {
      const reply = await call(ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: 'dsh', afterSeq: cursor })
      expect(reply.ok).toBe(true)
      const page = decodeActivityPage(reply.ok ? reply.value : undefined, cursor)
      expect(page.records.length).toBeLessThanOrEqual(ACTIVITY_PAGE_RECORD_LIMIT)
      expect(page.records[0]?.seq).toBe(cursor + 1)
      transferred += page.records.length
      cursor = page.nextCursor
      polls += 1
      if (!page.hasMore) break
    }
    expect(transferred).toBe(total)
    expect(polls).toBeGreaterThan(1)

    // A caught-up poll is empty, not a full-history transfer.
    const caughtUp = await call(ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: 'dsh', afterSeq: cursor })
    expect(caughtUp).toMatchObject({ ok: true, value: { records: [], nextCursor: cursor, hasMore: false } })
  })

  it('reports a stale cursor as the resynchronization trigger', async () => {
    const writer = createAntigravityActivityWriter(tempRoot())
    writer.append('dsh', [bulkyStart(0, 'dsh')])
    const call = handlerFor(writer.store)

    const ahead = await call(ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: 'dsh', afterSeq: 99 })
    expect(ahead).toMatchObject({ ok: false, error: { code: ACTIVITY_STALE_CURSOR } })
    const full = await call(ACTIVITY_ENDPOINT, { sessionId: 'dsh' })
    expect(full.ok).toBe(true)
  })
})
