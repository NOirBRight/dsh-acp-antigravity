/** Browser-safe activity DTOs, endpoints, and decoders shared by the store and the settings RPC. */
import { isRecord, stringValue } from './decode.js'
import {
  ANTIGRAVITY_SESSION_READY,
  ANTIGRAVITY_TOOL_START,
  ANTIGRAVITY_TOOL_UPDATE,
  type AntigravitySessionReadyData,
  type AntigravityToolLocation,
  type AntigravityToolStartData,
  type AntigravityToolUpdateData,
} from './tool-events.js'

/** Settings-channel endpoint returning one session history. */
export const ACTIVITY_ENDPOINT = 'activity/read'

/** Settings-channel endpoint returning the native binding for one session. */
export const ACTIVITY_BINDING_ENDPOINT = 'activity/binding'

/** Schema version written on every history line and returned by reads. */
export const ACTIVITY_SCHEMA_VERSION = 1

/** One persisted history line with replay order and wall-clock time. */
export type AntigravityActivityRecord =
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_SESSION_READY; readonly data: AntigravitySessionReadyData }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_TOOL_START; readonly data: AntigravityToolStartData }
  | { readonly seq: number; readonly time: string; readonly type: typeof ANTIGRAVITY_TOOL_UPDATE; readonly data: AntigravityToolUpdateData }

/** History snapshot: schema version plus records in seq order. */
export interface AntigravityActivityHistory {
  readonly version: number
  readonly records: readonly AntigravityActivityRecord[]
}

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
  if (type === ANTIGRAVITY_SESSION_READY && isSessionReadyData(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_TOOL_START && isToolStartData(value.data)) return { seq, time, type, data: value.data }
  if (type === ANTIGRAVITY_TOOL_UPDATE && isToolUpdateData(value.data)) return { seq, time, type, data: value.data }
  throw corrupt('line ' + String(seq) + ' has an unknown type or data')
}

function isSessionReadyData(value: unknown): value is AntigravitySessionReadyData {
  return isRecord(value) && value.provider === 'antigravity'
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
  return value.location === undefined || isToolLocation(value.location)
}

function isToolUpdateData(value: unknown): value is AntigravityToolUpdateData {
  if (!isRecord(value)) return false
  if (stringValue(value.toolId) === undefined || !isToolStatus(value.status)) return false
  if (value.input !== undefined && typeof value.input !== 'string') return false
  if (value.location !== undefined && !isToolLocation(value.location)) return false
  if (value.output !== undefined && typeof value.output !== 'string') return false
  return value.error === undefined || typeof value.error === 'string'
}
