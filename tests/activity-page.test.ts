import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerId, sessionId } from '@deepseek-ai/dsh-acp-provider'
import { ExternalAgentActivityCursorAheadError } from '@deepseek-ai/dsh-acp-provider/activity-store'
import { describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_BINDING_ENDPOINT,
  ACTIVITY_ENDPOINT,
  ACTIVITY_PAGE_RECORD_LIMIT,
  ACTIVITY_READ_AFTER_ENDPOINT,
  ACTIVITY_SCHEMA_VERSION,
  ACTIVITY_STALE_CURSOR,
  ActivityCursorStaleError,
  decodeActivityPage,
  decodeActivityPageRequest,
  nativeSessionBinding,
} from '../src/activity-contract.js'
import { AntigravityActivityStore, type AntigravityActivityEvent } from '../src/activity-store.js'
import { createAcpSettingsRpcHandler, type AcpSettingsRpcDeps } from '../src/rpc.js'
import {
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  type AntigravityToolStartData,
} from '../src/tool-events.js'

const time = '2026-09-19T00:00:00.000Z'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'antigravity-page-'))
}

function pathFor(root: string, id: string): string {
  return join(root, createHash('sha256').update(id, 'utf8').digest('hex') + '.jsonl')
}

function readyEvent(): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }
}

function startEvent(toolId: string, status: AntigravityToolStartData['status'] = 'pending'): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_TOOL_START, data: { toolId, name: 'shell', status, ...(status === 'pending' ? {} : { ownership: { trajectoryId: 'traj-1' } }) } }
}

function updateEvent(toolId: string, status: AntigravityToolStartData['status']): AntigravityActivityEvent {
  return { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId, status } }
}

/** Wire record as the host sends it: decoded records carry no schema version. */
function wireRecord(seq: number, type: string, data: unknown): Record<string, unknown> {
  return { seq, time, type, data }
}

describe('cursor page contract', () => {
  it('decodes exactly { sessionId, afterSeq } and nothing else', () => {
    expect(decodeActivityPageRequest({ sessionId: 'dsh', afterSeq: 0 })).toEqual({ sessionId: 'dsh', afterSeq: 0 })
    expect(decodeActivityPageRequest({ sessionId: 'dsh', afterSeq: 42 })).toEqual({ sessionId: 'dsh', afterSeq: 42 })
    for (const value of [
      undefined,
      null,
      [],
      'dsh',
      {},
      { sessionId: 'dsh' },
      { afterSeq: 1 },
      { sessionId: '', afterSeq: 1 },
      { sessionId: '  ', afterSeq: 1 },
      { sessionId: 'dsh', afterSeq: -1 },
      { sessionId: 'dsh', afterSeq: 1.5 },
      { sessionId: 'dsh', afterSeq: '1' },
      { sessionId: 'dsh', afterSeq: Number.MAX_SAFE_INTEGER + 1 },
      { sessionId: 'dsh', afterSeq: 1, limit: 10 },
      { sessionId: 'dsh', afterSeq: 1, extra: true },
    ]) {
      expect(decodeActivityPageRequest(value)).toBeUndefined()
    }
  })

  it('decodes a page from its base sequence instead of seq 1', () => {
    const value = {
      version: ACTIVITY_SCHEMA_VERSION,
      records: [
        wireRecord(6, ANTIGRAVITY_TOOL_UPDATE, { toolId: 't1', status: 'running' }),
        wireRecord(7, ANTIGRAVITY_TOOL_START, { toolId: 't2', name: 'read', status: 'pending' }),
      ],
      nextCursor: 7,
      hasMore: false,
    }
    const page = decodeActivityPage(value, 5)
    expect(page.records.map(record => record.seq)).toEqual([6, 7])
    expect(page.nextCursor).toBe(7)
    expect(page.hasMore).toBe(false)
    // The full-history decoder still expects seq 1, so a page must never be routed through it.
    expect(page.records[0]).toMatchObject({ seq: 6, type: ANTIGRAVITY_TOOL_UPDATE })
  })

  it('fails closed on a page that does not continue the requested cursor', () => {
    const records = [wireRecord(1, ANTIGRAVITY_TOOL_UPDATE, { toolId: 't1', status: 'running' })]
    const valid = { version: ACTIVITY_SCHEMA_VERSION, records, nextCursor: 6, hasMore: false }
    expect(() => decodeActivityPage(valid, 5)).toThrow('breaks the sequence')
    for (const value of [
      undefined,
      { ...valid, version: 2 },
      { ...valid, records: 'records' },
      { ...valid, hasMore: 'yes' },
      { ...valid, nextCursor: 0 },
      { ...valid, nextCursor: 1.5 },
      { ...valid, nextCursor: 4, records: [] },
      { ...valid, nextCursor: 3 },
    ]) {
      expect(() => decodeActivityPage(value, 5)).toThrow('corrupt')
    }
    expect(decodeActivityPage({ version: ACTIVITY_SCHEMA_VERSION, records: [], nextCursor: 4, hasMore: true }, 4)).toEqual({
      version: ACTIVITY_SCHEMA_VERSION,
      records: [],
      nextCursor: 4,
      hasMore: true,
    })
  })
})

