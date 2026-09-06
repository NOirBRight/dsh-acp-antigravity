/** Browser-safe RPC contract for the External Agents settings page. */

export const ACP_SETTINGS_RPC_CHANNEL = '/dsh-acp-antigravity'
export const SNAPSHOT_ENDPOINT = 'snapshot'
export const SAVE_ENDPOINT = 'save'
export const RUN_ENDPOINT = 'run'
export const PICK_ENDPOINT = 'pick'
export const CATALOG_ENDPOINT = 'catalog'
export const QUOTA_ENDPOINT = 'quota'

/** Persisted Settings values for one Antigravity instance. */
export interface AcpAntigravitySettingsConfig {
  readonly executablePath: string
  readonly harnessPath: string
  readonly stateDirectory: string
  readonly instanceId: string
  readonly model?: string
  readonly enabled: boolean
}

/** One provider card on the External Agents page. */
export interface AcpSettingsRow {
  readonly provider: string
  readonly instanceId: string
  readonly title: string
  readonly enabled: boolean
  readonly executablePath: string
  readonly harnessPath: string
  readonly stateDirectory: string
  readonly model?: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
  readonly installed: boolean
  readonly authenticated: boolean
  readonly live: boolean
  readonly ready: boolean
  readonly message?: string
  readonly version?: string
  readonly profileDirectory?: string
  readonly authorizationUrl?: string
}

/** Progress for the managed Google ACP download. */
export interface AcpInstallProgress {
  readonly phase: 'idle' | 'downloading' | 'extracting' | 'verifying' | 'succeeded' | 'failed'
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly message: string
}

