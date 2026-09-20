/** Shared plugin-mount scaffold for tests that drive `apply()` through a fake cordis scope.
 *
 * Each test file still owns its own `vi.mock` factories (vitest hoists them per
 * file); this keeps the scope/ctx plumbing and the adapter/deps capture in one
 * place so an `apply()` signature change does not have to be repeated per file.
 */
import { vi } from 'vitest'
import type { AcpAntigravitySettingsConfig } from '../../src/client-contract.js'
import { apply, type DshPluginConfig, type DshPluginContext } from '../../src/dsh-plugin.js'
import type { createAntigravityLlmBridge } from '../../src/llm-bridge.js'
import { registerAcpSettingsRpc, type AcpSettingsRpcDeps } from '../../src/rpc.js'

export interface MountedPlugin {
  /** Adapter registration handle returned by the fake `llm` service. */
  readonly handle: ReturnType<typeof vi.fn> & { replace: ReturnType<typeof vi.fn> }
  /** Adapter registered by the plugin under test. */
  readonly adapter: ReturnType<typeof createAntigravityLlmBridge>
  /** Settings RPC dependencies the plugin handed to `registerAcpSettingsRpc`. */
  readonly deps: Pick<AcpSettingsRpcDeps, 'applyConfig'>
}

/** Settings for one test's isolated profile directory.
 * @param stateDirectory - profile directory this test owns.
 * @param extra - catalog membership or other fields this test needs.
 */
export function runtimeConfig(stateDirectory: string, extra: Partial<AcpAntigravitySettingsConfig> = {}): AcpAntigravitySettingsConfig {
  return { executablePath: '/bin/antigravity', harnessPath: '', stateDirectory, instanceId: 'default', enabled: true, ...extra }
}

/** Mount the plugin and return what the test needs to drive it.
 * @param get - fake `ctx.get(name)` service lookup; absent services are undefined.
 * @param config - loader-supplied plugin config; pass the same runtime keys the test
 *   later sends through `applyConfig` so that call does not remount the provider.
 * @returns the adapter registration handle, the registered adapter, and the RPC deps.
 */
export async function mountPlugin(get: (name: string) => unknown = () => undefined, config: DshPluginConfig = {}): Promise<MountedPlugin> {
  const handle = Object.assign(vi.fn(), { replace: vi.fn() })
  const registerAdapter = vi.fn((_providers: string[], _adapter: unknown) => handle)
  const effect = (fn: () => unknown): unknown => fn()
  const scope = { effect, llm: { registerAdapter }, connection: { rpc: { handle: vi.fn() } } }
  const ctx = {
    ...scope,
    get,
    on: vi.fn(),
    inject: (_deps: string[], fn: (value: typeof scope) => void) => fn(scope),
  }
  await apply(ctx as unknown as DshPluginContext, config)
  const adapter = registerAdapter.mock.calls.at(-1)?.[1] as ReturnType<typeof createAntigravityLlmBridge> | undefined
  const deps = vi.mocked(registerAcpSettingsRpc).mock.calls.at(-1)?.[1]
  if (adapter === undefined) throw new Error('apply() registered no adapter')
  if (deps === undefined) throw new Error('apply() registered no Settings RPC deps')
  return { handle, adapter, deps }
}
