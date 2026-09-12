/** Per-field model facts: valid upstream, then exact models.dev, else unknown. Explicit false is kept. */

export const FIELD_SOURCES = ['upstream', 'models.dev'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

export const FACT_KEYS = ['vision', 'thinking', 'inputTokenLimit', 'maxOutputTokens', 'contextWindow', 'defaultEffort'] as const
export type FactKey = (typeof FACT_KEYS)[number]

export interface ModelFacts {
  readonly vision?: boolean
  readonly thinking?: boolean
  readonly inputTokenLimit?: number
  readonly maxOutputTokens?: number
  readonly contextWindow?: number
  readonly thinkingBudget?: number
  readonly minThinkingBudget?: number
  readonly defaultEffort?: string
  readonly sources: Readonly<Partial<Record<FactKey, FieldSource>>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function presentBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function presentPositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function presentEffort(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function take<T>(upstream: T | undefined, fallback: T | undefined): { value?: T; from?: FieldSource } {
  if (upstream !== undefined) return { value: upstream, from: 'upstream' }
  if (fallback !== undefined) return { value: fallback, from: 'models.dev' }
  return {}
}

/** Merge one native model's facts. Upstream, including false, always wins.
 * @param upstream CCPA or stored facts.
 * @param fallback models.dev facts.
 * @returns merged facts with per-field sources.
 */
export function mergeModelFacts(upstream: Partial<ModelFacts>, fallback?: Partial<ModelFacts>): ModelFacts {
  const sources: Partial<Record<FactKey, FieldSource>> = {}
  const vision = take(presentBoolean(upstream.vision), presentBoolean(fallback?.vision))
  const thinking = take(presentBoolean(upstream.thinking), presentBoolean(fallback?.thinking))
  const inputTokenLimit = take(presentPositive(upstream.inputTokenLimit), presentPositive(fallback?.inputTokenLimit))
  const maxOutputTokens = take(presentPositive(upstream.maxOutputTokens), presentPositive(fallback?.maxOutputTokens))
  const contextWindow = take(presentPositive(upstream.contextWindow), presentPositive(fallback?.contextWindow))
  const defaultEffort = take(presentEffort(upstream.defaultEffort), presentEffort(fallback?.defaultEffort))
  if (vision.from !== undefined) sources.vision = vision.from
  if (thinking.from !== undefined) sources.thinking = thinking.from
  if (inputTokenLimit.from !== undefined) sources.inputTokenLimit = inputTokenLimit.from
  if (maxOutputTokens.from !== undefined) sources.maxOutputTokens = maxOutputTokens.from
  if (contextWindow.from !== undefined) sources.contextWindow = contextWindow.from
  if (defaultEffort.from !== undefined) sources.defaultEffort = defaultEffort.from
  const thinkingBudget = typeof upstream.thinkingBudget === 'number' && Number.isSafeInteger(upstream.thinkingBudget) ? upstream.thinkingBudget : undefined
  const minThinkingBudget = presentPositive(upstream.minThinkingBudget)
  return {
    ...(vision.value === undefined ? {} : { vision: vision.value }),
    ...(thinking.value === undefined ? {} : { thinking: thinking.value }),
    ...(inputTokenLimit.value === undefined ? {} : { inputTokenLimit: inputTokenLimit.value }),
    ...(maxOutputTokens.value === undefined ? {} : { maxOutputTokens: maxOutputTokens.value }),
    ...(contextWindow.value === undefined ? {} : { contextWindow: contextWindow.value }),
    ...(defaultEffort.value === undefined ? {} : { defaultEffort: defaultEffort.value }),
    ...(thinkingBudget === undefined ? {} : { thinkingBudget }),
    ...(minThinkingBudget === undefined ? {} : { minThinkingBudget }),
    sources,
  }
}

const THINKING_LEVELS: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'minimal', 5: 'extra_high' }

/** Map CCPA thinkingLevel enum. 0/unspecified stays unknown.
 * @param value CCPA thinkingLevel number.
 * @returns effort id, or undefined.
 */
export function thinkingLevelOf(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? THINKING_LEVELS[value] : undefined
}

function mimeVision(types: unknown): boolean | undefined {
  if (!isRecord(types)) return undefined
  const keys = Object.keys(types)
  if (keys.length === 0) return undefined
  return keys.some(key => key.startsWith('image/') && types[key] === true)
}

/** Project one CCPA ModelDetails object. MIME map beats supportsImages when populated.
 * @param info one models map value.
 * @returns partial facts; missing keys stay unknown.
 */
export function factsFromCcpaDetails(info: unknown): Partial<ModelFacts> {
  if (!isRecord(info)) return {}
  const mimeVisionValue = mimeVision(info.supportedMimeTypes)
  const vision = mimeVisionValue !== undefined ? mimeVisionValue : presentBoolean(info.supportsImages)
  const thinking = presentBoolean(info.supportsThinking)
  const inputTokenLimit = presentPositive(info.maxTokens)
  const maxOutputTokens = presentPositive(info.maxOutputTokens)
  const minThinkingBudget = presentPositive(info.minThinkingBudget)
  const thinkingBudget = typeof info.thinkingBudget === 'number' && Number.isSafeInteger(info.thinkingBudget) ? info.thinkingBudget : undefined
  // thinkingLevel is one variant's enum, not a per-model defaultEffort.
  return {
    ...(vision === undefined ? {} : { vision }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(thinkingBudget === undefined ? {} : { thinkingBudget }),
    ...(minThinkingBudget === undefined ? {} : { minThinkingBudget }),
  }
}

function effortValues(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.reasoning_options)) return []
  const found: string[] = []
  for (const option of value.reasoning_options) {
    if (!isRecord(option) || option.type !== 'effort' || !Array.isArray(option.values)) continue
    for (const item of option.values) {
      if (typeof item === 'string' && item.trim() !== '' && !found.includes(item)) found.push(item)
    }
  }
  return found
}

/** Parse one models.dev model row. Does not invent a default effort.
 * @param value one models.dev model object.
 * @returns facts plus discovered effort ids.
 */
export function factsFromModelsDevRow(value: unknown): { facts: Partial<ModelFacts>; efforts: readonly string[] } {
  if (!isRecord(value)) return { facts: {}, efforts: [] }
  const limit = isRecord(value.limit) ? value.limit : undefined
  const modalities = isRecord(value.modalities) && Array.isArray(value.modalities.input) ? value.modalities.input : undefined
  const vision = modalities === undefined ? undefined : modalities.includes('image')
  const thinking = presentBoolean(value.reasoning)
  const contextWindow = presentPositive(limit?.context)
  const maxOutputTokens = presentPositive(limit?.output)
  return {
    facts: {
      ...(vision === undefined ? {} : { vision }),
      ...(thinking === undefined ? {} : { thinking }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    },
    efforts: effortValues(value),
  }
}

/** Exact provider.models[id] lookup. No family or suffix matching.
 * @param document models.dev JSON.
 * @param providerId vendor key.
 * @param modelId exact model id.
 * @returns the row, or undefined.
 */
export function modelsDevRow(document: unknown, providerId: string, modelId: string): unknown {
  if (!isRecord(document)) return undefined
  const provider = document[providerId]
  if (!isRecord(provider) || !isRecord(provider.models)) return undefined
  return provider.models[modelId]
}
