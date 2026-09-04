import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, decodeSnapshot, name, inject } from '../src/index.js'
import { ACP_SETTINGS_RPC_CHANNEL, SNAPSHOT_ENDPOINT } from '../src/client-contract.js'

describe('DSH settings plugin', () => {
  const homes: string[] = []
  afterEach(async () => {
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
  })

  it('exports a Cordis plugin that registers settings RPC', async () => {
    expect(name).toBe('dsh-acp-antigravity')
    expect(inject).toEqual(['connection'])
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-settings-'))
    homes.push(home)
    process.env.DSH_HOME = home
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      connection: { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } },
    }
    await apply(ctx, { executablePath: '', harnessPath: '', enabled: true })
    const handler = handlers.get(ACP_SETTINGS_RPC_CHANNEL)
    expect(handler).toEqual(expect.any(Function))
    const result = await handler!(SNAPSHOT_ENDPOINT, {}) as { ok: boolean; value: unknown }
    expect(result.ok).toBe(true)
    const snapshot = decodeSnapshot(result.value)
    expect(snapshot?.title).toBe('External Agents')
    expect(snapshot?.rows).toHaveLength(1)
    expect(snapshot?.rows[0]).toMatchObject({ title: 'Antigravity', enabled: true, installed: false })
  })

  it('marks a configured executable pair as installed after validation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-settings-'))
    homes.push(home)
    process.env.DSH_HOME = home
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-bin-'))
    homes.push(dir)
    const { writeFile, chmod } = await import('node:fs/promises')
    const server = join(dir, 'agy_acp_server.par')
    const harness = join(dir, 'localharness_external')
    await writeFile(server, '#!/bin/sh\nexit 1\n')
    await writeFile(harness, '#!/bin/sh\nexit 1\n')
    await chmod(server, 0o755)
    await chmod(harness, 0o755)
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      connection: { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } },
    }
    await apply(ctx, { executablePath: server, harnessPath: harness, enabled: true })
    const result = await handlers.get(ACP_SETTINGS_RPC_CHANNEL)!(SNAPSHOT_ENDPOINT, {}) as { ok: boolean; value: unknown }
    const snapshot = decodeSnapshot(result.value)
    expect(snapshot?.rows[0]?.installed).toBe(true)
    expect(snapshot?.rows[0]?.executablePath).toBe(server)
  })
})
