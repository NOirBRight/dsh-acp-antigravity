/** CLI-free personal-OAuth account quota from the vendor quota-summary API.
 *
 * The Host reuses the selected isolated ACP profile: it refreshes the stored
 * Google OAuth credential in memory only (the ACP runtime owns the credential
 * file and is never overwritten here), resolves project and endpoint through
 * loadCodeAssist with the vendor tier rules, then reads
 * v1internal:retrieveUserQuotaSummary. Groups and buckets pass through
 * untouched; missing fields stay absent and quota is never estimated from
 * token consumption. No CLI, desktop service, or model prompt is involved.
 */
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { basename, join } from 'node:path'
import { antigravitySignInRequiredMessage, resolveAntigravityProfileDirectory } from './auth.js'
import type {
  AntigravityQuotaBucket,
  AntigravityQuotaGroup,
  AntigravityQuotaSnapshot,
  AntigravityQuotaStatus,
} from './client-contract.js'
import { isRecord } from './decode.js'
import { ANTIGRAVITY_RELEASE_VERSION } from './release.js'
import type { AntigravityProviderConfig } from './types.js'

/** Fixed Google OAuth token endpoint; the only recipient of refresh credentials. */
export const ANTIGRAVITY_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Bootstrap endpoint for loadCodeAssist; the quota endpoint follows vendor tier rules. */
export const ANTIGRAVITY_CCPA_PROD_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
/** Personal-OAuth quota endpoint for non-enterprise tiers. */
export const ANTIGRAVITY_CCPA_DAILY_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
/** Bound for one quota HTTP request. */
export const ANTIGRAVITY_QUOTA_TIMEOUT_MS = 20_000
/** In-memory quota result lifetime; stale tiles keep their own observation time. */
export const ANTIGRAVITY_QUOTA_CACHE_TTL_MS = 60_000

const trustedHosts = new Set(['oauth2.googleapis.com', 'cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com'])
const tokenFileName = ['antigravity-acp', 'acp_token.json']
const cloudPlatformScope = 'https://www.googleapis.com/auth/cloud-platform'

/** Injectable seams for deterministic quota tests. */
export interface AntigravityQuotaReaderOptions {
  readonly fetchFn?: typeof fetch
  readonly timeoutMs?: number
  readonly cacheTtlMs?: number
  readonly now?: () => number
  /** Actual negotiated runtime version; falls back to the executable name, then the pinned release. */
  readonly getRuntimeVersion?: () => string | undefined
  readonly os?: string
  readonly arch?: string
}

interface LoadedCredential {
  readonly clientId: string
  readonly clientSecret: string
  readonly refreshToken: string
}

interface CredentialLoad {
  readonly key: string | null
  readonly credentials?: LoadedCredential
  readonly failure?: { readonly status: AntigravityQuotaStatus; readonly message: string }
}

/** Build the vendor structured ACP User-Agent for quota backend calls.
 * @param input runtime version, truthful host surface, and host platform.
 * @returns the aidev structured User-Agent header value.
 */
export function buildAntigravityQuotaUserAgent(input: {
  readonly runtimeVersion: string
  readonly clientName: string
  readonly clientVersion: string
  readonly os: string
  readonly arch: string
}): string {
  const version = sanitizeVersion(input.runtimeVersion)
  const surface = sanitizeName(input.clientName)
  const surfaceVersion = sanitizeVersion(input.clientVersion)
  return 'antigravity/acp/' + version + ' (aidev_client; os_type=' + input.os + '; arch=' + input.arch + '; host_path=' + surface + '/' + surfaceVersion + '; proxy_client=antigravity/sdk)'
}

function sanitizeName(value: string): string {
  if (value.trim() === '') return 'unknown'
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

function sanitizeVersion(value: string): string {
  if (value.trim() === '') return 'unknown'
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '-')
}

/** Read-only Host quota reader scoped to one provider instance. */
export class AntigravityQuotaReader {
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private readonly getRuntimeVersion?: () => string | undefined
  private readonly os: string
  private readonly arch: string
  private generation = 0
  private credentialKey: string | null | undefined
  private accessToken: { readonly token: string; readonly expiresAt: number; readonly key: string } | undefined
  private cachedQuota: { readonly snapshot: AntigravityQuotaSnapshot; readonly fetchedAt: number; readonly key: string } | undefined
  private inflight: Promise<AntigravityQuotaSnapshot> | undefined

