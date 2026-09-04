import {
  resumeCursor,
  sessionId,
  truncateUtf8,
  withBoundedExternalAgentHost,
  type ExternalAgentAttachment,
  type ExternalAgentOpenRequest,
  type ExternalAgentProvider,
  type ExternalAgentSession,
  type ExternalAgentSessionId,
  type ExternalAgentSessionRef,
  type ExternalAgentTurnHost,
  type ExternalAgentTurnRequest,
  type ExternalAgentTurnResult,
} from '@deepseek-ai/dsh-acp-provider'
import { redactAntigravityText } from './auth.js'
import { errorMessage, isRecord, stringValue } from './decode.js'
import { createAntigravityInteractionHandler } from './interaction.js'
import { mapPermissionMode, normalizeAntigravitySessionUpdate } from './mapping.js'
import type { AcpConnection } from './protocol.js'
import { ANTIGRAVITY_PERMISSION_MODES, type AntigravityClientFilesystem, type AntigravityProviderConfig } from './types.js'

/** One provider-native session with turn-scoped host callbacks. */
export class AntigravitySession implements ExternalAgentSession {
  readonly ref: ExternalAgentSessionRef
  readonly supportedModes = ANTIGRAVITY_PERMISSION_MODES
  private readonly nativeSession: ExternalAgentSessionId
  private active = false
  private disposed = false

  constructor(private readonly connection: AcpConnection, provider: ExternalAgentProvider['info']['id'], session: ExternalAgentOpenRequest['session'], private readonly nativeId: string, private readonly config: AntigravityProviderConfig, private readonly filesystem?: AntigravityClientFilesystem) {
    this.nativeSession = sessionId(nativeId)
    this.ref = { provider, session, nativeSession: this.nativeSession, resumeCursor: resumeCursor(provider, nativeId) }
  }

  /** Send one prompt; native tools remain owned by ACP and are only published as activity. */
  async runTurn(request: ExternalAgentTurnRequest, host: ExternalAgentTurnHost): Promise<ExternalAgentTurnResult> {
    if (this.disposed) throw new Error('Antigravity session is disposed')
    if (this.active) throw new Error('Antigravity session already has an active turn')
    if (request.signal.aborted) return { status: 'cancelled', text: '' }
    this.active = true
    let text = ''
    let textBytes = 0
    let protocolFailure: Error | undefined
    let providerFailure: string | undefined
    let events = Promise.resolve()
    const maxTextBytes = this.config.maxEventTextBytes ?? 1024 * 1024
    const bounds = { maxTextBytes, maxPayloadBytes: this.config.maxEventPayloadBytes ?? 16 * 1024 * 1024 }
    const boundedHost = withBoundedExternalAgentHost(host, bounds)
    const handler = createAntigravityInteractionHandler(boundedHost, this.filesystem)
    this.connection.setRequestHandler(handler)
    this.connection.setNotificationHandler((method, params) => {
      if (method !== 'session/update' || protocolFailure !== undefined) return
      try {
        if (!isRecord(params) || params.sessionId !== this.nativeId) throw new Error('Antigravity session update belongs to another session')
        const event = normalizeAntigravitySessionUpdate(params.update, bounds)
        if (event === null) return
        if (event.type === 'assistant-delta') {
          const delta = truncateUtf8(event.text, maxTextBytes - textBytes)
          text += delta
          textBytes += utf8Length(delta)
        }
        if (event.type === 'turn-result' && event.status === 'failed') providerFailure = event.content ?? 'Antigravity turn failed'
        events = events.then(() => boundedHost.publish(event))
      } catch (protocolError) {
        protocolFailure = new Error('Antigravity emitted a malformed session update', { cause: protocolError })
        try { this.connection.notify('session/cancel', { sessionId: this.nativeId }) } catch { /* The transport is already closing. */ }
      }
    })
    const onAbort = () => {
      try { this.connection.notify('session/cancel', { sessionId: this.nativeId }) } catch { /* The transport is already closing. */ }
    }
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const prompt = await promptBlocks(request.prompt, request.attachments, this.filesystem)
      await this.connection.request('session/set_mode', { sessionId: this.nativeId, modeId: mapPermissionMode(request.permissionMode) }, request.signal)
      const response = await this.connection.request('session/prompt', { sessionId: this.nativeId, prompt }, request.signal)
      await events
      if (protocolFailure !== undefined) throw protocolFailure
      await publishUsage(response, boundedHost)
      const stopReason = isRecord(response) ? response.stopReason : undefined
      const failure = providerFailure ?? responseFailure(response)
      const status = request.signal.aborted || stopReason === 'cancelled' ? 'cancelled' : failure !== undefined || stopReason === 'refusal' || stopReason === 'error' ? 'failed' : 'completed'
      await boundedHost.publish({ type: 'turn-result', status, content: text })
      return { status, text, nativeSessionId: this.nativeSession, ...(this.ref.resumeCursor === undefined ? {} : { resumeCursor: this.ref.resumeCursor }), ...(status === 'failed' ? { error: redactAntigravityText(failure ?? String(stopReason ?? 'provider turn failed')) } : {}) }
    } catch (error) {
      if (request.signal.aborted || isAbortError(error)) return { status: 'cancelled', text, nativeSessionId: this.nativeSession }
      return { status: 'failed', text, nativeSessionId: this.nativeSession, error: redactAntigravityText(errorMessage(error)) }
    } finally {
      request.signal.removeEventListener('abort', onAbort)
      this.connection.setRequestHandler(undefined)
      this.connection.setNotificationHandler(undefined)
      this.active = false
    }
  }

  /** Close the ACP transport; closing is the native allow-always revocation mechanism. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const signal = AbortSignal.timeout(this.config.cancelGraceMs ?? 500)
    try { await this.connection.request('session/close', { sessionId: this.nativeId }, signal) } catch { /* Timeout or an already-ended session must not block transport teardown. */ }
    await this.connection.close()
  }
}

