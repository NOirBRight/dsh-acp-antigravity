/** Plugin-level regression for a failing activity flush during mount.
 *
 * The bridge now resets its runner even when the flush fails, and the plugin's
 * mount guard must be released either way: if a failed reset left the guard set,
 * every later configuration change would be refused with "configuration is
 * changing" and the provider could never be remounted.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { mountPlugin, runtimeConfig } from './support/mount-plugin.js'

const home = mkdtempSync(join(tmpdir(), 'acp-mount-reset-'))
process.env.DSH_HOME = home
afterAll(() => { rmSync(home, { recursive: true, force: true }) })
const bridgeState = vi.hoisted(() => ({ failReset: false, resets: 0 }))

vi.mock('../src/activity-binding.js', () => ({ installActivityBindingGuard: vi.fn() }))
vi.mock('../src/rpc.js', () => ({ registerAcpSettingsRpc: vi.fn() }))
vi.mock('../src/plugin.js', () => ({
  installAntigravityProvider: () => ({
    provider: {
      info: { id: 'antigravity', name: 'Cursor' },
      health: { status: 'ready' },
      validateInstallation: async () => ({}),
      listModels: async () => [],
    },
    dispose: async () => undefined,
  }),
}))
vi.mock('../src/llm-bridge.js', () => ({
  createAntigravityLlmBridge: () => ({
    reset: async () => {
      bridgeState.resets += 1
      if (bridgeState.failReset) throw new Error('Unable to persist Antigravity activity; native execution stopped.')
    },
    dispose: async () => undefined,
  }),
}))

it('releases the mount guard after a failed bridge reset so the next mount proceeds', async () => {
  const { deps } = await mountPlugin()
  const base = runtimeConfig(join(home, 'antigravity'), { catalogOrder: [] })

  bridgeState.failReset = true
  await expect(deps.applyConfig({ ...base, model: 'gpt-5' })).rejects.toThrow('Unable to persist Antigravity activity; native execution stopped.')

  // The guard was released, so a later runtime change mounts instead of being
  // refused while the adapter is unrecoverable.
  bridgeState.failReset = false
  await expect(deps.applyConfig({ ...base, model: 'gpt-5-low' })).resolves.toBeUndefined()
  expect(bridgeState.resets).toBe(2)
})
