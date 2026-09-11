import { describe, expect, it } from 'vitest'
import { mergeCatalogGroups, overlayDirectory, type OverlayDirectory } from '../src/web/catalog-overlay.js'

const llm = { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v3', name: 'V3' }] }
const agy = { id: 'antigravity', name: 'Antigravity', models: [{ id: 'gemini', name: 'Gemini' }] }

describe('official directory overlay', () => {
  it('merges extra groups into load() for the /model popup', async () => {
    let snapshot = { current: { provider: 'deepseek', model: 'v3' }, routable: true, groups: [llm], failures: [] as unknown[], status: 'ready', error: null as string | null }
    const inner: OverlayDirectory = {
      load: async () => ({ current: snapshot.current, routable: true, groups: snapshot.groups, failures: snapshot.failures }),
      select: async () => { throw new Error('llm select should not run') },
      store: {
        getSnapshot: () => snapshot,
        update: fn => { fn(snapshot) },
      },
    }
    const over = overlayDirectory(inner, async () => [agy])
    const loaded = await over.load()
    expect(loaded.groups.map(group => group.id)).toEqual(['deepseek', 'antigravity'])
    await over.select({ provider: 'antigravity', model: 'gemini' })
    expect(snapshot.current).toEqual({ provider: 'antigravity', model: 'gemini' })
  })

  it('does not duplicate ids', () => {
    expect(mergeCatalogGroups([llm, agy], [agy]).map(group => group.id)).toEqual(['deepseek', 'antigravity'])
  })
})
