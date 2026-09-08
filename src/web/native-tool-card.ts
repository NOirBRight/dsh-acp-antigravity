/** Adapt folded native sidecar rows to canonical DSH tool-card props.
 *
 * Pure browser-safe mapping from the activity/read sidecar to presentation-only
 * GenericToolCard input. The produced block is typed presentation, never a
 * durable executable DSH tool event: no call is dispatched, no file is opened,
 * and no trajectory target exists (the node omits openFile/inspect, so paths
 * render as plain text and no Inspect pill appears).
 */
import type { GenericToolCardProps } from '@deepseek-ai/dsh-client-ui-tool/client'
type ToolCallBlock = GenericToolCardProps['block']
import type { AntigravityToolState } from '../tool-events.js'

/** Known native tool name (after separator folding) to canonical wire name. */
const NATIVE_TOOL_NAMES: Record<string, string> = {
  'run command': 'bash',
  'view file': 'read',
  'read file': 'read',
  'fetch page': 'web_fetch',
  fetch: 'web_fetch',
  search: 'web_search',
  grep: 'grep',
  glob: 'glob',
  'write file': 'write',
  'edit file': 'edit',
}

/** Native argument aliases to canonical DSH argument keys, each verified
 * against the card models that read them: command feeds the terminal shell
 * call, file_path is what the read model requires (path alone never
 * qualifies), url feeds web_fetch and renders as summary text without result
 * metadata. Unknown keys survive verbatim. */
const ARG_KEY_ALIASES: Record<string, string> = {
  CommandLine: 'command',
  commandLine: 'command',
  command_line: 'command',
  AbsolutePath: 'file_path',
  URL: 'url',
  uri: 'url',
}

/** Path-ish keys a location fallback must not override. */
const PATH_KEYS = ['path', 'file_path', 'directory_path'] as const

function foldName(name: string): string {
  return name.trim().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').toLowerCase()
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Map a recorded native tool name to its canonical DSH wire name. Declared
 * name table only: an unknown name stays verbatim no matter how suggestive
 * its arguments look, so a row never claims an unrelated tool.
 * @param name - name recorded on the sidecar start event.
 * @returns the canonical wire name, or the recorded name verbatim when unknown.
 */
export function nativeToolName(name: string): string {
  const core = name.startsWith('Running ') ? name.slice('Running '.length) : name
  const folded = foldName(core)
  const known = NATIVE_TOOL_NAMES[folded]
  if (known !== undefined) return known
  if (folded === 'grep' || folded.startsWith('grep ')) return 'grep'
  if (folded === 'glob' || folded.startsWith('glob ')) return 'glob'
  return name
}

/**
 * Build the canonical args JSON for one folded row. Known native keys move to
 * their canonical slots; every other key survives verbatim, so unknowns keep
 * their data. A sidecar location fills a missing path/url on a structured
 * args object only: raw non-JSON input passes through untouched (the generic
 * summary and body read it verbatim), and then a location has no canonical
 * slot — the output text still carries the readable result.
 * @param state - folded native row state.
 * @returns argsRaw for the presentation block: canonical JSON or raw input.
 */
export function nativeToolArgs(state: AntigravityToolState): string {
  if (state.input === undefined) {
    if (state.location === undefined) return ''
    return JSON.stringify(state.location.kind === 'file' ? { path: state.location.target } : { url: state.location.target })
  }
  const parsed = parseRecord(state.input)
  if (parsed === undefined) return state.input
  const args: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    const canonical = ARG_KEY_ALIASES[key] ?? key
    if (args[canonical] === undefined) args[canonical] = value
  }
  const location = state.location
  if (location !== undefined) {
    if (location.kind === 'file' && !PATH_KEYS.some(key => typeof args[key] === 'string' && args[key] !== '')) {
      args.path = location.target
    }
    if (location.kind === 'url' && typeof args.url !== 'string') args.url = location.target
  }
  return JSON.stringify(args)
}

/**
 * Build presentation props for one folded row: the normalized wire name plus a
 * running block while pending/running, or a settled block honoring the actual
 * outcome (failed settles isError, completed does not). The verbatim native
 * name rides along for accessibility wherever the canonical label renames it;
 * the row itself renders the exact native card with no second title slot.
 * No result metadata is ever synthesized, so rich cards trigger only off
 * genuine canonical arguments.
 * @param state - folded native row state.
 * @param timeMs - row wall clock for the block timestamps; defaults to 0.
 * @returns wire name, verbatim native name and tool id, and the presentation-only block.
 */
export function nativeToolBlock(state: AntigravityToolState, timeMs = 0): {
  readonly toolName: string
  readonly nativeName: string
  readonly callId: string
  readonly block: ToolCallBlock
} {
  const toolName = nativeToolName(state.name)
  const argsRaw = nativeToolArgs(state)
  const callId = state.toolId
  if (state.status !== 'completed' && state.status !== 'failed') {
    return {
      toolName,
      nativeName: state.name,
      callId,
      block: { callId, name: toolName, argsRaw, turn: 0, step: 0, time: timeMs, subCalls: [] },
    }
  }
  const text = state.status === 'failed'
    ? (state.error ?? state.output ?? '')
    : (state.output ?? state.error ?? '')
  return {
    toolName,
    nativeName: state.name,
    callId,
    block: {
      kind: 'tool-result',
      seq: 0,
      time: timeMs,
      callId,
      call: { name: toolName, argsRaw },
      callTime: null,
      content: text === '' ? [] : [{ type: 'text' as const, text }],
      isError: state.status === 'failed',
      subCalls: [],
    },
  }
}
