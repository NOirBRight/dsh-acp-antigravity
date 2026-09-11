/** Antigravity provider settings: state-driven Install, Sign in, then Account/Quota/Model. Runtime paths stay in backend config only. */
import React, { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ModelCatalogEditor, ModelPickerDialog, applyCatalogPatch, type CatalogPatch, type ModelCatalogDraft, type ModelPickerSection } from 'dsh-llm-providers-ui/model-catalog'
import { ProviderCardHeader, ProviderQuotaMeter, providerUiCss } from 'dsh-llm-providers-ui/provider-ui'
import { dropPersistedUsageKeys, headerQuotaFromCache, peekCachedUsage, rememberHeadlineQuota } from 'dsh-llm-providers-ui/usage-readers'
import { decodeCatalogModels, type AcpCatalogModel, type AcpSettingsRow, type AcpSettingsSnapshot, type AntigravityQuotaSnapshot } from '../client-contract.ts'
import type { AcpSettingsKey } from './locales.ts'
import { BrandMark } from './BrandMark.tsx'
import type {} from 'dsh-llm-providers-ui/client'
import { mergeSettingsDraft, patchedOverrideFlags, shouldClearQuota, resolveAntigravityCardState, antigravityAccessKind, antigravityAccessHintKey, type AntigravityAccessKind, type AntigravityCardState } from './settings-state.ts'
import { syncRowKeys } from '../row-keys.js'

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
  readonly onAction: (name: string, value?: unknown) => void
  readonly onRefresh: () => void
  readonly onRefreshModels: () => Promise<readonly AcpCatalogModel[]>
  readonly onRefreshQuota: () => void
  readonly onCatalogChange: (models: AcpSettingsRow['models']) => void
  readonly onPersist: () => void
  readonly onDiscard: () => void
  readonly accessKind?: AntigravityAccessKind
}
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, minWidth: 0 }
const control: CSSProperties = { width: '100%', minWidth: 0, minHeight: 36, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, padding: '7px 10px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)' }
const button: CSSProperties = {
  minHeight: 34,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 18,
  padding: '6px 14px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'pointer',
}
const primaryButtonStyle: CSSProperties = {
  ...button,
  borderColor: 'var(--dsw-alias-button-primary-fill)',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}
const iconButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  border: 0,
  borderRadius: 6,
  padding: 0,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  font: 'inherit',
  cursor: 'pointer',
}
const disclosureStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  border: 0,
  padding: 0,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}
const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}
const hintStyle: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
const actionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }
const errorStyle: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' }
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }
const section: CSSProperties = { padding: '18px 0', borderTop: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }
const muted: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' }

function CallbackPaste({ t, disabled, onSubmit }: { t: (key: AcpSettingsKey) => string; disabled: boolean; onSubmit: (url: string) => void }): JSX.Element {
  const [value, setValue] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={muted}>{t('pasteCallback')}</p>
      <label style={field}>{t('callbackUrl')}<input style={control} value={value} autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:…" onChange={event => setValue(event.target.value)} /></label>
      <button type="button" style={button} disabled={disabled || value.trim() === ''} onClick={() => onSubmit(value)}>{t('submitCallback')}</button>
    </div>
  )
}
// TODO: drop the header geometry overrides once every provider card ships the
// shared header: measured live, the deployed core headers use identity 1 1 190px,
// mini 1 1 210px with min 210px / max 260px, and a 64px status, while our bundled
// shared header uses identity basis 0 and a 96px status, which starves the
// identity and balloons our mini over the title. Re-measure after any core bump.
const localCss = '[data-provider-body][hidden]{display:none!important}[data-antigravity-quota]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px}[data-antigravity-heading]{font-size:13px;font-weight:600;margin:0}[data-provider-card="antigravity"] [data-provider-header-main]>span:first-child{flex:1 1 190px!important;min-width:190px}[data-provider-card="antigravity"] [data-provider-quota-mini]{width:auto!important;flex:1 1 210px!important;min-width:210px!important;max-width:260px!important}[data-provider-card="antigravity"] [data-provider-header-status]{flex:0 0 auto!important;width:64px!important}@media(max-width:680px){[data-antigravity-quota]{grid-template-columns:1fr}[data-provider-card="antigravity"] button,[data-provider-card="antigravity"] select,[data-provider-card="antigravity"] a,[data-provider-card="antigravity"] input:not([type=checkbox]){min-height:44px}}'

