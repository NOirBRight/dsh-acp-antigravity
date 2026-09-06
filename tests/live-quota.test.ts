/** Opt-in live quota smoke against an existing authenticated lab profile.
 *
 * Skipped unless ANTIGRAVITY_AUTHENTICATED_STATE_DIRECTORY and
 * ANTIGRAVITY_AUTHENTICATED_INSTANCE_ID are set. Makes read-only HTTPS calls
 * (token refresh, loadCodeAssist, retrieveUserQuotaSummary) through the public
 * AntigravityQuotaReader API: no ACP spawn, no login, no install, no model
 * request, and the credential file is never written. Only sanitized quota
 * fields reach the test output.
 */
import { providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAntigravityProfileDirectory } from '../src/auth.js'
import { decodeQuotaSnapshot, type AntigravityQuotaSnapshot } from '../src/client-contract.js'
import { createAntigravityQuotaReader } from '../src/quota.js'
import type { AntigravityProviderConfig } from '../src/types.js'

const stateDirectory = process.env.ANTIGRAVITY_AUTHENTICATED_STATE_DIRECTORY
const instance = process.env.ANTIGRAVITY_AUTHENTICATED_INSTANCE_ID
const configured = stateDirectory !== undefined && instance !== undefined
const liveTimeout = 120_000

function labConfig(): AntigravityProviderConfig {
  if (!configured) throw new Error('authenticated smoke configuration is unavailable')
  return {
    executablePath: join(stateDirectory, '..', '..', 'runtimes', 'antigravity', 'versions', 'agy_acp_server_20260818_01_RC01', 'agy_acp_server.par'),
    harnessPath: join(stateDirectory, '..', '..', 'runtimes', 'antigravity', 'versions', 'agy_acp_server_20260818_01_RC01', 'localharness_external'),
    stateDirectory,
    instanceId: providerInstanceId(instance),
  }
}

async function credentialHash(config: AntigravityProviderConfig): Promise<string> {
  const tokenPath = join(resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId), 'antigravity-acp', 'acp_token.json')
  return createHash('sha256').update(await readFile(tokenPath)).digest('hex')
}

/** Allowlisted quota fields for test output; never credentials, projects, or raw payloads. */
function sanitizeForReport(snapshot: AntigravityQuotaSnapshot): unknown {
  return {
    status: snapshot.status,
    observedAt: snapshot.observedAt,
    ...(snapshot.tier === undefined ? {} : { tier: snapshot.tier }),
    groups: snapshot.groups.map(group => ({
      ...(group.displayName === undefined ? {} : { displayName: group.displayName }),
      buckets: group.buckets.map(bucket => ({
        ...(bucket.bucketId === undefined ? {} : { bucketId: bucket.bucketId }),
        ...(bucket.displayName === undefined ? {} : { displayName: bucket.displayName }),
        ...(bucket.window === undefined ? {} : { window: bucket.window }),
        ...(bucket.remainingFraction === undefined ? {} : { remainingFraction: bucket.remainingFraction }),
        ...(bucket.remainingAmount === undefined ? {} : { remainingAmount: bucket.remainingAmount }),
        ...(bucket.disabled === undefined ? {} : { disabled: bucket.disabled }),
        ...(bucket.resetTime === undefined ? {} : { resetTime: bucket.resetTime }),
      })),
    })),
  }
}

describe.skipIf(!configured)('live Antigravity quota smoke', () => {
  it('reads live personal-OAuth quota without touching the profile', async () => {
    const config = labConfig()
    const before = await credentialHash(config)
    const reader = createAntigravityQuotaReader(config, { timeoutMs: 25_000, getRuntimeVersion: () => 'agy_acp_server_20260818_01_RC01' })
    const snapshot = await reader.snapshot()
    console.log('live quota: ' + JSON.stringify(sanitizeForReport(snapshot)))
    expect(decodeQuotaSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
    expect(snapshot.status).toBe('ready')
    expect(snapshot.groups.length).toBeGreaterThan(0)
    for (const group of snapshot.groups) {
      for (const bucket of group.buckets) {
        if (bucket.remainingFraction !== undefined) {
          expect(bucket.remainingFraction).toBeGreaterThanOrEqual(0)
          expect(bucket.remainingFraction).toBeLessThanOrEqual(1)
        }
      }
    }
    expect(await credentialHash(config)).toBe(before)
  }, liveTimeout)

  it('catches a refresh/current account mismatch on an isolated profile copy', async () => {
    const config = labConfig()
    const labBefore = await credentialHash(config)
    const labTokenPath = join(resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId), 'antigravity-acp', 'acp_token.json')
    const original = await readFile(labTokenPath)
    const copyState = await mkdtemp(join(tmpdir(), 'dsh-agy-live-race-'))
    try {
      const raceInstance = providerInstanceId('live-quota-race')
      const raceProfile = resolveAntigravityProfileDirectory(copyState, raceInstance)
      await mkdir(join(raceProfile, 'antigravity-acp'), { recursive: true, mode: 0o700 })
      const raceTokenPath = join(raceProfile, 'antigravity-acp', 'acp_token.json')
      await writeFile(raceTokenPath, original, { mode: 0o600 })
      let quotaRequested = false
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const gatedFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        if (target.includes(':retrieveUserQuotaSummary')) {
          quotaRequested = true
          await gate
        }
        return fetch(target, init)
      }) as typeof fetch
      const reader = createAntigravityQuotaReader({ ...config, stateDirectory: copyState, instanceId: raceInstance }, { fetchFn: gatedFetch, timeoutMs: 25_000, getRuntimeVersion: () => 'agy_acp_server_20260818_01_RC01' })
      const stale = reader.snapshot()
      const deadline = Date.now() + 60_000
      while (!quotaRequested) {
        if (Date.now() > deadline) throw new Error('live quota request was not observed')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      await writeFile(raceTokenPath, 'not-json{')
      release()
      const mismatch = await stale
      expect(mismatch.groups).toEqual([])
      expect(mismatch.status).not.toBe('ready')
      await writeFile(raceTokenPath, original, { mode: 0o600 })
      const recovered = await reader.snapshot()
      console.log('live recovery: ' + JSON.stringify(sanitizeForReport(recovered)) + ' message=' + (recovered.message ?? 'none'))
      expect(recovered.status).toBe('ready')
      expect(recovered.groups.length).toBeGreaterThan(0)
    } finally {
      await rm(copyState, { recursive: true, force: true })
    }
    expect(await credentialHash(config)).toBe(labBefore)
  }, liveTimeout)
})
