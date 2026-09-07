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
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { collapseAntigravityModels, nativeAntigravityModelId, peelEffort } from './catalog.js'
import { isRecord } from './decode.js'
import { toDurableToolEvents, type AntigravityToolEvent } from './tool-events.js'

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
  sessionId?: string
}

export interface BridgeHost {
  ask?(request: BridgeAskRequest): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
  appendSessionReady?(sessionId: string | undefined): void
  appendToolEvents?(sessionId: string | undefined, events: readonly AntigravityToolEvent[]): void
  /**
   * Resolve the authoritative sandbox policy for one stream call. The host reads
   * ctx.sandboxPolicy for the exact session; user and tool text never selects policy.
   * Absent or unresolvable policy fails closed to approval-required.
   */
  resolvePolicy?(sessionId: string | undefined): AntigravitySandboxPolicy | undefined
  /**
   * Ask the canonical approval service for one native permission. The plugin routes
   * the exact session agent via ctx.approval, which enforces session policy and
   * audits itself. Generic ask stays for plan review and user-input questions.
   * Only 'allowed-once' grants; every other outcome denies.
   */
  requestApproval?(input: { sessionId: string | undefined; toolName: string; reason?: string; signal?: AbortSignal }): Promise<AntigravityApprovalOutcome>
}

/** Closed outcome of one canonical approval ask. Structural mirror of the approval-service vocabulary. */
export type AntigravityApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * File-effect policy resolved by the host for one stream call. Structural mirror
 * of the sandbox-policy service shape; no new dependency.
 */
export interface AntigravitySandboxPolicy {
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly workspaceRoot: string
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

export function inPlanMode(messages: readonly unknown[], tools?: readonly { name?: string }[]): boolean {
  if (tools?.some(tool => tool.name === 'exit_plan_mode')) return true
  return messages.some(message => isRecord(message) && isRecord(message.source) && typeof message.source.plugin === 'string' && message.source.plugin.includes('plan'))
}

export function looksLikePlan(text: string): boolean {
  const heading = text.split(String.fromCharCode(10)).some(line => line.startsWith('# ') && line.length > 2)
  return heading || text.includes('plan.md') || text.includes('Proceed')
}

function formatPlanUpdate(event: { summary: string; steps: readonly string[] }): string {
  const lines = [event.summary, ...event.steps.map(step => '- ' + step)]
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10)
}

/**
 * Accept only fully known provider-reported usage. Both counters must be finite
 * nonnegative integers, matching official TokenUsage: the token-meter fold does
 * unguarded outputTokens arithmetic, so a partial sample would poison totals
 * with NaN. Anything else is omitted, never zero-filled.
 */
function reportedUsage(inputTokens: unknown, outputTokens: unknown): TokenUsage | undefined {
  if (!isTokenCount(inputTokens) || !isTokenCount(outputTokens)) return undefined
  return { inputTokens, outputTokens }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
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
  const emittedToolIds = new Map<string, Set<string>>()
  let anonymousSessions = 0
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
      const installed = getProvider()
      if (installed === undefined) throw new Error('Antigravity is not configured')
      const key = options.sessionId ?? 'anonymous-' + String(++anonymousSessions)
      const policy = hostAsk?.resolvePolicy?.(options.sessionId)
      const permissionMode = policy?.mode === 'danger-full-access' ? 'full-access' : policy?.mode === 'workspace-write' ? 'auto-accept-edits' : 'approval-required'
      const openMode = permissionMode === 'full-access' ? 'auto-accept-edits' : permissionMode
      const natives = await nativeModels()
      const nativeModel = nativeAntigravityModelId(options.model, options.reasoningEffort, natives.map(model => model.id))
      const workspaceRoot = policy?.workspaceRoot
      let session = sessions.get(key)
      if (session === undefined) {
        const opened = await installed.openSession({
          route: createSessionModelRoute('external-agent', String(installed.info.id), nativeModel),
          session: sessionId(key),
          permissionMode: openMode,
          ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
        try {
          hostAsk?.appendSessionReady?.(options.sessionId)
        } catch (error) {
          try {
            await opened.dispose()
          } catch {
            // Preserve storage failure if cleanup also fails.
          }
          throw error
        }
        session = opened
        sessions.set(key, session)
      }
      const configurable = session as typeof session & { configure?: (model: string, mode: typeof permissionMode, signal?: AbortSignal) => Promise<void> }
      if (typeof configurable.configure === 'function') await configurable.configure(nativeModel, permissionMode, options.signal)
      type Pending = { kind: 'thought' | 'text'; text: string } | { kind: 'usage'; usage: TokenUsage }
      const pending: Pending[] = []
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
          else if (event.type === 'tool-activity') {
            const seen = emittedToolIds.get(key) ?? new Set<string>()
            emittedToolIds.set(key, seen)
            const events = toDurableToolEvents(event, seen, workspaceRoot)
            if (!seen.has(event.toolId)) seen.add(event.toolId)
            hostAsk?.appendToolEvents?.(options.sessionId, events)
          }
          else if (event.type === 'plan-update') {
            sawPlan = true
            push('text', formatPlanUpdate(event))
          } else if (event.type === 'usage') {
            // Forward provider-reported totals verbatim. The ACP contract defines
            // no delta semantics, so samples pass through in order and the harness
            // (last-wins per step) decides; never sum, estimate, or zero-fill here.
            // Partial or invalid samples are dropped: no complete pair, no chunk.
            const usage = reportedUsage(event.inputTokens, event.outputTokens)
            if (usage !== undefined) {
              pending.push({ kind: 'usage', usage })
              wake?.()
            }
          }
        },
        requestPermission: request => decidePermission(request, permissionMode, hostAsk, options.signal, options.sessionId),
        requestUserInput: request => decideUserInput(request, hostAsk, options.signal, options.sessionId),
      })
      const prompt = acpPrompt(options.messages)
      async function* drain(running: Promise<{ status: string; text: string }>, start: { thought: string; text: string; thoughtOpen: boolean; textOpen: boolean }): AsyncGenerator<Chunk, { thought: string; text: string; thoughtOpen: boolean; textOpen: boolean }> {
        let { thought, text, thoughtOpen, textOpen } = start
        while (true) {
          if (pending.length === 0) {
            const settled = await Promise.race([running.then(() => 'done' as const), new Promise<'more'>(resolve => { wake = () => resolve('more') })])
            if (settled === 'done' && pending.length === 0) break
          }
          const item = pending.shift()
          if (item === undefined) break
          if (item.kind === 'usage') {
            yield { type: 'usage', usage: item.usage }
            continue
          }
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
        let approved = false
        try {
          approved = await reviewPlan(assembled, hostAsk, options.signal, options.sessionId)
        } catch {
          approved = false
        }
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
      yield { type: 'finish', reason: result.status === 'cancelled' ? 'aborted' : 'stop' }
    },
  }
}

