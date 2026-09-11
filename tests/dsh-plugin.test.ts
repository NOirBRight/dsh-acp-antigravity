import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, decodeSnapshot, name, inject, requestNativeApproval } from '../src/index.js'
import { ACP_SETTINGS_RPC_CHANNEL, CATALOG_ENDPOINT, RUN_ENDPOINT, SNAPSHOT_ENDPOINT } from '../src/client-contract.js'

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
    const injected: string[][] = []
    const connection = { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } }
    const ctx = {
      on: () => () => {},
      effect: (fn: () => unknown) => fn(),
      inject: (deps: string[], run: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: () => () => void }; connection: typeof connection }) => unknown) => {
        injected.push(deps)
        return run({ effect: (fn: () => unknown) => fn(), llm: { registerAdapter: () => () => {} }, connection })
      },
      connection,
    }
    await apply(ctx, { executablePath: '', harnessPath: '', enabled: true, modelDiscoveryTimeoutMs: 45_000 })
    expect(injected).toContainEqual(['connection'])
    const handler = handlers.get(ACP_SETTINGS_RPC_CHANNEL)
    expect(handler).toEqual(expect.any(Function))
    const result = await handler!(SNAPSHOT_ENDPOINT, {}) as { ok: boolean; value: unknown }
    expect(result.ok).toBe(true)
    const snapshot = decodeSnapshot(result.value)
    expect(snapshot?.title).toBe('External Agents')
    expect(snapshot?.rows).toHaveLength(1)
    expect(snapshot?.rows[0]).toMatchObject({ title: 'Antigravity', enabled: true, installed: false, modelDiscoveryTimeoutMs: 45_000 })
    const catalog = await handler!(CATALOG_ENDPOINT, {}) as { ok: boolean; value: { groups: unknown[] } }
    expect(catalog.ok).toBe(true)
    expect(catalog.value.groups).toEqual([])
  })

  it('registers settings RPC through the injected scope when the root ctx refuses connection', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-settings-scope-'))
    homes.push(home)
    process.env.DSH_HOME = home
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const connection = { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } }
    const injected: string[][] = []
    const ctx = {
      on: () => () => {},
      effect: (fn: () => unknown) => fn(),
      inject: (deps: string[], run: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: () => () => void }; connection: typeof connection }) => unknown) => {
        injected.push(deps)
        return run({ effect: (fn: () => unknown) => fn(), llm: { registerAdapter: () => () => {} }, connection })
      },
      get connection(): typeof connection {
        throw new Error('cannot get property "connection" without inject')
      },
    }
    await apply(ctx, { executablePath: '', harnessPath: '', enabled: true })
    expect(injected).toContainEqual(['connection'])
    expect(handlers.get(ACP_SETTINGS_RPC_CHANNEL)).toEqual(expect.any(Function))
  })

  it('routes sign-in through the coalesced job and sign-out through the editor', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-signin-'))
    homes.push(home)
    process.env.DSH_HOME = home
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const injected: string[][] = []
    const connection = { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } }
    const ctx = {
      on: () => () => {},
      effect: (fn: () => unknown) => fn(),
      inject: (deps: string[], run: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: () => () => void }; connection: typeof connection }) => unknown) => {
        injected.push(deps)
        return run({ effect: (fn: () => unknown) => fn(), llm: { registerAdapter: () => () => {} }, connection })
      },
      connection,
    }
    await apply(ctx, { executablePath: '', harnessPath: '', enabled: true })
    expect(injected).toContainEqual(['connection'])
    const handler = handlers.get(ACP_SETTINGS_RPC_CHANNEL)!
    const started = await handler(RUN_ENDPOINT, { action: 'sign-in' }) as { ok: boolean; value: { started?: boolean } }
    expect(started.ok).toBe(true)
    expect(started.value.started).toBe(true)
    const signOut = await handler(RUN_ENDPOINT, { action: 'sign-out' }) as { ok: boolean }
    expect(signOut.ok).toBe(false)
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
    const injected: string[][] = []
    const connection = { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } }
    const ctx = {
      on: () => () => {},
      effect: (fn: () => unknown) => fn(),
      inject: (deps: string[], run: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: () => () => void }; connection: typeof connection }) => unknown) => {
        injected.push(deps)
        return run({ effect: (fn: () => unknown) => fn(), llm: { registerAdapter: () => () => {} }, connection })
      },
      connection,
    }
    await apply(ctx, { executablePath: server, harnessPath: harness, enabled: true })
    expect(injected).toContainEqual(['connection'])
    const result = await handlers.get(ACP_SETTINGS_RPC_CHANNEL)!(SNAPSHOT_ENDPOINT, {}) as { ok: boolean; value: unknown }
    const snapshot = decodeSnapshot(result.value)
    expect(snapshot?.rows[0]?.installed).toBe(true)
    expect(snapshot?.rows[0]?.executablePath).toBe(server)
  })

  it('reports a failed probe as a connection failure rather than a sign-in state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-probe-failed-'))
    homes.push(home)
    process.env.DSH_HOME = home
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-bin-'))
    homes.push(dir)
    const { writeFile, chmod } = await import('node:fs/promises')
    const server = join(dir, 'agy_acp_server.par')
    const harness = join(dir, 'localharness_external')
    // Both executables pass the inspection probe, then the native runtime exits before ACP initialize.
    await writeFile(server, '#!/bin/sh\nexit 1\n')
    await writeFile(harness, '#!/bin/sh\nexit 1\n')
    await chmod(server, 0o755)
    await chmod(harness, 0o755)
    const handlers = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const connection = { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } }
    const ctx = {
      on: () => () => {},
      effect: (fn: () => unknown) => fn(),
      inject: (deps: string[], run: (scope: { effect: (fn: () => unknown) => unknown; llm: { registerAdapter: () => () => void }; connection: typeof connection }) => unknown) => run({ effect: (fn: () => unknown) => fn(), llm: { registerAdapter: () => () => {} }, connection }),
      connection,
    }
    await apply(ctx, { executablePath: server, harnessPath: harness, enabled: true })
    const handler = handlers.get(ACP_SETTINGS_RPC_CHANNEL)!
    const validated = await handler(RUN_ENDPOINT, { action: 'validate-installation' }) as { ok: boolean }
    expect(validated.ok).toBe(false)
    const result = await handler(SNAPSHOT_ENDPOINT, {}) as { ok: boolean; value: unknown }
    expect(decodeSnapshot(result.value)?.rows[0]).toMatchObject({ installed: true, authenticated: false, ready: false, probeFailed: true })
  })

  it('routes native approval through the exact session agent without a Core call id', async () => {
    const seen: Record<string, unknown>[] = []
    const agent = { session: { id: 'session-1' } }
    const ctx = {
      get: (service: string): unknown => {
        if (service === 'agents') return { get: (id: string): unknown => id === 'session-1' ? agent : undefined }
        if (service === 'approval') return { request: (req: Record<string, unknown>): Promise<string> => { seen.push(req); return Promise.resolve('allowed-once') } }
        return undefined
      },
    }
    const outcome = await requestNativeApproval(ctx as never, { sessionId: 'session-1', toolName: 'Read', reason: 'read /lab/ws/note.txt' })
    expect(outcome).toBe('allowed-once')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.agent).toBe(agent)
    expect(seen[0]).toMatchObject({ toolName: 'Read', reason: 'read /lab/ws/note.txt' })
    expect(seen[0]).not.toHaveProperty('callId')
    expect(seen[0]).not.toHaveProperty('sessionId')
  })

  it('cancels native approval without generic ask when service or session is missing', async () => {
    let genericAsks = 0
    const askCtx = {
      get: (service: string): unknown => {
        if (service === 'userQuestions') return { ask: (): Promise<never> => { genericAsks += 1; throw new Error('must not ask') } }
        return undefined
      },
    }
    await expect(requestNativeApproval(askCtx as never, { sessionId: 'session-1', toolName: 'Read' })).resolves.toBe('cancelled')
    const agent = { session: { id: 'session-1' } }
    const noServiceCtx = {
      get: (service: string): unknown => service === 'agents' ? { get: (): unknown => agent } : undefined,
    }
    await expect(requestNativeApproval(noServiceCtx as never, { sessionId: 'session-1', toolName: 'Read' })).resolves.toBe('cancelled')
    const noAgentCtx = {
      get: (service: string): unknown => {
        if (service === 'agents') return { get: (): unknown => undefined }
        if (service === 'approval') return { request: (): Promise<string> => Promise.resolve('allowed-once') }
        return undefined
      },
    }
    await expect(requestNativeApproval(noAgentCtx as never, { sessionId: 'session-9', toolName: 'Read' })).resolves.toBe('cancelled')
    expect(genericAsks).toBe(0)
  })

  it('denies native approval when the service rejects without consulting generic ask', async () => {
    let genericAsks = 0
    const ctx = {
      get: (service: string): unknown => {
        if (service === 'agents') return { get: (): unknown => ({ session: { id: 'session-1' } }) }
        if (service === 'approval') return { request: (): Promise<string> => Promise.resolve('rejected') }
        if (service === 'userQuestions') return { ask: (): Promise<never> => { genericAsks += 1; throw new Error('must not ask') } }
        return undefined
      },
    }
    await expect(requestNativeApproval(ctx as never, { sessionId: 'session-1', toolName: 'Write' })).resolves.toBe('rejected')
    expect(genericAsks).toBe(0)
  })
})
