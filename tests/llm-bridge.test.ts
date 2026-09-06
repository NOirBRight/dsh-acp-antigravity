import { describe, expect, it } from 'vitest'
import { acpPrompt, createAntigravityLlmBridge, lastUserText, looksLikePlan, permissionModeFromMessages } from '../src/llm-bridge.js'
import { providerId } from '@deepseek-ai/dsh-acp-provider'
import type { AntigravityToolEvent } from '../src/tool-events.js'

describe('Antigravity LLM bridge', () => {
  it('extracts the latest user text', () => {
    expect(acpPrompt([
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'do it' }] },
      { role: 'user', source: { kind: 'skill-invocation', name: 'plan', form: 'instructions' }, content: [{ type: 'text', text: 'SKILL BODY' }] },
    ])).toBe('SKILL BODY' + String.fromCharCode(10) + String.fromCharCode(10) + 'do it')
    expect(permissionModeFromMessages([{ content: 'Approval policy: never. danger-full-access' }])).toBe('full-access')
    expect(looksLikePlan('# Ship it\n1. a')).toBe(true)
    expect(lastUserText([
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你是什么模型' }] },
      { role: 'user', source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'workspace instructions' }] },
      { role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'available skills' }] },
      { role: 'user', source: { kind: 'plugin', plugin: 'dsh-system-prompt', form: 'snapshot' }, content: [{ type: 'text', text: 'sandbox policy' }] },
    ])).toBe('你是什么模型')
  })

  it('streams ACP assistant deltas as LLM text chunks', async () => {
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      health: { status: 'ready' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => ({
        ref: {},
        supportedModes: [],
        runTurn: async (request: { prompt: string }, host: { publish: (event: { type: string; text: string }) => Promise<void> }) => {
          await host.publish({ type: 'assistant-delta', text: 'ok-' + request.prompt })
          return { status: 'completed', text: 'ok-' + request.prompt }
        },
        dispose: async () => undefined,
      }),
    }) as never)
    const chunks: unknown[] = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', messages: [{ role: 'user', source: { kind: 'user' }, content: 'ping' }] })) chunks.push(chunk)
    expect(chunks.some(chunk => typeof chunk === 'object' && chunk !== null && 'text' in chunk && (chunk as { text: string }).text === 'ok-ping')).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('projects thought while appending tool activity outside the assistant stream', async () => {
    const appended: AntigravityToolEvent[] = []
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      health: { status: 'ready' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => ({
        ref: {},
        supportedModes: [],
        runTurn: async (_request: unknown, host: { publish: (event: Record<string, unknown>) => Promise<void> }) => {
          await host.publish({ type: 'thought-delta', text: 'thinking' })
          await host.publish({ type: 'tool-activity', toolId: 'read-1', name: 'Read', status: 'completed', input: '{"path":"/workspace/src/a.ts"}', output: '{"combinedOutput":"ok"}' })
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
    const chunks: { type: string; text?: string }[] = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 'session-1', messages: [{ role: 'user', source: { kind: 'user' }, content: 'go' }] })) {
      chunks.push(chunk as { type: string; text?: string })
    }
    expect(chunks.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === 'thinking')).toBe(true)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && (chunk.text ?? '').includes('Read'))).toBe(false)
    expect(chunks.some(chunk => chunk.type === 'tool-call-delta')).toBe(false)
    expect(appended).toEqual([
      { type: 'antigravity/tool-start', data: { toolId: 'read-1', name: 'Read', status: 'completed', location: { target: '/workspace/src/a.ts', kind: 'file' } } },
      { type: 'antigravity/tool-update', data: { toolId: 'read-1', status: 'completed', output: 'ok' } },
    ])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('exposes the full staging LlmAdapter surface including prepareCall', async () => {
    const adapter = createAntigravityLlmBridge(() => undefined)
    for (const method of ['providerInfo', 'providerRetryPolicy', 'imageRequestPricing', 'listModels', 'resolveModel', 'prepareCall', 'stream'] as const) {
      expect(typeof adapter[method]).toBe('function')
    }
    const prepared = await adapter.prepareCall('antigravity', 'gemini-3.8-flash')
    expect(prepared.model).toEqual({ provider: 'antigravity', id: 'gemini-3.8-flash', name: 'gemini-3.8-flash' })
    expect(typeof prepared.stream).toBe('function')
  })

  it('disposes the fresh session and rejects when ready persistence fails once', async () => {
    let opens = 0
    let runTurns = 0
    let disposes = 0
    let readyCalls = 0
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => {
        opens += 1
        return {
          ref: {},
          supportedModes: [],
          runTurn: async () => { runTurns += 1; return { status: 'completed', text: 'ok' } },
          dispose: async () => { disposes += 1 },
        }
      },
    }) as never, undefined, undefined, {
      appendSessionReady: () => {
        readyCalls += 1
        if (readyCalls === 1) throw new Error('ready persistence failed')
      },
    })
    const options = { provider: 'antigravity', model: 'gemini', sessionId: 'ready-retry', messages: [{ role: 'user', source: { kind: 'user' }, content: 'ping' }] }
    await expect((async () => {
      for await (const chunk of adapter.stream(options)) void chunk
    })()).rejects.toThrow('ready persistence failed')
    expect(runTurns).toBe(0)
    expect(disposes).toBe(1)
    const chunks: { type: string; text?: string }[] = []
    for await (const chunk of adapter.stream(options)) chunks.push(chunk as { type: string; text?: string })
    expect(readyCalls).toBe(2)
    expect(opens).toBe(2)
    expect(runTurns).toBe(1)
    expect(disposes).toBe(1)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' })
    expect(chunks.some(chunk => (chunk.text ?? '').includes('ready persistence failed'))).toBe(false)
  })

  it('rejects without a successful finish when tool persistence fails', async () => {
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => ({
        ref: {},
        supportedModes: [],
        runTurn: async (_request: unknown, host: { publish: (event: Record<string, unknown>) => Promise<void> }) => {
          await host.publish({ type: 'assistant-delta', text: 'partial' })
          await host.publish({ type: 'tool-activity', toolId: 'tool-1', name: 'Read', status: 'completed', output: '{"combinedOutput":"ok"}' })
          return { status: 'completed', text: 'partial' }
        },
        dispose: async () => undefined,
      }),
    }) as never, undefined, undefined, {
      appendToolEvents: () => { throw new Error('tool persistence failed') },
    })
    const chunks: { type: string; reason?: string }[] = []
    await expect((async () => {
      for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 'tool-failure', messages: [{ role: 'user', source: { kind: 'user' }, content: 'go' }] })) {
        chunks.push(chunk as { type: string; reason?: string })
      }
    })()).rejects.toThrow('tool persistence failed')
    expect(chunks.some(chunk => chunk.type === 'finish')).toBe(false)
  })

  it('rejects startup open failures without caching the session', async () => {
    let opens = 0
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => { opens += 1; throw new Error('native exploded') },
    }) as never)
    const options = { provider: 'antigravity', model: 'gemini', messages: [{ role: 'user', source: { kind: 'user' }, content: 'ping' }] }
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect((async () => {
        for await (const chunk of adapter.stream(options)) void chunk
      })()).rejects.toThrow('native exploded')
    }
    expect(opens).toBe(2)
  })
})