async function decidePermission(
  request: ExternalAgentPermissionRequest,
  mode: 'approval-required' | 'auto-accept-edits' | 'full-access',
  hostAsk: BridgeHost | undefined,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<ExternalAgentPermissionDecision> {
  if (mode === 'full-access') {
    const once = request.options.find(option => option.kind === 'allow_once') ?? request.options.find(option => option.kind === 'allow_always')
    return once === undefined ? { kind: 'unavailable' } : once.kind === 'allow_always' ? { kind: 'allowed-for-session', optionId: once.optionId } : { kind: 'allow-once', optionId: once.optionId }
  }
  const rejectOf = (): ExternalAgentPermissionDecision => {
    const deny = request.options.find(option => option.kind === 'reject') ?? request.options.find(option => option.kind === 'cancel')
    return deny === undefined ? { kind: 'reject' } : { kind: 'reject', optionId: deny.optionId }
  }
  if (hostAsk?.requestApproval === undefined) {
    const cancel = request.options.find(option => option.kind === 'cancel')
    return cancel === undefined ? rejectOf() : { kind: 'cancel', optionId: cancel.optionId }
  }
  let outcome: AntigravityApprovalOutcome
  try {
    outcome = await hostAsk.requestApproval({
      sessionId,
      toolName: request.toolName,
      ...(request.reason.length > 0 ? { reason: request.reason } : {}),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    return rejectOf()
  }
  if (outcome === 'allowed-once') {
    const once = request.options.find(option => option.kind === 'allow_once')
    return once === undefined ? rejectOf() : { kind: 'allow-once', optionId: once.optionId }
  }
  if (outcome === 'cancelled') {
    const cancel = request.options.find(option => option.kind === 'cancel')
    return cancel === undefined ? rejectOf() : { kind: 'cancel', optionId: cancel.optionId }
  }
  return rejectOf()
}

async function decideUserInput(
  request: ExternalAgentUserInputRequest,
  hostAsk: BridgeHost | undefined,
  signal?: AbortSignal,
  sessionId?: string,
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
    ...(sessionId === undefined ? {} : { sessionId }),
  })
  const item = result.answers[0]
  if (item === undefined) return { answers: [] }
  if (item.selected.length > 0) return { answers: item.selected }
  if (item.custom !== undefined && item.custom.length > 0) return { answers: [item.custom] }
  return { answers: [] }
}

async function reviewPlan(plan: string, hostAsk: BridgeHost, signal?: AbortSignal, sessionId?: string): Promise<boolean> {
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
    ...(sessionId === undefined ? {} : { sessionId }),
  })
  const item = result.answers.find(entry => entry.id === 'plan-review')
  return item?.selected.length === 1 && item.selected[0] === APPROVE_LABEL && item.custom === undefined
}