function catalogDraft(model: AcpSettingsRow['models'][number], index: number): ModelCatalogDraft {
  return {
    rowId: model.id === '' ? 'manual:' + String(index) : model.id,
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.vision === undefined ? {} : { vision: model.vision }),
    ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
    ...(model.contextWindow === undefined ? {} : { contextWindow: String(model.contextWindow) }),
    ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
    ...(model.reasoning?.efforts === undefined ? {} : { efforts: model.reasoning.efforts }),
    ...(model.sources === undefined ? {} : { sources: model.sources }),
    ...(model.overrides === undefined ? {} : { overrides: model.overrides }),
  }
}

function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ flex: 'none', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }}>
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconRefresh(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 1.8v2.6h-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function parsePositiveInt(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined
  const value = Number(text.trim())
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Render Install at top when missing, Sign in at top when installed, Account/Quota/Model when connected.
 * @param props the live row, snapshot, quota, and state callbacks.
 * @returns the ordered card sections without runtime path internals.
 */
export function AntigravityCardBody({ t, row, snapshot, state, quota, quotaError, quotaLoading, working, polling, saving, dirty, onAction, onRefresh, onRefreshModels, onRefreshQuota, onCatalogChange, onPersist, onDiscard, accessKind }: AntigravityCardBodyProps): JSX.Element {
  const kind = accessKind ?? (typeof window === 'undefined' ? 'remote' : antigravityAccessKind(window.location.hostname, window.navigator.userAgent))
  const phase = snapshot.install?.phase
  const installActive = phase === 'downloading' || phase === 'extracting' || phase === 'verifying'
  const showInstall = state === 'missing' || installActive || phase === 'failed'
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState<'switch' | 'logout'>()
  const [expandedModels, setExpandedModels] = useState<ReadonlySet<string>>(new Set())
  const [sorting, setSorting] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string>()
  const [pickerError, setPickerError] = useState<string>()
  const [candidates, setCandidates] = useState<readonly AcpCatalogModel[] | null>(null)
  const [picker, setPicker] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const rowKeySeq = useRef(0)
  const pendingRowKeys = useRef<string[]>([])
  const rowKeys = useRef<readonly { key: string; id: string }[]>([])
  rowKeys.current = (() => {
    const keys = syncRowKeys(rowKeys.current, row.models.map(model => model.id), () => {
      const queued = pendingRowKeys.current.shift()
      if (queued !== undefined) return queued
      rowKeySeq.current += 1
      return 'agy-model-row-' + String(rowKeySeq.current)
    })
    return row.models.map((model, at) => ({ key: keys[at]!, id: model.id }))
  })()
  const drafts = row.models.map((model, index) => ({ ...catalogDraft(model, index), rowId: rowKeys.current[index]!.key }))
  const customModels = dirty || row.models.some(model => model.overrides !== undefined && Object.keys(model.overrides).length > 0)
  const invalidModels = (() => {
    const seen = new Set<string>()
    for (const model of row.models) {
      const id = model.id.trim()
      if (id.length === 0 || seen.has(id)) return true
      seen.add(id)
    }
    return false
  })()
  const patchModel = (index: number, patch: CatalogPatch<ModelCatalogDraft>): void => {
    const current = drafts[index]
    if (current === undefined) return
    const next = applyCatalogPatch(current, patch)
    const models = row.models.map((model, at) => {
      if (at !== index) return model
      const contextWindow = next.contextWindow === undefined || next.contextWindow.trim() === ''
        ? undefined
        : parsePositiveInt(next.contextWindow)
      if (next.contextWindow !== undefined && next.contextWindow.trim() !== '' && contextWindow === undefined) return model
      const efforts = model.reasoning?.efforts ?? next.efforts ?? []
      const defaultEffort = next.defaultEffort !== undefined && efforts.some(effort => effort.id === next.defaultEffort)
        ? next.defaultEffort
        : undefined
      // Fields this patch set are the user's own, whatever the row reports as
      // discovered; the flag is the only edit evidence a row outside the snapshot has.
      const patched = patchedOverrideFlags(patch)
      const overrides = patched === undefined ? model.overrides : { ...model.overrides, ...patched }
      const updated: { -readonly [K in keyof AcpCatalogModel]: AcpCatalogModel[K] } = {
        ...model,
        id: next.id.trim(),
        name: next.name ?? next.id.trim(),
        ...(next.vision === undefined ? {} : { vision: next.vision }),
        ...(next.thinking === undefined ? {} : { thinking: next.thinking }),
        ...(efforts.length === 0 && defaultEffort === undefined
          ? {}
          : { reasoning: { efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) } }),
        ...(next.sources === undefined ? {} : { sources: next.sources }),
        ...(overrides === undefined ? {} : { overrides }),
      }
      if (contextWindow === undefined) delete updated.contextWindow
      else updated.contextWindow = contextWindow
      if (next.vision === undefined) delete updated.vision
      if (next.thinking === undefined) delete updated.thinking
      if (efforts.length === 0 && defaultEffort === undefined) delete updated.reasoning
      return updated
    })
    onCatalogChange(models)
  }
  const removeModel = (index: number): void => {
    onCatalogChange(row.models.filter((_, at) => at !== index))
  }
  // Restore clears the stored override for one field. The row keeps its displayed
  // value until the recomposed snapshot arrives; the flag records the intent.
  const restoreModelField = (index: number, field: string): void => {
    const model = row.models[index]
    if (model === undefined) return
    const next = { ...model, overrides: { ...model.overrides, [field]: false } }
    onCatalogChange(row.models.map((current, at) => at === index ? next : current))
  }
  const toggleModel = (rowId: string): void => {
    setExpandedModels(current => {
      const next = new Set(current)
      if (!next.delete(rowId)) next.add(rowId)
      return next
    })
  }
  const fetchModels = async (): Promise<void> => {
    setPicked(new Set(row.models.map(model => model.id)))
    setCandidates(null)
    setFetchError(undefined)
    setPickerError(undefined)
    setFetching(true)
    setPicker(true)
    try {
      const fresh = await onRefreshModels()
      const freshIds = new Set(fresh.map(model => model.id))
      const currentOnly = row.models.filter(model => !freshIds.has(model.id))
      if (fresh.length === 0 && currentOnly.length === 0) {
        setPicker(false)
        setFetchError(t('fetchEmpty'))
        return
      }
      setCandidates([...fresh, ...currentOnly])
    } catch (caught) {
      const message = caught instanceof Error && caught.message.length > 0 ? caught.message : t('failed')
      setPickerError(message)
      setFetchError(message)
    } finally {
      setFetching(false)
    }
  }
  const pickerSections: readonly ModelPickerSection[] = [{
    id: 'antigravity',
    label: 'Antigravity',
    models: (candidates ?? row.models).map(model => ({
      id: model.id,
      name: model.name,
      ...(model.reasoning !== undefined && model.reasoning.efforts.length > 0 ? { hint: t('thinking') } : {}),
    })),
  }]
  const adoptModels = (): void => {
    const source = candidates ?? row.models
    const byId = new Map(row.models.map(model => [model.id, model]))
    const selected: AcpCatalogModel[] = []
    for (const id of picked) {
      const candidate = source.find(model => model.id === id)
      if (candidate === undefined) continue
      const previous = byId.get(id)
      selected.push(previous === undefined ? candidate : { ...previous, ...candidate })
    }
    onCatalogChange(selected)
    setCandidates(null)
    setPicker(false)
    setCatalogOpen(true)
  }
  const loginActive = state !== 'missing' && !row.authenticated
  const loginUrl = row.authAttempt?.authorizationUrl ?? row.authorizationUrl
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
    <section style={section} className="compact">
      <div style={{ ...actions, justifyContent: 'space-between' }}>
        <div><h3 data-antigravity-heading>{t('account')}</h3><p style={muted}>{row.authenticated ? t('connected') : state === 'missing' ? t('missingBadge') : t('authBadge')}</p></div>
        {row.authenticated
          ? <span style={{ display: 'inline-flex', gap: 8 }}>
            <button type="button" style={iconButtonStyle} aria-label={t('rescan')} title={t('rescan')} disabled={working || polling} onClick={onRefresh}><IconRefresh /></button>
            <button type="button" style={button} onClick={() => setMenu(open => !open)}>{t('manageAccount')}</button>
          </span>
          : state !== 'missing' && !loginActive ? <button type="button" style={button} disabled={working || polling} onClick={() => onAction('sign-in')}>{t('signIn')}</button>
          : null}
      </div>
      {menu && row.authenticated && <div style={actions}>
        <button type="button" style={button} onClick={() => setConfirm('switch')}>{t('switchAccount')}</button>
        <button type="button" style={button} onClick={() => setConfirm('logout')}>{t('signOut')}</button>
      </div>}
      {loginActive && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={muted}>{t(antigravityAccessHintKey(kind))}</p>
        <p style={muted}>{row.authAttempt?.status === 'failed' || row.authAttempt?.status === 'expired' ? (row.authAttempt.message ?? t('failed')) : t('loginWaiting')}</p>
        <div style={actions}>
          {loginUrl && <a href={loginUrl} target="_blank" rel="noopener noreferrer" style={{ ...button, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{t('openLogin')}</a>}
          {loginUrl && <button type="button" style={button} onClick={() => { void navigator.clipboard?.writeText(loginUrl) }}>{t('copyLogin')}</button>}
          {snapshot.signingIn || row.authAttempt?.status === 'pending' ? <button type="button" style={button} disabled={working} onClick={() => onAction('cancel-login')}>{t('cancel')}</button> : <button type="button" style={button} disabled={working || polling} onClick={() => onAction('sign-in')}>{t('signIn')}</button>}
        </div>
        {(loginUrl || row.authAttempt) && <CallbackPaste t={t} disabled={working} onSubmit={url => onAction('complete-login', url)} />}
      </div>}
      {confirm && <div role="dialog" aria-modal="true">
        <p style={muted}>{t(confirm === 'switch' ? 'confirmSwitch' : 'confirmSignOut')}</p>
        <div style={actions}>
          <button type="button" style={button} onClick={() => setConfirm(undefined)}>{t('cancel')}</button>
          <button type="button" style={button} onClick={() => { const action = confirm; setConfirm(undefined); setMenu(false); onAction(action === 'switch' ? 'sign-in' : 'sign-out') }}>{t(confirm === 'switch' ? 'switchAccount' : 'signOut')}</button>
        </div>
      </div>}
    </section>
    {state === 'connected' && <section style={section}>
      <div style={{ ...actions, justifyContent: 'space-between' }}><h3 data-antigravity-heading>{t('quota')}</h3><button type="button" style={button} disabled={!row.authenticated || quotaLoading || working} onClick={onRefreshQuota}>{quotaLoading ? t('loading') : t('refreshQuota')}</button></div>
      {quotaError && <p role="status" style={muted}>{quotaError}{quota ? ' · ' + t('staleQuota') : ''}</p>}
      {!quota && !quotaError && <p style={muted}>{t('quotaUnavailable')}</p>}
      {quota?.groups.map((group, gi) => <div key={gi}><h3 data-antigravity-heading>{group.displayName ?? t('quota')}</h3><div data-antigravity-quota>{group.buckets.map((bucket, bi) => <div key={bucket.bucketId ?? bi}>
        <ProviderQuotaMeter label={bucket.displayName ?? bucket.window ?? t('quota')} {...(bucket.disabled || bucket.remainingFraction === undefined ? {} : { remainingPercent: bucket.remainingFraction >= 1 ? 100 : Math.min(99, Math.round(bucket.remainingFraction * 100)) })} emptyLabel={bucket.disabled ? t('disabledBadge') : t('quotaUnavailable')} {...(bucket.resetTime ? { detail: t('resetsAt') + ' ' + new Date(bucket.resetTime).toLocaleString() } : {})} />
      </div>)}</div></div>)}
      {quota && <p style={muted}>{t('updatedAt')} {new Date(quota.observedAt).toLocaleString()}</p>}
    </section>}
    {state === 'connected' && <section style={section} aria-label={t('model')}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          type="button"
          style={disclosureStyle}
          aria-expanded={catalogOpen}
          aria-label={t('model')}
          onClick={() => { setCatalogOpen(!catalogOpen) }}
        >
          <IconChevron open={catalogOpen} />
          <span style={sectionTitleStyle}>{t('model')}</span>
          <span style={hintStyle}>{customModels ? t('customized') : t('inherited')}</span>
        </button>
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button
            type="button"
            style={button}
            aria-pressed={sorting}
            disabled={saving || row.models.length < 2}
            onClick={() => { setSorting(current => !current) }}
          >
            {t(sorting ? 'doneSorting' : 'sortModels')}
          </button>
          <button
            type="button"
            style={button}
            disabled={fetching || saving || !row.authenticated}
            onClick={() => { void fetchModels() }}
          >
            {t(fetching ? 'fetchingModels' : 'fetchModels')}
          </button>
        </span>
      </div>
      {fetchError === undefined ? null : <p role="status" style={errorStyle}>{fetchError}</p>}
      {catalogOpen
        ? (
          <>
            <ModelCatalogEditor
              items={drafts}
              fields={{ vision: true, thinking: true, defaultEffort: true, context: true }}
              labels={{
                modelId: t('modelId'), modelName: t('modelName'), modelDetails: t('modelDetails'), remove: t('removeModel'),
                drag: t('dragModel'), moveUp: t('moveUp'), moveDown: t('moveDown'),
                vision: t('vision'), thinking: t('thinking'), defaultEffort: t('defaultEffort'),
                contextWindow: t('contextWindow'), contextWindowDefault: t('unknown'),
                unknown: t('unknown'), supported: t('supported'), unsupported: t('unsupported'),
                restoreAuto: t('restoreAuto'),
              }}
              disabled={saving}
              sorting={sorting}
              expanded={expandedModels}
              onReorder={items => {
                const byId = new Map(row.models.map(model => [model.id, model]))
                onCatalogChange(items.map(item => byId.get(item.rowId) ?? byId.get(item.id) ?? { id: item.id, name: item.name ?? item.id }))
              }}
              onPatch={(index, patch) => { patchModel(index, patch) }}
              onRestore={(index, field) => { restoreModelField(index, field) }}
              onRemove={index => { removeModel(index) }}
              onToggle={rowId => { toggleModel(rowId) }}
            />
            <button
              type="button"
              style={{ ...button, alignSelf: 'flex-start' }}
              disabled={saving}
              onClick={() => {
                rowKeySeq.current += 1
                const rowId = 'agy-model-row-' + String(rowKeySeq.current)
                pendingRowKeys.current.push(rowId)
                onCatalogChange([...row.models, { id: '', name: '' }])
                setExpandedModels(current => new Set(current).add(rowId))
              }}
            >
              {t('addModel')}
            </button>
          </>
          )
        : null}
      <ModelPickerDialog open={picker} loading={fetching} {...(pickerError === undefined ? {} : { error: pickerError })} labels={{ title: t('pickerTitle'), description: t('pickerDescription'), search: t('pickerSearch'), loading: t('pickerLoading'), empty: t('pickerEmpty'), cancel: t('cancel'), apply: t('applySelected'), close: t('cancel') }}
        sections={pickerSections}
        picked={picked} onClose={() => { setPicker(false); setCandidates(null) }} onToggle={id => setPicked(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next })}
        onApply={adoptModels} />
    </section>}
    {invalidModels ? <p role="alert" style={errorStyle}>{t('invalidModels')}</p> : null}
    <div style={actionsStyle}>
      {dirty && <span style={{ ...muted, marginRight: 'auto' }}>{t('unsaved')}</span>}
      <button type="button" style={button} disabled={!dirty || saving} onClick={onDiscard}>{t('cancel')}</button>
      <button
        type="button"
        style={primaryButtonStyle}
        disabled={!dirty || invalidModels || saving || working}
        onClick={onPersist}
      >
        {t(saving ? 'saving' : 'save')}
      </button>
    </div>
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
  const refreshModels = async (): Promise<readonly AcpCatalogModel[]> => {
    if (working) return []
    setWorking(true); setError(undefined)
    epoch.current++
    try {
      const fresh = decodeCatalogModels(await run('refresh-models'))
      if (fresh === undefined) throw new Error(t('failed'))
      await refresh()
      return fresh
    } finally { if (mounted.current) setWorking(false) }
  }
  const action = async (name: string, value?: unknown): Promise<void> => {
    if (working) return
    setWorking(true); setError(undefined)
    epoch.current++
    if (name === 'sign-in' || name === 'sign-out') clearQuota()
    try { await run(name, value); await refresh() } catch (caught) { fail(caught) }
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
  const resetDetail = first?.bucket.resetTime === undefined ? undefined : t('resetsAt') + ' ' + new Date(first.bucket.resetTime).toLocaleString()
  const liveQuota = first === undefined ? undefined : { remainingPercent: first.bucket.remainingFraction! >= 1 ? 100 : Math.min(99, Math.round(first.bucket.remainingFraction! * 100)), label: [first.group, first.bucket.window ?? first.bucket.displayName].filter(Boolean).join(' · '), ...(quotaError === undefined ? (resetDetail === undefined ? {} : { detail: resetDetail }) : { detail: t('staleQuota') }) }
  const headerQuota = snapshot !== undefined && !snapshot.rows[0]?.authenticated ? undefined : liveQuota ?? headerQuotaFromCache(peekCachedUsage('antigravity'))
  return <section data-provider-card="antigravity" data-provider-role="agent">
    <style>{providerUiCss + localCss}</style>
    <button type="button" data-provider-card-header aria-expanded={open} onClick={() => setOpen(!open)}>
      <ProviderCardHeader title="Antigravity" mark={<BrandMark />} role="agent" summary={row === undefined ? '' : t('modelCount').replace('{count}', String(row.models.length))} status={status} open={open} unsaved={dirty} unsavedLabel={t('unsaved')} {...(headerQuota === undefined ? {} : { quota: headerQuota })} />
    </button>
    <div data-provider-body hidden={!open}>
      {error && <p role="alert" style={{ ...muted, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</p>}
      {row && snapshot ? <AntigravityCardBody t={t} row={row} snapshot={snapshot} state={state} {...(quota === undefined ? {} : { quota })} {...(quotaError === undefined ? {} : { quotaError })} quotaLoading={quotaLoading} working={working} polling={polling} saving={saving} dirty={dirty}
        onAction={(name, value) => void action(name, value)}
        onRefresh={() => void refresh().catch(fail)}
        onRefreshModels={refreshModels}
        onRefreshQuota={() => void fetchQuota()}
        onCatalogChange={models => change({ ...row, models })}
        onPersist={() => void persist()}
        onDiscard={() => { dirtyRef.current = false; setDirty(false); setDraft(snapshot.rows[0]) }} />
        : <p role="status" style={muted}>{t('loading')}</p>}
    </div>
  </section>
}
