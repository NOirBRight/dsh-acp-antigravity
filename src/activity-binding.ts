/** Reject bound-session provider changes, unreadable bindings, and External Agent
 * conversion of existing DSH history at model execution.
 * History reads, maintenance requests, and blank unbound sessions remain independent.
 */
import { LlmError, isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { nativeSessionBinding } from './activity-contract.js'
import type { AntigravityActivityStore } from './activity-store.js'

/** Provider route the native adapter registers. */
export const ACTIVITY_NATIVE_PROVIDER = 'antigravity'

/** Machine code for a bound session routed to another provider. Outside the default retryable set, so the failure stays terminal. */
export const ACTIVITY_BINDING_REJECTED = 'ACTIVITY_BINDING_REJECTED'

/** Machine code for converting an existing DSH conversation onto Antigravity. Terminal. */
export const ACTIVITY_HISTORY_LOCKED = 'ACTIVITY_HISTORY_LOCKED'

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
    bound = nativeSessionBinding(store.read(sessionId), sessionId) !== undefined
  } catch {
    throw new LlmError(
      'Antigravity activity data is unavailable; execution is blocked until it can be read.',
      ACTIVITY_BINDING_UNAVAILABLE,
    )
  }
  if (!bound) {
    if (options.provider === ACTIVITY_NATIVE_PROVIDER && hasPriorModelTurn(options.messages)) {
      throw new LlmError(
        'This conversation already has DSH history; start a new session to use Antigravity.',
        ACTIVITY_HISTORY_LOCKED,
      )
    }
    return next()
  }
  if (options.provider === ACTIVITY_NATIVE_PROVIDER) return next()
  throw new LlmError(
    'Antigravity-bound session is routed to provider "' + options.provider + '"; execution is blocked.',
    ACTIVITY_BINDING_REJECTED,
  )
}

function hasPriorModelTurn(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant')
}
