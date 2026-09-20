import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExternalAgentProviderRegistry, modelId, providerId, sessionId, toolId, type ExternalAgentProvider, type ExternalAgentSession } from '@deepseek-ai/dsh-acp-provider'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createAntigravityActivityWriter } from '../src/dsh-plugin.js'
import { createAntigravityLlmBridge, type BridgeHost } from '../src/llm-bridge.js'
import { ACTIVITY_COALESCE_WINDOW_MS } from '../src/activity-coalescer.js'
import { decodeActivityRecord, type AntigravityActivityRecord } from '../src/activity-contract.js'
import type { AntigravityActivityEvent } from '../src/activity-store.js'
import { foldActivityRecords, foldAgentTextRecords } from '../src/web/native-activity.js'
import { ANTIGRAVITY_AGENT_OBSERVED, ANTIGRAVITY_SESSION_READY, ANTIGRAVITY_AGENT_TEXT, ANTIGRAVITY_TOOL_START, ANTIGRAVITY_TOOL_UPDATE } from '../src/tool-events.js'

const VALID_MODES = ['approval-required', 'auto-accept-edits', 'full-access'] as const
const NATIVE_MODEL = 'composer-2.5'
const SESSION = 'session-coalesced'

/** One event the fake native turn publishes, or a gate it waits on. */
type Step =
  | { readonly publish: AntigravityActivityEvent }
  | { readonly wait: Promise<void> }
  | { readonly plan: string }

type ActivityWriter = ReturnType<typeof createAntigravityActivityWriter>

interface Harness {
  readonly adapter: ReturnType<typeof createAntigravityLlmBridge>
  readonly stream: () => AsyncGenerator<StreamChunk>
  readonly drain: () => Promise<StreamChunk[]>
  /** Abort the fake native turn; the bridge wires this through the adapter. */
  readonly abort: () => void
}

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'antigravity-coalesce-'))
}

/** Read the durable JSONL for one session exactly as the store wrote it. */
function recordsOf(root: string, id = SESSION): AntigravityActivityRecord[] {
  const file = join(root, createHash('sha256').update(id, 'utf8').digest('hex') + '.jsonl')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = text.split(String.fromCharCode(10))
  if (lines.pop() !== '') throw new Error('incomplete trailing record')
  return lines.map((line, index) => decodeActivityRecord(line, index + 1))
}

