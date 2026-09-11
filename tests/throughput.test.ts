import { expect, it } from 'vitest'
import { providerId, toolId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import { bridgeWithStubProvider, VALID_MODES, validListModel, validRef } from './bridge-fixtures.js'

it.each([
  { plan: false, cancelTurn: 0 },
  { plan: true, cancelTurn: 0 },
  { plan: false, cancelTurn: 1 },
])('forwards validated native usage chunks: %j', async ({ plan, cancelTurn }) => {
  let turns = 0
  const adapter = bridgeWithStubProvider({
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    listModels: async () => [validListModel()],
    openSession: async () => ({
      ref: validRef(), supportedModes: [...VALID_MODES], dispose: async () => undefined,
      runTurn: async (_request: unknown, host: ExternalAgentTurnHost) => {
        turns += 1
        await host.publish({ type: 'thought-delta', text: 'thinking' })
        await host.publish({ type: 'assistant-delta', text: '# Plan' })
        await host.publish({ type: 'tool-activity', toolId: toolId('tool' + turns), name: 'Read', status: 'completed' })
        await host.publish({ type: 'usage', inputTokens: 11 * turns, outputTokens: 7 * turns })
        return { status: turns === cancelTurn ? 'cancelled' : 'completed', text: '# Plan' }
      },
    }),
  } as never, undefined, undefined, {
    isPlanMode: () => plan,
    ask: async request => ({ answers: [{ id: request.questions[0]!.id, selected: ['Approve'] }] }),
  })
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 's-throughput', messages: [{ role: 'user', content: 'go' }] })) chunks.push(chunk)
  expect(turns).toBe(plan && cancelTurn === 0 ? 2 : 1)
  expect(chunks.filter(chunk => chunk.type === 'usage')).toEqual(
    (plan && cancelTurn === 0 ? [1, 2] : [1]).map(turn => ({ type: 'usage', usage: { inputTokens: 11 * turn, outputTokens: 7 * turn } })),
  )
})
