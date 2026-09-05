import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/web/index.ts'

function registrationBench() {
  const entries: Array<{ spec: Record<string, unknown>; component: unknown }> = []
  const definitions: unknown[] = []
  const registerProvider = vi.fn(() => vi.fn())
  const ctx = {
    locale: { register: vi.fn(() => vi.fn()), bind: vi.fn(() => (key: string) => key) },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (spec: Record<string, unknown>, component: unknown) => { entries.push({ spec, component }); return vi.fn() },
      entries: () => [] as { options: { id?: string } }[],
      subscribe: () => () => undefined,
    },
    connection: { rpc: { call: vi.fn() } },
    uiConversation: { events: { register: (definition: unknown) => { definitions.push(definition); return vi.fn() } } },
    get: (name: string) => name === 'providerDirectory' ? { register: registerProvider } : undefined,
    effect: (register: () => unknown) => register(),
  }
  apply(ctx as never)
  return { entries, definitions, registerProvider }
}

describe('client plugin composition', () => {
  it('registers the External Agents settings section', () => {
    const { entries } = registrationBench()
    expect(entries.map(({ spec }) => spec.name)).toEqual(['conversation.chat.node', 'settings.provider.item'])
    expect(entries[0]?.spec).toMatchObject({ key: 'antigravity-tool' })
    expect(entries[1]?.spec).toMatchObject({ key: 'antigravity' })
    const face = (entries[1]!.spec.inject as () => Record<string, unknown>)()
    expect(face).toEqual(expect.objectContaining({
      t: expect.any(Function),
      load: expect.any(Function),
      save: expect.any(Function),
      run: expect.any(Function),
      pick: expect.any(Function),
    }))
  })

  it('folds replayable native tool start and update events by stable id', () => {
    const { definitions } = registrationBench()
    const definition = definitions[0] as {
      match(event: { type: string; data: { toolId: string } }): { id: string; role: string } | null
      start(context: unknown, match: { event: { data: Record<string, unknown> } }): Record<string, unknown>
      update(context: { state: Record<string, unknown> }, match: { event: { data: Record<string, unknown> } }): Record<string, unknown>
    }
    const start = { type: 'antigravity/tool-start', data: { toolId: 'tool-1', name: 'read', status: 'running' } }
    const end = { type: 'antigravity/tool-update', data: { toolId: 'tool-1', status: 'completed', output: 'ok' } }
    expect(definition.match(start)).toEqual({ id: 'tool-1', role: 'start' })
    const state = definition.start({}, { event: start })
    expect(definition.update({ state }, { event: end })).toMatchObject({ name: 'read', status: 'completed', output: 'ok' })
  })

  it('publishes the Antigravity card as an Agent provider', () => {
    const { registerProvider } = registrationBench()
    expect(registerProvider).toHaveBeenCalledWith({ key: 'antigravity', role: 'agent' })
  })

  it('declares the required browser services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'uiConversation'])
  })
})
