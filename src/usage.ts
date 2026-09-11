import type { TokenUsage } from '@deepseek-ai/dsh-llm'

type NativeTokenUsage = TokenUsage & { usageComplete?: boolean }
import { isRecord } from './decode.js'

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Validate canonical DSH counts, including native details retained by the provider host.
 * @param value - Canonical usage carried by a provider event.
 * @returns Complete known counts, or undefined for invalid accounting.
 */
export function reportedUsage(value: unknown): NativeTokenUsage | undefined {
  if (!isRecord(value) || !isTokenCount(value.inputTokens) || !isTokenCount(value.outputTokens)) return undefined
  const usage: NativeTokenUsage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }
  for (const key of ['totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (value[key] == null) continue
    if (!isTokenCount(value[key])) return undefined
    usage[key] = value[key]
  }
  if ((usage.reasoningTokens ?? 0) > usage.outputTokens) return undefined
  if (usage.totalTokens !== undefined && usage.totalTokens !== usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) return undefined
  if (value.usageComplete != null && typeof value.usageComplete !== 'boolean') return undefined
  if (typeof value.usageComplete === 'boolean') usage.usageComplete = value.usageComplete
  return usage
}

/** Add reported usage from distinct native prompts, never cumulative updates within one prompt. */
export function sumTurnUsage(first: NativeTokenUsage | undefined, second: NativeTokenUsage | undefined): NativeTokenUsage | undefined {
  if (first === undefined || second === undefined) return undefined
  const combined: NativeTokenUsage = { inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens }
  for (const key of ['totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (first[key] !== undefined && second[key] !== undefined) combined[key] = first[key] + second[key]
  }
  if (first.usageComplete === false || second.usageComplete === false) combined.usageComplete = false
  return reportedUsage(combined)
}

/**
 * Convert aggregate ACP input and thoughts to disjoint DSH accounting.
 * @param value - Native ACP usage; totals must disambiguate separately reported thoughts.
 * @returns Known counts, or undefined for missing or inconsistent accounting.
 */
/**
 * Fill absent canonical usage keys from telemetry spellings. Canonical keys
 * win; nothing is overwritten, so this only widens what validators accept.
 * @param value - Usage-shaped record in either spelling.
 * @returns The same record with canonical aliases filled in.
 */
export function withTelemetryKeys(value: unknown): unknown {
  if (!isRecord(value)) return value
  const get = (...keys: string[]): unknown => {
    for (const key of keys) if (value[key] !== undefined) return value[key]
    return undefined
  }
  const put = (key: string, found: unknown): Record<string, unknown> => found === undefined || value[key] !== undefined ? {} : { [key]: found }
  return {
    ...value,
    ...put('inputTokens', get('promptTokenCount', 'prompt_token_count')),
    ...put('outputTokens', get('candidatesTokenCount', 'candidates_token_count')),
    ...put('thoughtTokens', get('thoughtsTokenCount', 'thoughts_token_count')),
    ...put('totalTokens', get('totalTokenCount', 'total_token_count')),
    ...put('cachedReadTokens', get('cachedContentTokenCount', 'cached_content_token_count')),
  }
}

/**
 * Project validated native accounting onto the official host TokenUsage.
 * Completeness stays plugin-owned (sidecar telemetry, usage snapshots): only
 * official count keys cross into host stream chunks and the session log, so a
 * partial sample can never poison closed host validation or V3 migration.
 * @param sample - Validated native accounting, possibly carrying usageComplete.
 * @returns Official count keys only.
 */
export function hostUsage(sample: NativeTokenUsage): TokenUsage {
  const usage: TokenUsage = { inputTokens: sample.inputTokens, outputTokens: sample.outputTokens }
  for (const key of ['totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (sample[key] !== undefined) usage[key] = sample[key]
  }
  return usage
}

export function acpUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined
  const input = value.inputTokens ?? value.input_tokens
  let output = value.outputTokens ?? value.output_tokens
  if (!isTokenCount(input) || !isTokenCount(output)) return undefined
  const thoughts = value.thoughtTokens
  const read = value.cachedReadTokens ?? 0
  const write = value.cachedWriteTokens ?? 0
  if (!isTokenCount(read) || !isTokenCount(write)) return undefined
  if (thoughts != null) {
    if (!isTokenCount(thoughts)) return undefined
    if (thoughts > 0) {
      if (value.totalTokens === input + output + thoughts) output += thoughts
      else if (value.totalTokens !== input + output) return undefined
    }
  }
  return reportedUsage({
    inputTokens: input - read - write, outputTokens: output,
    totalTokens: value.totalTokens, reasoningTokens: thoughts,
    cacheReadTokens: value.cachedReadTokens, cacheWriteTokens: value.cachedWriteTokens,
  })
}
