/** Host RPC for the External Agents settings page. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { clientRequestSchema, type HostConnectionHandle, type PeerScope } from '@deepseek-ai/dsh-client-connection'
import { isRecord } from './decode.js'
import {
  ACTIVITY_BINDING_ENDPOINT,
  ACTIVITY_ENDPOINT,
  ACTIVITY_READ_AFTER_ENDPOINT,
  ACTIVITY_STALE_CURSOR,
  ActivityCursorStaleError,
  decodeActivityPageRequest,
  decodeActivitySessionId,
  nativeSessionBinding,
  type AntigravityActivityHistory,
  type AntigravityActivityPage,
} from './activity-contract.js'
import {
  ACP_SETTINGS_RPC_METHOD,
  ACP_SETTINGS_RPC_PATH,
  PICK_ENDPOINT,
  QUOTA_ENDPOINT,
  RUN_ENDPOINT,
  SAVE_ENDPOINT,
  CATALOG_ENDPOINT,
  SNAPSHOT_ENDPOINT,
  decodeConfig,
  type AcpAntigravitySettingsConfig,
  type AcpSettingsSnapshot,
  type AntigravityQuotaSnapshot,
} from './client-contract.js'

type RpcAttachment = { readonly path: readonly (string | number)[]; readonly bytes: Uint8Array }
type RpcResult =
  | { readonly ok: true; readonly value: unknown; readonly attachments?: readonly RpcAttachment[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: object } }

function fail(message: string): RpcResult {
  return { ok: false, error: { code: 'internal', message } }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function activityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith('Antigravity activity history') ? message : 'Antigravity activity history is unavailable'
}

/** Live Settings operations owned by the host plugin. */
export interface AcpSettingsRpcDeps {
  snapshot(): Promise<AcpSettingsSnapshot>
  catalog(): Promise<{ groups: readonly { id: string; name: string; models: readonly { id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string } }[] }[] }>
  quota(signal?: AbortSignal): Promise<AntigravityQuotaSnapshot>
  readActivity(sessionId: string): AntigravityActivityHistory
  readActivityAfter(sessionId: string, afterSeq: number): AntigravityActivityPage
  applyConfig(config: AcpAntigravitySettingsConfig): Promise<void>
  run(action: string, value?: unknown, signal?: AbortSignal): Promise<unknown>
}

/** Handle snapshot, save, provider actions, and executable picking. */
export function createAcpSettingsRpcHandler(deps: AcpSettingsRpcDeps): (endpoint: string, payload: unknown, signal?: AbortSignal, operator?: PeerScope) => Promise<RpcResult> {
  return async (endpoint, payload, signal, _operator) => {
    if (endpoint === SNAPSHOT_ENDPOINT) return { ok: true, value: await deps.snapshot() }
    if (endpoint === CATALOG_ENDPOINT) return { ok: true, value: await deps.catalog() }
    if (endpoint === QUOTA_ENDPOINT) {
      try {
        return { ok: true, value: await deps.quota(signal) }
      } catch (error) {
        return fail(errorText(error))
      }
    }
    if (endpoint === ACTIVITY_ENDPOINT || endpoint === ACTIVITY_BINDING_ENDPOINT) {
      const sessionId = decodeActivitySessionId(payload)
      if (sessionId === undefined) return fail('invalid Antigravity activity request')
      try {
        const history = await deps.readActivity(sessionId)
        if (endpoint === ACTIVITY_BINDING_ENDPOINT) {
          const bound = nativeSessionBinding(history, sessionId) !== undefined
          return { ok: true, value: { provider: bound ? 'antigravity' : null } }
        }
        return { ok: true, value: history }
      } catch (error) {
        return fail(activityError(error))
      }
    }
    if (endpoint === ACTIVITY_READ_AFTER_ENDPOINT) {
      const request = decodeActivityPageRequest(payload)
      if (request === undefined) return fail('invalid Antigravity activity request')
      try {
        return { ok: true, value: await deps.readActivityAfter(request.sessionId, request.afterSeq) }
      } catch (error) {
        if (error instanceof ActivityCursorStaleError) return { ok: false, error: { code: ACTIVITY_STALE_CURSOR, message: 'Antigravity activity cursor is stale; the history must be reloaded.' } }
        return fail(activityError(error))
      }
    }
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


function rpcResponse(rpcId: string, result: RpcResult): Response {
  if (!result.ok) {
    return Response.json({
      type: 'server-response',
      rpcId,
      result: {
        ok: false,
        error: { ...result.error, details: result.error.details ?? {} },
      },
    })
  }
  const { attachments, ...success } = result
  const response = { type: 'server-response', rpcId, result: success }
  if (attachments === undefined || attachments.length === 0) return Response.json(response)
  const parts = new FormData()
  const attachmentMetadata = attachments.map((attachment, index) => {
    const part = `bytes-${index}`
    parts.set(part, new Blob([new Uint8Array(attachment.bytes)]))
    return { path: [...attachment.path], codec: 'bytes', part }
  })
  parts.set('metadata', JSON.stringify({ ...response, attachments: attachmentMetadata }))
  return new Response(parts)
}

/** Register one authenticated exact route and attach its disposer to this fiber. */
export function registerAcpSettingsRpc(
  ctx: {
    effect(fn: () => unknown, name?: string): void
    connection: Pick<HostConnectionHandle, 'fetch' | 'operator'>
  },
  deps: AcpSettingsRpcDeps,
): void {
  const handler = createAcpSettingsRpcHandler(deps)
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ACP_SETTINGS_RPC_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        if (contentType !== 'application/json') return new Response('Unsupported Media Type', { status: 415 })
        let raw: unknown
        try {
          raw = await request.json()
        } catch {
          return new Response('Bad Request', { status: 400 })
        }
        const parsed = clientRequestSchema.safeParse(raw)
        if (!parsed.success || parsed.data.method !== ACP_SETTINGS_RPC_METHOD) return new Response('Bad Request', { status: 400 })
        const payload = parsed.data.payload
        if (!isRecord(payload) || typeof payload.endpoint !== 'string') {
          return new Response('Bad Request', { status: 400 })
        }
        try {
          const result = await handler(payload.endpoint, payload.payload, request.signal, ctx.connection.operator)
          return rpcResponse(parsed.data.rpcId, result)
        } catch {
          return new Response('Internal Server Error', { status: 500 })
        }
      },
    }),
    'dsh-acp-antigravity: settings RPC',
  )
}
