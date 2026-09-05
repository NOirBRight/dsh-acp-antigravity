/** External Agents settings page for the Antigravity ACP provider. */
import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AcpInstallProgress, AcpSettingsRow, AcpSettingsSnapshot } from '../client-contract.ts'
import type { AcpSettingsKey } from './locales.ts'

export interface AcpSettingsFace {
  t: (key: AcpSettingsKey) => string
  load: () => Promise<AcpSettingsSnapshot>
  save: (row: AcpSettingsRow) => Promise<void>
  run: (action: string, value?: unknown) => Promise<unknown>
  pick: () => Promise<string | null>
}

export type ExternalAgentsSectionProps = PropsRuntime<'settings.provider.item'> & InjectFace<AcpSettingsFace>

const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760, paddingRight: 64, color: 'var(--dsw-alias-label-primary)' }
const titleStyle: CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600, lineHeight: '28px' }
const introStyle: CSSProperties = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' }
const cardsStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }
const meta: CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', minHeight: 18 }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const input: CSSProperties = { height: 32, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '0 10px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }
const ghostBtn: CSSProperties = { height: 32, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 24, background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '0 12px' }

function cardShell(ready: boolean, missing: boolean): CSSProperties {
  return {
    border: '1px solid ' + (ready ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l2)'),
    borderRadius: 14,
    display: 'flex',
    flexDirection: 'column',
    background: ready ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
    opacity: missing ? 0.7 : 1,
    minWidth: 0,
    padding: 16,
    gap: 12,
  }
}

function statusBadge(row: AcpSettingsRow, t: AcpSettingsFace['t']): string {
  if (!row.enabled) return t('disabledBadge')
  if (!row.installed) return t('missingBadge')
  if (!row.authenticated) return t('authBadge')
  return t('enabledBadge')
}

