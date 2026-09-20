/** Browser-safe activity DTOs, endpoints, and decoders shared by the store and the settings RPC. */
import * as AcpProvider from '@deepseek-ai/dsh-acp-provider'
import { providerId, sessionId, type ExternalAgentSessionRef, type ExternalAgentFullAccessAudit } from '@deepseek-ai/dsh-acp-provider'
import { isRecord, stringValue } from './decode.js'
import { decodeRequestTelemetry, decodeUsageSnapshots, type NativeRequestTelemetry, type NativeUsageSnapshots } from './request-telemetry.js'
import {
  ANTIGRAVITY_REQUEST_TELEMETRY,
  ANTIGRAVITY_USAGE_SNAPSHOTS,
  ANTIGRAVITY_AGENT_OBSERVED,
  ANTIGRAVITY_AGENT_TEXT,
  ANTIGRAVITY_USER_QUESTION_ANSWER,
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  type AntigravityAgentTextData,
  type AntigravityUserQuestionAnswerData,
  type AntigravitySessionReadyData,
  type AntigravityToolLocation,
  isToolOwnership,
  type AntigravityToolOwnership,
  type AntigravityToolStartData,
  type AntigravityToolUpdateData,
} from './tool-events.js'

/** Settings-channel endpoint returning one session history. */
export const ACTIVITY_ENDPOINT = 'activity/read'

/** Settings-channel endpoint returning the native binding for one session. */
export const ACTIVITY_BINDING_ENDPOINT = 'activity/binding'

/** Settings-channel endpoint returning one bounded page strictly after an exclusive cursor. */
export const ACTIVITY_READ_AFTER_ENDPOINT = 'activity/read-after'

/** RPC error code for a page cursor that is ahead of the history the host holds. */
export const ACTIVITY_STALE_CURSOR = 'stale-cursor'

/** Fixed record ceiling requested for one incremental page; the store clamps to its own ceiling. */
export const ACTIVITY_PAGE_RECORD_LIMIT = 500

/** Schema version written on every history line and returned by reads. */
export const ACTIVITY_SCHEMA_VERSION = 1

/** Value-free authorization recorded before native full-access execution. */
export const ANTIGRAVITY_FULL_ACCESS_AUTHORIZED = 'antigravity/full-access-authorized' as const
export type AntigravityFullAccessEvent = { readonly type: typeof ANTIGRAVITY_FULL_ACCESS_AUTHORIZED; readonly data: ExternalAgentFullAccessAudit }

/** One persisted history line with replay order and wall-clock time. */
export type AntigravityActivityRecord =
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_USAGE_SNAPSHOTS; readonly data: NativeUsageSnapshots }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_REQUEST_TELEMETRY; readonly data: NativeRequestTelemetry }
  | ({ readonly seq: number; readonly time: string } & AntigravityFullAccessEvent)
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_SESSION_READY; readonly data: AntigravitySessionReadyData }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_TOOL_START; readonly data: AntigravityToolStartData }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_TOOL_UPDATE; readonly data: AntigravityToolUpdateData }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_AGENT_OBSERVED; readonly data: AntigravityToolOwnership }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_AGENT_TEXT; readonly data: AntigravityAgentTextData }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_USER_QUESTION_ANSWER; readonly data: AntigravityUserQuestionAnswerData }

/** History snapshot: schema version plus records in seq order. */
export interface AntigravityActivityHistory {
  readonly version: number
  readonly records: readonly AntigravityActivityRecord[]
}

/** One bounded incremental page: the records after a cursor plus how to continue. */
export interface AntigravityActivityPage {
  readonly version: number
  readonly records: readonly AntigravityActivityRecord[]
  /** Pass back as the next afterSeq: the last record's seq, or the requested cursor for an empty page. */
  readonly nextCursor: number
  /** True when the history holds further records after this page. */
  readonly hasMore: boolean
}

/** A page cursor ahead of the history the store holds: the reader must resynchronize, never retry the cursor. */
export class ActivityCursorStaleError extends Error {
  constructor(cursor: number, records: number) {
    super('Antigravity activity cursor ' + String(cursor) + ' is ahead of the ' + String(records) + '-record history')
    this.name = 'ActivityCursorStaleError'
  }
}

/** Read the latest native binding; legacy ready-only histories intentionally have no cursor.
 * @param history - Validated sidecar history.
 * @param id - DSH conversation owning the history.
 * @returns Its native reference, or undefined for a conversation never opened natively.
 */
