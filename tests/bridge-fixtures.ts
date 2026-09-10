/**
 * Shared Antigravity bridge-test fixtures.
 *
 * Test-side data completion only: every fake here carries a real provider id,
 * a real session ref with an opaque cursor from encodeAntigravityCursor, models
 * whose supportedModes admit the exercised permission mode, and an explicit DSH
 * session id. Production performs no such completion and must fail closed.
 *
 * The fake ACP world mints one connection per connect (the real provider opens
 * a short-lived connection per listModels probe plus one per native session),
 * while every connection records into one shared world log the harness owns.
 * Tests derive the prompted native id from that log instead of hardcoding it.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ExternalAgentProviderRegistry,
  providerId,
  providerInstanceId,
  sessionId,
  type ExternalAgentOpenRequest,
  type ExternalAgentPermissionMode,
  type ExternalAgentProvider,
  type ExternalAgentSessionRef,
  type ExternalAgentTurnHost,
  type ExternalAgentTurnRequest,
} from '@deepseek-ai/dsh-acp-provider'
import { nativeSessionBinding } from '../src/activity-contract.js'
import { AntigravityActivityStore } from '../src/activity-store.js'
import { antigravitySessionScope, decodeAntigravityCursor, encodeAntigravityCursor } from '../src/cursor.js'
import { isRecord, stringValue } from '../src/decode.js'
import { createAntigravityLlmBridge, type BridgeHost } from '../src/llm-bridge.js'
import { AntigravityProvider } from '../src/provider.js'
import type { AcpConnection, AcpNotificationHandler, AcpRequestHandler } from '../src/protocol.js'
import { ANTIGRAVITY_SESSION_READY } from '../src/tool-events.js'
import { ANTIGRAVITY_PERMISSION_MODES, type AntigravityProviderConfig } from '../src/types.js'

export { decodeAntigravityCursor }

/** Every permission mode the native sidecar supports; fakes must admit the mode under test. */
export const VALID_MODES: readonly ExternalAgentPermissionMode[] = ANTIGRAVITY_PERMISSION_MODES

/** Canonical provider configuration for fixture scopes and harnesses. */
export function fixtureConfig(): AntigravityProviderConfig {
  return {
    executablePath: '/opt/agy/agy_acp_server',
    harnessPath: '/opt/agy/localharness_external',
    stateDirectory: '/tmp/dsh-test',
    instanceId: providerInstanceId('default'),
    platform: 'linux',
  }
}

/** Scope a fixture cursor to one profile directory and workspace. */
export function fixtureScope(config: AntigravityProviderConfig, cwd: string): string {
  return antigravitySessionScope(config, cwd)
}

/** Default scope used by migrated unit fakes (profile /tmp/dsh-test, cwd /workspace). */
export const FIXTURE_SCOPE: string = antigravitySessionScope(fixtureConfig(), '/workspace')

/** A real-shaped session ref with an opaque cursor; the cursor round-trips through decode. */
export function validRef(options?: {
  provider?: string
  session?: string
  native?: string
  scope?: string
}): ExternalAgentSessionRef {
  const provider = options?.provider ?? 'antigravity'
  const session = options?.session ?? 'session-fixture'
  const native = options?.native ?? 'native-fixture'
  const scope = options?.scope ?? FIXTURE_SCOPE
  return {
    provider: providerId(provider),
    session: sessionId(session),
    nativeSession: sessionId(native),
    resumeCursor: encodeAntigravityCursor(providerId(provider), native, scope),
  }
}

/** One listModels entry whose supportedModes admit every exercised permission mode. */
export function validListModel(id = 'gemini', name = 'Gemini'): {
  id: string
  name: string
  supportedModes: readonly ExternalAgentPermissionMode[]
} {
  return { id, name, supportedModes: [...VALID_MODES] }
}

/**
 * Build a stub provider backed by a real registry so runner open/validation paths run.
 *
 * The wrapper completes stub refs the runner validates: the ref adopts the opened
 * DSH session (a stub returning another session's ref is invalid fake data), and
 * turn results inherit the session's own native/cursor when the stub leaves them
 * absent so the post-turn binding comparison sees no spurious cursor update.
 */
