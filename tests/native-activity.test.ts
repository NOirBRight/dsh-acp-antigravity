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
import { foldActivityRecords, loadActivityHistory, type AntigravityToolRowData } from '../src/web/native-activity.js'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { AntigravityToolNode } from '../src/web/AntigravityToolNode.js'
import { en } from '../src/web/locales.js'

const cardProps = vi.hoisted(() => [] as Record<string, unknown>[])

// The shared card resolves only once the host adds the ui-tool client module;
// until then this virtual stand-in records the exact props the node passes.
// Three-argument virtual mock: resolves at runtime here, but this vitest's
// types only allow two mock arguments. Delete this whole mock once the host
// adds the ui-tool client dependency and these tests go real.
vi.mock('@deepseek-ai/dsh-client-ui-tool/client', () => ({
  GenericToolCard: (props: Record<string, unknown>) => {
    cardProps.push(props)
    return 'mock-card'
  },
  // @ts-expect-error: three-argument virtual mock until the stand-in is deleted.
}), { virtual: true })

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

function conversationT(key: string): string {
  return key
}

function lastCard(): Record<string, unknown> {
  return cardProps[cardProps.length - 1] as Record<string, unknown>
}

function node(row: AntigravityToolRowData, translate: TranslateNS<'conversation'> = conversationT as TranslateNS<'conversation'>) {
  cardProps.length = 0
  return createElement(AntigravityToolNode, { row, t: translate })
}

describe('Antigravity native activity fold', () => {
  it('defers unowned permission previews without hiding owned pending tools or final failures', () => {
    const pending: AntigravityActivityRecord = { seq: 1, time: T0, type: ANTIGRAVITY_TOOL_START, data: { toolId: 'child', name: 'printf ALPHA', status: 'pending' } }
    const ownership = { trajectoryId: 'alpha', parentTrajectoryId: 'root' }
    expect(foldActivityRecords([pending])).toEqual([])
    expect(foldActivityRecords([{ ...pending, data: { ...pending.data, ownership } }])).toHaveLength(1)
    const rows = foldActivityRecords([pending, { seq: 2, time: T1, type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'child', name: 'Running run_command', status: 'running', ownership } }])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ firstSeenAt: T0, state: { name: 'Running run_command', ownership } })
    expect(foldActivityRecords([pending, update(2, T1, 'child', 'failed', { error: 'denied' })])).toHaveLength(1)
  })
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
    const { rows, agents } = await loadActivityHistory(rpc, 'session-1')
    expect(rpc.call).toHaveBeenCalledWith(ACP_SETTINGS_RPC_CHANNEL, ACTIVITY_ENDPOINT, { sessionId: 'session-1' }, undefined)
    expect(rows).toHaveLength(1)
    expect(agents).toEqual([])
    expect(rows[0]?.state.name).toBe('ls la')
  })

  it('throws the host message when the endpoint reports failure', async () => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: false, error: { message: 'nope' } }) }
    await expect(loadActivityHistory(rpc, 'session-1')).rejects.toThrow('nope')
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
    const pending = loadActivityHistory(rpc, 'session-1', controller.signal)
    controller.abort()
    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(captured).toBe(controller.signal)
  })
})

describe('Antigravity tool row renderer', () => {
  it('passes a normalized bash block with canonical args to the shared card', () => {
    const rows = foldActivityRecords([
      start(1, T0, 't', 'Running run command'),
      update(2, T1, 't', 'completed', { output: 'a.ts' }),
    ])
    const row = { ...rows[0]!, state: { ...rows[0]!.state, input: '{"CommandLine":"ls -la","description":"List"}' } }
    const markup = renderToStaticMarkup(node(row))
    expect(markup).toContain('mock-card')
    expect(lastCard()).toMatchObject({
      callId: 't',
      toolName: 'bash',
      block: {
        kind: 'tool-result',
        call: { name: 'bash', argsRaw: '{"command":"ls -la","description":"List"}' },
        content: [{ type: 'text', text: 'a.ts' }],
        isError: false,
      },
    })
  })

  it('passes the conversation seat through and no host callbacks', () => {
    const rows = foldActivityRecords([start(1, T0, 't', 'Running view file')])
    renderToStaticMarkup(node(rows[0]!))
    const props = lastCard()
    expect(props.t).toBe(conversationT)
    expect('openFile' in props).toBe(false)
    expect('inspect' in props).toBe(false)
  })

  it('keeps an unknown spawn launch verbatim as an ordinary settled row', () => {
    const rows = foldActivityRecords([
      start(79, T2, 'agent:26', 'Running start subagent'),
      update(80, T2, 'agent:26', 'completed', { output: 'Run parallel review subagents' }),
    ])
    const markup = renderToStaticMarkup(node(rows[0]!))
    expect(markup).toContain('mock-card')
    expect(markup).not.toContain(en.activityChildUnknown)
    expect(lastCard()).toMatchObject({
      toolName: 'Running start subagent',
      block: {
        kind: 'tool-result',
        content: [{ type: 'text', text: 'Run parallel review subagents' }],
        isError: false,
      },
    })
  })

  it('settles failed rows as errors with the error text', () => {
    const rows = foldActivityRecords([
      start(1, T0, 't', 'read file'),
      update(2, T1, 't', 'failed', { error: 'boom' }),
    ])
    renderToStaticMarkup(node(rows[0]!))
    expect(lastCard()).toMatchObject({
      toolName: 'read',
      block: { kind: 'tool-result', content: [{ type: 'text', text: 'boom' }], isError: true },
    })
  })

  it('keeps running rows unsettled with raw input preserved verbatim', () => {
    const rows = foldActivityRecords([start(1, T0, 't', 'git status -s')])
    const row = { ...rows[0]!, state: { ...rows[0]!.state, input: 'git status -s' } }
    renderToStaticMarkup(node(row))
    const props = lastCard()
    expect(props.toolName).toBe('git status -s')
    const block = props.block as Record<string, unknown>
    expect('kind' in block).toBe(false)
    expect(block).toMatchObject({ name: 'git status -s', argsRaw: 'git status -s' })
  })

  it('carries urls as card data with no outbound anchor of its own', () => {
    const rows = foldActivityRecords([
      start(1, T0, 'fetch', 'Running fetch page'),
      update(2, T1, 'fetch', 'completed', { location: { target: 'https://example.com/x', kind: 'url' }, output: 'page' }),
    ])
    const markup = renderToStaticMarkup(node(rows[0]!))
    expect(markup).not.toContain('href=')
    expect(lastCard()).toMatchObject({
      toolName: 'web_fetch',
      block: {
        kind: 'tool-result',
        call: { name: 'web_fetch', argsRaw: '{"url":"https://example.com/x"}' },
        content: [{ type: 'text', text: 'page' }],
      },
    })
  })
})
