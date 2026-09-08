/** Append-only per-session history for Antigravity native tool activity. */
import { ExternalAgentActivityStore } from '@deepseek-ai/dsh-acp-provider/activity-store'
import {
  ACTIVITY_SCHEMA_VERSION,
  decodeActivityRecord,
  type AntigravityActivityHistory,
  type AntigravityActivityRecord,
  type AntigravityFullAccessEvent,
} from './activity-contract.js'
import type { AntigravitySessionReadyEvent, AntigravityToolEvent } from './tool-events.js'

export { ACTIVITY_SCHEMA_VERSION } from './activity-contract.js'
export type { AntigravityActivityHistory, AntigravityActivityRecord } from './activity-contract.js'

/** Events the store persists: session readiness plus tool start/update rows. */
export type AntigravityActivityEvent = AntigravitySessionReadyEvent | AntigravityToolEvent | AntigravityFullAccessEvent

/** Minimal durable store independent of runtime and auth directories. */
export class AntigravityActivityStore extends ExternalAgentActivityStore<AntigravityActivityEvent, AntigravityActivityRecord> {
  /** Capture the history root; directories are created lazily on append.
   * @param rootDirectory - Explicit history root, e.g. home/plugin-data/antigravity/history.
   */
  constructor(rootDirectory: string) {
    super({ rootDirectory, schemaVersion: ACTIVITY_SCHEMA_VERSION, decodeRecord: decodeActivityRecord })
  }
}
