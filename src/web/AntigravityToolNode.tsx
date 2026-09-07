/** Disclosure row for one folded Antigravity native tool. Pure renderer: no Core, no Chat.
 *
 * Read-only by construction: file targets render as plain text, only http(s)
 * links anchor out, and nothing here dispatches or executes a tool. The name
 * renders exactly as the native runtime recorded it; row time is the sidecar
 * wall clock, never a decode rate.
 */
import type { CSSProperties, JSX, ReactNode } from 'react'
import React from 'react'
import type { AntigravityToolStatus } from '../tool-events.js'
import type { AntigravityToolRowData } from './native-activity.js'
import type { AcpSettingsKey } from './locales.ts'

// Recorded native spawn title. A completed launch is the launch outcome,
// never the child outcome; the child lifecycle has no sidecar event.
const SPAWN_TITLE = 'Running start subagent'

const statusKey: Record<AntigravityToolStatus, AcpSettingsKey> = {
  pending: 'statusPending',
  running: 'statusRunning',
  completed: 'statusCompleted',
  failed: 'statusFailed',
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

const commandStyle: CSSProperties = {
  ...preStyle,
  maxHeight: 120,
  color: 'var(--dsw-alias-label-secondary)',
}

/** One folded tool row; detail disclosure needs no state. */
export function AntigravityToolNode({ row, t }: {
  readonly row: AntigravityToolRowData
  readonly t: (key: AcpSettingsKey) => string
}): JSX.Element {
  const { state } = row
  const status = t(statusKey[state.status])
  const label = state.name + ', ' + status
  const detail = state.error ?? state.output
  const terminal = state.status === 'completed' || state.status === 'failed'
  const child: ReactNode = state.name === SPAWN_TITLE
    ? <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('activityChildUnknown')}</span>
    : null
  const link: ReactNode = state.location === undefined ? null : state.location.kind === 'url' && /^https?:\/\//u.test(state.location.target)
    ? <a style={{ color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }} href={state.location.target} target="_blank" rel="noreferrer">{state.location.target}</a>
    : <span style={{ color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' }}>{state.location.target}</span>
  if (state.input === undefined && link === null && child === null && detail === undefined && !terminal) {
    return <section style={rowStyle} aria-label={label} data-status={state.status}>
      <div style={{ ...summaryStyle, cursor: 'default' }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', ...dotStyle[state.status] }} />
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.name}</span>
        <span style={{ color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{status}</span>
        <time dateTime={row.time} style={{ color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' }}>{new Date(row.time).toLocaleString()}</time>
      </div>
    </section>
  }
  return <section style={rowStyle} data-status={state.status}>
    <details style={{ margin: 0 }}>
      <summary style={summaryStyle} aria-label={label}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', ...dotStyle[state.status] }} />
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.name}</span>
        <span style={{ color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{status}</span>
        <time dateTime={row.time} style={{ color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' }}>{new Date(row.time).toLocaleString()}</time>
      </summary>
      <div style={bodyStyle}>
        {state.input === undefined ? null : <pre style={commandStyle}>{state.input}</pre>}
        {link}
        {child}
        {detail === undefined
          ? (terminal ? <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('activityNoOutput')}</span> : null)
          : <pre style={{ ...preStyle, color: state.error === undefined ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-state-error-primary)' }}>{detail}</pre>}
      </div>
    </details>
  </section>
}
