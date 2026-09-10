import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AcpSettingsRow, AcpSettingsSnapshot, AntigravityQuotaSnapshot } from '../src/client-contract.ts'
import { AntigravityCardBody, ExternalAgentsSection, type AcpSettingsFace } from '../src/web/ExternalAgentsSection.tsx'
import { en, type AcpSettingsKey } from '../src/web/locales.ts'
import { resolveAntigravityCardState } from '../src/web/settings-state.ts'

const baseRow: AcpSettingsRow = {
  provider: 'antigravity',
  instanceId: 'default',
  title: 'Antigravity',
  enabled: true,
  executablePath: '/runtime/agy_acp_server.par',
  harnessPath: '/runtime/localharness_external',
  stateDirectory: '/profile/antigravity',
  models: [{ id: 'models/a', name: 'Model A' }],
  installed: false,
  authenticated: false,
  live: false,
  ready: false,
  message: 'Runtime status message.',
}

const quota: AntigravityQuotaSnapshot = {
  status: 'ready',
  groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'a', displayName: 'Quota 5h', remainingFraction: 0.5, resetTime: '2026-09-06T04:00:00.000Z' }] }],
  observedAt: '2026-09-06T03:00:00.000Z',
}

function snapshotFor(row: AcpSettingsRow, install?: AcpSettingsSnapshot['install'], signingIn?: true): AcpSettingsSnapshot {
  return { title: 'External Agents', rows: [row], ...(install === undefined ? {} : { install }), ...(signingIn === undefined ? {} : { signingIn }) }
}

function renderBody(row: AcpSettingsRow, snapshot: AcpSettingsSnapshot, extra?: Partial<Parameters<typeof AntigravityCardBody>[0]>): string {
  const noop = (): void => undefined
  return renderToStaticMarkup(createElement(AntigravityCardBody, {
    t: (key: AcpSettingsKey) => en[key],
    row,
    snapshot,
    state: resolveAntigravityCardState(row),
    quotaLoading: false,
    working: false,
    polling: false,
    saving: false,
    dirty: false,
    onAction: noop,
    onRefresh: noop,
    onRefreshModels: () => Promise.resolve([]),
    onRefreshQuota: noop,
    onCatalogChange: noop,
    onPersist: noop,
    onDiscard: noop,
    ...extra,
  }))
}

