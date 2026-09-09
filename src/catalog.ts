/** Collapse Antigravity native model ids (`…-high|medium|low`) and display-name aliases into one picker row plus efforts. */

const EFFORTS = ['high', 'medium', 'low'] as const
export type AntigravityEffort = (typeof EFFORTS)[number]

const EFFORT_NAMES: Record<AntigravityEffort, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const DEFAULT_EFFORT = 'default'

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
  baseNative?: string
}

export function collapseAntigravityModels(models: readonly { id: string; name: string }[]): readonly {
  id: string
  name: string
  reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort: string }
}[] {
  const groups = new Map<string, CollapseGroup>()
  const order: string[] = []
  for (const model of models) {
    const peeled = peelEffort(model.id)
    const effort = peeled.effort ?? nameEffort(model.name)
    const key = peeled.effort ? peeled.logical : model.id
    let group = groups.get(key)
    if (group === undefined) {
      group = { name: stripEffortLabel(model.name), efforts: [], native: [] }
      groups.set(key, group)
      order.push(key)
    }
    group.native.push(model.id)
    if (effort !== undefined && !group.efforts.includes(effort)) group.efforts.push(effort)
    if (effort === undefined) {
      group.name = model.name
      group.baseNative = model.id
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
    const efforts = group.baseNative !== undefined && named.length > 0
      ? [{ id: DEFAULT_EFFORT, name: 'Default' }, ...named]
      : named
    return {
      id,
      name: group.name,
      ...(efforts.length === 0 ? {} : {
        reasoning: {
          efforts,
          defaultEffort: group.efforts.includes('high') ? 'high' : efforts[0]!.id,
        },
      }),
    }
  })
}

export function nativeAntigravityModelId(
  logical: string,
  effort: string | undefined,
  nativeIds: readonly string[],
  nativeModels: readonly { id: string; name: string }[] = [],
): string {
  const ids = new Set(nativeIds)
  if (effort === undefined || effort === DEFAULT_EFFORT) {
    if (ids.has(logical)) return logical
  }
  const candidates = [effort, 'high', 'medium', 'low'].filter((value): value is string => typeof value === 'string' && value.length > 0 && value !== DEFAULT_EFFORT)
  for (const item of candidates) {
    const id = logical + '-' + item
    if (ids.has(id)) return id
  }
  if (effort !== undefined && effort !== DEFAULT_EFFORT && nativeModels.length > 0) {
    const base = nativeModels.find(model => model.id === logical)
    const baseName = stripEffortLabel(base?.name ?? '')
    const label = ' (' + (EFFORT_NAMES[effort as AntigravityEffort] ?? effort) + ')'
    const alias = nativeModels.find(model => stripEffortLabel(model.name) === baseName && model.name.endsWith(label))
    if (alias !== undefined) return alias.id
  }
  if (ids.has(logical)) return logical
  if (effort !== undefined && effort !== DEFAULT_EFFORT) return logical + '-' + effort
  return logical
}

/** Native rows that collapse to High/Medium/Low when ACP has not listed the account yet. */
export function effortVariants(id: string): { id: string; name: string }[] {
  const logical = peelEffort(id).logical
  return [
    { id: logical, name: logical },
    { id: logical + '-high', name: logical + ' (High)' },
    { id: logical + '-medium', name: logical + ' (Medium)' },
    { id: logical + '-low', name: logical + ' (Low)' },
  ]
}
