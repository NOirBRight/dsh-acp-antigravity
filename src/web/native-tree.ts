/** Native trajectory grouping; no launch-to-child or timing inference. */
import type { AntigravityAgentData, AntigravityToolRowData } from './native-activity.js'

export type NativeActivityBranch =
  | { kind: 'tool'; key: string; row: AntigravityToolRowData; order: number }
  | NativeAgentBranch

export interface NativeAgentBranch {
  kind: 'agent'
  key: string
  trajectoryId: string
  firstSeenAt: string
  order: number
  toolCount: number
  children: NativeActivityBranch[]
}

/** Group child tools exactly once by native trajectory within a runtime epoch.
 * Missing or conflicting ancestry stays at the root; cycles are cut without losing rows.
 * @param rows - Folded native activity in first-seen order.
 * @param observations - First child sightings, including agents that emit no tools.
 * @returns Ordered root tools and recursively nested, independent child trajectories.
 */
export function groupNativeActivity(rows: readonly AntigravityToolRowData[], observations: readonly AntigravityAgentData[] = []): NativeActivityBranch[] {
  const agents = new Map<string, NativeAgentBranch>()
  const parents = new Map<string, string | undefined>()
  const conflicts = new Set<string>()
  const keyOf = (row: { epoch: number }, trajectory: string): string => `${row.epoch}\n${trajectory}`
  const points: AntigravityAgentData[] = [...observations, ...rows.flatMap(row => row.state.ownership === undefined ? [] : [{ ...row, ownership: row.state.ownership }])]
  points.sort((a, b) => Number(a.key) - Number(b.key))
  for (const row of points) {
    const order = Number(row.key)
    const owner = row.ownership
    const key = keyOf(row, owner.trajectoryId)
    const parent = owner.parentTrajectoryId === undefined ? undefined : keyOf(row, owner.parentTrajectoryId)
    if (parent !== undefined) {
      if (parents.has(key) && parents.get(key) !== parent) conflicts.add(key)
      else parents.set(key, parent)
    }
    if ((parent !== undefined || (owner.depth ?? 0) > 0) && !agents.has(key)) {
      agents.set(key, { kind: 'agent', key, trajectoryId: owner.trajectoryId, firstSeenAt: row.firstSeenAt, order, toolCount: 0, children: [] })
    }
  }
  for (const [key] of agents) {
    const parent = parents.get(key)
    if (conflicts.has(key) || parent === key || parent === undefined || !agents.has(parent)) parents.delete(key)
  }
  // Each ancestry path is visited once, including corrupt cyclic histories.
  const done = new Set<string>()
  for (const key of agents.keys()) {
    const path = new Set<string>()
    let cursor: string | undefined = key
    while (cursor !== undefined && !done.has(cursor)) {
      if (path.has(cursor)) { parents.delete(cursor); break }
      path.add(cursor)
      cursor = parents.get(cursor)
    }
    for (const visited of path) done.add(visited)
  }
  const roots: NativeActivityBranch[] = []
  for (const row of rows) {
    const order = Number(row.key)
    const owner = row.state.ownership
    const agent = owner === undefined ? undefined : agents.get(keyOf(row, owner.trajectoryId))
    const branch: NativeActivityBranch = { kind: 'tool', key: row.key, row, order }
    if (agent === undefined) roots.push(branch)
    else {
      agent.children.push(branch)
      agent.toolCount += 1
      if (order < agent.order) { agent.order = order; agent.firstSeenAt = row.firstSeenAt }
    }
  }
  for (const [key, agent] of agents) {
    const parentKey = parents.get(key)
    const parent = parentKey === undefined ? undefined : agents.get(parentKey)
    if (parent === undefined) roots.push(agent)
    else parent.children.push(agent)
  }
  const pending = new Map([...agents].map(([key, agent]) => [key, agent.children.filter(child => child.kind === 'agent').length]))
  const ready = [...agents.values()].filter(agent => pending.get(agent.key) === 0)
  for (let index = 0; index < ready.length; index += 1) {
    const agent = ready[index]!
    agent.children.sort((a, b) => a.order - b.order)
    const parentKey = parents.get(agent.key)
    const parent = parentKey === undefined ? undefined : agents.get(parentKey)
    if (parent === undefined) continue
    parent.toolCount += agent.toolCount
    if (agent.order < parent.order) { parent.order = agent.order; parent.firstSeenAt = agent.firstSeenAt }
    const remaining = pending.get(parent.key)! - 1
    pending.set(parent.key, remaining)
    if (remaining === 0) ready.push(parent)
  }
  return roots.sort((a, b) => a.order - b.order)
}