describe('cursor page reads through the store', () => {
  it('returns only records after the cursor, in order, with a continuation flag', () => {
    const store = new AntigravityActivityStore(tempRoot())
    store.append('dsh', [readyEvent(), startEvent('t1')])
    const first = store.readActivityPage('dsh', 0)
    expect(first.records.map(record => record.seq)).toEqual([1, 2])
    expect(first.nextCursor).toBe(2)
    expect(first.hasMore).toBe(false)
    expect(first.version).toBe(ACTIVITY_SCHEMA_VERSION)

    store.append('dsh', [updateEvent('t1', 'completed')])
    const second = store.readActivityPage('dsh', 2)
    expect(second.records).toHaveLength(1)
    expect(second.records[0]).toMatchObject({ seq: 3, type: ANTIGRAVITY_TOOL_UPDATE })
    expect(second.nextCursor).toBe(3)
    expect(second.hasMore).toBe(false)
    expect(store.readActivityPage('dsh', 3).records).toEqual([])
  })

  it('bounds every page by the fixed record limit', () => {
    const store = new AntigravityActivityStore(tempRoot())
    const events = Array.from({ length: ACTIVITY_PAGE_RECORD_LIMIT + 1 }, (_, index) => startEvent('t' + String(index)))
    store.append('dsh', events)
    const page = store.readActivityPage('dsh', 0)
    expect(page.records).toHaveLength(ACTIVITY_PAGE_RECORD_LIMIT)
    expect(page.nextCursor).toBe(ACTIVITY_PAGE_RECORD_LIMIT)
    expect(page.hasMore).toBe(true)
    const rest = store.readActivityPage('dsh', page.nextCursor)
    expect(rest.records.map(record => record.seq)).toEqual([ACTIVITY_PAGE_RECORD_LIMIT + 1])
    expect(rest.hasMore).toBe(false)
  })

  it('reports a cursor ahead of the history as stale instead of resuming at seq 1', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('dsh', [readyEvent()])
    expect(() => store.readActivityPage('dsh', 9)).toThrow(ActivityCursorStaleError)
    // The refused read leaves the history untouched for the full read that resynchronizes.
    expect(store.read('dsh').records.map(record => record.seq)).toEqual([1])
  })

  it('keeps old histories readable and binding on the full read, never on a page', () => {
    const root = tempRoot()
    mkdirSync(root, { recursive: true, mode: 0o700 })
    // Legacy ready-only history (no resume ref) followed by one pending tool row.
    const lines = [
      JSON.stringify({ v: 1, seq: 1, time, type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }),
      JSON.stringify({ v: 1, seq: 2, time, type: ANTIGRAVITY_TOOL_START, data: { toolId: 't1', name: 'shell', status: 'pending' } }),
    ]
    writeFileSync(pathFor(root, 'legacy'), lines.join('\n') + '\n', { mode: 0o600 })

    const store = new AntigravityActivityStore(root)
    const page = store.readActivityPage('legacy', 1)
    expect(page.records.map(record => record.seq)).toEqual([2])
    // A page starting after the ready record cannot answer "is this session bound": the
    // full read must, and legacy histories keep their provider-only binding.
    expect(nativeSessionBinding({ version: ACTIVITY_SCHEMA_VERSION, records: page.records }, 'legacy')).toBeUndefined()
    expect(nativeSessionBinding(store.read('legacy'), 'legacy')).toEqual({ provider: providerId('antigravity'), session: sessionId('legacy') })
  })

  it('fails closed on a corrupt history instead of repairing it', () => {
    const root = tempRoot()
    mkdirSync(root, { recursive: true, mode: 0o700 })
    writeFileSync(pathFor(root, 'broken'), JSON.stringify({ v: 1, seq: 1, time, type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }) + '\n{"v":1,', { mode: 0o600 })
    const store = new AntigravityActivityStore(root)
    expect(() => store.readActivityPage('broken', 0)).toThrow(/incomplete trailing record|not JSON/)
  })
})

