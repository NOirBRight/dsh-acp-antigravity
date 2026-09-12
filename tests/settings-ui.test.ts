import { describe, expect, it, vi } from 'vitest'
import type { AcpSettingsRow } from '../src/client-contract.ts'
import { decodeConfig } from '../src/client-contract.js'
import { syncRowKeys } from '../src/row-keys.js'
import { antigravityAccessKind, antigravityAccessHintKey, mergeSettingsDraft, shouldClearQuota } from '../src/web/settings-state.js'
import { createAntigravityUsageReader } from '../src/web/usage-reader.js'

const row: AcpSettingsRow = { provider: 'antigravity', instanceId: 'default', title: 'Antigravity', enabled: true, executablePath: '/runtime/agy', harnessPath: '/runtime/harness', stateDirectory: '/profile', models: [], installed: true, authenticated: true, live: false, ready: true }

describe('settings snapshots and quota view', () => {
  it('classifies local, lan, remote, and app access for Google sign-in copy', () => {
    expect(antigravityAccessKind('127.0.0.1')).toBe('local')
    expect(antigravityAccessKind('localhost')).toBe('local')
    expect(antigravityAccessKind('[::1]')).toBe('local')
    expect(antigravityAccessKind('192.168.50.75')).toBe('lan')
    expect(antigravityAccessKind('10.0.0.8')).toBe('lan')
    expect(antigravityAccessKind('172.16.1.2')).toBe('lan')
    expect(antigravityAccessKind('dshlab.noirbright.top')).toBe('remote')
    expect(antigravityAccessKind('8.8.8.8')).toBe('remote')
    expect(antigravityAccessKind('127.0.0.1', 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36')).toBe('app')
    expect(antigravityAccessKind('dshlab.example', 'DshMobile/1.0')).toBe('app')
    expect(antigravityAccessHintKey('local')).toBe('accessLocal')
    expect(antigravityAccessHintKey('lan')).toBe('accessLan')
    expect(antigravityAccessHintKey('remote')).toBe('accessRemote')
    expect(antigravityAccessHintKey('app')).toBe('accessApp')
  })

  it('retains first-paint quota only until authoritative logout or profile change', () => {
    expect(shouldClearQuota(undefined, row)).toBe(false)
    expect(shouldClearQuota(row, { ...row })).toBe(false)
    expect(shouldClearQuota(row, { ...row, authenticated: false })).toBe(true)
    expect(shouldClearQuota(row, { ...row, instanceId: 'other' })).toBe(true)
    expect(shouldClearQuota(row, { ...row, stateDirectory: '/other' })).toBe(true)
    expect(shouldClearQuota(row, undefined)).toBe(true)
  })

  it('keeps unsaved config while accepting live auth and catalog updates, but never across profiles', () => {
    const draft = { ...row, executablePath: '/edited/agy', model: 'model-a' }
    const incoming = { ...row, authenticated: false, models: [{ id: 'model-b', name: 'Model B' }] }
    expect(mergeSettingsDraft(draft, incoming, true)).toMatchObject({ executablePath: '/edited/agy', model: 'model-a', authenticated: false, models: draft.models })
    expect(mergeSettingsDraft(draft, incoming, false)).toEqual(incoming)
    expect(mergeSettingsDraft(draft, { ...incoming, instanceId: 'other' }, true)?.executablePath).toBe(row.executablePath)
  })

  it('publishes one headline window from the first ready bucket', async () => {
    const value = { status: 'ready', observedAt: '2026-09-06T03:00:00Z', groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'a', window: '5h', remainingFraction: 0, resetTime: '2026-09-06T04:00:00Z' }, { bucketId: 'b', window: 'weekly' }] }, { displayName: 'Claude / GPT', buckets: [{ bucketId: 'c', window: '5h', remainingFraction: 0.999 }] }] }
    const call = vi.fn().mockResolvedValue({ ok: true, value })
    const result = await createAntigravityUsageReader().read({ call } as never, false, new AbortController().signal)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('expected quota data')
    expect(result.windows).toHaveLength(1)
    expect(result.windows[0]).toMatchObject({ id: 'headline', label: 'Gemini · 5h', shortLabel: 'Gemini · 5h', valueText: '0%', remainingPercent: 0 })
    expect(result.windows[0]?.resetsAt).toContain('2026')
  })

  it('does not treat a displayed models list as a user overlay', () => {
    const decoded = decodeConfig({
      executablePath: '/agy', harnessPath: '/harness', stateDirectory: '/profile', instanceId: 'default', enabled: true,
      models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', vision: true }],
    })
    expect(decoded?.catalogOrder).toBeUndefined()
    expect(decoded?.catalogOverrides).toBeUndefined()
    const saved = decodeConfig({
      executablePath: '/agy', harnessPath: '/harness', stateDirectory: '/profile', instanceId: 'default', enabled: true,
      catalogOrder: ['gemini-3.8-flash'],
      catalogOverrides: { 'gemini-3.8-flash': { id: 'gemini-3.8-flash', name: 'Renamed' } },
    })
    expect(saved?.catalogOrder).toEqual(['gemini-3.8-flash'])
    expect(saved?.catalogOverrides?.['gemini-3.8-flash']?.name).toBe('Renamed')
    const empty = decodeConfig({
      executablePath: '/agy', harnessPath: '/harness', stateDirectory: '/profile', instanceId: 'default', enabled: true,
      catalogOrder: [],
    })
    expect(empty?.catalogOrder).toEqual([])
  })

  it('keeps row keys stable across id edits, reorders, and removals', () => {
    let seq = 0
    const mint = (): string => 'k' + String(++seq)
    const prev = [{ key: 'a', id: 'a' }, { key: 'b', id: 'b' }]
    expect(syncRowKeys(prev, ['ax', 'b'], mint)).toEqual(['a', 'b'])
    expect(syncRowKeys(prev, ['b', 'a'], mint)).toEqual(['b', 'a'])
    expect(syncRowKeys(prev, ['b'], mint)).toEqual(['b'])
    expect(syncRowKeys(prev, ['a', 'b', ''], mint)).toEqual(['a', 'b', 'k1'])
    expect(syncRowKeys([{ key: 'a', id: 'a' }, { key: 'k1', id: '' }], ['a', 'g'], mint)).toEqual(['a', 'k1'])
  })

  it('clears directory quota on logout and does not reinterpret permission failures as empty quota', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: { status: 'authentication-required', observedAt: '2026-09-06T03:00:00Z', groups: [] } })
    const reader = createAntigravityUsageReader(), signal = new AbortController().signal
    expect(await reader.read({ call } as never, true, signal)).toEqual({ status: 'logged-out' })
    call.mockResolvedValue({ ok: true, value: { status: 'not-entitled', observedAt: '2026-09-06T03:00:00Z', groups: [], message: 'Not entitled' } })
    expect(await reader.read({ call } as never, true, signal)).toMatchObject({ status: 'unsupported' })
  })
})
