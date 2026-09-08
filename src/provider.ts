import {
  ManagedExternalAgentSession,
  consumeExternalAgentOpenAuthorization,
  providerId,
  type ExternalAgentFilesystem,
  type ExternalAgentModel,
  type ExternalAgentOpenRequest,
  type ExternalAgentProvider,
  type ExternalAgentSession,
} from '@deepseek-ai/dsh-acp-provider'
import { isAbsolute } from 'node:path'
import { antigravitySessionScope, decodeAntigravityCursor } from './cursor.js'
import { antigravitySignInRequiredMessage, clearAntigravityProfile, redactAntigravityText, resolveAntigravityProfileDirectory } from './auth.js'
import { errorMessage, isRecord } from './decode.js'
import { buildAntigravityLaunchSpec, type AntigravityLaunchSpec, validateAntigravityInstallation, type AntigravityInstallationProbe } from './installation.js'
import { mapPermissionMode, parseAntigravityModels, resolveAntigravityModel, validateAntigravityIdentity } from './mapping.js'
import { spawnAntigravityAcp, type AcpConnection, type StdioAcpOptions } from './protocol.js'
import { AntigravitySession } from './session.js'
import {
  antigravityClientCapabilities,
  ANTIGRAVITY_DEFAULT_MODEL,
  type AntigravityAuthorizationRequest,
  type AntigravityClientFilesystem,
  type AntigravityHealth,
  type AntigravityIdentity,
  type AntigravityProviderConfig,
} from './types.js'

/** Dependencies that keep installation, process, and OAuth notification seams injectable. */
export interface AntigravityProviderDependencies {
  readonly cwd?: string
  readonly installationProbe?: AntigravityInstallationProbe
  readonly launchSpec?: (config: AntigravityProviderConfig, cwd: string) => Promise<AntigravityLaunchSpec>
  readonly connectionFactory?: (spec: AntigravityLaunchSpec, options?: StdioAcpOptions) => AcpConnection
  readonly onAuthorizationUrl?: (request: AntigravityAuthorizationRequest) => void
}

/** Provider-owned Antigravity ACP implementation. */
export class AntigravityProvider implements ExternalAgentProvider {
  readonly info
  private readonly profileDirectory: string
  private identity: AntigravityIdentity | undefined
  private status: AntigravityHealth
  private disposed = false
  private disposePromise: Promise<void> | undefined
  private readonly sessions = new Set<ManagedExternalAgentSession>()
  private readonly connections = new Set<AcpConnection>()

