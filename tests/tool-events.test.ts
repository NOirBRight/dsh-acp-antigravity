import { describe, expect, it } from 'vitest'
import { providerId } from '@deepseek-ai/dsh-acp-provider'
import { createAntigravityLlmBridge } from '../src/llm-bridge.js'
import {
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  foldAntigravityToolEvent,
  toDurableToolEvents,
  type AntigravityToolEvent,
} from '../src/tool-events.js'

describe('ACP tool activity durable event family', () => {
  it('maps one native tool notification to replayable start/update with a stable id', () => {
    const seen = new Set<string>()
    const first = toDurableToolEvents(
      { toolId: 'tool-1', name: 'read', status: 'running', input: '{\"path\":\"/workspace/src/a.ts\"}' },
      seen,
    )
    expect(first[0]?.type).toBe(ANTIGRAVITY_TOOL_START)
    expect(first[0]).toMatchObject({ data: { toolId: 'tool-1', name: 'read' } })
    for (const event of first) if (event.type === ANTIGRAVITY_TOOL_START) seen.add(event.data.toolId)
    for (const event of first) if (event.type === ANTIGRAVITY_TOOL_UPDATE) seen.add(event.data.toolId)
    const second = toDurableToolEvents(
      { toolId: 'tool-1', name: 'read', status: 'completed', output: 'hello' },
      seen,
    )
    expect(second.some(event => event.type === ANTIGRAVITY_TOOL_START)).toBe(false)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'tool-1', status: 'completed' } })
    let state = undefined
    for (const event of [...first, ...second]) state = foldAntigravityToolEvent(state, event)
    expect(state).toMatchObject({ toolId: 'tool-1', name: 'read', status: 'completed' })
  })

  it('adds a completion-only path to an existing tool row', () => {
    const seen = new Set<string>()
    const start = toDurableToolEvents({ toolId: 'tool-late', name: 'read', status: 'running' }, seen)
    for (const event of start) seen.add(event.data.toolId)
    const completed = toDurableToolEvents({
      toolId: 'tool-late', name: 'read', status: 'completed', output: '{\"workingDir\":\"/workspace/src\"}',
    }, seen)
    expect(completed).toEqual([
      { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'tool-late', status: 'completed', location: { target: '/workspace/src', kind: 'file' } } },
    ])
    expect([...start, ...completed].reduce(foldAntigravityToolEvent, undefined)).toMatchObject({ location: { target: '/workspace/src' } })
  })

  it('resolves a relative native path against the workspace', () => {
    const events = toDurableToolEvents({
      toolId: 'relative-1', name: 'read', status: 'running', input: '{\"path\":\"src/a.ts\"}',
    }, new Set(), '/workspace')
    expect(events[0]).toMatchObject({ data: { location: { target: '/workspace/src/a.ts', kind: 'file' } } })
  })

  it('normalizes URL targets without retaining native JSON', () => {
    const events = toDurableToolEvents({
      toolId: 'web-1', name: 'open_url', status: 'completed',
      input: '{\"url\":\"https://example.test/report\"}', output: '{\"combinedOutput\":\"opened\"}',
    }, new Set())
    expect(events).toEqual([
      { type: ANTIGRAVITY_TOOL_START, data: { toolId: 'web-1', name: 'open url', status: 'completed', location: { target: 'https://example.test/report', kind: 'url' } } },
      { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'web-1', status: 'completed', output: 'opened' } },
    ])
  })

  it('folds replayably without scanning the transcript window', () => {
    const seen = new Set<string>()
    const start = toDurableToolEvents({ toolId: 'tool-9', name: 'bash', status: 'running', input: 'ls' }, seen)
    for (const event of start) seen.add(event.data.toolId)
    const end = toDurableToolEvents({ toolId: 'tool-9', name: 'bash', status: 'failed', error: 'boom' }, seen)
    const viaReplace = [...start, ...end].reduce(foldAntigravityToolEvent, undefined)
    const tailOnly = [...end].reduce(foldAntigravityToolEvent, undefined)
    expect(viaReplace).toMatchObject({ toolId: 'tool-9', status: 'failed', error: 'boom' })
    expect(tailOnly).toMatchObject({ toolId: 'tool-9', status: 'failed' })
    expect(() => foldAntigravityToolEvent(viaReplace, { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'other', status: 'completed' } })).toThrow(/toolId/)
  })

  it('appends ACP activity as durable rows without a DSH tool-call or transcript dump', async () => {
    const appended: AntigravityToolEvent[] = []
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      health: { status: 'ready' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => ({
        ref: {},
        supportedModes: [],
        runTurn: async (_request: unknown, host: { publish: (event: Record<string, unknown>) => Promise<void> }) => {
          await host.publish({ type: 'tool-activity', toolId: 'tool-1', name: 'read', status: 'running', input: '{\"AbsolutePath\":\"/workspace/src/a.ts\"}' })
          await host.publish({ type: 'tool-activity', toolId: 'tool-1', name: 'read', status: 'completed', input: '{\"AbsolutePath\":\"/workspace/src/a.ts\"}', output: '{\"combinedOutput\":\"ok\"}' })
          await host.publish({ type: 'assistant-delta', text: 'done' })
          return { status: 'completed', text: 'done' }
        },
        dispose: async () => undefined,
      }),
    }) as never, undefined, undefined, {
      appendToolEvents: (_sessionId, events) => {
        for (const event of events) appended.push(event)
      },
    })
    const chunks: { type: string; text?: string; blockType?: string; block?: { type: string } }[] = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 'session-1', messages: [{ role: 'user', source: { kind: 'user' }, content: 'go' }] })) {
      chunks.push(chunk as { type: string; blockType?: string; block?: { type: string } })
    }
    expect(chunks.some(chunk => chunk.type === 'tool-call-delta')).toBe(false)
    expect(chunks.some(chunk => chunk.blockType === 'tool-call')).toBe(false)
    expect(chunks.some(chunk => chunk.block?.type === 'tool-call')).toBe(false)
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')).toBe('done')
    expect(appended).toEqual([
      { type: ANTIGRAVITY_TOOL_START, data: { toolId: 'tool-1', name: 'read', status: 'running', location: { target: '/workspace/src/a.ts', kind: 'file' } } },
      { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 'tool-1', status: 'completed', location: { target: '/workspace/src/a.ts', kind: 'file' }, output: 'ok' } },
    ])
  })
})
