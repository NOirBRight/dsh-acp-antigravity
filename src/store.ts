/** Persist Antigravity Settings to a profile-local file. */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decodeConfig, type AcpAntigravitySettingsConfig } from './client-contract.js'

export const SETTINGS_FILE_NAME = 'acp-antigravity.settings.json'

/** Resolve DSH_HOME, defaulting to ~/.dsh. */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(process.env.HOME ?? '/tmp', '.dsh')
}

/** Profile-local Settings path. */
export function settingsFilePath(home: string, profile = 'web'): string {
  return join(home, 'profiles', profile, SETTINGS_FILE_NAME)
}

function persistEnabled(): boolean {
  return process.env.VITEST !== 'true'
}

function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.' + String(process.pid) + '.' + String(Date.now()) + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8')
    renameSync(temporary, path)
  } catch (cause) {
    try { unlinkSync(temporary) } catch { /* already renamed or never created */ }
    throw cause
  }
}

/** Load persisted Settings, or undefined when absent or invalid. */
export function loadPersistedConfig(home: string, profile = 'web'): AcpAntigravitySettingsConfig | undefined {
  if (!persistEnabled()) return undefined
  try {
    return decodeConfig(JSON.parse(readFileSync(settingsFilePath(home, profile), 'utf8')) as unknown)
  } catch {
    // Missing or invalid settings file leaves the in-memory defaults in charge.
    return undefined
  }
}

/** Write Settings after a successful live apply. */
export function savePersistedConfig(home: string, config: AcpAntigravitySettingsConfig, profile = 'web'): void {
  if (!persistEnabled()) return
  writeJsonAtomically(settingsFilePath(home, profile), config)
}

export const MODELS_FILE_NAME = 'models.json'

function modelsFilePath(home: string): string {
  return join(home, 'plugin-data', 'antigravity', MODELS_FILE_NAME)
}

/** Last ACP model catalog; empty when never listed. */
export function loadPersistedModels(home: string): { id: string; name: string }[] {
  if (!persistEnabled()) return []
  try {
    const parsed = JSON.parse(readFileSync(modelsFilePath(home), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(row => {
      if (typeof row !== 'object' || row === null) return []
      const id = (row as { id?: unknown }).id
      const name = (row as { name?: unknown }).name
      return typeof id === 'string' && id.length > 0 && typeof name === 'string' && name.length > 0 ? [{ id, name }] : []
    })
  } catch {
    // Missing or invalid models.json is treated as never listed.
    return []
  }
}

/** Persist a successful native catalog. */
export function savePersistedModels(home: string, models: readonly { id: string; name: string }[]): void {
  if (!persistEnabled()) return
  writeJsonAtomically(modelsFilePath(home), models)
}
