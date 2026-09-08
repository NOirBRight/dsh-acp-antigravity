import { describe, expect, it } from 'vitest'
import { createAntigravityLlmBridge } from '../src/llm-bridge.js'
import { zPromptResponse } from '@agentclientprotocol/sdk/dist/schema/zod.gen.js'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ExternalAgentProviderRegistry, TurnAbortedError, auditId, createSessionModelRoute, optionId, providerInstanceId, resumeCursor, sessionId, turnId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import {
  antigravityClientCapabilities,
  ANTIGRAVITY_DEFAULT_MODEL,
  ANTIGRAVITY_PERMISSION_MODES,
  AntigravityProvider,
  buildAntigravityEnvironment,
  clearAntigravityProfile,
  createAntigravityFilesystemHandler,
  createAntigravityInteractionHandler,
  createAntigravitySettingsEditor,
  installAntigravityProvider,
  mapPermissionMode,
  parseAntigravityAuthPrelude,
  parseAntigravityAuthorizationUrl,
  parseAntigravityModels,
  normalizeAntigravitySessionUpdate,
  prepareAntigravityProfile,
  redactAntigravityText,
  resolveAntigravityProfileDirectory,
  validateAntigravityIdentity,
  type AntigravityLaunchSpec,
} from '../src/index.js'
import { ExternalAgentSettingsEditorRegistry } from '@deepseek-ai/dsh-acp-provider/settings'
import { spawnAntigravityAcp, type AcpConnection, type AcpRequestHandler, type AcpNotificationHandler } from '../src/protocol.js'
import { antigravitySessionScope, encodeAntigravityCursor } from '../src/cursor.js'

interface FakeConnectionOptions {
  readonly authenticationAvailable?: boolean
  readonly initializeResponse?: unknown
  readonly updates?: readonly unknown[]
  readonly promptResponse?: unknown
  readonly updateSessionId?: string
  readonly agentRequests?: readonly { readonly method: string; readonly params: unknown }[]
  readonly hangClose?: boolean
  readonly onSetMode?: () => Promise<void>
}

class FakeConnection implements AcpConnection {
  readonly calls: { readonly method: string; readonly params: unknown }[] = []
  private requestHandler: AcpRequestHandler | undefined
  private notificationHandler: AcpNotificationHandler | undefined
  private closed = false

  constructor(private readonly options: FakeConnectionOptions = {}) {}

  async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'initialize') return this.options.initializeResponse ?? { protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: '1.2.3' }, agentCapabilities: { sessionCapabilities: { resume: {} } } }
    if (method === 'authenticate') {
      if (this.options.authenticationAvailable === false) throw new Error('method not found')
      return {}
    }
    if (method === 'session/new') return { sessionId: 'native-1', configOptions: [{ id: 'model', name: 'Model', type: 'select', options: [{ value: 'gemini-pro', name: 'Gemini Pro' }] }] }
    if (method === 'session/resume' || method === 'session/load') return { configOptions: [{ id: 'model', name: 'Model', type: 'select', options: [{ value: 'gemini-pro', name: 'Gemini Pro' }] }] }
    if (method === 'session/set_config_option') return {}
    if (method === 'session/set_mode') { await this.options.onSetMode?.(); return {} }
    if (method === 'session/close' && this.options.hangClose === true) return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    if (method === 'session/prompt') {
      const updates = this.options.updates ?? [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
        { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', title: 'read', status: 'completed', locations: ['/workspace/src/a.ts'] },
      ]
      for (const update of updates) this.notificationHandler?.('session/update', { sessionId: this.options.updateSessionId ?? 'native-1', update })
      for (const request of this.options.agentRequests ?? []) await this.requestHandler?.(request.method, request.params, 10)
      return this.options.promptResponse ?? { stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 3 } }
    }
    throw new Error('method not found')
  }

  notify(method: string, params?: unknown): void { this.calls.push({ method, params }) }
  setRequestHandler(handler: AcpRequestHandler | undefined): void { this.requestHandler = handler }
  setNotificationHandler(handler: AcpNotificationHandler | undefined): void { this.notificationHandler = handler }
  async close(): Promise<void> { this.closed = true }
  get isClosed(): boolean { return this.closed }
  async requestFromAgent(method: string, params: unknown): Promise<unknown> {
    if (this.requestHandler === undefined) throw new Error('request handler unavailable')
    return this.requestHandler(method, params, 10)
  }
}

