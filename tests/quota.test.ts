/** Focused Host quota tests: no network, no CLI, no real credentials. */
import { providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAntigravityProfileDirectory } from '../src/auth.js'
import {
  QUOTA_ENDPOINT,
  decodeQuotaSnapshot,
  type AntigravityQuotaSnapshot,
} from '../src/client-contract.js'
import {
  ANTIGRAVITY_CCPA_DAILY_ENDPOINT,
  ANTIGRAVITY_CCPA_PROD_ENDPOINT,
  ANTIGRAVITY_OAUTH_TOKEN_URL,
  createAntigravityQuotaReader,
} from '../src/quota.js'
import { createAcpSettingsRpcHandler } from '../src/rpc.js'
import type { AntigravityProviderConfig } from '../src/types.js'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

const frozenNow = Date.parse('2026-09-06T00:00:00.000Z')
const tokenBody = {
  client_id: 'test-client-id',
  client_secret: 'test-client-secret',
  refresh_token: 'rt-old',
  token_uri: ANTIGRAVITY_OAUTH_TOKEN_URL,
  scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'],
}
const discoveryBody = {
  currentTier: { id: 'free-tier' },
  paidTier: { id: 'free-tier' },
  cloudaicompanionProject: 'proj-from-discovery',
}
const quotaBody = {
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        { bucketId: 'gemini-weekly', displayName: 'Gemini Models', window: 'weekly', remainingFraction: 0.42, remainingAmount: '420', disabled: false, resetTime: '2026-09-08T00:00:00Z' },
        { bucketId: 'gemini-5h' },
      ],
    },
  ],
}

interface CapturedRequest {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body?: string
  readonly redirect?: string
}

function mockFetch(handler: (url: string) => Response | Promise<Response>, calls: CapturedRequest[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    const headers: Record<string, string> = {}
    const raw = init?.headers
    if (raw instanceof Headers) raw.forEach((value, key) => { headers[key] = value })
    else if (Array.isArray(raw)) for (const [key, value] of raw) headers[key] = value
    else if (raw !== undefined) Object.assign(headers, raw)
    calls.push({ url: target, headers, ...(typeof init?.body === 'string' ? { body: init.body } : {}), ...(init?.redirect === undefined ? {} : { redirect: init.redirect }) })
    return handler(target)
  }) as typeof fetch
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function setupProfile(body: unknown = tokenBody): Promise<{ config: AntigravityProviderConfig; tokenPath: string; stateDirectory: string }> {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'dsh-agy-quota-'))
  homes.push(stateDirectory)
  const instanceId = providerInstanceId('quota-test')
  const profileDirectory = resolveAntigravityProfileDirectory(stateDirectory, instanceId)
  await mkdir(join(profileDirectory, 'antigravity-acp'), { recursive: true, mode: 0o700 })
  const tokenPath = join(profileDirectory, 'antigravity-acp', 'acp_token.json')
  await writeFile(tokenPath, JSON.stringify(body))
  const config: AntigravityProviderConfig = { executablePath: '/opt/antigravity/agy_acp_server', harnessPath: '/opt/antigravity/localharness_external', stateDirectory, instanceId }
  return { config, tokenPath, stateDirectory }
}

function happyFetch(calls: CapturedRequest[], overrides: { discovery?: unknown; quota?: unknown; quotaStatus?: number } = {}): typeof fetch {
  return mockFetch(url => {
    if (url === ANTIGRAVITY_OAUTH_TOKEN_URL) return jsonResponse({ access_token: 'at-test', expires_in: 3600, token_type: 'Bearer' })
    if (url.endsWith(':loadCodeAssist')) return jsonResponse(overrides.discovery ?? discoveryBody)
    if (url.includes(':retrieveUserQuotaSummary')) return jsonResponse(overrides.quota ?? quotaBody, overrides.quotaStatus ?? 200)
    throw new Error('unexpected quota request: ' + url)
  }, calls)
}

