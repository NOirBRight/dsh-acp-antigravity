import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_COALESCE_WINDOW_MS,
  ACTIVITY_MAX_PENDING_BYTES,
  ACTIVITY_MAX_PENDING_RECORDS,
  ACTIVITY_MAX_TEXT_CHARS,
  ACTIVITY_TOOL_SKIP_FLUSH,
  AntigravityActivityCoalescer,
  type ActivityCoalescerSink,
} from '../src/activity-coalescer.js'
import type { AntigravityActivityEvent } from '../src/activity-store.js'
import { ANTIGRAVITY_MAX_TOOL_TEXT_CHARS, ANTIGRAVITY_SESSION_READY, ANTIGRAVITY_AGENT_TEXT, ANTIGRAVITY_TOOL_START, ANTIGRAVITY_TOOL_UPDATE, foldAntigravityToolEvent, type AntigravityToolState } from '../src/tool-events.js'

const SESSION = 'session-a'

interface Batch {
  readonly sessionId: string
  readonly events: readonly AntigravityActivityEvent[]
}

/** Recording sink: one entry per durable append, in call order. */
function recorder(): { batches: Batch[]; sink: ActivityCoalescerSink; flat: () => AntigravityActivityEvent[] } {
  const batches: Batch[] = []
  return {
    batches,
    sink: { append: (sessionId, events) => { batches.push({ sessionId, events: [...events] }) } },
    flat: () => batches.flatMap(batch => [...batch.events]),
  }
}

function text(data: string, kind: 'text' | 'thought' = 'text', trajectoryId = 'root'): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_AGENT_TEXT, data: { trajectoryId, kind, text: data } }
}

function toolUpdate(toolId: string, status: 'pending' | 'running' | 'completed' | 'failed', output?: string): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId, status, ...(output === undefined ? {} : { output }) } }
}

function toolStart(toolId: string): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_TOOL_START, data: { toolId, name: 'Shell', status: 'running' } }
}

function ready(): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }
}