  constructor(readonly config: AntigravityProviderConfig, private readonly dependencies: AntigravityProviderDependencies = {}) {
    for (const [name, value] of [['maxEventTextBytes', config.maxEventTextBytes], ['maxEventPayloadBytes', config.maxEventPayloadBytes], ['cancelGraceMs', config.cancelGraceMs]] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new RangeError(name + ' must be a positive safe integer')
    }
    this.profileDirectory = resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId)
    const providerName = config.instanceId === 'default' ? 'antigravity' : 'antigravity:' + config.instanceId
    this.info = { id: providerId(providerName), name: 'Antigravity', description: 'Google Antigravity ACP external agent' }
    this.status = { status: 'missing-installation', profileDirectory: this.profileDirectory }
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
      this.assertActive()
      this.status = { status: 'ready', profileDirectory: this.profileDirectory, ...(this.identity?.agentVersion === undefined ? {} : { version: this.identity.agentVersion }), model: this.config.model ?? ANTIGRAVITY_DEFAULT_MODEL }
      return models
    } catch (error) {
      this.setFailureStatus(error)
      throw error
    } finally {
      await this.closeConnection(connection)
    }
  }

  /** Open one ACP native session for the exact route and permission mode. */
  async openSession(request: ExternalAgentOpenRequest): Promise<ExternalAgentSession> {
    this.assertActive()
    consumeExternalAgentOpenAuthorization(request)
    if (request.route.kind !== 'external-agent' || request.route.provider !== this.info.id) throw new Error('Antigravity received a route for another provider')
    if (request.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    const cwd = this.workingDirectory(request.workspaceRoot)
    const filesystem = request.clientFilesystem === undefined ? undefined : adaptFilesystem(request.clientFilesystem)
    let connection: AcpConnection | undefined
    try {
      connection = await this.openConnection(cwd, request.signal, filesystem !== undefined)
      const response = await this.openNativeSession(connection, request, cwd, filesystem)
      const models = modelsFromSessionResponse(response)
      const selectedModel = resolveAntigravityModel(String(request.route.model), models)
      const native = request.resumeCursor === undefined ? nativeSessionId(response) : decodeAntigravityCursor(request.resumeCursor, antigravitySessionScope(this.config, cwd))
      if (String(selectedModel.id) !== ANTIGRAVITY_DEFAULT_MODEL) await connection.request('session/set_config_option', { sessionId: native, configId: 'model', value: String(selectedModel.id) }, request.signal)
      await connection.request('session/set_mode', { sessionId: native, modeId: mapPermissionMode(request.permissionMode) }, request.signal)
      this.assertActive()
      const rawSession = new AntigravitySession(connection, this.info.id, request.session, native, this.config, antigravitySessionScope(this.config, cwd), filesystem)
      const session = new ManagedExternalAgentSession(rawSession)
      this.sessions.add(session)
      let disposal: Promise<void> | undefined
      const trackedSession: ExternalAgentSession = {
        ref: session.ref,
        supportedModes: session.supportedModes,
        runTurn: (turnRequest, turnHost) => session.runTurn(turnRequest, turnHost),
        dispose: () => {
          disposal ??= session.dispose().finally(() => { this.sessions.delete(session) })
          return disposal
        },
      }
      this.connections.delete(connection)
      connection = undefined
      this.status = { status: 'ready', profileDirectory: this.profileDirectory, ...(this.identity?.agentVersion === undefined ? {} : { version: this.identity.agentVersion }), model: String(selectedModel.id) }
      return trackedSession
    } catch (error) {
      await this.closeConnection(connection)
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
    if (this.disposed) return
    const authenticationRequired = isAuthenticationError(error)
    this.status = { status: authenticationRequired ? 'authentication-required' : 'error', profileDirectory: this.profileDirectory, message: authenticationRequired ? antigravitySignInRequiredMessage() : redactAntigravityText(errorMessage(error)) }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Antigravity provider is disposed')
  }

  private async closeConnection(connection: AcpConnection | undefined): Promise<void> {
    if (connection === undefined) return
    try { await connection.close() } finally { this.connections.delete(connection) }
  }

  /** Validate the executable pair and negotiate ACP identity for Settings. */
  async validateInstallation(): Promise<Awaited<ReturnType<typeof validateAntigravityInstallation>>> {
    this.assertActive()
    const result = await validateAntigravityInstallation(this.config, this.dependencies.installationProbe)
    this.assertActive()
    if ('status' in result) {
      this.status = { status: result.status, profileDirectory: this.profileDirectory, message: result.message }
      return result
    }
    let connection: AcpConnection | undefined
    try {
      connection = await this.startConnection(this.workingDirectory())
      const version = this.identity?.agentVersion ?? result.version
      const model = this.status.model
      this.status = { status: this.status.status === 'ready' ? 'ready' : 'authentication-required', profileDirectory: this.profileDirectory, ...(version === undefined ? {} : { version }), ...(model === undefined ? {} : { model }) }
      return { ...result, ...(version === undefined ? {} : { version }) }
    } catch (error) {
      this.setFailureStatus(error)
      throw error
    } finally {
      await this.closeConnection(connection)
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
      this.assertActive()
      this.status = { status: 'ready', profileDirectory: this.profileDirectory, ...(this.identity?.agentVersion === undefined ? {} : { version: this.identity.agentVersion }), ...(this.status.model === undefined ? {} : { model: this.status.model }) }
    } catch (error) {
      this.setFailureStatus(error)
      throw error
    } finally {
      await this.closeConnection(connection)
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
      await this.closeConnection(connection)
    }
    this.assertActive()
    await clearAntigravityProfile(this.config)
    this.assertActive()
    this.status = { status: 'authentication-required', profileDirectory: this.profileDirectory, message: 'Antigravity account signed out.' }
  }

  private workingDirectory(workspaceRoot?: string): string {
    const cwd = workspaceRoot ?? this.dependencies.cwd ?? process.cwd()
    const platform = this.config.platform ?? process.platform
    if (!isAbsoluteForPlatform(cwd, platform)) throw new Error('Antigravity ACP working directory must be absolute')
    return cwd
  }

  private async openConnection(cwd: string, signal?: AbortSignal, filesystem = false): Promise<AcpConnection> {
    const connection = await this.startConnection(cwd, signal, filesystem)
    try {
      if (!await this.authenticateIfConfigured(connection, signal)) throw new Error(antigravitySignInRequiredMessage())
      return connection
    } catch (error) {
      await this.closeConnection(connection)
      throw error
    }
  }

  private async startConnection(cwd: string, signal?: AbortSignal, filesystem = false): Promise<AcpConnection> {
    const spec = this.dependencies.launchSpec === undefined ? await buildAntigravityLaunchSpec(this.config, cwd) : await this.dependencies.launchSpec(this.config, cwd)
    this.assertActive()
    const options = {
      ...(this.config.maxEventPayloadBytes === undefined ? {} : { maxLineBytes: this.config.maxEventPayloadBytes }),
      ...(this.config.cancelGraceMs === undefined ? {} : { cancelGraceMs: this.config.cancelGraceMs }),
      ...(this.dependencies.onAuthorizationUrl === undefined ? {} : { onAuthorizationUrl: this.dependencies.onAuthorizationUrl }),
    }
    const connection = this.dependencies.connectionFactory === undefined ? spawnAntigravityAcp(spec, options) : this.dependencies.connectionFactory(spec, options)
    this.connections.add(connection)
    try {
      const response = await connection.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: antigravityClientCapabilities(filesystem),
        clientInfo: { name: this.config.clientName ?? 'dsh-acp-antigravity', version: this.config.clientVersion ?? '0.1.0' },
      }, signal)
      const identity = validateAntigravityIdentity(response)
      this.assertActive()
      this.identity = identity
      return connection
    } catch (error) {
      await this.closeConnection(connection)
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
    const attachmentRoots = request.attachmentRoots ?? filesystem?.attachmentRoots ?? []
    const workspaceRoots = filesystem?.workspaceRoots ?? (filesystem === undefined ? [] : [filesystem.workspaceRoot])
    const additionalDirectories = [...new Set([...workspaceRoots, ...attachmentRoots])].filter(root => root !== cwd)
    const params = { cwd, mcpServers: [], ...(additionalDirectories.length === 0 ? {} : { additionalDirectories }) }
    if (request.resumeCursor !== undefined) {
      if (request.resumeCursor.provider !== this.info.id) throw new Error('Antigravity resume cursor belongs to another provider')
      const nativeId = decodeAntigravityCursor(request.resumeCursor, antigravitySessionScope(this.config, cwd))
      if (this.identity?.resumeMethod === 'resume') return connection.request('session/resume', { ...params, sessionId: nativeId }, request.signal)
      if (this.identity?.resumeMethod === 'load') return connection.request('session/load', { ...params, sessionId: nativeId }, request.signal)
      throw new Error('Antigravity ACP does not advertise session resume')
    }
    return connection.request('session/new', params, request.signal)
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
function adaptFilesystem(filesystem: ExternalAgentFilesystem): AntigravityClientFilesystem {
  const workspaceRoot = filesystem.workspaceRoots[0]
  if (workspaceRoot === undefined) throw new Error('Antigravity client filesystem has no workspace root')
  if (filesystem.resolvePath === undefined) throw new Error('Antigravity client filesystem requires a host path resolver')
  return { workspaceRoot, workspaceRoots: filesystem.workspaceRoots, attachmentRoots: filesystem.attachmentRoots, readTextFile: (path, signal) => filesystem.readTextFile(path, signal), writeTextFile: (path, content, signal) => filesystem.writeTextFile(path, content, signal), resolvePath: filesystem.resolvePath }
}
function isAbsoluteForPlatform(value: string, platform: NodeJS.Platform): boolean { return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') : isAbsolute(value) }
function isAuthenticationError(error: unknown): boolean { return /auth|unauthori|sign.?in|credential/i.test(errorMessage(error)) }
function isMethodUnavailable(error: unknown): boolean { return /method|not found|unavailable/i.test(errorMessage(error)) }

/** Construct a provider instance for a configured Antigravity installation. */
export function createAntigravityProvider(config: AntigravityProviderConfig, dependencies?: AntigravityProviderDependencies): AntigravityProvider { return new AntigravityProvider(config, dependencies) }