export function bridgeWithStubProvider(
  stub: unknown,
  getCachedModels: (() => readonly { id: string; name: string }[]) | undefined = undefined,
  setCachedModels: ((models: readonly { id: string; name: string }[]) => void) | undefined = undefined,
  host: BridgeHost | undefined = undefined,
  getCachedFacts: (() => ReadonlyMap<string, import('../src/model-metadata.js').ModelFacts>) | undefined = undefined,
): ReturnType<typeof createAntigravityLlmBridge> {
  const provider = {
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    listModels: async (): Promise<readonly never[]> => [],
    openSession: async (): Promise<never> => {
      throw new Error('stub provider has no openSession')
    },
    ...(isRecord(stub) ? stub : {}),
  } as unknown as ExternalAgentProvider
  const innerOpen = provider.openSession.bind(provider)
  provider.openSession = (async (request: ExternalAgentOpenRequest) => {
    const session = await innerOpen(request)
    const ref: ExternalAgentSessionRef = { ...session.ref, session: request.session, provider: provider.info.id }
    const innerRun = session.runTurn.bind(session)
    return {
      ...session,
      ref,
      runTurn: async (turn: ExternalAgentTurnRequest, host: ExternalAgentTurnHost) => {
        const result = await innerRun(turn, host)
        return {
          ...result,
          nativeSessionId: result.nativeSessionId ?? ref.nativeSession,
          resumeCursor: result.resumeCursor ?? ref.resumeCursor,
        }
      },
    }
  }) as ExternalAgentProvider['openSession']
  const registry = new ExternalAgentProviderRegistry()
  registry.register(provider)
  const factory = createAntigravityLlmBridge as unknown as (
    ...args: readonly unknown[]
  ) => ReturnType<typeof createAntigravityLlmBridge>
  return factory({ registry, getProvider: () => provider }, getCachedModels, setCachedModels, host, getCachedFacts)
}

/** One native model entry advertised through session/new and session/resume. */
export interface FakeAcpModel {
  readonly value: string
  readonly name: string
}

export interface FakeAcpOptions {
  readonly models?: readonly FakeAcpModel[]
  readonly updates?: readonly unknown[]
  readonly promptResponse?: unknown
  readonly updateSessionId?: string
  readonly agentRequests?: readonly { readonly method: string; readonly params: unknown }[]
  readonly failPrompt?: unknown
}

export interface FakeAcpCall {
  readonly connection: number
  readonly method: string
  readonly params: unknown
}

/**
 * Shared fake ACP world. The real provider opens one connection per listModels
 * probe plus one per native session, so the factory mints a fresh connection
 * per connect; all of them record into this single ordered log.
 */
export class FakeAcpWorld {
  readonly calls: FakeAcpCall[] = []
  readonly prompted: string[] = []
  readonly resumed: string[] = []
  readonly closed: string[] = []
  private sequence = 0
  private readonly connections: FakeAcpConnection[] = []

  constructor(private readonly options: FakeAcpOptions = {}) {}

  /** Mint one connection for one provider connect. */
  connect(): AcpConnection {
    const connection = new FakeAcpConnection(this, this.connections.length)
    this.connections.push(connection)
    return connection
  }

  /** Behavior shared by every minted connection. */
  behavior(): FakeAcpOptions {
    return this.options
  }

  /** Mint the next native session id for a session/new response. */
  nextNative(): string {
    this.sequence += 1
    return 'native-' + String(this.sequence)
  }

  log(connection: number, method: string, params: unknown): void {
    this.calls.push({ connection, method, params })
  }

  notePrompt(nativeId: string): void {
    this.prompted.push(nativeId)
  }

  noteResume(nativeId: string): void {
    this.resumed.push(nativeId)
  }

  noteClose(nativeId: string): void {
    this.closed.push(nativeId)
  }
}

/** One fake ACP connection bound to its world's shared log and id sequence. */
class FakeAcpConnection implements AcpConnection {
  private requestHandler: AcpRequestHandler | undefined
  private notificationHandler: AcpNotificationHandler | undefined
  private closed = false
  private currentNative = ''

  constructor(private readonly world: FakeAcpWorld, private readonly index: number) {}

  private modelOptions(): unknown {
    const models = this.world.behavior().models ?? [{ value: 'gemini-pro', name: 'Gemini Pro' }]
    return [{ id: 'model', name: 'Model', type: 'select', options: models.map(model => ({ value: model.value, name: model.name })) }]
  }

