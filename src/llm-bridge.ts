/** Plugin LLM adapter: same picker/turn seams as other providers, ACP behind stream(). */
import {
  createExternalAgentTurnHost,
  createSessionModelRoute,
  sessionId,
  turnId,
  type ExternalAgentPermissionDecision,
  type ExternalAgentPermissionRequest,
  type ExternalAgentProvider,
  type ExternalAgentSession,
  type ExternalAgentUserInputRequest,
} from '@deepseek-ai/dsh-acp-provider'
import { collapseAntigravityModels, nativeAntigravityModelId, peelEffort } from './catalog.js'
import { isRecord } from './decode.js'

const APPROVE_LABEL = 'Approve'
const KEEP_PLANNING_LABEL = 'Keep planning'

export interface BridgeAskRequest {
  questions: {
    id: string
    header?: string
    question: string
    detail?: string
    options?: { label: string; description?: string }[]
    intent?: { kind: 'plan-review'; approve: string }
  }[]
  signal?: AbortSignal
}

export interface BridgeHost {
  ask?(request: BridgeAskRequest): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
}

export function lastUserText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!isRecord(message)) continue
    if (!(isRecord(message.source) && message.source.kind === 'user')) continue
    const text = textOf(message.content)
    if (text.length > 0) return text
  }
  return ''
}

export function lastSkillText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!isRecord(message)) continue
    if (!(isRecord(message.source) && message.source.kind === 'skill-invocation')) continue
    const text = textOf(message.content)
    if (text.length > 0) return text
  }
  return ''
}

export function acpPrompt(messages: readonly unknown[]): string {
  const user = lastUserText(messages)
  const skill = lastSkillText(messages)
  if (skill.length === 0) return user
  if (user.length === 0) return skill
  return skill + String.fromCharCode(10) + String.fromCharCode(10) + user
}

export function permissionModeFromMessages(messages: readonly unknown[]): 'approval-required' | 'auto-accept-edits' | 'full-access' {
  const blob = messages.map(message => textOf(message)).join(String.fromCharCode(10)).toLowerCase()
  if (blob.includes('danger-full-access') || blob.includes('approval policy: never')) return 'full-access'
  if (blob.includes('read-only')) return 'approval-required'
  return 'auto-accept-edits'
}

export function inPlanMode(messages: readonly unknown[], tools?: readonly { name?: string }[]): boolean {
  if (tools?.some(tool => tool.name === 'exit_plan_mode')) return true
  return messages.some(message => isRecord(message) && isRecord(message.source) && typeof message.source.plugin === 'string' && message.source.plugin.includes('plan'))
}

export function looksLikePlan(text: string): boolean {
  const heading = text.split(String.fromCharCode(10)).some(line => line.startsWith('# ') && line.length > 2)
  return heading || text.includes('plan.md') || text.includes('Proceed')
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil([...text].length / 4))
}

function formatToolActivity(event: { name: string; status: string; input?: string; output?: string; error?: string }): string {
  const title = event.name.replace(/_/g, ' ')
  const target = toolTarget(event.input)
  const bits = [`**${title}**`, ...(target === undefined ? [] : [target]), event.status]
  if (event.error) bits.push(event.error)
  return bits.join(' · ') + String.fromCharCode(10) + String.fromCharCode(10)
}

function toolTarget(input?: string): string | undefined {
  if (input === undefined || input.length === 0) return undefined
  let parsed: Record<string, unknown> | undefined
  try {
    const value = JSON.parse(input) as unknown
    if (isRecord(value)) parsed = value
  } catch { /* raw command line */ }
  const path = parsed === undefined
    ? undefined
    : stringField(parsed, 'AbsolutePath') ?? stringField(parsed, 'file_path') ?? stringField(parsed, 'directory_path') ?? stringField(parsed, 'path')
  if (path !== undefined) return fileLink(path)
  const command = parsed === undefined ? undefined : stringField(parsed, 'CommandLine')
  if (command !== undefined) return '`' + command + '`'
  if (input.length < 120 && !input.startsWith('{')) return '`' + input + '`'
  return undefined
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key]
  return typeof item === 'string' && item.length > 0 ? item : undefined
}

function fileLink(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1) || path
  return '[' + name + '](file://' + path + ')'
}

export function workspaceRootFromMessages(messages: readonly unknown[]): string | undefined {
  const blob = messages.map(message => textOf(message)).join(String.fromCharCode(10))
  const match = /session workspace:\s*["']([^"']+)["']/i.exec(blob) ?? /workspace:\s*["'](\/[^"']+)["']/i.exec(blob)
  return match?.[1]
}

function formatPlanUpdate(event: { summary: string; steps: readonly string[] }): string {
  const lines = [event.summary, ...event.steps.map(step => '- ' + step)]
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10)
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).filter(part => part.length > 0).join(String.fromCharCode(10))
  if (isRecord(value) && typeof value.text === 'string') return value.text
  if (isRecord(value) && typeof value.content === 'string') return value.content
  if (isRecord(value) && Array.isArray(value.content)) return textOf(value.content)
  return ''
}