describe('activity filesystem guardrails', () => {
  it('keeps restrictive modes and rejects a symlinked history', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('safe', [readyEvent()])

    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(lstatSync(pathFor(root, 'safe')).mode & 0o777).toBe(0o600)
    symlinkSync(pathFor(root, 'safe'), pathFor(root, 'link'))
    expect(() => store.read('link')).toThrow()
  })

  it('fails closed when the history root cannot accept a write', () => {
    const parent = tempRoot()
    const rootFile = join(parent, 'not-a-directory')
    writeFileSync(rootFile, 'root')
    const store = new AntigravityActivityStore(rootFile)
    expect(() => store.append('session', [readyEvent()])).toThrow()
  })
})

describe('stale cursor mapping', () => {
  it('maps the provider typed cursor-ahead error', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('dsh', [readyEvent()])

    // The provider owns the refusal and types it; the store owns the DSH wire contract.
    expect(() => store.readAfter('dsh', 9, ACTIVITY_PAGE_RECORD_LIMIT)).toThrow(ExternalAgentActivityCursorAheadError)
    expect(() => store.readActivityPage('dsh', 9)).toThrow(ActivityCursorStaleError)
    expect(store.read('dsh').records.map(record => record.seq)).toEqual([1])
  })

  it('passes any other provider failure through untouched', () => {
    for (const failure of [
      Object.assign(new Error('unrelated'), { kind: 'something-else', afterSeq: 9, historyLength: 1 }),
      Object.assign(new Error('partial shape'), { kind: 'cursor-ahead', afterSeq: '9', historyLength: 1 }),
      Object.assign(new Error('no kind'), { afterSeq: 9, historyLength: 1 }),
    ]) {
      const store = new AntigravityActivityStore(tempRoot())
      vi.spyOn(store, 'readAfter').mockImplementation(() => { throw failure })
      expect(() => store.readActivityPage('dsh', 9)).toThrow(failure.message)
    }
  })

  it('treats a followed cursor whose history was deleted as stale, never as caught up', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('dsh', [readyEvent(), startEvent('t1')])
    const cursor = store.readActivityPage('dsh', 0).nextCursor
    expect(cursor).toBe(2)

    rmSync(pathFor(root, 'dsh'))
    expect(() => store.readActivityPage('dsh', cursor)).toThrow(ActivityCursorStaleError)
  })

  it('leaves cursor 0 an ordinary empty page for a history that is unknown or deleted', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    const empty = { version: ACTIVITY_SCHEMA_VERSION, records: [], nextCursor: 0, hasMore: false }

    // Nothing was being followed yet, so there is no stale cursor to report for either case.
    expect(store.readActivityPage('unknown', 0)).toEqual(empty)
    store.append('dsh', [readyEvent()])
    rmSync(pathFor(root, 'dsh'))
    expect(store.readActivityPage('dsh', 0)).toEqual(empty)
  })

  it('keeps a caught-up read on an existing history an empty page, not a stale cursor', () => {
    const store = new AntigravityActivityStore(tempRoot())
    store.append('dsh', [readyEvent()])

    expect(store.readActivityPage('dsh', 1)).toEqual({ version: ACTIVITY_SCHEMA_VERSION, records: [], nextCursor: 1, hasMore: false })
  })
})

