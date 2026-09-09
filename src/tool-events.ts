/** Replayable durable events for Antigravity native tool activity. */

import type { ExternalAgentEvent, ExternalAgentSessionRef, ExternalAgentOwnership } from '@deepseek-ai/dsh-acp-provider'
import { isRecord, stringValue } from './decode.js'
import type { NativeRequestTelemetry, NativeUsageSnapshots } from './request-telemetry.js'

/** Prompt-scoped raw model request timing and usage evidence. */
export const ANTIGRAVITY_REQUEST_TELEMETRY = 'antigravity/request-telemetry' as const
/** Raw pre-difference SDK usage evidence for one native prompt. */
export const ANTIGRAVITY_USAGE_SNAPSHOTS = 'antigravity/usage-snapshots' as const

const MAX_TOOL_TEXT = 4000

export const ANTIGRAVITY_SESSION_READY = 'antigravity/session-ready' as const
export const ANTIGRAVITY_TOOL_START = 'antigravity/tool-start' as const
export const ANTIGRAVITY_TOOL_UPDATE = 'antigravity/tool-update' as const

export type AntigravityToolStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AntigravityToolLocation {
  readonly target: string
  readonly kind: 'file' | 'url'
}

/** Authoritative native trajectory ownership for one tool row.
 *
 * Decoded from the ACP _meta bag (agy.trajectory) the patched native
 * server attaches to the tool call's own step emissions. Rows without it
 * (unpatched server, or emissions closing another call's row) group
 * exactly as before; ownership is never synthesized from names or timing.
 */
export type AntigravityToolOwnership = ExternalAgentOwnership

/** Validate one decoded _meta ownership bag.
 * @param value - The agy.trajectory bag, if present.
 * @returns True for a usable linkage: non-empty ids and a non-negative depth.
 */
export function isToolOwnership(value: unknown): value is AntigravityToolOwnership {
  if (!isRecord(value)) return false
  if (stringValue(value.trajectoryId) === undefined) return false
  const parent = value.parentTrajectoryId
  if (parent !== undefined && stringValue(parent) === undefined) return false
  const depth = value.depth
  return depth === undefined || (typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 0)
}

/** Decode one ACP update's ownership bag.
 * @param update - Raw session update, carrying _meta on the wire.
 * @returns The validated linkage, or undefined when absent or unusable.
 */
export function toolOwnershipOf(update: unknown): AntigravityToolOwnership | undefined {
  if (!isRecord(update) || !isRecord(update._meta)) return undefined
  const ownership = update._meta['agy.trajectory']
  return isToolOwnership(ownership) ? ownership : undefined
}

/** Native events with explicitly declared trajectory ownership. */
export type AntigravityOwnedEvent = Extract<ExternalAgentEvent, { readonly type: 'tool-activity' | 'thought-delta' | 'assistant-delta' }>

/** Attach validated ownership to one bounded ownable event.
 * @param event - Bounded event; other event types pass through untouched.
 * @param ownership - Validated linkage, if the native update carried one.
 * @returns The event with ownership when both apply, else the event unchanged.
 */
export function withToolOwnership(event: ExternalAgentEvent, ownership: AntigravityToolOwnership | undefined): ExternalAgentEvent {
  if (ownership === undefined || (event.type !== 'tool-activity' && event.type !== 'thought-delta' && event.type !== 'assistant-delta')) return event
  const owned: AntigravityOwnedEvent = { ...event, ownership }
  return owned
}

export interface AntigravityToolStartData {
  readonly toolId: string
  readonly name: string
  readonly status: AntigravityToolStatus
  readonly location?: AntigravityToolLocation
  readonly input?: string
  readonly ownership?: AntigravityToolOwnership
}

export interface AntigravityToolUpdateData {
  readonly toolId: string
  readonly name?: string
  readonly status: AntigravityToolStatus
  readonly location?: AntigravityToolLocation
  readonly input?: string
  readonly output?: string
  readonly error?: string
  readonly ownership?: AntigravityToolOwnership
}

export interface AntigravitySessionReadyData {
  readonly provider: 'antigravity'
  /** Absent only in legacy history, which remains readable but cannot be resumed. */
  readonly ref?: ExternalAgentSessionRef
}

export type AntigravitySessionReadyEvent = {
  readonly type: typeof ANTIGRAVITY_SESSION_READY
  readonly data: AntigravitySessionReadyData
}

export const ANTIGRAVITY_AGENT_OBSERVED = 'antigravity/agent-observed' as const
export const ANTIGRAVITY_AGENT_TEXT = 'antigravity/agent-text' as const
export const ANTIGRAVITY_USER_QUESTION_ANSWER = 'antigravity/user-question-answer' as const