type StreamOptions = {
  provider: string
  model: string
  messages: readonly unknown[]
  signal?: AbortSignal
  sessionId?: string
  tools?: readonly { name?: string }[]
  reasoningEffort?: string
}

type Chunk = { type: string; [key: string]: unknown }

export function createAntigravityLlmBridge(
  getProvider: () => ExternalAgentProvider | undefined,
  getCachedModels?: () => readonly { id: string; name: string }[],
  setCachedModels?: (models: readonly { id: string; name: string }[]) => void,
  hostAsk?: BridgeHost,
): {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(_provider: string): undefined
  imageRequestPricing(_provider: string, _model: string): undefined
  listModels(provider: string): Promise<readonly { provider: string; id: string; name: string }[]>
  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<{ provider: string; id: string; name: string }>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{ model: { provider: string; id: string; name: string }; stream: (options: StreamOptions) => AsyncIterable<Chunk> }>
  stream(options: StreamOptions): AsyncIterable<Chunk>
} {
  const sessions = new Map<string, ExternalAgentSession>()
  let turns = 0
  async function nativeModels(): Promise<readonly { id: string; name: string }[]> {
    const cached = getCachedModels?.() ?? []
    if (cached.length > 0) return cached
    const installed = getProvider()
    if (installed === undefined) return []
    try {
      const listed = await installed.listModels()
      const models = listed.map(model => ({ id: String(model.id), name: model.name }))
      setCachedModels?.(models)
      return models
    } catch {
      return []
    }
  }
  return {
    providerInfo: provider => ({ id: provider, name: 'Antigravity' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async provider => {
      const native = await nativeModels()
      return collapseAntigravityModels(native).map(model => ({ provider, ...model }))
    },
    resolveModel: async (provider, model) => {
      const collapsed = collapseAntigravityModels(await nativeModels())
      const found = collapsed.find(item => item.id === model) ?? collapsed.find(item => item.id === peelEffort(model).logical)
      if (found === undefined) return { provider, id: model, name: model }
      return { provider, ...found }
    },
    async prepareCall(provider, model, signal) {
      return {
        model: await this.resolveModel(provider, model, signal),
        stream: options => this.stream(options),
      }
    },
    stream: async function* (options) {
      try {
        const installed = getProvider()
        if (installed === undefined) throw new Error('Antigravity is not configured')
        const key = options.sessionId ?? 'default'
        const permissionMode = permissionModeFromMessages(options.messages)
        const natives = await nativeModels()
        const nativeModel = nativeAntigravityModelId(options.model, options.reasoningEffort, natives.map(model => model.id))
        const workspaceRoot = workspaceRootFromMessages(options.messages)
        let session = sessions.get(key)
        if (session === undefined) {
          session = await installed.openSession({
            route: createSessionModelRoute('external-agent', String(installed.info.id), nativeModel),
            session: sessionId(key),
            permissionMode,
            ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          })
          sessions.set(key, session)
        }
        const pending: { kind: 'thought' | 'text'; text: string }[] = []
        let sawPlan = false
        let wake: (() => void) | undefined
        const push = (kind: 'thought' | 'text', text: string): void => {
          if (text.length === 0) return
          pending.push({ kind, text })
          wake?.()
        }
        const turnHost = createExternalAgentTurnHost(options.signal ?? new AbortController().signal, {
          publish: event => {
            if (event.type === 'thought-delta') push('thought', event.text)
            else if (event.type === 'assistant-delta') push('text', event.text)
            else if (event.type === 'tool-activity') push('text', formatToolActivity(event))
            else if (event.type === 'plan-update') {
              sawPlan = true
              push('text', formatPlanUpdate(event))
            }
          },
          requestPermission: request => decidePermission(request, permissionMode, hostAsk, options.signal),
          requestUserInput: request => decideUserInput(request, hostAsk, options.signal),
        })
        async function* drain(running: Promise<{ status: string; text: string }>, start: { thought: string; text: string; thoughtOpen: boolean; textOpen: boolean }): AsyncGenerator<Chunk, { thought: string; text: string; thoughtOpen: boolean; textOpen: boolean }> {
          let { thought, text, thoughtOpen, textOpen } = start
          while (true) {
            if (pending.length === 0) {
              const settled = await Promise.race([running.then(() => 'done' as const), new Promise<'more'>(resolve => { wake = () => resolve('more') })])
              if (settled === 'done' && pending.length === 0) break
            }
            const item = pending.shift()
            if (item === undefined) break
            if (item.kind === 'thought') {
              if (!thoughtOpen) {
                yield { type: 'block-start', index: 0, blockType: 'reasoning' }
                thoughtOpen = true
              }
              thought += item.text
              yield { type: 'reasoning-delta', index: 0, text: item.text }
            } else {
              if (!textOpen) {
                yield { type: 'block-start', index: 1, blockType: 'text' }
                textOpen = true
              }
              text += item.text
              yield { type: 'text-delta', index: 1, text: item.text }
            }
          }
          await running
          return { thought, text, thoughtOpen, textOpen }
        }
        const prompt = acpPrompt(options.messages)
        const first = session.runTurn({
          turn: turnId('t' + String(++turns)),
          prompt,
          permissionMode,
          signal: options.signal ?? new AbortController().signal,
        }, turnHost)
        let state = yield* drain(first, { thought: '', text: '', thoughtOpen: false, textOpen: false })
        const result = await first
        let assembled = state.text.length > 0 ? state.text : result.text
        if (inPlanMode(options.messages, options.tools) && (sawPlan || looksLikePlan(assembled)) && hostAsk?.ask !== undefined) {
          const approved = await reviewPlan(assembled, hostAsk, options.signal)
          if (approved) {
            const second = session.runTurn({
              turn: turnId('t' + String(++turns)),
              prompt: 'The user approved the plan. Carry it out now.',
              permissionMode,
              signal: options.signal ?? new AbortController().signal,
            }, turnHost)
            state = yield* drain(second, state)
            const next = await second
            assembled = state.text.length > 0 ? state.text : assembled + (next.text.length > 0 ? String.fromCharCode(10) + next.text : '')
          }
        }
        if (state.thoughtOpen) yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: state.thought } }
        if (state.textOpen || assembled.length > 0) {
          if (!state.textOpen) yield { type: 'block-start', index: 1, blockType: 'text' }
          yield { type: 'block-end', index: 1, block: { type: 'text', text: assembled } }
        }
        yield { type: 'usage', usage: { inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(assembled) } }
        yield { type: 'finish', reason: result.status === 'cancelled' ? 'aborted' : 'stop' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: message }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: message } }
        yield { type: 'finish', reason: 'stop' }
      }
    },
  }
}

