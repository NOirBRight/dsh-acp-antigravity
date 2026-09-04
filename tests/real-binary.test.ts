import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionModelRoute, providerInstanceId, sessionId, turnId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import { expect, it } from 'vitest'
import { AntigravityProvider } from '../src/provider.js'

const executablePath = process.env.ANTIGRAVITY_ACP_EXECUTABLE
const harnessPath = process.env.ANTIGRAVITY_HARNESS_EXECUTABLE
const authenticatedStateDirectory = process.env.ANTIGRAVITY_AUTHENTICATED_STATE_DIRECTORY
const authenticatedInstance = process.env.ANTIGRAVITY_AUTHENTICATED_INSTANCE_ID

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

it.skipIf(executablePath === undefined || harnessPath === undefined || authenticatedStateDirectory === undefined || authenticatedInstance === undefined)('runs a read-only turn, resumes it, and cancels the resumed turn', async () => {
  if (executablePath === undefined || harnessPath === undefined || authenticatedStateDirectory === undefined || authenticatedInstance === undefined) throw new Error('authenticated smoke configuration is unavailable')
  const provider = new AntigravityProvider({ executablePath, harnessPath, stateDirectory: authenticatedStateDirectory, instanceId: providerInstanceId(authenticatedInstance) })
  const host: ExternalAgentTurnHost = {
    publish: () => undefined,
    requestPermission: async request => {
      const rejection = request.options.find(option => option.kind === 'reject')
      return rejection === undefined ? { kind: 'cancel' } : { kind: 'reject', optionId: rejection.optionId }
    },
    requestUserInput: async () => ({ answers: [] }),
  }
  try {
    const [model] = await provider.listModels()
    if (model === undefined) throw new Error('authenticated Antigravity account advertised no models')
    const route = createSessionModelRoute('external-agent', String(provider.info.id), String(model.id))
    const session = await provider.openSession({ route, session: sessionId('real-api-smoke'), permissionMode: 'approval-required' })
    const first = await session.runTurn({ turn: turnId('real-api-read-only'), prompt: 'Reply with exactly: DSH Antigravity smoke. Do not use tools or modify files.', permissionMode: 'approval-required', signal: new AbortController().signal }, host)
    expect(first.status).toBe('completed')
    if (first.resumeCursor === undefined) throw new Error('read-only turn returned no resume cursor')
    await session.dispose()
    const resumed = await provider.openSession({ route, session: sessionId('real-api-smoke'), permissionMode: 'approval-required', resumeCursor: first.resumeCursor })
    const controller = new AbortController()
    const cancelled = resumed.runTurn({ turn: turnId('real-api-cancel'), prompt: 'Wait until cancelled without using tools.', permissionMode: 'approval-required', signal: controller.signal }, host)
    setTimeout(() => controller.abort(), 50)
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled' })
    await resumed.dispose()
  } finally {
    await provider.dispose()
  }
}, 120_000)
