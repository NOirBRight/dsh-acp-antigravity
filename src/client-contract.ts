/** Browser-safe RPC contract for the External Agents settings page. */

export const ACP_SETTINGS_RPC_CHANNEL = '/dsh-acp-antigravity'
export const SNAPSHOT_ENDPOINT = 'snapshot'
export const SAVE_ENDPOINT = 'save'
export const RUN_ENDPOINT = 'run'
export const PICK_ENDPOINT = 'pick'

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
