/** Normalize folded Antigravity tool rows for the shared read-only ACP tool card. */
import type { NativeToolCardProps, NativeToolDetail } from '@deepseek-ai/dsh-acp-provider/native-ui'
import type { AntigravityToolState } from '../tool-events.js'

const NATIVE_TOOL_NAMES: Record<string, string> = {
  'run command': 'bash', 'view file': 'read', 'read file': 'read', 'fetch page': 'web_fetch', fetch: 'web_fetch',
  search: 'web_search', grep: 'grep', glob: 'glob', 'write file': 'write', 'edit file': 'edit',
}
const ARG_KEY_ALIASES: Record<string, string> = {
  CommandLine: 'command', commandLine: 'command', command_line: 'command', AbsolutePath: 'file_path', URL: 'url', uri: 'url',
}
const PATH_KEYS = ['path', 'file_path', 'directory_path'] as const
const SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'glob', 'query', 'url', 'directory_path'] as const

function foldName(name: string): string {
  return name.trim().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').toLowerCase()
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch { return undefined }
}

export function nativeToolName(name: string, input?: string): string {
  const core = name.startsWith('Running ') ? name.slice('Running '.length) : name
  const folded = foldName(core)
  const known = NATIVE_TOOL_NAMES[folded]
  if (known !== undefined) return known
  if (folded === 'grep' || folded.startsWith('grep ')) return 'grep'
  if (folded === 'glob' || folded.startsWith('glob ')) return 'glob'
  const parsed = input === undefined ? undefined : parseRecord(input)
  if (parsed !== undefined && Object.entries(parsed).some(([key, value]) => (ARG_KEY_ALIASES[key] ?? key) === 'command' && typeof value === 'string')) return 'bash'
  return name
}

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
    if (location.kind === 'file' && !PATH_KEYS.some(key => typeof args[key] === 'string' && args[key] !== '')) args.path = location.target
    if (location.kind === 'url' && typeof args.url !== 'string') args.url = location.target
  }
  return JSON.stringify(args)
}

export function nativeToolSummary(state: AntigravityToolState, toolName: string): string {
  const args = parseRecord(nativeToolArgs(state))
  if (args !== undefined) {
    for (const key of SUMMARY_KEYS) {
      const value = args[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  if (state.location !== undefined) return state.location.target
  const core = state.name.startsWith('Running ') ? state.name.slice('Running '.length) : state.name
  if (toolName === 'read') return core.replace(/^Read\s+/u, '').replace(/^read\s+/u, '')
  if (toolName === 'grep' || toolName === 'glob') return core.replace(/^Find\s+/u, '').replace(/^find\s+/u, '').replace(/^[`']|['`]$/gu, '')
  return core
}

export type AntigravityNativeToolCardModel = Omit<NativeToolCardProps, 't'>

export function nativeToolCardModel(state: AntigravityToolState): AntigravityNativeToolCardModel {
  const toolName = nativeToolName(state.name, state.input)
  const input = nativeToolArgs(state)
  const settled = state.status === 'completed' || state.status === 'failed'
  const output = settled ? (state.status === 'failed' ? state.error ?? state.output ?? '' : state.output ?? state.error ?? '') : undefined
  const rowState = state.status === 'failed' ? 'error' : state.status === 'completed' ? 'ok' : 'running'
  return {
    callId: state.toolId, toolName, nativeName: state.name, summary: nativeToolSummary(state, toolName), state: rowState,
    ...(input === '' ? {} : { input }), ...(output === undefined ? {} : { output }),
    ...(rowState === 'error' ? {} : detailOf(toolName, input, output)),
  }
}

function detailOf(toolName: string, argsRaw: string, result: string | undefined): { readonly detail: NativeToolDetail } | Record<string, never> {
  const input = parseRecord(argsRaw) ?? {}
  const output = result === undefined ? undefined : parse(result)
  const jsonStart = toolName === 'read' ? /^\s*[\[{]/u : /^\s*(?:\{|\[\s*[\[{"])/u
  const unparsedJson = typeof output === 'string' && output === result && jsonStart.test(output)
  const text = unparsedJson ? undefined : outputText(output)
  if (toolName === 'read' && result === '') return { detail: { kind: 'empty' } }
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : undefined
  if (toolName === 'read' && path !== undefined && text !== undefined) {
    const offset = typeof input.offset === 'number' && Number.isSafeInteger(input.offset) && input.offset > 0 ? input.offset : 1
    const lines = (text === '' ? [] : text.replace(/\n$/u, '').split('\n')).map((line, index) => ({ number: offset + index, text: line }))
    const total = record(output).totalLines
    const totalLines = typeof total === 'number' && Number.isSafeInteger(total) && total >= offset + lines.length - 1 ? total : lines.length
    return { detail: { kind: 'read', label: path, lines, totalLines } }
  }
  if (toolName === 'edit' || toolName === 'write') {
    const diffs: { path: string; oldText: string | null; newText: string }[] = []
    if (Array.isArray(output)) {
      for (const item of output) {
        const diff = record(item)
        if (diff.type !== 'diff' || typeof diff.path !== 'string' || typeof diff.newText !== 'string' || !(diff.oldText === null || typeof diff.oldText === 'string')) { diffs.length = 0; break }
        const header = `++ b/${diff.path}`
        const created = diff.oldText === '-- /dev/null' && (diff.newText === header || diff.newText.startsWith(header + '\n'))
        diffs.push({ path: diff.path, oldText: created ? null : diff.oldText, newText: created ? diff.newText.slice(header.length + 1) : diff.newText })
      }
    }
    if (diffs.length === 0 && path !== undefined) {
      if (toolName === 'write' && typeof input.content === 'string') diffs.push({ path, oldText: null, newText: input.content })
      if (toolName === 'edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') diffs.push({ path, oldText: input.old_string, newText: input.new_string })
    }
    if (diffs.length > 0) return { detail: { kind: 'diff', diffs } }
  }
  const command = input.command ?? input.cmd
  const shell = record(output)
  const terminalOutput = text ?? (typeof shell.stdout === 'string' || typeof shell.stderr === 'string'
    ? [shell.stdout, shell.stderr].filter((part): part is string => typeof part === 'string').join('') : undefined)
  if (toolName === 'bash' && typeof command === 'string' && (result === undefined || terminalOutput !== undefined)) {
    const exitCode = shell.exitCode ?? shell.exit_code
    return { detail: { kind: 'terminal', command, ...(terminalOutput === undefined ? {} : { output: terminalOutput }),
      ...(typeof input.workdir === 'string' ? { cwd: input.workdir } : {}),
      ...(typeof exitCode === 'number' && Number.isInteger(exitCode) ? { exitCode } : {}) } }
  }
  return {}
}

function parse(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function outputText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const object = record(value)
  if (typeof object.content === 'string') return object.content
  if (object.type === 'text' && typeof object.text === 'string') return object.text
  if (object.type === 'content') return outputText(object.content)
  if (Array.isArray(value)) {
    const parts = value.map(outputText)
    if (parts.every(part => part !== undefined)) return parts.join('\n')
  }
  return undefined
}