/** Generic External Agents page snapshot. */
export interface AcpSettingsSnapshot {
  readonly title: 'External Agents'
  readonly rows: readonly AcpSettingsRow[]
  readonly install?: AcpInstallProgress
  readonly signingIn?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Decode a Settings snapshot from the host RPC. */
export function decodeSnapshot(value: unknown): AcpSettingsSnapshot | undefined {
  if (!isRecord(value) || value.title !== 'External Agents' || !Array.isArray(value.rows)) return undefined
  const rows: AcpSettingsRow[] = []
  for (const row of value.rows) {
    if (!isRecord(row)) return undefined
    if (typeof row.provider !== 'string' || typeof row.instanceId !== 'string' || typeof row.title !== 'string') return undefined
    if (typeof row.enabled !== 'boolean' || typeof row.executablePath !== 'string' || typeof row.harnessPath !== 'string') return undefined
    if (typeof row.stateDirectory !== 'string' || typeof row.installed !== 'boolean' || typeof row.authenticated !== 'boolean') return undefined
    if (typeof row.live !== 'boolean' || typeof row.ready !== 'boolean' || !Array.isArray(row.models)) return undefined
    const models: { id: string; name: string }[] = []
    for (const model of row.models) {
      if (!isRecord(model) || typeof model.id !== 'string' || typeof model.name !== 'string') return undefined
      models.push({ id: model.id, name: model.name })
    }
    rows.push({
      provider: row.provider,
      instanceId: row.instanceId,
      title: row.title,
      enabled: row.enabled,
      executablePath: row.executablePath,
      harnessPath: row.harnessPath,
      stateDirectory: row.stateDirectory,
      ...(typeof row.model === 'string' ? { model: row.model } : {}),
      models,
      installed: row.installed,
      authenticated: row.authenticated,
      live: row.live,
      ready: row.ready,
      ...(typeof row.message === 'string' ? { message: row.message } : {}),
      ...(typeof row.version === 'string' ? { version: row.version } : {}),
      ...(typeof row.profileDirectory === 'string' ? { profileDirectory: row.profileDirectory } : {}),
      ...(typeof row.authorizationUrl === 'string' ? { authorizationUrl: row.authorizationUrl } : {}),
    })
  }
  const install = isRecord(value.install) && typeof value.install.phase === 'string' && typeof value.install.message === 'string' && typeof value.install.downloadedBytes === 'number' && typeof value.install.totalBytes === 'number'
    ? { phase: value.install.phase as AcpInstallProgress['phase'], downloadedBytes: value.install.downloadedBytes, totalBytes: value.install.totalBytes, message: value.install.message }
    : undefined
  return { title: 'External Agents', rows, ...(install === undefined ? {} : { install }), ...(value.signingIn === true ? { signingIn: true } : {}) }
}

/** Decode a persisted Settings document. */
export function decodeConfig(value: unknown): AcpAntigravitySettingsConfig | undefined {
  if (!isRecord(value) || typeof value.executablePath !== 'string' || typeof value.harnessPath !== 'string') return undefined
  if (typeof value.stateDirectory !== 'string' || typeof value.instanceId !== 'string' || value.instanceId.trim() === '') return undefined
  if (typeof value.enabled !== 'boolean') return undefined
  if (value.model !== undefined && (typeof value.model !== 'string' || value.model.trim() === '')) return undefined
  return {
    executablePath: value.executablePath,
    harnessPath: value.harnessPath,
    stateDirectory: value.stateDirectory,
    instanceId: value.instanceId.trim(),
    ...(value.model === undefined ? {} : { model: value.model.trim() }),
    enabled: value.enabled,
  }
}

/** One preserved quota bucket from the vendor quota-summary API. Missing fields stay absent, never zero. */
export interface AntigravityQuotaBucket {
  readonly bucketId?: string
  readonly displayName?: string
  readonly description?: string
  readonly window?: string
  readonly remainingFraction?: number
  readonly remainingAmount?: string
  readonly disabled?: boolean
  readonly resetTime?: string
}

/** One preserved quota group with its buckets. */
export interface AntigravityQuotaGroup {
  readonly displayName?: string
  readonly description?: string
  readonly buckets: readonly AntigravityQuotaBucket[]
}

/** Readiness of a quota snapshot. Failures are explicit; grouping is never estimated.
 * account-changed means the profile account switched mid-refresh: the snapshot
 * carries no groups and any retained tile must be discarded, then polled again. */
export type AntigravityQuotaStatus = 'ready' | 'authentication-required' | 'not-entitled' | 'account-changed' | 'error'

/** Sanitized account quota for the Settings UI. Never carries credentials, project ids, or raw auth payloads. */
export interface AntigravityQuotaSnapshot {
  readonly status: AntigravityQuotaStatus
  readonly groups: readonly AntigravityQuotaGroup[]
  readonly observedAt: string
  readonly tier?: { readonly current?: string; readonly paid?: string }
  readonly message?: string
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = record[key]
  return typeof value === 'string' ? value : undefined
}

function decodeQuotaBucket(value: unknown): AntigravityQuotaBucket | undefined {
  if (!isRecord(value)) return undefined
  const remainingFraction = typeof value.remainingFraction === 'number' && Number.isFinite(value.remainingFraction) ? value.remainingFraction : undefined
  const remainingAmount = typeof value.remainingAmount === 'string' || typeof value.remainingAmount === 'number' ? String(value.remainingAmount) : undefined
  const disabled = typeof value.disabled === 'boolean' ? value.disabled : undefined
  const bucketId = optionalString(value, 'bucketId')
  const displayName = optionalString(value, 'displayName')
  const description = optionalString(value, 'description')
  const window = optionalString(value, 'window')
  const resetTime = optionalString(value, 'resetTime')
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

/** Decode a quota snapshot from the host RPC. */
export function decodeQuotaSnapshot(value: unknown): AntigravityQuotaSnapshot | undefined {
  if (!isRecord(value)) return undefined
  const status = value.status
  if (status !== 'ready' && status !== 'authentication-required' && status !== 'not-entitled' && status !== 'account-changed' && status !== 'error') return undefined
  if (typeof value.observedAt !== 'string' || !Array.isArray(value.groups)) return undefined
  const groups: AntigravityQuotaGroup[] = []
  for (const group of value.groups) {
    if (!isRecord(group) || !Array.isArray(group.buckets)) return undefined
    const buckets: AntigravityQuotaBucket[] = []
    for (const bucket of group.buckets) {
      const decoded = decodeQuotaBucket(bucket)
      if (decoded === undefined) return undefined
      buckets.push(decoded)
    }
    const displayName = optionalString(group, 'displayName')
    const description = optionalString(group, 'description')
    groups.push({
      ...(displayName === undefined ? {} : { displayName }),
      ...(description === undefined ? {} : { description }),
      buckets,
    })
  }
  const tier = isRecord(value.tier) ? value.tier : undefined
  const current = tier === undefined ? undefined : optionalString(tier, 'current')
  const paid = tier === undefined ? undefined : optionalString(tier, 'paid')
  const message = optionalString(value, 'message')
  return {
    status,
    groups,
    observedAt: value.observedAt,
    ...(current === undefined && paid === undefined ? {} : { tier: { ...(current === undefined ? {} : { current }), ...(paid === undefined ? {} : { paid }) } }),
    ...(message === undefined ? {} : { message }),
  }
}