  /** @param config the selected instance profile; never written by this reader.
   * @param options injectable fetch, bounds, clock, version, and platform.
   */
  constructor(private readonly config: AntigravityProviderConfig, options: AntigravityQuotaReaderOptions = {}) {
    const timeoutMs = options.timeoutMs ?? ANTIGRAVITY_QUOTA_TIMEOUT_MS
    const cacheTtlMs = options.cacheTtlMs ?? ANTIGRAVITY_QUOTA_CACHE_TTL_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('quota timeoutMs must be a positive safe integer')
    if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0) throw new RangeError('quota cacheTtlMs must be a non-negative safe integer')
    this.fetchFn = options.fetchFn ?? fetch
    this.timeoutMs = timeoutMs
    this.cacheTtlMs = cacheTtlMs
    this.now = options.now ?? Date.now
    if (options.getRuntimeVersion !== undefined) this.getRuntimeVersion = options.getRuntimeVersion
    this.os = options.os ?? (platform() === 'win32' ? 'windows' : platform())
    this.arch = options.arch ?? (arch() === 'x64' ? 'x86_64' : arch())
  }

  /** Drop cached tokens and quota so the next call re-reads the profile.
   * Late in-flight responses check the generation and never restore old data.
   */
  invalidate(): void {
    this.generation += 1
    this.accessToken = undefined
    this.cachedQuota = undefined
  }

  /** Return the sanitized quota snapshot, sharing one refresh between concurrent callers.
   * @param signal caller abort; aborts propagate instead of becoming snapshots.
   * @returns the sanitized snapshot for the UI.
   */
  async snapshot(signal?: AbortSignal): Promise<AntigravityQuotaSnapshot> {
    if (this.inflight !== undefined) return this.inflight
    const task = this.refresh(signal)
    this.inflight = task
    try {
      return await task
    } finally {
      if (this.inflight === task) this.inflight = undefined
    }
  }

  private async refresh(signal?: AbortSignal): Promise<AntigravityQuotaSnapshot> {
    const startedGeneration = this.generation
    const observedAt = new Date(this.now()).toISOString()
    const loaded = await this.loadCredentials()
    this.syncKey(loaded.key)
    if (loaded.failure !== undefined || loaded.credentials === undefined) {
      const failure = loaded.failure ?? { status: 'authentication-required' as const, message: antigravitySignInRequiredMessage() }
      return { status: failure.status, groups: [], observedAt, message: failure.message }
    }
    const startedKey = loaded.key
    if (startedKey === null) return { status: 'authentication-required', groups: [], observedAt, message: antigravitySignInRequiredMessage() }
    const cached = this.cachedQuota
    if (cached !== undefined && cached.key === startedKey && this.now() - cached.fetchedAt < this.cacheTtlMs) return cached.snapshot
    const result = await this.fetchFresh(loaded.credentials, startedKey, observedAt, signal)
    const end = await this.loadCredentials()
    this.syncKey(end.key)
    if (end.key !== startedKey || this.generation !== startedGeneration) {
      if (end.failure !== undefined || end.credentials === undefined) {
        const failure = end.failure ?? { status: 'authentication-required' as const, message: antigravitySignInRequiredMessage() }
        return { status: failure.status, groups: [], observedAt, message: failure.message }
      }
      return { status: 'error', groups: [], observedAt, message: 'Antigravity account changed during quota refresh.' }
    }
    if (result.status === 'ready') this.cachedQuota = { snapshot: result, fetchedAt: this.now(), key: startedKey }
    return result
  }

  private syncKey(next: string | null): void {
    if (this.credentialKey === undefined) {
      this.credentialKey = next
      return
    }
    if (this.credentialKey !== next) {
      this.credentialKey = next
      this.generation += 1
      this.accessToken = undefined
      this.cachedQuota = undefined
    }
  }

  private tokenPath(): string {
    const profileDirectory = resolveAntigravityProfileDirectory(this.config.stateDirectory, this.config.instanceId)
    return join(profileDirectory, ...tokenFileName)
  }

  private async loadCredentials(): Promise<CredentialLoad> {
    let tokenPath: string
    try {
      tokenPath = this.tokenPath()
    } catch {
      return { key: null, failure: { status: 'error', message: 'Antigravity quota profile is misconfigured.' } }
    }
    try {
      if ((await lstat(tokenPath)).isSymbolicLink()) return { key: null, failure: { status: 'error', message: 'Antigravity credential path must not be a symbolic link.' } }
    } catch (error) {
      if (isFileNotFound(error)) return { key: null, failure: { status: 'authentication-required', message: antigravitySignInRequiredMessage() } }
      return { key: null, failure: { status: 'error', message: 'Antigravity stored credential is unreadable.' } }
    }
    let raw: string
    try {
      raw = await readFile(tokenPath, 'utf8')
    } catch {
      return { key: null, failure: { status: 'error', message: 'Antigravity stored credential is unreadable.' } }
    }
    const rawKey = createHash('sha256').update('raw:' + raw).digest('hex')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { key: rawKey, failure: { status: 'authentication-required', message: 'Antigravity stored credential is invalid; sign in again.' } }
    }
    if (!isRecord(parsed)) return { key: rawKey, failure: { status: 'authentication-required', message: 'Antigravity stored credential is invalid; sign in again.' } }
    const clientId = typeof parsed.client_id === 'string' && parsed.client_id.length > 0 ? parsed.client_id : undefined
    const clientSecret = typeof parsed.client_secret === 'string' && parsed.client_secret.length > 0 ? parsed.client_secret : undefined
    const refreshToken = typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0 ? parsed.refresh_token : undefined
    const tokenUri = typeof parsed.token_uri === 'string' ? parsed.token_uri : undefined
    if (clientId === undefined || clientSecret === undefined || refreshToken === undefined) return { key: rawKey, failure: { status: 'authentication-required', message: 'Antigravity stored credential is invalid; sign in again.' } }
    if (tokenUri !== undefined && tokenUri !== ANTIGRAVITY_OAUTH_TOKEN_URL) return { key: rawKey, failure: { status: 'authentication-required', message: 'Antigravity stored credential is invalid; sign in again.' } }
    if (parsed.scopes !== undefined && !(Array.isArray(parsed.scopes) && parsed.scopes.includes(cloudPlatformScope))) return { key: rawKey, failure: { status: 'not-entitled', message: 'Antigravity stored credential lacks the quota scope; sign in again.' } }
    return { key: createHash('sha256').update('cred:' + clientId + '' + refreshToken).digest('hex'), credentials: { clientId, clientSecret, refreshToken } }
  }

  private async fetchFresh(credentials: LoadedCredential, key: string, observedAt: string, signal?: AbortSignal): Promise<AntigravityQuotaSnapshot> {
    const fail = (status: AntigravityQuotaStatus, message: string): AntigravityQuotaSnapshot => ({ status, groups: [], observedAt, message })
    let accessToken: string
    try {
      accessToken = await this.accessTokenFor(credentials, key, signal)
    } catch (error) {
      if (signal?.aborted === true) throw error
      return fail('error', 'Antigravity quota request failed (transport).')
    }
    if (accessToken === '') return fail('authentication-required', antigravitySignInRequiredMessage())
    let discovery: { readonly status: number; readonly json: unknown }
    try {
      discovery = await this.postForm(ANTIGRAVITY_CCPA_PROD_ENDPOINT + '/v1internal:loadCodeAssist', { metadata: { ideType: 'ANTIGRAVITY' } }, accessToken, signal)
    } catch (error) {
      if (signal?.aborted === true) throw error
      return fail('error', 'Antigravity quota request failed (transport).')
    }
    const entitlement = checkEntitlement(discovery.status, discovery.json)
    if (entitlement.failure !== undefined) return fail(entitlement.failure.status, entitlement.failure.message)
    const { project, endpoint, currentTier, paidTier } = entitlement
    let quota: { readonly status: number; readonly json: unknown }
    try {
      quota = await this.postForm(endpoint + '/v1internal:retrieveUserQuotaSummary', { project }, accessToken, signal)
    } catch (error) {
      if (signal?.aborted === true) throw error
      return fail('error', 'Antigravity quota request failed (transport).')
    }
    if (quota.status === 401) return fail('authentication-required', antigravitySignInRequiredMessage())
    if (quota.status === 403) return fail(...quotaPermissionFailure(quota.json))
    if (quota.status < 200 || quota.status >= 300) return fail('error', 'Antigravity quota request failed (HTTP ' + String(quota.status) + ').')
    const groups = quotaGroups(quota.json)
    if (groups === undefined) return fail('error', 'Antigravity quota response was unexpected.')
    return {
      status: 'ready',
      groups,
      observedAt,
      ...tierField(currentTier, paidTier),
    }
  }

  private async accessTokenFor(credentials: LoadedCredential, key: string, signal?: AbortSignal): Promise<string> {
    const cached = this.accessToken
    if (cached !== undefined && cached.key === key && this.now() < cached.expiresAt) return cached.token
    const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: credentials.clientId, client_secret: credentials.clientSecret })
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await this.fetchFn(ANTIGRAVITY_OAUTH_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), redirect: 'error', signal: combined })
    } catch (error) {
      if (signal?.aborted === true) throw error
      throw new Error('Antigravity token refresh failed (transport).')
    }
    const json = await parseJsonBody(response)
    if (response.status === 400 || response.status === 401) {
      const code = isRecord(json) && typeof json.error === 'string' ? json.error : ''
      if (code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client' || response.status === 401) return ''
      throw new Error('Antigravity token refresh was rejected (HTTP ' + String(response.status) + ').')
    }
    if (response.status < 200 || response.status >= 300) throw new Error('Antigravity token refresh failed (HTTP ' + String(response.status) + ').')
    const token = isRecord(json) && typeof json.access_token === 'string' && json.access_token.length > 0 ? json.access_token : undefined
    if (token === undefined) throw new Error('Antigravity token refresh response was unexpected.')
    const expiresIn = isRecord(json) && typeof json.expires_in === 'number' && Number.isFinite(json.expires_in) && json.expires_in > 0 ? Math.floor(json.expires_in) : 1800
    this.accessToken = { token, expiresAt: this.now() + Math.max(60, expiresIn - 60) * 1000, key }
    return token
  }

  private async postForm(url: string, body: unknown, accessToken: string, signal?: AbortSignal): Promise<{ readonly status: number; readonly json: unknown }> {
    assertTrustedQuotaUrl(url)
    const userAgent = buildAntigravityQuotaUserAgent({
      runtimeVersion: this.runtimeVersion(),
      clientName: this.config.clientName ?? 'dsh-acp-antigravity',
      clientVersion: this.config.clientVersion ?? '0.1.0',
      os: this.os,
      arch: this.arch,
    })
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken, 'User-Agent': userAgent },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: combined,
    })
    return { status: response.status, json: await parseJsonBody(response) }
  }

  private runtimeVersion(): string {
    const negotiated = this.getRuntimeVersion?.()
    if (negotiated !== undefined && negotiated.trim() !== '') return negotiated
    const match = /agy_acp_server[_-]([A-Za-z0-9._-]+?)(?:[.](?:par|exe))?$/.exec(basename(this.config.executablePath))
    const embedded = match?.[1]
    if (embedded !== undefined && embedded.length > 0 && embedded !== 'par' && embedded !== 'exe') return embedded
    return ANTIGRAVITY_RELEASE_VERSION
  }
}

