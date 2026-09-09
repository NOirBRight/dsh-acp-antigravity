import { expect, it, vi } from 'vitest'
import { providerId, toolId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import { bridgeWithStubProvider, VALID_MODES, validListModel, validRef } from './bridge-fixtures.js'
import type { AntigravityUsageEvent } from '../src/request-telemetry.js'

it.each([
  { plan: false, missing: false, cancelTurn: 0, expected: { inputTokens: 11, outputTokens: 7, generationElapsedMs: null } },
  { plan: true, missing: false, cancelTurn: 0, expected: { inputTokens: 33, outputTokens: 21, generationElapsedMs: null } },
  { plan: true, missing: true, cancelTurn: 0, expected: null },
  { plan: false, missing: false, cancelTurn: 1, expected: null },
  { plan: true, missing: false, cancelTurn: 2, expected: null },
])('uses final true counts and measurable elapsed time: %j', async ({ plan, missing, cancelTurn, expected }) => {
  let now = 0
  let turns = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const adapter = bridgeWithStubProvider({
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    listModels: async () => [validListModel()],
    openSession: async () => ({
      ref: validRef(), supportedModes: [...VALID_MODES], dispose: async () => undefined,
      runTurn: async (_request: unknown, host: ExternalAgentTurnHost) => {
        turns += 1
        const base = (turns - 1) * 1000
        now = base
        await host.publish({ type: 'thought-delta', text: 'thinking' })
        now = base + 50
        await host.publish({ type: 'assistant-delta', text: '# Plan' })
        now = base + 100
        await host.publish({ type: 'tool-activity', toolId: toolId('tool' + turns), name: 'Read', status: 'running' })
        now = base + 400
        await host.publish({ type: 'tool-activity', toolId: toolId('tool' + turns), name: 'Read', status: 'completed' })
        now = base + 600
        await host.publish({ type: 'assistant-delta', text: ' more' })
        if (!(missing && turns === 2)) {
          await host.publish({ type: 'usage', inputTokens: 1, outputTokens: 1 })
          await host.publish({ type: 'usage', inputTokens: 11 * turns, outputTokens: 7 * turns })
        }
        return { status: turns === cancelTurn ? 'cancelled' : 'completed', text: '# Plan' }
      },
    }),
  } as never, undefined, undefined, {
    isPlanMode: () => plan,
    ask: async request => ({ answers: [{ id: request.questions[0]!.id, selected: ['Approve'] }] }),
  })
  try {
    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 's-throughput', messages: [{ role: 'user', content: 'go' }] })) chunks.push(chunk)
    expect(turns).toBe(plan ? 2 : 1)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: cancelTurn ? 'aborted' : 'stop' } })
    const samples = chunks.filter(chunk => chunk.type === 'usage')
    expect(samples.filter(chunk => chunk.usage.usageComplete !== false)).toEqual(expected === null ? [] : [{ type: 'usage', usage: expected }])
    const lastObserved = plan && !missing ? { inputTokens: 33, outputTokens: 21 } : { inputTokens: 11, outputTokens: 7 }
    expect(samples.at(-1)?.usage).toMatchObject({ ...lastObserved, ...(expected === null ? { usageComplete: false } : {}) })
  } finally {
    clock.mockRestore()
  }
})

it('delivers available SDK usage and request timing before a native turn is cancelled', async () => {
  let release!: () => void
  let published!: () => void
  const pendingTurn = new Promise<void>(resolve => { release = resolve })
  const observed = new Promise<void>(resolve => { published = resolve })
  const appendToolEvents = vi.fn()
  const event: AntigravityUsageEvent = { type: 'usage',
    usageSnapshots: { version: 1, provenance: 'sdk-cumulative', promptId: 'p', sessionKey: 'n', baseline: 'fresh-session', completed: false, start: null,
      end: { prompt_token_count: 10562, candidates_token_count: 83, thoughts_token_count: 268, total_token_count: 10913, cached_content_token_count: 0 } },
    requestTelemetry: { version: 1, provenance: 'ccpa-proxy', scope: 'session', promptId: 'p', sessionKey: 'n', requests: [{ requestId: 'r', model: 'gemini', status: 'completed', durationMs: 1000, usageMetadata: { promptTokenCount: 10562, candidatesTokenCount: 83, thoughtsTokenCount: 268, totalTokenCount: 10913 } }] },
  }
  const adapter = bridgeWithStubProvider({
    info: { id: providerId('antigravity'), name: 'Antigravity' }, listModels: async () => [validListModel()],
    openSession: async () => ({ ref: validRef(), supportedModes: [...VALID_MODES], dispose: async () => undefined,
      runTurn: async (_request: unknown, host: ExternalAgentTurnHost) => {
        await host.publish(event)
        published()
        await pendingTurn
        return { status: 'cancelled', text: '' }
      },
    }),
  } as never, undefined, undefined, { appendToolEvents })
  const stream = adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 's-partial', messages: [{ role: 'user', content: 'go' }] })[Symbol.asyncIterator]()
  let delivered = false
  const next = stream.next().then(value => { delivered = true; return value })
  try {
    await observed
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(delivered).toBe(true)
    expect((await next).value).toEqual({ type: 'usage', usage: { inputTokens: 10562, outputTokens: 351, reasoningTokens: 268, cacheReadTokens: 0, totalTokens: 10913, usageComplete: false, generationElapsedMs: null, requestThroughput: { outputTokens: 351, elapsedMs: 1000, requestCount: 1 } } })
    expect(appendToolEvents).toHaveBeenCalledTimes(2)
  } finally {
    release()
    await next
    await stream.return?.()
  }
})
