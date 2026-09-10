/** Persist Antigravity Settings to a profile-local file. */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decodeConfig, type AcpAntigravitySettingsConfig } from './client-contract.js'
import { mergeModelFacts, type ModelFacts } from './model-metadata.js'

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

export const MODEL_FACTS_FILE_NAME = 'model-facts.json'

function factsFilePath(home: string): string {
  return join(home, 'plugin-data', 'antigravity', MODEL_FACTS_FILE_NAME)
}

export interface PersistedModelFacts {
  readonly version: 1
  readonly instanceId: string
  readonly stateDirectory: string
  readonly observedAt: string
  readonly defaultAgentModelId?: string
  readonly facts: Record<string, import('./model-metadata.js').ModelFacts>
}

/** Load cached CCPA facts for this instance, or undefined when missing/invalid.
 * @param home DSH_HOME.
 * @param instanceId live instance.
 * @param stateDirectory native profile directory.
 * @returns parsed facts, or undefined.
 */
export function loadPersistedModelFacts(home: string, instanceId: string, stateDirectory: string): PersistedModelFacts | undefined {
  if (!persistEnabled()) return undefined
  try {
    const parsed = JSON.parse(readFileSync(factsFilePath(home), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const value = parsed as PersistedModelFacts
    if (value.version !== 1 || value.instanceId !== instanceId || value.stateDirectory !== stateDirectory) return undefined
    if (typeof value.observedAt !== 'string' || typeof value.facts !== 'object' || value.facts === null) return undefined
    const facts: PersistedModelFacts['facts'] = {}
    for (const [id, item] of Object.entries(value.facts)) {
      if (typeof id !== 'string' || typeof item !== 'object' || item === null) continue
      const merged = mergeModelFacts(item as Partial<ModelFacts>)
      facts[id] = merged
    }
    return { ...value, facts }
  } catch {
    // Missing or invalid facts cache is treated as never observed.
    return undefined
  }
}

/** Write cached CCPA facts.
 * @param home DSH_HOME.
 * @param value facts document.
 */
export function savePersistedModelFacts(home: string, value: PersistedModelFacts): void {
  if (!persistEnabled()) return
  writeJsonAtomically(factsFilePath(home), value)
}

/** Drop cached CCPA facts.
 * @param home DSH_HOME.
 */
export function clearPersistedModelFacts(home: string): void {
  if (!persistEnabled()) return
  try { unlinkSync(factsFilePath(home)) } catch { /* missing facts cache is already empty */ }
}
