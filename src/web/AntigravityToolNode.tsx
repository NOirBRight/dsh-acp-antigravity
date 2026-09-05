/** Conversation node renderer for Antigravity native tool activity. */

import { createElement, useState } from 'react'
import {
  foldAntigravityToolEvent,
  type AntigravityToolEvent,
  type AntigravityToolState,
  type AntigravityToolStatus,
} from '../tool-events.js'

type ToolEvent = AntigravityToolEvent & {
  readonly seq: number
  readonly location?: unknown
}

type ToolStartEvent = Extract<ToolEvent, { readonly type: 'antigravity/tool-start' }>

type ToolContext = {
  readonly key: string
  readonly id: string
  readonly state?: AntigravityToolState
  readonly start?: { readonly event: ToolEvent; readonly location?: unknown }
  readonly matches: readonly { readonly event: ToolEvent; readonly location?: unknown }[]
}

const rowStyle = {
  border: '1px solid var(--dsw-alias-border-secondary)',
  borderRadius: 8,
  background: 'var(--dsw-alias-background-secondary)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: '20px',
  overflow: 'hidden',
} as const

const triggerStyle = {
  display: 'flex', alignItems: 'center', width: '100%', minHeight: 36,
  border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
  padding: '8px 10px', textAlign: 'left', gap: 8,
} as const

const dotStyle: Record<AntigravityToolStatus, { background: string }> = {
  pending: { background: 'var(--dsw-alias-label-tertiary)' },
  running: { background: 'var(--dsw-alias-function)' },
  completed: { background: 'var(--dsw-alias-success)' },
  failed: { background: 'var(--dsw-alias-danger)' },
}

/** Folded row definition consumed by DSH's conversation node assembler. */
export const antigravityToolDefinition = {
  kind: 'antigravity-tool',
  target: 'chat',
  match: (event: ToolEvent) => event.type === 'antigravity/tool-start'
    ? { id: event.data.toolId, role: 'start' }
    : event.type === 'antigravity/tool-update'
      ? { id: event.data.toolId, role: 'update' }
      : null,
  start: (_context: ToolContext, match: { event: ToolStartEvent }): AntigravityToolState => match.event.data,
  update: (context: ToolContext, match: { event: ToolEvent }): AntigravityToolState => foldAntigravityToolEvent(context.state, match.event),
  publication: (match: { event: ToolEvent }) => match.event.type === 'antigravity/tool-update' ? 'immediate' : 'animation-frame',
  buildViewNode: (context: ToolContext) => context.state === undefined ? null : {
    key: context.key,
    kind: 'antigravity-tool',
    id: context.id,
    target: 'chat',
    anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: context.state,
  },
}

/** ToolRow-like disclosure for one folded native tool row. */
export function AntigravityToolNode({ node }: { readonly node: { readonly data: AntigravityToolState } }) {
  const [expanded, setExpanded] = useState(false)
  const { data } = node
  const detail = data.error ?? data.output
  const terminal = data.status === 'completed' || data.status === 'failed'
  const canExpand = detail !== undefined || terminal
  const renderedDetail = detail ?? (terminal ? 'No displayable output.' : undefined)
  const link = data.location === undefined ? null : createElement('a', {
    href: data.location.kind === 'url' ? data.location.target : 'file://' + data.location.target,
    onClick: event => { event.stopPropagation() },
    style: { color: 'var(--dsw-alias-label-link)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    target: data.location.kind === 'url' ? '_blank' : undefined,
    rel: data.location.kind === 'url' ? 'noreferrer' : undefined,
  }, data.location.target)
  return createElement('section', { style: rowStyle },
    createElement('button', {
      type: 'button', style: triggerStyle,
      onClick: canExpand ? () => { setExpanded(value => !value) } : undefined,
      'aria-expanded': canExpand ? expanded : undefined,
      'aria-label': data.name + ', ' + data.status,
    },
    createElement('span', { 'aria-hidden': true, style: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', ...dotStyle[data.status] } }),
    createElement('span', { style: { fontWeight: 500, whiteSpace: 'nowrap' } }, data.name),
    link === null ? null : createElement('span', { style: { minWidth: 0, flex: 1 } }, link),
    createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto', whiteSpace: 'nowrap' } }, data.status),
    createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, canExpand ? (expanded ? '⌃' : '⌄') : null),
    ),
    expanded && renderedDetail !== undefined
      ? createElement('pre', { style: {
        maxHeight: 240, overflow: 'auto', margin: 0, padding: '8px 12px 12px 28px',
        borderTop: '1px solid var(--dsw-alias-border-secondary)', background: 'var(--dsw-alias-background-tertiary)',
        color: data.error === undefined ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-danger)', whiteSpace: 'pre-wrap',
      } }, renderedDetail)
      : null,
  )
}
