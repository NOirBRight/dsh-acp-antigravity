/** Native model-request evidence; request elapsed time includes prefill and first-token wait. */
import type { ExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { isRecord, stringValue } from './decode.js'
import { acpUsage, reportedUsage } from './usage.js'

/** One upstream attempt; session attribution does not identify a child agent. */
export interface NativeModelRequest {
  readonly requestId: string
  readonly model: string
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly durationMs: number
  readonly usageMetadata: Readonly<Record<string, unknown>> | null
}

/** Exact prompt-scoped request evidence forwarded by the native OAuth proxy. */
export interface NativeRequestTelemetry {
  readonly version: 1
  readonly provenance: 'ccpa-proxy'
  readonly scope: 'session'
  readonly promptId: string
  readonly sessionKey: string
  readonly requests: readonly NativeModelRequest[]
}

/** Raw cumulative SDK snapshots; only fresh-session establishes an absent baseline as zero. */
export interface NativeUsageSnapshots {
  readonly version: 1
  readonly provenance: 'sdk-cumulative'
  readonly promptId: string
  readonly sessionKey: string
  readonly baseline: 'fresh-session' | 'cumulative'
  readonly completed: boolean
  readonly start: Readonly<Record<string, number | null>> | null
  readonly end: Readonly<Record<string, number | null>> | null
}

/** Validate raw cumulative snapshots without deriving or zero-filling counters.
 * @param value - The agy.usageSnapshots metadata value.
 * @returns Validated raw counters or undefined for unavailable/invalid metadata.
 */
export function decodeUsageSnapshots(value: unknown): NativeUsageSnapshots | undefined {
  if (!isRecord(value) || value.version !== 1 || value.provenance !== 'sdk-cumulative' ||
    (value.baseline !== 'fresh-session' && value.baseline !== 'cumulative') || typeof value.completed !== 'boolean') return undefined
  const promptId = stringValue(value.promptId)
  const sessionKey = stringValue(value.sessionKey)
  if (promptId === undefined || sessionKey === undefined) return undefined
  const snapshots: (Record<string, number | null> | null)[] = []
  for (const source of [value.start, value.end]) {
    if (source === null) { snapshots.push(null); continue }
    if (!isRecord(source)) return undefined
    const snapshot: Record<string, number | null> = {}
    for (const key of ['prompt_token_count', 'candidates_token_count', 'thoughts_token_count', 'total_token_count', 'cached_content_token_count']) {
      const count = source[key]
      if (count !== null && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) return undefined
      snapshot[key] = count
    }
    snapshots.push(snapshot)
  }
  return { version: 1, provenance: 'sdk-cumulative', promptId, sessionKey, baseline: value.baseline, completed: value.completed, start: snapshots[0]!, end: snapshots[1]! }
}

const sdkCountKeys = ['prompt_token_count', 'candidates_token_count', 'thoughts_token_count', 'total_token_count', 'cached_content_token_count'] as const

/** Convert validated SDK snapshots to disjoint DSH counts. SDK prompt/total exclude cache.
 * @param snapshots - Validated agy.usageSnapshots, or undefined.
 * @returns Known uncached input and output including thoughts once, or undefined for rewind/unknown baseline.
 */
export function sdkUsage(snapshots: NativeUsageSnapshots | undefined): TokenUsage | undefined {
  if (snapshots === undefined || snapshots.end === null) return undefined
  const fresh = snapshots.baseline === 'fresh-session'
  if (snapshots.start === null && !fresh) return undefined
  if (snapshots.start !== null) {
    for (const key of sdkCountKeys) {
      const start = snapshots.start[key]
      const end = snapshots.end[key]
      if (typeof start === 'number' && typeof end === 'number' && end < start) return undefined
    }
  }
  const delta = (key: (typeof sdkCountKeys)[number]): number | undefined => {
    const end = snapshots.end![key]
    if (end == null) return undefined
    const start = snapshots.start?.[key]
    return start == null ? (fresh ? end : undefined) : end - start
  }
  const prompt = delta('prompt_token_count')
  const candidates = delta('candidates_token_count')
  const total = delta('total_token_count')
  const thoughts = delta('thoughts_token_count')
  const cached = delta('cached_content_token_count')
  if (prompt === undefined || candidates === undefined || total === undefined) return undefined
  const output = total - prompt
  if (output !== candidates && (thoughts === undefined || output !== candidates + thoughts)) return undefined
  const usage: Record<string, unknown> = {
    inputTokens: prompt,
    outputTokens: output,
  }
  if (thoughts !== undefined) usage.reasoningTokens = thoughts
  if (cached !== undefined) {
    usage.cacheReadTokens = cached
    usage.totalTokens = total + cached
  }
  if (snapshots.completed === false || cached === undefined) usage.usageComplete = false
  return reportedUsage(usage)
}

/** Native extension preserved by the provider host's payload bounds. */
export type AntigravityUsageEvent = Extract<ExternalAgentEvent, { type: 'usage' }> & {
  readonly requestTelemetry?: NativeRequestTelemetry
  readonly usageSnapshots?: NativeUsageSnapshots
}

/** Paired sample totals; elapsed time is summed even for concurrent requests. */
export interface RequestThroughput {
  outputTokens: number
  elapsedMs: number
  requestCount: number
}

const countKeys = [
  'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount',
  'prompt_token_count', 'candidates_token_count', 'thoughts_token_count', 'total_token_count', 'cached_content_token_count',
] as const

/** Validate wire or durable request evidence without filling missing counters.
 * @param value - The agy.requestTelemetry metadata value.
 * @returns Validated evidence, or undefined for missing/invalid metadata.
 */
export function decodeRequestTelemetry(value: unknown): NativeRequestTelemetry | undefined {
  if (!isRecord(value) || value.version !== 1 || value.provenance !== 'ccpa-proxy' || value.scope !== 'session') return undefined
  const promptId = stringValue(value.promptId)
  const sessionKey = stringValue(value.sessionKey)
  if (promptId === undefined || sessionKey === undefined || !Array.isArray(value.requests)) return undefined
  const requests: NativeModelRequest[] = []
  const ids = new Set<string>()
  for (const raw of value.requests) {
    if (!isRecord(raw)) return undefined
    const requestId = stringValue(raw.requestId)
    const model = stringValue(raw.model)
    if (requestId === undefined || model === undefined || ids.has(requestId)) return undefined
    if (raw.status !== 'completed' && raw.status !== 'failed' && raw.status !== 'cancelled') return undefined
    if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0) return undefined
    const usageMetadata = raw.usageMetadata
    if (usageMetadata !== null && !isRecord(usageMetadata)) return undefined
    if (usageMetadata !== null && countKeys.some(key => usageMetadata[key] !== undefined &&
      (typeof usageMetadata[key] !== 'number' || !Number.isSafeInteger(usageMetadata[key]) || usageMetadata[key] < 0))) return undefined
    ids.add(requestId)
    requests.push({ requestId, model, status: raw.status, durationMs: raw.durationMs, usageMetadata })
  }
  return { version: 1, provenance: 'ccpa-proxy', scope: 'session', promptId, sessionKey, requests }
}