describe('Antigravity quota reader', () => {
  it('sends the structured ACP User-Agent and preserves groups with absent fields', async () => {
    const { config } = await setupProfile()
    const calls: CapturedRequest[] = []
    const reader = createAntigravityQuotaReader(config, {
      fetchFn: happyFetch(calls),
      now: () => frozenNow,
      os: 'linux',
      arch: 'x86_64',
      getRuntimeVersion: () => 'agy_acp_server_20260818_01_RC01',
    })
    const snapshot = await reader.snapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.observedAt).toBe('2026-09-06T00:00:00.000Z')
    expect(snapshot.tier).toEqual({ current: 'free-tier', paid: 'free-tier' })
    expect(snapshot.groups).toHaveLength(1)
    expect(snapshot.groups[0]?.buckets).toHaveLength(2)
    expect(snapshot.groups[0]?.buckets[0]).toMatchObject({ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.42, resetTime: '2026-09-08T00:00:00Z' })
    const sparse = snapshot.groups[0]?.buckets[1]
    expect(sparse).toEqual({ bucketId: 'gemini-5h' })
    expect('remainingFraction' in (sparse ?? {})).toBe(false)
    const agent = 'antigravity/acp/agy_acp_server_20260818_01_rc01 (aidev_client; os_type=linux; arch=x86_64; host_path=dsh-acp-antigravity/0.1.0; proxy_client=antigravity/sdk)'
    const byUrl = new Map(calls.map(call => [call.url, call]))
    expect(byUrl.get(ANTIGRAVITY_OAUTH_TOKEN_URL)?.headers['Authorization']).toBeUndefined()
    for (const url of [ANTIGRAVITY_CCPA_PROD_ENDPOINT + '/v1internal:loadCodeAssist', ANTIGRAVITY_CCPA_DAILY_ENDPOINT + '/v1internal:retrieveUserQuotaSummary']) {
      expect(byUrl.get(url)?.headers['User-Agent']).toBe(agent)
      expect(byUrl.get(url)?.headers['Authorization']).toBe('Bearer at-test')
      expect(byUrl.get(url)?.redirect).toBe('error')
    }
    expect(byUrl.get(ANTIGRAVITY_OAUTH_TOKEN_URL)?.redirect).toBe('error')
    expect(byUrl.get(ANTIGRAVITY_OAUTH_TOKEN_URL)?.body).toContain('grant_type=refresh_token')
  })

  it('reuses the in-memory token and never rewrites the profile or leaks secrets', async () => {
    const { config, tokenPath } = await setupProfile()
    const before = await readFile(tokenPath, 'utf8')
    const calls: CapturedRequest[] = []
    const reader = createAntigravityQuotaReader(config, { fetchFn: happyFetch(calls), now: () => frozenNow })
    await reader.snapshot()
    const second = await reader.snapshot()
    expect(second.status).toBe('ready')
    expect(calls.filter(call => call.url === ANTIGRAVITY_OAUTH_TOKEN_URL)).toHaveLength(1)
    expect(calls.filter(call => call.url.includes(':retrieveUserQuotaSummary'))).toHaveLength(1)
    expect(await readFile(tokenPath, 'utf8')).toBe(before)
    const rendered = JSON.stringify(second)
    expect(rendered).not.toContain('rt-old')
    expect(rendered).not.toContain('test-client-secret')
    expect(rendered).not.toContain('proj-from-discovery')
  })

  it('selects the daily endpoint for personal tiers and prod for enterprise', async () => {
    const { config } = await setupProfile()
    const calls: CapturedRequest[] = []
    const reader = createAntigravityQuotaReader(config, { fetchFn: happyFetch(calls), now: () => frozenNow, cacheTtlMs: 0 })
    await reader.snapshot()
    expect(calls.some(call => call.url === ANTIGRAVITY_CCPA_DAILY_ENDPOINT + '/v1internal:retrieveUserQuotaSummary')).toBe(true)
    calls.length = 0
    const enterprise = happyFetch(calls, { discovery: { ...discoveryBody, paidTier: { id: 'enterprise-tier', usesGcpTos: true } } })
    const enterpriseReader = createAntigravityQuotaReader(config, { fetchFn: enterprise, now: () => frozenNow, cacheTtlMs: 0 })
    await enterpriseReader.snapshot()
    expect(calls.some(call => call.url === ANTIGRAVITY_CCPA_PROD_ENDPOINT + '/v1internal:retrieveUserQuotaSummary')).toBe(true)
  })

  it('rejects quota without a validated project and tier instead of reusing stale data', async () => {
    const { config } = await setupProfile()
    const calls: CapturedRequest[] = []
    const reader = createAntigravityQuotaReader(config, {
      fetchFn: happyFetch(calls, { discovery: { ineligibleTiers: [{ reasonCode: 'UNSUPPORTED_CLIENT', tierId: 'free-tier' }] } }),
      now: () => frozenNow,
    })
    const snapshot = await reader.snapshot()
    expect(snapshot.status).toBe('not-entitled')
    expect(snapshot.message).toContain('UNSUPPORTED_CLIENT')
    expect(snapshot.groups).toEqual([])
    expect(calls.some(call => call.url.includes(':retrieveUserQuotaSummary'))).toBe(false)
  })

  it('maps authentication and client-identification failures explicitly', async () => {
    const { config } = await setupProfile()
    const unauthorized: CapturedRequest[] = []
    const denied = createAntigravityQuotaReader(config, {
      fetchFn: happyFetch(unauthorized, { quotaStatus: 401, quota: { error: { message: 'denied' } } }),
      now: () => frozenNow,
    })
    expect((await denied.snapshot()).status).toBe('authentication-required')
    const misidentified: CapturedRequest[] = []
    const wrongClient = createAntigravityQuotaReader(config, {
      fetchFn: happyFetch(misidentified, { quotaStatus: 403, quota: { error: { details: [{ reason: 'UNSUPPORTED_CLIENT' }] } } }),
      now: () => frozenNow,
    })
    const snapshot = await wrongClient.snapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.message).toContain('client identification')
  })

  it('singleflights concurrent snapshots into one refresh', async () => {
    const { config } = await setupProfile()
    const calls: CapturedRequest[] = []
    let releaseQuota!: (value: Response) => void
    const gate = new Promise<Response>(resolve => { releaseQuota = resolve })
    const reader = createAntigravityQuotaReader(config, {
      fetchFn: mockFetch(url => {
        if (url === ANTIGRAVITY_OAUTH_TOKEN_URL) return jsonResponse({ access_token: 'at-test', expires_in: 3600 })
        if (url.endsWith(':loadCodeAssist')) return jsonResponse(discoveryBody)
        return gate
      }, calls),
      now: () => frozenNow,
    })
    const first = reader.snapshot()
    const second = reader.snapshot()
    await new Promise(resolve => setTimeout(resolve, 10))
    releaseQuota(jsonResponse(quotaBody))
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(calls.filter(call => call.url === ANTIGRAVITY_OAUTH_TOKEN_URL)).toHaveLength(1)
    expect(calls.filter(call => call.url.includes(':retrieveUserQuotaSummary'))).toHaveLength(1)
  })

  it('discards late responses after an account change', async () => {
    const { config, tokenPath } = await setupProfile()
    const calls: CapturedRequest[] = []
    let releaseQuota!: (value: Response) => void
    const gate = new Promise<Response>(resolve => { releaseQuota = resolve })
    const reader = createAntigravityQuotaReader(config, {
      fetchFn: mockFetch(url => {
        if (url === ANTIGRAVITY_OAUTH_TOKEN_URL) return jsonResponse({ access_token: 'at-old', expires_in: 3600 })
        if (url.endsWith(':loadCodeAssist')) return jsonResponse(discoveryBody)
        return gate.then(() => jsonResponse(quotaBody))
      }, calls),
      now: () => frozenNow,
    })
    const stale = reader.snapshot()
    while (!calls.some(call => call.url.includes(':retrieveUserQuotaSummary'))) await new Promise(resolve => setTimeout(resolve, 5))
    await writeFile(tokenPath, JSON.stringify({ ...tokenBody, refresh_token: 'rt-new' }))
    releaseQuota(jsonResponse(quotaBody))
    const first = await stale
    expect(first.status).toBe('error')
    expect(first.message).toContain('account changed')
    expect(first.groups).toEqual([])
    const second = await reader.snapshot()
    expect(second.status).toBe('ready')
    const tokenCalls = calls.filter(call => call.url === ANTIGRAVITY_OAUTH_TOKEN_URL)
    expect(tokenCalls).toHaveLength(2)
    expect(tokenCalls[1]?.body).toContain('refresh_token=rt-new')
  })

  it('rejects symlinked credential files and untrusted token endpoints', async () => {
    const linked = await setupProfile()
    await rm(linked.tokenPath)
    await symlink(join(tmpdir(), 'dsh-agy-quota-elsewhere.json'), linked.tokenPath)
    const linkedCalls: CapturedRequest[] = []
    const linkedReader = createAntigravityQuotaReader(linked.config, { fetchFn: happyFetch(linkedCalls), now: () => frozenNow })
    const symlinkSnapshot = await linkedReader.snapshot()
    expect(symlinkSnapshot.status).toBe('error')
    expect(symlinkSnapshot.message).toContain('symbolic link')
    expect(linkedCalls).toHaveLength(0)
    const { config } = await setupProfile({ ...tokenBody, token_uri: 'https://example.invalid/token' })
    const evilCalls: CapturedRequest[] = []
    const evilReader = createAntigravityQuotaReader(config, { fetchFn: happyFetch(evilCalls), now: () => frozenNow })
    expect((await evilReader.snapshot()).status).toBe('authentication-required')
    expect(evilCalls).toHaveLength(0)
  })

  it('bounds hung requests with a timeout', async () => {
    const { config } = await setupProfile()
    const calls: CapturedRequest[] = []
    const hanging: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(_url), headers: {} })
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('The operation was aborted.', 'AbortError')) })
      })
      throw new Error('unreachable')
    }) as typeof fetch
    const reader = createAntigravityQuotaReader(config, { fetchFn: hanging, now: () => frozenNow, timeoutMs: 20 })
    const snapshot = await reader.snapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.message).toMatch(/timed out|transport/)
    expect(calls).toHaveLength(1)
  })

  it('requires sign-in when the profile is absent', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'dsh-agy-quota-'))
    homes.push(stateDirectory)
    const config: AntigravityProviderConfig = { executablePath: '', harnessPath: '', stateDirectory, instanceId: providerInstanceId('quota-test') }
    const calls: CapturedRequest[] = []
    const reader = createAntigravityQuotaReader(config, { fetchFn: happyFetch(calls), now: () => frozenNow })
    const snapshot = await reader.snapshot()
    expect(snapshot.status).toBe('authentication-required')
    expect(snapshot.message).toContain('Sign in')
    expect(calls).toHaveLength(0)
  })
})