/** The host wiring the plugin mounts, over one real temporary history root. */
function activityHost(writer: ActivityWriter): BridgeHost {
  return {
    appendSessionReady: (sessionIdValue, ref) => { writer.append(sessionIdValue, [{ type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity', ref } }]) },
    loadSession: () => undefined,
    appendToolEvents: (sessionIdValue, events) => { writer.append(sessionIdValue, events) },
    flushActivity: sessionIdValue => { writer.flush(sessionIdValue) },
    flushActivityAll: () => { writer.flushAll() },
    releaseActivity: sessionIdValue => { writer.release(sessionIdValue) },
  }
}

/**
 * Drive the real bridge over a fake ACP provider. `steps` are published by the
 * fake native turn in order; `host` is the durable seam under test.
 * `onNativeDispose` counts native session disposals, which is how the runner's
 * reset/dispose becomes observable.
 */
function harness(steps: readonly Step[], host: BridgeHost, onNativeDispose?: () => void): Harness {
  const abort = new AbortController()
  const provider: ExternalAgentProvider = {
    info: { id: providerId('antigravity'), name: 'Cursor' },
    listModels: async () => [{ id: modelId(NATIVE_MODEL), name: 'Composer 2.5', supportedModes: [...VALID_MODES] }],
    openSession: async (): Promise<ExternalAgentSession> => ({
      ref: { provider: providerId('antigravity'), session: sessionId(SESSION), nativeSession: sessionId('native-1') },
      supportedModes: [...VALID_MODES],
      dispose: async () => { onNativeDispose?.() },
      runTurn: async (_request, turnHost) => {
        for (const step of steps) {
          if ('plan' in step) { await turnHost.publish({ type: 'plan-update', summary: step.plan, steps: [] }); continue }
          if (!('publish' in step)) { await Promise.race([step.wait, aborted(abort.signal)]); continue }
          if (abort.signal.aborted) break
          await turnHost.publish(toWireEvent(step.publish))
        }
        return { status: abort.signal.aborted ? 'cancelled' : 'completed', text: '' }
      },
    }),
  }
  const registry = new ExternalAgentProviderRegistry()
  const unregister = registry.register(provider)
  const adapter = createAntigravityLlmBridge({ registry, getProvider: () => provider }, undefined, undefined, host)
  const stream = (): AsyncGenerator<StreamChunk> => adapter.stream({ provider: 'antigravity', model: NATIVE_MODEL, messages: [{ source: { kind: 'user' }, content: 'do it' }], sessionId: SESSION }) as AsyncGenerator<StreamChunk>
  const drain = async (): Promise<StreamChunk[]> => {
    const chunks: StreamChunk[] = []
    for await (const chunk of stream()) chunks.push(chunk)
    return chunks
  }
  cleanups.push(async () => { abort.abort(); await adapter.dispose(); await unregister() })
  return { adapter, stream, drain, abort: () => abort.abort() }
}

/** Host with no coalescing: every durable event is written on arrival. */
function passThroughHost(root: string): BridgeHost {
  const store = createAntigravityActivityWriter(root)
  const immediate = (id: string | undefined, events: readonly AntigravityActivityEvent[]): void => {
    for (const event of events) {
      store.append(id, [event])
      store.flush(id ?? '')
    }
  }
  return {
    appendSessionReady: (id, ref) => { store.append(id, [{ type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity', ref } }]) },
    loadSession: () => undefined,
    appendToolEvents: (id, events) => { immediate(id, events) },
    flushActivity: () => undefined,
  }
}

/** Resolve once the signal aborts, so an open gate cannot hang the fake turn. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/** Poll a predicate with a deadline, so a missing write fails an assertion instead of the test timeout. */
async function waitFor(predicate: () => boolean, deadlineMs = 1000): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1))
}

/** Map one durable event to the ACP publication that produces it. */
function toWireEvent(event: AntigravityActivityEvent): Parameters<Parameters<ExternalAgentSession['runTurn']>[1]['publish']>[0] {
  if (event.type === ANTIGRAVITY_AGENT_TEXT) {
    const ownership = { trajectoryId: event.data.trajectoryId, ...(event.data.parentTrajectoryId === undefined ? {} : { parentTrajectoryId: event.data.parentTrajectoryId }) }
    return event.data.kind === 'text' ? { type: 'assistant-delta', text: event.data.text, ownership } : { type: 'thought-delta', text: event.data.text, ownership }
  }
  if (event.type === ANTIGRAVITY_TOOL_START) return { type: 'tool-activity', toolId: toolId(event.data.toolId), name: event.data.name, status: event.data.status }
  if (event.type === ANTIGRAVITY_TOOL_UPDATE) return { type: 'tool-activity', toolId: toolId(event.data.toolId), name: 'Shell', status: event.data.status, ...(event.data.output === undefined ? {} : { output: event.data.output }), ...(event.data.error === undefined ? {} : { error: event.data.error }) }
  throw new Error('unsupported test event')
}

function delta(text: string, kind: 'text' | 'thought' = 'text'): Step {
  return { publish: { type: ANTIGRAVITY_AGENT_TEXT, data: { trajectoryId: 'child', parentTrajectoryId: 'root', kind, text } } }
}

function toolStart(toolId: string): Step {
  return { publish: { type: ANTIGRAVITY_TOOL_START, data: { toolId, name: 'Shell', status: 'running' } } }
}

function toolProgress(toolId: string, output: string, status: 'running' | 'completed' = 'running'): Step {
  return { publish: { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId, status, output } } }
}

describe('Antigravity activity coalescing through the bridge', () => {
  it('delivers every delta exactly once, flushed before the finish chunk', async () => {
    const root = tempRoot()
    const writer = createAntigravityActivityWriter(root)
    const h = harness([delta('Hel'), delta('lo '), delta('world', 'thought'), delta('!', 'thought')], activityHost(writer))
    const chunks = await h.drain()
    expect(chunks.at(-1)?.type).toBe('finish')
    const records = recordsOf(root)
    expect(records.filter(record => record.type === ANTIGRAVITY_AGENT_TEXT).map(record => record.data.text)).toEqual(['Hello ', 'world!'])
    // The 400 ms window never elapsed, so the flush came from turn settlement.
    expect(records.at(-1)?.type).toBe(ANTIGRAVITY_AGENT_TEXT)
  })

  it('keeps the visible fold identical and writes fewer transient records', async () => {
    const steps = [delta('Hel'), delta('lo'), toolStart('t1'), delta(' after'), delta(' mid', 'thought'), toolProgress('t1', 'out 1'), toolProgress('t1', 'out 1 + 2'), delta(' end')]
    // Reference run: the same native events through the same bridge and store,
    // but with the durable sink writing each event immediately.
    const rawRoot = tempRoot()
    await harness(steps, passThroughHost(rawRoot)).drain()
    const coalescedRoot = tempRoot()
    const coalescedWriter = createAntigravityActivityWriter(coalescedRoot)
    await harness(steps, activityHost(coalescedWriter)).drain()

    const visible = (records: readonly AntigravityActivityRecord[]) => ({
      texts: foldAgentTextRecords(records).map(row => ({ kind: row.kind, text: row.text })),
      rows: foldActivityRecords(records).map(row => ({ state: row.state })),
    })
    expect(visible(recordsOf(coalescedRoot))).toEqual(visible(recordsOf(rawRoot)))
    expect(recordsOf(coalescedRoot).length).toBeLessThan(recordsOf(rawRoot).length)
  })

  it('keeps session-ready, tool starts and terminal states in emitted order', async () => {
    const root = tempRoot()
    const writer = createAntigravityActivityWriter(root)
    await harness([
      delta('before ready'),
      toolStart('t1'),
      delta('after start'),
      toolProgress('t1', 'grew'),
      toolProgress('t1', 'grew more'),
      toolProgress('t1', 'grew more', 'completed'),
    ], activityHost(writer)).drain()
    const records = recordsOf(root)
    expect(records.map(record => record.type)).toEqual([
      ANTIGRAVITY_SESSION_READY,
      ANTIGRAVITY_AGENT_OBSERVED,
      ANTIGRAVITY_AGENT_TEXT,
      ANTIGRAVITY_TOOL_START,
      ANTIGRAVITY_AGENT_TEXT,
      ANTIGRAVITY_TOOL_UPDATE,
      ANTIGRAVITY_TOOL_UPDATE,
    ])
    const updates = records.filter(record => record.type === ANTIGRAVITY_TOOL_UPDATE)
    expect(updates.map(record => record.data.status)).toEqual(['running', 'completed'])
    expect(updates.at(-1)?.data.output).toBe('grew more')
  })

  it('keeps the visible fold identical across a paragraph-boundary flush', async () => {
    const steps = [delta('para one\n\n'), delta('para '), delta('two\n\n'), delta('```\ncode\n```\n'), delta('tail')]
    const rawRoot = tempRoot()
    await harness(steps, passThroughHost(rawRoot)).drain()
    const coalescedRoot = tempRoot()
    await harness(steps, activityHost(createAntigravityActivityWriter(coalescedRoot))).drain()
    const texts = (records: readonly AntigravityActivityRecord[]) => foldAgentTextRecords(records).map(row => row.text)
    expect(texts(recordsOf(coalescedRoot))).toEqual(texts(recordsOf(rawRoot)))
    // The boundary flush is durable before the turn settles, but the fold still
    // joins consecutive same-key records, so visible rows are unchanged.
    expect(texts(recordsOf(coalescedRoot))).toEqual(['para one\n\npara two\n\n```\ncode\n```\ntail'])
  })

  it('flushes buffered activity on session disposal while the turn is open', async () => {
    const root = tempRoot()
    const writer = createAntigravityActivityWriter(root)
    const host = activityHost(writer)
    const h = harness([delta('unsettled'), { wait: new Promise<void>(() => undefined) }], host)
    const pump = h.drain()
    // The native turn is still open, so the delta is buffered, not durable.
    while (writer.pendingCount(SESSION) === 0) await new Promise(resolve => setTimeout(resolve, 1))
    expect(recordsOf(root).filter(record => record.type === ANTIGRAVITY_AGENT_TEXT)).toEqual([])
    // Session disposal: flush the buffer, then release the native session.
    writer.release(SESSION)
    expect(recordsOf(root).filter(record => record.type === ANTIGRAVITY_AGENT_TEXT).map(record => record.data.text)).toEqual(['unsettled'])
    h.abort()
    // Disposal aborts the turn; the aborted settlement must not drop or retry
    // the records already written.
    const chunks = await pump
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
    expect(recordsOf(root).filter(record => record.type === ANTIGRAVITY_AGENT_TEXT).map(record => record.data.text)).toEqual(['unsettled'])
  })

  it('surfaces a flush failure on the turn path instead of dropping records', async () => {
    const failing: BridgeHost = {
      appendToolEvents: () => { throw new Error('Unable to persist Antigravity activity; native execution stopped.') },
    }
    const h = harness([delta('will fail')], failing)
    await expect(h.drain()).rejects.toThrow('Unable to persist Antigravity activity; native execution stopped.')
  })

  it('fails the turn when the coalescer cannot write at settlement', async () => {
    const root = tempRoot()
    const coalesced = createAntigravityActivityWriter(root)
    const failing: BridgeHost = {
      appendToolEvents: id => { coalesced.append(id, []) },
      flushActivity: () => { throw new Error('Unable to persist Antigravity activity; native execution stopped.') },
    }
    const h = harness([delta('buffered then refused')], failing)
    await expect(h.drain()).rejects.toThrow('Unable to persist Antigravity activity; native execution stopped.')
  })

  it('makes terminal tool states durable before the turn settles', async () => {
    const root = tempRoot()
    const writer = createAntigravityActivityWriter(root)
    const h = harness([
      toolStart('t1'),
      toolProgress('t1', 'done', 'completed'),
      toolStart('t2'),
      { publish: { type: ANTIGRAVITY_TOOL_UPDATE, data: { toolId: 't2', status: 'failed', error: 'boom' } } },
      { wait: new Promise<void>(() => undefined) },
    ], activityHost(writer))
    const pump = h.drain()
    // No flush and no timer advance: the deadline is inside the 400 ms coalescing
    // window, so a terminal state that merely waited for its window would not be
    // durable yet.
    const deadline = ACTIVITY_COALESCE_WINDOW_MS - 100
    await waitFor(() => recordsOf(root).filter(record => record.type === ANTIGRAVITY_TOOL_UPDATE).length >= 2, deadline)
    const updates = recordsOf(root).filter(record => record.type === ANTIGRAVITY_TOOL_UPDATE)
    expect(updates.map(record => [record.data.toolId, record.data.status])).toEqual([['t1', 'completed'], ['t2', 'failed']])
    expect(updates[1]?.data.error).toBe('boom')
    // Each start row was written before the terminal state that followed it.
    expect(recordsOf(root).map(record => record.type)).toEqual([
      ANTIGRAVITY_SESSION_READY,
      ANTIGRAVITY_TOOL_START,
      ANTIGRAVITY_TOOL_UPDATE,
      ANTIGRAVITY_TOOL_START,
      ANTIGRAVITY_TOOL_UPDATE,
    ])
    h.abort()
    const chunks = await pump
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
    // Settlement neither duplicates nor reorders the already-durable states.
    expect(recordsOf(root).filter(record => record.type === ANTIGRAVITY_TOOL_UPDATE)).toHaveLength(2)
  })

  it('runs the runner reset before rethrowing a flush failure', async () => {
    const writer = createAntigravityActivityWriter(tempRoot())
    const host = activityHost(writer)
    let flushFails = true
    let nativeDisposals = 0
    const h = harness([delta('settled')], {
      ...host,
      flushActivityAll: () => { if (flushFails) throw new Error('Unable to persist Antigravity activity; native execution stopped.') },
    }, () => { nativeDisposals += 1 })
    await h.drain()

    await expect(h.adapter.reset()).rejects.toThrow('Unable to persist Antigravity activity; native execution stopped.')
    // The runner reset ran anyway, so a later mount cannot re-enter a
    // half-reset adapter: the native session was disposed exactly once.
    expect(nativeDisposals).toBe(1)
    flushFails = false
  })

  it('runs the runner dispose before rethrowing a flush failure', async () => {
    const writer = createAntigravityActivityWriter(tempRoot())
    const host = activityHost(writer)
    let flushFails = true
    let nativeDisposals = 0
    const h = harness([delta('settled')], {
      ...host,
      flushActivityAll: () => { if (flushFails) throw new Error('Unable to persist Antigravity activity; native execution stopped.') },
    }, () => { nativeDisposals += 1 })
    await h.drain()

    await expect(h.adapter.dispose()).rejects.toThrow('Unable to persist Antigravity activity; native execution stopped.')
    expect(nativeDisposals).toBe(1)
    flushFails = false
  })
})
