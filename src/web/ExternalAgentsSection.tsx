/** Antigravity provider settings: state-driven Install, Sign in, then Account/Quota/Model. Runtime paths stay in backend config only. */
import React, { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ProviderCardHeader, ProviderQuotaMeter, providerUiCss } from 'dsh-llm-providers-ui/provider-ui'
import { dropPersistedUsageKeys, headerQuotaFromCache, peekCachedUsage, rememberHeadlineQuota } from 'dsh-llm-providers-ui/usage-readers'
import type { AcpSettingsRow, AcpSettingsSnapshot, AntigravityQuotaSnapshot } from '../client-contract.ts'
import type { AcpSettingsKey } from './locales.ts'
import { BrandMark } from './BrandMark.tsx'
import type {} from 'dsh-llm-providers-ui/client'
import { mergeSettingsDraft, shouldClearQuota, resolveAntigravityCardState, type AntigravityCardState } from './settings-state.ts'

/** Live Settings operations injected by the client plugin. Paths stay in the row for save only. */
export interface AcpSettingsFace {
  t: (key: AcpSettingsKey) => string
  load: () => Promise<AcpSettingsSnapshot>
  save: (row: AcpSettingsRow) => Promise<void>
  run: (action: string, value?: unknown) => Promise<unknown>
  pick: () => Promise<string | null>
  quota: (signal?: AbortSignal) => Promise<AntigravityQuotaSnapshot>
}
/** Runtime props for the provider card slot. */
export type ExternalAgentsSectionProps = PropsRuntime<'settings.provider.item'> & InjectFace<AcpSettingsFace>
/** Pure state-driven card body: sections order follows missing, login, connected. */
export interface AntigravityCardBodyProps {
  readonly t: (key: AcpSettingsKey) => string
  readonly row: AcpSettingsRow
  readonly snapshot: AcpSettingsSnapshot
  readonly state: AntigravityCardState
  readonly quota?: AntigravityQuotaSnapshot
  readonly quotaError?: string
  readonly quotaLoading: boolean
  readonly working: boolean
  readonly polling: boolean
  readonly saving: boolean
  readonly dirty: boolean
  readonly onToggleEnabled: () => void
  readonly onAction: (name: string) => void
  readonly onRefresh: () => void
  readonly onRefreshQuota: () => void
  readonly onModelChange: (model: string | undefined) => void
  readonly onPersist: () => void
  readonly onDiscard: () => void
}
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, minWidth: 0 }
const control: CSSProperties = { width: '100%', minWidth: 0, minHeight: 36, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, padding: '7px 10px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)' }
const button: CSSProperties = { ...control, width: 'auto', cursor: 'pointer' }
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }
const section: CSSProperties = { padding: '18px 0', borderTop: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }
const muted: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' }
const localCss = '[data-provider-body][hidden]{display:none!important}[data-antigravity-quota]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px}[data-antigravity-heading]{font-size:13px;font-weight:600;margin:0}@media(max-width:680px){[data-antigravity-quota]{grid-template-columns:1fr}[data-provider-card="antigravity"] button,[data-provider-card="antigravity"] select,[data-provider-card="antigravity"] input:not([type=checkbox]){min-height:44px}}'

/** Render Install at top when missing, Sign in at top when installed, Account/Quota/Model when connected.
 * @param props the live row, snapshot, quota, and state callbacks.
 * @returns the ordered card sections without runtime path internals.
 */
