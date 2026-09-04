import { HostExpiredError, TurnAbortedError, UnscopedAllowAlwaysError, optionId, type ExternalAgentPermissionRequest, type ExternalAgentTurnHost, type ExternalAgentUserInputRequest } from '@deepseek-ai/dsh-acp-provider'
import { isRecord, stringValue } from './decode.js'
import { createAntigravityFilesystemHandler } from './filesystem.js'
import type { AcpRequestHandler } from './protocol.js'
import type { AntigravityClientFilesystem } from './types.js'

/** Build ACP server-request handling from one turn-scoped DSH host. */
export function createAntigravityInteractionHandler(host: ExternalAgentTurnHost, filesystem?: AntigravityClientFilesystem): AcpRequestHandler {
  const fileHandler = filesystem === undefined ? undefined : createAntigravityFilesystemHandler(filesystem, host.signal)
  let sequence = 0
  return async (method, params, id) => {
    const currentSequence = ++sequence
    const requestKey = interactionRequestId(params, id, currentSequence)
    if (method === 'session/request_permission') {
      if (isInteractionQuestion(params)) return handleInteractionQuestion(host, params, String(id) + ':' + String(currentSequence))
      return handlePermission(host, params, requestKey)
    }
    if (method === 'session/request_user_input' || method === 'elicitation/create') return questionResponse(await host.requestUserInput(parseQuestionRequest(params, requestKey)))
    if (method.startsWith('interaction_') || method.startsWith('interaction/')) {
      if (method.includes('permission')) return handlePermission(host, params, requestKey)
      return questionResponse(await host.requestUserInput(parseQuestionRequest(params, requestKey)))
    }
    if (method.startsWith('terminal/')) throw new Error('Antigravity terminal capability is disabled')
    if ((method === 'fs/read_text_file' || method === 'fs/write_text_file') && fileHandler !== undefined) return fileHandler(method, params, id)
    throw new Error('Antigravity client method is unavailable: ' + method)
  }
}

function isInteractionAbort(error: unknown): boolean { return error instanceof TurnAbortedError || error instanceof HostExpiredError || error instanceof DOMException && error.name === 'AbortError' }

function isInteractionQuestion(params: unknown): boolean {
  if (!isRecord(params) || !isRecord(params.toolCall)) return false
  return stringValue(params.toolCall.toolCallId)?.startsWith('interaction_') === true
}

async function handleInteractionQuestion(host: ExternalAgentTurnHost, params: unknown, id: string): Promise<unknown> {
  if (!isRecord(params) || !isRecord(params.toolCall) || !Array.isArray(params.options) || params.options.length === 0) throw new Error('Antigravity user question is malformed')
  const options = params.options.map(value => {
    if (!isRecord(value)) throw new Error('Antigravity user question option is malformed')
    const native = stringValue(value.optionId)
    if (native === undefined || native.trim() === '') throw new Error('Antigravity user question option has no optionId')
    return { native, label: stringValue(value.name)?.trim() || native }
  })
  if (new Set(options.map(option => option.native)).size !== options.length) throw new Error('Antigravity user question option IDs must be unique')
  let answer: Awaited<ReturnType<ExternalAgentTurnHost['requestUserInput']>>
  try {
    answer = await host.requestUserInput({ requestId: optionId(id), question: stringValue(params.toolCall.title)?.trim() || 'Choose an option.', options: options.map(option => option.label), multiple: false })
  } catch (error) {
    if (isInteractionAbort(error)) return { outcome: { outcome: 'cancelled' } }
    throw error
  }
  if (answer.answers.length !== 1) return { outcome: { outcome: 'cancelled' } }
  const exact = options.find(option => option.native === answer.answers[0])
  const matchingLabels = options.filter(option => option.label === answer.answers[0])
  const selected = exact ?? (matchingLabels.length === 1 ? matchingLabels[0] : undefined)
  if (selected === undefined) throw new Error('Antigravity user question answer is unavailable')
  return { outcome: { outcome: 'selected', optionId: selected.native } }
}

async function handlePermission(host: ExternalAgentTurnHost, params: unknown, id: string): Promise<unknown> {
  const request = parsePermissionRequest(params, id)
  try { return permissionResponse(await host.requestPermission(request), request) } catch (error) {
    if (isInteractionAbort(error)) return { outcome: { outcome: 'cancelled' } }
    throw error
  }
}

function parsePermissionRequest(params: unknown, id: string): ExternalAgentPermissionRequest {
  if (!isRecord(params) || !Array.isArray(params.options)) throw new Error('Antigravity permission request is malformed')
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
  const toolName = stringValue(toolCall.title) ?? stringValue(toolCall.name) ?? stringValue(toolCall.kind) ?? 'native tool'
  const reason = stringValue(toolCall.rawInput) ?? stringValue(toolCall.input) ?? 'Antigravity requested permission for a native action.'
  const requestScope: 'session' | 'thread' | undefined = stringValue(params.threadId) === undefined ? stringValue(params.sessionId) === undefined ? undefined : 'session' : 'thread'
  const options = params.options.map(value => {
    if (!isRecord(value)) throw new Error('Antigravity permission option is malformed')
    const native = stringValue(value.optionId)
    const kind = permissionKind(value.kind)
    const label = stringValue(value.name)?.trim() || kind
    const scope: 'session' | 'thread' | undefined = value.scope === 'session' || value.scope === 'thread' ? value.scope : kind === 'allow_always' ? requestScope : undefined
    if (native === undefined || native.trim() === '') throw new Error('Antigravity permission option has no optionId')
    if (kind === 'allow_always' && scope === undefined) throw new UnscopedAllowAlwaysError()
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
  for (const value of Array.isArray(params.options) ? params.options : []) {
    if (isRecord(value)) {
      const warning = warningFromMeta(value._meta)
      if (warning !== undefined) return warning
    }
  }
  return warningFromMeta(params._meta)
}

function warningFromMeta(value: unknown): string | undefined {
  const meta = isRecord(value) ? value : {}
  const direct = meta['agy.security.warning']
  if (isRecord(direct)) return stringValue(direct.message) ?? stringValue(direct.title)
  if (typeof direct === 'string') return stringValue(direct)
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
  if (decision.kind === 'reject') {
    const rejection = selected ?? request.options.find(option => option.kind === 'reject')
    if (rejection === undefined) throw new Error('Antigravity offered no native reject option')
    if (rejection.kind !== 'reject') throw new Error('Antigravity host returned an unoffered permission option')
    return { outcome: { outcome: 'selected', optionId: String(rejection.optionId) } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

function questionResponse(answer: Awaited<ReturnType<ExternalAgentTurnHost['requestUserInput']>>): { readonly answer: string; readonly answers: readonly string[] } {
  const answers = [...answer.answers]
  return { answer: answers[0] ?? '', answers }
}