async function promptBlocks(prompt: string, attachments: readonly ExternalAgentAttachment[] | undefined, filesystem: AntigravityClientFilesystem | undefined): Promise<readonly Record<string, string>[]> {
  const blocks: Record<string, string>[] = [{ type: 'text', text: prompt }]
  for (const attachment of attachments ?? []) {
    if (attachment.path !== undefined && attachment.data !== undefined) throw new Error('Antigravity attachment cannot contain both path and data')
    if (attachment.path !== undefined) {
      if (filesystem?.resolvePath === undefined) throw new Error('Antigravity path attachments require the DSH filesystem resolver')
      const path = await filesystem.resolvePath(attachment.path, 'read')
      blocks.push({ type: 'resource_link', name: attachment.name, uri: path, ...(attachment.mimeType === undefined ? {} : { mimeType: attachment.mimeType }) })
      continue
    }
    if (attachment.data !== undefined && attachment.mimeType?.startsWith('image/') === true) { blocks.push({ type: 'image', data: attachment.data, mimeType: attachment.mimeType }); continue }
    if (attachment.data !== undefined) { blocks.push({ type: 'text', text: attachment.data }); continue }
    throw new Error('Antigravity attachment has no path or data: ' + attachment.name)
  }
  return blocks
}

function utf8Length(value: string): number { return new TextEncoder().encode(value).byteLength }
function responseFailure(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined
  const nested = isRecord(response.error) ? stringValue(response.error.message) : undefined
  return stringValue(response.error) ?? nested ?? stringValue(response.failure)
}

async function publishUsage(response: unknown, host: ExternalAgentTurnHost): Promise<void> {
  if (!isRecord(response) || !isRecord(response.usage)) return
  const inputTokens = typeof response.usage.inputTokens === 'number' ? response.usage.inputTokens : undefined
  const outputTokens = typeof response.usage.outputTokens === 'number' ? response.usage.outputTokens : undefined
  await host.publish({ type: 'usage', ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) })
}

function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError' }
