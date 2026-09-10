/** Save round trip: an edit the editor patches must reach the persisted catalog overlay. */
import { describe, expect, it } from 'vitest'
import {
  ACP_SETTINGS_RPC_CHANNEL,
  SAVE_ENDPOINT,
  SNAPSHOT_ENDPOINT,
  decodeConfig,
  type AcpCatalogModel,
  type AcpSettingsRow,
  type AcpSettingsSnapshot,
} from '../src/client-contract.ts'
import type { AcpSettingsFace } from '../src/web/ExternalAgentsSection.tsx'
import { applyCatalogOverlay, collapseAntigravityModels, type CatalogOverlay } from '../src/catalog.js'
import { apply } from '../src/web/index.ts'
import { catalogOverrideFlags } from '../src/web/settings-state.ts'

const NATIVE = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
]

/**
 * Host side of the round trip. The payload decoder and the catalog composition are
 * the production ones, so a saved override is asserted through what the Host would
 * serve next, not through the payload alone.
 */
function host() {
  let order: readonly string[] | undefined
  let overrides: Readonly<Record<string, CatalogOverlay>> | undefined
  return {
    saved: () => ({ order, overrides }),
    snapshot: (): AcpSettingsSnapshot => ({
      title: 'External Agents',
      rows: [{
        provider: 'antigravity',
        instanceId: 'default',
        title: 'Antigravity',
        enabled: true,
        executablePath: '/runtime/agy_acp_server.par',
        harnessPath: '/runtime/localharness_external',
        stateDirectory: '/profile/antigravity',
        models: applyCatalogOverlay(collapseAntigravityModels([...NATIVE], new Map(), 'gemini-3.8-flash-high'), order, overrides),
        installed: true,
        authenticated: true,
        live: false,
        ready: true,
      }],
    }),
    save: (payload: unknown): void => {
      const decoded = decodeConfig(payload)
      if (decoded === undefined) throw new Error('invalid Antigravity settings')
      order = decoded.catalogOrder
      overrides = decoded.catalogOverrides
    },
  }
}

/** Register the real browser plugin against the host above and return its settings face. */
function bench(): { readonly face: AcpSettingsFace; readonly server: ReturnType<typeof host> } {
  const server = host()
  let face: AcpSettingsFace | undefined
  const call = async (_channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> => {
    if (endpoint === SNAPSHOT_ENDPOINT) return { ok: true, value: server.snapshot() }
    if (endpoint === SAVE_ENDPOINT) {
      try {
        server.save(payload)
        return { ok: true, value: { saved: true } }
      } catch (error) {
        return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
      }
    }
    return { ok: false, error: { message: 'unexpected endpoint: ' + endpoint } }
  }
  const ctx = {
    locale: { register: (): (() => void) => () => undefined, bind: (): ((key: string) => string) => key => key },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (spec: { inject?: () => AcpSettingsFace }) => { face ??= spec.inject?.(); return () => undefined },
      entries: () => [],
      subscribe: () => () => undefined,
    },
    connection: { rpc: { call } },
    uiConversation: { events: { register: () => () => undefined } },
    get: () => undefined,
    inject: (_deps: readonly string[], run: (scope: object) => unknown) => run({ providerDirectory: { register: () => () => undefined }, effect: (fn: () => unknown) => fn() }),
    effect: (fn: () => unknown) => fn(),
  }
  apply(ctx as never)
  if (face === undefined) throw new Error('settings face was not registered')
  return { face, server }
}

function modelOf(row: AcpSettingsRow, id: string): AcpCatalogModel {
  const found = row.models.find(model => model.id === id)
  if (found === undefined) throw new Error('missing catalog row: ' + id)
  return found
}

/** Exactly what the card produces for one editor patch: the value changes, the row's flags do not. */
function withModel(row: AcpSettingsRow, id: string, patch: Partial<AcpCatalogModel>): AcpSettingsRow {
  return { ...row, models: row.models.map(model => model.id === id ? { ...model, ...patch } : model) }
}

describe('catalog override persistence', () => {
  it('keeps a first default-effort edit through save and reload', async () => {
    const { face, server } = bench()
    const row = (await face.load()).rows[0]!
    expect(modelOf(row, 'gemini-3.8-flash').reasoning?.defaultEffort).toBe('high')
    expect(server.saved().overrides).toBeUndefined()
    const edited = withModel(row, 'gemini-3.8-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.8-flash').reasoning!.efforts, defaultEffort: 'medium' } })
    expect(modelOf(edited, 'gemini-3.8-flash').overrides).toBeUndefined()
    await face.save(edited)
    expect(server.saved().overrides?.['gemini-3.8-flash']?.reasoning?.defaultEffort).toBe('medium')
    const after = modelOf((await face.load()).rows[0]!, 'gemini-3.8-flash')
    expect(after.reasoning?.defaultEffort).toBe('medium')
    expect(after.overrides).toEqual({ defaultEffort: true })
  })

  it('writes no override while the catalog still matches the snapshot', async () => {
    const { face, server } = bench()
    const row = (await face.load()).rows[0]!
    await face.save(row)
    expect(server.saved().order).toEqual(['gemini-3.8-flash'])
    expect(server.saved().overrides).toBeUndefined()
  })

  it('keeps a first capability edit and a user-added row', async () => {
    const { face, server } = bench()
    const row = (await face.load()).rows[0]!
    const edited: AcpSettingsRow = { ...withModel(row, 'gemini-3.8-flash', { vision: true }), models: [...withModel(row, 'gemini-3.8-flash', { vision: true }).models, { id: 'custom-model', name: 'Custom Model' }] }
    await face.save(edited)
    expect(server.saved().overrides?.['gemini-3.8-flash']?.vision).toBe(true)
    expect(server.saved().overrides?.['custom-model']?.name).toBe('Custom Model')
    const after = (await face.load()).rows[0]!
    expect(modelOf(after, 'gemini-3.8-flash').vision).toBe(true)
    expect(after.models.map(model => model.id)).toContain('custom-model')
  })
})

describe('catalogOverrideFlags', () => {
  it('names only the fields that differ from the baseline', () => {
    const baseline: AcpCatalogModel = { id: 'a', name: 'A', vision: true, contextWindow: 100, maxOutputTokens: 10, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }
    expect(catalogOverrideFlags(baseline, baseline)).toBeUndefined()
    expect(catalogOverrideFlags({ ...baseline, name: 'B' }, baseline)).toEqual({ name: true })
    expect(catalogOverrideFlags({ ...baseline, vision: false, thinking: true }, baseline)).toEqual({ vision: true, thinking: true })
    expect(catalogOverrideFlags({ ...baseline, contextWindow: 200, maxOutputTokens: 20 }, baseline)).toEqual({ contextWindow: true, output: true })
    expect(catalogOverrideFlags({ ...baseline, reasoning: { efforts: baseline.reasoning!.efforts, defaultEffort: 'low' } }, baseline)).toEqual({ defaultEffort: true })
    expect(catalogOverrideFlags({ ...baseline, overrides: { name: true } }, baseline)).toEqual({ name: true })
  })

  it('treats every field of a row the snapshot does not carry as an edit', () => {
    expect(catalogOverrideFlags({ id: 'custom', name: 'Custom', vision: true }, undefined)).toEqual({ name: true, vision: true })
    expect(catalogOverrideFlags({ id: 'custom', name: 'Custom' }, undefined)).toEqual({ name: true })
  })
})
