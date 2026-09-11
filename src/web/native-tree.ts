/** Native activity grouping. Stock ACP has no trajectory ownership; tools stay flat. */
import type { AntigravityAgentData, AntigravityAgentTextRow, AntigravityToolRowData } from './native-activity.js'

export type NativeActivityBranch =
  | { kind: 'tool'; key: string; row: AntigravityToolRowData; order: number }
  | { kind: 'text'; key: string; text: string; thought: boolean; order: number; firstSeenAt: string }

/** Flatten native tools and text in first-seen order. Ownership is ignored.
 * @param rows - Folded native activity in first-seen order.
 * @param _observations - Unused; stock ACP does not disclose child agents.
 * @param texts - Child-owned text kept off the assistant stream.
 * @returns Ordered root tools and text, never nested.
 */
export function groupNativeActivity(rows: readonly AntigravityToolRowData[], _observations: readonly AntigravityAgentData[] = [], texts: readonly AntigravityAgentTextRow[] = []): NativeActivityBranch[] {
  const roots: NativeActivityBranch[] = []
  for (const row of rows) roots.push({ kind: 'tool', key: row.key, row, order: Number(row.key) })
  for (const text of texts) {
    roots.push({ kind: 'text', key: text.key, text: text.text, thought: text.kind === 'thought', order: Number(text.key), firstSeenAt: text.firstSeenAt })
  }
  return roots.sort((a, b) => a.order - b.order)
}
