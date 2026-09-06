import { describe, expect, it, vi } from 'vitest'
import type { AcpSettingsRow } from '../src/client-contract.ts'
import { mergeSettingsDraft } from '../src/web/settings-state.js'
import { createAntigravityUsageReader } from '../src/web/usage-reader.js'

const row: AcpSettingsRow = { provider: 'antigravity', instanceId: 'default', title: 'Antigravity', enabled: true, executablePath: '/runtime/agy', harnessPath: '/runtime/harness', stateDirectory: '/profile', models: [], installed: true, authenticated: true, live: false, ready: true }

describe('settings snapshots and quota view', () => {
  it('keeps unsaved config while accepting live auth and catalog updates, but never across profiles', () => {
    const draft = { ...row, executablePath: '/edited/agy', model: 'model-a' }
    const incoming = { ...row, authenticated: false, models: [{ id: 'model-b', name: 'Model B' }] }
    expect(mergeSettingsDraft(draft, incoming, true)).toMatchObject({ executablePath: '/edited/agy', model: 'model-a', authenticated: false, models: incoming.models })
    expect(mergeSettingsDraft(draft, incoming, false)).toEqual(incoming)
    expect(mergeSettingsDraft(draft, { ...incoming, instanceId: 'other' }, true)?.executablePath).toBe(row.executablePath)
  })

  it('preserves quota groups, zero and missing buckets through the usage directory', async () => {
    const value = { status: 'ready', observedAt: '2026-09-06T03:00:00Z', groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'a', window: '5h', remainingFraction: 0 }, { bucketId: 'b', window: 'weekly' }] }, { displayName: 'Claude / GPT', buckets: [{ bucketId: 'c', window: '5h', remainingFraction: 0.999 }] }] }
    const call = vi.fn().mockResolvedValue({ ok: true, value })
    const result = await createAntigravityUsageReader().read({ call } as never, false, new AbortController().signal)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('expected quota data')
    expect(result.windows).toHaveLength(3)
    expect(result.windows[0]?.remainingPercent).toBe(0)
    expect(result.windows[1]?.remainingPercent).toBeUndefined()
    expect(result.windows[2]?.remainingPercent).toBeCloseTo(99.9)
    expect(result.windows[2]?.label).toContain('Claude / GPT')
  })

  it('clears directory quota on logout and does not reinterpret permission failures as empty quota', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: { status: 'authentication-required', observedAt: '2026-09-06T03:00:00Z', groups: [] } })
    const reader = createAntigravityUsageReader(), signal = new AbortController().signal
    expect(await reader.read({ call } as never, true, signal)).toEqual({ status: 'logged-out' })
    call.mockResolvedValue({ ok: true, value: { status: 'not-entitled', observedAt: '2026-09-06T03:00:00Z', groups: [], message: 'Not entitled' } })
    expect(await reader.read({ call } as never, true, signal)).toMatchObject({ status: 'unsupported' })
  })
})
