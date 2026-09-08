/** Abort publish-lifecycle regression: late native updates racing cancel must settle. */
import { describe, expect, it } from 'vitest'
import { TurnAbortedError, optionId, providerId, providerInstanceId, sessionId, turnId, type ExternalAgentTurnHost } from '@deepseek-ai/dsh-acp-provider'
import { AntigravitySession } from '../src/index.js'
import { antigravitySessionScope } from '../src/cursor.js'
import type { AcpConnection, AcpNotificationHandler, AcpRequestHandler } from '../src/protocol.js'

function chunk(text: string): unknown {
  return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
}

/** Fake ACP server: emits updates synchronously, then settles session/prompt on abort. */
class RacingConnection implements AcpConnection {
  private notifications: AcpNotificationHandler | undefined

  protected emit(update: unknown): void {
    this.notifications?.('session/update', { sessionId: 'native-1', update })
  }

  async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (method === 'session/set_mode') return {}
    if (method === 'session/prompt') {
      this.emit(chunk('early'))
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          this.emit(chunk('late'))
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
      })
    }
    throw new Error('method not found: ' + method)
  }

  notify(): void {}
  setRequestHandler(_handler: AcpRequestHandler | undefined): void {}
  setNotificationHandler(handler: AcpNotificationHandler | undefined): void { this.notifications = handler }
  async close(): Promise<void> {}
}

/** Fake ACP server: one update, then a settled prompt response. */
class PromptConnection extends RacingConnection {
  override async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (method === 'session/prompt') {
      this.emit(chunk('hello'))
      return { stopReason: 'end_turn' }
    }
    return super.request(method, params, signal)
  }
}

function openSession(connection: AcpConnection): AntigravitySession {
  const config = { executablePath: '/opt/agy/agy_acp_server', harnessPath: '/opt/agy/localharness_external', stateDirectory: '/tmp/dsh-qa', instanceId: providerInstanceId('qa'), platform: 'linux' as const }
  return new AntigravitySession(
    connection,
    providerId('antigravity'),
    sessionId('qa-session'),
    'native-1',
    config,
    antigravitySessionScope(config, '/workspace'),
  )
}

function host(publish: (event: { readonly type: string }) => Promise<void>): ExternalAgentTurnHost {
  return {
    publish,
    requestPermission: async request => ({ kind: 'allow-once', optionId: request.options[0]?.optionId ?? optionId('fallback') }),
    requestUserInput: async () => ({ answers: [] }),
  }
}

describe('Antigravity abort publish lifecycle', () => {
  it('settles abort-driven late publishes without unhandled rejections', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    const controller = new AbortController()
    const published: string[] = []
    const session = openSession(new RacingConnection())
    try {
      const pending = session.runTurn(
        { turn: turnId('abort-turn'), prompt: 'go', permissionMode: 'approval-required', signal: controller.signal },
        host(async event => {
          if (controller.signal.aborted) throw new TurnAbortedError('turn aborted')
          published.push(event.type)
        }),
      )
      await new Promise(resolve => setTimeout(resolve, 10))
      controller.abort()
      // Fold runs before publish, so the refused late delta still lands in text while only early is delivered.
      await expect(pending).resolves.toMatchObject({ status: 'cancelled', text: 'earlylate' })
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(published).toEqual(['assistant-delta'])
      expect(unhandled).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
      await session.dispose()
    }
  })

  it('still fails the turn loudly on real publish errors', async () => {
    const session = openSession(new PromptConnection())
    try {
      const result = await session.runTurn(
        { turn: turnId('publish-failure-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal },
        host(async () => { throw new Error('storage unavailable') }),
      )
      expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('storage unavailable') })
    } finally {
      await session.dispose()
    }
  })

  it('never completes a turn the live host refused to publish', async () => {
    const session = openSession(new PromptConnection())
    try {
      // Refuse only the update publish; the drain then fails the turn before
      // the final turn-result publish, so only the sink decides the outcome.
      let calls = 0
      const result = await session.runTurn(
        { turn: turnId('live-refusal-turn'), prompt: 'go', permissionMode: 'approval-required', signal: new AbortController().signal },
        host(async () => {
          calls += 1
          if (calls === 1) throw new TurnAbortedError('turn aborted')
        }),
      )
      expect(calls).toBe(1)
      expect(result.status).not.toBe('completed')
      expect(result).toMatchObject({ status: 'failed' })
    } finally {
      await session.dispose()
    }
  })
})
