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
  { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash (Low)' },
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

  it('keeps two stored overrides when the user saves again without changing anything', async () => {
    const { face, server } = bench()
    let row = (await face.load()).rows[0]!
    const effortsOf = (id: string) => modelOf(row, id).reasoning!.efforts
    await face.save({
      ...row,
      models: row.models.map(model => model.id === 'gemini-3.8-flash'
        ? { ...model, reasoning: { efforts: effortsOf('gemini-3.8-flash'), defaultEffort: 'medium' } }
        : model.id === 'gemini-3.7-flash' ? { ...model, reasoning: { efforts: effortsOf('gemini-3.7-flash'), defaultEffort: 'low' } } : model),
    })
    expect(server.saved().overrides?.['gemini-3.8-flash']?.reasoning?.defaultEffort).toBe('medium')
    expect(server.saved().overrides?.['gemini-3.7-flash']?.reasoning?.defaultEffort).toBe('low')
    // The next save is the card's untouched draft: same values, same order, nothing edited.
    row = (await face.load()).rows[0]!
    expect(modelOf(row, 'gemini-3.8-flash').reasoning?.defaultEffort).toBe('medium')
    expect(modelOf(row, 'gemini-3.7-flash').reasoning?.defaultEffort).toBe('low')
    await face.save(row)
    expect(server.saved().overrides?.['gemini-3.8-flash']?.reasoning?.defaultEffort).toBe('medium')
    expect(server.saved().overrides?.['gemini-3.7-flash']?.reasoning?.defaultEffort).toBe('low')
    expect(server.saved().overrides?.['gemini-3.6-flash']).toBeUndefined()
    const after = (await face.load()).rows[0]!
    expect(modelOf(after, 'gemini-3.8-flash').reasoning?.defaultEffort).toBe('medium')
    expect(modelOf(after, 'gemini-3.7-flash').reasoning?.defaultEffort).toBe('low')
  })

  it('keeps a stored override when the draft carries no flags at all', async () => {
    const { face, server } = bench()
    let row = (await face.load()).rows[0]!
    await face.save(withModel(row, 'gemini-3.8-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.8-flash').reasoning!.efforts, defaultEffort: 'medium' } }))
    row = (await face.load()).rows[0]!
    expect(modelOf(row, 'gemini-3.8-flash').overrides).toEqual({ defaultEffort: true })
    // Any editor or transport that does not round-trip the row's flags must still not
    // drop what the previous save stored: the snapshot baseline owns that knowledge.
    const stripFlags = (model: AcpCatalogModel): AcpCatalogModel => {
      const { overrides: _dropped, ...rest } = model
      return rest
    }
    await face.save({ ...row, models: row.models.map(stripFlags) })
    expect(server.saved().overrides?.['gemini-3.8-flash']?.reasoning?.defaultEffort).toBe('medium')
    expect(modelOf((await face.load()).rows[0]!, 'gemini-3.8-flash').reasoning?.defaultEffort).toBe('medium')
  })

  it('replaces the whole override set when a payload omits catalogOverrides', async () => {
    const { face, server } = bench()
    let row = (await face.load()).rows[0]!
    await face.save(withModel(row, 'gemini-3.8-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.8-flash').reasoning!.efforts, defaultEffort: 'medium' } }))
    expect(server.saved().overrides?.['gemini-3.8-flash']).toBeDefined()
    // The endpoint stores the payload's override set as given: a client that sends
    // none clears them, which is why the card must always send every stored one.
    const { catalogOverrides: _dropped, ...withoutOverrides } = server.snapshot() as unknown as Record<string, unknown>
    server.save({ ...withoutOverrides, executablePath: row.executablePath, harnessPath: row.harnessPath, stateDirectory: row.stateDirectory, instanceId: row.instanceId, enabled: row.enabled, catalogOrder: row.models.map(model => model.id) })
    expect(server.saved().overrides).toBeUndefined()
    expect(modelOf((await face.load()).rows[0]!, 'gemini-3.8-flash').reasoning?.defaultEffort).toBe('high')
  })

  it('clears the override when the user restores the field to its discovered value', async () => {
    const { face, server } = bench()
    let row = (await face.load()).rows[0]!
    await face.save(withModel(row, 'gemini-3.8-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.8-flash').reasoning!.efforts, defaultEffort: 'medium' } }))
    row = (await face.load()).rows[0]!
    expect(modelOf(row, 'gemini-3.8-flash').overrides).toEqual({ defaultEffort: true })
    // The editor's Restore action marks the field cleared; the value still reads medium
    // until the recomposed snapshot arrives.
    const restored = withModel(row, 'gemini-3.8-flash', { overrides: { defaultEffort: false } })
    await face.save(restored)
    expect(server.saved().overrides?.['gemini-3.8-flash']).toBeUndefined()
    const after = modelOf((await face.load()).rows[0]!, 'gemini-3.8-flash')
    expect(after.reasoning?.defaultEffort).toBe('high')
    expect(after.overrides).toBeUndefined()
  })

  it('writes no override while the catalog still matches the snapshot', async () => {
    const { face, server } = bench()
    const row = (await face.load()).rows[0]!
    await face.save(row)
    expect(server.saved().order).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash'])
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
    // A flag the baseline does not corroborate, on a value equal to the baseline, stores nothing.
    expect(catalogOverrideFlags({ ...baseline, overrides: { name: true } }, baseline)).toBeUndefined()
    // A field the baseline already stores survives an untouched row and a lost flag alike.
    const stored = { ...baseline, overrides: { defaultEffort: true, vision: true } }
    expect(catalogOverrideFlags(stored, stored)).toEqual({ defaultEffort: true, vision: true })
    const { overrides: _lost, ...withoutFlags } = stored
    expect(catalogOverrideFlags(withoutFlags, stored)).toEqual({ defaultEffort: true, vision: true })
  })

  it('treats every field of a row the snapshot does not carry as an edit', () => {
    expect(catalogOverrideFlags({ id: 'custom', name: 'Custom', vision: true }, undefined)).toEqual({ name: true, vision: true })
    expect(catalogOverrideFlags({ id: 'custom', name: 'Custom' }, undefined)).toEqual({ name: true })
  })
})
