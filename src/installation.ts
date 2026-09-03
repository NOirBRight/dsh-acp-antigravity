import { constants } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { buildAntigravityEnvironment, prepareAntigravityProfile, resolveAntigravityProfileDirectory } from './auth.js'
import type { AntigravityInstallationStatus, AntigravityProviderConfig } from './types.js'

/** Spawn input for the official Antigravity ACP server. */
export interface AntigravityLaunchSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly shell: false
  readonly extendEnv: false
}

/** Explicit executable pair used by the first-release provider. */
export interface AntigravityInstallation {
  readonly executablePath: string
  readonly harnessPath: string
  readonly version?: string
}

/** Optional file/version probe for deterministic installation tests. */
export interface AntigravityInstallationProbe {
  stat(path: string): Promise<{ readonly isFile: boolean; readonly mode: number }>
  version?(path: string): Promise<string | undefined>
}

const defaultProbe: AntigravityInstallationProbe = {
  async stat(path) {
    const result = await stat(path)
    return { isFile: result.isFile(), mode: result.mode }
  },
}

/** Derive the required sibling harness name for an executable path. */
export function deriveAntigravityHarnessPath(executablePath: string, platform: NodeJS.Platform = process.platform): string {
  const name = platform === 'win32' ? 'localharness_external.exe' : 'localharness_external'
  return join(dirname(executablePath), name)
}

/** Validate only the explicit executable pair; no alternate installation is searched. */
export async function validateAntigravityInstallation(config: AntigravityProviderConfig, probe: AntigravityInstallationProbe = defaultProbe): Promise<AntigravityInstallationStatus | AntigravityInstallation> {
  if (config.executablePath.trim() === '' || config.harnessPath.trim() === '') return { status: 'invalid-installation', executablePath: config.executablePath, harnessPath: config.harnessPath, message: 'Antigravity ACP and localharness_external paths are required.' }
  const sibling = deriveAntigravityHarnessPath(config.executablePath, config.platform)
  const samePath = config.platform === 'win32' ? resolve(config.harnessPath).toLowerCase() === resolve(sibling).toLowerCase() : resolve(config.harnessPath) === resolve(sibling)
  if (!samePath) return { status: 'invalid-installation', executablePath: config.executablePath, harnessPath: config.harnessPath, message: 'localharness_external must be the sibling of the Antigravity ACP executable.' }
  for (const [label, path] of [['ACP server', config.executablePath], ['localharness_external', config.harnessPath]] as const) {
    try {
      const result = await probe.stat(path)
      const executable = config.platform === 'win32' || (result.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH)) !== 0
      if (!result.isFile || !executable) return { status: 'invalid-installation', executablePath: config.executablePath, harnessPath: config.harnessPath, message: 'Antigravity ' + label + ' is not an executable file.' }
    } catch {
      return { status: 'missing-installation', executablePath: config.executablePath, harnessPath: config.harnessPath, message: 'Antigravity ' + label + ' was not found at the configured path.' }
    }
  }
  const version = probe.version === undefined ? undefined : await probe.version(config.executablePath)
  return { executablePath: config.executablePath, harnessPath: config.harnessPath, ...(version === undefined ? {} : { version }) }
}

/** Build the non-shell launch arguments and scrubbed environment. */
export async function buildAntigravityLaunchSpec(config: AntigravityProviderConfig, cwd: string, baseEnv?: NodeJS.ProcessEnv): Promise<AntigravityLaunchSpec> {
  const installation = await validateAntigravityInstallation(config)
  if ('status' in installation) throw new Error(installation.message)
  const profileDirectory = resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId)
  await prepareAntigravityProfile(config)
  return {
    command: installation.executablePath,
    args: config.platform === 'linux' ? ['--uid='] : [],
    cwd,
    env: buildAntigravityEnvironment({ ...(baseEnv === undefined ? {} : { baseEnv }), profileDirectory, harnessPath: installation.harnessPath }),
    shell: false,
    extendEnv: false,
  }
}

/** Return a value-free installation label for Settings. */
export function installationLabel(installation: AntigravityInstallation | AntigravityInstallationStatus): string {
  if ('status' in installation) return installation.status
  return installation.version === undefined ? basename(installation.executablePath) : basename(installation.executablePath) + ' ' + installation.version
}
