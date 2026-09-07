import { describe, expect, it, vi } from 'vitest'
import { ACP_SETTINGS_RPC_CHANNEL } from '../src/client-contract.ts'
import { apply, inject } from '../src/web/index.ts'

function registrationBench() {
  const entries: Array<{ spec: Record<string, unknown>; component: unknown }> = []
  const registerProvider = vi.fn(() => vi.fn())
  const invalidateUsage = vi.fn()
  const rpcCall = vi.fn()
  const effect = (register: () => unknown) => register()
  const ctx = {
    locale: { register: vi.fn(() => vi.fn()), bind: vi.fn(() => (key: string) => key) },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (spec: Record<string, unknown>, component: unknown) => { entries.push({ spec, component }); return vi.fn() },
      entries: () => [] as { options: { id?: string } }[],
      subscribe: () => () => undefined,
    },
    connection: { rpc: { call: rpcCall } },
    get: () => ({ invalidateUsage }),
    inject: (_dependencies: string[], callback: (scope: object) => unknown) => callback({ providerDirectory: { register: registerProvider }, effect }),
    effect,
  }
  apply(ctx as never)
  return { entries, registerProvider, invalidateUsage, rpcCall }
}

describe('client plugin composition', () => {
  it('keeps native activity out of the conversation tab list', () => {
    const { entries } = registrationBench()
    expect(entries.map(({ spec }) => spec.name)).toEqual(['settings.provider.item'])
  })

  it('registers the External Agents settings section', () => {
    const { entries } = registrationBench()
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

  it('publishes the Antigravity card as an Agent provider', () => {
    const { registerProvider } = registrationBench()
    expect(registerProvider).toHaveBeenCalledWith(expect.objectContaining({ key: 'antigravity', role: 'agent', header: 'shared', usage: expect.objectContaining({ read: expect.any(Function) }) }))
  })

  it('purges cached sidebar quota on logout and on a structured account-change response', async () => {
    const { entries, invalidateUsage, rpcCall } = registrationBench()
    const face = (entries[0]!.spec.inject as () => { run: (action: string) => Promise<unknown>; quota: () => Promise<unknown> })()
    rpcCall.mockResolvedValueOnce({ ok: true, value: {} })
    await face.run('sign-out')
    expect(invalidateUsage).toHaveBeenCalledWith('antigravity')
    invalidateUsage.mockClear()
    rpcCall.mockResolvedValueOnce({ ok: true, value: { status: 'account-changed', observedAt: '2026-09-06T03:00:00Z', groups: [] } })
    await face.quota()
    expect(invalidateUsage).toHaveBeenCalledWith('antigravity')
  })

  it('declares the required browser services without conversation folding', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('needs no conversation or renderer service beyond slots', () => {
    expect(inject.some(service => service.includes('conversation') || service.includes('renderer'))).toBe(false)
    const bench = registrationBench()
    expect(bench).not.toHaveProperty('conversation')
    expect(bench.entries.map(({ spec }) => spec.name)).toEqual(['settings.provider.item'])
  })
})