export function AntigravityCardBody({ t, row, snapshot, state, quota, quotaError, quotaLoading, working, polling, saving, dirty, onToggleEnabled, onAction, onRefresh, onRefreshQuota, onModelChange, onPersist, onDiscard }: AntigravityCardBodyProps): JSX.Element {
  const phase = snapshot.install?.phase
  const installActive = phase === 'downloading' || phase === 'extracting' || phase === 'verifying'
  const showInstall = state === 'missing' || installActive || phase === 'failed'
  return <>
    {showInstall && <section style={section}>
      <h3 data-antigravity-heading>{t('install')}</h3>
      <p style={muted}>{row.message ?? t('missingBadge')}</p>
      {snapshot.install && phase !== 'idle' && <p role="status" style={muted}>{snapshot.install.message}{snapshot.install.totalBytes > 0 && polling ? ' ' + Math.round(100 * snapshot.install.downloadedBytes / snapshot.install.totalBytes) + '%' : ''}</p>}
      <div style={actions}>
        <button type="button" style={button} disabled={working || polling} onClick={() => onAction('install-runtime')}>{polling ? t('installing') : t('install')}</button>
        <button type="button" style={button} disabled={working || polling} onClick={onRefresh}>{t('rescan')}</button>
      </div>
    </section>}
    <section style={section}>
      <h3 data-antigravity-heading>{t('account')}</h3>
      <label style={actions}><input type="checkbox" disabled={saving || working} checked={row.enabled} onChange={onToggleEnabled} />{t('enableProvider')}</label>
      <p style={muted}>{[row.version, row.message].filter(Boolean).join(' · ')}</p>
      <div style={actions}>
        {state !== 'missing' && <button type="button" style={button} disabled={working || polling} onClick={() => onAction(row.authenticated ? 'sign-out' : 'sign-in')}>{snapshot.signingIn ? t('signingIn') : row.authenticated ? t('signOut') : t('signIn')}</button>}
        {state !== 'missing' && row.authorizationUrl && <button type="button" style={button} disabled={working} onClick={() => onAction('open-login')}>{t('openLogin')}</button>}
        {!showInstall && <button type="button" style={button} disabled={working || polling} onClick={onRefresh}>{t('rescan')}</button>}
      </div>
    </section>
    {state === 'connected' && <section style={section}>
      <div style={{ ...actions, justifyContent: 'space-between' }}><h3 data-antigravity-heading>{t('quota')}</h3><button type="button" style={button} disabled={!row.authenticated || quotaLoading || working} onClick={onRefreshQuota}>{quotaLoading ? t('loading') : t('refreshQuota')}</button></div>
      {quotaError && <p role="status" style={muted}>{quotaError}{quota ? ' · ' + t('staleQuota') : ''}</p>}
      {!quota && !quotaError && <p style={muted}>{t('quotaUnavailable')}</p>}
      {quota?.groups.map((group, gi) => <div key={gi}><h3 data-antigravity-heading>{group.displayName ?? t('quota')}</h3><div data-antigravity-quota>{group.buckets.map((bucket, bi) => <div key={bucket.bucketId ?? bi}>
        <ProviderQuotaMeter label={bucket.displayName ?? bucket.window ?? t('quota')} {...(bucket.disabled || bucket.remainingFraction === undefined ? {} : { remainingFraction: bucket.remainingFraction })} emptyLabel={bucket.disabled ? t('disabledBadge') : t('quotaUnavailable')} {...(bucket.resetTime ? { detail: t('resetsAt') + ' ' + new Date(bucket.resetTime).toLocaleString() } : {})} />
      </div>)}</div></div>)}
      {quota && <p style={muted}>{t('updatedAt')} {new Date(quota.observedAt).toLocaleString()}</p>}
    </section>}
    {state === 'connected' && <section style={section}>
      <div style={{ ...actions, justifyContent: 'space-between' }}><h3 data-antigravity-heading>{t('model')}</h3><button type="button" style={button} disabled={!row.authenticated || working} onClick={() => onAction('refresh-models')}>{t('refreshModels')}</button></div>
      <label style={field}>{t('defaultModel')}<select style={control} value={row.model ?? ''} disabled={saving} onChange={event => onModelChange(event.target.value === '' ? undefined : event.target.value)}><option value="">{t('accountDefault')}</option>{row.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      <p style={muted}>{t('nativeModels')}</p>
    </section>}
    <footer style={{ ...section, ...actions, justifyContent: 'flex-end' }}>
      {dirty && <span style={{ ...muted, marginRight: 'auto' }}>{t('unsaved')}</span>}
      <button type="button" style={button} disabled={!dirty || saving} onClick={onDiscard}>{t('cancel')}</button>
      <button type="button" style={button} disabled={!dirty || saving || working} onClick={onPersist}>{saving ? t('saving') : t('save')}</button>
    </footer>
  </>
}

/** Provider card container: live snapshot, quota, install/sign-in actions, and shared header.
 * @param props the injected Settings face.
 * @returns the collapsible Antigravity provider card.
 */
export function ExternalAgentsSection({ t, load, save, run, quota: readQuota }: ExternalAgentsSectionProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<AcpSettingsSnapshot>()
  const [draft, setDraft] = useState<AcpSettingsRow>()
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const snapshotRef = useRef<AcpSettingsSnapshot>()
  const [saving, setSaving] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const [quota, setQuota] = useState<AntigravityQuotaSnapshot>()
  const [quotaError, setQuotaError] = useState<string>()
  const [quotaLoading, setQuotaLoading] = useState(false)
  const epoch = useRef(0)
  const quotaEpoch = useRef(0)
  const quotaAbort = useRef<AbortController>()
  const mounted = useRef(false)
  const fail = (caught: unknown): void => { if (mounted.current) setError(caught instanceof Error ? caught.message : t('failed')) }
  const clearQuota = (): void => { dropPersistedUsageKeys(['antigravity']); quotaEpoch.current++; quotaAbort.current?.abort(); setQuota(undefined); setQuotaError(undefined); setQuotaLoading(false) }
  const accept = (next: AcpSettingsSnapshot): void => {
    const previous = snapshotRef.current?.rows[0], incoming = next.rows[0]
    if (shouldClearQuota(previous, incoming)) clearQuota()
    snapshotRef.current = next
    setSnapshot(next)
    setDraft(current => mergeSettingsDraft(current, incoming, dirtyRef.current))
  }
  const fetchQuota = async (): Promise<void> => {
    quotaAbort.current?.abort()
    const controller = new AbortController(), request = ++quotaEpoch.current
    quotaAbort.current = controller
    setQuotaLoading(true)
    try {
      const next = await readQuota(controller.signal)
      if (!mounted.current || request !== quotaEpoch.current) return
      if (next.status === 'ready') {
        setQuota(next); setQuotaError(undefined)
        const hit = next.groups.flatMap(group => group.buckets.map(bucket => ({ group: group.displayName, bucket }))).find(item => !item.bucket.disabled && item.bucket.remainingFraction !== undefined)
        if (hit?.bucket.remainingFraction !== undefined) rememberHeadlineQuota('antigravity', 'Antigravity', {
          label: [hit.group, hit.bucket.window ?? hit.bucket.displayName].filter(Boolean).join(' · '),
          remainingPercent: Math.round(hit.bucket.remainingFraction * 1000) / 10,
        })
      }
      else { if (next.status !== 'error') clearQuota(); setQuotaError(next.message ?? t('quotaUnavailable')) }
    } catch (caught) {
      if (mounted.current && request === quotaEpoch.current && !controller.signal.aborted) setQuotaError(caught instanceof Error ? caught.message : t('quotaUnavailable'))
    } finally { if (mounted.current && request === quotaEpoch.current) setQuotaLoading(false) }
  }
  const refresh = async (): Promise<void> => {
    const request = ++epoch.current
    let next = await load()
    if (!mounted.current || request !== epoch.current) return
    accept(next)
    if ((next.rows[0]?.executablePath ?? '').trim() === '') {
      try { await run('probe-installation'); next = await load() }
      catch { /* PATH probing is optional; keep the successful settings snapshot. */ }
      if (!mounted.current || request !== epoch.current) return
      accept(next)
    }
    if (next.rows[0]?.authenticated) await fetchQuota()
  }
  useEffect(() => {
    mounted.current = true
    void refresh().catch(fail)
    return () => { mounted.current = false; epoch.current++; quotaEpoch.current++; quotaAbort.current?.abort() }
  }, [load, readQuota])
  const phase = snapshot?.install?.phase
  const polling = snapshot?.signingIn === true || phase === 'downloading' || phase === 'extracting' || phase === 'verifying'
  useEffect(() => {
    if (!polling) return
    let stopped = false, pending = false
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      const request = epoch.current
      void load().then(next => { if (!stopped && request === epoch.current && mounted.current) accept(next) }).catch(fail).finally(() => { pending = false })
    }, 500)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [polling, load])
  useEffect(() => { if (snapshot?.rows[0]?.authenticated) void fetchQuota() }, [snapshot?.rows[0]?.authenticated])
  const change = (row: AcpSettingsRow): void => { dirtyRef.current = true; setDirty(true); setDraft(row) }
  const action = async (name: string): Promise<void> => {
    if (working) return
    setWorking(true); setError(undefined)
    epoch.current++
    if (name === 'sign-in' || name === 'sign-out') clearQuota()
    try { await run(name); await refresh() } catch (caught) { fail(caught) }
    finally { if (mounted.current) setWorking(false) }
  }
  const persist = async (): Promise<void> => {
    if (!draft || saving) return
    setSaving(true); setError(undefined)
    try { await save(draft); dirtyRef.current = false; setDirty(false); await refresh() } catch (caught) { fail(caught) }
    finally { if (mounted.current) setSaving(false) }
  }
  const row = draft
  const state = resolveAntigravityCardState(row)
  const status = row === undefined ? t('loading') : !row.enabled ? t('disabledBadge') : state === 'missing' ? t('missingBadge') : state === 'login' ? t('authBadge') : t('connected')
  const first = quota?.groups.flatMap(group => group.buckets.map(bucket => ({ group: group.displayName, bucket }))).find(item => !item.bucket.disabled && item.bucket.remainingFraction !== undefined)
  const liveQuota = first === undefined ? undefined : { remainingPercent: Math.round(first.bucket.remainingFraction! * 1000) / 10, label: [first.group, first.bucket.window ?? first.bucket.displayName].filter(Boolean).join(' · '), ...(quotaError === undefined ? {} : { detail: t('staleQuota') }) }
  const headerQuota = snapshot !== undefined && !snapshot.rows[0]?.authenticated ? undefined : liveQuota ?? headerQuotaFromCache(peekCachedUsage('antigravity'))
  return <section data-provider-card="antigravity" data-provider-role="agent">
    <style>{providerUiCss + localCss}</style>
    <button type="button" data-provider-card-header aria-expanded={open} onClick={() => setOpen(!open)}>
      <ProviderCardHeader title="Antigravity" mark={<BrandMark />} role="agent" summary={row === undefined ? '' : t('modelCount').replace('{count}', String(row.models.length))} status={status} open={open} unsaved={dirty} unsavedLabel={t('unsaved')} {...(headerQuota === undefined ? {} : { quota: headerQuota })} />
    </button>
    <div data-provider-body hidden={!open}>
      {error && <p role="alert" style={{ ...muted, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</p>}
      {row && snapshot ? <AntigravityCardBody t={t} row={row} snapshot={snapshot} state={state} {...(quota === undefined ? {} : { quota })} {...(quotaError === undefined ? {} : { quotaError })} quotaLoading={quotaLoading} working={working} polling={polling} saving={saving} dirty={dirty}
        onToggleEnabled={() => change({ ...row, enabled: !row.enabled })}
        onAction={name => void action(name)}
        onRefresh={() => void refresh().catch(fail)}
        onRefreshQuota={() => void fetchQuota()}
        onModelChange={model => { const next = { ...row }; if (model === undefined) delete next.model; else next.model = model; change(next) }}
        onPersist={() => void persist()}
        onDiscard={() => { dirtyRef.current = false; setDirty(false); setDraft(snapshot.rows[0]) }} />
        : <p role="status" style={muted}>{t('loading')}</p>}
    </div>
  </section>
}
