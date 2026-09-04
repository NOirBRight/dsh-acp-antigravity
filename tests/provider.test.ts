import { describe, expect, it } from 'vitest'
import { createSessionModelRoute, optionId, sessionId, turnId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import {
  ANTIGRAVITY_CLIENT_CAPABILITIES,
  ANTIGRAVITY_DEFAULT_MODEL,
  ANTIGRAVITY_PERMISSION_MODES,
  AntigravityProvider,
  buildAntigravityEnvironment,
  createAntigravityFilesystemHandler,
  createAntigravitySettingsEditor,
  mapPermissionMode,
  parseAntigravityAuthPrelude,
  parseAntigravityAuthorizationUrl,
  parseAntigravityModels,
  redactAntigravityText,
  resolveAntigravityProfileDirectory,
  validateAntigravityIdentity,
  type AntigravityLaunchSpec,
} from '../src/index.js'
import { spawnAntigravityAcp, type AcpConnection, type AcpRequestHandler, type AcpNotificationHandler } from '../src/protocol.js'

interface FakeConnectionOptions {
  readonly authenticationAvailable?: boolean
  readonly updates?: readonly unknown[]
  readonly promptResponse?: unknown
}

class FakeConnection implements AcpConnection {
  readonly calls: { readonly method: string; readonly params: unknown }[] = []
  private requestHandler: AcpRequestHandler | undefined
  private notificationHandler: AcpNotificationHandler | undefined
  private closed = false

  constructor(private readonly options: FakeConnectionOptions = {}) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'initialize') return { protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: '1.2.3' }, agentCapabilities: { sessionResume: true } }
    if (method === 'authenticate') {
      if (this.options.authenticationAvailable === false) throw new Error('method not found')
      return {}
    }
    if (method === 'session/new' || method === 'session/resume' || method === 'session/load') return { sessionId: 'native-1', configOptions: [{ id: 'model', name: 'Model', type: 'select', options: [{ value: 'gemini-pro', name: 'Gemini Pro' }] }] }
    if (method === 'session/set_config_option' || method === 'session/set_mode') return {}
    if (method === 'session/prompt') {
      const updates = this.options.updates ?? [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
        { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', title: 'read', status: 'completed', locations: ['/workspace/src/a.ts'] },
      ]
      for (const update of updates) this.notificationHandler?.('session/update', { sessionId: 'native-1', update })
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
  return { executablePath: '/opt/agy/agy_acp_server', harnessPath: '/opt/agy/localharness_external', stateDirectory: '/tmp/dsh-test', instanceId: 'default', platform: 'linux' as const }
}
function route(model = 'gemini-pro') { return createSessionModelRoute('external-agent', 'antigravity', model) }
function launchSpec(): AntigravityLaunchSpec { return { command: '/opt/agy/agy_acp_server', args: ['--uid='], cwd: '/workspace', env: {}, shell: false, extendEnv: false } }
function host(events: string[] = []): ExternalAgentTurnHost {
  return {
    publish: async event => { events.push(event.type) },
    requestPermission: async request => ({ kind: 'allow-once', optionId: request.options[0]?.optionId ?? optionId('fallback') }),
    requestUserInput: async () => ({ answers: ['answer'] }),
  }
}

describe('Antigravity mapping and safety', () => {
  it('maps all public permission modes and advertises client capabilities', () => {
    expect(mapPermissionMode('approval-required')).toBe('default')
    expect(mapPermissionMode('auto-accept-edits')).toBe('auto_edit')
    expect(mapPermissionMode('full-access')).toBe('yolo')
    expect(ANTIGRAVITY_PERMISSION_MODES).toEqual(['approval-required', 'auto-accept-edits', 'full-access'])
    expect(ANTIGRAVITY_CLIENT_CAPABILITIES.terminal).toBe(false)
  })

  it('parses grouped model options and preserves a stable default alias', () => {
    const models = parseAntigravityModels([{ id: 'model', name: 'Model', options: [{ value: 'gemini-pro', name: 'Gemini Pro' }, { value: 'gemini-pro', name: 'Duplicate' }] }])
    expect(models.map(model => model.id)).toEqual([ANTIGRAVITY_DEFAULT_MODEL, 'gemini-pro'])
  })

  it('validates protocol identity and rejects another ACP executable', () => {
    expect(validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: '1' }, agentCapabilities: {} })).toMatchObject({ agentName: 'antigravity-acp', supportsResume: false })
    expect(() => validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'Other Agent' } })).toThrow(/not antigravity-acp/)
    expect(() => validateAntigravityIdentity({ protocolVersion: 2, agentInfo: { name: 'antigravity-acp' } })).toThrow(/version/)
    expect(() => validateAntigravityIdentity({ protocolVersion: 1, agentInfo: { name: 'antigravity-acp' } })).toThrow(/capabilities/)
  })

  it('keeps OAuth links safe and redacts credential-looking diagnostics', () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=state123&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2F'
    expect(parseAntigravityAuthorizationUrl(url).redirectUri).toBe('http://127.0.0.1:8765/')
    expect(parseAntigravityAuthPrelude('notice\nOpen the following link to authenticate the ACP server: ' + url + '\n')).toMatchObject({ state: 'state123' })
    expect(() => parseAntigravityAuthorizationUrl(url.replace('127.0.0.1', 'evil.example'))).toThrow(/invalid/)
    const diagnostic = redactAntigravityText('Bearer secret-token https://x.test/?code=private&state=state123 AIza' + 'A'.repeat(24))
    expect(diagnostic).not.toContain('secret-token')
    expect(diagnostic).not.toContain('private')
    expect(diagnostic).toContain('[REDACTED]')
  })

  it('isolates profiles and strips ambient Google credentials from process env', () => {
    expect(resolveAntigravityProfileDirectory('/tmp/dsh', 'a')).not.toBe(resolveAntigravityProfileDirectory('/tmp/dsh', 'b'))
    const env = buildAntigravityEnvironment({ baseEnv: { PATH: '/bin', GOOGLE_API_KEY: 'secret', GEMINI_API_KEY: 'secret2' }, profileDirectory: '/tmp/profile', harnessPath: '/tmp/harness' })
    expect(env.PATH).toBe('/bin')
    expect(env.GOOGLE_API_KEY).toBeUndefined()
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.GEMINI_HOME).toBe('/tmp/profile')
    expect(env.ANTIGRAVITY_HARNESS_PATH).toBe('/tmp/harness')
  })
})

