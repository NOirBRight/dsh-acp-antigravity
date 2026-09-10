/** Plugin LLM adapter: same picker/turn seams as other providers, ACP behind stream(). */
import {
  createExternalAgentTurnHost,
  ExternalAgentTurnRunner,
  type ExternalAgentProviderRegistry,
  createSessionModelRoute,
  sessionId,
  turnId,
  type ExternalAgentPermissionDecision,
  type ExternalAgentPermissionRequest,
  type ExternalAgentProvider,
  type ExternalAgentSessionRef,
  type ExternalAgentTurnResult,
  type ExternalAgentUserInputAnswers,
  type ExternalAgentUserInputRequest,
} from '@deepseek-ai/dsh-acp-provider'
import type { StreamChunk, ResolvedRetryPolicy, TokenUsage } from '@deepseek-ai/dsh-llm'
import { collapseAntigravityModels, nativeAntigravityModelId, peelEffort, type CatalogOverlay, type CollapsedAntigravityModel } from './catalog.js'
import type { ModelFacts } from './model-metadata.js'
import { isRecord } from './decode.js'
import { acpUsage, hostUsage, reportedUsage, withTelemetryKeys } from './usage.js'
import { ANTIGRAVITY_USER_QUESTION_ANSWER, ANTIGRAVITY_AGENT_OBSERVED, ANTIGRAVITY_AGENT_TEXT, toDurableAgentEvents, toDurableToolEvents, type AntigravityToolEvent, type AntigravityOwnedEvent } from './tool-events.js'

const APPROVE_LABEL = 'Approve'
const KEEP_PLANNING_LABEL = 'Keep planning'

export interface BridgeAskRequest {
  questions: {
    id: string
    header?: string
    question: string
    detail?: string
    options?: { label: string; description?: string }[]
    multiSelect?: boolean
    intent?: { kind: 'plan-review'; approve: string }
  }[]
  signal?: AbortSignal
  sessionId?: string
}

export interface BridgeHost {
  /** Read the exact session’s current DSH Plan flag; absent state never authorizes plan review. */
  isPlanMode?(sessionId: string | undefined): boolean
  ask?(request: BridgeAskRequest): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
  appendSessionReady?(sessionId: string | undefined, ref: ExternalAgentSessionRef): void
  loadSession?(sessionId: string): ExternalAgentSessionRef | undefined
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

export interface AntigravityResolvedModel {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly inputModalities?: readonly ('text' | 'image')[]
  readonly context?: { readonly contextWindow: number }
  readonly defaultMaxTokens?: number
  readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[]; readonly defaultEffort?: string }
}

/** Discovery inputs the Settings card and the Host directory must agree on. */
export interface AntigravityCatalogContext {
  /** Account-declared default model; its effort is that model's default level. */
  readonly declaredDefaultModelId?: string
  /** Saved per-id field overrides; membership stays the discovered catalog. */
  readonly overrides?: Readonly<Record<string, CatalogOverlay>>
}

function collapseCatalog(
  native: readonly { id: string; name: string }[],
  facts?: ReadonlyMap<string, ModelFacts>,
  context?: AntigravityCatalogContext,
): readonly CollapsedAntigravityModel[] {
  const collapsed = collapseAntigravityModels(native, facts ?? new Map(), context?.declaredDefaultModelId)
  if (context?.overrides === undefined) return collapsed
  // Project only the saved default level. Discovery still owns the efforts the
  // Host routes on, and membership stays whole so a deselected row still resolves.
  return collapsed.map(model => {
    const reasoning = context.overrides?.[model.id]?.reasoning
    if (reasoning === undefined) return model
    const efforts = model.reasoning?.efforts ?? []
    return reasoning.defaultEffort === undefined
      ? (model.reasoning === undefined ? model : { ...model, reasoning: { efforts } })
      : { ...model, reasoning: { efforts, defaultEffort: reasoning.defaultEffort } }
  })
}

function findCollapsed(collapsed: readonly CollapsedAntigravityModel[], model: string): CollapsedAntigravityModel | undefined {
  return collapsed.find(item => item.id === model)
    ?? collapsed.find(item => item.nativeIds.includes(model))
    ?? collapsed.find(item => item.id === peelEffort(model).logical)
}

