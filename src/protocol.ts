import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Transform, Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type CreateElicitationResponse,
  type InitializeRequest,
  type LoadSessionRequest,
  type LogoutRequest,
  type NewSessionRequest,
  type PromptRequest,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionModeRequest,
  type WriteTextFileResponse,
  type ReadTextFileResponse,
} from '@agentclientprotocol/sdk'
import { ANTIGRAVITY_AUTH_STDOUT_PREFIX, parseAntigravityAuthPrelude, redactAntigravityText } from './auth.js'
import { isRecord } from './decode.js'
import type { AntigravityAuthorizationRequest } from './types.js'
import type { AntigravityLaunchSpec } from './installation.js'

/** Handler for one ACP request initiated by the native agent. */
export type AcpRequestHandler = (method: string, params: unknown, id: number | string) => Promise<unknown>
/** Handler for one ACP notification initiated by the native agent. */
export type AcpNotificationHandler = (method: string, params: unknown) => void

/** Provider-facing ACP connection seam; production uses the official SDK below. */
export interface AcpConnection {
  request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown>
  notify(method: string, params?: unknown): void
  setRequestHandler(handler: AcpRequestHandler | undefined): void
  setNotificationHandler(handler: AcpNotificationHandler | undefined): void
  close(): Promise<void>
}

/** Options for the official SDK stdio transport. */
export interface StdioAcpOptions {
  readonly maxLineBytes?: number
  readonly cancelGraceMs?: number
  readonly onStderr?: (text: string) => void
  readonly onAuthorizationUrl?: (request: AntigravityAuthorizationRequest) => void
}

/** Start the configured executable with the official ACP TypeScript SDK. */
export function spawnAntigravityAcp(spec: AntigravityLaunchSpec, options: StdioAcpOptions = {}): AcpConnection {
  const maxLineBytes = options.maxLineBytes ?? 16 * 1024 * 1024
  const cancelGraceMs = options.cancelGraceMs ?? 500
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) throw new RangeError('maxLineBytes must be a positive safe integer')
  if (!Number.isSafeInteger(cancelGraceMs) || cancelGraceMs < 1) throw new RangeError('cancelGraceMs must be a positive safe integer')
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let authorizationState: string | undefined
  const emitAuthorization = (raw: string, strict: boolean): void => {
    if (options.onAuthorizationUrl === undefined || authorizationState !== undefined) return
    let authorization: AntigravityAuthorizationRequest | null
    try { authorization = parseAntigravityAuthPrelude(raw) } catch (error) {
      if (strict) throw error
      return
    }
    if (authorization === null) return
    try { options.onAuthorizationUrl(authorization) } catch (error) {
      if (strict) throw error
      return
    }
    authorizationState = authorization.state
  }
  const guard = new LineBoundTransform(maxLineBytes, line => emitAuthorization(line, true))
  const stderrGuard = new LineBoundTransform(maxLineBytes, undefined, line => {
    try { options.onStderr?.(redactAntigravityText(line)) } catch { /* Diagnostic callbacks cannot escape the EventEmitter path. */ }
    emitAuthorization(line + '\n', false)
  })
  child.stdout.pipe(guard)
  child.stderr.pipe(stderrGuard)
  const connection = new SdkAcpConnection(child, guard, cancelGraceMs)
  guard.once('error', error => connection.fail(error))
  stderrGuard.once('error', error => connection.fail(error))
  child.once('error', error => connection.fail(error))
  child.once('exit', (code, signal) => connection.fail(new Error('Antigravity ACP process exited (' + String(code ?? signal ?? 'unknown') + ')')))
  return connection
}

/** Adapter around ClientSideConnection that retains the generic seam for test fakes. */
class SdkAcpConnection implements AcpConnection {
  private requestHandler: AcpRequestHandler | undefined
  private notificationHandler: AcpNotificationHandler | undefined
  private closed = false
  private termination: Promise<void> | undefined
  private readonly sdk: ClientSideConnection
  private readonly child: ChildProcessWithoutNullStreams
  private readonly guard: LineBoundTransform

  constructor(child: ChildProcessWithoutNullStreams, guard: LineBoundTransform, private readonly cancelGraceMs: number) {
    this.child = child
    this.guard = guard
    const client: Client = {
      requestPermission: params => this.callClient('session/request_permission', params) as Promise<unknown> as Promise<RequestPermissionResponse>,
      sessionUpdate: async params => { this.notificationHandler?.('session/update', params) },
      readTextFile: params => this.callClient('fs/read_text_file', params) as Promise<unknown> as Promise<ReadTextFileResponse>,
      writeTextFile: params => this.callClient('fs/write_text_file', params) as Promise<unknown> as Promise<WriteTextFileResponse>,
      unstable_createElicitation: async params => toElicitationResponse(await this.callClient('elicitation/create', params)),
      extMethod: async (method, params) => {
        const result = await this.callClient(method, params)
        if (!isRecord(result)) throw new Error('ACP extension response is malformed: ' + method)
        return result
      },
      extNotification: async (method, params) => { await this.callClient(method, params) },
    }
    this.sdk = new ClientSideConnection(() => client, ndJsonStream(
      NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      NodeReadable.toWeb(guard) as ReadableStream<Uint8Array>,
    ))
  }