describe('Antigravity provider lifecycle', () => {
  it('discovers exact models and drives a native turn without duplicating tools', async () => {
    const connections: FakeConnection[] = []
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => { const connection = new FakeConnection(); connections.push(connection); return connection } })
    await expect(provider.listModels()).resolves.toEqual([{ id: 'default', name: 'Account default', supportedModes: ['approval-required', 'auto-accept-edits', 'full-access'] }, { id: 'gemini-pro', name: 'Gemini Pro', supportedModes: ['approval-required', 'auto-accept-edits', 'full-access'] }])
    const session = await provider.openSession({ route: route(), session: sessionId('dsh-session'), permissionMode: 'approval-required', signal: new AbortController().signal })
    const events: string[] = []
    const result = await session.runTurn({ turn: turnId('turn'), prompt: 'read', attachments: [{ name: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }, { name: 'source', path: '/workspace/src/a.ts' }], permissionMode: 'approval-required', signal: new AbortController().signal }, host(events))
    expect(result).toMatchObject({ status: 'completed', text: 'hello' })
    expect(events).toEqual(['assistant-delta', 'tool-activity', 'usage', 'turn-result'])
    const prompt = connections[1]?.calls.find(call => call.method === 'session/prompt')
    expect(prompt?.params).toMatchObject({ prompt: [{ type: 'text', text: 'read' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }, { type: 'resource_link', name: 'source', uri: '/workspace/src/a.ts' }] })
    expect(connections[1]?.calls.map(call => call.method)).toEqual(['initialize', 'authenticate', 'session/new', 'session/set_config_option', 'session/set_mode', 'session/set_mode', 'session/prompt'])
    await session.dispose()
    expect(connections[1]?.isClosed).toBe(true)
  })

  it('uses the requested workspace root as the native session cwd', async () => {
    const cwds: string[] = []
    const provider = new AntigravityProvider(config(), { cwd: '/fallback', launchSpec: async (_config, cwd) => { cwds.push(cwd); return launchSpec() }, connectionFactory: () => new FakeConnection() })
    const session = await provider.openSession({ route: route(), session: sessionId('workspace'), workspaceRoot: '/project', permissionMode: 'approval-required', signal: new AbortController().signal })
    expect(cwds).toEqual(['/project'])
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

  it('shows the negotiated version and native-terminal scope in Settings', async () => {
    const provider = new AntigravityProvider(config(), {
      cwd: '/workspace',
      installationProbe: { stat: async () => ({ isFile: true, mode: 0o755 }) },
      launchSpec: async () => launchSpec(),
      connectionFactory: () => new FakeConnection(),
    })
    await expect(provider.validateInstallation()).resolves.toMatchObject({ version: '1.2.3' })
    const fields = createAntigravitySettingsEditor(config(), provider).snapshot().fields
    expect(fields.find(field => field.key === 'version')?.value).toBe('1.2.3')
    expect(fields.find(field => field.key === 'fullAccessWarning')?.value).toContain('outside DSH client-filesystem roots')
  })

  it('rejects new work after provider disposal', async () => {
    const provider = new AntigravityProvider(config(), { connectionFactory: () => new FakeConnection() })
    await provider.dispose()
    await expect(provider.listModels()).rejects.toThrow(/disposed/)
    await expect(provider.signIn()).rejects.toThrow(/disposed/)
  })

  it('requires explicit full-access confirmation and audits before startup', async () => {
    const audit: string[] = []
    let opened = 0
    const provider = new AntigravityProvider(config(), { cwd: '/workspace', launchSpec: async () => launchSpec(), connectionFactory: () => { opened++; return new FakeConnection() }, auditFullAccess: entry => { audit.push(entry.mode) } })
    await expect(provider.openSession({ route: route(), session: sessionId('s'), permissionMode: 'full-access', signal: new AbortController().signal })).rejects.toThrow(/confirmation/)
    expect(opened).toBe(0)
    await provider.openSession({ route: route(), session: sessionId('s'), permissionMode: 'full-access', fullAccessConfirmed: true, fullAccessAuditId: 'audit-1', signal: new AbortController().signal })
    expect(audit).toEqual(['full-access'])
    expect(opened).toBe(1)
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
  })
})

