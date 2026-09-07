import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ACP_SETTINGS_RPC_CHANNEL } from '../src/client-contract.js'
import {
  ACTIVITY_ENDPOINT,
  decodeActivityHistory,
  type AntigravityActivityRecord,
} from '../src/activity-contract.js'
import {
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  type AntigravityToolStatus,
} from '../src/tool-events.js'
import { foldActivityRecords, loadActivityRows, type AntigravityToolRowData } from '../src/web/native-activity.js'
import { AntigravityToolNode } from '../src/web/AntigravityToolNode.js'
import { en, type AcpSettingsKey } from '../src/web/locales.js'

const T0 = '2026-09-07T03:38:25.046Z'
const T1 = '2026-09-07T03:38:27.884Z'
const T2 = '2026-09-07T03:45:49.568Z'
const T3 = '2026-09-07T03:50:07.750Z'

type Location = { readonly target: string; readonly kind: 'file' | 'url' }

function start(seq: number, time: string, toolId: string, name: string, location?: Location): AntigravityActivityRecord {
  return {
    seq,
    time,
    type: ANTIGRAVITY_TOOL_START,
    data: location === undefined ? { toolId, name, status: 'running' } : { toolId, name, status: 'running', location },
  }
}

function update(
  seq: number,
  time: string,
  toolId: string,
  status: AntigravityToolStatus,
  fields?: { readonly location?: Location; readonly output?: string; readonly error?: string },
): AntigravityActivityRecord {
  return {
    seq,
    time,
    type: ANTIGRAVITY_TOOL_UPDATE,
    data: {
      toolId,
      status,
      ...(fields?.location === undefined ? {} : { location: fields.location }),
      ...(fields?.output === undefined ? {} : { output: fields.output }),
      ...(fields?.error === undefined ? {} : { error: fields.error }),
    },
  }
}

function ready(seq: number, time: string): AntigravityActivityRecord {
  return { seq, time, type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }
}

function t(key: AcpSettingsKey): string {
  return en[key]
}

function node(row: AntigravityToolRowData) {
  return createElement(AntigravityToolNode, { row, t })
}

