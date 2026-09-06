/** Standalone native activity sidecar view: one session history over RPC, never Core events. */
import { createElement, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ANTIGRAVITY_SESSION_READY, ANTIGRAVITY_TOOL_START, foldAntigravityToolEvent } from '../tool-events.js'
import type { AntigravityActivityHistory, AntigravityActivityRecord } from '../activity-contract.js'
import { AntigravityToolNode, type AntigravityToolRowData } from './AntigravityToolNode.tsx'
import type { AcpSettingsKey } from './locales.ts'

/** Fold history records into display rows, oldest first. Native tool ids can repeat across startups: the (epoch, tool id) pair only routes updates, while every new row keys on its record seq, so ids containing newlines can never collide.
 * @param records - Decoded history records in seq order.
 * @returns Display rows, oldest first, keyed by record seq.
 */
export function foldActivityRecords(records: readonly AntigravityActivityRecord[]): readonly AntigravityToolRowData[] {
  const rows: { key: string; state: AntigravityToolRowData['state']; time: string }[] = []
  const indexById = new Map<string, number>()
  let epoch = 0
  for (const record of records) {
    if (record.type === ANTIGRAVITY_SESSION_READY) {
      epoch += 1
      continue
    }
    const id = String(epoch) + '\n' + record.data.toolId
    if (record.type === ANTIGRAVITY_TOOL_START) {
      indexById.set(id, rows.length)
      rows.push({ key: String(record.seq), state: record.data, time: record.time })
      continue
    }
    const index = indexById.get(id)
    if (index === undefined) {
      indexById.set(id, rows.length)
      rows.push({ key: String(record.seq), state: foldAntigravityToolEvent(undefined, { type: record.type, data: record.data }), time: record.time })
      continue
    }
    const current = rows[index]
    if (current === undefined) continue
    current.state = foldAntigravityToolEvent(current.state, { type: record.type, data: record.data })
    current.time = record.time
  }
  return rows
}

/** Business face for the sidecar view: session-scoped history read plus copy. */
export interface AntigravityActivityFace {
  t: (key: AcpSettingsKey) => string
  read: (signal?: AbortSignal) => Promise<AntigravityActivityHistory>
}

export type AntigravityActivityViewProps = PropsRuntime<'conversation.view'> & InjectFace<AntigravityActivityFace>

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', minWidth: 0 }
const toolbar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const button: CSSProperties = { minHeight: 36, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, padding: '7px 10px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', cursor: 'pointer' }
const muted: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' }
const localCss = '@media(max-width:680px){[data-antigravity-activity] button{min-height:44px}}'

/** Sidecar tab: initial load plus manual refresh; local failure stays inside the tab. */
export function AntigravityActivityView({ t, read }: AntigravityActivityViewProps): JSX.Element {
  const [rows, setRows] = useState<readonly AntigravityToolRowData[]>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const epoch = useRef(0)
  const pending = useRef<AbortController>()
  const mounted = useRef(false)
  const fail = (caught: unknown): void => { if (mounted.current) setError(caught instanceof Error ? caught.message : t('activityFailed')) }
  const refresh = async (): Promise<void> => {
    const current = ++epoch.current
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    try {
      const next = await read(controller.signal)
      if (!mounted.current || current !== epoch.current) return
      setRows(foldActivityRecords(next.records))
      setError(undefined)
    } catch (caught) {
      if (!mounted.current || current !== epoch.current || controller.signal.aborted) return
      fail(caught)
    } finally {
      if (mounted.current && current === epoch.current) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    setRows(undefined)
    setError(undefined)
    void refresh().catch(fail)
    return () => { mounted.current = false; epoch.current++; pending.current?.abort() }
  }, [read])
  const body = rows === undefined
    ? (!error && createElement('p', { role: 'status', style: muted }, t('activityLoading')))
    : rows.length === 0
      ? createElement('p', { style: muted }, t('activityEmpty'))
      : rows.map(row => createElement(AntigravityToolNode, { key: row.key, row, noOutput: t('activityNoOutput') }))
  return createElement('section', { 'data-antigravity-activity': true, 'aria-label': t('activityView'), style: wrap },
    createElement('style', null, localCss),
    createElement('div', { style: toolbar },
      createElement('button', { type: 'button', style: button, disabled: loading, onClick: () => void refresh().catch(fail) }, loading ? t('activityLoading') : t('activityRefresh'))),
    error && createElement('p', { role: 'alert', style: { ...muted, color: 'var(--dsw-alias-state-error-primary)' } }, error),
    body)
}