describe('Antigravity official ACP transport', () => {
  it('round-trips SDK requests, agent callbacks, notifications, redaction, and teardown', async () => {
    const script = [
      "import readline from 'node:readline'",
      "const output = value => process.stdout.write(JSON.stringify(value) + String.fromCharCode(10))",
      "const input = readline.createInterface({ input: process.stdin })",
      "for await (const line of input) {",
      "  const request = JSON.parse(line)",
      "  if (request.method === 'initialize') { output({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: 'test' } } }) } else if (request.method === 'session/prompt') { process.stderr.write('Bearer secret-token' + String.fromCharCode(10)); output({ jsonrpc: '2.0', id: 9, method: 'session/request_permission', params: { sessionId: 'native', toolCall: { toolCallId: 'tool-1', title: 'native' }, options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow' }] } }); output({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'native', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'transport-ok' } } } }); output({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) } else if (request.method === 'session/cancel') { output({ jsonrpc: '2.0', id: request.id, result: null }) } }",



    ].join(';')
    const stderr: string[] = []
    const updates: string[] = []
    const connection = spawnAntigravityAcp({ command: process.execPath, args: ['--input-type=module', '-e', script], cwd: process.cwd(), env: process.env, shell: false, extendEnv: false }, { maxLineBytes: 4096, onStderr: text => stderr.push(text) })
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
    expect(stderr.join('')).not.toContain('secret-token')
    expect(stderr.join('')).toContain('Bearer [REDACTED]')
    await connection.close()
  })
})