  async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    this.world.log(this.index, method, params)
    const options = this.world.behavior()
    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        agentInfo: { name: 'antigravity-acp', version: '1.2.3' },
        agentCapabilities: { sessionCapabilities: { resume: {} } },
      }
    }
    if (method === 'authenticate') return {}
    if (method === 'session/new') {
      this.currentNative = this.world.nextNative()
      return { sessionId: this.currentNative, configOptions: this.modelOptions() }
    }
    if (method === 'session/resume' || method === 'session/load') {
      const id = isRecord(params) ? stringValue(params.sessionId) : undefined
      this.currentNative = id ?? 'native-unknown'
      this.world.noteResume(this.currentNative)
      return { configOptions: this.modelOptions() }
    }
    if (method === 'session/set_config_option') return {}
    if (method === 'session/set_mode') return {}
    if (method === 'session/prompt') {
      if (options.failPrompt !== undefined) throw options.failPrompt
      const target = options.updateSessionId ?? this.currentNative
      this.world.notePrompt(target)
      for (const update of options.updates ?? [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } }]) {
        this.notificationHandler?.('session/update', { sessionId: target, update })
      }
      for (const request of options.agentRequests ?? []) {
        await this.requestHandler?.(request.method, request.params, 10)
      }
      return options.promptResponse ?? { stopReason: 'end_turn' }
    }
    if (method === 'session/close') {
      const id = isRecord(params) ? stringValue(params.sessionId) : undefined
      if (id !== undefined) this.world.noteClose(id)
      return {}
    }
    if (method === 'logout') return {}
    void signal
    throw new Error('method not found: ' + method)
  }

  notify(method: string, params?: unknown): void {
    this.world.log(this.index, method, params)
  }

  setRequestHandler(handler: AcpRequestHandler | undefined): void {
    this.requestHandler = handler
  }

  setNotificationHandler(handler: AcpNotificationHandler | undefined): void {
    this.notificationHandler = handler
  }

  async close(): Promise<void> {
    this.closed = true
  }

  get isClosed(): boolean {
    return this.closed
  }
}

/**
 * Host-side persistence assembled exactly like the production plugin sink: a
 * real AntigravityActivityStore under a temp root, session-ready records
 * carrying the opaque ref, and loadSession decoded through nativeSessionBinding.
 */