/** Create an instance-scoped quota reader. Host memory only; the profile file is never written.
 * @param config the selected instance profile.
 * @param options injectable fetch, bounds, clock, version, and platform.
 * @returns the quota reader.
 */
export function createAntigravityQuotaReader(config: AntigravityProviderConfig, options: AntigravityQuotaReaderOptions = {}): AntigravityQuotaReader {
  return new AntigravityQuotaReader(config, options)
}

function tierField(currentTier: string | undefined, paidTier: string | undefined): { readonly tier: { readonly current?: string; readonly paid?: string } } | Record<string, never> {
  if (currentTier === undefined && paidTier === undefined) return {}
  return { tier: { ...(currentTier === undefined ? {} : { current: currentTier }), ...(paidTier === undefined ? {} : { paid: paidTier }) } }
}

function checkEntitlement(status: number, json: unknown): { failure?: { readonly status: AntigravityQuotaStatus; readonly message: string }; project?: string; endpoint?: string; currentTier?: string; paidTier?: string } {
  if (status === 401) return { failure: { status: 'authentication-required', message: antigravitySignInRequiredMessage() } }
  if (status === 403) {
    const [failureStatus, message] = quotaPermissionFailure(json)
    return { failure: { status: failureStatus, message } }
  }
  if (status < 200 || status >= 300) return { failure: { status: 'error', message: 'Antigravity account lookup failed (HTTP ' + String(status) + ').' } }
  if (!isRecord(json)) return { failure: { status: 'error', message: 'Antigravity account lookup response was unexpected.' } }
  const project = typeof json.cloudaicompanionProject === 'string' && json.cloudaicompanionProject.length > 0 ? json.cloudaicompanionProject : undefined
  const currentTier = tierId(json, 'currentTier')
  const paidTier = tierId(json, 'paidTier')
  if (project === undefined || currentTier === undefined) {
    const reasons = ineligibleReasonCodes(json)
    return { failure: { status: 'not-entitled', message: reasons.length > 0 ? 'Antigravity account is not entitled to quota (' + reasons.join(', ') + ').' : 'Antigravity account is not entitled to quota.' } }
  }
  const paid = isRecord(json.paidTier) ? json.paidTier : undefined
  const endpoint = paid !== undefined && paid.usesGcpTos === true ? ANTIGRAVITY_CCPA_PROD_ENDPOINT : ANTIGRAVITY_CCPA_DAILY_ENDPOINT
  return { project, endpoint, currentTier, ...(paidTier === undefined ? {} : { paidTier }) }
}

