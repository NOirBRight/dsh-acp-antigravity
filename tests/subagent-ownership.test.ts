import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { providerId, type ExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'
import { AntigravityActivityStore } from '../src/activity-store.js'
import { bridgeWithStubProvider, VALID_MODES, validListModel, validRef } from './bridge-fixtures.js'
import { decodeActivityHistory } from '../src/activity-contract.js'
import { normalizeAntigravitySessionUpdate } from '../src/mapping.js'
import {
  ANTIGRAVITY_AGENT_OBSERVED,
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_TOOL_START,
  foldAntigravityToolEvent,
  isToolOwnership,
  toDurableAgentEvents,
  toDurableToolEvents,
  toolOwnershipOf,
  withToolOwnership,
} from '../src/tool-events.js'

const BOUNDS = { maxTextBytes: 1024, maxPayloadBytes: 4096 }
const CHILD = { trajectoryId: 'child-9', parentTrajectoryId: 'main', depth: 2 }
const ROOT = { trajectoryId: 'main', depth: 0 }

function toolCall(extra: Record<string, unknown>) {
  return { sessionUpdate: 'tool_call', toolCallId: 't-1', title: 'run', status: 'in_progress', ...extra }
}

describe('native trajectory ownership decoding', () => {
  it('accepts a complete child linkage', () => {
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': CHILD } })).toEqual(CHILD)
    expect(isToolOwnership(CHILD)).toBe(true)
  })

  it('accepts a root linkage without parent fields', () => {
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': ROOT } })).toEqual(ROOT)
  })

  it('treats absent or foreign linkage as unavailable, never fabricated', () => {
    expect(toolOwnershipOf({})).toBeUndefined()
    expect(toolOwnershipOf({ _meta: {} })).toBeUndefined()
    expect(toolOwnershipOf({ _meta: { 'other.key': CHILD } })).toBeUndefined()
    expect(toolOwnershipOf(null)).toBeUndefined()
    expect(isToolOwnership(undefined)).toBe(false)
  })

  it('rejects malformed bags', () => {
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': { trajectoryId: '' } } })).toBeUndefined()
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': { trajectoryId: 't', parentTrajectoryId: 7 } } })).toBeUndefined()
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': { trajectoryId: 't', depth: -1 } } })).toBeUndefined()
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': { trajectoryId: 't', depth: true } } })).toBeUndefined()
    expect(toolOwnershipOf({ _meta: { 'agy.trajectory': 'child-9' } })).toBeUndefined()
  })

  it('attaches ownership to ownable tool, thought, and message events', () => {
    const base = normalizeAntigravitySessionUpdate(toolCall({}), BOUNDS)
    if (base === null) throw new Error('expected a tool-activity event')
    const plain = withToolOwnership(base, undefined)
    expect(plain).toBe(base)
    const owned = withToolOwnership({ type: 'assistant-delta', text: 'hi' }, CHILD)
    expect(owned).toEqual({ type: 'assistant-delta', text: 'hi', ownership: CHILD })
    const other = withToolOwnership({ type: 'notice', level: 'info', message: 'hi' }, CHILD)
    expect(other).toEqual({ type: 'notice', level: 'info', message: 'hi' })
  })
})

describe('ownership through normalize and durable events', () => {
  it('carries _meta linkage onto the tool-activity event', () => {
    const event = normalizeAntigravitySessionUpdate(toolCall({ _meta: { 'agy.trajectory': CHILD } }), BOUNDS)
    expect(event).toMatchObject({ type: 'tool-activity', ownership: CHILD })
  })

  it('omits ownership for unpatched servers and invalid bags', () => {
    expect(normalizeAntigravitySessionUpdate(toolCall({}), BOUNDS)).not.toHaveProperty('ownership')
    const bad = normalizeAntigravitySessionUpdate(toolCall({ _meta: { 'agy.trajectory': { trajectoryId: '' } } }), BOUNDS)
    expect(bad).not.toHaveProperty('ownership')
  })

  it('emits ownership on start and subsequent updates', () => {
    const seen = new Set<string>()
    const first = toDurableToolEvents({ toolId: 'c-1', name: 'run_command', status: 'running', ownership: CHILD }, seen)
    expect(first[0]).toMatchObject({ type: ANTIGRAVITY_TOOL_START, data: { ownership: CHILD } })
    for (const event of first) if (event.type !== ANTIGRAVITY_AGENT_OBSERVED) seen.add(event.data.toolId)
    const second = toDurableToolEvents({ toolId: 'c-1', name: 'run_command', status: 'completed', ownership: CHILD }, seen)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ data: { ownership: CHILD, status: 'completed' } })
  })

  it('retains start ownership across updates that close the row without linkage', () => {
    const seen = new Set<string>()
    const first = toDurableToolEvents({ toolId: 'p-1', name: 'read', status: 'running', ownership: ROOT }, seen)
    for (const event of first) if (event.type !== ANTIGRAVITY_AGENT_OBSERVED) seen.add(event.data.toolId)
    const sweep = toDurableToolEvents({ toolId: 'p-1', name: 'read', status: 'failed' }, seen)
    const state = [...first, ...sweep].reduce(foldAntigravityToolEvent, undefined)
    expect(state).toMatchObject({ toolId: 'p-1', status: 'failed', ownership: ROOT })
  })

  it('adopts ownership when the execution update reconciles a bare permission start', () => {
    const seen = new Set<string>()
    const start = toDurableToolEvents({ toolId: 'frame-1', name: 'read', status: 'pending' }, seen)
    for (const event of start) if (event.type !== ANTIGRAVITY_AGENT_OBSERVED) seen.add(event.data.toolId)
    const exec = toDurableToolEvents({ toolId: 'frame-1', name: 'read', status: 'running', ownership: ROOT }, seen)
    const state = [...start, ...exec].reduce(foldAntigravityToolEvent, undefined)
    expect(state).toMatchObject({ toolId: 'frame-1', status: 'running', ownership: ROOT })
  })

  it('keeps concurrent child containers independent', () => {
    const other = { trajectoryId: 'child-10', parentTrajectoryId: 'main', depth: 1 }
    const a = toDurableToolEvents({ toolId: 'a-1', name: 'run_command', status: 'running', ownership: CHILD }, new Set())
    const b = toDurableToolEvents({ toolId: 'b-1', name: 'run_command', status: 'running', ownership: other }, new Set())
    const stateA = a.reduce(foldAntigravityToolEvent, undefined)
    const stateB = b.reduce(foldAntigravityToolEvent, undefined)
    expect(stateA).toMatchObject({ ownership: CHILD })
    expect(stateB).toMatchObject({ ownership: other })
    expect(stateA?.ownership).not.toEqual(stateB?.ownership)
  })

  it('never equates launch completion with child success', () => {
    const seen = new Set<string>()
    const launch = toDurableToolEvents({ toolId: 'launch-1', name: 'start_subagent', status: 'running', ownership: ROOT }, seen)
    for (const event of launch) if (event.type !== ANTIGRAVITY_AGENT_OBSERVED) seen.add(event.data.toolId)
    const launched = toDurableToolEvents({ toolId: 'launch-1', name: 'start_subagent', status: 'completed', ownership: ROOT }, seen)
    const childEvents = toDurableToolEvents({ toolId: 'c-9', name: 'run_command', status: 'running', ownership: CHILD }, new Set())
    const launchState = [...launch, ...launched].reduce(foldAntigravityToolEvent, undefined)
    const childState = childEvents.reduce(foldAntigravityToolEvent, undefined)
    expect(launchState).toMatchObject({ status: 'completed', ownership: ROOT })
    expect(childState).toMatchObject({ status: 'running', ownership: CHILD })
  })
})

