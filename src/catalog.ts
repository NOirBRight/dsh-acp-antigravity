/** Collapse Antigravity native model ids into one picker row plus discovered efforts. */
import type { FactKey, FieldSource, ModelFacts } from './model-metadata.js'

const EFFORTS = ['high', 'medium', 'low'] as const
export type AntigravityEffort = (typeof EFFORTS)[number]

const EFFORT_NAMES: Record<AntigravityEffort, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const DEFAULT_EFFORT = 'default'
/** Native account-default alias: a session routing marker, never a selectable catalog row. */
const NATIVE_DEFAULT_ID = 'default'

export function peelEffort(id: string): { logical: string; effort?: AntigravityEffort } {
  for (const effort of EFFORTS) {
    const suffix = '-' + effort
    if (id.endsWith(suffix) && id.length > suffix.length) return { logical: id.slice(0, -suffix.length), effort }
  }
  return { logical: id }
}

function nameEffort(name: string): AntigravityEffort | undefined {
  for (const effort of EFFORTS) {
    const label = ' (' + EFFORT_NAMES[effort] + ')'
    if (name.endsWith(label)) return effort
  }
}

function stripEffortLabel(name: string): string {
  for (const label of [' (High)', ' (Medium)', ' (Low)']) {
    if (name.endsWith(label)) return name.slice(0, -label.length)
  }
  return name
}

interface CollapseGroup {
  name: string
  efforts: AntigravityEffort[]
  native: string[]
  effortMap: Record<string, string>
  baseNative?: string
}

function agree<T>(values: readonly (T | undefined)[]): T | undefined {
  const present = values.filter((value): value is T => value !== undefined)
  if (present.length === 0) return undefined
  const first = present[0]
  return present.every(value => Object.is(value, first)) ? first : undefined
}

export interface CollapsedAntigravityModel {
  readonly id: string
  readonly name: string
  readonly nativeIds: readonly string[]
  readonly effortMap: Readonly<Record<string, string>>
  readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[]; readonly defaultEffort?: string }
  readonly vision?: boolean
  readonly thinking?: boolean
  readonly inputTokenLimit?: number
  readonly maxOutputTokens?: number
  readonly contextWindow?: number
  readonly sources?: Readonly<Partial<Record<FactKey, FieldSource>>>
  /** Fields the user overrode; absent when the row matches discovery. */
  readonly overrides?: Readonly<Record<string, boolean>>
}

