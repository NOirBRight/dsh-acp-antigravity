/** Plugin LLM adapter: same picker/turn seams as other providers, ACP behind stream(). */
import {
  createExternalAgentTurnHost,
  createSessionModelRoute,
  sessionId,
  turnId,
  type ExternalAgentProvider,
  type ExternalAgentSession,
} from '@deepseek-ai/dsh-acp-provider'
import { isRecord } from './decode.js'

export function lastUserText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!isRecord(message)) continue
    if (message.role === 'user' || i === messages.length - 1) {
      const text = textOf(message.content)
      if (text.length > 0) return text
    }
  }
  return ''
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).filter(part => part.length > 0).join(String.fromCharCode(10))
  if (isRecord(value) && typeof value.text === 'string') return value.text
  if (isRecord(value) && Array.isArray(value.content)) return textOf(value.content)
  return ''
}

export function createAntigravityLlmBridge(getProvider: () => ExternalAgentProvider | undefined, getCachedModels?: () => readonly { id: string; name: string }[], setCachedModels?: (models: readonly { id: string; name: string }[]) => void): {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(_provider: string): undefined
  imageRequestPricing(_provider: string, _model: string): undefined
  listModels(provider: string): Promise<readonly { provider: string; id: string; name: string }[]>
  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<{ provider: string; id: string; name: string }>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{ model: { provider: string; id: string; name: string }; stream: (options: { provider: string; model: string; messages: readonly unknown[]; signal?: AbortSignal; sessionId?: string }) => AsyncIterable<{ type: string; [key: string]: unknown }> }>
  stream(options: { provider: string; model: string; messages: readonly unknown[]; signal?: AbortSignal; sessionId?: string }): AsyncIterable<{ type: string; [key: string]: unknown }>
} {
  const sessions = new Map<string, ExternalAgentSession>()
  let turns = 0
  return {
    providerInfo: provider => ({ id: provider, name: 'Antigravity' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async provider => {
      const cached = getCachedModels?.() ?? []
      if (cached.length > 0) return cached.map(model => ({ provider, id: model.id, name: model.name }))
      const installed = getProvider()
      if (installed === undefined) return []
      try {
        const listed = await installed.listModels()
        const models = listed.map(model => ({ id: String(model.id), name: model.name }))
        setCachedModels?.(models)
        return models.map(model => ({ provider, id: model.id, name: model.name }))
      } catch {
        return []
      }
    },
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    async prepareCall(provider, model, signal) {
      return {
        model: await this.resolveModel(provider, model, signal),
        stream: options => this.stream(options),
      }
    },
    stream: async function* (options) {
      const installed = getProvider()
      if (installed === undefined) throw new Error('Antigravity is not configured')
      const key = options.sessionId ?? 'default'
      let session = sessions.get(key)
      if (session === undefined) {
        session = await installed.openSession({
          route: createSessionModelRoute('external-agent', String(installed.info.id), options.model),
          session: sessionId(key),
          permissionMode: 'auto-accept-edits',
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
        sessions.set(key, session)
      }
      const prompt = lastUserText(options.messages)
      const deltas: string[] = []
      let wake: (() => void) | undefined
      const host = createExternalAgentTurnHost(options.signal ?? new AbortController().signal, {
        publish: event => {
          if (event.type === 'assistant-delta' && event.text.length > 0) {
            deltas.push(event.text)
            wake?.()
          }
        },
        requestPermission: async request => {
          const once = request.options.find(option => option.kind === 'allow_once')
          return once === undefined ? { kind: 'unavailable' } : { kind: 'allow-once', optionId: once.optionId }
        },
        requestUserInput: async () => ({ answers: [] }),
      })
      const running = session.runTurn({
        turn: turnId('t' + String(++turns)),
        prompt,
        permissionMode: 'auto-accept-edits',
        signal: options.signal ?? new AbortController().signal,
      }, host)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      let assembled = ''
      while (true) {
        if (deltas.length === 0) {
          const settled = await Promise.race([running.then(() => 'done' as const), new Promise<'more'>(resolve => { wake = () => resolve('more') })])
          if (settled === 'done' && deltas.length === 0) break
        }
        const delta = deltas.shift()
        if (delta === undefined) break
        assembled += delta
        yield { type: 'text-delta', index: 0, text: delta }
      }
      const result = await running
      const text = assembled.length > 0 ? assembled : result.text
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: result.status === 'cancelled' ? 'aborted' : 'stop' }
    },
  }
}
