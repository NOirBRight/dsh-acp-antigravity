import { optionId, type ExternalAgentPermissionRequest, type ExternalAgentTurnHost, type ExternalAgentUserInputRequest } from '@deepseek-ai/dsh-acp-provider'
import { createAntigravityFilesystemHandler } from './filesystem.js'
import type { AcpRequestHandler } from './protocol.js'
import type { AntigravityClientFilesystem } from './types.js'

/** Build ACP server-request handling from one turn-scoped DSH host. */
export function createAntigravityInteractionHandler(host: ExternalAgentTurnHost, filesystem?: AntigravityClientFilesystem): AcpRequestHandler {
  const fileHandler = filesystem === undefined ? undefined : createAntigravityFilesystemHandler(filesystem)
  let sequence = 0
  return async (method, params, id) => {
    const requestKey = interactionRequestId(params, id, ++sequence)
    if (method === 'session/request_permission') { const request = parsePermissionRequest(params, requestKey); return permissionResponse(await host.requestPermission(request), request) }
    if (method === 'session/request_user_input' || method === 'elicitation/create') return questionResponse(await host.requestUserInput(parseQuestionRequest(params, requestKey)))
    if (method.startsWith('interaction_') || method.startsWith('interaction/')) {
      if (method.includes('permission')) { const request = parsePermissionRequest(params, requestKey); return permissionResponse(await host.requestPermission(request), request) }
      return questionResponse(await host.requestUserInput(parseQuestionRequest(params, requestKey)))
    }
    if (method.startsWith('terminal/')) throw new Error('Antigravity terminal capability is disabled')
    if ((method === 'fs/read_text_file' || method === 'fs/write_text_file') && fileHandler !== undefined) return fileHandler(method, params, id)
    throw new Error('Antigravity client method is unavailable: ' + method)
  }
}

function parsePermissionRequest(params: unknown, id: string): ExternalAgentPermissionRequest {
  if (!isRecord(params) || !Array.isArray(params.options)) throw new Error('Antigravity permission request is malformed')
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
  const toolName = stringValue(toolCall.title) ?? stringValue(toolCall.name) ?? stringValue(toolCall.kind) ?? 'native tool'
  const reason = stringValue(toolCall.rawInput) ?? stringValue(toolCall.input) ?? 'Antigravity requested permission for a native action.'
  const options = params.options.map(value => {
    if (!isRecord(value)) throw new Error('Antigravity permission option is malformed')
    const native = stringValue(value.optionId)
    const kind = permissionKind(value.kind)
    const label = stringValue(value.name) ?? kind
    const scope: 'session' | 'thread' | undefined = value.scope === 'session' || value.scope === 'thread' ? value.scope : undefined
    if (native === undefined) throw new Error('Antigravity permission option has no optionId')
    return { optionId: optionId(native), kind, label, ...(scope === undefined ? {} : { scope }) }
  })
  if (options.length === 0) throw new Error('Antigravity permission request has no options')
  const warning = securityWarning(params)
  return {
    requestId: optionId(String(id)),
    toolName,
    reason,
    options,
    ...(warning === undefined ? {} : { securityWarning: { message: warning } }),
  }
}

function parseQuestionRequest(params: unknown, id: string): ExternalAgentUserInputRequest {
  if (!isRecord(params)) throw new Error('Antigravity user question is malformed')
  const question = stringValue(params.question) ?? stringValue(params.message) ?? stringValue(params.prompt)
  if (question === undefined) throw new Error('Antigravity user question has no text')
  const rawOptions = Array.isArray(params.options) ? params.options : undefined
  const options = rawOptions?.map(value => typeof value === 'string' ? value : isRecord(value) ? stringValue(value.label) ?? stringValue(value.name) ?? '' : '').filter(value => value.length > 0)
  return {
    requestId: optionId(String(id)),
    question,
    ...(options === undefined || options.length === 0 ? {} : { options }),
    ...(typeof params.multiple === 'boolean' ? { multiple: params.multiple } : {}),
  }
}

function interactionRequestId(params: unknown, id: number | string, sequence: number): string {
  if (isRecord(params)) {
    const explicit = params.requestId
    if (typeof explicit === 'string' || typeof explicit === 'number') return String(explicit)
    const session = stringValue(params.sessionId)
    const toolCall = isRecord(params.toolCall) ? params.toolCall : undefined
    const tool = stringValue(toolCall?.toolCallId)
    if (session !== undefined || tool !== undefined) return [session ?? 'session', tool ?? 'interaction', String(sequence)].join(':')
  }
  return String(id) + ':' + String(sequence)
}

function securityWarning(params: Record<string, unknown>): string | undefined {
  const meta = isRecord(params._meta) ? params._meta : {}
  const direct = stringValue(meta['agy.security.warning'])
  if (direct !== undefined) return direct
  const agy = isRecord(meta.agy) ? meta.agy : {}
  return stringValue(agy.securityWarning) ?? stringValue(agy['security.warning'])
}

function permissionKind(value: unknown): ExternalAgentPermissionRequest['options'][number]['kind'] {
  switch (value) {
    case 'allow_once': return 'allow_once'
    case 'allow_always': return 'allow_always'
    case 'reject': case 'reject_once': case 'reject_always': return 'reject'
    case 'cancel': return 'cancel'
    default: throw new Error('Antigravity permission option kind is unsupported')
  }
}

function permissionResponse(decision: Awaited<ReturnType<ExternalAgentTurnHost['requestPermission']>>, request: ExternalAgentPermissionRequest): { readonly outcome: Record<string, string> } {
  const selected = decision.optionId === undefined ? undefined : request.options.find(option => option.optionId === decision.optionId)
  if (decision.kind === 'allow-once' || decision.kind === 'allowed-for-session') {
    const expected = decision.kind === 'allow-once' ? 'allow_once' : 'allow_always'
    if (selected === undefined || selected.kind !== expected || expected === 'allow_always' && selected.scope === undefined) throw new Error('Antigravity host returned an unoffered permission option')
    return { outcome: { outcome: 'selected', optionId: String(selected.optionId) } }
  }
  if (selected !== undefined && selected.kind !== 'reject' && selected.kind !== 'cancel') throw new Error('Antigravity host returned an unoffered permission option')
  if (decision.kind === 'reject') {
    const rejection = selected ?? request.options.find(option => option.kind === 'reject' || option.kind === 'cancel')
    return rejection === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: String(rejection.optionId) } }
  }
  return selected === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: String(selected.optionId) } }
}

function questionResponse(answer: Awaited<ReturnType<ExternalAgentTurnHost['requestUserInput']>>): { readonly answer: string; readonly answers: readonly string[] } {
  const answers = [...answer.answers]
  return { answer: answers[0] ?? '', answers }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