describe('quota RPC contract', () => {
  it('decodes snapshots round-trip and rejects invalid payloads', async () => {
    const { config } = await setupProfile()
    const calls: CapturedRequest[] = []
    const reader = createAntigravityQuotaReader(config, { fetchFn: happyFetch(calls), now: () => frozenNow })
    const snapshot = await reader.snapshot()
    const decoded = decodeQuotaSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(decoded).toEqual(snapshot)
    expect(decodeQuotaSnapshot({ status: 'ready' })).toBeUndefined()
    expect(decodeQuotaSnapshot({ status: 'platinum', groups: [], observedAt: snapshot.observedAt })).toBeUndefined()
    expect(decodeQuotaSnapshot({ status: 'ready', groups: [{ buckets: [{ remainingFraction: Number.NaN }] }], observedAt: snapshot.observedAt })?.groups[0]?.buckets[0]).toEqual({})
  })

  it('exposes a sanitized quota endpoint through the settings RPC', async () => {
    const fixed: AntigravityQuotaSnapshot = { status: 'ready', groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.9 }] }], observedAt: '2026-09-06T00:00:00.000Z' }
    const handler = createAcpSettingsRpcHandler({
      snapshot: async () => ({ title: 'External Agents', rows: [] }),
      catalog: async () => ({ groups: [] }),
      quota: async () => fixed,
      applyConfig: async () => {},
      run: async () => ({}),
    })
    const result = await handler(QUOTA_ENDPOINT, {})
    expect(result).toEqual({ ok: true, value: fixed })
    expect(JSON.stringify(result)).not.toContain('refresh_token')
  })
})
