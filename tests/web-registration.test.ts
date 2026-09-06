import { describe, expect, it, vi } from 'vitest'
import { ACP_SETTINGS_RPC_CHANNEL } from '../src/client-contract.ts'
import { ACTIVITY_ENDPOINT } from '../src/activity-contract.ts'
import { AntigravityActivityView } from '../src/web/AntigravityActivityView.tsx'
import { en } from '../src/web/locales.ts'
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

const historyWire = {
  version: 1,
  records: [
    { seq: 1, time: '2026-09-06T03:00:00.000Z', type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
    { seq: 2, time: '2026-09-06T03:00:01.000Z', type: 'antigravity/tool-start', data: { toolId: 'read', name: 'Read', status: 'running', location: { target: '/tmp/a.txt', kind: 'file' } } },
    { seq: 3, time: '2026-09-06T03:00:02.000Z', type: 'antigravity/tool-update', data: { toolId: 'read', status: 'completed', output: 'ok' } },
  ],
}

describe('client plugin composition', () => {
  it('registers the Antigravity Activity sidecar view after Chat', () => {
    const { entries } = registrationBench()
    expect(entries.map(({ spec }) => spec.name)).toEqual(['conversation.view', 'settings.provider.item'])
    const view = entries[0]!.spec
    expect(view).toMatchObject({ id: 'antigravity', order: 11 })
    expect((view.label as () => string)()).toBe('activityView')
    expect(en.activityView).toBe('Antigravity Activity')
    expect(entries[0]!.component).toBe(AntigravityActivityView)
  })

  it('reads one session history over the sidecar endpoint with the slot session id', async () => {
    const { entries, rpcCall } = registrationBench()
    const face = (entries[0]!.spec.inject as (sessionId: string) => { read: (signal?: AbortSignal) => Promise<{ records: unknown[] }> })('session-1')
    expect(typeof face.read).toBe('function')
    rpcCall.mockResolvedValueOnce({ ok: true, value: historyWire })
    const history = await face.read()
    expect(rpcCall).toHaveBeenCalledWith(ACP_SETTINGS_RPC_CHANNEL, ACTIVITY_ENDPOINT, { sessionId: 'session-1' }, undefined)
    expect(ACTIVITY_ENDPOINT).toBe('activity/read')
    expect(history.records).toHaveLength(3)
  })

  it('fails the sidecar read locally on a malformed history without touching Chat', async () => {
    const { entries, rpcCall } = registrationBench()
    const face = (entries[0]!.spec.inject as (sessionId: string) => { read: () => Promise<unknown> })('session-1')
    rpcCall.mockResolvedValueOnce({ ok: true, value: { version: 1, records: [{ seq: 1, time: 'not-a-time', type: 'antigravity/tool-start', data: {} }] } })
    await expect(face.read()).rejects.toThrow('activityFailed')
    rpcCall.mockResolvedValueOnce({ ok: false, error: { message: 'gone' } })
    await expect(face.read()).rejects.toThrow('gone')
  })

  it('registers the External Agents settings section', () => {
    const { entries } = registrationBench()
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

  it('publishes the Antigravity card as an Agent provider', () => {
    const { registerProvider } = registrationBench()
    expect(registerProvider).toHaveBeenCalledWith(expect.objectContaining({ key: 'antigravity', role: 'agent', header: 'shared', usage: expect.objectContaining({ read: expect.any(Function) }) }))
  })

  it('purges cached sidebar quota on logout and on a structured account-change response', async () => {
    const { entries, invalidateUsage, rpcCall } = registrationBench()
    const face = (entries[1]!.spec.inject as () => { run: (action: string) => Promise<unknown>; quota: () => Promise<unknown> })()
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
})