describe('ownership through the activity contract', () => {
  it('round-trips owned rows through history decode', () => {
    const seen = new Set<string>()
    const events = toDurableToolEvents({ toolId: 'c-1', name: 'run_command', status: 'completed', output: 'done', ownership: CHILD }, seen)
    const time = new Date().toISOString()
    const wire = {
      version: 1,
      records: events.map((event, index) => ({ seq: index + 1, time, v: 1, type: event.type, data: event.data })),
    }
    const history = decodeActivityHistory(wire)
    expect(history.records.map(record => record.data)).toMatchObject([{ ownership: CHILD }, { ownership: CHILD }])
  })

  it('rejects corrupt ownership while accepting absent linkage', () => {
    const time = new Date().toISOString()
    const start = { seq: 1, time, v: 1, type: ANTIGRAVITY_TOOL_START, data: { toolId: 't', name: 'read', status: 'running' } }
    expect(decodeActivityHistory({ version: 1, records: [start] }).records).toHaveLength(1)
    const bad = { seq: 1, time, v: 1, type: ANTIGRAVITY_TOOL_START, data: { toolId: 't', name: 'read', status: 'running', ownership: { trajectoryId: '' } } }
    expect(() => decodeActivityHistory({ version: 1, records: [bad] })).toThrow(/corrupt/)
  })
})

