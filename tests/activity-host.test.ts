import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { AntigravityActivityStore } from '../src/activity-store.js'
import { createAntigravityLlmBridge } from '../src/llm-bridge.js'
import { validRef } from './bridge-fixtures.js'
import { apply, type DshPluginContext } from '../src/dsh-plugin.js'

vi.mock('../src/llm-bridge.js', () => ({ createAntigravityLlmBridge: vi.fn(() => ({})) }))

it('stores native activity independently without appending any Core session event', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agy-history-host-'))
  vi.stubEnv('DSH_HOME', home)
  const append = vi.fn()
  const on = vi.fn(() => () => {})
  const agent = { session: { append } }
  const scope = { effect: (fn: () => unknown) => fn(), llm: { registerAdapter: () => () => {} } }
  const ctx: DshPluginContext = {
    on,
    effect: scope.effect,
    inject: (_deps, run) => run(scope),
    get: () => ({ get: () => agent, roots: () => [agent] }),
    connection: { rpc: { handle: () => () => {} } },
  }
  try {
    await apply(ctx, { enabled: false })
    expect(on).toHaveBeenCalledWith('llm/stream', expect.any(Function))
    const sink = vi.mocked(createAntigravityLlmBridge).mock.calls.at(-1)![3]!
    sink.appendSessionReady!('session-native', validRef({ session: 'session-native' }))
    sink.appendToolEvents!('session-native', [{ type: 'antigravity/tool-start', data: { toolId: 'read', name: 'Read', status: 'completed' } }])
    expect(append).not.toHaveBeenCalled()
    const restored = new AntigravityActivityStore(join(home, 'plugin-data', 'antigravity', 'history')).read('session-native')
    expect(restored.records.map(record => record.type)).toEqual(['antigravity/session-ready', 'antigravity/tool-start'])
    expect(() => sink.appendSessionReady!(undefined, validRef())).toThrow(/session/i)
    vi.spyOn(AntigravityActivityStore.prototype, 'append').mockImplementationOnce(() => { throw new Error('EACCES /private/path') })
    expect(() => sink.appendSessionReady!('failed-storage', validRef({ session: 'failed-storage' }))).toThrow(/^Unable to persist Antigravity activity; native execution stopped[.]$/)
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  }
})
