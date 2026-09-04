/** Host RPC for the External Agents settings page. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ACP_SETTINGS_RPC_CHANNEL,
  PICK_ENDPOINT,
  RUN_ENDPOINT,
  SAVE_ENDPOINT,
  SNAPSHOT_ENDPOINT,
  decodeConfig,
  type AcpAntigravitySettingsConfig,
  type AcpSettingsSnapshot,
} from './client-contract.js'

type RpcResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: object } }

function fail(message: string): RpcResult {
  return { ok: false, error: { code: 'internal', message } }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Live Settings operations owned by the host plugin. */
export interface AcpSettingsRpcDeps {
  snapshot(): Promise<AcpSettingsSnapshot>
  applyConfig(config: AcpAntigravitySettingsConfig): Promise<void>
  run(action: string, value?: unknown, signal?: AbortSignal): Promise<unknown>
}

/** Handle snapshot, save, provider actions, and executable picking. */
export function createAcpSettingsRpcHandler(deps: AcpSettingsRpcDeps): (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult> {
  return async (endpoint, payload, signal) => {
    if (endpoint === SNAPSHOT_ENDPOINT) return { ok: true, value: await deps.snapshot() }
    if (endpoint === SAVE_ENDPOINT) {
      const decoded = decodeConfig(payload)
      if (decoded === undefined) return fail('invalid Antigravity settings')
      try {
        await deps.applyConfig(decoded)
        return { ok: true, value: { saved: true } }
      } catch (error) {
        return fail('Antigravity settings were not applied: ' + errorText(error))
      }
    }
    if (endpoint === RUN_ENDPOINT) {
      if (payload === null || typeof payload !== 'object' || typeof (payload as { action?: unknown }).action !== 'string') return fail('Antigravity settings action is missing')
      try {
        const value = await deps.run((payload as { action: string; value?: unknown }).action, (payload as { value?: unknown }).value, signal)
        return { ok: true, value: value ?? { ok: true } }
      } catch (error) {
        return fail(errorText(error))
      }
    }
    if (endpoint === PICK_ENDPOINT) {
      try {
        const { stdout } = await promisify(execFile)('zenity', ['--file-selection', '--title=Select executable'], { encoding: 'utf8', timeout: 120_000 })
        const path = stdout.trim()
        return { ok: true, value: { path: path.length > 0 ? path : null } }
      } catch {
        return { ok: true, value: { path: null } }
      }
    }
    return fail('unknown Antigravity settings endpoint: ' + endpoint)
  }
}

/** Register the host channel and attach its disposer to this fiber. */
export function registerAcpSettingsRpc(ctx: { effect(fn: () => unknown, name?: string): void; connection: { rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult>): unknown } } }, deps: AcpSettingsRpcDeps): void {
  ctx.effect(
    () => ctx.connection.rpc.handle(ACP_SETTINGS_RPC_CHANNEL, createAcpSettingsRpcHandler(deps)),
    'dsh-acp-antigravity: settings RPC',
  )
}
