import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { expect, it } from 'vitest'
import { AntigravityProvider } from '../src/provider.js'

const executablePath = process.env.ANTIGRAVITY_ACP_EXECUTABLE
const harnessPath = process.env.ANTIGRAVITY_HARNESS_EXECUTABLE

it.skipIf(executablePath === undefined || harnessPath === undefined)('initializes the user-provided Google executable pair without a model request', async () => {
  if (executablePath === undefined || harnessPath === undefined) throw new Error('real-binary paths are unavailable')
  const stateDirectory = await mkdtemp(join(tmpdir(), 'dsh-antigravity-smoke-'))
  const provider = new AntigravityProvider({ executablePath, harnessPath, stateDirectory, instanceId: providerInstanceId('real-binary-smoke') })
  try {
    await expect(provider.validateInstallation()).resolves.toMatchObject({ executablePath, harnessPath })
    expect(provider.health.status).toBe('authentication-required')
  } finally {
    try { await provider.dispose() } finally { await rm(stateDirectory, { recursive: true, force: true }) }
  }
}, 30_000)
