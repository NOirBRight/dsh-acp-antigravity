/**
 * Bridge fail-closed regression over a real AntigravityProvider, per-connect fake
 * world, audited registry, and production-assembled sidecar storage.
 *
 * Proves: failed native turns end with finish error (never stop, no usage, no plan
 * review); completed refs persist opaque cursors that a restarted bridge resumes
 * on the prompted native session; legacy bare cursors are rejected without a
 * session prompt; per-turn model switches complete through the registry catalog
 * on one native session; reset never reuses a disposed session; full-access opens
 * and turns share one audited mode with no duplicate approval.
 */
import { describe, expect, it } from 'vitest'
import { providerId, resumeCursor, sessionId } from '@deepseek-ai/dsh-acp-provider'
import { ANTIGRAVITY_SESSION_READY } from '../src/tool-events.js'
import { isRecord } from '../src/decode.js'
import {
  callsTo,
  collectStream,
  decodeAntigravityCursor,
  finishOf,
  makeAntigravityHarness,
  openBridge,
  paramField,
} from './bridge-fixtures.js'

function userMessage(text: string): { role: string; source: { kind: string }; content: string } {
  return { role: 'user', source: { kind: 'user' }, content: text }
}

function isFinishChunk(chunk: unknown): boolean {
  return isRecord(chunk) && chunk.type === 'finish'
}

function isUsageChunk(chunk: unknown): boolean {
  return isRecord(chunk) && chunk.type === 'usage'
}

/** The single prompted native id, or a thrown explanation when the log disagrees. */
function onlyPrompted(prompted: readonly string[]): string {
  expect(prompted).toHaveLength(1)
  const native = prompted[0]
  if (native === undefined) throw new Error('fake world recorded no prompted native session')
  return native
}

describe('Antigravity bridge fail-closed terminal mapping', () => {
  it('ends a failed native turn with finish error, never stop, usage, or plan review', async () => {
    const harness = makeAntigravityHarness({ promptResponse: { stopReason: 'error' } })
    harness.store.host.isPlanMode = () => true
    try {
      const chunks = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-failed',
        messages: [userMessage('go')],
      }))
      const finish = finishOf(chunks)
      expect(chunks.filter(isFinishChunk)).toHaveLength(1)
      expect(finish?.kind).toBe('error')
      expect(finish?.code).toBe('NATIVE_TURN_FAILED')
      expect(typeof finish?.message === 'string' && finish.message.length > 0).toBe(true)
      expect(chunks.some(isUsageChunk)).toBe(false)
      expect(harness.store.asks).toHaveLength(0)
    } finally {
      await harness.dispose()
    }
  })

  it('persists an opaque ref that a restarted bridge resumes on the prompted native session', async () => {
    const harness = makeAntigravityHarness()
    try {
      const first = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-resume',
        messages: [userMessage('go')],
      }))
      expect(finishOf(first)?.kind).toBe('stop')
      const native = onlyPrompted(harness.world.prompted)
      const stored = harness.store.refOf('e2e-resume')
      const cursor = stored?.resumeCursor
      expect(cursor).toBeDefined()
      if (cursor === undefined) throw new Error('sidecar storage did not persist a resume cursor')
      expect(decodeAntigravityCursor(cursor, harness.scope)).toBe(native)
      const restarted = openBridge(harness.registry, () => harness.provider, harness.store.host)
      try {
        const second = await collectStream(restarted.stream({
          provider: 'antigravity',
          model: 'gemini-pro',
          sessionId: 'e2e-resume',
          messages: [userMessage('again')],
        }))
        expect(finishOf(second)?.kind).toBe('stop')
        expect(harness.world.prompted).toEqual([native, native])
        expect(callsTo(harness.world, 'session/resume').map(call => paramField(call.params, 'sessionId'))).toEqual([native])
      } finally {
        await restarted.dispose().catch(() => undefined)
      }
    } finally {
      await harness.dispose()
    }
  })

  it('rejects a legacy bare cursor fail-closed without prompting a native session', async () => {
    const harness = makeAntigravityHarness()
    try {
      harness.store.activity.append('e2e-legacy', [{
        type: ANTIGRAVITY_SESSION_READY,
        data: {
          provider: 'antigravity' as const,
          ref: {
            provider: providerId('antigravity'),
            session: sessionId('e2e-legacy'),
            resumeCursor: resumeCursor(providerId('antigravity'), 'native-1'),
          },
        },
      }])
      await expect(collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-legacy',
        messages: [userMessage('go')],
      }))).rejects.toThrow(/Native history/)
      expect(callsTo(harness.world, 'session/resume')).toHaveLength(0)
      expect(harness.world.prompted).toHaveLength(0)
    } finally {
      await harness.dispose()
    }
  })

  it('completes a same-session model switch through the registry catalog', async () => {
    const harness = makeAntigravityHarness()
    try {
      const first = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-model',
        messages: [userMessage('go')],
      }))
      expect(finishOf(first)?.kind).toBe('stop')
      const second = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-ultra',
        sessionId: 'e2e-model',
        messages: [userMessage('switch')],
      }))
      expect(finishOf(second)?.kind).toBe('stop')
      expect(harness.world.prompted).toHaveLength(2)
      const [firstNative, secondNative] = harness.world.prompted
      expect(secondNative).toBe(firstNative)
      expect(callsTo(
        harness.world,
        'session/set_config_option',
        params => paramField(params, 'value') === 'gemini-ultra',
      ).length).toBeGreaterThan(0)
      await harness.registry.resolveExternalRoute('antigravity', 'gemini-ultra')
    } finally {
      await harness.dispose()
    }
  })

  it('never reuses a disposed native session across reset', async () => {
    const harness = makeAntigravityHarness()
    try {
      const first = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-reset',
        messages: [userMessage('go')],
      }))
      expect(finishOf(first)?.kind).toBe('stop')
      const native = onlyPrompted(harness.world.prompted)
      await harness.bridge.reset()
      const second = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-reset',
        messages: [userMessage('again')],
      }))
      expect(finishOf(second)?.kind).toBe('stop')
      expect(harness.world.closed).toContain(native)
      const closeAt = harness.world.calls.findIndex(call => call.method === 'session/close' && paramField(call.params, 'sessionId') === native)
      const reopenAt = harness.world.calls.findIndex(call => call.method === 'session/resume')
      expect(closeAt).toBeGreaterThanOrEqual(0)
      expect(reopenAt).toBeGreaterThan(closeAt)
      expect(harness.world.prompted).toEqual([native, native])
    } finally {
      await harness.dispose()
    }
  })

  it('runs full-access open and turn in one audited mode without duplicate approval', async () => {
    const harness = makeAntigravityHarness({
      policy: { mode: 'danger-full-access', workspaceRoot: '/workspace' },
    })
    try {
      const chunks = await collectStream(harness.bridge.stream({
        provider: 'antigravity',
        model: 'gemini-pro',
        sessionId: 'e2e-full-access',
        messages: [userMessage('go')],
      }))
      expect(finishOf(chunks)?.kind).toBe('stop')
      expect(harness.audits).toHaveLength(1)
      const modes = callsTo(harness.world, 'session/set_mode').map(call => paramField(call.params, 'modeId'))
      expect(modes.length).toBeGreaterThanOrEqual(2)
      expect(modes.every(mode => mode === 'yolo')).toBe(true)
      expect(harness.store.approvals).toHaveLength(0)
    } finally {
      await harness.dispose()
    }
  })
});