describe('Antigravity native activity fold', () => {
  it('folds start and update into one row per tool', () => {
    const rows = foldActivityRecords([
      ready(1, T0),
      start(2, T0, 't-1', 'ls la'),
      update(3, T1, 't-1', 'completed', { location: { target: '/home/noirbright', kind: 'file' }, output: 'ok' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: '2',
      state: { toolId: 't-1', name: 'ls la', status: 'completed', output: 'ok' },
      time: T1,
    })
    expect(rows[0]?.state.location).toEqual({ target: '/home/noirbright', kind: 'file' })
  })

  it('folds an orphan update without inventing a name', () => {
    const rows = foldActivityRecords([update(1, T1, 'ghost', 'failed', { error: 'boom' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: { toolId: 'ghost', name: 'native tool', status: 'failed', error: 'boom' } })
  })

  it('splits repeated tool ids on session-ready so sessions never merge', () => {
    const rows = foldActivityRecords([
      ready(1, T0),
      start(2, T0, 'read', 'Running view file'),
      update(3, T1, 'read', 'completed', { output: 'first' }),
      ready(4, T2),
      start(5, T2, 'read', 'Running view file'),
      update(6, T3, 'read', 'failed', { error: 'boom' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ key: '2', state: { status: 'completed', output: 'first' }, time: T1 })
    expect(rows[1]).toMatchObject({ key: '5', state: { status: 'failed', error: 'boom' }, time: T3 })
  })

  it('keeps newline-bearing tool ids distinct from repeated plain ids', () => {
    const rows = foldActivityRecords([
      start(1, T0, 'a', 'A'),
      start(2, T0, 'a\nb', 'B'),
      update(3, T1, 'a', 'completed', { output: 'done' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.state.status).toBe('completed')
    expect(rows[1]?.state.status).toBe('running')
  })

  it('shows a completed spawn launch as recorded without claiming a child', () => {
    const rows = foldActivityRecords([
      start(79, T2, 'agent:26', 'Running start subagent'),
      update(80, T2, 'agent:26', 'completed', { output: 'Run parallel review subagents' }),
      start(309, T3, 'agent:31', 'Running start subagent'),
      update(310, T3, 'agent:31', 'failed', { output: 'Tool execution failed' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ state: { name: 'Running start subagent', status: 'completed', output: 'Run parallel review subagents' } })
    expect(rows[1]).toMatchObject({ state: { name: 'Running start subagent', status: 'failed' } })
  })
})

describe('Antigravity activity history', () => {
  it('decodes a versioned history and rejects malformed wire values', () => {
    const wire = {
      version: 1,
      records: [
        { seq: 1, time: T0, type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
        { seq: 2, time: T0, type: 'antigravity/tool-start', data: { toolId: 't', name: 'N', status: 'running' } },
      ],
    }
    expect(decodeActivityHistory(wire).records).toHaveLength(2)
    expect(decodeActivityHistory({ version: 1, records: [] })).toEqual({ version: 1, records: [] })
    expect(() => decodeActivityHistory({ version: 2, records: [] })).toThrow()
    expect(() => decodeActivityHistory({ version: 1, records: [wire.records[1], wire.records[1]] })).toThrow()
    expect(() => decodeActivityHistory({ version: 1, records: [{ ...wire.records[1], seq: 1, time: 'not-a-time' }] })).toThrow()
    expect(() => decodeActivityHistory({ version: 1, records: [{ ...wire.records[1], seq: 1, type: 'antigravity/unknown' }] })).toThrow()
  })
})

describe('Antigravity activity loader', () => {
  function okRpc(value: unknown) {
    return { call: vi.fn().mockResolvedValue({ ok: true, value }) }
  }

  it('reads one session history through the activity endpoint', async () => {
    const rpc = okRpc({
      version: 1,
      records: [
        { seq: 1, time: T0, type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
        { seq: 2, time: T0, type: 'antigravity/tool-start', data: { toolId: 't', name: 'ls la', status: 'running' } },
      ],
    })
    const rows = await loadActivityRows(rpc, 'session-1')
    expect(rpc.call).toHaveBeenCalledWith(ACP_SETTINGS_RPC_CHANNEL, ACTIVITY_ENDPOINT, { sessionId: 'session-1' }, undefined)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.state.name).toBe('ls la')
  })

  it('throws the host message when the endpoint reports failure', async () => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } }) }
    await expect(loadActivityRows(rpc, 'session-1')).rejects.toThrow('nope')
  })

  it('forwards abort to the rpc and propagates cancellation', async () => {
    let captured: AbortSignal | undefined
    const rpc = {
      call: vi.fn().mockImplementation((_channel: string, _endpoint: string, _payload: unknown, signal?: AbortSignal) => {
        captured = signal
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(signal.reason) })
        })
      }),
    }
    const controller = new AbortController()
    const pending = loadActivityRows(rpc, 'session-1', controller.signal)
    controller.abort()
    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(captured).toBe(controller.signal)
  })
})

describe('Antigravity tool row renderer', () => {
  it('renders a file target as plain text with localized status and raw data attribute', () => {
    const rows = foldActivityRecords([
      start(1, T0, 't', 'git status -s'),
      update(2, T1, 't', 'completed', { location: { target: '/home/noirbright', kind: 'file' }, output: 'fatal: not a git repository' }),
    ])
    const markup = renderToStaticMarkup(node(rows[0]!))
    expect(markup).toContain('git status -s')
    expect(markup).toContain(en.statusCompleted)
    expect(markup).not.toContain('>completed<')
    expect(markup).toContain('data-status="completed"')
    expect(markup).toContain('/home/noirbright')
    expect(markup).not.toContain('href=')
    expect(markup).toContain('fatal: not a git repository')
  })

  it('anchors http(s) targets out while ftp targets stay plain text', () => {
    const rows = foldActivityRecords([
      start(1, T0, 'fetch', 'Running fetch page'),
      update(2, T1, 'fetch', 'completed', { location: { target: 'https://example.com/x', kind: 'url' }, output: 'page' }),
    ])
    expect(renderToStaticMarkup(node(rows[0]!))).toContain('href="https://example.com/x"')
    const ftp = foldActivityRecords([
      start(1, T0, 'fetch', 'Running fetch page'),
      update(2, T1, 'fetch', 'completed', { location: { target: 'ftp://example.com/x', kind: 'url' } }),
    ])
    const ftpMarkup = renderToStaticMarkup(node(ftp[0]!))
    expect(ftpMarkup).toContain('ftp://example.com/x')
    expect(ftpMarkup).not.toContain('href=')
  })

  it('renders one launch row for a spawn with explicit unknown child status', () => {
    const rows = foldActivityRecords([
      start(79, T2, 'agent:26', 'Running start subagent'),
      update(80, T2, 'agent:26', 'completed', { output: 'Run parallel review subagents' }),
    ])
    const markup = renderToStaticMarkup(node(rows[0]!))
    expect(markup).toContain('Running start subagent')
    expect(markup).toContain(en.activityChildUnknown)
    expect(markup).toContain('Run parallel review subagents')
    expect(markup.match(/<section/g) ?? []).toHaveLength(1)
    expect(markup).not.toContain('tokens')
  })

  it('keeps the child note off ordinary tool rows', () => {
    const rows = foldActivityRecords([
      start(1, T0, 't', 'Running view file'),
      update(2, T1, 't', 'completed', { output: 'body' }),
    ])
    expect(renderToStaticMarkup(node(rows[0]!))).not.toContain(en.activityChildUnknown)
  })

  it('renders the recorded command line when the state carries one', () => {
    const rows = foldActivityRecords([start(1, T0, 't', 'git status -s')])
    const state = Object.assign({}, rows[0]!.state, { input: 'git status -s' })
    const markup = renderToStaticMarkup(node({ key: '1', state, time: T0, firstSeenAt: T0 }))
    expect(markup).toContain('git status -s')
  })

  it('renders a bare running row without disclosure', () => {
    const rows = foldActivityRecords([start(1, T0, 't', 'Running view file')])
    const markup = renderToStaticMarkup(node(rows[0]!))
    expect(markup).toContain('Running view file')
    expect(markup).not.toContain('<details')
  })
})
