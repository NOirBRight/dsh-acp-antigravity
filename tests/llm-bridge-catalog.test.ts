import { describe, expect, it } from 'vitest'
import { providerId } from '@deepseek-ai/dsh-acp-provider'
import { mergeModelFacts } from '../src/model-metadata.js'
import type { AntigravityCatalogContext } from '../src/llm-bridge.js'
import { bridgeWithStubProvider, callsTo, collectStream, finishOf, makeAntigravityHarness, paramField, VALID_MODES, validListModel, validRef } from './bridge-fixtures.js'

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
      reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }], defaultEffort: 'high' },
    })
    const listed = await adapter.listModels('antigravity')
    expect(listed).toEqual([{ provider: 'antigravity', id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }])
    await adapter.dispose()
  })

  it('presets a level for a model with no discovery and no saved override', async () => {
    let cached = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ]
    const adapter = bridgeWithStubProvider(provider(cached), () => cached, next => { cached = [...next] })
    const flash = await adapter.resolveModel('antigravity', 'gemini-3.8-flash')
    expect(flash.reasoning?.defaultEffort).toBe('high')
    expect(flash.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium'])
    expect((await adapter.resolveModel('antigravity', 'gemini-pro-agent')).reasoning?.defaultEffort).toBe('high')
    await adapter.dispose()
  })

  it('lets a saved override replace the preset and falls back to the preset without one', async () => {
    let cached = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    ]
    let context: AntigravityCatalogContext = { overrides: { 'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', reasoning: { efforts: [], defaultEffort: 'medium' } } } }
    const adapter = bridgeWithStubProvider(provider(cached), () => cached, next => { cached = [...next] }, undefined, undefined, () => context)
    expect((await adapter.resolveModel('antigravity', 'gemini-3.8-flash')).reasoning?.defaultEffort).toBe('medium')
    // A stored level the catalog can no longer route falls back to the preset.
    context = { overrides: { 'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', reasoning: { efforts: [], defaultEffort: 'low' } } } }
    expect((await adapter.resolveModel('antigravity', 'gemini-3.8-flash')).reasoning?.defaultEffort).toBe('high')
    // An override that stores no level keeps the model's own preset.
    context = { overrides: { 'gemini-3.8-flash': { name: 'Renamed' } } }
    expect((await adapter.resolveModel('antigravity', 'gemini-3.8-flash')).reasoning?.defaultEffort).toBe('high')
    await adapter.dispose()
  })

  it('carries the account default variant and the saved override into the Host directory', async () => {
    let cached = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    ]
    const adapter = bridgeWithStubProvider(
      provider(cached),
      () => cached,
      next => { cached = [...next] },
      undefined,
      undefined,
      () => ({ declaredDefaultModelId: 'gemini-3.8-flash-medium' }),
    )
    const discovered = await adapter.resolveModel('antigravity', 'gemini-3.8-flash')
    expect(discovered.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium'])
    expect(discovered.reasoning?.defaultEffort).toBe('medium')
    await adapter.dispose()
  })

  it('projects the saved default effort over the discovered one and never sends an unroutable one', async () => {
    let cached = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    ]
    const savedEfforts = [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }]
    let context: AntigravityCatalogContext = { overrides: { 'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', reasoning: { efforts: savedEfforts, defaultEffort: 'high' } } } }
    const adapter = bridgeWithStubProvider(provider(cached), () => cached, next => { cached = [...next] }, undefined, undefined, () => context)
    const chosen = await adapter.resolveModel('antigravity', 'gemini-3.8-flash')
    expect(chosen.reasoning?.defaultEffort).toBe('high')
    // A stored level the current catalog can no longer route must not reach the
    // Host: the model's own preset stands in for it.
    context = { overrides: { 'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', reasoning: { efforts: savedEfforts, defaultEffort: 'medium' } } } }
    const unroutable = await adapter.resolveModel('antigravity', 'gemini-3.8-flash')
    expect(unroutable.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'low'])
    expect(unroutable.reasoning?.defaultEffort).toBe('high')
    await adapter.dispose()
  })

  it('keeps a deselected row resolvable because saved order is membership, not routing', async () => {
    let cached = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)' },
    ]
    const adapter = bridgeWithStubProvider(provider(cached), () => cached, next => { cached = [...next] }, undefined, undefined, () => ({
      overrides: { 'gemini-3.7-flash': { name: 'Gemini 3.7 Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } } },
    }))
    const listed = await adapter.listModels('antigravity')
    expect(listed.map(model => model.id)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash'])
    await expect(adapter.resolveModel('antigravity', 'gemini-3.8-flash')).resolves.toMatchObject({ id: 'gemini-3.8-flash' })
    await adapter.dispose()
  })

  it('sends the resolved effort as the native variant the ACP prompt uses', async () => {
    const harness = makeAntigravityHarness({
      models: [
        { value: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
        { value: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
      ],
    })
    try {
      const chunks = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-3.8-flash',
        reasoningEffort: 'medium',
        sessionId: 'e2e-effort',
        messages: [{ role: 'user', source: { kind: 'user' }, content: 'go' }],
      }))
      expect(finishOf(chunks)?.kind).toBe('stop')
      expect(callsTo(harness.world, 'session/set_config_option', params => paramField(params, 'value') === 'gemini-3.8-flash-medium').length).toBeGreaterThan(0)
      expect(callsTo(harness.world, 'session/set_config_option', params => paramField(params, 'value') === 'gemini-3.8-flash-high')).toHaveLength(0)
    } finally {
      await harness.dispose()
    }
  })
})
