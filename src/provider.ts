import {
  ManagedExternalAgentSession,
  authorizeExternalAgentOpen,
  providerId,
  resumeCursor,
  sessionId,
  type ExternalAgentAttachment,
  type ExternalAgentFilesystem,
  type ExternalAgentFullAccessAudit,
  type ExternalAgentModel,
  type ExternalAgentOpenRequest,
  type ExternalAgentProvider,
  type ExternalAgentSession,
  type ExternalAgentSessionRef,
  type ExternalAgentSessionId,
  type ExternalAgentTurnHost,
  type ExternalAgentTurnRequest,
  type ExternalAgentTurnResult,
} from '@deepseek-ai/dsh-acp-provider'
import { isAbsolute } from 'node:path'
import { antigravitySignInRequiredMessage, clearAntigravityProfile, redactAntigravityText } from './auth.js'
import { isRecord, stringValue } from './decode.js'
import { buildAntigravityLaunchSpec, type AntigravityLaunchSpec, validateAntigravityInstallation, type AntigravityInstallationProbe } from './installation.js'
import { createAntigravityInteractionHandler } from './interaction.js'
import { mapPermissionMode, normalizeAntigravitySessionUpdate, parseAntigravityModels, resolveAntigravityModel, validateAntigravityIdentity } from './mapping.js'
import { spawnAntigravityAcp, type AcpConnection, type StdioAcpOptions } from './protocol.js'
import {
  ANTIGRAVITY_CLIENT_CAPABILITIES,
  ANTIGRAVITY_DEFAULT_MODEL,
  type AntigravityAuthorizationRequest,
  type AntigravityClientFilesystem,
  type AntigravityHealth,
  type AntigravityIdentity,
  type AntigravityProviderConfig,
} from './types.js'

/** Value-free audit record required before a full-access process starts. */
export interface AntigravityFullAccessAudit extends ExternalAgentFullAccessAudit {
  readonly instanceId: string
}

/** Dependencies that keep process, filesystem and audit seams injectable. */
export interface AntigravityProviderDependencies {
  readonly cwd?: string
  readonly filesystem?: AntigravityClientFilesystem
  readonly installationProbe?: AntigravityInstallationProbe
  readonly launchSpec?: (config: AntigravityProviderConfig, cwd: string) => Promise<AntigravityLaunchSpec>
  readonly connectionFactory?: (spec: AntigravityLaunchSpec, options?: StdioAcpOptions) => AcpConnection
  readonly auditFullAccess?: (entry: AntigravityFullAccessAudit) => void | Promise<void>
  readonly onAuthorizationUrl?: (request: AntigravityAuthorizationRequest) => void
}

/** Provider-owned Antigravity ACP implementation. */
export class AntigravityProvider implements ExternalAgentProvider {
  readonly info
  private identity: AntigravityIdentity | undefined
  private status: AntigravityHealth
  private disposed = false
  private disposePromise: Promise<void> | undefined
  private readonly sessions = new Set<ManagedExternalAgentSession>()
  private readonly connections = new Set<AcpConnection>()

  constructor(readonly config: AntigravityProviderConfig, private readonly dependencies: AntigravityProviderDependencies = {}) {
    const providerName = config.instanceId === 'default' ? 'antigravity' : 'antigravity:' + config.instanceId
    this.info = { id: providerId(providerName), name: 'Antigravity', description: 'Google Antigravity ACP external agent' }
    this.status = { status: 'missing-installation', profileDirectory: config.stateDirectory }
  }

  /** Value-free installation and protocol health for Settings. */
  get health(): AntigravityHealth { return this.status }
  /** Whether this provider currently owns an ACP connection or session. */
  get live(): boolean { return this.connections.size > 0 || this.sessions.size > 0 }

  /** Discover account-visible models through ACP session configuration. */
  async listModels(signal?: AbortSignal): Promise<readonly ExternalAgentModel[]> {
    this.assertActive()
    const cwd = this.workingDirectory()
    let connection: AcpConnection | undefined
    try {
      connection = await this.openConnection(cwd, signal)
      const response = await connection.request('session/new', { cwd, mcpServers: [] }, signal)
      const models = modelsFromSessionResponse(response)
      await closeNativeSession(connection, response, signal)
      this.status = { status: 'ready', profileDirectory: this.config.stateDirectory, ...(this.identity?.agentVersion === undefined ? {} : { version: this.identity.agentVersion }), model: this.config.model ?? ANTIGRAVITY_DEFAULT_MODEL }
      return models
    } catch (error) {
      this.setFailureStatus(error)
      throw error
    } finally {
      if (connection !== undefined) this.connections.delete(connection)
      await connection?.close()
    }
  }

