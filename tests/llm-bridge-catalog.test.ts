import { describe, expect, it } from 'vitest'
import { providerId } from '@deepseek-ai/dsh-acp-provider'
import { mergeModelFacts } from '../src/model-metadata.js'
import { bridgeWithStubProvider, VALID_MODES, validListModel, validRef } from './bridge-fixtures.js'

function provider(listed: { id: string; name: string }[]) {
  return {
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    health: { status: 'ready' as const },
    listModels: async () => listed.map(model => ({ ...model, supportedModes: [...VALID_MODES] })),
    openSession: async () => ({ ref: validRef(), supportedModes: [...VALID_MODES], dispose: async () => undefined, runTurn: async () => ({ status: 'completed' as const, text: '' }) }),
  }
}

describe('Antigravity LLM catalog Host shape', () => {
  it('echoes a native id so Host resolveModel id matches the request', async () => {
    const adapter = bridgeWithStubProvider(provider([
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    ]))
    await expect(adapter.resolveModel('antigravity', 'gemini-3.8-flash-high')).resolves.toMatchObject({ provider: 'antigravity', id: 'gemini-3.8-flash-high' })
    await expect(adapter.resolveModel('antigravity', 'gemini-3.8-flash')).resolves.toMatchObject({ id: 'gemini-3.8-flash' })
    await adapter.dispose()
  })

  it('forwards telemetry-spelled usage samples after canonical validation fails', async () => {
    const adapter = bridgeWithStubProvider({
      info: { id: providerId('antigravity'), name: 'Antigravity' },
      health: { status: 'ready' as const },
      listModels: async () => [validListModel()],
      openSession: async () => ({
        ref: validRef(),
        supportedModes: [...VALID_MODES],
        dispose: async () => undefined,
        runTurn: async (_request: unknown, host: { publish: (event: Record<string, unknown>) => Promise<void> }) => {
          await host.publish({ type: 'assistant-delta', text: 'done' })
          await host.publish({ type: 'usage', prompt_token_count: 100, candidates_token_count: 20, thoughts_token_count: 30, total_token_count: 150 })
          return { status: 'completed' as const, text: 'done' }
        },
      }),
    })
    const chunks: { type: string; usage?: Record<string, unknown> }[] = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', messages: [], sessionId: 's-usage-keys' })) {
      chunks.push(chunk as { type: string; usage?: Record<string, unknown> })
    }
    expect(chunks.filter(chunk => chunk.type === 'usage')).toEqual([
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, reasoningTokens: 30 } },
    ])
    await adapter.dispose()
  })

  it('nests contextWindow and omits extra catalog fields from resolve and list', async () => {
    const facts = new Map([
      ['gemini-3.8-flash-high', mergeModelFacts({ vision: true, thinking: true, inputTokenLimit: 1048576, maxOutputTokens: 65536 }, { contextWindow: 1048576 })],
      ['gemini-3.8-flash-low', mergeModelFacts({ vision: true, thinking: true, inputTokenLimit: 1048576, maxOutputTokens: 65536 }, { contextWindow: 1048576 })],
    ])
    let cached = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    ]
    const adapter = bridgeWithStubProvider(provider(cached), () => cached, next => { cached = [...next] }, undefined, () => facts)
    const resolved = await adapter.resolveModel('antigravity', 'gemini-3.8-flash')
    expect(resolved).toEqual({
      provider: 'antigravity',
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      inputModalities: ['text', 'image'],
      context: { contextWindow: 1048576 },
      defaultMaxTokens: 65536,
      reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] },
    })
    const listed = await adapter.listModels('antigravity')
    expect(listed).toEqual([{ provider: 'antigravity', id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }])
    await adapter.dispose()
  })
})