export function nativeSessionBinding(history: AntigravityActivityHistory, id: string): ExternalAgentSessionRef | undefined {
  const shared = Reflect.get(AcpProvider, 'latestNativeSessionBinding')
  if (typeof shared === 'function') {
    try {
      return (shared as LatestNativeSessionBinding)(history.records, id, ANTIGRAVITY_SESSION_READY, 'antigravity')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      const prefix = 'Antigravity activity history is corrupt: '
      throw corrupt(message.startsWith(prefix) ? message.slice(prefix.length) : message)
    }
  }
  for (let index = history.records.length - 1; index >= 0; index--) {
    const record = history.records[index]
    if (record?.type !== ANTIGRAVITY_SESSION_READY) continue
    const ref = record.data.ref
    if (ref === undefined) return { provider: providerId('antigravity'), session: sessionId(id) }
    if (ref.session !== id) throw corrupt('native binding belongs to another DSH session')
    return ref
  }
  return undefined
}

type LatestNativeSessionBinding = (
  records: readonly { readonly type: string; readonly data: unknown }[],
  boundSession: string,
  readyType: string,
  fallbackProvider: string,
) => ExternalAgentSessionRef | undefined

/** Native binding for one session: the provider when a ready record exists, else null. */
export interface AntigravityActivityBinding {
  readonly provider: 'antigravity' | null
}

/** Decode a strict activity wire payload to its session id.
 * @param value - Wire payload, exactly { sessionId } with a non-empty id.
 * @returns The session id, or undefined for any other shape.
 */
export function decodeActivitySessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'sessionId') return undefined
  const sessionId = value.sessionId
  return typeof sessionId === 'string' && sessionId.trim() !== '' ? sessionId : undefined
}

/** Decode a strict cursor-read payload to its session id and exclusive cursor.
 * @param value - Wire payload, exactly { sessionId, afterSeq } with a non-empty id and a non-negative safe integer cursor.
 * @returns The decoded request, or undefined for any other shape.
 */
export function decodeActivityPageRequest(value: unknown): { readonly sessionId: string; readonly afterSeq: number } | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('sessionId') || !keys.includes('afterSeq')) return undefined
  const sessionId = value.sessionId
  const afterSeq = value.afterSeq
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return undefined
  if (typeof afterSeq !== 'number' || !Number.isSafeInteger(afterSeq) || afterSeq < 0) return undefined
  return { sessionId, afterSeq }
}

/** Decode one history record.
 * @param line - One raw JSONL history line.
 * @param seq - Expected 1-based position; records must stay contiguous.
 * @returns The validated record.
 */
export function decodeActivityRecord(line: string, seq: number): AntigravityActivityRecord {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch {
    throw corrupt('line ' + String(seq) + ' is not JSON')
  }
  return decodeRecordValue(value, seq)
}

/** Decode a history snapshot, throwing on any invalid version or record.
 * @param value - Wire snapshot claiming { version, records }.
 * @returns The validated history.
 */
export function decodeActivityHistory(value: unknown): AntigravityActivityHistory {
  if (!isRecord(value)) throw corrupt('history is not an object')
  if (value.version !== ACTIVITY_SCHEMA_VERSION) throw corrupt('history has an unknown version')
  if (!Array.isArray(value.records)) throw corrupt('history has invalid records')
  return { version: ACTIVITY_SCHEMA_VERSION, records: value.records.map((record, index) => decodeRecordValue(withVersion(record, index + 1), index + 1)) }
}

/** Decode one incremental page against the cursor it was requested with, so records are
 * validated from `afterSeq + 1` instead of the `seq = 1` full-history read.
 * @param value - Wire page claiming { version, records, nextCursor, hasMore }.
 * @param afterSeq - Exclusive cursor the page was requested with.
 * @returns The validated page.
 */
export function decodeActivityPage(value: unknown, afterSeq: number): AntigravityActivityPage {
  if (!isRecord(value)) throw corrupt('page is not an object')
  if (value.version !== ACTIVITY_SCHEMA_VERSION) throw corrupt('page has an unknown version')
  if (!Array.isArray(value.records)) throw corrupt('page has invalid records')
  if (typeof value.hasMore !== 'boolean') throw corrupt('page has an invalid continuation flag')
  const nextCursor = value.nextCursor
  if (typeof nextCursor !== 'number' || !Number.isSafeInteger(nextCursor) || nextCursor < afterSeq) throw corrupt('page has an invalid cursor')
  const records = value.records.map((record, index) => decodeRecordValue(withVersion(record, afterSeq + index + 1), afterSeq + index + 1))
  const last = records.at(-1)
  if (last === undefined ? nextCursor !== afterSeq : last.seq !== nextCursor) throw corrupt('page cursor does not match its records')
  return { version: ACTIVITY_SCHEMA_VERSION, records, nextCursor, hasMore: value.hasMore }
}

function withVersion(record: unknown, seq: number): Record<string, unknown> {
  if (!isRecord(record)) throw corrupt('line ' + String(seq) + ' is not an object')
  return { ...record, v: ACTIVITY_SCHEMA_VERSION }
}