  /** Open one ACP native session for the exact route and permission mode. */
  async openSession(request: ExternalAgentOpenRequest): Promise<ExternalAgentSession> {
    this.assertActive()
    if (request.route.kind !== 'external-agent' || request.route.provider !== this.info.id) throw new Error('Antigravity received a route for another provider')
    if (request.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    const audit = this.dependencies.auditFullAccess
    await authorizeExternalAgentOpen(request, audit === undefined ? undefined : entry => audit({ ...entry, instanceId: this.config.instanceId }))
    const cwd = this.workingDirectory(request.workspaceRoot)
    let connection: AcpConnection | undefined
    try {
      connection = await this.openConnection(cwd, request.signal)
      const filesystem = request.clientFilesystem === undefined ? this.dependencies.filesystem : adaptFilesystem(request.clientFilesystem)
      const response = await this.openNativeSession(connection, request, cwd, filesystem)
      const models = modelsFromSessionResponse(response)
      const selectedModel = resolveAntigravityModel(String(request.route.model), models)
      const native = nativeSessionId(response)
      if (String(selectedModel.id) !== ANTIGRAVITY_DEFAULT_MODEL) await connection.request('session/set_config_option', { sessionId: native, configId: 'model', value: String(selectedModel.id) }, request.signal)
      await connection.request('session/set_mode', { sessionId: native, modeId: mapPermissionMode(request.permissionMode) }, request.signal)
      const rawSession = new AntigravitySession(connection, this.info.id, request.session, native, this.config, filesystem)
      const session = new ManagedExternalAgentSession(rawSession)
      this.sessions.add(session)
      const trackedSession: ExternalAgentSession = {
        ref: session.ref,
        supportedModes: session.supportedModes,
        runTurn: (turnRequest, turnHost) => session.runTurn(turnRequest, turnHost),
        dispose: async () => { try { await session.dispose() } finally { this.sessions.delete(session) } },
      }
      this.connections.delete(connection)
      connection = undefined
      this.status = { status: 'ready', profileDirectory: this.config.stateDirectory, ...(this.identity?.agentVersion === undefined ? {} : { version: this.identity.agentVersion }), model: String(selectedModel.id) }
      return trackedSession
    } catch (error) {
      if (connection !== undefined) this.connections.delete(connection)
      await connection?.close()
      this.setFailureStatus(error)
      throw error
    }
  }

  /** Dispose all provider sessions and live ACP connections. */
  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise
    this.disposed = true
    this.disposePromise = (async () => {
      await Promise.all([...this.sessions].map(session => session.dispose().catch(() => undefined)))
      await Promise.all([...this.connections].map(connection => connection.close().catch(() => undefined)))
      this.sessions.clear()
      this.connections.clear()
    })()
    return this.disposePromise
  }

  private setFailureStatus(error: unknown): void {
    const authenticationRequired = isAuthenticationError(error)
    this.status = { status: authenticationRequired ? 'authentication-required' : 'error', profileDirectory: this.config.stateDirectory, message: authenticationRequired ? antigravitySignInRequiredMessage() : redactAntigravityText(errorMessage(error)) }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Antigravity provider is disposed')
  }

  /** Validate the executable pair and negotiate ACP identity for Settings. */
  async validateInstallation(): Promise<Awaited<ReturnType<typeof validateAntigravityInstallation>>> {
    const result = await validateAntigravityInstallation(this.config, this.dependencies.installationProbe)
    if ('status' in result) {
      this.status = { status: result.status, profileDirectory: this.config.stateDirectory, message: result.message }
      return result
    }
    let connection: AcpConnection | undefined
    try {
      connection = await this.startConnection(this.workingDirectory())
      const version = this.identity?.agentVersion ?? result.version
      const model = this.status.model
      this.status = { status: this.status.status === 'ready' ? 'ready' : 'authentication-required', profileDirectory: this.config.stateDirectory, ...(version === undefined ? {} : { version }), ...(model === undefined ? {} : { model }) }
      return { ...result, ...(version === undefined ? {} : { version }) }
    } finally {
      if (connection !== undefined) this.connections.delete(connection)
      await connection?.close()
    }
  }

