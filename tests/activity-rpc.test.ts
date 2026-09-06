/** Focused activity RPC tests: real store files, no provider, no network. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_BINDING_ENDPOINT,
  ACTIVITY_ENDPOINT,
  decodeActivityHistory,
  type AntigravityActivityHistory,
} from '../src/activity-contract.js'
import { AntigravityActivityStore } from '../src/activity-store.js'
import { QUOTA_ENDPOINT } from '../src/client-contract.js'
import { createAcpSettingsRpcHandler } from '../src/rpc.js'
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
  data: { toolId: 'tool-1', name: 'read', status: 'running' },
}
const updateEvent: AntigravityToolEvent = {
  type: ANTIGRAVITY_TOOL_UPDATE,
  data: { toolId: 'tool-1', status: 'completed', output: 'ok' },
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'antigravity-activity-rpc-'))
}

function handlerWith(backing: (sessionId: string) => AntigravityActivityHistory) {
  return createAcpSettingsRpcHandler({
    snapshot: async () => ({ title: 'External Agents', rows: [] }),
    catalog: async () => ({ groups: [] }),
    quota: async () => { throw new Error('Antigravity provider is uninstalled') },
    readActivity: backing,
    applyConfig: async () => {},
    run: async () => ({}),
  })
}

describe('activity RPC', () => {
  it('reads history while the provider is uninstalled', async () => {
    const store = new AntigravityActivityStore(tempRoot())
    store.append('s-1', [readyEvent, startEvent, updateEvent])
    const handler = handlerWith(sessionId => store.read(sessionId))
    expect((await handler(QUOTA_ENDPOINT, {})).ok).toBe(false)
    const result = await handler(ACTIVITY_ENDPOINT, { sessionId: 's-1' })
    if (!result.ok) throw new Error('expected ok: ' + JSON.stringify(result))
    expect(result.value).toMatchObject({
      version: 1,
      records: [
        { seq: 1, type: ANTIGRAVITY_SESSION_READY },
        { seq: 2, type: ANTIGRAVITY_TOOL_START },
        { seq: 3, type: ANTIGRAVITY_TOOL_UPDATE },
      ],
    })
  })

  it('binds only sessions with a ready record', async () => {
    const store = new AntigravityActivityStore(tempRoot())
    store.append('ready', [readyEvent])
    store.append('tools-only', [startEvent, updateEvent])
    const handler = handlerWith(sessionId => store.read(sessionId))
    expect(await handler(ACTIVITY_BINDING_ENDPOINT, { sessionId: 'ready' })).toEqual({ ok: true, value: { provider: 'antigravity' } })
    expect(await handler(ACTIVITY_BINDING_ENDPOINT, { sessionId: 'tools-only' })).toEqual({ ok: true, value: { provider: null } })
    expect(await handler(ACTIVITY_BINDING_ENDPOINT, { sessionId: 'missing' })).toEqual({ ok: true, value: { provider: null } })
  })

  it('rejects malformed payloads on both endpoints', async () => {
    const handler = handlerWith(() => { throw new Error('readActivity must not run') })
    const bad: readonly unknown[] = [{}, { sessionId: '' }, { sessionId: '   ' }, { sessionId: 42 }, { sessionId: 'a', extra: 1 }, null, 's-1', []]
    for (const endpoint of [ACTIVITY_ENDPOINT, ACTIVITY_BINDING_ENDPOINT]) {
      for (const payload of bad) {
        expect(await handler(endpoint, payload)).toEqual({ ok: false, error: { code: 'internal', message: 'invalid Antigravity activity request' } })
      }
    }
  })

  it('sanitizes storage failures without fs paths', async () => {
    const leaking = handlerWith(() => { throw new Error("EACCES: permission denied, open '/secret/history.jsonl'") })
    const denied = await leaking(ACTIVITY_ENDPOINT, { sessionId: 's' })
    expect(denied).toEqual({ ok: false, error: { code: 'internal', message: 'Antigravity activity history is unavailable' } })
    expect(JSON.stringify(denied)).not.toContain('/secret')
    const corruptStore = handlerWith(() => { throw new Error('Antigravity activity history is corrupt: line 1 is not JSON') })
    expect(await corruptStore(ACTIVITY_ENDPOINT, { sessionId: 's' })).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Antigravity activity history is corrupt: line 1 is not JSON' },
    })
  })
})

describe('decodeActivityHistory', () => {
  it('round-trips store output and rejects bad versions and records', () => {
    const store = new AntigravityActivityStore(tempRoot())
    store.append('s', [readyEvent, startEvent])
    const wire: unknown = JSON.parse(JSON.stringify(store.read('s')))
    expect(decodeActivityHistory(wire)).toEqual(store.read('s'))
    const first = (wire as AntigravityActivityHistory).records[0]!
    expect(decodeActivityHistory({ version: 1, records: [{ ...first, v: 999 }] }).records).toHaveLength(1)
    expect(() => decodeActivityHistory({ version: 999, records: [] })).toThrow(/corrupt/)
    expect(() => decodeActivityHistory({ version: 1, records: [{ seq: 1 }] })).toThrow(/corrupt/)
    expect(() => decodeActivityHistory(null)).toThrow(/corrupt/)
  })
})
