import { expect, it } from 'vitest'
import { providerId } from '@deepseek-ai/dsh-acp-provider'
import { bridgeWithStubProvider, VALID_MODES, validRef } from './bridge-fixtures.js'

const nativeModels = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', supportedModes: [...VALID_MODES] },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash Low', supportedModes: [...VALID_MODES] },
]

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) { /* drain */ }
}

it('opens a native turn from the live session picker instead of the assembled request', async () => {
  const opened: string[] = []
  const adapter = bridgeWithStubProvider({
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    health: { status: 'ready' },
    listModels: async () => nativeModels,
    openSession: async (request: { route: { model: string } }) => {
      opened.push(request.route.model)
      return { ref: validRef(), supportedModes: [...VALID_MODES], dispose: async () => undefined, runTurn: async () => ({ status: 'completed' as const, text: 'ok' }) }
    },
  }, undefined, undefined, {
    resolveSelectedModel: () => ({ model: 'gemini-3.8-flash', reasoningEffort: 'low' }),
  })
  try {
    await drain(adapter.stream({ provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', sessionId: 'live-selection', messages: [{ source: { kind: 'user' }, content: 'continue' }] }))
    expect(opened).toEqual(['gemini-3.8-flash-low'])
  } finally { await adapter.dispose() }
})

it('re-resolves a picker change made during plan review before the approved continuation', async () => {
  const opened: string[] = []
  const prompted: string[] = []
  let effort = 'high'
  let turns = 0
  const planModes: boolean[] = []
  const adapter = bridgeWithStubProvider({
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    health: { status: 'ready' },
    listModels: async () => nativeModels,
    openSession: async (request: { route: { model: string } }) => {
      opened.push(request.route.model)
      return {
        ref: validRef({ native: 'native-' + request.route.model }), supportedModes: [...VALID_MODES], dispose: async () => undefined,
        runTurn: async (turn: { model?: string }) => {
          prompted.push(turn.model ?? '')
          return { status: 'completed' as const, text: ++turns === 1 ? 'plan' : 'done' }
        },
      }
    },
  }, undefined, undefined, {
    isPlanMode: () => true,
    resolveSelectedModel: () => ({ model: 'gemini-3.8-flash', reasoningEffort: effort }),
    ask: async request => {
      effort = 'low'
      return { answers: [{ id: request.questions[0]!.id, selected: ['Approve'] }] }
    },
    setPlanMode: (_sessionId, active) => { planModes.push(active) },
  })
  try {
    await drain(adapter.stream({ provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', sessionId: 'review-selection', messages: [{ source: { kind: 'user' }, content: 'plan it' }] }))
    expect(planModes).toEqual([false])
    expect(opened).toEqual(['gemini-3.8-flash-high'])
    expect(prompted).toEqual(['gemini-3.8-flash-high', 'gemini-3.8-flash-low'])
  } finally { await adapter.dispose() }
})

it('fails closed when the live selection belongs to another provider', async () => {
  const adapter = bridgeWithStubProvider({
    info: { id: providerId('antigravity'), name: 'Antigravity' }, health: { status: 'ready' }, listModels: async () => nativeModels,
  }, undefined, undefined, {
    resolveSelectedModel: () => { throw new Error('Antigravity native turn refused: deepseek/deepseek-chat') },
  })
  try {
    await expect(drain(adapter.stream({ provider: 'antigravity', model: 'gemini-3.8-flash', sessionId: 'wrong-provider', messages: [{ source: { kind: 'user' }, content: 'continue' }] })))
      .rejects.toThrow('Antigravity native turn refused: deepseek/deepseek-chat')
  } finally { await adapter.dispose() }
})
