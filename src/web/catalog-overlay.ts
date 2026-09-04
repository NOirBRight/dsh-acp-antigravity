/** Overlay ready External Agent groups onto a ModelDirectory instance. */
import { ACP_SETTINGS_RPC_CHANNEL, CATALOG_ENDPOINT } from '../client-contract.js'

export interface CatalogGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
}

export interface DirectorySnapshot {
  current: { provider: string; model: string; reasoningEffort?: string } | null
  routable: boolean | null
  groups: CatalogGroup[]
  failures: unknown[]
  status: string
  error: string | null
}

export interface OverlayDirectory {
  load(): Promise<{ current: DirectorySnapshot['current']; routable: boolean; groups: CatalogGroup[]; failures: unknown[] }>
  select(selection: { provider: string; model: string; reasoningEffort?: string }): Promise<void>
  store: {
    getSnapshot(): DirectorySnapshot
    update(fn: (state: DirectorySnapshot) => void): void
  }
}

export function mergeCatalogGroups(base: readonly CatalogGroup[], extra: readonly CatalogGroup[]): CatalogGroup[] {
  if (extra.length === 0) return base as CatalogGroup[]
  const ids = new Set(extra.map(group => group.id))
  return [...base.filter(group => !ids.has(group.id)), ...extra]
}

/** Patch load/select so /model and the composer seat see the same extra groups. */
export function overlayDirectory(inner: OverlayDirectory, fetchCatalog: () => Promise<readonly CatalogGroup[]>): OverlayDirectory {
  const origLoad = inner.load.bind(inner)
  const origSelect = inner.select.bind(inner)
  let extra: readonly CatalogGroup[] = []
  inner.load = async () => {
    const value = await origLoad()
    extra = await fetchCatalog()
    const groups = mergeCatalogGroups(value.groups, extra)
    inner.store.update(state => { state.groups = groups })
    return { ...value, groups }
  }
  inner.select = async selection => {
    if (extra.some(group => group.id === selection.provider)) {
      inner.store.update(state => {
        state.current = selection
        state.routable = true
        state.status = 'ready'
        state.error = null
      })
      return
    }
    await origSelect(selection)
  }
  return inner
}

export async function fetchExternalCatalog(rpc: { call: (channel: string, endpoint: string, payload: unknown, extra: undefined) => Promise<{ ok: boolean; value?: { groups?: CatalogGroup[] } }> }): Promise<readonly CatalogGroup[]> {
  try {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, CATALOG_ENDPOINT, {}, undefined)
    return result.ok && Array.isArray(result.value?.groups) ? result.value.groups : []
  } catch {
    return []
  }
}
