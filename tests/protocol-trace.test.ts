import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { spawnAntigravityAcp, type AcpWireObserver } from '../src/protocol.js'

// Minimal loopback agent: answers the three methods the trace drives and emits
// one text chunk, one token-shaped usage update, then a token-shaped result.
const FAKE_AGENT = [
  "let buf = '';",
  "process.stdin.on('data', function (c) {",
  '  buf += c.toString();',
  '  let next = buf.indexOf(String.fromCharCode(10));',
  '  while (next >= 0) {',
  '    const line = buf.slice(0, next);',
  '    buf = buf.slice(next + 1);',
  '    next = buf.indexOf(String.fromCharCode(10));',
  '    if (line.trim().length === 0) continue;',
  '    handle(JSON.parse(line));',
  '  }',
  '});',
  'function send(value) { process.stdout.write(JSON.stringify(value) + String.fromCharCode(10)); }',
  'function handle(req) {',
  "  if (req.method === 'initialize') {",
  "    send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: 1 } });",
  "  } else if (req.method === 'session/new') {",
  "    send({ jsonrpc: '2.0', id: req.id, result: { sessionId: 'lab-session-1' } });",
  "  } else if (req.method === 'session/prompt') {",
  "    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'lab-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lab hi' } } } });",
  "    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'lab-session-1', update: { sessionUpdate: 'usage_update', size: 9, used: 3, inputTokens: 12, outputTokens: 3, totalTokens: 15 } } });",
  "    send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } } });",
  '  }',
  '}',
].join(String.fromCharCode(10));

interface LabTrace {
  readonly raw: string[]
  readonly updates: unknown[]
  readonly results: unknown[]
  readonly errors: unknown[]
}

function track(): { observer: AcpWireObserver; trace: LabTrace } {
  const trace: LabTrace = { raw: [], updates: [], results: [], errors: [] }
  return {
    trace,
    observer: {
      onRawLine: line => { trace.raw.push(line) },
      onSessionUpdate: params => { trace.updates.push(params) },
      onPromptResult: result => { trace.results.push(result) },
      onPromptError: error => { trace.errors.push(error) },
    },
  }
}

function throwingObserver(): AcpWireObserver {
  const boom = (): void => { throw new Error('lab observer boom') }
  return { onRawLine: boom, onSessionUpdate: boom, onPromptResult: boom, onPromptError: boom }
}

async function driveLabTurn(observer: AcpWireObserver | undefined): Promise<{ result: unknown; notified: unknown[] }> {
  const connection = spawnAntigravityAcp(
    { command: process.execPath, args: ['-e', FAKE_AGENT], cwd: tmpdir(), env: process.env, shell: false, extendEnv: false },
    { cancelGraceMs: 250, ...(observer === undefined ? {} : { observer }) },
  )
  const notified: unknown[] = []
  connection.setNotificationHandler((method, params) => {
    if (method === 'session/update') notified.push(params)
  })
  try {
    await connection.request('initialize', { protocolVersion: 1 })
    const opened = await connection.request('session/new', { cwd: tmpdir(), mcpServers: [] }) as { sessionId: string }
    const result = await connection.request('session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'lab' }] })
    return { result, notified }
  } finally {
    await connection.close()
  }
}

function frames(trace: LabTrace): unknown[] {
  return trace.raw.map(line => JSON.parse(line) as unknown)
}

describe('ACP wire observer for lab usage capture', () => {
  it('observes raw frames, decoded updates, and the prompt result without disturbing traffic', async () => {
    const seen = track()
    const turn = await driveLabTurn(seen.observer)
    expect(turn.result).toMatchObject({ stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } })
    expect(turn.notified).toHaveLength(2)
    expect(seen.trace.errors).toEqual([])
    expect(seen.trace.results).toEqual([turn.result])
    expect(seen.trace.updates).toHaveLength(2)
    for (const line of seen.trace.raw) expect(() => JSON.parse(line)).not.toThrow()
    const rawText = seen.trace.raw.join(String.fromCharCode(10))
    expect(rawText).toContain('agent_message_chunk')
    expect(rawText).toContain('inputTokens')
    const decodedText = JSON.stringify(seen.trace.updates)
    expect(decodedText).toContain('agent_message_chunk')
    expect(decodedText).toContain('lab hi')
  })

  it('keeps token-shaped update fields visible pre-deserialization for before/after comparison', async () => {
    const seen = track()
    await driveLabTurn(seen.observer)
    const rawUsage = frames(seen.trace).filter(frame => typeof frame === 'object' && frame !== null && 'method' in frame)
    expect(rawUsage.length).toBeGreaterThan(0)
    const rawText = seen.trace.raw.join(String.fromCharCode(10))
    expect(rawText).toContain('usage_update')
    const decodedUsage = seen.trace.updates.map(update => JSON.stringify(update)).find(text => text.includes('usage_update'))
    expect(decodedUsage).toBeDefined()
    expect((decodedUsage as string).includes('inputTokens')).toBe(false)
  })

  it('survives a throwing observer with traffic intact', async () => {
    const turn = await driveLabTurn(throwingObserver())
    expect(turn.result).toMatchObject({ stopReason: 'end_turn' })
    expect(turn.notified).toHaveLength(2)
  })
})
