/** Focused contract for the native sidecar to canonical card adapter.
 *
 * Pure mapping only: no React, no DSH card import. Proves known native names
 * and keys normalize to canonical wire semantics, unknowns keep name and data
 * verbatim, raw input passes through without invention, and settled blocks
 * honor actual exits/errors while staying presentation-only (no subcalls,
 * no callTime, no meta cards).
 */
import { describe, expect, it } from 'vitest'
import { normalizeAntigravitySessionUpdate } from '../src/mapping.js'
import { ANTIGRAVITY_FULL_ACCESS_AUTHORIZED, decodeActivityRecord } from '../src/activity-contract.js'
import { ANTIGRAVITY_SESSION_READY } from '../src/tool-events.js'
import { foldAntigravityToolEvent, toDurableToolEvents, type AntigravityToolState } from '../src/tool-events.js'
import { nativeToolArgs, nativeToolBlock, nativeToolName } from '../src/web/native-tool-card.js'

function state(over: Partial<AntigravityToolState> & { readonly name: string }): AntigravityToolState {
  return { toolId: 't-1', status: 'running', ...over }
}

describe('nativeToolName', () => {
  it('replaces a permission preview title with the native command identity and retains it on title-less completion', () => {
    const seen = new Set<string>()
    let folded: AntigravityToolState | undefined
    let seq = 0
    for (const update of [
      { sessionUpdate: 'tool_call', toolCallId: 'cmd', title: 'printf ROOT', status: 'pending', rawInput: { CommandLine: 'printf ROOT' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'cmd', title: 'printf ROOT', _meta: { 'agy.toolName': 'run_command' }, status: 'in_progress', rawInput: { command_line: 'printf ROOT', working_dir: '/tmp' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'cmd', status: 'completed', rawOutput: 'ROOT' },
    ]) {
      const event = normalizeAntigravitySessionUpdate(update, { maxTextBytes: 1024, maxPayloadBytes: 4096 })
      if (event?.type !== 'tool-activity') throw new Error('Expected native tool activity')
      for (const durable of toDurableToolEvents(event, seen)) {
        const record = decodeActivityRecord(JSON.stringify({ v: 1, seq: ++seq, time: '2026-09-07T00:00:00Z', ...durable }), seq)
        if (record.type === ANTIGRAVITY_SESSION_READY || record.type === ANTIGRAVITY_FULL_ACCESS_AUTHORIZED) throw new Error('Unexpected non-tool marker')
        folded = foldAntigravityToolEvent(folded, record)
      }
      seen.add(event.toolId)
    }
    expect(nativeToolBlock(folded!).toolName).toBe('bash')
    expect(JSON.parse(nativeToolArgs(folded!))).toMatchObject({ command: 'printf ROOT' })
    expect(folded?.output).toBe('ROOT')
    expect(() => decodeActivityRecord(JSON.stringify({ v: 1, seq: 1, time: '2026-09-07T00:00:00Z', type: 'antigravity/tool-update', data: { toolId: 'cmd', name: 7, status: 'completed' } }), 1)).toThrow()
  })
  it('keeps command identity through the real durable fold for canonical bash icons', () => {
    const events = toDurableToolEvents({ toolId: 'cmd', name: 'Running run_command', status: 'completed', input: JSON.stringify({ CommandLine: 'printf ROOT' }) }, new Set())
    const folded = events.reduce(foldAntigravityToolEvent, undefined)!
    expect(nativeToolBlock(folded).toolName).toBe('bash')
    expect(JSON.parse(nativeToolArgs(folded))).toEqual({ command: 'printf ROOT' })
  })
  it('normalizes known native verbs to canonical wire names', () => {
    expect(nativeToolName('Running run command')).toBe('bash')
    expect(nativeToolName('Running view file')).toBe('read')
    expect(nativeToolName('read file')).toBe('read')
    expect(nativeToolName('Running fetch page')).toBe('web_fetch')
    expect(nativeToolName('grep')).toBe('grep')
    expect(nativeToolName('Running grep files')).toBe('grep')
    expect(nativeToolName('glob')).toBe('glob')
    expect(nativeToolName('Running write file')).toBe('write')
    expect(nativeToolName('Running edit file')).toBe('edit')
  })

  it('keeps unknown names verbatim, including spawn launches and raw commands', () => {
    expect(nativeToolName('Running start subagent')).toBe('Running start subagent')
    expect(nativeToolName('ls la')).toBe('ls la')
    expect(nativeToolName('git status -s')).toBe('git status -s')
  })

  it('leaves unknown names verbatim no matter how suggestive the keys look', () => {
    expect(nativeToolName('custom')).toBe('custom')
    expect(nativeToolName('Running custom fetch')).toBe('Running custom fetch')
  })
})

describe('nativeToolArgs', () => {
  it('moves known keys to canonical slots and preserves the rest verbatim', () => {
    const args = nativeToolArgs(state({
      name: 'Running run command',
      input: '{"CommandLine":"ls -la","description":"List","timeoutMs":30}',
    }))
    expect(JSON.parse(args)).toEqual({ command: 'ls -la', description: 'List', timeoutMs: 30 })
    const path = nativeToolArgs(state({
      name: 'Running view file',
      input: '{"AbsolutePath":"/tmp/a.txt","offset":2}',
    }))
    expect(JSON.parse(path)).toEqual({ file_path: '/tmp/a.txt', offset: 2 })
  })

  it('passes raw non-JSON input through without inventing args', () => {
    expect(nativeToolArgs(state({ name: 'git status -s', input: 'git status -s' }))).toBe('git status -s')
  })

  it('fills a missing path/url from the sidecar location on structured args only', () => {
    expect(nativeToolArgs(state({
      name: 'Running view file',
      status: 'running',
      location: { target: '/home/noirbright', kind: 'file' },
    }))).toBe('{"path":"/home/noirbright"}')
    expect(nativeToolArgs(state({
      name: 'Running fetch page',
      status: 'running',
      location: { target: 'https://example.com/x', kind: 'url' },
    }))).toBe('{"url":"https://example.com/x"}')
    expect(nativeToolArgs(state({ name: 'Running view file', status: 'running' }))).toBe('')
  })

  it('never overrides an input-carried path with the location', () => {
    const args = nativeToolArgs(state({
      name: 'Running view file',
      input: '{"file_path":"/tmp/a.txt"}',
      location: { target: '/elsewhere', kind: 'file' },
    }))
    expect(JSON.parse(args)).toEqual({ file_path: '/tmp/a.txt' })
  })
})

describe('nativeToolBlock', () => {
  it('builds a running block while pending or running', () => {
    for (const status of ['pending', 'running'] as const) {
      const { toolName, nativeName, callId, block } = nativeToolBlock(state({ name: 'Running run command', status, toolId: 'a\nb' }))
      expect(toolName).toBe('bash')
      expect(nativeName).toBe('Running run command')
      expect(callId).toBe('a\nb')
      expect('kind' in block).toBe(false)
    }
  })

  it('keeps the verbatim native name accessible on unknown rows', () => {
    const { toolName, nativeName } = nativeToolBlock(state({ name: 'Running start subagent', status: 'completed', output: 'ok' }))
    expect(toolName).toBe('Running start subagent')
    expect(nativeName).toBe('Running start subagent')
  })

  it('settles completed rows without error and keeps the output text', () => {
    const { toolName, block } = nativeToolBlock(state({
      name: 'Running run command',
      status: 'completed',
      input: '{"CommandLine":"ls","description":"List"}',
      output: 'a.ts',
    }), 1_000)
    expect(toolName).toBe('bash')
    expect(block).toMatchObject({
      kind: 'tool-result',
      callId: 't-1',
      call: { name: 'bash', argsRaw: '{"command":"ls","description":"List"}' },
      callTime: null,
      content: [{ type: 'text', text: 'a.ts' }],
      isError: false,
      subCalls: [],
    })
  })

  it('settles failed rows as errors preferring the error text', () => {
    const { block } = nativeToolBlock(state({
      name: 'read file',
      status: 'failed',
      output: 'partial',
      error: 'boom',
    }))
    expect(block).toMatchObject({
      kind: 'tool-result',
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    })
  })

  it('renders an empty result as content-free rather than inventing text', () => {
    const { block } = nativeToolBlock(state({ name: 'x', status: 'completed' }))
    expect(block).toMatchObject({ kind: 'tool-result', content: [], isError: false })
  })
})