  /** Start the provider OAuth flow from Settings and close the temporary connection. */
  async signIn(signal?: AbortSignal): Promise<void> {
    this.assertActive()
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    const connection = await this.startConnection(this.workingDirectory(), signal)
    try {
      if (!await this.authenticateIfConfigured(connection, signal)) throw new Error('Antigravity ACP does not expose personal OAuth authentication')
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
      this.status = { status: 'ready', profileDirectory: this.config.stateDirectory, ...(this.identity?.agentVersion === undefined ? {} : { version: this.identity.agentVersion }), ...(this.status.model === undefined ? {} : { model: this.status.model }) }
    } catch (error) {
      this.setFailureStatus(error)
      throw error
    } finally {
      this.connections.delete(connection)
      await connection.close()
    }
  }

  /** Revoke the selected profile through ACP when available, then remove its private files. */
  async signOut(signal?: AbortSignal): Promise<void> {
    this.assertActive()
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    await Promise.all([...this.sessions].map(session => session.dispose().catch(() => undefined)))
    this.sessions.clear()
    const connection = await this.startConnection(this.workingDirectory(), signal)
    try {
      try { await connection.request('logout', {}, signal) } catch (error) { if (!isMethodUnavailable(error)) throw error }
    } finally {
      this.connections.delete(connection)
      await connection.close()
    }
    await clearAntigravityProfile(this.config)
    this.status = { status: 'authentication-required', profileDirectory: this.config.stateDirectory, message: 'Antigravity account signed out.' }
  }

  private workingDirectory(workspaceRoot?: string): string {
    const cwd = workspaceRoot ?? this.dependencies.cwd ?? process.cwd()
    const platform = this.config.platform ?? process.platform
    if (!isAbsoluteForPlatform(cwd, platform)) throw new Error('Antigravity ACP working directory must be absolute')
    return cwd
  }

  private async openConnection(cwd: string, signal?: AbortSignal): Promise<AcpConnection> {
    const connection = await this.startConnection(cwd, signal)
    try {
      if (!await this.authenticateIfConfigured(connection, signal)) throw new Error(antigravitySignInRequiredMessage())
      return connection
    } catch (error) {
      this.connections.delete(connection)
      await connection.close()
      throw error
    }
  }

  private async startConnection(cwd: string, signal?: AbortSignal): Promise<AcpConnection> {
    const spec = this.dependencies.launchSpec === undefined ? await buildAntigravityLaunchSpec(this.config, cwd) : await this.dependencies.launchSpec(this.config, cwd)
    const options = {
      ...(this.config.maxEventPayloadBytes === undefined ? {} : { maxLineBytes: this.config.maxEventPayloadBytes }),
      ...(this.config.cancelGraceMs === undefined ? {} : { cancelGraceMs: this.config.cancelGraceMs }),
      ...(this.dependencies.onAuthorizationUrl === undefined ? {} : { onAuthorizationUrl: this.dependencies.onAuthorizationUrl }),
    }
    const connection = this.dependencies.connectionFactory === undefined ? spawnAntigravityAcp(spec, options) : this.dependencies.connectionFactory(spec, options)
    if (this.disposed) {
      await connection.close()
      throw new Error('Antigravity provider is disposed')
    }
    this.connections.add(connection)
    try {
      const response = await connection.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: ANTIGRAVITY_CLIENT_CAPABILITIES,
        clientInfo: { name: this.config.clientName ?? 'dsh-acp-antigravity', version: this.config.clientVersion ?? '0.1.0' },
      }, signal)
      this.identity = validateAntigravityIdentity(response)
      return connection
    } catch (error) {
      this.connections.delete(connection)
      await connection.close()
      throw error
    }
  }

  private async authenticateIfConfigured(connection: AcpConnection, signal?: AbortSignal): Promise<boolean> {
    if ((this.config.authMethod ?? 'oauth-personal') !== 'oauth-personal') throw new Error('Antigravity authentication method is unsupported')
    try {
      await connection.request('authenticate', { methodId: 'oauth-personal' }, signal)
      return true
    } catch (error) {
      if (isMethodUnavailable(error)) return false
      throw error
    }
  }

  private async openNativeSession(connection: AcpConnection, request: ExternalAgentOpenRequest, cwd: string, filesystem?: AntigravityClientFilesystem): Promise<unknown> {
    const attachmentRoots = request.attachmentRoots ?? filesystem?.attachmentRoots
    const params = { cwd, mcpServers: [], ...(attachmentRoots === undefined ? {} : { additionalDirectories: [...attachmentRoots] }) }
    if (request.resumeCursor !== undefined) {
      if (request.resumeCursor.provider !== this.info.id) throw new Error('Antigravity resume cursor belongs to another provider')
      if (this.identity?.resumeMethod === 'resume') return connection.request('session/resume', { cwd, sessionId: request.resumeCursor.value }, request.signal)
      if (this.identity?.resumeMethod === 'load') return connection.request('session/load', { ...params, sessionId: request.resumeCursor.value }, request.signal)
      throw new Error('Antigravity ACP does not advertise session resume')
    }
    return connection.request('session/new', params, request.signal)
  }
}

