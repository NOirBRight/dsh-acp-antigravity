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
})
