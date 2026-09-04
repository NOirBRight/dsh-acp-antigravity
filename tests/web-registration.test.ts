import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/web/index.ts'

function registrationBench() {
  const entries: Array<{ spec: Record<string, unknown>; component: unknown }> = []
  const ctx = {
    locale: { register: vi.fn(() => vi.fn()), bind: vi.fn(() => (key: string) => key) },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (spec: Record<string, unknown>, component: unknown) => { entries.push({ spec, component }); return vi.fn() },
      entries: () => [] as { options: { id?: string } }[],
      subscribe: () => () => undefined,
    },
    connection: { rpc: { call: vi.fn() } },
    effect: (register: () => unknown) => register(),
  }
  apply(ctx as never)
  return { entries }
}

describe('client plugin composition', () => {
  it('registers the External Agents settings section', () => {
    const { entries } = registrationBench()
    expect(entries.map(({ spec }) => spec.name)).toEqual(['settings.provider.item'])
    expect(entries[0]?.spec).toMatchObject({ key: 'antigravity' })
    const face = (entries[0]!.spec.inject as () => Record<string, unknown>)()
    expect(face).toEqual(expect.objectContaining({
      t: expect.any(Function),
      load: expect.any(Function),
      save: expect.any(Function),
      run: expect.any(Function),
      pick: expect.any(Function),
    }))
  })

  it('declares the required browser services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })
})