/** One provider-native session with turn-scoped host callbacks. */
export class AntigravitySession implements ExternalAgentSession {
  readonly ref: ExternalAgentSessionRef
  readonly supportedModes = ['approval-required', 'auto-accept-edits', 'full-access'] as const
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
    const handler = createAntigravityInteractionHandler(host, this.filesystem)
    this.connection.setRequestHandler(handler)
    this.connection.setNotificationHandler((method, params) => {
      if (method !== 'session/update' || protocolFailure !== undefined) return
      const update = isRecord(params) && params.update !== undefined ? params.update : params
      try {
        const event = normalizeAntigravitySessionUpdate(update, { maxTextBytes, maxPayloadBytes: this.config.maxEventPayloadBytes ?? 16 * 1024 * 1024 })
        if (event === null) return
        if (event.type === 'assistant-delta') {
          const delta = truncateUtf8(event.text, maxTextBytes - textBytes)
          text += delta
          textBytes += utf8Length(delta)
        }
        if (event.type === 'turn-result' && event.status === 'failed') providerFailure = event.content ?? 'Antigravity turn failed'
        events = events.then(() => host.publish(event))
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
      await publishUsage(response, host)
      const stopReason = isRecord(response) ? response.stopReason : undefined
      const failure = providerFailure ?? responseFailure(response)
      const status = request.signal.aborted || stopReason === 'cancelled' ? 'cancelled' : failure !== undefined || stopReason === 'refusal' || stopReason === 'error' ? 'failed' : 'completed'
      await host.publish({ type: 'turn-result', status, content: text })
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
    try { await this.connection.request('session/close', { sessionId: this.nativeId }) } catch { /* Closing an already-ended native session is harmless. */ }
    await this.connection.close()
  }
}

async function closeNativeSession(connection: AcpConnection, response: unknown, signal?: AbortSignal): Promise<void> {
  if (!isRecord(response) || typeof response.sessionId !== 'string' || response.sessionId.length === 0) return
  try { await connection.request('session/close', { sessionId: response.sessionId }, signal) } catch { /* Model discovery cleanup cannot replace its result. */ }
}

function modelsFromSessionResponse(response: unknown): readonly ExternalAgentModel[] {
  if (!isRecord(response)) throw new Error('Antigravity session response is malformed')
  return parseAntigravityModels(response.configOptions ?? response.models ?? [])
}
function nativeSessionId(response: unknown): string {
  if (!isRecord(response) || typeof response.sessionId !== 'string' || response.sessionId.length === 0) throw new Error('Antigravity session response has no session id')
  return response.sessionId
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
function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value
  let result = ''
  let bytes = 0
  for (const character of value) {
    const next = utf8Length(character)
    if (bytes + next > maxBytes) break
    result += character
    bytes += next
  }
  return result
}
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
function adaptFilesystem(filesystem: ExternalAgentFilesystem): AntigravityClientFilesystem {
  const workspaceRoot = filesystem.workspaceRoots[0]
  if (workspaceRoot === undefined) throw new Error('Antigravity client filesystem has no workspace root')
  if (filesystem.resolvePath === undefined) throw new Error('Antigravity client filesystem requires a host path resolver')
  return { workspaceRoot, workspaceRoots: filesystem.workspaceRoots, attachmentRoots: filesystem.attachmentRoots, readTextFile: (path, signal) => filesystem.readTextFile(path, signal), writeTextFile: (path, content, signal) => filesystem.writeTextFile(path, content, signal), resolvePath: filesystem.resolvePath }
}
function isAbsoluteForPlatform(value: string, platform: NodeJS.Platform): boolean { return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') : isAbsolute(value) }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Antigravity provider error' }
function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError' }
function isAuthenticationError(error: unknown): boolean { return /auth|unauthori|sign.?in|credential/i.test(errorMessage(error)) }
function isMethodUnavailable(error: unknown): boolean { return /method|not found|unavailable/i.test(errorMessage(error)) }

/** Construct a provider instance for a configured Antigravity installation. */
export function createAntigravityProvider(config: AntigravityProviderConfig, dependencies?: AntigravityProviderDependencies): AntigravityProvider { return new AntigravityProvider(config, dependencies) }
