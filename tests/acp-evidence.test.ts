import { describe, expect, it } from 'vitest'
import { classifyTurn, describeResult, describeUpdate, errorCategory, frameVerdict, hasTokenCounts, isCountKey, isSessionUpdateFor } from '../scripts/acp-evidence.js'

describe('count-field recognition', () => {
  it('recognizes normalized counters', () => {
    for (const key of ['inputTokens', 'input_tokens', 'outputTokens', 'totalTokens', 'thoughtTokens', 'cached_read_tokens', 'cachedWriteTokens', 'reasoningTokens']) {
      expect(isCountKey(key)).toBe(true);
    }
  })

  it('never treats credentials as counters', () => {
    for (const key of ['access_token', 'refresh_token', 'authToken', 'authorization', 'secret', 'bearer', 'tokenizer', 'usage', 'used', 'size', 'cost']) {
      expect(isCountKey(key)).toBe(false);
    }
  })
})

describe('token evidence detection', () => {
  it('accepts real counters with numeric values', () => {
    expect(hasTokenCounts({ inputTokens: 12 })).toBe(true);
    expect(hasTokenCounts({ usage: { input_tokens: '12' } })).toBe(true);
    expect(hasTokenCounts([{ totalTokens: 0 }])).toBe(true);
  })

  it('rejects usage:null and context counters', () => {
    expect(hasTokenCounts({ usage: null })).toBe(false);
    expect(hasTokenCounts({ sessionUpdate: 'usage_update', size: 9, used: 3, cost: 1 })).toBe(false);
    expect(hasTokenCounts({ inputTokens: null })).toBe(false);
    expect(hasTokenCounts({ inputTokens: 'abc' })).toBe(false);
  })
})

describe('update evidence', () => {
  it('keeps tag, keys, and counters without copying tool content', () => {
    const update = { sessionUpdate: 'tool_call', toolCallId: 't-1', title: 'run', rawInput: { id: 'secret', pin: 1234, type: 'private' }, extra: 'x' };
    const evidence = describeUpdate(update);
    expect(evidence.tag).toBe('tool_call');
    expect(evidence.keys).toEqual(['sessionUpdate', 'toolCallId', 'title', 'rawInput', 'extra']);
    expect(evidence.counters).toEqual({});
    expect(JSON.stringify(evidence)).not.toContain('secret');
    expect(JSON.stringify(evidence)).not.toContain('1234');
  });

  it('preserves counter paths from telemetry subtrees only', () => {
    const update = { sessionUpdate: 'usage_update', size: 9, used: 3, inputTokens: 12, usage: { outputTokens: '34', access_token: 'zzz' } };
    const evidence = describeUpdate(update);
    expect(evidence.counters).toEqual({ inputTokens: 12, 'usage.outputTokens': '34' });
    expect(JSON.stringify(evidence)).not.toContain('zzz');
  });

  it('marks invalid counter fields by type while keeping their paths', () => {
    expect(describeUpdate({ sessionUpdate: 'u', inputTokens: 'abc' }).counters).toEqual({ inputTokens: '[string:3]' });
    expect(describeUpdate({ sessionUpdate: 'u', inputTokens: null }).counters).toEqual({ inputTokens: '[null]' });
    expect(describeUpdate({ sessionUpdate: 'u', inputTokens: '1'.repeat(40) }).counters).toEqual({ inputTokens: '[string:40]' });
    expect(describeUpdate('nope')).toEqual({ tag: null, keys: [], counters: {} });
  });
});

describe('result evidence', () => {
  it('keeps stop reason and counters without opaque content', () => {
    const evidence = describeResult({ stopReason: 'end_turn', usage: { inputTokens: 1 }, prompt: [{ type: 'text', text: 'hi' }] });
    expect(evidence).toEqual({ stopReason: 'end_turn', counters: { 'usage.inputTokens': 1 } });
  });

  it('marks a missing stop reason', () => {
    expect(describeResult(null)).toEqual({ stopReason: '[missing]', counters: {} });
  });
});

describe('frame verdicts and update filtering', () => {
  it('classifies raw versus decoded presence', () => {
    expect(frameVerdict(true, true)).toBe('tokens-both');
    expect(frameVerdict(true, false)).toBe('tokens-raw-only');
    expect(frameVerdict(false, true)).toBe('tokens-decoded-only');
    expect(frameVerdict(false, false)).toBe('tokens-neither');
  });

  it('keeps only updates for the requested session', () => {
    const update = { sessionId: 's-1', update: { sessionUpdate: 'agent_message_chunk' } };
    expect(isSessionUpdateFor({ method: 'session/update', params: update }, 's-1')).toBe(true);
    expect(isSessionUpdateFor({ method: 'session/update', params: update }, 's-2')).toBe(false);
    expect(isSessionUpdateFor({ method: 'session/request_permission', params: update }, 's-1')).toBe(false);
    expect(isSessionUpdateFor({ method: 'session/update', params: { sessionId: 's-1' } }, '')).toBe(false);
    expect(isSessionUpdateFor(null, 's-1')).toBe(false);
  });

  it('ignores counters nested inside tool and auth payloads', () => {
    expect(hasTokenCounts({ rawInput: { inputTokens: 123 } })).toBe(false);
    expect(hasTokenCounts({ content: [{ inputTokens: 1 }] })).toBe(false);
    expect(hasTokenCounts({ prompt: [{ inputTokens: 1 }] })).toBe(false);
    expect(hasTokenCounts({ auth: { inputTokens: 1 } })).toBe(false);
    expect(hasTokenCounts({ rawOutput: { totalTokens: 2 } })).toBe(false);
    expect(hasTokenCounts({ usage: { inputTokens: 5 } })).toBe(true);
    expect(hasTokenCounts({ inputTokens: 7 })).toBe(true);
  });
})

describe('failure classification', () => {
  it('marks failed turns incomplete with a nonzero exit', () => {
    expect(classifyTurn(false, '')).toEqual({ status: 'complete', reason: '', exitCode: 0 });
    expect(classifyTurn(true, 'timeout')).toEqual({ status: 'incomplete', reason: 'timeout', exitCode: 3 });
    expect(classifyTurn(true, 'auth')).toEqual({ status: 'incomplete', reason: 'auth', exitCode: 3 });
  });

  it('maps failures to fixed categories without echoing messages', () => {
    expect(errorCategory(new DOMException('aborted', 'AbortError'))).toBe('timeout');
    expect(errorCategory(new DOMException('timed out', 'TimeoutError'))).toBe('timeout');
    expect(errorCategory(new Error('oauth blocked https://example.test/secret'))).toBe('auth');
    expect(errorCategory(new Error('lab config needs turn.prompt'))).toBe('config');
    expect(errorCategory(new Error('socket hang up'))).toBe('transport');
    expect(errorCategory(Object.assign(new Error('exists'), { code: 'EEXIST' }))).toBe('exists');
    expect(errorCategory(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe('config');
    expect(errorCategory('plain string')).toBe('unknown');
  });
})
