/** Reject bound-session provider changes and unreadable bindings at model execution.
 * History reads, maintenance requests, and unbound sessions remain independent.
 */
import { LlmError, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ANTIGRAVITY_SESSION_READY } from './tool-events.js'
import type { AntigravityActivityStore } from './activity-store.js'

/** Provider route the native adapter registers. */
export const ACTIVITY_NATIVE_PROVIDER = 'antigravity'

/** Machine code for a bound session routed to another provider. Outside the default retryable set, so the failure stays terminal. */
export const ACTIVITY_BINDING_REJECTED = 'ACTIVITY_BINDING_REJECTED'

/** Machine code for an unreadable sidecar. Fail closed for execution, never for history. */
export const ACTIVITY_BINDING_UNAVAILABLE = 'ACTIVITY_BINDING_UNAVAILABLE'

/** Host context face: only the public listener registration the guard needs. */
export interface ActivityBindingHostContext {
  on(
    event: 'llm/stream',
    listener: (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>,
  ): () => void
}

/** Read-only access to plugin-owned activity. */
export type ActivityBindingStore = Pick<AntigravityActivityStore, 'read'>

/** Register the binding guard for the installer's lifetime.
 * @param ctx - Host context whose `llm/stream` waterfall the guard joins.
 * @param store - Sidecar reader answering binding per session id.
 * @returns Disposer removing the listener.
 */
export function installActivityBindingGuard(ctx: ActivityBindingHostContext, store: ActivityBindingStore): () => void {
  return ctx.on('llm/stream', (options, next) => decideActivityBinding(store, options, next))
}

function decideActivityBinding(
  store: ActivityBindingStore,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  if (!isAgentLoopRequest(options)) return next()
  if (options.purpose !== undefined) return next()
  const sessionId = options.sessionId
  if (sessionId === undefined) return next()
  let bound: boolean
  try {
    // Same rule as the activity/binding RPC: a ready record binds the session.
    bound = store.read(sessionId).records.some(record => record.type === ANTIGRAVITY_SESSION_READY)
  } catch {
    throw new LlmError(
      'Antigravity activity data is unavailable; execution is blocked until it can be read.',
      ACTIVITY_BINDING_UNAVAILABLE,
    )
  }
  if (!bound) return next()
  if (options.provider === ACTIVITY_NATIVE_PROVIDER) return next()
  throw new LlmError(
    'Antigravity-bound session is routed to provider "' + options.provider + '"; execution is blocked.',
    ACTIVITY_BINDING_REJECTED,
  )
}
