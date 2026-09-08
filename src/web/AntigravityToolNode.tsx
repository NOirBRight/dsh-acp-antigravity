/** One folded native sidecar row through the canonical DSH tool card.
 *
 * Pure renderer: no Core, no Chat, no durable DSH tool event. The folded row is
 * adapted to presentation-only GenericToolCard props (see native-tool-card);
 * host callbacks stay omitted, so sidecar paths render as plain text, no file
 * is ever opened, no Inspect pill appears, and nothing here dispatches or
 * executes a tool. The t prop is the conversation locale seat injected by the
 * parent container — never the Antigravity settings copy.
 */
import type { JSX } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { GenericToolCard } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AntigravityToolRowData } from './native-activity.js'
import { nativeToolBlock } from './native-tool-card.js'

/** One folded tool row as the exact native DSH card. */
export function AntigravityToolNode({ row, t }: {
  readonly row: AntigravityToolRowData
  readonly t: TranslateNS<'conversation'>
}): JSX.Element {
  const parsed = Date.parse(row.firstSeenAt)
  const { toolName, callId, block } = nativeToolBlock(row.state, Number.isFinite(parsed) ? parsed : 0)
  return <GenericToolCard callId={callId} toolName={toolName} block={block} t={t} />
}
