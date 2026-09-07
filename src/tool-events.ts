/** Replayable durable events for Antigravity native tool activity. */

import { isRecord, stringValue } from './decode.js'

const MAX_TOOL_TEXT = 4000

export const ANTIGRAVITY_SESSION_READY = 'antigravity/session-ready' as const
export const ANTIGRAVITY_TOOL_START = 'antigravity/tool-start' as const
export const ANTIGRAVITY_TOOL_UPDATE = 'antigravity/tool-update' as const

export type AntigravityToolStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AntigravityToolLocation {
  readonly target: string
  readonly kind: 'file' | 'url'
}

export interface AntigravityToolStartData {
  readonly toolId: string
  readonly name: string
  readonly status: AntigravityToolStatus
  readonly location?: AntigravityToolLocation
  readonly input?: string
}

export interface AntigravityToolUpdateData {
  readonly toolId: string
  readonly status: AntigravityToolStatus
  readonly location?: AntigravityToolLocation
  readonly input?: string
  readonly output?: string
  readonly error?: string
}

export interface AntigravitySessionReadyData {
  readonly provider: 'antigravity'
}

export type AntigravitySessionReadyEvent = {
  readonly type: typeof ANTIGRAVITY_SESSION_READY
  readonly data: AntigravitySessionReadyData
}

export type AntigravityToolEvent =
  | { readonly type: typeof ANTIGRAVITY_TOOL_START; readonly data: AntigravityToolStartData }
  | { readonly type: typeof ANTIGRAVITY_TOOL_UPDATE; readonly data: AntigravityToolUpdateData }

export interface AntigravityToolActivity {
  readonly toolId: string
  readonly name: string
  readonly status: AntigravityToolStatus
  readonly input?: string
  readonly output?: string
  readonly error?: string
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
      status: activity.status,
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
      name: toolName(activity),
      ...(input === undefined ? {} : { input }),
      status: activity.status,
      ...(location === undefined ? {} : { location }),
    },
  }
  return output === undefined && update.data.error === undefined ? [start] : [start, update]
}

/**
 * Fold one event in ascending session-log order.
 * @param state - Current row state, if its start is already loaded.
 * @param event - Next event for this row.
 * @returns The new row state.
 */
export function foldAntigravityToolEvent(state: AntigravityToolState | undefined, event: AntigravityToolEvent): AntigravityToolState {
  if (event.type === ANTIGRAVITY_TOOL_START) {
    if (state !== undefined) throw new Error('Antigravity tool start repeats toolId ' + state.toolId)
    return event.data
  }
  if (state === undefined) {
    return {
      toolId: event.data.toolId,
      name: 'native tool',
      status: event.data.status,
      ...(event.data.location === undefined ? {} : { location: event.data.location }),
      ...(event.data.input === undefined ? {} : { input: event.data.input }),
      ...(event.data.output === undefined ? {} : { output: event.data.output }),
      ...(event.data.error === undefined ? {} : { error: event.data.error }),
    }
  }
  if (event.data.toolId !== state.toolId) throw new Error('Antigravity tool update carries foreign toolId ' + event.data.toolId)
  return {
    ...state,
    status: event.data.status,
    ...(event.data.location === undefined ? {} : { location: event.data.location }),
    ...(event.data.input === undefined ? {} : { input: event.data.input }),
    ...(event.data.output === undefined ? {} : { output: event.data.output }),
    ...(event.data.error === undefined ? {} : { error: event.data.error }),
  }
}

function toolName(activity: AntigravityToolActivity): string {
  const input = recordOf(activity.input)
  return stringAt(input, 'CommandLine') ?? stringAt(input, 'commandLine') ?? activity.name.replace(/[_-]/gu, ' ')
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
