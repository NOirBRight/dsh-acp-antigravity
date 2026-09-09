/** Display native child trajectories using the shared DSH disclosure chrome. */
import React, { useState, type ReactNode } from 'react'
import { DisclosureRow, IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AcpSettingsKey } from './locales.js'
import { activityBranchRunning, type NativeActivityBranch, type NativeAgentBranch } from './native-tree.js'
import { AntigravityToolNode } from './AntigravityToolNode.js'

interface Labels {
  t: (key: AcpSettingsKey) => string
  conversationT: TranslateNS<'conversation'>
}

const SWEEP = `@keyframes dsh-agy-subagent-sweep {
  0% { left: -300px; }
  90%, 100% { left: 100%; }
}
[data-native-subagent-panel][data-state="running"] [data-disclosure-row] {
  position: relative;
  overflow: hidden;
}
[data-native-subagent-panel][data-state="running"] [data-disclosure-row]::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 300px;
  background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
  animation: dsh-agy-subagent-sweep 2.6s ease-out infinite;
  pointer-events: none;
}`

function NativeSubagentNode({ branch, ...labels }: { branch: NativeAgentBranch } & Labels): ReactNode {
  const [open, setOpen] = useState(false)
  const shortId = branch.trajectoryId.replace(/-/g, '').slice(0, 8)
  const running = activityBranchRunning(branch)
  const status = running
    ? labels.t('activityRunning').replace('{count}', String(Math.max(branch.toolCount, 1)))
    : branch.toolCount === 0
      ? labels.t('activityChildEmpty')
      : labels.t('activityTools').replace('{count}', String(branch.toolCount))
  return <section data-native-subagent={branch.key} data-native-trajectory={branch.trajectoryId} data-native-subagent-panel="" data-state={running ? 'running' : undefined}>
    <style>{SWEEP}</style>
    <DisclosureRow icon={<IconAgentPresetOutline16 size={14} />}
      title={`${labels.t('activitySubagent')} ${shortId}`}
      open={open} expandable expandOnRowClick keepContentWhenOpen onToggle={() => { setOpen(value => !value) }}
      collapsedContent={<span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))' }}>{` · ${status}`}</span>}>
      <div style={{ paddingInlineStart: 16, borderInlineStart: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {branch.children.map(child => <NativeActivityNode key={child.key} branch={child} {...labels} />)}
        {branch.children.length === 0
          ? <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{labels.t('activityChildEmpty')}</span>
          : null}
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
    case 'text': return <div data-native-agent-text={branch.key} style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: branch.thought ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)' }}>{branch.text}</div>
    case 'agent': return <NativeSubagentNode branch={branch} {...labels} />
  }
  const unreachable: never = branch
  return unreachable
}