function quotaPermissionFailure(json: unknown): [AntigravityQuotaStatus, string] {
  const reasons = errorReasons(json)
  if (reasons.includes('UNSUPPORTED_CLIENT')) return ['error', 'Antigravity rejected the quota client identification.']
  if (reasons.includes('SUBSCRIPTION_REQUIRED')) return ['not-entitled', 'Antigravity subscription does not include quota access.']
  return ['error', 'Antigravity denied the quota request.']
}

function tierId(record: Record<string, unknown>, key: string): string | undefined {
  const tier = record[key]
  return isRecord(tier) && typeof tier.id === 'string' && tier.id.length > 0 ? tier.id : undefined
}

function ineligibleReasonCodes(json: unknown): string[] {
  if (!isRecord(json) || !Array.isArray(json.ineligibleTiers)) return []
  const reasons: string[] = []
  for (const tier of json.ineligibleTiers) {
    if (!isRecord(tier)) continue
    const reason = typeof tier.reasonCode === 'string' && tier.reasonCode.length > 0 ? tier.reasonCode : typeof tier.tierId === 'string' ? tier.tierId : undefined
    if (reason !== undefined && reason.length <= 64 && !reasons.includes(reason)) reasons.push(reason)
  }
  return reasons
}

function errorReasons(payload: unknown): string[] {
  if (!isRecord(payload) || !isRecord(payload.error) || !Array.isArray(payload.error.details)) return []
  const reasons: string[] = []
  for (const detail of payload.error.details) {
    if (isRecord(detail) && typeof detail.reason === 'string' && detail.reason.length > 0 && detail.reason.length <= 64 && !reasons.includes(detail.reason)) reasons.push(detail.reason)
  }
  return reasons
}

