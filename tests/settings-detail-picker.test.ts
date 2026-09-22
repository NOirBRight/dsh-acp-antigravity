import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AcpSettingsRow } from '../src/client-contract.ts'
import type * as ModelCatalog from 'dsh-llm-providers-ui/model-catalog'
import { providerDetailCopy } from 'dsh-llm-providers-ui/provider-detail'
import { AntigravityCardBody } from '../src/web/ExternalAgentsSection.tsx'

vi.mock('dsh-llm-providers-ui/model-catalog', async importOriginal => {
  const actual = await importOriginal<typeof ModelCatalog>()
  return {
    ...actual,
    ModelPickerDialog: () => createElement('div', { 'data-model-picker': 'mounted' }),
  }
})

it('mounts the account model picker on the shared detail page', () => {
  const row: AcpSettingsRow = {
    provider: 'antigravity',
    instanceId: 'default',
    title: 'Antigravity',
    enabled: true,
    executablePath: '/runtime/agy_acp_server.par',
    harnessPath: '/runtime/localharness_external',
    stateDirectory: '/profile/antigravity',
    models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
    installed: true,
    authenticated: true,
    live: false,
    ready: true,
  }
  const markup = renderToStaticMarkup(createElement(AntigravityCardBody, {
    t: (key: string) => key,
    row,
    snapshot: { title: 'External Agents', rows: [row] },
    state: 'connected',
    quotaLoading: false,
    working: false,
    polling: false,
    saving: false,
    dirty: false,
    onAction: () => undefined,
    onRefresh: () => undefined,
    onRefreshModels: async () => [],
    onRefreshQuota: () => undefined,
    onCatalogChange: () => undefined,
    onPersist: () => undefined,
    onDiscard: () => undefined,
    mode: 'detail',
    detailCopy: providerDetailCopy.en,
    sharedTemplate: () => createElement('section'),
  }))
  expect(markup).toContain('data-model-picker="mounted"')
})
