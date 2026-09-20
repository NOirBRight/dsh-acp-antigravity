/** Append-only per-session history for Antigravity native tool activity. */
import { ExternalAgentActivityCursorAheadError, ExternalAgentActivityStore, type ExternalAgentActivityPage } from '@deepseek-ai/dsh-acp-provider/activity-store'
import {
  ACTIVITY_PAGE_RECORD_LIMIT,
  ACTIVITY_SCHEMA_VERSION,
  ActivityCursorStaleError,
  decodeActivityRecord,
  type AntigravityActivityHistory,
  type AntigravityActivityPage,
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
  /** Capture the history root; directories are created lazily on append. */
  constructor(rootDirectory: string) {
    super({ rootDirectory, schemaVersion: ACTIVITY_SCHEMA_VERSION, decodeRecord: decodeActivityRecord })
  }

  /** Read one bounded page strictly after an exclusive cursor, validating from that base sequence.
   * Delegates to the provider's `readAfter`, so only the returned records are decoded and the
   * already-seen prefix is never rescanned into memory. A cursor past an existing history and a
   * cursor whose history was deleted both surface as {@link ActivityCursorStaleError}, so a client
   * resynchronizes instead of treating an empty page as caught up; `afterSeq` 0 keeps returning an
   * ordinary empty page, because nothing was being followed yet.
   * @param sessionId - Required session id.
   * @param afterSeq - Exclusive cursor; 0 starts at the first record.
   * @returns Ordered records, the cursor to pass next, and whether more remain.
   * @throws ActivityCursorStaleError - When the history cannot satisfy the cursor.
   */
  readActivityPage(sessionId: string, afterSeq: number): AntigravityActivityPage {
    let page: ExternalAgentActivityPage<AntigravityActivityRecord>
    try {
      page = this.readAfter(sessionId, afterSeq, ACTIVITY_PAGE_RECORD_LIMIT)
    } catch (error) {
      const stale = cursorAhead(error)
      throw stale ?? error
    }
    if (afterSeq > 0 && page.historyMissing === true) {
      // The history file is gone, so this empty page would read as caught up and the
      // client would never resynchronize. The store boundary refuses the cursor
      // instead of widening the DSH page DTO with a provider-only field.
      throw new ActivityCursorStaleError(afterSeq, 0)
    }
    return { version: ACTIVITY_SCHEMA_VERSION, records: page.records, nextCursor: page.nextCursor, hasMore: page.hasMore }
  }
}

/** Normalize the provider's typed ahead-of-history failure into the shared stale-cursor error. */
function cursorAhead(error: unknown): ActivityCursorStaleError | undefined {
  if (!(error instanceof ExternalAgentActivityCursorAheadError)) return undefined
  return new ActivityCursorStaleError(error.afterSeq, error.historyLength)
}