export interface BridgeHostStore {
  readonly root: string
  readonly activity: AntigravityActivityStore
  readonly approvals: unknown[]
  readonly asks: unknown[]
  readonly host: BridgeHost
  refOf(id: string): ExternalAgentSessionRef | undefined
  setPolicy(policy: { readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'; readonly workspaceRoot: string }): void
  dispose(): void
}

export function createBridgeHostStore(
  initialPolicy: { readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'; readonly workspaceRoot: string } = {
    mode: 'read-only',
    workspaceRoot: '/workspace',
  },
): BridgeHostStore {
  const root = mkdtempSync(join(tmpdir(), 'agy-bridge-'))
  const activity = new AntigravityActivityStore(root)
  const approvals: unknown[] = []
  const asks: unknown[] = []
  let policy = initialPolicy
  const appendActivity = (id: string | undefined, events: Parameters<AntigravityActivityStore['append']>[1]): void => {
    if (id === undefined) throw new Error('Native activity requires an explicit DSH session id')
    try {
      activity.append(id, events)
    } catch {
      throw new Error('Unable to persist Antigravity activity; native execution stopped.')
    }
  }
  const host: BridgeHost = {
    appendSessionReady: (id, ref) => {
      appendActivity(id, [{ type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' as const, ref } }])
    },
    loadSession: id => nativeSessionBinding(activity.read(id), id),
    appendToolEvents: (id, events) => {
      appendActivity(id, events)
    },
    resolvePolicy: () => policy,
    requestApproval: async (input) => {
      approvals.push(input)
      return 'rejected'
    },
    ask: async (request) => {
      asks.push(request)
      return { answers: [] }
    },
  }
  return {
    root,
    activity,
    approvals,
    asks,
    host,
    refOf(id) {
      return nativeSessionBinding(activity.read(id), id)
    },
    setPolicy(next) {
      policy = next
    },
    dispose() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Construct one bridge against an explicit registry and host store. */
export function openBridge(
  registry: ExternalAgentProviderRegistry,
  getProvider: () => ExternalAgentProvider | undefined,
  host: BridgeHost | undefined = undefined,
): ReturnType<typeof createAntigravityLlmBridge> {
  const factory = createAntigravityLlmBridge as unknown as (
    ...args: readonly unknown[]
  ) => ReturnType<typeof createAntigravityLlmBridge>
  return factory({ registry, getProvider }, undefined, undefined, host)
}

export interface AntigravityHarnessOptions {
  readonly cwd?: string
  readonly stateDirectory?: string
  readonly models?: readonly FakeAcpModel[]
  readonly promptResponse?: unknown
  readonly updates?: readonly unknown[]
  readonly world?: FakeAcpWorld
  readonly policy?: { readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'; readonly workspaceRoot: string }
}

export interface AntigravityHarness {
  readonly config: AntigravityProviderConfig
  readonly cwd: string
  readonly scope: string
  readonly world: FakeAcpWorld
  readonly provider: AntigravityProvider
  readonly registry: ExternalAgentProviderRegistry
  readonly audits: unknown[]
  readonly store: BridgeHostStore
  readonly bridge: ReturnType<typeof createAntigravityLlmBridge>
  dispose(): Promise<void>
}

/**
 * Real AntigravityProvider on a per-connect fake world behind a real audited
 * registry, with production-assembled sidecar storage persisting opaque refs
 * across bridge restarts.
 */
export function makeAntigravityHarness(options: AntigravityHarnessOptions = {}): AntigravityHarness {
  const cwd = options.cwd ?? '/workspace'
  const config: AntigravityProviderConfig = {
    ...fixtureConfig(),
    ...(options.stateDirectory === undefined ? {} : { stateDirectory: options.stateDirectory }),
  }
  const scope = antigravitySessionScope(config, cwd)
  const world = options.world ?? new FakeAcpWorld({
    models: options.models ?? [
      { value: 'gemini-pro', name: 'Gemini Pro' },
      { value: 'gemini-ultra', name: 'Gemini Ultra' },
    ],
    ...(options.promptResponse === undefined ? {} : { promptResponse: options.promptResponse }),
    ...(options.updates === undefined ? {} : { updates: options.updates }),
  })
  const provider = new AntigravityProvider(config, {
    cwd,
    launchSpec: async () => ({
      command: '/opt/agy/agy_acp_server',
      args: ['--uid='],
      cwd,
      env: {},
      shell: false,
      extendEnv: false,
    }),
    connectionFactory: () => world.connect(),
  })
  const audits: unknown[] = []
  const registry = new ExternalAgentProviderRegistry({
    auditFullAccess: async (entry) => {
      audits.push(entry)
    },
  })
  const unregister = registry.register(provider)
  const store = createBridgeHostStore(options.policy)
  const bridge = openBridge(registry, () => provider, store.host)
  return {
    config,
    cwd,
    scope,
    world,
    provider,
    registry,
    audits,
    store,
    bridge,
    async dispose() {
      await bridge.dispose().catch(() => undefined)
      await unregister()
      store.dispose()
    },
  }
}

/** Collect every chunk from one bridge stream. */
export async function collectStream(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/** Read the terminal finish reason of a drained bridge stream. */
export function finishOf(chunks: readonly unknown[]): {
  kind: string
  code?: string
  message?: string
} | undefined {
  const last = chunks.at(-1)
  if (!isRecord(last) || last.type !== 'finish' || !isRecord(last.reason)) return undefined
  const reason = last.reason
  const failure = isRecord(reason.failure) ? reason.failure : undefined
  return {
    kind: typeof reason.kind === 'string' ? reason.kind : '?',
    ...(typeof failure?.code === 'string' ? { code: failure.code } : {}),
    ...(typeof failure?.message === 'string' ? { message: failure.message } : {}),
  }
}

/** Count world-logged calls to one ACP method, optionally filtered by params. */
export function callsTo(
  world: FakeAcpWorld,
  method: string,
  match?: (params: unknown) => boolean,
): { readonly connection: number; readonly method: string; readonly params: unknown }[] {
  return world.calls.filter(call => call.method === method && (match === undefined || match(call.params)))
}

/** Extract one string field from record params without throwing on other shapes. */
export function paramField(params: unknown, field: string): string | undefined {
  return isRecord(params) ? stringValue(params[field]) : undefined
}
