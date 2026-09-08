import { describe, expect, it } from 'vitest'
import { providerId, resumeCursor, sessionId } from '@deepseek-ai/dsh-acp-provider'
import { decodeAntigravityCursor, encodeAntigravityCursor } from '../src/cursor.js'
import { ANTIGRAVITY_FULL_ACCESS_AUTHORIZED, decodeActivityRecord, nativeSessionBinding } from '../src/activity-contract.js'
import { ANTIGRAVITY_SESSION_READY } from '../src/tool-events.js'

const provider = providerId('antigravity')
const ref = { provider, session: sessionId('dsh'), resumeCursor: encodeAntigravityCursor(provider, 'native', 'profile/workspace') }
const record = (type: string, data: unknown) => decodeActivityRecord(JSON.stringify({ v: 1, seq: 1, time: '2026-09-08T00:00:00.000Z', type, data }), 1)

describe('durable native binding', () => {
  it('resumes only a well-formed cursor in its original scope', () => {
    expect(decodeAntigravityCursor(ref.resumeCursor, 'profile/workspace')).toBe('native')
    for (const value of ['native', '{}', 'null', JSON.stringify({ v: 1, scope: 'profile/workspace', nativeId: '' })]) {
      expect(() => decodeAntigravityCursor(resumeCursor(provider, value), 'profile/workspace')).toThrow()
    }
    expect(() => decodeAntigravityCursor(ref.resumeCursor, 'another-profile')).toThrow('profile or workspace')
  })
  it('preserves legacy read-only binding and rejects cross-session or cross-provider references', () => {
    const legacy = record(ANTIGRAVITY_SESSION_READY, { provider: 'antigravity' })
    expect(nativeSessionBinding({ version: 1, records: [legacy] }, 'dsh')).toEqual({ provider, session: 'dsh' })
    const ready = record(ANTIGRAVITY_SESSION_READY, { provider: 'antigravity', ref })
    expect(nativeSessionBinding({ version: 1, records: [ready] }, 'dsh')).toEqual(ref)
    expect(() => nativeSessionBinding({ version: 1, records: [ready] }, 'another-session')).toThrow('another DSH session')
    expect(() => record(ANTIGRAVITY_SESSION_READY, { provider: 'antigravity', ref: { ...ref, resumeCursor: { provider: 'another', value: 'native' } } })).toThrow('corrupt')
  })
  it('validates authorization without treating it as a native binding', () => {
    const audit = record(ANTIGRAVITY_FULL_ACCESS_AUTHORIZED, { provider, session: 'dsh', mode: 'full-access' })
    expect(nativeSessionBinding({ version: 1, records: [audit] }, 'dsh')).toBeUndefined()
    expect(() => record(ANTIGRAVITY_FULL_ACCESS_AUTHORIZED, { provider, mode: 'full-access' })).toThrow('corrupt')
  })
})
