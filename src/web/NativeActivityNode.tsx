/** Display native tools using the plugin-owned read-only card. */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AcpSettingsKey } from './locales.js'
import type { NativeActivityBranch } from './native-tree.js'
import { AntigravityToolNode } from './AntigravityToolNode.js'

interface Labels {
  t: (key: AcpSettingsKey) => string
  conversationT: TranslateNS<'conversation'>
}

/** Render one native tool or text row.
 * @param props - Flat activity and the separate native/conversation locale seats.
 * @returns A canonical tool card or native text.
 */
export function NativeActivityNode({ branch, ...labels }: { branch: NativeActivityBranch } & Labels): ReactNode {
  switch (branch.kind) {
    case 'tool': return <div title={branch.row.state.name} data-native-tool-id={branch.row.state.toolId} data-native-trajectory={branch.row.state.ownership?.trajectoryId}>
      <AntigravityToolNode row={branch.row} t={labels.t} />
    </div>
    case 'text': return <div data-native-agent-text={branch.key} style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: branch.thought ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)' }}>{branch.text}</div>
  }
  const unreachable: never = branch
  return unreachable
}
