/** Disclosure row for one folded Antigravity native tool. Pure renderer: no Core, no Chat. */
import { createElement, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { AntigravityToolState, AntigravityToolStatus } from '../tool-events.js'

/** One folded sidecar row: unique key, display state, and last-event time. */
export interface AntigravityToolRowData {
  readonly key: string
  readonly state: AntigravityToolState
  readonly time: string
}

const rowStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: '20px',
  overflow: 'hidden',
}

const summaryStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', width: '100%', minHeight: 44,
  cursor: 'pointer', padding: '8px 10px', gap: 8, boxSizing: 'border-box',
}

const dotStyle: Record<AntigravityToolStatus, CSSProperties> = {
  pending: { background: 'var(--dsw-alias-label-tertiary)' },
  running: { background: 'var(--dsw-alias-state-warn-primary)' },
  completed: { background: 'var(--dsw-alias-state-success-primary)' },
  failed: { background: 'var(--dsw-alias-state-error-primary)' },
}

const bodyStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  padding: '8px 12px 12px 26px',
  display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
}

const preStyle: CSSProperties = {
  maxHeight: 240, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
}

/** One folded tool row; detail disclosure needs no state. */
export function AntigravityToolNode({ row, noOutput }: { readonly row: AntigravityToolRowData; readonly noOutput: string }): JSX.Element {
  const { state } = row
  const label = state.name + ', ' + state.status
  const summary = [
    createElement('span', { key: 'dot', 'aria-hidden': true, style: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', ...dotStyle[state.status] } }),
    createElement('span', { key: 'name', style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, state.name),
    createElement('span', { key: 'status', style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto', whiteSpace: 'nowrap' } }, state.status),
    createElement('time', { key: 'time', dateTime: row.time, style: { color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, new Date(row.time).toLocaleString()),
  ]
  const detail = state.error ?? state.output
  const terminal = state.status === 'completed' || state.status === 'failed'
  const location = state.location
  const link: ReactNode = location === undefined ? null : location.kind === 'url' && /^https?:\/\//u.test(location.target)
    ? createElement('a', { style: { color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }, href: location.target, target: '_blank', rel: 'noreferrer' }, location.target)
    : createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' } }, location.target)
  if (link === null && detail === undefined && !terminal) {
    return createElement('section', { style: rowStyle, 'aria-label': label },
      createElement('div', { style: { ...summaryStyle, cursor: 'default' } }, summary))
  }
  return createElement('section', { style: rowStyle },
    createElement('details', { style: { margin: 0 } },
      createElement('summary', { style: summaryStyle, 'aria-label': label }, summary),
      createElement('div', { style: bodyStyle }, link, detail === undefined
        ? (terminal ? createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, noOutput) : null)
        : createElement('pre', { style: { ...preStyle, color: state.error === undefined ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-error-primary)' } }, detail))))
}
