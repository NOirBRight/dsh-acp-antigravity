import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-acp-provider', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-acp-provider')>()
  return {
    ...actual,
    latestNativeSessionBinding: () => {
      throw new Error('native binding belongs to another DSH session')
    },
  }
})

describe('shared native binding helper errors', () => {
  it('rewrites a shared helper cross-session error into the Antigravity corrupt prefix', async () => {
    const { nativeSessionBinding } = await import('../src/activity-contract.js')
    expect(() => nativeSessionBinding({ version: 1, records: [] }, 'dsh')).toThrow(
      'Antigravity activity history is corrupt: native binding belongs to another DSH session',
    )
  })
})