export function collapseAntigravityModels(
  models: readonly { id: string; name: string }[],
  factsByNative: ReadonlyMap<string, ModelFacts> = new Map(),
  declaredDefaultModelId?: string,
): readonly CollapsedAntigravityModel[] {
  const groups = new Map<string, CollapseGroup>()
  const order: string[] = []
  for (const model of models) {
    if (model.id === NATIVE_DEFAULT_ID) continue
    const peeled = peelEffort(model.id)
    const effort = peeled.effort ?? nameEffort(model.name)
    const key = peeled.effort ? peeled.logical : model.id
    let group = groups.get(key)
    if (group === undefined) {
      group = { name: stripEffortLabel(model.name), efforts: [], native: [], effortMap: {} }
      groups.set(key, group)
      order.push(key)
    }
    group.native.push(model.id)
    if (effort !== undefined && !group.efforts.includes(effort)) group.efforts.push(effort)
    if (effort !== undefined) group.effortMap[effort] = model.id
    if (effort === undefined) {
      group.name = model.name
      group.baseNative = model.id
      group.effortMap[DEFAULT_EFFORT] = model.id
    }
  }

  const buckets = new Map<string, string[]>()
  for (const id of order) {
    const nameKey = stripEffortLabel(groups.get(id)!.name)
    const bucket = buckets.get(nameKey) ?? []
    bucket.push(id)
    buckets.set(nameKey, bucket)
  }
  const drop = new Set<string>()
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue
    const canonical = ids.find(id => groups.get(id)!.baseNative !== undefined) ?? ids[0]!
    const dst = groups.get(canonical)!
    for (const id of ids) {
      if (id === canonical) continue
      const src = groups.get(id)!
      for (const effort of src.efforts) if (!dst.efforts.includes(effort)) dst.efforts.push(effort)
      dst.native.push(...src.native)
      Object.assign(dst.effortMap, src.effortMap)
      if (dst.baseNative === undefined && src.baseNative !== undefined) dst.baseNative = src.baseNative
      drop.add(id)
    }
  }

  return order.filter(id => !drop.has(id)).map(id => {
    const group = groups.get(id)!
    const named = EFFORTS.filter(effort => group.efforts.includes(effort)).map(effort => ({
      id: effort,
      name: EFFORT_NAMES[effort],
    }))
    const efforts = named
    const facts = group.native.map(nativeId => factsByNative.get(nativeId)).filter((value): value is ModelFacts => value !== undefined)
    const vision = agree(facts.map(item => item.vision))
    const thinking = agree(facts.map(item => item.thinking))
    const inputTokenLimit = agree(facts.map(item => item.inputTokenLimit))
    const maxOutputTokens = agree(facts.map(item => item.maxOutputTokens))
    const contextWindow = agree(facts.map(item => item.contextWindow))
    const discoveredDefault = agree(facts.map(item => item.defaultEffort))
    // The account's declared default model names one variant of its own model, so
    // its effort is the level Antigravity itself routes to when none is chosen.
    const declaredDefault = declaredDefaultModelId !== undefined && group.native.includes(declaredDefaultModelId)
      ? peelEffort(declaredDefaultModelId).effort
      : undefined
    // Only a routable effort is a default: an id outside efforts cannot be sent.
    // Discovery and the account's declared default win; otherwise the provider
    // preset applies, the highest discovered level (EFFORTS order puts high first).
    // The preset is catalog data, never a user override, so Restore falls back to it.
    const defaultEffort = [discoveredDefault, declaredDefault]
      .find(candidate => candidate !== undefined && efforts.some(item => item.id === candidate))
      ?? efforts[0]?.id
    const sources: Partial<Record<FactKey, FieldSource>> = {}
    for (const key of ['vision', 'thinking', 'inputTokenLimit', 'maxOutputTokens', 'contextWindow', 'defaultEffort'] as const) {
      const source = agree(facts.map(item => item.sources[key]))
      if (source !== undefined) sources[key] = source
    }
    // The derived level is upstream data too, so the card shows it as discovered.
    if (defaultEffort !== undefined && defaultEffort === declaredDefault) sources.defaultEffort = 'upstream'
    return {
      id,
      name: group.name,
      nativeIds: group.native,
      effortMap: group.effortMap,
      ...(efforts.length === 0 ? {} : {
        reasoning: {
          efforts,
          ...(defaultEffort === undefined ? {} : { defaultEffort }),
        },
      }),
      ...(vision === undefined ? {} : { vision }),
      ...(thinking === undefined ? {} : { thinking }),
      ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(Object.keys(sources).length === 0 ? {} : { sources }),
    }
  })
}

export type CatalogOverlay = {
  readonly name?: string
  readonly vision?: boolean
  readonly thinking?: boolean
  readonly contextWindow?: number
  readonly inputTokenLimit?: number
  readonly maxOutputTokens?: number
  readonly reasoning?: { readonly defaultEffort?: string; readonly efforts?: readonly { readonly id: string; readonly name: string }[] }
}

/** Apply saved membership and field overrides. Undefined order means every discovered row.
 * @param discovered collapsed native rows.
 * @param order saved ids, including manual rows; empty hides every discovered row.
 * @param overrides per-id field overlays.
 * @returns the composed catalog in saved order.
 */
