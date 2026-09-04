import {
  boundExternalAgentEvent,
  modelId,
  toolId,
  type ExternalAgentEvent,
  type ExternalAgentModel,
  type ExternalAgentPermissionMode,
} from '@deepseek-ai/dsh-acp-provider'
import { isRecord, stringValue } from './decode.js'
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ANTIGRAVITY_PERMISSION_MODES,
  type AntigravityIdentity,
  type AntigravityNativeMode,
} from './types.js'

/** Map the public permission policy to Antigravity's native value. */
export function mapPermissionMode(mode: ExternalAgentPermissionMode): AntigravityNativeMode {
  switch (mode) {
    case 'approval-required': return 'default'
    case 'auto-accept-edits': return 'auto_edit'
    case 'full-access': return 'yolo'
  }
}

/** Return the modes advertised by this provider. */
export function supportedPermissionModes(): readonly ExternalAgentPermissionMode[] { return ANTIGRAVITY_PERMISSION_MODES }

/** Parse grouped or flat ACP model configuration options. */
export function parseAntigravityModels(value: unknown): readonly ExternalAgentModel[] {
  const found = new Map<string, ExternalAgentModel>()
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 4 || found.size >= 256) return
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1)
      return
    }
    if (!isRecord(candidate)) return
    const id = stringValue(candidate.value) ?? stringValue(candidate.modelId) ?? stringValue(candidate.id)
    const name = stringValue(candidate.name) ?? stringValue(candidate.label) ?? id
    const description = stringValue(candidate.description)
    if (id && name && id !== 'model' && id !== 'mode' && id !== 'permission') {
      found.set(id, { id: modelId(id), name, ...(description === undefined ? {} : { description }), supportedModes: supportedPermissionModes() })
    }
    for (const key of ['options', 'values', 'groups', 'configOptions']) {
      const nested = candidate[key]
      if (nested !== undefined) visit(nested, depth + 1)
    }
  }
  visit(value, 0)
  const explicit = [...found.values()].filter(model => model.id !== modelId('mode') && model.id !== modelId('permission'))
  return [{ id: modelId(ANTIGRAVITY_DEFAULT_MODEL), name: 'Account default', supportedModes: supportedPermissionModes() }, ...explicit.filter(model => model.id !== modelId(ANTIGRAVITY_DEFAULT_MODEL))]
}

/** Resolve a saved model without substituting another account model. */
export function resolveAntigravityModel(selected: string | undefined, models: readonly ExternalAgentModel[]): ExternalAgentModel {
  const requested = selected ?? ANTIGRAVITY_DEFAULT_MODEL
  const found = models.find(model => model.id === requested)
  if (!found) throw new Error('Antigravity model is unavailable: ' + requested)
  return found
}

/** Validate the negotiated protocol identity and required client-facing capabilities. */
export function validateAntigravityIdentity(response: unknown): AntigravityIdentity {
  if (!isRecord(response)) throw new Error('Antigravity initialize response is malformed')
  if (response.protocolVersion !== 1) throw new Error('Antigravity ACP protocol version is unsupported')
  const agentInfo = isRecord(response.agentInfo) ? response.agentInfo : undefined
  const agentName = stringValue(agentInfo?.name)
  if (agentName !== 'antigravity-acp') throw new Error('ACP executable is not antigravity-acp')
  const agentVersion = stringValue(agentInfo?.version)
  if (!isRecord(response.agentCapabilities)) throw new Error('Antigravity ACP capabilities are missing')
  const capabilities = response.agentCapabilities
  const sessionCapabilities = isRecord(capabilities.sessionCapabilities) ? capabilities.sessionCapabilities : {}
  const resumeMethod: 'resume' | 'load' | undefined = sessionCapabilities.resume === true || isRecord(sessionCapabilities.resume) || capabilities.sessionResume === true || capabilities.resumeSession === true ? 'resume' : capabilities.loadSession === true ? 'load' : undefined
  if (resumeMethod === undefined) throw new Error('Antigravity ACP session resume capability is missing')
  return {
    protocolVersion: 1,
    agentName,
    ...(agentVersion === undefined ? {} : { agentVersion }),
    supportsResume: true,
    resumeMethod,
  }
}

