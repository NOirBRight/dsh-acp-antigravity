import { describe, expect, it } from 'vitest'
import { boundExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'
import { normalizeAntigravitySessionUpdate } from '../src/mapping.js'

const bounds = { maxTextBytes: 1024, maxPayloadBytes: 4096 }

describe('native usage normalization', () => {
  it('preserves real thought and cache counts without counting either twice', () => {
    const event = normalizeAntigravitySessionUpdate({ sessionUpdate: 'usage', inputTokens: 100, outputTokens: 20, thoughtTokens: 30, totalTokens: 150, cachedReadTokens: 60 }, bounds)
    expect(event).toEqual({ type: 'usage', inputTokens: 40, outputTokens: 50, reasoningTokens: 30, cacheReadTokens: 60, totalTokens: 150 })
    expect(boundExternalAgentEvent(event!, bounds)).toEqual(event)
    expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'usage', inputTokens: 100, outputTokens: 50, thoughtTokens: 30, totalTokens: 150 }, bounds)).toEqual({ type: 'usage', inputTokens: 100, outputTokens: 50, reasoningTokens: 30, totalTokens: 150 })
  })

  it('omits incomplete, ambiguous, inconsistent and unsafe counters', () => {
    for (const usage of [
      { inputTokens: 10 },
      { inputTokens: 10, outputTokens: 2, thoughtTokens: 3 },
      { inputTokens: 10, outputTokens: 2, totalTokens: 99 },
      { inputTokens: 10, outputTokens: 2, cachedReadTokens: 11 },
      { inputTokens: 10, outputTokens: 2, thoughtTokens: -1 },
      { inputTokens: 10, outputTokens: Number.MAX_SAFE_INTEGER + 1 },
      { inputTokens: 10, outputTokens: Number.NaN },
    ]) expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'usage', ...usage }, bounds)).toBeNull()
  })

  it('retains explicit zero and accepts snake-case base counters', () => {
    expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'usage', input_tokens: 0, output_tokens: 0 }, bounds)).toEqual({ type: 'usage', inputTokens: 0, outputTokens: 0 })
  })
})
