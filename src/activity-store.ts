/** Append-only per-session history for Antigravity native tool activity.
 *
 * One JSONL file per DSH session under the caller-supplied root; each line is
 * one versioned record { v, seq, time, type, data }. One owner per history
 * root: concurrent writers can interleave batches and break seq contiguity,
 * which read() rejects as corruption, and a crash can leave a partial trailing
 * line that read() fails closed on without repairing. History files open with
 * O_NOFOLLOW and must be regular files, so a planted symlink is rejected and
 * never followed for read, write, or chmod.
 */
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTIVITY_SCHEMA_VERSION,
  decodeActivityRecord,
  type AntigravityActivityHistory,
} from './activity-contract.js'
import type { AntigravitySessionReadyEvent, AntigravityToolEvent } from './tool-events.js'

export { ACTIVITY_SCHEMA_VERSION } from './activity-contract.js'
export type { AntigravityActivityHistory, AntigravityActivityRecord } from './activity-contract.js'

/** Events the store persists: session readiness plus tool start/update rows. */
export type AntigravityActivityEvent = AntigravitySessionReadyEvent | AntigravityToolEvent

/** Minimal durable store independent of runtime and auth directories. */
export class AntigravityActivityStore {
  private readonly root: string

  /** Capture the history root; directories are created lazily on append.
   * @param rootDirectory - Explicit history root, e.g. home/plugin-data/antigravity/history.
   */
  constructor(rootDirectory: string) {
    if (rootDirectory.trim() === '') throw new Error('Antigravity activity history requires a root directory')
    this.root = rootDirectory
  }

  /** Append events for one DSH session, assigning contiguous seq values.
   * Event text bounds are per-event and do not bound history size.
   * @param sessionId - Required DSH session id; hashed into the filename so it can never escape the root.
   * @param events - Durable events from toDurableToolEvents plus at most one session-ready event.
   * @returns Nothing; throws fail-closed on a corrupt existing file without overwriting it.
   */
  append(sessionId: string, events: readonly AntigravityActivityEvent[]): void {
    requireSessionId(sessionId)
    if (events.length === 0) return
    const path = this.fileFor(sessionId)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    chmodSync(this.root, 0o700)
    // ponytail: O(n) re-read per append to assign seq; track next seq in memory if append throughput matters
    const next = this.read(sessionId).records.length + 1
    const time = new Date().toISOString()
    const out = Buffer.from(events
      .map((event, index) => JSON.stringify({ v: ACTIVITY_SCHEMA_VERSION, seq: next + index, time, type: event.type, data: event.data }) + String.fromCharCode(10))
      .join(''), 'utf8')
    const fd = openHistory(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600)
    try {
      fchmodSync(fd, 0o600)
      let offset = 0
      while (offset < out.byteLength) offset += writeSync(fd, out, offset)
    } finally {
      closeSync(fd)
    }
  }

  /** Read one session history in seq order.
   * @param sessionId - Required DSH session id.
   * @returns The schema version plus validated records; empty records for an unknown session.
   */
  read(sessionId: string): AntigravityActivityHistory {
    requireSessionId(sessionId)
    let fd: number
    try {
      fd = openHistory(this.fileFor(sessionId), constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (isFileNotFound(error)) return { version: ACTIVITY_SCHEMA_VERSION, records: [] }
      throw error
    }
    try {
      const lines = readFileSync(fd, 'utf8').split(String.fromCharCode(10))
      if (lines.pop() !== '') throw corrupt('incomplete trailing record')
      return { version: ACTIVITY_SCHEMA_VERSION, records: lines.map((line, index) => decodeActivityRecord(line, index + 1)) }
    } finally {
      closeSync(fd)
    }
  }

  private fileFor(sessionId: string): string {
    return join(this.root, createHash('sha256').update(sessionId, 'utf8').digest('hex') + '.jsonl')
  }
}

function requireSessionId(sessionId: string): void {
  if (sessionId.trim() === '') throw new Error('Antigravity activity history requires a session id')
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isTooManyLinks(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ELOOP'
}

function openHistory(path: string, flags: number, mode?: number): number {
  let fd: number
  try {
    fd = openSync(path, flags, mode)
  } catch (error) {
    if (isTooManyLinks(error)) throw new Error('Antigravity activity history must not be a symbolic link')
    throw error
  }
  if (!fstatSync(fd).isFile()) {
    closeSync(fd)
    throw corrupt('history path is not a regular file')
  }
  return fd
}

function corrupt(reason: string): Error {
  return new Error('Antigravity activity history is corrupt: ' + reason)
}
