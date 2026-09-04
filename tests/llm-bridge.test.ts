import { describe, expect, it } from 'vitest'
import { createAntigravityLlmBridge, lastUserText } from '../src/llm-bridge.js'
import { providerId } from '@deepseek-ai/dsh-acp-provider'

describe('Antigravity LLM bridge', () => {
  it('extracts the latest user text', () => {
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

  it('projects thought and tool activity without DSH tool-call blocks', async () => {
    const adapter = createAntigravityLlmBridge(() => ({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      health: { status: 'ready' },
      listModels: async () => [{ id: 'gemini', name: 'Gemini' }],
      openSession: async () => ({
        ref: {},
        supportedModes: [],
        runTurn: async (_request: unknown, host: { publish: (event: Record<string, unknown>) => Promise<void> }) => {
          await host.publish({ type: 'thought-delta', text: 'thinking' })
          await host.publish({ type: 'tool-activity', name: 'Read', status: 'completed', input: 'src/a.ts' })
          await host.publish({ type: 'assistant-delta', text: 'done' })
          return { status: 'completed', text: 'done' }
        },
        dispose: async () => undefined,
      }),
    }) as never)
    const chunks: { type: string; text?: string }[] = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', messages: [{ role: 'user', source: { kind: 'user' }, content: 'go' }] })) {
      chunks.push(chunk as { type: string; text?: string })
    }
    expect(chunks.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === 'thinking')).toBe(true)
    expect(chunks.some(chunk => chunk.type === 'text-delta' && (chunk.text ?? '').includes('Read'))).toBe(true)
    expect(chunks.some(chunk => chunk.type === 'tool-call-delta')).toBe(false)
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