/** Discovery descriptor for a native trajectory seen without a tool row.
 *
 * Emitted once per child trajectory from its first text/thought linkage so a
 * zero-tool subagent still gets a container. Data is the ownership fields
 * directly: no name (names come from launch args, never linked heuristically),
 * no text (no per-delta storage), no status (a text delta carries no lifecycle).
 * Never folded into tool rows; descriptors fold independently by trajectory.
 */
export type AntigravityAgentObservedEvent = {
  readonly type: typeof ANTIGRAVITY_AGENT_OBSERVED
  readonly data: AntigravityToolOwnership
}

/** Child-owned native text kept off the parent assistant stream. */
export interface AntigravityAgentTextData {
  readonly trajectoryId: string
  readonly parentTrajectoryId?: string
  readonly kind: 'text' | 'thought'
  readonly text: string
}

export type AntigravityAgentTextEvent = {
  readonly type: typeof ANTIGRAVITY_AGENT_TEXT
  readonly data: AntigravityAgentTextData
}

/** Exact host answer to one native user question, stored before ACP delivery. */
export interface AntigravityUserQuestionAnswerData {
  readonly requestId: string
  readonly question: string
  readonly selected: readonly string[]
  readonly custom?: string
}

export type AntigravityUserQuestionAnswerEvent = {
  readonly type: typeof ANTIGRAVITY_USER_QUESTION_ANSWER
  readonly data: AntigravityUserQuestionAnswerData
}

export type AntigravityToolEvent =
  | { readonly type: typeof ANTIGRAVITY_TOOL_START; readonly data: AntigravityToolStartData }
  | { readonly type: typeof ANTIGRAVITY_TOOL_UPDATE; readonly data: AntigravityToolUpdateData }
  | AntigravityAgentObservedEvent
  | AntigravityAgentTextEvent
  | AntigravityUserQuestionAnswerEvent
  | { readonly type: typeof ANTIGRAVITY_REQUEST_TELEMETRY; readonly data: NativeRequestTelemetry }
  | { readonly type: typeof ANTIGRAVITY_USAGE_SNAPSHOTS; readonly data: NativeUsageSnapshots }

export interface AntigravityToolActivity {
  readonly toolId: string
  readonly name: string
  /** The ACP update omitted its title; the display fallback is not a rename. */
  readonly nameMissing?: boolean
  readonly status: AntigravityToolStatus
  readonly input?: string
  readonly output?: string
  readonly error?: string
  readonly ownership?: AntigravityToolOwnership
}

export interface AntigravityToolState extends AntigravityToolStartData {
  readonly output?: string
  readonly error?: string
}

/**
 * Convert one ACP notification to display-safe events.
 * @param activity - Native tool notification from ACP.
 * @param seen - Tool ids whose start event was already appended for this DSH session.
 * @param workspaceRoot - Absolute DSH workspace used to resolve a relative native path.
 * @returns A start on first sight and an update for every subsequent notification.
 */
export function toDurableToolEvents(activity: AntigravityToolActivity, seen: ReadonlySet<string>, workspaceRoot?: string): readonly AntigravityToolEvent[] {
  if (activity.toolId.trim() === '') throw new Error('Antigravity tool activity has no id')
  const known = seen.has(activity.toolId)
  const input = activity.input === undefined ? undefined : truncate(activity.input)
  const output = outputText(activity.output)
  const location = locationOf(activity, workspaceRoot)
  const update: AntigravityToolEvent = {
    type: ANTIGRAVITY_TOOL_UPDATE,
    data: {
      toolId: activity.toolId,
      ...(known && activity.nameMissing !== true ? { name: activity.name } : {}),
      status: activity.status,
      ...(activity.ownership === undefined ? {} : { ownership: activity.ownership }),
      ...(known && location !== undefined ? { location } : {}),
      ...(known && input !== undefined ? { input } : {}),
      ...(output === undefined ? {} : { output }),
      ...(activity.error === undefined || activity.error.length === 0 ? {} : { error: truncate(activity.error) }),
    },
  }
  if (known) return [update]
  const start: AntigravityToolEvent = {
    type: ANTIGRAVITY_TOOL_START,
    data: {
      toolId: activity.toolId,
      name: activity.name,
      ...(activity.ownership === undefined ? {} : { ownership: activity.ownership }),
      ...(input === undefined ? {} : { input }),
      status: activity.status,
      ...(location === undefined ? {} : { location }),
    },
  }
  return output === undefined && update.data.error === undefined ? [start] : [start, update]
}

