/* One folded native sidecar row through the plugin-owned read-only card.
 *
 * Pure renderer: no Core, no Chat, no durable DSH tool event. The folded row is
 * adapted to a presentation-only block (see native-tool-card) and rendered by
 * AntigravityReadonlyCard, which exposes no host callbacks: sidecar paths stay
 * plain text, no file is ever opened, no Inspect affordance exists, and nothing
 * here dispatches or executes a tool. The t prop is the plugin settings copy,
 * which owns the card labels; the conversation locale seat is not needed.
 */
import type { JSX } from 'react'
import type { AcpSettingsKey } from './locales.js'
import type { AntigravityToolRowData } from './native-activity.js'
import { AntigravityReadonlyCard } from './AntigravityReadonlyCard.js'
import { nativeToolBlock } from './native-tool-card.js'

/* One folded tool row as the plugin-owned read-only card. */
export function AntigravityToolNode({ row, t }: {
  readonly row: AntigravityToolRowData
  readonly t: (key: AcpSettingsKey) => string
}): JSX.Element {
  const parsed = Date.parse(row.firstSeenAt)
  const { toolName, nativeName, callId, block } = nativeToolBlock(row.state, Number.isFinite(parsed) ? parsed : 0)
  return <AntigravityReadonlyCard callId={callId} toolName={toolName} nativeName={nativeName} block={block} t={t} />
}
