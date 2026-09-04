/** Collapse Antigravity native model ids (`…-high|medium|low`) into one picker row plus efforts. */

const EFFORTS = ['high', 'medium', 'low'] as const
export type AntigravityEffort = (typeof EFFORTS)[number]

const EFFORT_NAMES: Record<AntigravityEffort, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function peelEffort(id: string): { logical: string; effort?: AntigravityEffort } {
  for (const effort of EFFORTS) {
    const suffix = '-' + effort
    if (id.endsWith(suffix) && id.length > suffix.length) return { logical: id.slice(0, -suffix.length), effort }
  }
  return { logical: id }
}

export function collapseAntigravityModels(models: readonly { id: string; name: string }[]): readonly {
  id: string
  name: string
  reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort: string }
}[] {
  const groups = new Map<string, { name: string; efforts: AntigravityEffort[]; native: string[] }>()
  const order: string[] = []
  for (const model of models) {
    const { logical, effort } = peelEffort(model.id)
    let group = groups.get(logical)
    if (group === undefined) {
      group = { name: stripEffortLabel(model.name), efforts: [], native: [] }
      groups.set(logical, group)
      order.push(logical)
    }
    group.native.push(model.id)
    if (effort !== undefined && !group.efforts.includes(effort)) group.efforts.push(effort)
    if (effort === undefined) group.name = model.name
  }
  return order.map(id => {
    const group = groups.get(id)!
    const efforts = EFFORTS.filter(effort => group.efforts.includes(effort)).map(effort => ({ id: effort, name: EFFORT_NAMES[effort] }))
    return {
      id,
      name: group.name,
      ...(efforts.length > 0 ? { reasoning: { efforts, defaultEffort: group.efforts.includes('high') ? 'high' : efforts[0]!.id } } : {}),
    }
  })
}

export function nativeAntigravityModelId(logical: string, effort: string | undefined, nativeIds: readonly string[]): string {
  const ids = new Set(nativeIds)
  if (ids.has(logical)) return logical
  const candidates = [effort, 'high', 'medium', 'low'].filter((value): value is string => typeof value === 'string' && value.length > 0)
  for (const item of candidates) {
    const id = logical + '-' + item
    if (ids.has(id)) return id
  }
  return logical
}

function stripEffortLabel(name: string): string {
  for (const label of [' (High)', ' (Medium)', ' (Low)']) {
    if (name.endsWith(label)) return name.slice(0, -label.length)
  }
  return name
}
