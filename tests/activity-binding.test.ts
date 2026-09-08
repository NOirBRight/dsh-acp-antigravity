import { Context } from '@deepseek-ai/cordis'
import { LlmError, isAgentLoopRequest, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_BINDING_REJECTED,
  ACTIVITY_BINDING_UNAVAILABLE,
  ACTIVITY_HISTORY_LOCKED,
  ACTIVITY_NATIVE_PROVIDER,
  installActivityBindingGuard,
  type ActivityBindingHostContext,
  type ActivityBindingStore,
} from '../src/activity-binding.js'
import { AntigravityActivityStore } from '../src/activity-store.js'
import { ANTIGRAVITY_SESSION_READY, type AntigravitySessionReadyEvent } from '../src/tool-events.js'

const readyEvent: AntigravitySessionReadyEvent = { type: ANTIGRAVITY_SESSION_READY, data: { provider: 'antigravity' } }

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'antigravity-binding-'))
}

function pathFor(root: string, sessionId: string): string {
  return join(root, createHash('sha256').update(sessionId, 'utf8').digest('hex') + '.jsonl')
}

/** Loop-built conversation request: stamped by the real marker, as buildRequest does. */
function loopRequest(
  sessionId: string,
  provider: string,
  messages: GenerateOptions['messages'] = [],
): GenerateOptions {
  return markAgentLoopRequest({ provider, model: 'model', messages, sessionId: SessionId(sessionId) })
}

function assistantTurn(): GenerateOptions['messages'] {
  return [
    { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hello' }], source: { kind: 'model', provider: 'deepseek', model: 'chat' } },
    { id: 'u2', role: 'user', content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } },
  ] as GenerateOptions['messages']
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

/** Drive one request through a real Context waterfall with the guard installed. */
function drive(
  store: ActivityBindingStore,
  options: GenerateOptions,
  finalChunks: readonly unknown[] = [],
): { nextCalls: number; run: () => AsyncIterable<StreamChunk> } {
  const ctx: ActivityBindingHostContext = new Context() as unknown as ActivityBindingHostContext
  installActivityBindingGuard(ctx, store)
  let nextCalls = 0
  const real = ctx as unknown as Context
  const run = (): AsyncIterable<StreamChunk> =>
    real.waterfall({} as never, 'llm/stream', options, (() => {
      nextCalls += 1
      return (async function* (): AsyncGenerator<StreamChunk> {
        yield* finalChunks as StreamChunk[]
      })()
    }) as never) as AsyncIterable<StreamChunk>
  return {
    get nextCalls() {
      return nextCalls
    },
    run,
  }
}

function throwingStore(): ActivityBindingStore {
  return {
    read(): never {
      throw new Error('store must not be read')
    },
  }
}

describe('installActivityBindingGuard', () => {
  it('rejects a bound session routed to another provider before next', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('bound', [readyEvent])
    const options = loopRequest('bound', 'deepseek')
    expect(isAgentLoopRequest(options)).toBe(true)
    const driver = drive(store, options)
    let failure: unknown
    try {
      driver.run()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).code).toBe(ACTIVITY_BINDING_REJECTED)
    expect((failure as Error).message).toContain('deepseek')
    expect(driver.nextCalls).toBe(0)
  })

  it('fails a corrupt sidecar closed with a path-free error before next', () => {
    const root = tempRoot()
    mkdirSync(root, { recursive: true })
    writeFileSync(pathFor(root, 'broken'), 'not jsonl\n')
    const driver = drive(new AntigravityActivityStore(root), loopRequest('broken', ACTIVITY_NATIVE_PROVIDER))
    let failure: unknown
    try {
      driver.run()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).code).toBe(ACTIVITY_BINDING_UNAVAILABLE)
    expect((failure as Error).message).not.toContain(root)
    expect((failure as Error).message).not.toContain('.jsonl')
    expect(driver.nextCalls).toBe(0)
  })

  it('allows the native provider for a bound session', async () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('bound', [readyEvent])
    const driver = drive(store, loopRequest('bound', ACTIVITY_NATIVE_PROVIDER))
    await expect(collect(driver.run())).resolves.toEqual([])
    expect(driver.nextCalls).toBe(1)
  })

  it('allows unbound sessions without a ready record', async () => {
    const root = tempRoot()
    const driver = drive(new AntigravityActivityStore(root), loopRequest('missing', 'deepseek'))
    await expect(collect(driver.run())).resolves.toEqual([])
    expect(driver.nextCalls).toBe(1)
  })

  it('allows a blank session first native turn', async () => {
    const driver = drive(
      new AntigravityActivityStore(tempRoot()),
      loopRequest('blank', ACTIVITY_NATIVE_PROVIDER, [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } as GenerateOptions['messages'][number],
      ]),
    )
    await expect(collect(driver.run())).resolves.toEqual([])
    expect(driver.nextCalls).toBe(1)
  })

  it('rejects converting existing DSH history onto Antigravity', () => {
    const driver = drive(
      new AntigravityActivityStore(tempRoot()),
      loopRequest('old', ACTIVITY_NATIVE_PROVIDER, assistantTurn()),
    )
    let failure: unknown
    try {
      driver.run()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).code).toBe(ACTIVITY_HISTORY_LOCKED)
    expect(driver.nextCalls).toBe(0)
  })

  it('exempts unmarked helper and hand-built requests without reading the store', async () => {
    const store = throwingStore()
    const sessionId = SessionId('bound')
    const shaped: GenerateOptions[] = [
      { provider: ACTIVITY_NATIVE_PROVIDER, model: 'model', messages: [], sessionId, purpose: 'compaction' },
      { provider: 'deepseek', model: 'model', messages: [], sessionId, purpose: 'session-title' },
      { provider: 'deepseek', model: 'model', messages: [], sessionId },
      { provider: 'deepseek', model: 'model', messages: [] },
    ]
    for (const options of shaped) {
      expect(isAgentLoopRequest(options)).toBe(false)
      const driver = drive(store, options)
      await expect(collect(driver.run())).resolves.toEqual([])
      expect(driver.nextCalls).toBe(1)
    }
  })

  it('removes the listener when disposed', () => {
    const root = tempRoot()
    const store = new AntigravityActivityStore(root)
    store.append('bound', [readyEvent])
    const ctx = new Context() as unknown as ActivityBindingHostContext
    const dispose = installActivityBindingGuard(ctx, store)
    dispose()
    let nextCalls = 0
    const run = (): AsyncIterable<StreamChunk> =>
      (ctx as unknown as Context).waterfall({} as never, 'llm/stream', loopRequest('bound', 'deepseek') as never, (() => {
        nextCalls += 1
        return (async function* (): AsyncGenerator<StreamChunk> {})()
      }) as never) as AsyncIterable<StreamChunk>
    expect(() => run()).not.toThrow()
    expect(nextCalls).toBe(1)
  })
})
