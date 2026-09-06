/** Conversation node renderer for Antigravity native tool activity. */
import { createElement, useState } from 'react'
import type { ChatConversationViewNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationLocation,
  ConversationNodeDefinition,
  ConversationStartMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  foldAntigravityToolEvent,
  type AntigravityToolEvent,
  type AntigravityToolLocation,
  type AntigravityToolStartData,
  type AntigravityToolState,
  type AntigravityToolStatus,
  type AntigravityToolUpdateData,
} from '../tool-events.js'
import { isRecord } from '../decode.js'

/** Official Chat renderer payload seam: registers the antigravity-tool kind. */
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** One Antigravity native tool row folded from tool-start/update events. */
    'antigravity-tool': AntigravityToolState
  }
}

const rowStyle = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
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

const linkRowStyle = {
  padding: '0 10px 8px 26px',
} as const

const dotStyle: Record<AntigravityToolStatus, { background: string }> = {
  pending: { background: 'var(--dsw-alias-label-tertiary)' },
  running: { background: 'var(--dsw-alias-state-warn-primary)' },
  completed: { background: 'var(--dsw-alias-state-success-primary)' },
  failed: { background: 'var(--dsw-alias-state-error-primary)' },
}

/** Whether a wire value is one of the four row statuses. */
function isToolStatus(value: unknown): value is AntigravityToolStatus {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed'
}

/** Read a validated tool link, if the payload carries a usable one. */
function toolLocation(value: unknown): AntigravityToolLocation | undefined {
  if (!isRecord(value)) return undefined
  const target: unknown = value.target
  const kind: unknown = value.kind
  if (typeof target !== 'string' || target.length === 0) return undefined
  if (kind !== 'file' && kind !== 'url') return undefined
  if (kind === 'url') {
    let url: URL
    try { url = new URL(target) } catch { return undefined /* Malformed replayed tool destination. */ }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  }
  return { target, kind }
}

/** Read validated start data, or null when the payload is unrelated or malformed. */
function startData(data: unknown): AntigravityToolStartData | null {
  if (!isRecord(data)) return null
  const toolId: unknown = data.toolId
  const name: unknown = data.name
  if (typeof toolId !== 'string' || toolId.length === 0) return null
  if (typeof name !== 'string' || name.length === 0) return null
  if (!isToolStatus(data.status)) return null
  const location = toolLocation(data.location)
  return { toolId, name, status: data.status, ...(location === undefined ? {} : { location }) }
}

/** Read validated update data, or null when the payload is unrelated or malformed. */
function updateData(data: unknown): AntigravityToolUpdateData | null {
  if (!isRecord(data)) return null
  const toolId: unknown = data.toolId
  if (typeof toolId !== 'string' || toolId.length === 0) return null
  if (!isToolStatus(data.status)) return null
  const location = toolLocation(data.location)
  const output: unknown = data.output
  const error: unknown = data.error
  if (output !== undefined && typeof output !== 'string') return null
  if (error !== undefined && typeof error !== 'string') return null
  return {
    toolId,
    status: data.status,
    ...(location === undefined ? {} : { location }),
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
  }
}

/** Narrow one session event to a tool lifecycle event without throwing. */
function toToolEvent(event: { readonly type?: unknown; readonly data?: unknown }): AntigravityToolEvent | null {
  if (event.type === ANTIGRAVITY_TOOL_START) {
    const data = startData(event.data)
    return data === null ? null : { type: ANTIGRAVITY_TOOL_START, data }
  }
  if (event.type === ANTIGRAVITY_TOOL_UPDATE) {
    const data = updateData(event.data)
    return data === null ? null : { type: ANTIGRAVITY_TOOL_UPDATE, data }
  }
  return null
}

/** Read a finite event seq for anchoring, if the event carries one. */
function eventSeq(event: { readonly seq?: unknown } | undefined): number | undefined {
  return event !== undefined && typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : undefined
}

/** Read validated start state for one start match, failing loud on engine-mismatched data. */
function startState(match: ConversationStartMatch): AntigravityToolState {
  const parsed = toToolEvent(match.event)
  if (parsed === null || parsed.type !== ANTIGRAVITY_TOOL_START) throw new Error('Antigravity tool row starts without a tool-start event')
  return parsed.data
}

/** Folded row definition registered on the Chat conversation target. */
export const antigravityToolDefinition: ConversationNodeDefinition<AntigravityToolState> = {
  kind: 'antigravity-tool',
  target: 'chat',
  match: event => {
    const parsed = toToolEvent(event)
    if (parsed === null) return null
    return { id: parsed.data.toolId, role: parsed.type === ANTIGRAVITY_TOOL_START ? 'start' : 'update' }
  },
  start: (_context, match) => startState(match),
  update: (context, match) => {
    const parsed = toToolEvent(match.event)
    return parsed === null ? context.state : foldAntigravityToolEvent(context.state, parsed)
  },
  publication: match => match.event.type === ANTIGRAVITY_TOOL_UPDATE ? 'immediate' : 'animation-frame',
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined) return null
    const location: ConversationLocation = context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
    const node: ChatConversationViewNode = {
      key: context.key,
      kind: 'antigravity-tool',
      id: context.id,
      target: 'chat',
      anchorSeq: eventSeq(context.start?.event) ?? eventSeq(context.matches[0]?.event) ?? 0,
      location,
      visibility: 'visible',
      data: context.state,
    }
    return node
  },
}

/** ToolRow-like disclosure for one folded native tool row. */
export function AntigravityToolNode({ node }: ChatNodeViewProps<'antigravity-tool'>) {
  const [expanded, setExpanded] = useState(false)
  const { data } = node
  const location = toolLocation(data.location)
  const detail = data.error ?? data.output
  const terminal = data.status === 'completed' || data.status === 'failed'
  const canExpand = detail !== undefined || terminal
  const renderedDetail = detail ?? (terminal ? 'No displayable output.' : undefined)
  const link = location === undefined ? null : createElement('a', {
    href: location.kind === 'url' ? location.target : 'file://' + location.target,
    style: { color: 'var(--dsw-alias-label-primary)', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    target: location.kind === 'url' ? '_blank' : undefined,
    rel: location.kind === 'url' ? 'noreferrer' : undefined,
  }, location.target)
  return createElement('section', { style: rowStyle },
    createElement('button', {
      type: 'button', style: triggerStyle,
      onClick: canExpand ? () => { setExpanded(value => !value) } : undefined,
      'aria-expanded': canExpand ? expanded : undefined,
      'aria-label': data.name + ', ' + data.status,
    },
    createElement('span', { 'aria-hidden': true, style: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', ...dotStyle[data.status] } }),
    createElement('span', { style: { fontWeight: 500, whiteSpace: 'nowrap' } }, data.name),
    createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto', whiteSpace: 'nowrap' } }, data.status),
    createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, canExpand ? (expanded ? '⌃' : '⌄') : null),
    ),
    link === null ? null : createElement('div', { style: linkRowStyle }, link),
    expanded && renderedDetail !== undefined
      ? createElement('pre', { style: {
        maxHeight: 240, overflow: 'auto', margin: 0, padding: '8px 12px 12px 28px',
        borderTop: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
        color: data.error === undefined ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap',
      } }, renderedDetail)
      : null,
  )
}