describe('agent discovery converter', () => {
  it('emits one descriptor for a newly seen child trajectory', () => {
    expect(toDurableAgentEvents(CHILD, new Set())).toEqual([{ type: ANTIGRAVITY_AGENT_OBSERVED, data: CHILD }])
  })

  it('discovers a parent-linked child even when depth is absent', () => {
    const linked = { trajectoryId: 'child-3', parentTrajectoryId: 'main' }
    expect(toDurableAgentEvents(linked, new Set())).toEqual([{ type: ANTIGRAVITY_AGENT_OBSERVED, data: linked }])
    expect(toDurableAgentEvents({ trajectoryId: 'child-4', depth: 1 }, new Set())).toHaveLength(1)
  })

  it('never fabricates descriptors for the root or unknown linkage', () => {
    expect(toDurableAgentEvents(ROOT, new Set())).toEqual([])
    expect(toDurableAgentEvents({ trajectoryId: 'main' }, new Set())).toEqual([])
    expect(toDurableAgentEvents(undefined, new Set())).toEqual([])
    expect(toDurableAgentEvents(CHILD, new Set(['child-9']))).toEqual([])
  })
})

describe('ownership on text branches', () => {
  it('carries _meta linkage onto thought and message deltas', () => {
    const thought = normalizeAntigravitySessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' }, _meta: { 'agy.trajectory': CHILD } }, BOUNDS)
    expect(thought).toMatchObject({ type: 'thought-delta', ownership: CHILD })
    const message = normalizeAntigravitySessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' }, _meta: { 'agy.trajectory': CHILD } }, BOUNDS)
    expect(message).toMatchObject({ type: 'assistant-delta', ownership: CHILD })
  })

  it('leaves unowned deltas exactly as before', () => {
    expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }, BOUNDS)).toEqual({ type: 'thought-delta', text: 'hmm' })
  })

  it('refuses to fold descriptors into tool rows', () => {
    expect(() => foldAntigravityToolEvent(undefined, { type: ANTIGRAVITY_AGENT_OBSERVED, data: CHILD })).toThrow(/not a tool row/)
  })
})

describe('agent descriptors through the activity contract', () => {
  it('round-trips descriptors with ownership data directly', () => {
    const time = new Date().toISOString()
    const wire = { version: 1, records: [{ seq: 1, time, v: 1, type: ANTIGRAVITY_AGENT_OBSERVED, data: CHILD }] }
    expect(decodeActivityHistory(wire).records).toEqual([{ seq: 1, time, type: ANTIGRAVITY_AGENT_OBSERVED, data: CHILD }])
  })

  it('rejects corrupt descriptor linkage', () => {
    const time = new Date().toISOString()
    const bad = { version: 1, records: [{ seq: 1, time, v: 1, type: ANTIGRAVITY_AGENT_OBSERVED, data: { trajectoryId: '' } }] }
    expect(() => decodeActivityHistory(bad)).toThrow(/corrupt/)
  })
})

describe('zero-tool child provider to real sidecar regression', () => {
  it('discovers a text-only child once across turns without tool rows or stored text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-agent-'))
    try {
      const store = new AntigravityActivityStore(root)
      const adapter = bridgeWithStubProvider({
        info: { id: providerId('antigravity'), name: 'Antigravity' },
        health: { status: 'ready' },
        listModels: async () => [validListModel()],
        openSession: async () => ({
          ref: validRef(),
          supportedModes: [...VALID_MODES],
          runTurn: async (_request: unknown, host: { publish: (event: ExternalAgentEvent) => Promise<void> }) => {
            await host.publish(withToolOwnership({ type: 'thought-delta', text: 'child thinking' }, CHILD))
            await host.publish(withToolOwnership({ type: 'thought-delta', text: 'still thinking' }, CHILD))
            await host.publish(withToolOwnership({ type: 'assistant-delta', text: 'child says hi' }, CHILD))
            await host.publish(withToolOwnership({ type: 'thought-delta', text: 'root thinking' }, ROOT))
            return { status: 'completed', text: 'child says hi' }
          },
          dispose: async () => undefined,
        }),
      } as never, undefined, undefined, {
        appendSessionReady: sessionId => {
          if (sessionId !== undefined) store.append(sessionId, [{ type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' as const } }])
        },
        appendToolEvents: (sessionId, events) => {
          if (sessionId !== undefined) store.append(sessionId, events)
        },
      })
      const streamOnce = async (): Promise<string> => {
        let text = ''
        for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 'session-agent-1', messages: [{ role: 'user', source: { kind: 'user' }, content: 'go' }] })) {
          const item = chunk as { type: string; text?: string }
          if (item.type === 'text-delta' && item.text !== undefined) text += item.text
        }
        return text
      }
      expect(await streamOnce()).toBe('child says hi')
      expect(await streamOnce()).toBe('child says hi')
      const history = store.read('session-agent-1')
      const descriptors = history.records.filter(record => record.type === ANTIGRAVITY_AGENT_OBSERVED)
      expect(descriptors).toHaveLength(1)
      expect(descriptors[0]).toMatchObject({ data: CHILD })
      expect(history.records.some(record => record.type === ANTIGRAVITY_TOOL_START)).toBe(false)
      expect(JSON.stringify(history.records)).not.toContain('still thinking')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
