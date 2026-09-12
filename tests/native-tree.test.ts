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
  return branches.flatMap(branch => branch.kind === 'tool' ? [branch.row.state.toolId] : [])
}

describe('native activity flattening', () => {
  it('keeps unknown and root tools flat; never infers a child from a launch title', () => {
    const legacy = row('launch')
    const branches = groupNativeActivity([legacy, row('root', 'root')])
    expect(branches.map(branch => branch.kind)).toEqual(['tool', 'tool'])
    expect(tools(branches)).toEqual(['launch', 'root'])
  })
  it('keeps concurrent child tools flat even when ownership names a parent', () => {
    const branches = groupNativeActivity([row('root', 'r'), row('a1', 'a', 'r'), row('b1', 'b', 'r'), row('a2', 'a', 'r')])
    expect(branches.every(branch => branch.kind === 'tool')).toBe(true)
    expect(tools(branches)).toEqual(['root', 'a1', 'b1', 'a2'])
  })
  it('ignores agent observations that carry no tools', () => {
    const branches = groupNativeActivity([], [{ key: '1', epoch: 1, firstSeenAt: '2026-09-07T00:00:00Z', ownership: { trajectoryId: 'a', parentTrajectoryId: 'r' } }])
    expect(branches).toEqual([])
  })
  it('does not join reused native trajectory ids across runtime restarts', () => {
    const branches = groupNativeActivity([row('old', 'a', 'r', 1), row('new', 'a', 'r', 2)])
    expect(branches).toHaveLength(2)
    expect(tools(branches)).toEqual(['old', 'new'])
  })
  it('keeps child-owned text as a sibling of tools', () => {
    const branches = groupNativeActivity([row('a1', 'a', 'r')], [], [
      { key: '2', epoch: 1, firstSeenAt: '2026-09-07T00:00:01Z', trajectoryId: 'a', parentTrajectoryId: 'r', kind: 'text', text: 'child says hi' },
    ])
    expect(branches.map(branch => branch.kind)).toEqual(['tool', 'text'])
    expect(branches.find(branch => branch.kind === 'text')).toMatchObject({ text: 'child says hi' })
  })
})
