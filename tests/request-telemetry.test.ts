import { expect, it } from 'vitest'
import { decodeRequestTelemetry, decodeUsageSnapshots, requestThroughput, sdkUsage } from '../src/request-telemetry.js'
import { sumTurnUsage } from '../src/usage.js'
import { decodeActivityRecord } from '../src/activity-contract.js'
import { foldActivityRecords } from '../src/web/native-activity.js'
import { normalizeAntigravitySessionUpdate } from '../src/mapping.js'

it('roundtrips raw snapshot unknown cache without treating telemetry as tool rows', () => {
  const raw = { prompt_token_count: 100, candidates_token_count: 20, thoughts_token_count: 30, total_token_count: 150, cached_content_token_count: null }
  const snapshots = { version: 1, provenance: 'sdk-cumulative', promptId: 'prompt-1', sessionKey: 'session-1', baseline: 'fresh-session', completed: true, start: null, end: raw }
  expect(decodeUsageSnapshots(snapshots)).toEqual(snapshots)
  expect(decodeUsageSnapshots({ ...snapshots, end: { ...raw, cached_content_token_count: -1 } })).toBeUndefined()
  for (const [type, data] of [['antigravity/usage-snapshots', snapshots], ['antigravity/request-telemetry', telemetry]]) {
    const record = decodeActivityRecord(JSON.stringify({ v: 1, seq: 1, time: '2026-09-08T00:00:00.000Z', type, data }), 1)
    expect(record.data).toEqual(data)
    expect(foldActivityRecords([record])).toEqual([])
  }
})

const request = {
  requestId: 'request-1', model: 'gemini', status: 'completed', durationMs: 1000,
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 150 },
}
const telemetry = { version: 1, provenance: 'ccpa-proxy', scope: 'session', promptId: 'prompt-1', sessionKey: 'session-1', requests: [request] }

it('preserves authoritative partial SDK counts without subtracting cache or inventing unknown totals', () => {
  const raw = { version: 1, provenance: 'sdk-cumulative', promptId: 'real-positive', sessionKey: 'session-1', baseline: 'cumulative', completed: false,
    start: { prompt_token_count: 59957, candidates_token_count: 434, thoughts_token_count: 657, total_token_count: 61048, cached_content_token_count: 8107 },
    end: { prompt_token_count: 68216, candidates_token_count: 2156, thoughts_token_count: 657, total_token_count: 71029, cached_content_token_count: 12157 },
  }
  const partial = sdkUsage(decodeUsageSnapshots(raw))
  expect(partial).toEqual({ inputTokens: 8259, outputTokens: 1722, reasoningTokens: 0, cacheReadTokens: 4050, totalTokens: 14031, usageComplete: false })
  expect(sdkUsage(decodeUsageSnapshots({ ...raw, end: { ...raw.end, cached_content_token_count: null } }))).toEqual({ inputTokens: 8259, outputTokens: 1722, reasoningTokens: 0, usageComplete: false })
  expect(sdkUsage(decodeUsageSnapshots({ ...raw, end: { ...raw.end, cached_content_token_count: 1 } }))).toBeUndefined()
  expect(sdkUsage(decodeUsageSnapshots({ ...raw, start: null }))).toBeUndefined()
  const complete = sdkUsage(decodeUsageSnapshots({ ...raw, completed: true }))
  expect(complete).toEqual({ inputTokens: 8259, outputTokens: 1722, reasoningTokens: 0, cacheReadTokens: 4050, totalTokens: 14031 })
  expect(sumTurnUsage(partial, complete)).toEqual({ inputTokens: 16518, outputTokens: 3444, reasoningTokens: 0, cacheReadTokens: 8100, totalTokens: 28062, usageComplete: false })
  expect(sdkUsage(decodeUsageSnapshots({
    version: 1, provenance: 'sdk-cumulative', promptId: 'aborted-fresh', sessionKey: 'session-1', baseline: 'fresh-session', completed: false,
    start: null,
    end: { prompt_token_count: 10562, candidates_token_count: 83, thoughts_token_count: 268, total_token_count: 10913, cached_content_token_count: 0 },
  }))).toEqual({ inputTokens: 10562, outputTokens: 351, reasoningTokens: 268, cacheReadTokens: 0, totalTokens: 10913, usageComplete: false })
})

it.each([83, 351])('uses a declared fresh epoch for nullable start fields and counts thoughts once: %s candidates', candidates => {
  const snapshot = decodeUsageSnapshots({
    version: 1, provenance: 'sdk-cumulative', promptId: 'fresh-fields', sessionKey: 'session-1', baseline: 'fresh-session', completed: false,
    start: { prompt_token_count: null, candidates_token_count: null, thoughts_token_count: null, total_token_count: null, cached_content_token_count: null },
    end: { prompt_token_count: 10562, candidates_token_count: candidates, thoughts_token_count: 268, total_token_count: 10913, cached_content_token_count: 0 },
  })
  expect(sdkUsage(snapshot)).toEqual({ inputTokens: 10562, outputTokens: 351, reasoningTokens: 268, cacheReadTokens: 0, totalTokens: 10913, usageComplete: false })
})

it('forwards live request evidence without inventing usage or a configuration notice', () => {
  const bounds = { maxTextBytes: 1024, maxPayloadBytes: 4096 }
  expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'session_info_update', _meta: { 'agy.requestTelemetry': telemetry } }, bounds)).toEqual({ type: 'usage', requestTelemetry: telemetry })
  expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'session_info_update', _meta: { 'agy.requestTelemetry': { ...telemetry, version: 2 } } }, bounds)).toBeNull()
})

it('pairs native request tokens with request time, preserving unknown cache', () => {
  const decoded = decodeRequestTelemetry(telemetry)
  expect(decoded).toEqual(telemetry)
  expect(decoded?.requests[0]?.usageMetadata).not.toHaveProperty('cachedContentTokenCount')
  expect(requestThroughput(decoded)).toEqual({ outputTokens: 50, elapsedMs: 1000, requestCount: 1 })
  expect(decodeRequestTelemetry({ ...telemetry, requests: [{ ...request, usageMetadata: { ...request.usageMetadata, cachedContentTokenCount: 0 } }] })?.requests[0]?.usageMetadata?.cachedContentTokenCount).toBe(0)
})

it('sums request durations rather than parallel wall time and excludes unpaired requests', () => {
  const decoded = decodeRequestTelemetry({ ...telemetry, requests: [
    request, { ...request, requestId: 'request-2', durationMs: 2000 },
    { ...request, requestId: 'failed', status: 'failed' },
    { ...request, requestId: 'missing', usageMetadata: null },
  ] })
  expect(requestThroughput(decoded)).toEqual({ outputTokens: 100, elapsedMs: 3000, requestCount: 2 })
  expect(requestThroughput(undefined)).toBeUndefined()
})

it('rejects duplicate identities, unsafe durations and invalid usage without inventing samples', () => {
  for (const requests of [
    [request, request], [{ ...request, durationMs: -1 }], [{ ...request, durationMs: Number.NaN }],
    [{ ...request, usageMetadata: { ...request.usageMetadata, cachedContentTokenCount: -1 } }],
  ]) expect(decodeRequestTelemetry({ ...telemetry, requests })).toBeUndefined()
  expect(requestThroughput(decodeRequestTelemetry({ ...telemetry, requests: [{ ...request, durationMs: 0 }] }))).toBeUndefined()
  expect(requestThroughput(decodeRequestTelemetry({ ...telemetry, requests: [{ ...request, usageMetadata: { ...request.usageMetadata, totalTokenCount: 999 } }] }))).toBeUndefined()
})
