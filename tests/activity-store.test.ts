import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isRecord } from '../src/decode.js'
import {
  ACTIVITY_SCHEMA_VERSION,
  AntigravityActivityStore,
  type AntigravityActivityHistory,
} from '../src/activity-store.js'
import {
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  type AntigravitySessionReadyEvent,
  type AntigravityToolEvent,
} from '../src/tool-events.js'

const readyEvent: AntigravitySessionReadyEvent = { type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }
const startEvent: AntigravityToolEvent = {
  type: ANTIGRAVITY_TOOL_START,
  data: { toolId: 'tool-1', name: 'read', status: 'running', location: { target: '/workspace/src/a.ts', kind: 'file' } },
}
const updateEvent: AntigravityToolEvent = {
  type: ANTIGRAVITY_TOOL_UPDATE,
  data: { toolId: 'tool-1', status: 'completed', output: 'ok' },
}

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tempRoot(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'antigravity-activity-'))
  roots.push(sandbox)
  const root = join(sandbox, 'history')
  mkdirSync(root)
  return root
}

function onlyFile(root: string): string {
  const entries = readdirSync(root)
  expect(entries).toHaveLength(1)
  return join(root, entries[0]!)
}

function pathFor(root: string, sessionId: string): string {
  return join(root, createHash('sha256').update(sessionId, 'utf8').digest('hex') + '.jsonl')
}

describe('AntigravityActivityStore', () => {
  it('persists all three event kinds and reads them back from a fresh store', () => {
    const root = tempRoot()
    new AntigravityActivityStore(root).append('session-a', [readyEvent, startEvent, updateEvent])
    const history: AntigravityActivityHistory = new AntigravityActivityStore(root).read('session-a')
    expect(history.version).toBe(ACTIVITY_SCHEMA_VERSION)
    expect(history.records.map(record => record.seq)).toEqual([1, 2, 3])
    expect(history.records.map(record => record.type)).toEqual([
      ANTIGRAVITY_SESSION_READY,
      ANTIGRAVITY_TOOL_START,
      ANTIGRAVITY_TOOL_UPDATE,
    ])
    for (const record of history.records) expect(Number.isNaN(Date.parse(record.time))).toBe(false)
    expect(history.records[2]).toMatchObject({ type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'tool-1', status: 'completed', output: 'ok' } })
    expect(statSync(onlyFile(root)).mode & 0o777).toBe(0o600)
    expect(statSync(root).mode & 0o777).toBe(0o700)
    new AntigravityActivityStore(root).append('session-a', [updateEvent])
    expect(new AntigravityActivityStore(root).read('session-a').records.map(record => record.seq)).toEqual([1, 2, 3, 4])
  })

  it('isolates sessions', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('session-a', [readyEvent])
    store.append('session-b', [startEvent, updateEvent])
    expect(store.read('session-a').records).toHaveLength(1)
    expect(store.read('session-b').records.map(record => record.type)).toEqual([ANTIGRAVITY_TOOL_START, ANTIGRAVITY_TOOL_UPDATE])
    expect(store.read('session-unknown')).toEqual({ version: ACTIVITY_SCHEMA_VERSION, records: [] })
    expect(readdirSync(root)).toHaveLength(2)
  })

  it('keeps traversal session ids inside the root', () => {
    const root = tempRoot()
    const parentBefore = readdirSync(dirname(root)).sort()
    const store = new AntigravityActivityStore(root)
    for (const evil of ['../../evil', '/abs/path', '..\\..\\win', '..']) {
      store.append(evil, [readyEvent])
      expect(store.read(evil).records).toHaveLength(1)
    }
    const entries = readdirSync(root)
    expect(entries).toHaveLength(4)
    for (const entry of entries) expect(entry.endsWith('.jsonl')).toBe(true)
    expect(readdirSync(dirname(root)).sort()).toEqual(parentBefore)
  })

  it('rejects unknown schema versions without overwriting', () => {
    const root = tempRoot()
    new AntigravityActivityStore(root).append('session-a', [readyEvent])
    const path = onlyFile(root)
    const tampered = readFileSync(path, 'utf8').replace('"v":1', '"v":999')
    expect(tampered).not.toBe(readFileSync(path, 'utf8'))
    writeFileSync(path, tampered)
    expect(() => new AntigravityActivityStore(root).read('session-a')).toThrow(/corrupt/)
    expect(readFileSync(path, 'utf8')).toBe(tampered)
  })

  it('rejects corrupt lines without overwriting', () => {
    const root = tempRoot()
    const cases: ReadonlyArray<readonly [string, (raw: string) => string]> = [
      ['broken-json', () => 'not-json\n'],
      ['missing-delimiter', raw => raw.slice(0, -1)],
      ['partial-line', raw => raw + '{"v":1,"seq":2'],
      ['bad-type', raw => raw.replace('antigravity/session-ready', 'nope')],
      ['bad-data', raw => raw.replace('"provider":"antigravity"', '"provider":42')],
    ]
    for (const [sessionId] of cases) new AntigravityActivityStore(root).append(sessionId, [readyEvent])
    for (const [sessionId, tamper] of cases) {
      const path = pathFor(root, sessionId)
      const tampered = tamper(readFileSync(path, 'utf8'))
      writeFileSync(path, tampered)
      expect(() => new AntigravityActivityStore(root).read(sessionId)).toThrow(/corrupt/)
      expect(() => new AntigravityActivityStore(root).append(sessionId, [readyEvent])).toThrow(/corrupt/)
      expect(readFileSync(path, 'utf8')).toBe(tampered)
    }
  })

  it('rejects stored records missing v on read and append without overwriting', () => {
    const root = tempRoot()
    new AntigravityActivityStore(root).append('s', [readyEvent])
    const path = onlyFile(root)
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) throw new Error('activity fixture is not an object')
    delete parsed.v
    const stripped = JSON.stringify(parsed) + String.fromCharCode(10)
    writeFileSync(path, stripped)
    const store = new AntigravityActivityStore(root)
    expect(() => store.read('s')).toThrow(/corrupt/)
    expect(() => store.append('s', [readyEvent])).toThrow(/corrupt/)
    expect(readFileSync(path, 'utf8')).toBe(stripped)
  })

  it('rejects symlinks without touching their targets', () => {
    const root = tempRoot()
    const target = join(root, 'target.jsonl')
    writeFileSync(target, 'sentinel')
    symlinkSync(target, pathFor(root, 'session-sym'))
    const store = new AntigravityActivityStore(root)
    expect(() => store.read('session-sym')).toThrow(/symbolic link/)
    expect(() => store.append('session-sym', [readyEvent])).toThrow(/symbolic link/)
    expect(readFileSync(target, 'utf8')).toBe('sentinel')
  })

  it('requires session ids', () => {
    const store = new AntigravityActivityStore(tempRoot())
    expect(() => store.append('', [readyEvent])).toThrow(/session id/)
    expect(() => store.append('   ', [readyEvent])).toThrow(/session id/)
    expect(() => store.read('')).toThrow(/session id/)
    expect(() => new AntigravityActivityStore('   ')).toThrow(/root directory/)
  })
})
