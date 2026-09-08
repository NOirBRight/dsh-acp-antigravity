/** Display native child trajectories using the shared DSH disclosure chrome. */
import React, { useState, type ReactNode } from 'react'
import { DisclosureRow, IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AcpSettingsKey } from './locales.js'
import type { NativeActivityBranch, NativeAgentBranch } from './native-tree.js'
import { AntigravityToolNode } from './AntigravityToolNode.js'

interface Labels {
  t: (key: AcpSettingsKey) => string
  conversationT: TranslateNS<'conversation'>
}

function NativeSubagentNode({ branch, ...labels }: { branch: NativeAgentBranch } & Labels): ReactNode {
  const [open, setOpen] = useState(false)
  return <section data-native-subagent={branch.key} data-native-trajectory={branch.trajectoryId}>
    <DisclosureRow icon={<IconAgentPresetOutline16 size={14} />}
      title={`${labels.t('activitySubagent')} · ${branch.trajectoryId.slice(0, 8)}`}
      open={open} expandable expandOnRowClick keepContentWhenOpen onToggle={() => { setOpen(value => !value) }}
      collapsedContent={<span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{labels.t('activityTools').replace('{count}', String(branch.toolCount))}</span>}>
      <div style={{ paddingInlineStart: 16, borderInlineStart: '1px solid var(--dsw-alias-border-l2)' }}>
        {branch.children.map(child => <NativeActivityNode key={child.key} branch={child} {...labels} />)}
        <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{labels.t('activityChildUnknown')}</span>
      </div>
    </DisclosureRow>
  </section>
}

/** Render one native tool or child group; children are never repeated as root rows.
 * @param props - Grouped activity and the separate native/conversation locale seats.
 * @returns A canonical tool card or a initially collapsed child trajectory.
 */
export function NativeActivityNode({ branch, ...labels }: { branch: NativeActivityBranch } & Labels): ReactNode {
  switch (branch.kind) {
    case 'tool': return <div title={branch.row.state.name} data-native-tool-id={branch.row.state.toolId} data-native-trajectory={branch.row.state.ownership?.trajectoryId}>
      <AntigravityToolNode row={branch.row} t={labels.conversationT} />
    </div>
    case 'agent': return <NativeSubagentNode branch={branch} {...labels} />
  }
  const unreachable: never = branch
  return unreachable
}