/** Normalize an ACP session/update notification into one provider-neutral event. */
export function normalizeAntigravitySessionUpdate(update: unknown, bounds: { readonly maxTextBytes: number; readonly maxPayloadBytes: number }): ExternalAgentEvent | null {
  if (!isRecord(update)) throw new Error('Antigravity session update is malformed')
  const tag = stringValue(update.sessionUpdate) ?? stringValue(update.type)
  if (!tag) throw new Error('Antigravity session update has no type')
  if (tag === 'agent_message_chunk' || tag === 'assistant_message_chunk') {
    const text = extractText(update.content)
    if (text === undefined) throw new Error('Antigravity message chunk has no text')
    return boundExternalAgentEvent({ type: 'assistant-delta', text }, bounds)
  }
  if (tag === 'agent_thought_chunk' || tag === 'thought_chunk') {
    const text = extractText(update.content)
    if (text === undefined) throw new Error('Antigravity thought chunk has no text')
    return boundExternalAgentEvent({ type: 'thought-delta', text }, bounds)
  }
  if (tag === 'tool_call' || tag === 'tool_call_update') {
    const nativeToolId = stringValue(update.toolCallId) ?? stringValue(update.tool_call_id) ?? stringValue(update.id)
    const name = stringValue(update.title) ?? stringValue(update.name) ?? 'native tool'
    if (!nativeToolId) throw new Error('Antigravity tool update has no id')
    const status = normalizeToolStatus(update.status ?? update.state)
    const input = stringifyPayload(update.rawInput ?? update.input)
    const output = stringifyPayload(update.rawOutput ?? update.output)
    const error = stringValue(update.error)
    const locations = Array.isArray(update.locations) ? update.locations.filter((location): location is string => typeof location === 'string') : undefined
    return boundExternalAgentEvent({
      type: 'tool-activity', toolId: toolId(nativeToolId), name, status,
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
      ...(error === undefined ? {} : { error }),
      ...(locations === undefined ? {} : { locations }),
    }, bounds)
  }
  if (tag === 'plan' || tag === 'plan_update') {
    const entries = Array.isArray(update.entries) ? update.entries : Array.isArray(update.steps) ? update.steps : []
    const steps = entries.map(entry => typeof entry === 'string' ? entry : isRecord(entry) ? stringValue(entry.content) ?? stringValue(entry.title) ?? '' : '').filter(step => step.length > 0)
    const summary = stringValue(update.summary) ?? stringValue(update.title) ?? 'Plan updated'
    return boundExternalAgentEvent({ type: 'plan-update', summary, steps }, bounds)
  }
  if (tag === 'usage_update' || tag === 'usage') {
    const inputTokens = numberValue(update.inputTokens ?? update.input_tokens)
    const outputTokens = numberValue(update.outputTokens ?? update.output_tokens)
    return { type: 'usage', ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) }
  }
  if (tag === 'current_mode_update' || tag === 'config_option_update' || tag === 'session_info_update') return { type: 'notice', level: 'info', message: 'Antigravity session configuration updated' }
  if (tag === 'user_message_chunk') return null
  return null
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  return stringValue(value.text) ?? stringValue(value.value)
}

function stringifyPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return '[unserializable payload]' }
}

function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined }

function normalizeToolStatus(value: unknown): 'pending' | 'running' | 'completed' | 'failed' {
  switch (value) {
    case 'pending': case 'queued': return 'pending'
    case 'running': case 'in_progress': case 'executing': return 'running'
    case 'completed': case 'complete': case 'success': return 'completed'
    case 'failed': case 'error': return 'failed'
    default: return 'running'
  }
}