describe('antigravity settings card states', () => {
  it('leaves the header model count empty while the snapshot is still loading', () => {
    const face: AcpSettingsFace = {
      t: key => en[key],
      load: () => new Promise<AcpSettingsSnapshot>(() => {}),
      save: () => Promise.resolve(),
      run: () => Promise.resolve(undefined),
      pick: () => Promise.resolve(null),
      quota: () => new Promise<AntigravityQuotaSnapshot>(() => {}),
    }
    // The workspace seat is framework-provided and unread on this path.
    const markup = renderToStaticMarkup(createElement(ExternalAgentsSection, face as never))
    expect(markup).toContain('Antigravity')
    expect(markup).not.toMatch(/[0-9]+ models/)
  })

  it('derives missing, login, and connected only from installed and authenticated', () => {
    expect(resolveAntigravityCardState(undefined)).toBe('loading')
    expect(resolveAntigravityCardState(baseRow)).toBe('missing')
    expect(resolveAntigravityCardState({ ...baseRow, installed: true })).toBe('login')
    expect(resolveAntigravityCardState({ ...baseRow, installed: true, authenticated: true })).toBe('connected')
    expect(resolveAntigravityCardState({ ...baseRow, installed: true, authenticated: true, enabled: false })).toBe('connected')
  })

  it('puts installation at the top when missing and keeps runtime paths out of the UI', () => {
    const markup = renderBody(baseRow, snapshotFor(baseRow))
    expect(markup).toContain(en.install)
    expect(markup.indexOf(en.install)).toBeLessThan(markup.indexOf(en.rescan))
    expect(markup).not.toContain(en.signIn)
    expect(markup).not.toContain(en.refreshQuota)
    expect(markup).not.toContain(en.refreshModels)
    expect(markup).not.toContain(en.fetchModels)
    expect(markup).not.toContain(baseRow.executablePath)
    expect(markup).not.toContain(baseRow.harnessPath)
    expect(markup).not.toContain(baseRow.stateDirectory)
    expect(markup).not.toContain('Advanced / runtime')
    expect(markup).not.toContain('ACP server')
    expect(markup).not.toContain('localharness_external')
    expect(markup).not.toContain('Profile')
  })

  it('shows install progress with checksum-gated phases while polling', () => {
    const row = baseRow
    const markup = renderBody(row, snapshotFor(row, { phase: 'downloading', downloadedBytes: 50, totalBytes: 100, message: 'Downloading the Google ACP runtime.' }), { polling: true })
    expect(markup).toContain(en.installing)
    expect(markup).toContain('50%')
    expect(markup).toContain('Downloading the Google ACP runtime.')
  })

  it('puts login at the top once installed and offers the authorization URL recovery', () => {
    const row = { ...baseRow, installed: true, authorizationUrl: 'https://accounts.example/login' }
    const markup = renderBody(row, snapshotFor(row))
    expect(markup).toContain(en.signIn)
    expect(markup).not.toContain(en.rescan)
    expect(markup).toContain(en.openLogin)
    expect(markup).toContain('https://accounts.example/login')
    expect(markup).toContain(en.accessRemote)
    expect(markup).toContain(en.pasteCallback)
    expect(markup).toContain(en.submitCallback)
    expect(markup).not.toContain(en.install)
    expect(markup).not.toContain(en.refreshQuota)
    expect(markup).not.toContain(en.refreshModels)
    expect(markup).not.toContain(en.fetchModels)
    expect(markup).not.toContain(baseRow.executablePath)
    expect(markup).not.toContain(baseRow.stateDirectory)
    expect(markup).not.toContain('localharness_external')
  })

  it('keeps callback paste on localhost, lan, and app', () => {
    const row = { ...baseRow, installed: true, authorizationUrl: 'https://accounts.example/login' }
    const local = renderBody(row, snapshotFor(row), { accessKind: 'local' })
    expect(local).toContain(en.accessLocal)
    expect(local).toContain(en.pasteCallback)
    expect(local).toContain(en.submitCallback)
    const lan = renderBody(row, snapshotFor(row), { accessKind: 'lan' })
    expect(lan).toContain(en.accessLan)
    expect(lan).toContain(en.pasteCallback)
    const app = renderBody(row, snapshotFor(row), { accessKind: 'app' })
    expect(app).toContain(en.accessApp)
    expect(app).toContain(en.submitCallback)
  })

  it('orders account, quota, and model when connected and keeps the save footer last', () => {
    const row = { ...baseRow, installed: true, authenticated: true, model: 'models/a', models: [{ id: 'models/a', name: 'Model A' }, { id: 'models/b', name: 'Model B' }] }
    const markup = renderBody(row, snapshotFor(row), { quota, dirty: true })
    expect(markup.indexOf(en.manageAccount)).toBeLessThan(markup.indexOf(en.refreshQuota))
    expect(markup.indexOf(en.refreshQuota)).toBeLessThan(markup.indexOf(en.fetchModels))
    expect(markup.indexOf(en.fetchModels)).toBeLessThan(markup.indexOf(en.save))
    expect(markup).toContain(en.model)
    expect(markup).toContain('Gemini')
    expect(markup).toContain(en.manageAccount)
    expect(markup).toContain(en.cancel)
    expect(markup).not.toContain(baseRow.executablePath)
    expect(markup).not.toContain(baseRow.harnessPath)
    expect(markup).not.toContain(baseRow.stateDirectory)
    expect(markup).not.toContain('Advanced / runtime')
  })

  it('shows the reference catalog chrome without provider-specific rows', () => {
    const row = {
      ...baseRow,
      installed: true,
      authenticated: true,
      models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] } }],
    }
    const markup = renderBody(row, snapshotFor(row))
    expect(markup).toContain(en.model)
    expect(markup).toContain(en.fetchModels)
    expect(markup).toContain(en.inherited)
    expect(markup).toContain(en.sortModels)
    expect(markup).not.toContain(en.inputLimit)
    expect(markup).not.toContain(en.declaredDefault)
    expect(markup).not.toContain(en.enableProvider)
    expect(markup).not.toContain(en.followNative)
  })
})
