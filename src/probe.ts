/** Search PATH and common directories for the ACP executable pair, not the agy CLI. */
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deriveAntigravityHarnessPath } from './installation.js'

/** Result of one installation probe. */
export interface AntigravityProbeResult {
  readonly executablePath?: string
  readonly harnessPath?: string
  readonly agyCli?: string
  readonly message: string
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function searchDirs(): string[] {
  const dirs = (process.env.PATH ?? '').split(':').filter(dir => dir.length > 0)
  for (const extra of [
    join(process.env.HOME ?? '', '.local/bin'),
    '/opt/antigravity',
    '/opt/google/antigravity',
    '/usr/local/bin',
    '/usr/share/antigravity/bin',
  ]) {
    if (extra !== '/' && !dirs.includes(extra)) dirs.push(extra)
  }
  return dirs
}

/** Find agy_acp_server and its sibling localharness_external. */
export async function probeAntigravityInstallation(platform: NodeJS.Platform = process.platform): Promise<AntigravityProbeResult> {
  const serverName = platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server'
  const cliName = platform === 'win32' ? 'agy.exe' : 'agy'
  let agyCli: string | undefined
  for (const dir of searchDirs()) {
    const cli = join(dir, cliName)
    if (agyCli === undefined && await isExecutableFile(cli)) agyCli = cli
    const executablePath = join(dir, serverName)
    if (!await isExecutableFile(executablePath)) continue
    const harnessPath = deriveAntigravityHarnessPath(executablePath, platform)
    if (!await isExecutableFile(harnessPath)) {
      return { ...(agyCli === undefined ? {} : { agyCli }), message: 'Found ' + executablePath + ' but sibling localharness_external is missing.' }
    }
    return { executablePath, harnessPath, ...(agyCli === undefined ? {} : { agyCli }), message: 'Found Antigravity ACP executable pair.' }
  }
  if (agyCli !== undefined) {
    return {
      agyCli,
      message: 'Found agy CLI at ' + agyCli + '. This provider needs agy_acp_server and sibling localharness_external, not the CLI.',
    }
  }
  return { message: 'agy_acp_server was not found on PATH. Locate the ACP executable pair; the agy CLI is not that pair.' }
}