function quotaGroups(payload: unknown): AntigravityQuotaGroup[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.groups)) return undefined
  const groups: AntigravityQuotaGroup[] = []
  for (const entry of payload.groups) {
    if (!isRecord(entry) || !Array.isArray(entry.buckets)) return undefined
    const buckets: AntigravityQuotaBucket[] = []
    for (const item of entry.buckets) {
      const bucket = quotaBucket(item)
      if (bucket === undefined) return undefined
      buckets.push(bucket)
    }
    const displayName = optionalText(entry, 'displayName')
    const description = optionalText(entry, 'description')
    groups.push({
      ...(displayName === undefined ? {} : { displayName }),
      ...(description === undefined ? {} : { description }),
      buckets,
    })
  }
  return groups
}

function quotaBucket(item: unknown): AntigravityQuotaBucket | undefined {
  if (!isRecord(item)) return undefined
  const remainingFraction = typeof item.remainingFraction === 'number' && Number.isFinite(item.remainingFraction) ? item.remainingFraction : undefined
  const remainingAmount = typeof item.remainingAmount === 'string' || typeof item.remainingAmount === 'number' ? String(item.remainingAmount) : undefined
  const disabled = typeof item.disabled === 'boolean' ? item.disabled : undefined
  const bucketId = optionalText(item, 'bucketId')
  const displayName = optionalText(item, 'displayName')
  const description = optionalText(item, 'description')
  const window = optionalText(item, 'window')
  const resetTime = optionalText(item, 'resetTime')
  return {
    ...(bucketId === undefined ? {} : { bucketId }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(description === undefined ? {} : { description }),
    ...(window === undefined ? {} : { window }),
    ...(remainingFraction === undefined ? {} : { remainingFraction }),
    ...(remainingAmount === undefined ? {} : { remainingAmount }),
    ...(disabled === undefined ? {} : { disabled }),
    ...(resetTime === undefined ? {} : { resetTime }),
  }
}

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = record[key]
  return typeof value === 'string' ? value : undefined
}

function assertTrustedQuotaUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Antigravity quota request to an untrusted endpoint was blocked.')
  }
  if (parsed.protocol !== 'https:' || !trustedHosts.has(parsed.hostname)) throw new Error('Antigravity quota request to an untrusted endpoint was blocked.')
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