export function applyCatalogOverlay(
  discovered: readonly CollapsedAntigravityModel[],
  order: readonly string[] | undefined,
  overrides: Readonly<Record<string, CatalogOverlay>> | undefined,
): CollapsedAntigravityModel[] {
  const byId = new Map(discovered.map(model => [model.id, model]))
  // A saved order is the user's explicit membership: discovered rows absent from
  // it stay deselected until Refresh models re-adds them. Without a saved order
  // every discovered row shows.
  const ids = order === undefined ? discovered.map(model => model.id) : [...order]
  return ids.flatMap(id => {
    const base = byId.get(id)
    const over = overrides?.[id]
    if (base === undefined) {
      if (over === undefined || over.name === undefined) return []
      const row: CollapsedAntigravityModel = {
        id,
        name: over.name,
        nativeIds: [id],
        effortMap: {},
        ...(typeof over.vision === 'boolean' ? { vision: over.vision } : {}),
        ...(typeof over.thinking === 'boolean' ? { thinking: over.thinking } : {}),
        ...(typeof over.contextWindow === 'number' ? { contextWindow: over.contextWindow } : {}),
        ...(over.reasoning?.efforts === undefined
          ? {}
          : { reasoning: { efforts: over.reasoning.efforts, ...(over.reasoning.defaultEffort === undefined ? {} : { defaultEffort: over.reasoning.defaultEffort }) } }),
        overrides: { name: true },
      }
      return [row]
    }
    if (over === undefined) return [base]
    const defaultEffort = over.reasoning?.defaultEffort ?? (over.reasoning === undefined ? base.reasoning?.defaultEffort : undefined)
    const name = typeof over.name === 'string' && over.name.length > 0 ? over.name : base.name
    const vision = typeof over.vision === 'boolean' ? over.vision : base.vision
    const thinking = typeof over.thinking === 'boolean' ? over.thinking : base.thinking
    const contextWindow = typeof over.contextWindow === 'number' ? over.contextWindow : base.contextWindow
    const inputTokenLimit = typeof over.inputTokenLimit === 'number' ? over.inputTokenLimit : base.inputTokenLimit
    const maxOutputTokens = typeof over.maxOutputTokens === 'number' ? over.maxOutputTokens : base.maxOutputTokens
    const reasoning = base.reasoning === undefined && defaultEffort === undefined ? undefined : {
      efforts: over.reasoning?.efforts ?? base.reasoning?.efforts ?? [],
      ...(defaultEffort === undefined ? {} : { defaultEffort }),
    }
    const flags: Record<string, boolean> = {}
    if (name !== base.name) flags.name = true
    if (vision !== base.vision && typeof over.vision === 'boolean') flags.vision = true
    if (thinking !== base.thinking && typeof over.thinking === 'boolean') flags.thinking = true
    if (contextWindow !== base.contextWindow && typeof over.contextWindow === 'number') flags.contextWindow = true
    if (inputTokenLimit !== base.inputTokenLimit && typeof over.inputTokenLimit === 'number') flags.inputLimit = true
    if (maxOutputTokens !== base.maxOutputTokens && typeof over.maxOutputTokens === 'number') flags.output = true
    if ((reasoning?.defaultEffort ?? undefined) !== base.reasoning?.defaultEffort && defaultEffort !== undefined) flags.defaultEffort = true
    return [{
      ...base,
      name,
      ...(vision === undefined ? {} : { vision }),
      ...(thinking === undefined ? {} : { thinking }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(Object.keys(flags).length === 0 ? {} : { overrides: flags }),
    }]
  })
}

export function nativeAntigravityModelId(
  logical: string,
  effort: string | undefined,
  nativeIds: readonly string[],
  nativeModels: readonly { id: string; name: string }[] = [],
  effortMap: Readonly<Record<string, string>> = {},
): string {
  const ids = new Set(nativeIds)
  if (effort !== undefined && effort !== DEFAULT_EFFORT && effort !== 'native') {
    const mapped = effortMap[effort]
    if (mapped !== undefined && ids.has(mapped)) return mapped
    const suffixed = logical + '-' + effort
    if (ids.has(suffixed)) return suffixed
    if (nativeModels.length > 0) {
      const base = nativeModels.find(model => model.id === logical)
      const baseName = stripEffortLabel(base?.name ?? '')
      const label = ' (' + (EFFORT_NAMES[effort as AntigravityEffort] ?? effort) + ')'
      const alias = nativeModels.find(model => stripEffortLabel(model.name) === baseName && model.name.endsWith(label))
      if (alias !== undefined && ids.has(alias.id)) return alias.id
    }
    throw new Error('Unknown Antigravity reasoning effort: ' + effort)
  }
  if (effortMap[DEFAULT_EFFORT] !== undefined && ids.has(effortMap[DEFAULT_EFFORT])) return effortMap[DEFAULT_EFFORT]
  if (ids.has(logical)) return logical
  const first = nativeIds.find(id => peelEffort(id).logical === logical || id === logical)
  if (first !== undefined) return first
  throw new Error('Unknown Antigravity model: ' + logical)
}
