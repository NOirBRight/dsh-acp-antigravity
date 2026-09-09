import { beforeEach, describe, expect, it } from 'vitest'
import { groupNativeActivity, type NativeActivityBranch } from '../src/web/native-tree.js'
import type { AntigravityToolRowData } from '../src/web/native-activity.js'

let sequence = 0
beforeEach(() => { sequence = 0 })

function row(id: string, trajectoryId?: string, parentTrajectoryId?: string, epoch = 1): AntigravityToolRowData {
  return { key: String(++sequence), epoch, time: '2026-09-07T00:00:00Z', firstSeenAt: '2026-09-07T00:00:00Z',
    state: { toolId: id, name: 'Running read file', status: 'completed',
      ...(trajectoryId === undefined ? {} : { ownership: { trajectoryId, ...(parentTrajectoryId === undefined ? {} : { parentTrajectoryId }) } }) } }
}
function tools(branches: NativeActivityBranch[]): string[] {
  return branches.flatMap(branch => branch.kind === 'tool' ? [branch.row.state.toolId] : branch.kind === 'agent' ? tools(branch.children) : [])
}

describe('native trajectory containment', () => {
  it('keeps unknown and root tools flat; never infers a child from a launch title', () => {
    const legacy = row('launch')
    const branches = groupNativeActivity([legacy, row('root', 'root')])
    expect(branches.map(branch => branch.kind)).toEqual(['tool', 'tool'])
    expect(tools(branches)).toEqual(['launch', 'root'])
  })
  it('places concurrent child tools only in their respective collapsed-agent data', () => {
    const branches = groupNativeActivity([row('root', 'r'), row('a1', 'a', 'r'), row('b1', 'b', 'r'), row('a2', 'a', 'r')])
    expect(branches.map(branch => branch.kind)).toEqual(['tool', 'agent', 'agent'])
    expect(branches[1]).toMatchObject({ trajectoryId: 'a', toolCount: 2 })
    expect(branches[2]).toMatchObject({ trajectoryId: 'b', toolCount: 1 })
    expect(tools(branches)).toEqual(['root', 'a1', 'a2', 'b1'])
    expect(new Set(tools(branches)).size).toBe(4)
  })
  it('nests explicit grandchildren even when their first event arrives before the parent', () => {
    const branches = groupNativeActivity([row('grandchild', 'b', 'a'), row('root', 'r'), row('parent', 'a', 'r')])
    expect(branches[0]).toMatchObject({ kind: 'agent', trajectoryId: 'a', order: 1, toolCount: 2,
      children: [{ kind: 'agent', trajectoryId: 'b' }, { kind: 'tool', key: '3' }] })
    expect(tools(branches)).toEqual(['grandchild', 'parent', 'root'])
  })
  it('shows observed children with no tools without fabricating a tool row', () => {
    const branches = groupNativeActivity([], [{ key: '1', epoch: 1, firstSeenAt: '2026-09-07T00:00:00Z', ownership: { trajectoryId: 'a', parentTrajectoryId: 'r' } }])
    expect(branches).toMatchObject([{ kind: 'agent', trajectoryId: 'a', toolCount: 0, running: true, children: [] }])
    expect(tools(branches)).toEqual([])
  })
  it('adopts a known parent after an observation with missing parent metadata', () => {
    const branches = groupNativeActivity([
      row('parent', 'b', 'root'),
      row('child', 'a', 'b'),
    ], [{ key: '0', epoch: 1, firstSeenAt: '2026-09-07T00:00:00Z', ownership: { trajectoryId: 'a', depth: 2 } }])
    expect(branches).toHaveLength(1)
    expect(branches[0]).toMatchObject({ kind: 'agent', trajectoryId: 'b', toolCount: 2 })
    expect(tools(branches).sort()).toEqual(['child', 'parent'])
  })
  it('does not join reused native trajectory ids across runtime restarts', () => {
    const branches = groupNativeActivity([row('old', 'a', 'r', 1), row('new', 'a', 'r', 2)])
    expect(branches).toHaveLength(2)
    expect(branches[0]?.key).not.toBe(branches[1]?.key)
    expect(tools(branches)).toEqual(['old', 'new'])
  })
  it('retains every row exactly once when ancestry is cyclic or contradictory', () => {
    const branches = groupNativeActivity([row('a', 'a', 'b'), row('b', 'b', 'a'), row('c1', 'c', 'a'), row('c2', 'c', 'b')])
    expect(tools(branches).sort()).toEqual(['a', 'b', 'c1', 'c2'])
    expect(branches.some(branch => branch.kind === 'agent' && branch.trajectoryId === 'c')).toBe(true)
  })

  it('nests child-owned text inside the matching trajectory panel', () => {
    const branches = groupNativeActivity([row('a1', 'a', 'r')], [{ key: '1', epoch: 1, firstSeenAt: '2026-09-07T00:00:00Z', ownership: { trajectoryId: 'a', parentTrajectoryId: 'r' } }], [
      { key: '2', epoch: 1, firstSeenAt: '2026-09-07T00:00:01Z', trajectoryId: 'a', parentTrajectoryId: 'r', kind: 'text', text: 'child says hi' },
    ])
    const agent = branches.find(branch => branch.kind === 'agent' && branch.trajectoryId === 'a')
    expect(agent?.kind === 'agent' ? agent.children.map(child => child.kind) : []).toEqual(['tool', 'text'])
    expect(agent?.kind === 'agent' ? agent.children.find(child => child.kind === 'text') : undefined).toMatchObject({ text: 'child says hi' })
  })

  it('marks a child agent running while a descendant tool is pending', () => {
    const live = row('a1', 'a', 'r')
    const branches = groupNativeActivity([row('done', 'b', 'r'), { ...live, state: { ...live.state, status: 'running' } }])
    const agents = branches.filter(branch => branch.kind === 'agent')
    expect(agents.find(branch => branch.kind === 'agent' && branch.trajectoryId === 'a')).toMatchObject({ running: true })
    expect(agents.find(branch => branch.kind === 'agent' && branch.trajectoryId === 'b')).toMatchObject({ running: false })
  })
})
