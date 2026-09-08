import { expect, it, vi } from 'vitest'
import { providerId, toolId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import { bridgeWithStubProvider, VALID_MODES, validListModel, validRef } from './bridge-fixtures.js'

it.each([
  { plan: false, missing: false, cancelTurn: 0, expected: { inputTokens: 11, outputTokens: 7, generationElapsedMs: 300 } },
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
        now = base + 100
        await host.publish({ type: 'tool-activity', toolId: toolId('tool' + turns), name: 'Read', status: 'running' })
        now = base + 400
        await host.publish({ type: 'tool-activity', toolId: toolId('tool' + turns), name: 'Read', status: 'completed' })
        now = base + 600
        await host.publish({ type: 'assistant-delta', text: '# Plan' })
        if (!(missing && turns === 2)) {
          await host.publish({ type: 'usage', inputTokens: 1, outputTokens: 1 })
          await host.publish({ type: 'usage', inputTokens: 11 * turns, outputTokens: 7 * turns })
        }
        return { status: turns === cancelTurn ? 'cancelled' : 'completed', text: '# Plan' }
      },
    }),
  } as never, undefined, undefined, {
    ask: async request => ({ answers: [{ id: request.questions[0]!.id, selected: ['Approve'] }] }),
  })
  try {
    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 's-throughput', messages: [{ role: 'user', content: 'go' }], ...(plan ? { tools: [{ name: 'exit_plan_mode' }] } : {}) })) chunks.push(chunk)
    expect(turns).toBe(plan ? 2 : 1)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: cancelTurn ? 'aborted' : 'stop' } })
    expect(chunks.filter(chunk => chunk.type === 'usage')).toEqual(expected === null ? [] : [{ type: 'usage', usage: expected }])
  } finally {
    clock.mockRestore()
  }
})