async function decidePermission(
  request: ExternalAgentPermissionRequest,
  mode: 'approval-required' | 'auto-accept-edits' | 'full-access',
  hostAsk: BridgeHost | undefined,
  signal?: AbortSignal,
): Promise<ExternalAgentPermissionDecision> {
  if (mode === 'full-access' || hostAsk?.ask === undefined) {
    const once = request.options.find(option => option.kind === 'allow_once') ?? request.options.find(option => option.kind === 'allow_always')
    return once === undefined ? { kind: 'unavailable' } : once.kind === 'allow_always' ? { kind: 'allowed-for-session', optionId: once.optionId } : { kind: 'allow-once', optionId: once.optionId }
  }
  const options = request.options.map(option => ({ label: option.label, description: option.kind }))
  const result = await hostAsk.ask({
    questions: [{
      id: 'permission',
      header: 'Permission',
      question: request.reason.length > 0 ? request.reason : request.toolName,
      ...(options.length > 0 ? { options } : {}),
    }],
    ...(signal === undefined ? {} : { signal }),
  })
  const selected = result.answers[0]?.selected[0]
  const option = request.options.find(item => item.label === selected)
  if (option === undefined) {
    const reject = request.options.find(item => item.kind === 'reject' || item.kind === 'cancel')
    return { kind: 'reject', ...(reject === undefined ? {} : { optionId: reject.optionId }) }
  }
  if (option.kind === 'allow_always') return { kind: 'allowed-for-session', optionId: option.optionId }
  if (option.kind === 'allow_once') return { kind: 'allow-once', optionId: option.optionId }
  if (option.kind === 'cancel') return { kind: 'cancel', optionId: option.optionId }
  return { kind: 'reject', optionId: option.optionId }
}

async function decideUserInput(
  request: ExternalAgentUserInputRequest,
  hostAsk: BridgeHost | undefined,
  signal?: AbortSignal,
): Promise<{ answers: string[] }> {
  if (hostAsk?.ask === undefined) return { answers: [] }
  const options = request.options?.map(label => ({ label }))
  const result = await hostAsk.ask({
    questions: [{
      id: String(request.requestId),
      question: request.question,
      ...(options === undefined ? {} : { options }),
    }],
    ...(signal === undefined ? {} : { signal }),
  })
  const item = result.answers[0]
  if (item === undefined) return { answers: [] }
  if (item.selected.length > 0) return { answers: item.selected }
  if (item.custom !== undefined && item.custom.length > 0) return { answers: [item.custom] }
  return { answers: [] }
}

async function reviewPlan(plan: string, hostAsk: BridgeHost, signal?: AbortSignal): Promise<boolean> {
  const result = await hostAsk.ask!({
    questions: [{
      id: 'plan-review',
      header: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: plan,
      options: [
        { label: APPROVE_LABEL, description: 'Leave plan mode; the plan is carried out from the next step.' },
        { label: KEEP_PLANNING_LABEL, description: 'Stay in plan mode; feedback goes back to the model.' },
      ],
      intent: { kind: 'plan-review', approve: APPROVE_LABEL },
    }],
    ...(signal === undefined ? {} : { signal }),
  })
  const item = result.answers.find(entry => entry.id === 'plan-review')
  return item?.selected.length === 1 && item.selected[0] === APPROVE_LABEL && item.custom === undefined
}
