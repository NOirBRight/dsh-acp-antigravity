/** Public models.dev overlay. Exact ids only; never invents default effort. */
import { factsFromModelsDevRow, modelsDevRow, type ModelFacts } from './model-metadata.js'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const MODELS_DEV_TIMEOUT_MS = 15_000
export const MODELS_DEV_MAX_BYTES = 8 * 1024 * 1024

const SUFFIXES = ['-high', '-medium', '-low'] as const

function peelKnownEffortSuffix(id: string): string {
  for (const suffix of SUFFIXES) {
    if (id.endsWith(suffix) && id.length > suffix.length) return id.slice(0, -suffix.length)
  }
  return id
}

let cache: { document: unknown } | undefined
let inflight: Promise<unknown> | undefined

/** Drop the in-process models.dev document. */
export function clearModelsDevCache(): void {
  cache = undefined
  inflight = undefined
}

async function loadDocument(fetchFn: typeof fetch, signal?: AbortSignal, refresh = false): Promise<unknown> {
  if (!refresh && cache !== undefined) return cache.document
  if (!refresh && inflight !== undefined) return inflight
  const timeout = AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const task = (async () => {
    const response = await fetchFn(MODELS_DEV_URL, { method: 'GET', redirect: 'error', signal: combined, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('models.dev request failed')
    const text = await response.text()
    if (text.length > MODELS_DEV_MAX_BYTES) throw new Error('models.dev response too large')
    const document: unknown = JSON.parse(text)
    cache = { document }
    return document
  })()
  inflight = task
  try {
    return await task
  } catch {
    // Network, HTTP, size, or JSON failures: keep a prior document, else fail.
    if (cache !== undefined) return cache.document
    throw new Error('models.dev unavailable')
  } finally {
    if (inflight === task) inflight = undefined
  }
}

/** Look up google-antigravity, then google, using exact id then a peeled thinking suffix.
 * @param document models.dev JSON.
 * @param nativeId ACP model id.
 * @returns facts for that id, or empty.
 */
export function lookupModelsDevFacts(document: unknown, nativeId: string): Partial<ModelFacts> {
  const keys = [nativeId]
  const peeled = peelKnownEffortSuffix(nativeId)
  if (peeled !== nativeId) keys.push(peeled)
  for (const provider of ['google-antigravity', 'antigravity', 'google']) {
    for (const key of keys) {
      const row = modelsDevRow(document, provider, key)
      if (row !== undefined) return factsFromModelsDevRow(row).facts
    }
  }
  return {}
}

/** Fetch models.dev once per process. Failures do not invent empty facts.
 * @param nativeIds ACP ids to overlay.
 * @param options optional fetch, abort, and refresh.
 * @returns facts keyed by native id.
 */
export async function loadModelsDevFacts(
  nativeIds: readonly string[],
  options: { fetchFn?: typeof fetch; signal?: AbortSignal; refresh?: boolean } = {},
): Promise<ReadonlyMap<string, Partial<ModelFacts>>> {
  const document = await loadDocument(options.fetchFn ?? fetch, options.signal, options.refresh === true)
  const overlay = new Map<string, Partial<ModelFacts>>()
  for (const id of nativeIds) overlay.set(id, lookupModelsDevFacts(document, id))
  return overlay
}