function config() {
  return { executablePath: '/opt/agy/agy_acp_server', harnessPath: '/opt/agy/localharness_external', stateDirectory: '/tmp/dsh-test', instanceId: providerInstanceId('default'), platform: 'linux' as const }
}
function route(model = 'gemini-pro') { return createSessionModelRoute('external-agent', 'antigravity', model) }
function clientFilesystem() {
  return {
    workspaceRoot: '/workspace', workspaceRoots: ['/workspace'], attachmentRoots: ['/attachments'],
    readTextFile: async () => '', writeTextFile: async () => undefined,
    resolvePath: async (path: string) => { if (!path.startsWith('/workspace/') && !path.startsWith('/attachments/')) throw new Error('outside configured roots'); return path },
  }
}
function launchSpec(): AntigravityLaunchSpec { return { command: '/opt/agy/agy_acp_server', args: ['--uid='], cwd: '/workspace', env: {}, shell: false, extendEnv: false } }
function host(events: string[] = []): ExternalAgentTurnHost {
  return {
    publish: async event => { events.push(event.type) },
    requestPermission: async request => ({ kind: 'allow-once', optionId: request.options[0]?.optionId ?? optionId('fallback') }),
    requestUserInput: async () => ({ answers: ['answer'] }),
  }
}

describe('Antigravity mapping and safety', () => {
  it('preserves ACP content when a tool has no raw output', () => {
    const content = [{ type: 'content', content: { type: 'text', text: 'native result' } }]
    expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-content', status: 'completed', content }, { maxTextBytes: 1024, maxPayloadBytes: 4096 })).toMatchObject({ output: JSON.stringify(content) })
  })

  it('maps all public permission modes and advertises client capabilities', () => {
    expect(mapPermissionMode('approval-required')).toBe('default')
    expect(mapPermissionMode('auto-accept-edits')).toBe('auto_edit')
    expect(mapPermissionMode('full-access')).toBe('yolo')
    expect(ANTIGRAVITY_PERMISSION_MODES).toEqual(['approval-required', 'auto-accept-edits', 'full-access'])
    expect(antigravityClientCapabilities(false)).toEqual({})
    expect(antigravityClientCapabilities(true)).toEqual({ fs: { readTextFile: true, writeTextFile: true } })
  })

  it('parses grouped model options and preserves a stable default alias', () => {
    const models = parseAntigravityModels([{ id: 'mode', type: 'select', options: [{ value: 'fake', name: 'Not a model' }] }, { id: 'model', name: 'Model', type: 'select', options: [{ value: 'gemini-pro', name: 'Gemini Pro' }, { value: 'gemini-pro', name: 'Duplicate' }] }])
    expect(models.map(model => model.id)).toEqual([ANTIGRAVITY_DEFAULT_MODEL, 'gemini-pro'])
    expect(normalizeAntigravitySessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'tool', title: 'read', locations: [{ path: '/workspace/a.ts', line: 7 }] }, { maxTextBytes: 1024, maxPayloadBytes: 4096 })).toMatchObject({ locations: [{ path: '/workspace/a.ts', line: 7 }] })
  })

  it('validates protocol identity and rejects another ACP executable', () => {
    expect(validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: '1' }, agentCapabilities: { sessionCapabilities: { resume: {} } } })).toMatchObject({ agentName: 'antigravity-acp', supportsResume: true, resumeMethod: 'resume' })
    expect(() => validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'antigravity-acp' }, agentCapabilities: {} })).toThrow(/resume capability/)
    expect(() => validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'Other Agent' } })).toThrow(/not antigravity-acp/)
    expect(() => validateAntigravityIdentity({ protocolVersion: 2, agentInfo: { name: 'antigravity-acp' } })).toThrow(/version/)
    expect(() => validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'antigravity-acp' } })).toThrow(/capabilities/)
    expect(() => validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'antigravity-acp' }, agentCapabilities: { sessionCapabilities: { resume: false } } })).toThrow(/resume capability/)
  })

  it('derives allow-always scope from the native session request', async () => {
    let scope: unknown
    let warning: unknown
    const handler = createAntigravityInteractionHandler({
      publish: () => undefined,
      requestPermission: async request => { scope = request.options[0]?.scope; warning = request.securityWarning?.message; return { kind: 'allowed-for-session', optionId: request.options[0]!.optionId } },
      requestUserInput: async () => ({ answers: [] }),
    })
    await expect(handler('session/request_permission', { sessionId: 'native', toolCall: { title: 'write' }, options: [{ optionId: 'always', kind: 'allow_always', name: 'Always', _meta: { 'agy.security.warning': { message: 'Prompt injection risk' } } }] }, 1)).resolves.toMatchObject({ outcome: { optionId: 'always' } })
    expect(scope).toBe('session')
    expect(warning).toBe('Prompt injection risk')
  })

  it('describes object toolCall input in the permission reason', async () => {
    let reason: unknown
    let toolName: unknown
    const handler = createAntigravityInteractionHandler({
      publish: () => undefined,
      requestPermission: async request => { reason = request.reason; toolName = request.toolName; return { kind: 'allow-once', optionId: request.options[0]!.optionId } },
      requestUserInput: async () => ({ answers: [] }),
    })
    await handler('session/request_permission', { sessionId: 'native', toolCall: { title: 'Read file', kind: 'read', rawInput: { path: '/workspace/src/a.ts' }, locations: [{ path: '/workspace/src/a.ts' }] }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow' }] }, 1)
    expect(toolName).toBe('Read file')
    expect(reason).toBe('Antigravity requested permission: Read file · path: /workspace/src/a.ts')
    await handler('session/request_permission', { sessionId: 'native', toolCall: { title: 'run_command', rawInput: { command: 'git status' } }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow' }] }, 2)
    expect(reason).toBe('Antigravity requested permission: run_command · command: git status')
    await handler('session/request_permission', { sessionId: 'native', toolCall: { title: 'Preview label', rawInput: { CommandLine: 'printf ACTUAL', Cwd: '/workspace', Subagents: [{ Prompt: 'Reply EMPTY without tools' }] } }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow' }] }, 3)
    expect(reason).toBe('Antigravity requested permission: Preview label · CommandLine: printf ACTUAL, Cwd: /workspace, Subagents: [{"Prompt":"Reply EMPTY without tools"}]')
  })

  it('normalizes interaction-prefixed permission IDs as user questions', async () => {
    let question: unknown
    const handler = createAntigravityInteractionHandler({
      ...host(),
      requestPermission: async () => { throw new Error('permission callback must not run') },
      requestUserInput: async request => { question = request; return { answers: [request.options![1]!] } },
    }, undefined, { maxTextBytes: 5, maxPayloadBytes: 1024 })
    await expect(handler('session/request_permission', { sessionId: 'native', toolCall: { toolCallId: 'interaction_private', title: 'Pick one' }, options: [{ optionId: 'native-a', kind: 'allow_once', name: 'First' }, { optionId: 'native-b', kind: 'reject_once', name: 'Second' }] }, 7)).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'native-b' } })
    expect(question).toMatchObject({ question: 'Pick ', options: ['First', 'Secon'], multiple: false })
    expect(JSON.stringify(question)).not.toContain('interaction_private')
  })

  it('returns the ACP cancelled outcome when a permission wait aborts', async () => {
    const handler = createAntigravityInteractionHandler({ ...host(), requestPermission: async () => { throw new TurnAbortedError('cancelled') } })
    await expect(handler('session/request_permission', { sessionId: 'native', toolCall: { title: 'write' }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Once' }] }, 1)).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('rejects unscoped allow-always and host rejection without a native option', async () => {
    const unscoped = createAntigravityInteractionHandler(host())
    await expect(unscoped('interaction/permission', { toolCall: { title: 'write' }, options: [{ optionId: 'always', kind: 'allow_always', name: 'Always' }] }, 1)).rejects.toThrow(/session or thread scope/)
    const rejected = createAntigravityInteractionHandler({ ...host(), requestPermission: async () => ({ kind: 'reject' }) })
    await expect(rejected('session/request_permission', { sessionId: 'native', toolCall: { title: 'write' }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Once' }] }, 1)).rejects.toThrow(/no native reject option/)
    const cancelled = createAntigravityInteractionHandler({ ...host(), requestPermission: async () => ({ kind: 'cancel', optionId: optionId('deny') }) })
    await expect(cancelled('session/request_permission', { sessionId: 'native', toolCall: { title: 'write' }, options: [{ optionId: 'deny', kind: 'reject_once', name: 'Deny' }] }, 1)).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('keeps OAuth links safe and redacts credential-looking diagnostics', () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=state123&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2F'
    expect(parseAntigravityAuthorizationUrl(url).redirectUri).toBe('http://127.0.0.1:8765/')
    expect(parseAntigravityAuthPrelude('notice\nOpen the following link to authenticate the ACP server: ' + url + '\n')).toMatchObject({ state: 'state123' })
    expect(() => parseAntigravityAuthorizationUrl(url.replace('127.0.0.1', 'evil.example'))).toThrow(/invalid/)
    expect(() => parseAntigravityAuthorizationUrl(url + '&code=private')).toThrow(/invalid/)
    const diagnostic = redactAntigravityText('Bearer secret-token https://x.test/?code=private&state=state123 AIza' + 'A'.repeat(24))
    expect(diagnostic).not.toContain('secret-token')
    expect(diagnostic).not.toContain('private')
    expect(diagnostic).toContain('[REDACTED]')
  })

  it('isolates profiles and strips ambient Google credentials from process env', () => {
    expect(resolveAntigravityProfileDirectory('/tmp/dsh', providerInstanceId('a'))).not.toBe(resolveAntigravityProfileDirectory('/tmp/dsh', providerInstanceId('b')))
    const env = buildAntigravityEnvironment({ baseEnv: { PATH: '/bin', GOOGLE_API_KEY: 'secret', GEMINI_API_KEY: 'secret2', UNRELATED_TOKEN: 'secret3', FOO_API_KEY_SUFFIX: 'secret4', X_SECRET_VALUE: 'secret5' }, profileDirectory: '/tmp/profile', harnessPath: '/tmp/harness' })
    expect(env.PATH).toBe('/bin')
    expect(env.GOOGLE_API_KEY).toBeUndefined()
    expect(env.UNRELATED_TOKEN).toBeUndefined()
    expect(env.FOO_API_KEY_SUFFIX).toBeUndefined()
    expect(env.X_SECRET_VALUE).toBeUndefined()
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.GEMINI_HOME).toBe('/tmp/profile')
    expect(env.ANTIGRAVITY_HARNESS_PATH).toBe('/tmp/harness')
  })

  it('refuses a symlinked settings file', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'agy-settings-'))
    const target = join(stateDirectory, 'target.json')
    const configured = { ...config(), stateDirectory, instanceId: providerInstanceId('linked-settings') }
    try {
      const profile = await prepareAntigravityProfile(configured)
      expect(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'))).toMatchObject({ auth: { type: 'oauth-personal' } })
      await writeFile(target, '{}')
      await rm(join(profile, 'settings.json'))
      await symlink(target, join(profile, 'settings.json'))
      await expect(prepareAntigravityProfile(configured)).rejects.toThrow(/symbolic link/)
    } finally {
      await rm(stateDirectory, { recursive: true, force: true })
    }
  })

  it('refuses to recursively remove a symlinked profile', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'agy-profile-'))
    const profile = resolveAntigravityProfileDirectory(stateDirectory, providerInstanceId('linked'))
    const target = await mkdtemp(join(tmpdir(), 'agy-target-'))
    try {
      await mkdir(dirname(profile), { recursive: true })
      await symlink(target, profile, 'dir')
      await expect(prepareAntigravityProfile({ ...config(), stateDirectory, instanceId: providerInstanceId('linked') })).rejects.toThrow(/symbolic link/)
      await expect(clearAntigravityProfile({ ...config(), stateDirectory, instanceId: providerInstanceId('linked') })).rejects.toThrow(/symbolic link/)
    } finally {
      await rm(stateDirectory, { recursive: true, force: true })
      await rm(target, { recursive: true, force: true })
    }
  })
})

describe('Antigravity provider lifecycle', () => {
  it('retains final native usage through the session, bounded host and LLM bridge', async () => {
    const provider = new AntigravityProvider(config(), {
      cwd: '/workspace', launchSpec: async () => launchSpec(),
      connectionFactory: () => new FakeConnection({ promptResponse: zPromptResponse.parse({ stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 20, thoughtTokens: 30, totalTokens: 150, cachedReadTokens: 60 } }) }),
    })
    const registry = new ExternalAgentProviderRegistry()
    const unregister = registry.register(provider)
    const adapter = createAntigravityLlmBridge({ registry, getProvider: () => provider })
    try {
      const chunks = []
      for await (const chunk of adapter.stream({ provider: 'antigravity', model: 'gemini-pro', sessionId: 'usage-bridge', messages: [{ role: 'user', source: { kind: 'user' }, content: 'hello' }] })) chunks.push(chunk)
      expect(chunks.filter(chunk => chunk.type === 'usage')).toEqual([{ type: 'usage', usage: { inputTokens: 40, outputTokens: 50, reasoningTokens: 30, cacheReadTokens: 60, totalTokens: 150, generationElapsedMs: null } }])
    } finally {
      await adapter.dispose()
      await unregister()
    }
  })

  it('discovers exact models and drives a native turn without duplicating tools', async () => {
    const connections: FakeConnection[] = []
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => { const connection = new FakeConnection(); connections.push(connection); return connection } })
    await expect(provider.listModels()).resolves.toEqual([{ id: 'default', name: 'Account default', supportedModes: ['approval-required', 'auto-accept-edits', 'full-access'] }, { id: 'gemini-pro', name: 'Gemini Pro', supportedModes: ['approval-required', 'auto-accept-edits', 'full-access'] }])
    const session = await provider.openSession({ route: route(), session: sessionId('dsh-session'), clientFilesystem: clientFilesystem(), permissionMode: 'approval-required', signal: new AbortController().signal })
    const events: string[] = []
    const result = await session.runTurn({ turn: turnId('turn'), prompt: 'read', attachments: [{ name: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }, { name: 'source', path: '/workspace/src/a.ts' }], permissionMode: 'approval-required', signal: new AbortController().signal }, host(events))
    expect(result).toMatchObject({ status: 'completed', text: 'hello' })
    expect(connections[0]?.calls.find(call => call.method === 'initialize')?.params).toMatchObject({ clientCapabilities: {} })
    expect(connections[1]?.calls.find(call => call.method === 'initialize')?.params).toMatchObject({ clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } })
    expect(provider.live).toBe(true)
    expect(events).toEqual(['assistant-delta', 'tool-activity', 'usage', 'turn-result'])
    const prompt = connections[1]?.calls.find(call => call.method === 'session/prompt')
    expect(prompt?.params).toMatchObject({ prompt: [{ type: 'text', text: 'read' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }, { type: 'resource_link', name: 'source', uri: '/workspace/src/a.ts' }] })
    expect(connections[1]?.calls.map(call => call.method)).toEqual(['initialize', 'authenticate', 'session/new', 'session/set_config_option', 'session/set_mode', 'session/set_mode', 'session/prompt'])
    await session.dispose()
    expect(provider.live).toBe(false)
    expect(connections[1]?.isClosed).toBe(true)
  })

  it('rejects path attachments outside DSH filesystem roots before prompting', async () => {
    const connection = new FakeConnection()
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('attachment'), clientFilesystem: clientFilesystem(), permissionMode: 'approval-required', signal: new AbortController().signal })
    await expect(session.runTurn({ turn: turnId('attachment-turn'), prompt: 'read', attachments: [{ name: 'secret', path: '/private/secret' }], permissionMode: 'approval-required', signal: new AbortController().signal }, host())).resolves.toMatchObject({ status: 'failed', error: 'outside configured roots' })
    expect(connection.calls.some(call => call.method === 'session/prompt')).toBe(false)
    await session.dispose()
  })

  it('uses the requested workspace root without implicitly advertising filesystem access', async () => {
    const cwds: string[] = []
    const connection = new FakeConnection()
    const provider = new AntigravityProvider(config(), { cwd: '/fallback', launchSpec: async (_config, cwd) => { cwds.push(cwd); return launchSpec() }, connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('workspace'), workspaceRoot: '/project', permissionMode: 'approval-required', signal: new AbortController().signal })
    expect(cwds).toEqual(['/project'])
    expect(connection.calls.find(call => call.method === 'initialize')?.params).toMatchObject({ clientCapabilities: {} })
    await session.dispose()
  })

  it('resumes with the persisted native ID and complete additional roots', async () => {
    const connection = new FakeConnection()
    const cfg = config()
    const provider = new AntigravityProvider(cfg, { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const cursor = encodeAntigravityCursor(provider.info.id, 'native-old', antigravitySessionScope(cfg, '/workspace'))
    const session = await provider.openSession({ route: route(), session: sessionId('resumed'), resumeCursor: cursor, clientFilesystem: { ...clientFilesystem(), workspaceRoots: ['/workspace', '/shared'] }, permissionMode: 'approval-required', signal: new AbortController().signal })
    expect(session.ref.nativeSession).toBe('native-old')
    expect(connection.calls.find(call => call.method === 'session/resume')?.params).toMatchObject({ sessionId: 'native-old', cwd: '/workspace', additionalDirectories: ['/shared', '/attachments'] })
    await session.dispose()
  })

  it('fails before session creation when authentication cannot be verified', async () => {
    const connection = new FakeConnection({ authenticationAvailable: false })
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    await expect(provider.openSession({ route: route(), session: sessionId('unauthenticated'), permissionMode: 'approval-required', signal: new AbortController().signal })).rejects.toThrow(/Sign in/)
    expect(connection.calls.map(call => call.method)).toEqual(['initialize', 'authenticate'])
    expect(provider.health.status).toBe('authentication-required')
  })

  it('fails a turn and cancels native work after malformed ACP output', async () => {
    const connection = new FakeConnection({ updates: [{ malformed: true }] })
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('malformed'), permissionMode: 'approval-required', signal: new AbortController().signal })
    await expect(session.runTurn({ turn: turnId('malformed-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal }, host())).resolves.toMatchObject({ status: 'failed', error: 'Antigravity emitted a malformed session update' })
    expect(connection.calls.some(call => call.method === 'session/cancel')).toBe(true)
    await session.dispose()
  })

  it('fails and cancels updates from another native session', async () => {
    const connection = new FakeConnection({ updateSessionId: 'native-other' })
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('isolated'), permissionMode: 'approval-required', signal: new AbortController().signal })
    await expect(session.runTurn({ turn: turnId('isolated-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal }, host())).resolves.toMatchObject({ status: 'failed', error: 'Antigravity emitted a malformed session update' })
    expect(connection.calls.some(call => call.method === 'session/cancel')).toBe(true)
    await session.dispose()
  })

  it('bounds permission and question text before host callbacks', async () => {
    const connection = new FakeConnection({ agentRequests: [
      { method: 'session/request_permission', params: { sessionId: 'native-1', toolCall: { title: 'tool-name', rawInput: 'permission-reason' }, options: [{ optionId: 'once', kind: 'allow_once', name: 'allow-label' }], _meta: { agy: { securityWarning: 'security-warning' } } } },
      { method: 'session/request_user_input', params: { sessionId: 'native-1', question: 'question-text', options: ['option-text'] } },
    ] })
    const seen: string[] = []
    const boundedHost: ExternalAgentTurnHost = {
      publish: () => undefined,
      requestPermission: async request => { seen.push(request.toolName, request.reason, request.options[0]!.label, request.securityWarning!.message); return { kind: 'allow-once', optionId: request.options[0]!.optionId } },
      requestUserInput: async request => { seen.push(request.question, request.options![0]!); return { answers: ['ok'] } },
    }
    const provider = new AntigravityProvider({ ...config(), maxEventTextBytes: 4, maxEventPayloadBytes: 1024 }, { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('bounded-interaction'), permissionMode: 'approval-required', signal: new AbortController().signal })
    await expect(session.runTurn({ turn: turnId('bounded-interaction-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal }, boundedHost)).resolves.toMatchObject({ status: 'completed' })
    expect(seen).toEqual(['tool', 'perm', 'allo', 'secu', 'ques', 'opti'])
    await session.dispose()
  })

  it('rejects synthesized events that exceed the complete payload bound', async () => {
    const published: unknown[] = []
    const connection = new FakeConnection({ updates: [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } }] })
    const provider = new AntigravityProvider({ ...config(), maxEventPayloadBytes: 45 }, { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('bounded-synthetic'), permissionMode: 'approval-required', signal: new AbortController().signal })
    const boundedHost: ExternalAgentTurnHost = { ...host(), publish: event => { published.push(event) } }
    await expect(session.runTurn({ turn: turnId('bounded-synthetic-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal }, boundedHost)).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('maxPayloadBytes') })
    expect(published.every(event => new TextEncoder().encode(JSON.stringify(event)).byteLength <= 45)).toBe(true)
    await session.dispose()
  })

  it('preserves provider failures and bounds accumulated assistant output', async () => {
    const connection = new FakeConnection({
      updates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'abc' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'def' } },
      ],
      promptResponse: { stopReason: 'end_turn', error: 'quota exceeded' },
    })
    const provider = new AntigravityProvider({ ...config(), maxEventTextBytes: 5 }, { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('quota'), permissionMode: 'approval-required', signal: new AbortController().signal })
    await expect(session.runTurn({ turn: turnId('quota-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal }, host())).resolves.toMatchObject({ status: 'failed', text: 'abcde', error: 'quota exceeded' })
    await session.dispose()
  })

  it('reports protocol validation failures through provider health', async () => {
    const provider = new AntigravityProvider(config(), { installationProbe: { stat: async () => ({ isFile: true, mode: 0o755 }) }, launchSpec: async () => launchSpec(), connectionFactory: () => new FakeConnection({ initializeResponse: { protocolVersion: 1, agentInfo: { name: 'antigravity-acp' }, agentCapabilities: {} } }) })
    await expect(provider.validateInstallation()).rejects.toThrow(/resume capability/)
    expect(provider.health).toMatchObject({ status: 'error' })
  })

  it('shows the negotiated version and native-terminal scope in Settings', async () => {
    const provider = new AntigravityProvider(config(), {
      cwd: '/workspace',
      installationProbe: { stat: async () => ({ isFile: true, mode: 0o755 }) },
      launchSpec: async () => launchSpec(),
      connectionFactory: () => new FakeConnection(),
    })
    await expect(provider.validateInstallation()).resolves.toMatchObject({ version: '1.2.3' })
    const editor = createAntigravitySettingsEditor(config(), provider)
    const fields = editor.snapshot().fields
    expect(fields.find(field => field.key === 'version')?.value).toBe('1.2.3')
    expect(fields.find(field => field.key === 'profileDirectory')?.value).toBe(provider.health.profileDirectory)
    expect(fields.find(field => field.key === 'fullAccessWarning')?.value).toContain('outside DSH client-filesystem roots')
    expect(editor.snapshot().status).toMatchObject({ authenticated: false, live: false, ready: false })
    await provider.signIn()
    expect(editor.snapshot().status).toMatchObject({ authenticated: true, live: false, ready: true })
  })

  it('does not publish a session when disposal wins native initialization', async () => {
    let entered!: () => void
    let release!: () => void
    const settingMode = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const connection = new FakeConnection({ onSetMode: async () => { entered(); await gate } })
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const opening = provider.openSession({ route: route(), session: sessionId('disposing-open'), permissionMode: 'approval-required', signal: new AbortController().signal })
    await settingMode
    await provider.dispose()
    release()
    await expect(opening).rejects.toThrow(/disposed/)
    expect(connection.isClosed).toBe(true)
  })

  it('bounds a hanging native session close and still closes transport', async () => {
    const connection = new FakeConnection({ hangClose: true })
    const provider = new AntigravityProvider({ ...config(), cancelGraceMs: 5 }, { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => connection })
    const session = await provider.openSession({ route: route(), session: sessionId('hanging-close'), permissionMode: 'approval-required', signal: new AbortController().signal })
    const disposal = session.dispose()
    expect(session.dispose()).toBe(disposal)
    await expect(disposal).resolves.toBeUndefined()
    expect(connection.isClosed).toBe(true)
  })

  it('does not create a connection when disposal wins launch preparation', async () => {
    let entered!: () => void
    let release!: () => void
    const preparing = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let opened = 0
    const provider = new AntigravityProvider(config(), { launchSpec: async () => { entered(); await gate; return launchSpec() }, connectionFactory: () => { opened += 1; return new FakeConnection() } })
    const listing = provider.listModels()
    await preparing
    await provider.dispose()
    release()
    await expect(listing).rejects.toThrow(/disposed/)
    expect(opened).toBe(0)
  })

  it('does not leave a provider registered when Settings registration fails', () => {
    const providers = new ExternalAgentProviderRegistry()
    const editors = new ExternalAgentSettingsEditorRegistry()
    editors.register = () => { throw new Error('editor failed') }
    expect(() => installAntigravityProvider({ externalAgents: providers, settingsEditors: editors }, config())).toThrow('editor failed')
    expect(providers.has('antigravity')).toBe(false)
  })

  it('rejects new work after provider disposal', async () => {
    const provider = new AntigravityProvider(config(), { connectionFactory: () => new FakeConnection() })
    await provider.dispose()
    await expect(provider.listModels()).rejects.toThrow(/disposed/)
    await expect(provider.signIn()).rejects.toThrow(/disposed/)
    await expect(provider.validateInstallation()).rejects.toThrow(/disposed/)
  })

  it('requires explicit full-access confirmation and audits before startup', async () => {
    const audit: string[] = []
    let opened = 0
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => { opened++; return new FakeConnection() } })
    await expect(provider.openSession({ route: route(), session: sessionId('direct'), permissionMode: 'full-access', fullAccessConfirmed: true, fullAccessAuditId: auditId('direct-audit'), signal: new AbortController().signal })).rejects.toThrow(/provider registry/)
    const registry = new ExternalAgentProviderRegistry({ auditFullAccess: entry => { audit.push(entry.mode) } })
    registry.register(provider)
    await expect(registry.openSession({ route: route(), session: sessionId('s'), permissionMode: 'full-access', signal: new AbortController().signal })).rejects.toThrow(/confirmation/)
    expect(opened).toBe(0)
    const fullRequest = { route: route(), session: sessionId('s'), permissionMode: 'full-access' as const, fullAccessConfirmed: true, fullAccessAuditId: auditId('audit-1'), signal: new AbortController().signal }
    const session = await registry.openSession(fullRequest)
    await expect(provider.openSession(fullRequest)).rejects.toThrow(/provider registry/)
    expect(audit).toEqual(['full-access'])
    expect(opened).toBe(2)
    await session.dispose()
  })
})

describe('Antigravity client filesystem', () => {
  it('allows only DSH roots and fails closed for terminal methods', async () => {
    const reads: string[] = []
    const handler = createAntigravityFilesystemHandler({ workspaceRoot: '/workspace', attachmentRoots: ['/workspace/attachments'], readTextFile: async path => { reads.push(path); return 'ok' }, writeTextFile: async () => undefined, resolvePath: async path => path === '/workspace/link' ? '/etc/passwd' : path })
    await expect(handler('fs/read_text_file', { path: '/workspace/src/a.ts' }, 1)).resolves.toEqual({ content: 'ok' })
    await expect(handler('fs/read_text_file', { path: '/etc/passwd' }, 1)).rejects.toThrow(/outside/)
    await expect(handler('fs/read_text_file', { path: '/workspace/link' }, 1)).rejects.toThrow(/escapes/)
    await expect(handler('fs/write_text_file', { path: '/workspace/attachments/a.txt', content: 'x' }, 1)).rejects.toThrow(/outside|attachment/)
    await expect(handler('terminal/create', {}, 1)).rejects.toThrow(/unavailable/)
    expect(reads).toEqual(['/workspace/src/a.ts'])
    const controller = new AbortController()
    const cancelled = createAntigravityFilesystemHandler(clientFilesystem(), controller.signal)
    controller.abort()
    await expect(cancelled('fs/read_text_file', { path: '/workspace/src/a.ts' }, 1)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('Antigravity official ACP transport', () => {
  it('rejects an invalid cancellation grace period before spawning', () => {
    expect(() => new AntigravityProvider({ ...config(), cancelGraceMs: 0 }, { connectionFactory: () => new FakeConnection() })).toThrow(/positive safe integer/)
    expect(() => spawnAntigravityAcp(launchSpec(), { cancelGraceMs: 0 })).toThrow(/cancelGraceMs/)
  })

  it('waits for a cancelled native prompt to settle', async () => {
    const script = [
      "import readline from 'node:readline'",
      "const output = value => process.stdout.write(JSON.stringify(value) + String.fromCharCode(10))",
      "const input = readline.createInterface({ input: process.stdin })",
      "let promptId",
      "for await (const line of input) { const request = JSON.parse(line); if (request.method === 'initialize') output({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentInfo: { name: 'antigravity-acp' }, agentCapabilities: { sessionCapabilities: { resume: {} } } } }); else if (request.method === 'session/prompt') promptId = request.id; else if (request.method === 'session/cancel') { output({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'native', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'settled' } } } }); output({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } }); } }",
    ].join(';')
    const connection = spawnAntigravityAcp({ command: process.execPath, args: ['--input-type=module', '-e', script], cwd: process.cwd(), env: process.env, shell: false, extendEnv: false }, { cancelGraceMs: 100 })
    await connection.request('initialize', { protocolVersion: 1 })
    let settled = false
    connection.setNotificationHandler(method => { if (method === 'session/update') settled = true })
    const controller = new AbortController()
    const prompt = connection.request('session/prompt', { sessionId: 'native', prompt: [{ type: 'text', text: 'go' }] }, controller.signal)
    controller.abort()
    await expect(prompt).rejects.toThrow(/aborted/)
    expect(settled).toBe(true)
    await connection.close()
  })

  it('round-trips SDK requests, agent callbacks, notifications, redaction, and teardown', async () => {
    const script = [
      "import readline from 'node:readline'",
      "const output = value => process.stdout.write(JSON.stringify(value) + String.fromCharCode(10))",
      "const input = readline.createInterface({ input: process.stdin })",
      "for await (const line of input) {",
      "  const request = JSON.parse(line)",
      "  if (request.method === 'initialize') { output({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: 'test' } } }) } else if (request.method === 'session/prompt') { process.stderr.write('Bearer secret-'); setTimeout(() => process.stderr.write('token' + String.fromCharCode(10)), 5); output({ jsonrpc: '2.0', id: 9, method: 'session/request_permission', params: { sessionId: 'native', toolCall: { toolCallId: 'tool-1', title: 'native' }, options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow' }] } }); output({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'native', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'transport-ok Open the following link to authenticate the ACP server: not-a-url' } } } }); output({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) } else if (request.method === 'session/cancel') { output({ jsonrpc: '2.0', id: request.id, result: null }) } }",



    ].join(';')
    const stderr: string[] = []
    let receiveStderr!: () => void
    const stderrReceived = new Promise<void>(resolve => { receiveStderr = resolve })
    const updates: string[] = []
    const connection = spawnAntigravityAcp({ command: process.execPath, args: ['--input-type=module', '-e', script], cwd: process.cwd(), env: process.env, shell: false, extendEnv: false }, { maxLineBytes: 4096, onStderr: text => { stderr.push(text); receiveStderr(); throw new Error('diagnostic callback failed') } })
    let initialized: unknown
    try {
      initialized = await connection.request('initialize', { protocolVersion: 1 })
    } catch (error) {
      throw new Error(String(error) + ' initialize-stderr=' + stderr.join(''))
    }
    expect(initialized).toMatchObject({ protocolVersion: 1 })
    connection.setRequestHandler(async (method, params) => { expect(method).toBe('session/request_permission'); expect(params).toBeTruthy(); return { outcome: { outcome: 'selected', optionId: 'allow_once' } } })
    connection.setNotificationHandler((method, params) => { updates.push(method + ':' + JSON.stringify(params)) })
    let prompted: unknown
    try {
      prompted = await connection.request('session/prompt', { sessionId: 'native', prompt: [{ type: 'text', text: 'go' }] })
    } catch (error) {
      throw new Error(String(error) + ' stderr=' + stderr.join(''))
    }
    expect(prompted).toMatchObject({ stopReason: 'end_turn' })
    expect(updates[0]).toContain('session/update')
    await stderrReceived
    expect(stderr.join('')).not.toContain('secret-token')
    expect(stderr.join('')).toContain('Bearer [REDACTED]')
    await connection.close()
  })
})
