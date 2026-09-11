/** Attach CCPA and models.dev facts to ACP-available native ids only. */
import type { CcpaModelList } from './ccpa-models.js'
import { mergeModelFacts, type ModelFacts } from './model-metadata.js'

/** Keep only ACP-listed ids; CCPA-only models stay out.
 * @param native ACP catalog rows.
 * @param ccpa optional CCPA projection.
 * @param overlay models.dev facts keyed by native id.
 * @returns facts for native ids only.
 */
export function enrichNativeCatalog(
  native: readonly { readonly id: string; readonly name: string }[],
  ccpa: CcpaModelList | undefined,
  overlay: ReadonlyMap<string, Partial<ModelFacts>>,
): Map<string, ModelFacts> {
  const upstream = new Map((ccpa?.models ?? []).map(model => [model.id, model.facts]))
  const facts = new Map<string, ModelFacts>()
  for (const model of native) {
    facts.set(model.id, mergeModelFacts(upstream.get(model.id) ?? {}, overlay.get(model.id)))
  }
  return facts
}