  request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('ACP connection is closed'))
    const operation = this.dispatch(method, params)
    return withAbort(operation, signal, () => this.escalateCancellation(method, params))
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    if (method === 'session/cancel') void this.sdk.cancel(asAcp<CancelNotification>(params, 'session/cancel')).catch(() => { /* The process may already be gone. */ })
  }

  setRequestHandler(handler: AcpRequestHandler | undefined): void { this.requestHandler = handler }
  setNotificationHandler(handler: AcpNotificationHandler | undefined): void { this.notificationHandler = handler }

  async close(): Promise<void> {
    if (this.termination !== undefined) return this.termination
    this.closed = true
    this.guard.destroy()
    this.child.stdin.destroy()
    this.termination = terminateProcess(this.child, this.cancelGraceMs)
    await this.termination
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.closed = true
    this.guard.destroy(error instanceof Error ? error : new Error('ACP transport failed'))
    this.child.stdin.destroy()
    this.termination = terminateProcess(this.child, this.cancelGraceMs)
  }

  private escalateCancellation(method: string, params: unknown): () => void {
    if (method === 'session/prompt' && isRecord(params) && typeof params.sessionId === 'string') this.notify('session/cancel', { sessionId: params.sessionId })
    const timer = setTimeout(() => { if (!this.closed) void this.close() }, this.cancelGraceMs)
    timer.unref?.()
    return () => clearTimeout(timer)
  }

  private callClient(method: string, params: unknown): Promise<unknown> {
    const handler = this.requestHandler
    if (handler === undefined) return Promise.reject(new Error('ACP client request handler is unavailable'))
    return handler(method, params, requestId(params))
  }

  private dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize': return this.sdk.initialize(asAcp<InitializeRequest>(params, method))
      case 'authenticate': return this.sdk.authenticate(asAcp<AuthenticateRequest>(params, method))
      case 'session/new': return this.sdk.newSession(asAcp<NewSessionRequest>(params, method))
      case 'session/load': return this.sdk.loadSession(asAcp<LoadSessionRequest>(params, method))
      case 'session/resume': return this.sdk.resumeSession(asAcp<ResumeSessionRequest>(params, method))
      case 'session/set_mode': return this.sdk.setSessionMode(asAcp<SetSessionModeRequest>(params, method))
      case 'session/set_config_option': return this.sdk.setSessionConfigOption(asAcp<SetSessionConfigOptionRequest>(params, method))
      case 'session/prompt': return this.sdk.prompt(asAcp<PromptRequest>(params, method))
      case 'session/close': return this.sdk.closeSession(asAcp<CloseSessionRequest>(params, method))
      case 'logout': return this.sdk.logout(asAcp<LogoutRequest>(params, method))
      default: return Promise.reject(new Error('Unsupported ACP client request: ' + method))
    }
  }
}

/** Bound complete lines before forwarding protocol or diagnostic text. */
class LineBoundTransform extends Transform {
  private pending = Buffer.alloc(0)
  constructor(private readonly maxLineBytes: number, private readonly onPrelude?: (line: string) => void, private readonly onLine?: (line: string) => void) { super() }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error) => void): void {
    this.pending = Buffer.concat([this.pending, chunk])
    while (true) {
      const newline = this.pending.indexOf(0x0a)
      if (newline < 0) break
      const line = this.pending.subarray(0, newline)
      this.pending = this.pending.subarray(newline + 1)
      if (line.byteLength > this.maxLineBytes) { callback(new Error('ACP JSON line exceeds configured bound')); return }
      const text = line.toString('utf8')
      try {
        if (this.onLine !== undefined) this.onLine(text)
        else if (text.startsWith(ANTIGRAVITY_AUTH_STDOUT_PREFIX)) this.onPrelude?.(text)
        else this.push(Buffer.concat([line, Buffer.from([0x0a])]))
      } catch (error) { callback(error instanceof Error ? error : new Error('invalid ACP stream line')); return }
    }
    if (this.pending.byteLength > this.maxLineBytes) callback(new Error('ACP JSON line exceeds configured bound'))
    else callback()
  }
  override _flush(callback: (error?: Error) => void): void {
    if (this.pending.byteLength === 0) { callback(); return }
    if (this.onLine === undefined) { callback(new Error('ACP stream ended with an incomplete JSON line')); return }
    try { this.onLine(this.pending.toString('utf8')); callback() } catch (error) { callback(error instanceof Error ? error : new Error('invalid ACP stream line')) }
  }
}

async function terminateProcess(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  try { if (pid !== undefined && process.platform !== 'win32') process.kill(-pid, 'SIGTERM'); else child.kill('SIGTERM') } catch { /* The child exited between the state check and signal. */ }
  await waitForExit(child, graceMs)
  if (child.exitCode === null && child.signalCode === null) {
    try { if (pid !== undefined && process.platform !== 'win32') process.kill(-pid, 'SIGKILL'); else child.kill('SIGKILL') } catch { /* The child exited during graceful teardown. */ }
    await waitForExit(child, graceMs)
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined, onAbort: () => (() => void) | void): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    let aborted = signal.aborted
    let cleanup = aborted ? onAbort() : undefined
    const abort = (): void => { aborted = true; cleanup = onAbort() }
    if (!aborted) signal.addEventListener('abort', abort, { once: true })
    const finish = (): void => { signal.removeEventListener('abort', abort); cleanup?.() }
    operation.then(value => {
      finish()
      if (aborted) reject(new DOMException('The operation was aborted', 'AbortError'))
      else resolve(value)
    }, error => {
      finish()
      if (aborted) reject(new DOMException('The operation was aborted', 'AbortError'))
      else reject(error)
    })
  })
}

function asAcp<T>(value: unknown, method: string): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('ACP ' + method + ' parameters are malformed')
  return value as T
}
function requestId(params: unknown): number { return typeof params === 'object' && params !== null && 'requestId' in params && typeof params.requestId === 'number' ? params.requestId : 0 }
function toElicitationResponse(value: unknown): CreateElicitationResponse {
  if (!isRecord(value) || !Array.isArray(value.answers) || value.answers.length === 0) return { action: 'decline' }
  const answer = value.answers[0]
  return typeof answer === 'string' ? { action: 'accept', content: { answer } } : { action: 'decline' }
}