describe('activity read-after RPC', () => {
  const history = { version: ACTIVITY_SCHEMA_VERSION, records: [] }

  function handler(overrides: Partial<AcpSettingsRpcDeps> = {}) {
    const deps = {
      snapshot: async () => ({ rows: [] }),
      catalog: async () => ({ groups: [] }),
      quota: async () => ({}),
      readActivity: () => history,
      readActivityAfter: () => ({ version: ACTIVITY_SCHEMA_VERSION, records: [], nextCursor: 0, hasMore: false }),
      applyConfig: async () => undefined,
      run: async () => undefined,
      ...overrides,
    }
    return createAcpSettingsRpcHandler(deps as unknown as AcpSettingsRpcDeps)
  }

  it('serves a bounded page for a strict cursor request', async () => {
    const page = { version: ACTIVITY_SCHEMA_VERSION, records: [], nextCursor: 12, hasMore: true }
    const readActivityAfter = vi.fn(() => page)
    const result = await handler({ readActivityAfter })(ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: 'dsh', afterSeq: 12 })
    expect(readActivityAfter).toHaveBeenCalledWith('dsh', 12)
    expect(result).toEqual({ ok: true, value: page })
  })

  it('rejects a cursor request that is not exactly { sessionId, afterSeq }', async () => {
    const readActivityAfter = vi.fn()
    const call = handler({ readActivityAfter })
    for (const payload of [{ sessionId: 'dsh' }, { sessionId: 'dsh', afterSeq: -1 }, { sessionId: 'dsh', afterSeq: 1, limit: 1 }, null]) {
      expect(await call(ACTIVITY_READ_AFTER_ENDPOINT, payload)).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
    expect(readActivityAfter).not.toHaveBeenCalled()
  })

  it('reports a stale cursor explicitly so the client resynchronizes', async () => {
    const result = await handler({ readActivityAfter: () => { throw new ActivityCursorStaleError(9, 1) } })(ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: 'dsh', afterSeq: 9 })
    expect(result).toMatchObject({ ok: false, error: { code: ACTIVITY_STALE_CURSOR } })
  })

  it('keeps activity/read and activity/binding payloads and responses unchanged', async () => {
    const record = { seq: 1, time, type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } } as const
    const call = handler({
      readActivity: () => ({ version: ACTIVITY_SCHEMA_VERSION, records: [record] }),
      readActivityAfter: () => { throw new Error('cursor reads must not answer binding') },
    })
    expect(await call(ACTIVITY_ENDPOINT, { sessionId: 'dsh' })).toEqual({ ok: true, value: { version: ACTIVITY_SCHEMA_VERSION, records: [record] } })
    expect(await call(ACTIVITY_BINDING_ENDPOINT, { sessionId: 'dsh' })).toEqual({ ok: true, value: { provider: 'antigravity' } })
    expect(await call(ACTIVITY_ENDPOINT, { sessionId: 'dsh', afterSeq: 0 })).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(await call(ACTIVITY_BINDING_ENDPOINT, { sessionId: '' })).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('maps an unreadable history to the existing unavailable failure', async () => {
    const result = await handler({ readActivityAfter: () => { throw new Error('Antigravity activity history is corrupt: line 1 is not JSON') } })(ACTIVITY_READ_AFTER_ENDPOINT, { sessionId: 'dsh', afterSeq: 0 })
    expect(result).toMatchObject({ ok: false, error: { message: 'Antigravity activity history is corrupt: line 1 is not JSON' } })
  })
})