function ProviderCard(props: {
  row: AcpSettingsRow
  t: AcpSettingsFace['t']
  onChange: (row: AcpSettingsRow) => void
  onLocate: (target: 'executablePath' | 'harnessPath') => void
  onRun: (action: string) => void
  onSignIn: () => void
  install?: AcpInstallProgress
  signingIn?: boolean
}): JSX.Element {
  const { row, t, onChange, onLocate, onRun, onSignIn, install, signingIn } = props
  const installing = install?.phase === 'downloading' || install?.phase === 'extracting' || install?.phase === 'verifying'
  const missing = !row.installed
  return (
    <li style={cardShell(row.ready && row.enabled, missing || !row.enabled)}>
      <div style={meta}>{statusBadge(row, t)}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
        <input type='checkbox' checked={row.enabled} onChange={() => onChange({ ...row, enabled: !row.enabled })} />
        {row.enabled ? t('enabledBadge') : t('disabledBadge')}
      </label>
      <div style={meta}>{[row.version, row.message].filter(Boolean).join(' · ')}</div>
      <label style={field}>
        {t('executable')}
        <input style={input} title={row.executablePath} value={row.executablePath} onChange={event => onChange({ ...row, executablePath: event.target.value })} />
        <button type='button' style={ghostBtn} onClick={() => onLocate('executablePath')}>{t('locateAcp')}</button>
      </label>
      <label style={field}>
        {t('harness')}
        <input style={input} title={row.harnessPath} value={row.harnessPath} onChange={event => onChange({ ...row, harnessPath: event.target.value })} />
        <button type='button' style={ghostBtn} onClick={() => onLocate('harnessPath')}>{t('locateHarness')}</button>
      </label>
      <label style={field}>
        {t('model')}
        <select style={input} value={row.model ?? ''} onChange={event => onChange({ ...row, model: event.target.value || undefined })}>
          <option value=''>account default</option>
          {row.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      {row.profileDirectory ? <div style={meta}>{t('profile')}: {row.profileDirectory}</div> : null}
      {install !== undefined && install.phase !== 'idle' ? <div style={meta}>{install.message}{install.totalBytes > 0 && installing ? ' ' + String(Math.round(100 * install.downloadedBytes / install.totalBytes)) + '%' : ''}</div> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type='button' style={ghostBtn} disabled={installing} onClick={() => onRun('install-runtime')}>{installing ? t('installing') : t('install')}</button>
        {row.authenticated
          ? <button type='button' style={ghostBtn} onClick={() => onRun('sign-out')}>{t('signOut')}</button>
          : <button type='button' style={ghostBtn} disabled={signingIn === true} onClick={onSignIn}>{signingIn === true ? t('signingIn') : t('signIn')}</button>}
        {row.authorizationUrl
          ? <button type='button' style={ghostBtn} onClick={() => onRun('open-login')}>{t('openLogin')}</button>
          : null}
      </div>
    </li>
  )
}

export function ExternalAgentsSection(props: ExternalAgentsSectionProps): JSX.Element {
  const { t, load, save, run, pick } = props
  const [snapshot, setSnapshot] = useState<AcpSettingsSnapshot | undefined>(undefined)
  const [draft, setDraft] = useState<AcpSettingsRow | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    let next = await load()
    setSnapshot(next)
    setDraft(next.rows[0])
    try {
      if ((next.rows[0]?.executablePath ?? '').trim() === '') await run('probe-installation')
      next = await load()
      setSnapshot(next)
      setDraft(next.rows[0])
    } catch { /* keep the snapshot when PATH probe is unavailable */ }
    if (next.rows[0]?.authenticated) {
      try { await run('refresh-models') } catch { /* models stay empty until sign-in */ }
      const after = await load()
      setSnapshot(after)
      setDraft(after.rows[0])
    }
  }

  useEffect(() => { void refresh().catch(caught => setError(caught instanceof Error ? caught.message : t('failed'))) }, [])
  const installPhase = snapshot?.install?.phase
  useEffect(() => {
    if (installPhase !== 'downloading' && installPhase !== 'extracting' && installPhase !== 'verifying') return
    const timer = window.setInterval(() => {
      void load().then(next => {
        setSnapshot(next)
        setDraft(next.rows[0])
        if (next.install?.phase === 'succeeded' || next.install?.phase === 'failed') return
      }).catch(() => undefined)
    }, 500)
    return () => window.clearInterval(timer)
  }, [installPhase, load])
  const signingIn = snapshot?.signingIn === true
  useEffect(() => {
    if (!signingIn) return
    const timer = window.setInterval(() => {
      void load().then(next => {
        setSnapshot(next)
        setDraft(next.rows[0])

      }).catch(() => undefined)
    }, 500)
    return () => window.clearInterval(timer)
  }, [signingIn, load])

  const row = draft
  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h1 style={titleStyle}>{t('title')}</h1>
        <span style={{ marginLeft: 'auto' }} />
        <button type='button' style={ghostBtn} onClick={() => { void refresh().catch(caught => setError(caught instanceof Error ? caught.message : t('failed'))) }}>{t('rescan')}</button>
        <button
          type='button'
          style={{ ...ghostBtn, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-1)', border: 0 }}
          disabled={row === undefined || saveStatus === 'saving'}
          onClick={() => {
            if (row === undefined) return
            setSaveStatus('saving')
            void save(row).then(() => { setSaveStatus('saved'); return refresh() }).catch(caught => { setSaveStatus('idle'); setError(caught instanceof Error ? caught.message : t('failed')) })
          }}
        >
          {saveStatus === 'saved' ? t('saved') : t('save')}
        </button>
      </div>
      <p style={introStyle}>{t('intro')}</p>
      {error ? <p style={{ ...introStyle, color: 'var(--dsw-alias-label-danger, #c00)' }}>{error}</p> : null}
      <ul style={cardsStyle}>
        {row === undefined || snapshot === undefined ? null : (
          <ProviderCard
            row={row}
            t={t}
            onChange={setDraft}
            onLocate={target => {
              void pick().then(path => {
                if (path === null) return
                setDraft(current => current === undefined ? current : { ...current, [target]: path, ...(target === 'executablePath' && current.harnessPath === '' ? { harnessPath: path.replace(/agy_acp_server[^/]*$/u, 'localharness_external') } : {}) })
              })
            }}
            install={snapshot.install}
            signingIn={snapshot.signingIn}
            onSignIn={() => {
              void run('sign-in').then(() => load()).then(next => { setSnapshot(next); setDraft(next.rows[0]) }).catch(caught => setError(caught instanceof Error ? caught.message : t('failed')))
            }}
            onRun={action => { void run(action).then(() => refresh()).catch(caught => setError(caught instanceof Error ? caught.message : t('failed'))) }}
          />
        )}
      </ul>
    </section>
  )
}