/** Sum only successful requests with consistent output accounting and positive elapsed time.
 * @param telemetry - Validated native request evidence.
 * @returns Matched numerator and denominator, or undefined when no request is measurable.
 */
export function requestThroughput(telemetry: NativeRequestTelemetry | undefined): RequestThroughput | undefined {
  const sample: RequestThroughput = { outputTokens: 0, elapsedMs: 0, requestCount: 0 }
  for (const request of telemetry?.requests ?? []) {
    if (request.status !== 'completed' || request.durationMs <= 0 || request.usageMetadata === null) continue
    const raw = request.usageMetadata
    const usage = acpUsage({
      inputTokens: raw.promptTokenCount ?? raw.prompt_token_count,
      outputTokens: raw.candidatesTokenCount ?? raw.candidates_token_count,
      thoughtTokens: raw.thoughtsTokenCount ?? raw.thoughts_token_count,
      totalTokens: raw.totalTokenCount ?? raw.total_token_count,
      cachedReadTokens: raw.cachedContentTokenCount ?? raw.cached_content_token_count,
    })
    if (usage === undefined) continue
    sample.outputTokens += usage.outputTokens
    sample.elapsedMs += request.durationMs
    sample.requestCount += 1
  }
  return sample.requestCount > 0 && Number.isSafeInteger(sample.outputTokens) && Number.isFinite(sample.elapsedMs) ? sample : undefined
}