/** Emit a trajectory discovery descriptor on first sight of a child linkage.
 * @param ownership - Validated linkage from a text/thought/tool event, if any.
 * @param seen - Trajectory ids already disclosed for this native session.
 * @returns One agent-observed event for a newly seen child trajectory, else none.
 *
 * Discovery needs a parent link or a depth of at least one: the root needs no
 * descriptor, and an absent depth must not hide an authoritatively parent-linked
 * child. No text is stored; lifecycle comes from the trajectory's own rows.
 */
export function toDurableAgentEvents(ownership: AntigravityToolOwnership | undefined, seen: ReadonlySet<string>): readonly AntigravityToolEvent[] {
  if (ownership === undefined || seen.has(ownership.trajectoryId)) return []
  const child = ownership.parentTrajectoryId !== undefined || (ownership.depth !== undefined && ownership.depth >= 1)
  if (!child) return []
  return [{ type: ANTIGRAVITY_AGENT_OBSERVED, data: ownership }]
}

/**
 * Fold one tool event in ascending session-log order.
 * @param state - Current row state, if its start is already loaded.
 * @param event - Next event for this row; agent-observed descriptors fold independently.
 * @returns The new row state.
 */
export function foldAntigravityToolEvent(state: AntigravityToolState | undefined, event: AntigravityToolEvent): AntigravityToolState {
  if (event.type !== ANTIGRAVITY_TOOL_START && event.type !== ANTIGRAVITY_TOOL_UPDATE) throw new Error('Antigravity activity is not a tool row event')
  if (event.type === ANTIGRAVITY_TOOL_START) {
    if (state !== undefined) throw new Error('Antigravity tool start repeats toolId ' + state.toolId)
    return event.data
  }
  if (state === undefined) {
    return {
      toolId: event.data.toolId,
      name: event.data.name ?? 'native tool',
      status: event.data.status,
      ...(event.data.ownership === undefined ? {} : { ownership: event.data.ownership }),
      ...(event.data.location === undefined ? {} : { location: event.data.location }),
      ...(event.data.input === undefined ? {} : { input: event.data.input }),
      ...(event.data.output === undefined ? {} : { output: event.data.output }),
      ...(event.data.error === undefined ? {} : { error: event.data.error }),
    }
  }
  if (event.data.toolId !== state.toolId) throw new Error('Antigravity tool update carries foreign toolId ' + event.data.toolId)
  return {
    ...state,
    ...(event.data.name === undefined ? {} : { name: event.data.name }),
    status: event.data.status,
    ...(event.data.ownership === undefined ? {} : { ownership: event.data.ownership }),
    ...(event.data.location === undefined ? {} : { location: event.data.location }),
    ...(event.data.input === undefined ? {} : { input: event.data.input }),
    ...(event.data.output === undefined ? {} : { output: event.data.output }),
    ...(event.data.error === undefined ? {} : { error: event.data.error }),
  }
}

function locationOf(activity: AntigravityToolActivity, workspaceRoot?: string): AntigravityToolLocation | undefined {
  const input = recordOf(activity.input)
  const output = recordOf(activity.output)
  const target = stringAt(input, 'AbsolutePath')
    ?? stringAt(input, 'file_path')
    ?? stringAt(input, 'directory_path')
    ?? stringAt(input, 'path')
    ?? stringAt(input, 'url')
    ?? stringAt(input, 'URL')
    ?? stringAt(input, 'uri')
    ?? stringAt(output, 'workingDir')
    ?? stringAt(output, 'url')
    ?? stringAt(output, 'URL')
    ?? stringAt(output, 'uri')
  if (target === undefined) return undefined
  if (/^https?:\/\//u.test(target)) return { target, kind: 'url' }
  if (target.startsWith('/')) return { target, kind: 'file' }
  if (workspaceRoot === undefined || !workspaceRoot.startsWith('/')) return undefined
  return { target: workspaceRoot.replace(/\/$/u, '') + '/' + target.replace(/^\.\//u, ''), kind: 'file' }
}

function outputText(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  const output = recordOf(raw)
  const normalized = stringAt(output, 'combinedOutput') ?? stringAt(output, 'formatted_output') ?? stringAt(output, 'output')
  if (normalized !== undefined) return truncate(normalized)
  return truncate(raw)
}

function recordOf(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return stringValue(value?.[key])
}

function truncate(text: string): string {
  return text.slice(0, MAX_TOOL_TEXT)
}
