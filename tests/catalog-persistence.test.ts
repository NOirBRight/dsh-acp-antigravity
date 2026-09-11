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
import { catalogOverrideFlags, patchedOverrideFlags } from '../src/web/settings-state.ts'

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
    // Every row already carries a default level, and saving untouched still stores none.
    expect(row.models.every(model => model.reasoning?.defaultEffort !== undefined)).toBe(true)
    await face.save(row)
    expect(server.saved().order).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash'])
    expect(server.saved().overrides).toBeUndefined()
  })

  it('serves a default level for a model with no discovery and no override, without storing one', async () => {
    const { face, server } = bench()
    const row = (await face.load()).rows[0]!
    const preset = modelOf(row, 'gemini-3.7-flash')
    expect(preset.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium', 'low'])
    expect(preset.reasoning?.defaultEffort).toBe('high')
    expect(preset.overrides).toBeUndefined()
    expect(preset.sources?.defaultEffort).toBeUndefined()
    await face.save(row)
    expect(server.saved().overrides).toBeUndefined()
    expect(modelOf((await face.load()).rows[0]!, 'gemini-3.7-flash').reasoning?.defaultEffort).toBe('high')
  })

  it('keeps a stored level the user set back to the preset value through a later save', async () => {
    const { face, server } = bench()
    let row = (await face.load()).rows[0]!
    const level = (id: string) => modelOf(row, id).reasoning!.defaultEffort
    expect(level('gemini-3.8-flash')).toBe('high')
    await face.save(withModel(row, 'gemini-3.8-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.8-flash').reasoning!.efforts, defaultEffort: 'medium' } }))
    row = (await face.load()).rows[0]!
    expect(level('gemini-3.8-flash')).toBe('medium')
    // Back to the value the catalog already presets: equal to the composed default,
    // yet still the user's stored choice, so the snapshot must keep flagging it.
    await face.save(withModel(row, 'gemini-3.8-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.8-flash').reasoning!.efforts, defaultEffort: 'high' } }))
    row = (await face.load()).rows[0]!
    expect(level('gemini-3.8-flash')).toBe('high')
    expect(modelOf(row, 'gemini-3.8-flash').overrides).toEqual({ defaultEffort: true })
    // A later untouched save must not drop it, the fix4 promise.
    await face.save(row)
    expect(server.saved().overrides?.['gemini-3.8-flash']?.reasoning?.defaultEffort).toBe('high')
    expect(modelOf((await face.load()).rows[0]!, 'gemini-3.8-flash').overrides).toEqual({ defaultEffort: true })
  })

  it('lets a saved level replace the preset, and restoring the field returns to the preset', async () => {
    const { face, server } = bench()
    let row = (await face.load()).rows[0]!
    await face.save(withModel(row, 'gemini-3.7-flash', { reasoning: { efforts: modelOf(row, 'gemini-3.7-flash').reasoning!.efforts, defaultEffort: 'low' } }))
    expect(server.saved().overrides?.['gemini-3.7-flash']?.reasoning?.defaultEffort).toBe('low')
    expect(server.saved().overrides?.['gemini-3.8-flash']).toBeUndefined()
    row = (await face.load()).rows[0]!
    expect(modelOf(row, 'gemini-3.7-flash').reasoning?.defaultEffort).toBe('low')
    const restored = withModel(row, 'gemini-3.7-flash', { overrides: { defaultEffort: false } })
    await face.save(restored)
    expect(server.saved().overrides?.['gemini-3.7-flash']).toBeUndefined()
    const after = modelOf((await face.load()).rows[0]!, 'gemini-3.7-flash')
    expect(after.reasoning?.defaultEffort).toBe('high')
    expect(after.overrides).toBeUndefined()
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

describe('patchedOverrideFlags', () => {
  it('marks the fields one editor patch set, and nothing else', () => {
    expect(patchedOverrideFlags({})).toBeUndefined()
    expect(patchedOverrideFlags({ contextWindow: '200000' })).toEqual({ contextWindow: true })
    expect(patchedOverrideFlags({ name: 'Fast', thinking: false })).toEqual({ name: true, thinking: true })
    // Clearing a field removes it, so there is no user value left to store.
    expect(patchedOverrideFlags({ vision: undefined, efforts: [] })).toBeUndefined()
    // The card edits these fields only; an id change is membership, not a flag.
    expect(patchedOverrideFlags({ id: 'other' })).toBeUndefined()
  })

  it('feeds a row the snapshot does not carry, so an edit survives the save', () => {
    const adopted: AcpCatalogModel = {
      id: 'gemini-3.6-flash',
      name: 'Gemini 3.6 Flash',
      contextWindow: 1048576,
      sources: { contextWindow: 'models.dev' },
    }
    const flags = patchedOverrideFlags({ contextWindow: '200000' })
    if (flags === undefined) throw new Error('the patch set a field')
    expect(catalogOverrideFlags({ ...adopted, contextWindow: 200000, overrides: flags }, undefined)).toEqual({ name: true, contextWindow: true })
  })
})

describe('catalogOverrideFlags', () => {
  const baseline: AcpCatalogModel = { id: 'a', name: 'A', vision: true, contextWindow: 100, maxOutputTokens: 10, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }

  it('names the fields the row changed since the baseline', () => {
    expect(catalogOverrideFlags(baseline, baseline)).toBeUndefined()
    expect(catalogOverrideFlags({ ...baseline, name: 'B' }, baseline)).toEqual({ name: true })
    expect(catalogOverrideFlags({ ...baseline, vision: false, thinking: true }, baseline)).toEqual({ vision: true, thinking: true })
    expect(catalogOverrideFlags({ ...baseline, contextWindow: 200, maxOutputTokens: 20 }, baseline)).toEqual({ contextWindow: true, output: true })
    expect(catalogOverrideFlags({ ...baseline, reasoning: { efforts: baseline.reasoning!.efforts, defaultEffort: 'low' } }, baseline)).toEqual({ defaultEffort: true })
  })

  it('reads the three override states as stored, restored, and untouched', () => {
    // Absent: untouched, so only a real difference stores the field.
    expect(catalogOverrideFlags({ ...baseline, overrides: {} }, baseline)).toBeUndefined()
    // True: stored already, so an untouched row carries it forward.
    const stored = { ...baseline, overrides: { defaultEffort: true, vision: true } }
    expect(catalogOverrideFlags(stored, stored)).toEqual({ defaultEffort: true, vision: true })
    const { overrides: _lost, ...withoutFlags } = stored
    expect(catalogOverrideFlags(withoutFlags, stored)).toEqual({ defaultEffort: true, vision: true })
    // True that the snapshot does not corroborate stores nothing: a client flag is not storage.
    expect(catalogOverrideFlags({ ...baseline, overrides: { name: true } }, baseline)).toBeUndefined()
    // False: restored, so the field is dropped even though the snapshot stores it.
    expect(catalogOverrideFlags({ ...stored, overrides: { defaultEffort: false, vision: true } }, stored)).toEqual({ vision: true })
  })

  it('stores only what a new row itself carries when discovery supplied nothing', () => {
    expect(catalogOverrideFlags({ id: 'custom', name: 'Custom' }, undefined)).toEqual({ name: true })
    expect(catalogOverrideFlags({ id: 'custom', name: 'Custom', vision: true }, undefined)).toEqual({ name: true, vision: true })
  })

  it('never freezes the discovery facts an adopted row was built from', () => {
    // "Fetch models" composes rows from discovery; adopting one the saved membership
    // excluded adds a row the snapshot lacks, and its sourced values are not user edits.
    const adopted: AcpCatalogModel = {
      id: 'gemini-3.6-flash',
      name: 'Gemini 3.6 Flash',
      vision: true,
      thinking: true,
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
      sources: { vision: 'upstream', thinking: 'upstream', contextWindow: 'models.dev', maxOutputTokens: 'upstream', defaultEffort: 'upstream' },
    }
    expect(catalogOverrideFlags(adopted, undefined)).toEqual({ name: true })
    // A field the editor patched carries its flag, so the user's edit is stored.
    expect(catalogOverrideFlags({ ...adopted, contextWindow: 200000, overrides: { contextWindow: true } }, undefined)).toEqual({ name: true, contextWindow: true })
    // An unsourced value on the same row is hand-authored and needs no flag.
    const { contextWindow: _sourced, ...otherSources } = adopted.sources!
    expect(catalogOverrideFlags({ ...adopted, sources: otherSources, contextWindow: 200000 }, undefined)).toEqual({ name: true, contextWindow: true })
  })
})