function corrupt(reason: string): Error {
  return new Error('Antigravity activity history is corrupt: ' + reason)
}

function decodeRecordValue(value: unknown, seq: number): AntigravityActivityRecord {
  if (!isRecord(value)) throw corrupt('line ' + String(seq) + ' is not an object')
  if (value.v !== ACTIVITY_SCHEMA_VERSION) throw corrupt('line ' + String(seq) + ' has an unknown version')
  if (value.seq !== seq) throw corrupt('line ' + String(seq) + ' breaks the sequence')
  const time = value.time
  if (typeof time !== 'string' || Number.isNaN(Date.parse(time))) throw corrupt('line ' + String(seq) + ' has an invalid time')
  const type = value.type
  if (type === ANTIGRAVITY_USAGE_SNAPSHOTS) {
    const data = decodeUsageSnapshots(value.data)
    if (data !== undefined) return { seq, time, type, data }
  }
  if (type === ANTIGRAVITY_REQUEST_TELEMETRY) {
    const data = decodeRequestTelemetry(value.data)
    if (data !== undefined) return { seq, time, type, data }
  }
  if (type === ANTIGRAVITY_FULL_ACCESS_AUTHORIZED && isRecord(value.data) && stringValue(value.data.provider) !== undefined && stringValue(value.data.session) !== undefined && value.data.mode === 'full-access' && (value.data.auditId === undefined || stringValue(value.data.auditId) !== undefined)) return { seq, time, type, data: value.data as unknown as ExternalAgentFullAccessAudit }
  if (type === ANTIGRAVITY_SESSION_READY && isSessionReadyData(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_TOOL_START && isToolStartData(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_TOOL_UPDATE && isToolUpdateData(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_AGENT_OBSERVED && isToolOwnership(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_AGENT_TEXT && isAgentTextData(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_USER_QUESTION_ANSWER && isUserQuestionAnswerData(value.data)) return { seq, time, type, data: value.data }
  throw corrupt('line ' + String(seq) + ' has an unknown type or data')
}

function isUserQuestionAnswerData(value: unknown): value is AntigravityUserQuestionAnswerData {
  if (!isRecord(value) || stringValue(value.requestId) === undefined || typeof value.question !== 'string') return false
  if (!Array.isArray(value.selected) || value.selected.some(item => typeof item !== 'string')) return false
  return value.custom === undefined || typeof value.custom === 'string'
}

function isAgentTextData(value: unknown): value is AntigravityAgentTextData {
  if (!isRecord(value) || stringValue(value.trajectoryId) === undefined) return false
  if (value.parentTrajectoryId !== undefined && stringValue(value.parentTrajectoryId) === undefined) return false
  if (value.kind !== 'text' && value.kind !== 'thought') return false
  return typeof value.text === 'string' && value.text.length > 0
}

function isSessionReadyData(value: unknown): value is AntigravitySessionReadyData {
  if (!isRecord(value) || value.provider !== 'antigravity') return false
  if (value.ref === undefined) return true
  const ref = value.ref
  if (!isRecord(ref) || ref.provider !== value.provider || stringValue(ref.provider) === undefined || stringValue(ref.session) === undefined || (ref.nativeSession !== undefined && stringValue(ref.nativeSession) === undefined)) return false
  const cursor = ref.resumeCursor
  return cursor === undefined || (isRecord(cursor) && cursor.provider === ref.provider && stringValue(cursor.value) !== undefined)
}

function isToolStatus(value: unknown): value is AntigravityToolStartData['status'] {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed'
}

function isToolLocation(value: unknown): value is AntigravityToolLocation {
  return isRecord(value) && stringValue(value.target) !== undefined && (value.kind === 'file' || value.kind === 'url')
}

function isToolStartData(value: unknown): value is AntigravityToolStartData {
  if (!isRecord(value)) return false
  if (stringValue(value.toolId) === undefined || stringValue(value.name) === undefined) return false
  if (!isToolStatus(value.status)) return false
  if (value.input !== undefined && typeof value.input !== 'string') return false
  if (value.location !== undefined && !isToolLocation(value.location)) return false
  return value.ownership === undefined || isToolOwnership(value.ownership)
}

function isToolUpdateData(value: unknown): value is AntigravityToolUpdateData {
  if (!isRecord(value)) return false
  if (stringValue(value.toolId) === undefined || !isToolStatus(value.status)) return false
  if (value.name !== undefined && stringValue(value.name) === undefined) return false
  if (value.input !== undefined && typeof value.input !== 'string') return false
  if (value.location !== undefined && !isToolLocation(value.location)) return false
  if (value.output !== undefined && typeof value.output !== 'string') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  return value.ownership === undefined || isToolOwnership(value.ownership)
}
