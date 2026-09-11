/** Parse v1internal:fetchAvailableModels without forwarding credentials or project ids. */
import { factsFromCcpaDetails, type ModelFacts } from './model-metadata.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_./:-]{1,160}$/.test(value)
}

export interface CcpaListedModel {
  readonly id: string
  readonly displayName?: string
  readonly facts: Partial<ModelFacts>
}

export interface CcpaModelList {
  readonly models: readonly CcpaListedModel[]
  readonly agentModelIds: readonly string[]
  readonly defaultAgentModelId?: string
}

/** Decode a CCPA model list. Missing fields stay absent.
 * @param payload fetchAvailableModels JSON.
 * @returns listed models and optional default id.
 */
export function parseCcpaModelList(payload: unknown): CcpaModelList {
  if (!isRecord(payload) || !isRecord(payload.models)) throw new Error('Antigravity model list was unexpected.')
  const sorts = payload.agentModelSorts ?? []
  if (!Array.isArray(sorts)) throw new Error('Antigravity model list was unexpected.')
  const ids: string[] = []
  for (const sort of sorts) {
    if (!isRecord(sort) || !Array.isArray(sort.groups)) continue
    for (const group of sort.groups) {
      if (!isRecord(group) || !Array.isArray(group.modelIds)) continue
      for (const id of group.modelIds) {
        if (validId(id) && !ids.includes(id)) ids.push(id)
      }
    }
  }
  if (ids.length > 1024) throw new Error('Antigravity model list was unexpected.')
  const models: CcpaListedModel[] = []
  for (const [id, info] of Object.entries(payload.models)) {
    if (!validId(id) || !isRecord(info)) continue
    const displayName = typeof info.displayName === 'string' && info.displayName.length > 0 && info.displayName.length <= 200 ? info.displayName : undefined
    models.push({ id, ...(displayName === undefined ? {} : { displayName }), facts: factsFromCcpaDetails(info) })
  }
  const defaultAgentModelId = validId(payload.defaultAgentModelId) ? payload.defaultAgentModelId : undefined
  return {
    models,
    agentModelIds: ids,
    ...(defaultAgentModelId === undefined ? {} : { defaultAgentModelId }),
  }
}
