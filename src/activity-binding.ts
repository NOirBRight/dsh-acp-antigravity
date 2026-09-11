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

/** Exact-session log as `Session.snapshotEvents()` returns it. Structural: no Core import. */
export interface SessionLogEvent {
  readonly type: string
  readonly data?: unknown
}

/** Read one live session log; undefined when the session cannot be resolved. */
export type SessionLogReader = (sessionId: string) => readonly SessionLogEvent[] | undefined

/** Register the binding guard for the installer's lifetime.
 * @param ctx - Host context whose `llm/stream` waterfall the guard joins.
 * @param store - Sidecar reader answering binding per session id.
 * @param readSessionLog - Exact-session `snapshotEvents` reader; unavailable history blocks unbound native execution.
 * @returns Disposer removing the listener.
 */
export function installActivityBindingGuard(
  ctx: ActivityBindingHostContext,
  store: ActivityBindingStore,
  readSessionLog: SessionLogReader = () => undefined,
): () => void {
  return ctx.on('llm/stream', (options, next) => decideActivityBinding(store, readSessionLog, options, next))
}

function decideActivityBinding(
  store: ActivityBindingStore,
  readSessionLog: SessionLogReader,
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
    if (options.provider === ACTIVITY_NATIVE_PROVIDER && dshHistoryLocked(options.messages, readSessionLog, sessionId)) {
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

function dshHistoryLocked(
  messages: GenerateOptions['messages'],
  readSessionLog: SessionLogReader,
  sessionId: string,
): boolean {
  if (hasPriorModelTurn(messages)) return true
  let events: readonly SessionLogEvent[] | undefined
  try {
    events = readSessionLog(sessionId)
    if (events === undefined) throw new Error('Session history is unavailable')
  } catch {
    // Canonical session history is required to distinguish first native turns from prior DSH headers.
    throw new LlmError(
      'Antigravity activity data is unavailable; execution is blocked until it can be read.',
      ACTIVITY_BINDING_UNAVAILABLE,
    )
  }
  return hasForeignRequestHeader(events)
}

function hasPriorModelTurn(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** A prior non-native `request/header` means this session already ran on DSH. Current native headers do not. */
function hasForeignRequestHeader(events: readonly SessionLogEvent[] | undefined): boolean {
  if (events === undefined) return false
  for (const event of events) {
    if (event.type !== 'request/header') continue
    const data = record(event.data)
    const header = record(data?.header)
    const config = record(header?.config)
    if (typeof config?.provider === 'string' && config.provider !== ACTIVITY_NATIVE_PROVIDER) return true
  }
  return false
}