describe('Antigravity activity coalescer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('merges deltas by trajectory, parent and kind and preserves exact text', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('Hel'), text('lo '), text('world', 'thought'), text('!', 'thought')])
    coalescer.append(SESSION, [{ type: ANTIGRAVITY_AGENT_TEXT, data: { trajectoryId: 'child', parentTrajectoryId: 'root', kind: 'text', text: 'sub' } }])
    coalescer.append(SESSION, [text('second', 'text')])
    // Different parent is a different key, even on the same trajectory and kind.
    coalescer.append(SESSION, [{ type: ANTIGRAVITY_AGENT_TEXT, data: { trajectoryId: 'root', parentTrajectoryId: 'root', kind: 'text', text: 'owned' } }])
    coalescer.flush(SESSION)
    expect(flat().map(event => event.type === ANTIGRAVITY_AGENT_TEXT ? event.data.text : '<other>')).toEqual(['Hello ', 'world!', 'sub', 'second', 'owned'])
    expect(flat().filter(event => event.type === ANTIGRAVITY_AGENT_TEXT).map(event => event.data.kind)).toEqual(['text', 'thought', 'text', 'text', 'text'])
  })

  it('delivers on the window without an explicit flush', () => {
    const { sink, batches, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('a'), text('b')])
    expect(batches).toHaveLength(0)
    vi.advanceTimersByTime(ACTIVITY_COALESCE_WINDOW_MS - 1)
    expect(batches).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(batches).toHaveLength(1)
    expect(flat().map(event => event.type === ANTIGRAVITY_AGENT_TEXT ? event.data.text : '<other>')).toEqual(['ab'])
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('flushes buffered text before a non-coalescible ordering barrier', () => {
    const { sink, batches, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('before')])
    coalescer.append(SESSION, [ready()])
    coalescer.append(SESSION, [text('after')])
    coalescer.append(SESSION, [toolStart('t1')])
    coalescer.flush(SESSION)
    expect(flat().map(event => event.type)).toEqual([ANTIGRAVITY_AGENT_TEXT, ANTIGRAVITY_SESSION_READY, ANTIGRAVITY_AGENT_TEXT, ANTIGRAVITY_TOOL_START])
    expect(batches.map(batch => batch.events.length)).toEqual([1, 1, 1, 1])
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('bounds the buffer by forcing a flush at the record ceiling', () => {
    const { sink, batches } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    for (let index = 0; index <= ACTIVITY_MAX_PENDING_RECORDS; index++) coalescer.append(SESSION, [text('x', 'text', 'trajectory-' + String(index))])
    expect(batches).toHaveLength(1)
    expect(batches[0]?.events).toHaveLength(ACTIVITY_MAX_PENDING_RECORDS)
    expect(coalescer.pendingCount(SESSION)).toBe(1)
    coalescer.flush(SESSION)
    expect(batches).toHaveLength(2)
  })

  it('flushes on a paragraph boundary without waiting for the window', () => {
    const { sink, batches, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('first paragraph\n\n')])
    // The window never elapsed: the closed paragraph is a visible block already.
    expect(batches).toHaveLength(1)
    expect(flat().map(event => event.type === ANTIGRAVITY_AGENT_TEXT ? event.data.text : '')).toEqual(['first paragraph\n\n'])
    coalescer.append(SESSION, [text('still typing')])
    expect(batches).toHaveLength(1)
    coalescer.append(SESSION, [text(' the rest\n\n')])
    expect(batches).toHaveLength(2)
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('defers an open code fence and flushes it once the fence closes', () => {
    const { sink, batches, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('```ts\nconst x = 1\n')])
    expect(batches).toHaveLength(0)
    coalescer.append(SESSION, [text('const y = 2\n```')])
    expect(batches).toHaveLength(1)
    expect(flat().map(event => event.type === ANTIGRAVITY_AGENT_TEXT ? event.data.text : '')).toEqual(['```ts\nconst x = 1\nconst y = 2\n```'])
  })

  it('splits text at the record ceiling without losing or reordering content', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    const half = 'a'.repeat(ACTIVITY_MAX_TEXT_CHARS - 1)
    coalescer.append(SESSION, [text(half), text('bc')])
    coalescer.flush(SESSION)
    const records = flat()
    expect(records).toHaveLength(2)
    expect(records.map(event => event.type === ANTIGRAVITY_AGENT_TEXT ? event.data.text : '').join('')).toBe(half + 'bc')
  })

  it('keeps tool lifecycle lossless and merges same-status output growth', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [toolStart('t1')])
    coalescer.append(SESSION, [toolUpdate('t1', 'running', 'line 1')])
    coalescer.append(SESSION, [toolUpdate('t1', 'running', 'line 1\nline 2')])
    coalescer.append(SESSION, [toolUpdate('t1', 'running', 'line 1\nline 2\nline 3')])
    coalescer.append(SESSION, [toolUpdate('t1', 'completed', 'line 1\nline 2\nline 3')])
    coalescer.flush(SESSION)
    expect(flat().map(event => event.type)).toEqual([ANTIGRAVITY_TOOL_START, ANTIGRAVITY_TOOL_UPDATE, ANTIGRAVITY_TOOL_UPDATE])
    const updates = flat().filter(event => event.type === ANTIGRAVITY_TOOL_UPDATE)
    expect(updates.map(event => event.data.status)).toEqual(['running', 'completed'])
    expect(updates[0]?.data.output).toBe('line 1\nline 2\nline 3')
    expect(updates[1]?.data.output).toBe('line 1\nline 2\nline 3')
  })

  it('coalesces changed non-growing redraws and keeps the latest value', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    for (let index = 0; index < 4; index++) coalescer.append(SESSION, [toolUpdate('t1', 'running', String(index).repeat(4))])
    coalescer.flush(SESSION)
    // A constant-length terminal redraw is a bounded replacement, not one write per repaint.
    expect(flat().map(event => event.type === ANTIGRAVITY_TOOL_UPDATE ? event.data.output : '')).toEqual(['3333'])
  })

  it('collapses a repaint that repeats the same value and flushes at the skip count', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    for (let index = 0; index <= ACTIVITY_TOOL_SKIP_FLUSH; index++) coalescer.append(SESSION, [toolUpdate('t1', 'running', 'repaint')])
    // Identical repaints fold into one row; the count forces one durable write.
    expect(flat().map(event => event.type === ANTIGRAVITY_TOOL_UPDATE ? event.data.output : '')).toEqual(['repaint'])
    coalescer.flush(SESSION)
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('folds a repeated repaint to the row the un-coalesced stream produced', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    const events: AntigravityActivityEvent[] = [
      toolStart('t1'),
      { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 't1', status: 'running', input: 'ls', location: { target: '/tmp', kind: 'file' } } },
      { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 't1', status: 'running' } },
      { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 't1', status: 'running' } },
    ]
    for (const event of events) coalescer.append(SESSION, [event])
    coalescer.flush(SESSION)
    const fold = (batch: readonly AntigravityActivityEvent[]): AntigravityToolState | undefined => {
      let state: AntigravityToolState | undefined
      for (const event of batch) {
        if (event.type === ANTIGRAVITY_TOOL_START || event.type === ANTIGRAVITY_TOOL_UPDATE) state = foldAntigravityToolEvent(state, event)
      }
      return state
    }
    // A repaint that omits input and location must not erase them: the durable
    // record folds to the same row as the stream it replaced.
    expect(fold(flat())).toEqual(fold(events))
    expect(fold(flat())?.location).toEqual({ target: '/tmp', kind: 'file' })
  })

  it('keeps per-tool updates separate and preserves terminal states', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [toolStart('t1'), toolUpdate('t1', 'completed', 'ok'), toolStart('t2'), toolUpdate('t2', 'failed')])
    coalescer.flush(SESSION)
    expect(flat().map(event => event.type === ANTIGRAVITY_TOOL_UPDATE ? event.data.toolId + ':' + event.data.status : event.type)).toEqual([
      ANTIGRAVITY_TOOL_START,
      't1:completed',
      ANTIGRAVITY_TOOL_START,
      't2:failed',
    ])
  })

  it('fails closed after a flush failure and never retries the batch', () => {
    const { batches, sink } = recorder()
    let fail = true
    const failing: ActivityCoalescerSink = {
      append: (sessionId, events) => {
        if (fail) throw new Error('disk full')
        sink.append(sessionId, events)
      },
    }
    const coalescer = new AntigravityActivityCoalescer(failing)
    coalescer.append(SESSION, [text('lost')])
    expect(() => coalescer.flush(SESSION)).toThrow('disk full')
    fail = false
    // Nothing is retried: the failed batch stays gone, and its error is owed to
    // every later caller-owned operation even though the queue is now empty.
    expect(() => coalescer.append(SESSION, [ready()])).toThrow('disk full')
    expect(() => coalescer.flush(SESSION)).toThrow('disk full')
    expect(() => coalescer.flushAll()).toThrow('disk full')
    expect(batches).toHaveLength(0)
    expect(() => coalescer.release(SESSION)).toThrow('disk full')
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('reports a timer-driven flush failure on the next append', () => {
    const coalescer = new AntigravityActivityCoalescer({ append: () => { throw new Error('write refused') } })
    coalescer.append(SESSION, [text('buffered')])
    vi.advanceTimersByTime(ACTIVITY_COALESCE_WINDOW_MS)
    expect(() => coalescer.append(SESSION, [text('next')])).toThrow('write refused')
  })

  it('flushes on release and reset', () => {
    const { sink, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('released')])
    coalescer.release(SESSION)
    expect(flat()).toHaveLength(1)
    expect(coalescer.pendingCount(SESSION)).toBe(0)
    coalescer.append('session-b', [text('reset')])
    coalescer.reset()
    expect(flat()).toHaveLength(2)
    expect(coalescer.pendingCount('session-b')).toBe(0)
  })

  it('writes a terminal tool state on arrival instead of waiting for the window', () => {
    const { sink, batches, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [toolUpdate('t1', 'running', 'out')])
    // The running row is transient and stays buffered.
    expect(batches).toHaveLength(0)
    coalescer.append(SESSION, [toolUpdate('t1', 'completed', 'out')])
    // No timer advance: completed is durable now, after the row it followed.
    expect(flat().map(event => event.type === ANTIGRAVITY_TOOL_UPDATE ? event.data.status : '<other>')).toEqual(['running', 'completed'])
    expect(batches.map(batch => batch.events.length)).toEqual([1, 1])
    expect(coalescer.pendingCount(SESSION)).toBe(0)
    vi.advanceTimersByTime(ACTIVITY_COALESCE_WINDOW_MS)
    expect(batches).toHaveLength(2)
  })

  it('writes a failed tool state on arrival with nothing buffered', () => {
    const { sink, batches, flat } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [toolUpdate('t2', 'failed')])
    expect(batches).toHaveLength(1)
    expect(flat()).toHaveLength(1)
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('does not let buffered text or a merge delay a terminal tool state', () => {
    const { sink, batches } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    coalescer.append(SESSION, [text('typing')])
    coalescer.append(SESSION, [toolUpdate('t1', 'running', 'line 1')])
    coalescer.append(SESSION, [toolUpdate('t1', 'failed', 'line 1')])
    // The barrier wrote the text and the running row first, then the failure.
    expect(batches.map(batch => batch.events.map(event => event.type === ANTIGRAVITY_TOOL_UPDATE ? event.data.status : event.type))).toEqual([
      [ANTIGRAVITY_AGENT_TEXT, 'running'],
      ['failed'],
    ])
    expect(coalescer.pendingCount(SESSION)).toBe(0)
  })

  it('bounds one session buffer by serialized bytes and flushes instead of dropping', () => {
    const { batches, flat, sink } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    const delta = 'x'.repeat(4096)
    const arrivals = 128
    for (let index = 0; index < arrivals; index++) {
      coalescer.append(SESSION, [text(delta, 'text', 'trajectory-' + String(index))])
      // The ceiling holds after every arrival, including the one that crossed it.
      expect(coalescer.pendingBytes(SESSION)).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_BYTES)
      expect(coalescer.pendingCount(SESSION)).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_RECORDS)
    }
    expect(batches.length).toBeGreaterThan(0)
    coalescer.flush(SESSION)
    // Force-flushing is not dropping: every arrival is durable exactly once.
    expect(flat()).toHaveLength(arrivals)
    expect(flat().every(event => event.type === ANTIGRAVITY_AGENT_TEXT && event.data.text === delta)).toBe(true)
    expect(coalescer.pendingBytes(SESSION)).toBe(0)
  })

  it('never drops a record to fit the byte ceiling', () => {
    const { flat, sink } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    // Control characters serialize to six bytes each, so the record and text
    // ceilings cannot bound this alone; the byte ceiling must, and it may only
    // flush around it.
    const hostile = '\u0000'.repeat(ACTIVITY_MAX_TEXT_CHARS)
    coalescer.append(SESSION, [text(hostile)])
    expect(coalescer.pendingCount(SESSION)).toBe(1)
    coalescer.flush(SESSION)
    expect(flat()).toHaveLength(1)
    expect(flat()[0]).toMatchObject({ type: ANTIGRAVITY_AGENT_TEXT, data: { text: hostile } })
  })

  it('keeps the byte ceiling above the largest record the record limits allow', () => {
    const bytes = (event: AntigravityActivityEvent): number => Buffer.byteLength(JSON.stringify(event), 'utf8')
    const hostile = (chars: number): string => '\u0000'.repeat(chars)
    const worstText = text(hostile(ACTIVITY_MAX_TEXT_CHARS))
    const worstTool: AntigravityActivityEvent = {
      type: ANTIGRAVITY_TOOL_UPDATE,
      data: {
        toolId: 't1',
        name: hostile(ANTIGRAVITY_MAX_TOOL_TEXT_CHARS),
        status: 'running',
        input: hostile(ANTIGRAVITY_MAX_TOOL_TEXT_CHARS),
        output: hostile(ANTIGRAVITY_MAX_TOOL_TEXT_CHARS),
        error: hostile(ANTIGRAVITY_MAX_TOOL_TEXT_CHARS),
      },
    }
    // Flushing can always restore the budget: no single record the per-record
    // limits allow is larger than the ceiling it is charged against.
    expect(bytes(worstText)).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_BYTES)
    expect(bytes(worstTool)).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_BYTES)
  })

  it('applies the byte ceiling per session', () => {
    const { batches, sink } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    const filler = (session: string, index: number): AntigravityActivityEvent => text('y'.repeat(4096), 'text', session + '-' + String(index))
    const size = Buffer.byteLength(JSON.stringify(filler('a', 0)), 'utf8')
    const perSession = Math.floor(ACTIVITY_MAX_PENDING_BYTES * 0.75 / size)
    for (let index = 0; index < perSession; index++) coalescer.append('session-a', [filler('a', index)])
    for (let index = 0; index < perSession; index++) coalescer.append('session-b', [filler('b', index)])
    // Neither session crossed its own ceiling, so nothing was written although
    // the two buffers together hold more bytes than one ceiling.
    expect(batches).toHaveLength(0)
    expect(coalescer.pendingCount('session-a')).toBe(perSession)
    expect(coalescer.pendingCount('session-b')).toBe(perSession)
    expect(coalescer.pendingBytes('session-a') + coalescer.pendingBytes('session-b')).toBeGreaterThan(ACTIVITY_MAX_PENDING_BYTES)
  })

  it('splits a merged tool row at the byte ceiling without changing the fold', () => {
    const { flat, sink } = recorder()
    const coalescer = new AntigravityActivityCoalescer(sink)
    const filler = (index: number): AntigravityActivityEvent => text('y'.repeat(4000), 'text', 'trajectory-' + String(index))
    const fillerBytes = Buffer.byteLength(JSON.stringify(filler(0)), 'utf8')
    // Distinct trajectories never merge, so the count is exact and the buffer
    // ends within one filler of the ceiling, leaving 16 KiB of headroom.
    const fillers = Math.floor((ACTIVITY_MAX_PENDING_BYTES - 16 * 1024) / fillerBytes)
    for (let index = 0; index < fillers; index++) {
      coalescer.append(SESSION, [filler(index)])
      expect(coalescer.pendingBytes(SESSION)).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_BYTES)
    }
    const first: AntigravityActivityEvent = { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 't1', status: 'running', output: 'a' } }
    // Cumulative output growth far larger than the remaining headroom: the row
    // must be written out first and continued in its own record, never merged
    // past the ceiling.
    const grown = 'a' + '\u0000'.repeat(ANTIGRAVITY_MAX_TOOL_TEXT_CHARS)
    const second: AntigravityActivityEvent = { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 't1', status: 'running', output: grown } }
    coalescer.append(SESSION, [first])
    coalescer.append(SESSION, [second])
    expect(coalescer.pendingBytes(SESSION)).toBeLessThanOrEqual(ACTIVITY_MAX_PENDING_BYTES)
    coalescer.flush(SESSION)

    const updates = flat().filter(event => event.type === ANTIGRAVITY_TOOL_UPDATE)
    expect(updates).toHaveLength(2)
    expect(updates.at(-1)).toMatchObject({ data: { output: grown } })
    // Splitting the merge is invisible to the fold, and no filler was lost.
    const fold = (events: readonly AntigravityActivityEvent[]): AntigravityToolState | undefined => {
      let state: AntigravityToolState | undefined
      for (const event of events) if (event.type === ANTIGRAVITY_TOOL_UPDATE) state = foldAntigravityToolEvent(state, event)
      return state
    }
    expect(fold(flat())).toEqual(fold([first, second]))
    expect(flat().filter(event => event.type === ANTIGRAVITY_AGENT_TEXT)).toHaveLength(fillers)
  })

  it('rethrows a deferred timer-flush failure even with an empty queue', () => {
    const coalescer = new AntigravityActivityCoalescer({ append: () => { throw new Error('write refused') } })
    coalescer.append(SESSION, [text('buffered')])
    vi.advanceTimersByTime(ACTIVITY_COALESCE_WINDOW_MS)
    // The timer emptied the queue and swallowed its error; the next
    // caller-owned operation must still report it.
    expect(coalescer.pendingCount(SESSION)).toBe(0)
    expect(() => coalescer.flush(SESSION)).toThrow('write refused')
    expect(() => coalescer.flushAll()).toThrow('write refused')
    expect(() => coalescer.reset()).toThrow('write refused')
    // reset drops the buffer either way, so the failure is not carried on.
    expect(() => coalescer.flush(SESSION)).not.toThrow()
  })

  it('surfaces a deferred timer-flush failure on release and still drops the buffer', () => {
    const coalescer = new AntigravityActivityCoalescer({ append: () => { throw new Error('write refused') } })
    coalescer.append(SESSION, [text('buffered')])
    vi.advanceTimersByTime(ACTIVITY_COALESCE_WINDOW_MS)
    expect(() => coalescer.release(SESSION)).toThrow('write refused')
    expect(coalescer.pendingCount(SESSION)).toBe(0)
    expect(() => coalescer.release(SESSION)).not.toThrow()
  })

  it('flushes the healthy sessions before reporting a deferred failure', () => {
    const { batches, sink } = recorder()
    const failing: ActivityCoalescerSink = {
      append: (sessionId, events) => {
        if (sessionId === 'session-a') throw new Error('write refused')
        sink.append(sessionId, events)
      },
    }
    const coalescer = new AntigravityActivityCoalescer(failing)
    coalescer.append('session-a', [text('lost')])
    vi.advanceTimersByTime(ACTIVITY_COALESCE_WINDOW_MS)
    coalescer.append('session-b', [text('kept')])
    expect(() => coalescer.flushAll()).toThrow('write refused')
    // One session's deferred failure must not abandon another's records.
    expect(batches.map(batch => batch.sessionId)).toEqual(['session-b'])
  })
})