function toResolvedModel(provider: string, requested: string, found: CollapsedAntigravityModel): AntigravityResolvedModel {
  const id = found.nativeIds.includes(requested) || found.id === requested ? requested : found.id
  const efforts = found.reasoning?.efforts ?? []
  // The Host rejects a default outside efforts and fails the whole model entry.
  const declaredDefault = found.reasoning?.defaultEffort
  const defaultEffort = declaredDefault !== undefined && efforts.some(effort => effort.id === declaredDefault) ? declaredDefault : undefined
  return {
    provider,
    id,
    name: found.name,
    ...(found.vision === true ? { inputModalities: ['text', 'image'] as const } : found.vision === false ? { inputModalities: ['text'] as const } : {}),
    ...(found.contextWindow === undefined ? {} : { context: { contextWindow: found.contextWindow } }),
    ...(found.maxOutputTokens === undefined ? {} : { defaultMaxTokens: found.maxOutputTokens }),
    ...(efforts.length === 0 ? {} : {
      reasoning: {
        efforts,
        ...(defaultEffort === undefined ? {} : { defaultEffort }),
      },
    }),
  }
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

type Chunk = StreamChunk

export function createAntigravityLlmBridge(
  runtime: { readonly registry: ExternalAgentProviderRegistry; readonly getProvider: () => ExternalAgentProvider | undefined },
  getCachedModels?: () => readonly { id: string; name: string }[],
  setCachedModels?: (models: readonly { id: string; name: string }[]) => void,
  hostAsk?: BridgeHost,
  getCachedFacts?: () => ReadonlyMap<string, ModelFacts>,
  getCatalogContext?: () => AntigravityCatalogContext | undefined,
): {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy
  imageRequestPricing(_provider: string, _model: string): undefined
  listModels(provider: string): Promise<readonly { provider: string; id: string; name: string }[]>
  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<AntigravityResolvedModel>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{ model: AntigravityResolvedModel; stream: (options: StreamOptions) => AsyncIterable<Chunk> }>
  stream(options: StreamOptions): AsyncIterable<Chunk>
  reset(): Promise<void>
  release(session: string): Promise<void>
  dispose(): Promise<void>
} {
  const { getProvider } = runtime
  const emittedToolIds = new Map<string, Set<string>>()
  const observedAgentTrajectories = new Map<string, Set<string>>()
  let turns = 0
  const runner = new ExternalAgentTurnRunner(runtime.registry, {
    loadSession: id => hostAsk?.loadSession?.(id),
    saveSession: ref => {
      hostAsk?.appendSessionReady?.(ref.session, ref)
      emittedToolIds.delete(ref.session)
      observedAgentTrajectories.delete(ref.session)
    },
  })
  let listing: Promise<readonly { id: string; name: string }[]> | undefined
  function collapseNative(native: readonly { id: string; name: string }[]): readonly CollapsedAntigravityModel[] {
    return collapseCatalog(native, getCachedFacts?.(), getCatalogContext?.())
  }
  /** Cached native catalog. `wait` is for resolve/stream; picker `listModels` must not wait. */
  function nativeModels(wait: boolean): Promise<readonly { id: string; name: string }[]> {
    const cached = getCachedModels?.() ?? []
    if (cached.length > 0) return Promise.resolve(cached)
    const installed = getProvider()
    if (installed === undefined) return Promise.resolve([])
    listing ??= installed.listModels()
      .then(listed => {
        const models = listed.map(model => ({ id: String(model.id), name: model.name }))
        setCachedModels?.(models)
        return models
      })
      .catch(() => []) // Native discovery failure: empty catalog, resolve/stream fail loudly.
      .finally(() => { listing = undefined })
    return wait ? listing : Promise.resolve([])
  }
  return {
    async reset() { await runner.reset(); emittedToolIds.clear(); observedAgentTrajectories.clear() },
    async release(id) { await runner.release(sessionId(id)); emittedToolIds.delete(id); observedAgentTrajectories.delete(id) },
    async dispose() { await runner.dispose(); emittedToolIds.clear(); observedAgentTrajectories.clear() },
    providerInfo: provider => ({ id: provider, name: 'Antigravity' }),
    // Native prompts can already have executed tools before a transport failure.
    providerRetryPolicy: () => ({ mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }),
    imageRequestPricing: () => undefined,
    listModels: async provider => {
      const native = await nativeModels(false)
      return collapseNative(native).map(model => ({ provider, id: model.id, name: model.name }))
    },
    resolveModel: async (provider, model) => {
      const natives = await nativeModels(true)
      const collapsed = collapseNative(natives)
      if (model === 'default') {
        const found = collapsed[0]
        if (found === undefined) throw new Error('Antigravity model catalog is unavailable')
        return { ...toResolvedModel(provider, found.id, found), id: 'default' }
      }
      const found = findCollapsed(collapsed, model)
      if (found === undefined) {
        if (natives.length === 0) throw new Error('Antigravity model catalog is unavailable')
        throw new Error('Unknown Antigravity model: ' + model)
      }
      return toResolvedModel(provider, model, found)
    },
    async prepareCall(provider, model, signal) {
      const selected = getProvider()
      const resolved = await this.resolveModel(provider, model, signal)
      if (getProvider() !== selected) throw new Error('Antigravity configuration changed while preparing the turn')
      return {
        model: resolved,
        stream: options => {
          if (getProvider() !== selected) throw new Error('Antigravity configuration changed before dispatch')
          return this.stream(options)
        },
      }
    },
    stream: async function* (options) {
      const installed = getProvider()
      if (installed === undefined) throw new Error('Antigravity is not configured')
      if (options.sessionId === undefined) throw new Error('Native turns require an explicit DSH session id')
      const key = options.sessionId
      const controller = new AbortController()
      const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])
      const policy = hostAsk?.resolvePolicy?.(options.sessionId)
      const permissionMode = policy?.mode === 'danger-full-access' ? 'full-access' : policy?.mode === 'workspace-write' ? 'auto-accept-edits' : 'approval-required'
      const natives = await nativeModels(true)
      if (natives.length === 0) throw new Error('Antigravity model catalog is unavailable')
      const collapsed = collapseNative(natives)
      const selected = findCollapsed(collapsed, options.model)
      if (selected === undefined) throw new Error('Unknown Antigravity model: ' + options.model)
      const nativeModel = nativeAntigravityModelId(selected.id, options.reasoningEffort, natives.map(model => model.id), natives, selected.effortMap)
      const workspaceRoot = policy?.workspaceRoot
      if (getProvider() !== installed) throw new Error('Antigravity configuration changed before native execution')
      const openRequest = {
        route: createSessionModelRoute('external-agent', String(installed.info.id), nativeModel),
        session: sessionId(key),
        permissionMode,
        fullAccessConfirmed: permissionMode === 'full-access',
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        signal,
      } as const
      type Pending = { kind: 'thought' | 'text'; text: string }
      const pending: Pending[] = []
      let followUp: string | undefined
      let wake: (() => void) | undefined
      const usages: TokenUsage[] = []
      const push = (kind: 'thought' | 'text', text: string): void => {
        if (text.length === 0) return
        pending.push({ kind, text })
        wake?.()
      }
      // Disclose a child trajectory once per native session from its first owned
      // text/thought linkage. Scoped like emittedToolIds and reset on native open,
      // so a restarted native session discloses its trajectories again. No text stored.
      const childOwned = (carrier: AntigravityOwnedEvent): boolean => {
        const ownership = carrier.ownership
        return ownership !== undefined && ownership.parentTrajectoryId !== undefined && ownership.trajectoryId !== ownership.parentTrajectoryId
      }
      const observeAgent = (carrier: AntigravityOwnedEvent): void => {
        const seen = observedAgentTrajectories.get(key) ?? new Set<string>()
        observedAgentTrajectories.set(key, seen)
        const events = toDurableAgentEvents(carrier.ownership, seen)
        if (events.length === 0) return
        for (const event of events) if (event.type === ANTIGRAVITY_AGENT_OBSERVED) seen.add(event.data.trajectoryId)
        hostAsk?.appendToolEvents?.(options.sessionId, events)
      }
      const turnHost = createExternalAgentTurnHost(signal, {
        publish: event => {
          if (event.type === 'thought-delta' || event.type === 'assistant-delta') {
            observeAgent(event)
            if (childOwned(event) && event.ownership !== undefined) {
              if (event.text.length === 0) return
              hostAsk?.appendToolEvents?.(options.sessionId, [{ type: ANTIGRAVITY_AGENT_TEXT, data: {
                trajectoryId: event.ownership.trajectoryId,
                ...(event.ownership.parentTrajectoryId === undefined ? {} : { parentTrajectoryId: event.ownership.parentTrajectoryId }),
                kind: event.type === 'thought-delta' ? 'thought' : 'text',
                text: event.text.length > 4000 ? event.text.slice(0, 4000) : event.text,
              } }])
              return
            }
            push(event.type === 'thought-delta' ? 'thought' : 'text', event.text)
          }
          else if (event.type === 'tool-activity') {
            const seen = emittedToolIds.get(key) ?? new Set<string>()
            emittedToolIds.set(key, seen)
            const events = toDurableToolEvents(event, seen, workspaceRoot)
            if (!seen.has(event.toolId)) seen.add(event.toolId)
            hostAsk?.appendToolEvents?.(options.sessionId, events)
          }
          else if (event.type === 'plan-update') {
            push('text', formatPlanUpdate(event))
          } else if (event.type === 'usage') {
            // Validated provider accounting feeds the token meter and context
            // ring; partial or invalid samples stay out rather than guessing.
            // Canonical keys first, telemetry spellings as fallback.
            const sample = reportedUsage(event) ?? acpUsage(withTelemetryKeys(event))
            if (sample !== undefined) usages.push(sample)
          }
        },
        requestPermission: request => decidePermission(request, permissionMode, hostAsk, signal, options.sessionId),
        requestUserInput: async request => {
          const answer = await decideUserInput(request, hostAsk, signal, options.sessionId)
          if (answer.custom !== undefined && answer.custom.trim() !== '') followUp = answer.custom.trim()
          return answer
        },
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
      let active: Promise<ExternalAgentTurnResult> | undefined
      const run = (text: string): Promise<ExternalAgentTurnResult> => {
        active = runner.runTurn(openRequest, { turn: turnId('t' + String(++turns)), prompt: text, permissionMode, signal }, turnHost)
        return active
      }
      try {
        const first = run(prompt)
        let state = yield* drain(first, { thought: '', text: '', thoughtOpen: false, textOpen: false })
        const result = await first
        let finalStatus = result.status
        let finalError = result.error
        let assembled = state.text.length > 0 ? state.text : result.text
        if (followUp !== undefined && followUp.trim() !== '' && !signal.aborted) {
          const extra = run(followUp)
          followUp = undefined
          state = yield* drain(extra, state)
          const next = await extra
          finalStatus = next.status
          finalError = next.error
          assembled = state.text.length > 0 ? state.text : assembled + (next.text.length > 0 ? String.fromCharCode(10) + next.text : '')
        }
        if (finalStatus === 'completed' && hostAsk?.isPlanMode?.(options.sessionId) === true && hostAsk.ask !== undefined) {
          let approved = false
          try {
            approved = await reviewPlan(assembled, hostAsk, signal, options.sessionId)
          } catch {
            // Review channel abort or host failure must not execute the plan.
            approved = false
          }
          if (approved) {
            const second = run('The user approved the plan. Carry it out now.')
            state = yield* drain(second, state)
            const next = await second
            finalStatus = next.status
            finalError = next.error
            assembled = state.text.length > 0 ? state.text : assembled + (next.text.length > 0 ? String.fromCharCode(10) + next.text : '')
          }
        }
        if (state.thoughtOpen) yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: state.thought } }
        if (state.textOpen || assembled.length > 0) {
          if (!state.textOpen) yield { type: 'block-start', index: 1, blockType: 'text' }
          yield { type: 'block-end', index: 1, block: { type: 'text', text: assembled } }
        }
        for (const sample of usages.splice(0)) yield { type: 'usage', usage: hostUsage(sample) }
        yield { type: 'finish', reason: finalStatus === 'cancelled'
          ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'Native turn cancelled' } }
          : finalStatus === 'failed'
            ? { kind: 'error', failure: { code: 'NATIVE_TURN_FAILED', message: finalError ?? 'Native turn failed' } }
            : { kind: 'stop' } }
      } finally {
        controller.abort()
        turnHost.expire()
        await active?.catch(() => undefined) // The stream already reports the execution error.
      }
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
    // A throwing approval service cannot grant; native permission stays rejected.
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
): Promise<ExternalAgentUserInputAnswers> {
  if (hostAsk?.ask === undefined) return { answers: [] }
  const options = request.options?.map(label => ({ label }))
  const result = await hostAsk.ask({
    questions: [{
      id: String(request.requestId),
      question: request.question,
      ...(options === undefined ? {} : { options }),
      ...(request.multiple === undefined ? {} : { multiSelect: request.multiple }),
    }],
    ...(signal === undefined ? {} : { signal }),
    ...(sessionId === undefined ? {} : { sessionId }),
  })
  const item = result.answers[0]
  if (item === undefined) return { answers: [] }
  hostAsk.appendToolEvents?.(sessionId, [{ type: ANTIGRAVITY_USER_QUESTION_ANSWER, data: {
    requestId: String(request.requestId), question: request.question, selected: [...item.selected],
    ...(item.custom === undefined ? {} : { custom: item.custom }),
  } }])
  if (item.custom !== undefined && item.custom.length > 0) return { answers: [...item.selected, item.custom], custom: item.custom }
  return { answers: item.selected }
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
