import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/web/index.ts'
import { nativeTurnDefinition } from '../src/web/native-turn.ts'
import { decodeSnapshot } from '../src/client-contract.ts'

// Registration is tested here; actual browser-only cards are exercised by the 3082 E2E.
vi.mock('../src/web/NativeTurnContainer.tsx', () => ({ NativeTurnContainer: () => null }))

type EntrySpec = {
  name?: unknown
  key?: unknown
  inject?: (...args: string[]) => Record<string, unknown>
}

function registrationBench() {
  const entries: Array<{ spec: EntrySpec; component: unknown }> = []
  const definitions: unknown[] = []
  const registerProvider = vi.fn(() => vi.fn())
  const invalidateUsage = vi.fn()
  const rpcCall = vi.fn()
  const effect = (register: () => unknown) => register()
  const sectionEntries: { options: { id?: string } }[] = []
  const sectionListeners: Array<() => void> = []
  const ctx = {
    locale: { register: vi.fn(() => vi.fn()), bind: vi.fn(() => (key: string) => key) },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (spec: EntrySpec, component: unknown) => { entries.push({ spec, component }); return vi.fn() },
      entries: () => sectionEntries,
      subscribe: (_name: string, listener: () => void) => { sectionListeners.push(listener); return () => undefined },
    },
    connection: { rpc: { call: rpcCall } },
    uiConversation: { events: { register: (definition: unknown) => { definitions.push(definition); return vi.fn() } } },
    get: () => ({ invalidateUsage }),
    inject: (_dependencies: string[], callback: (scope: object) => unknown) => callback({ providerDirectory: { register: registerProvider }, effect }),
    effect,
  }
  apply(ctx as never)
  return { entries, definitions, registerProvider, invalidateUsage, rpcCall, sectionEntries, sectionListeners }
}

describe('client plugin composition', () => {
  it('retains the advanced discovery timeout across an ordinary settings edit', async () => {
    const { entries, rpcCall } = registrationBench()
    const face = entries[0]?.spec.inject?.()
    if (typeof face?.load !== 'function' || typeof face.save !== 'function') throw new Error('missing settings face')
    const row = { provider: 'antigravity', instanceId: 'default', title: 'Antigravity', enabled: true, executablePath: '/agy', harnessPath: '/harness', stateDirectory: '/profile', models: [], installed: true, authenticated: true, live: false, ready: true, modelDiscoveryTimeoutMs: 45_000 }
    rpcCall.mockResolvedValueOnce({ ok: true, value: { title: 'External Agents', rows: [row] } })
    const loaded = decodeSnapshot(await face.load())
    expect(loaded?.rows[0]?.modelDiscoveryTimeoutMs).toBe(45_000)
    rpcCall.mockResolvedValueOnce({ ok: true, value: { saved: true } })
    await face.save({ ...loaded!.rows[0]!, enabled: false })
    expect(rpcCall).toHaveBeenLastCalledWith(expect.any(String), 'save', expect.objectContaining({ enabled: false, modelDiscoveryTimeoutMs: 45_000 }), undefined)
    expect(decodeSnapshot({ title: 'External Agents', rows: [{ ...row, modelDiscoveryTimeoutMs: 0 }] })).toBeUndefined()
  })

  it('keeps native activity out of the conversation tab list', () => {
    const { entries } = registrationBench()
    expect(entries.map(({ spec }) => spec.name)).toEqual(['settings.provider.item', 'conversation.chat.node'])
  })

  it('folds one container per turn from standard turn events', () => {
    const { definitions } = registrationBench()
    expect(definitions).toContain(nativeTurnDefinition)
    expect(nativeTurnDefinition).toMatchObject({ kind: 'antigravity-native', target: 'chat' })
  })

  it('renders native rows as chat nodes bound to the session', () => {
    const { entries } = registrationBench()
    expect(entries[1]?.spec).toMatchObject({ name: 'conversation.chat.node', key: 'antigravity-native' })
    const face = entries[1]?.spec.inject?.('session-7')
    expect(face).toEqual(expect.objectContaining({ t: expect.any(Function), rpc: expect.anything(), sessionId: 'session-7', uiConversation: expect.anything() }))
    expect(entries[1]?.component).toBeDefined()
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

  it('invalidates sidebar quota when a snapshot changes profile or signs out', async () => {
    const { entries, invalidateUsage, rpcCall } = registrationBench()
    const face = entries[0]?.spec.inject?.()
    if (typeof face?.load !== 'function') throw new Error('missing load')
    const row = { provider: 'antigravity', instanceId: 'default', title: 'Antigravity', enabled: true, executablePath: '/agy', harnessPath: '/harness', stateDirectory: '/profile', models: [], installed: true, authenticated: true, live: false, ready: true }
    rpcCall.mockResolvedValueOnce({ ok: true, value: { title: 'External Agents', rows: [row] } })
    await face.load()
    expect(invalidateUsage).not.toHaveBeenCalled()
    rpcCall.mockResolvedValueOnce({ ok: true, value: { title: 'External Agents', rows: [{ ...row, stateDirectory: '/other' }] } })
    await face.load()
    expect(invalidateUsage).toHaveBeenCalledWith('antigravity')
    invalidateUsage.mockClear()
    rpcCall.mockResolvedValueOnce({ ok: true, value: { title: 'External Agents', rows: [{ ...row, authenticated: false }] } })
    await face.load()
    expect(invalidateUsage).toHaveBeenCalledWith('antigravity')
  })

  it('declares uiConversation for the turn fold without the renderer service', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'uiConversation'])
  })

  it('needs no renderer service beyond slots', () => {
    expect(inject.some(service => service.includes('renderer'))).toBe(false)
    const bench = registrationBench()
    expect(bench).not.toHaveProperty('conversation')
    expect(bench.entries.map(({ spec }) => spec.name)).toEqual(['settings.provider.item', 'conversation.chat.node'])
  })
})

describe('providers page diagnostic', () => {
  it('drops the missing-owner warning when the providers section registers inside the grace period', () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const bench = registrationBench()
      vi.advanceTimersByTime(0)
      expect(warn).not.toHaveBeenCalled()
      bench.sectionEntries.push({ options: { id: 'providers' } })
      for (const listener of bench.sectionListeners) listener()
      vi.advanceTimersByTime(15_000)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('warns once when no providers section registers within the grace period', () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const bench = registrationBench()
      vi.advanceTimersByTime(14_999)
      expect(warn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('[dsh-acp-antigravity] LLM Providers page missing')
      for (const listener of bench.sectionListeners) listener()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
