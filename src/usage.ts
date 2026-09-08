import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { isRecord } from './decode.js'

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Validate canonical DSH counts, including native details retained by the provider host.
 * @param value - Canonical usage carried by a provider event.
 * @returns Complete known counts, or undefined for invalid accounting.
 */
export function reportedUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value) || !isTokenCount(value.inputTokens) || !isTokenCount(value.outputTokens)) return undefined
  const usage: TokenUsage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }
  for (const key of ['totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (value[key] == null) continue
    if (!isTokenCount(value[key])) return undefined
    usage[key] = value[key]
  }
  if ((usage.reasoningTokens ?? 0) > usage.outputTokens) return undefined
  if (usage.totalTokens !== undefined && usage.totalTokens !== usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) return undefined
  return usage
}

/** Add complete usage from distinct native prompts, never cumulative updates within one prompt. */
export function sumTurnUsage(first: TokenUsage | undefined, second: TokenUsage | undefined): TokenUsage | undefined {
  if (first === undefined || second === undefined) return undefined
  const combined: TokenUsage = { inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens }
  for (const key of ['totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (first[key] !== undefined && second[key] !== undefined) combined[key] = first[key] + second[key]
  }
  return reportedUsage(combined)
}

/**
 * Convert aggregate ACP input and thoughts to disjoint DSH accounting.
 * @param value - Native ACP usage; totals must disambiguate separately reported thoughts.
 * @returns Known counts, or undefined for missing or inconsistent accounting.
 */
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
