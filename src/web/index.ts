/** Browser half: External Agents settings and Provider Directory quota. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from 'dsh-llm-providers-ui/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  ACP_SETTINGS_RPC_CHANNEL,
  PICK_ENDPOINT,
  QUOTA_ENDPOINT,
  decodeQuotaSnapshot,
  RUN_ENDPOINT,
  SAVE_ENDPOINT,
  SNAPSHOT_ENDPOINT,
  decodeSnapshot,
  type AcpSettingsRow,
} from '../client-contract.ts'
import { NativeTurnContainer } from './NativeTurnContainer.tsx'
import { nativeTurnDefinition } from './native-turn.ts'
import { ExternalAgentsSection, type AcpSettingsFace } from './ExternalAgentsSection.tsx'
import { en, zh, type AcpSettingsKey } from './locales.ts'
import { createAntigravityUsageReader } from './usage-reader.ts'
import { antigravityModelCount } from './ExternalAgentsSection.tsx'
import { catalogOverrideFlags, shouldClearQuota } from './settings-state.ts'
import { dropPersistedUsageKeys } from 'dsh-llm-providers-ui/usage-readers'

type ClientContext = Omit<Context, 'connection'> & {
  readonly connection: ConnectionHandle
  readonly uiConversation: UiConversation
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.external-agents': AcpSettingsKey
  }
}

export const name = 'dsh-acp-antigravity-client'
export const inject = ['slots', 'locale', 'connection', 'uiConversation']

/** Grace period for dsh-llm-providers-ui to register the providers settings section. */
const MISSING_OWNER_GRACE_MS = 15_000

function installProviderDirectory(ctx: ClientContext): void {
  ctx.inject(['providerDirectory'], scope => {
    const directory = scope.providerDirectory
    scope.effect(() => directory.register({
      key: 'antigravity',
      name: 'Antigravity',
      role: 'agent',
      header: 'shared',
      // The card renders the shared detail template; the settings page adds only the breadcrumb.
      detail: 'shared',
      usage: createAntigravityUsageReader(),
      modelCount: antigravityModelCount,
    }), 'dsh-acp-antigravity: provider directory registration')
  })
}

export function apply(ctx: ClientContext): void {
  installProviderDirectory(ctx)
  const localeNamespace = 'settings.external-agents'
  ctx.effect(() => ctx.locale.register(localeNamespace, { zh, en }), 'dsh-acp-antigravity: Settings page copy')
  const t = ctx.locale.bind(localeNamespace) as AcpSettingsFace['t']
  const { rpc } = ctx.connection
  const invalidateUsage = (): void => { dropPersistedUsageKeys(['antigravity']); ctx.get('providerDirectory')?.invalidateUsage('antigravity') }
  let acceptedRow: AcpSettingsRow | undefined
  const load: AcpSettingsFace['load'] = async () => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SNAPSHOT_ENDPOINT, {}, undefined)
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeSnapshot(result.value)
    if (decoded === undefined) throw new Error(t('failed'))
    if (shouldClearQuota(acceptedRow, decoded.rows[0])) invalidateUsage()
    acceptedRow = decoded.rows[0]
    return decoded
  }
  const quota: AcpSettingsFace['quota'] = async signal => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, QUOTA_ENDPOINT, {}, signal)
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeQuotaSnapshot(result.value)
    if (decoded === undefined) throw new Error(t('quotaUnavailable'))
    if (decoded.status === 'account-changed' || decoded.status === 'authentication-required' || decoded.status === 'not-entitled') invalidateUsage()
    return decoded
  }
  const save: AcpSettingsFace['save'] = async (row: AcpSettingsRow) => {
    const catalogOrder = row.models.map(model => model.id).filter(id => id.trim().length > 0)
    const catalogOverrides: Record<string, (typeof row.models)[number]> = {}
    // The last accepted snapshot is the catalog the user edited from, so a field
    // that differs from it is an edit worth persisting. Without any snapshot there
    // is nothing to compare against, so the caller's flags stand unchanged.
    const edited = acceptedRow === undefined ? undefined : new Map(acceptedRow.models.map(model => [model.id, model]))
    for (const model of row.models) {
      const flags = edited === undefined ? model.overrides : catalogOverrideFlags(model, edited.get(model.id))
      if (flags === undefined) continue
      const over: { -readonly [K in keyof (typeof row.models)[number]]?: (typeof row.models)[number][K] } = { id: model.id, name: model.name }
      if (flags.vision === true && typeof model.vision === 'boolean') over.vision = model.vision
      if (flags.thinking === true && typeof model.thinking === 'boolean') over.thinking = model.thinking
      if (flags.contextWindow === true && model.contextWindow !== undefined) over.contextWindow = model.contextWindow
      if (flags.output === true && model.maxOutputTokens !== undefined) over.maxOutputTokens = model.maxOutputTokens
      if (flags.defaultEffort === true && model.reasoning?.defaultEffort !== undefined) {
        over.reasoning = { efforts: model.reasoning.efforts, defaultEffort: model.reasoning.defaultEffort }
      }
      if (Object.keys(flags).length > 0) catalogOverrides[model.id] = { id: model.id, name: model.name, ...over }
    }
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SAVE_ENDPOINT, {
      executablePath: row.executablePath,
      harnessPath: row.harnessPath,
      stateDirectory: row.stateDirectory,
      instanceId: row.instanceId,
      ...(row.model === undefined ? {} : { model: row.model }),
      ...(row.modelDiscoveryTimeoutMs === undefined ? {} : { modelDiscoveryTimeoutMs: row.modelDiscoveryTimeoutMs }),
      enabled: row.enabled,
      catalogOrder,
      ...(Object.keys(catalogOverrides).length === 0 ? {} : { catalogOverrides }),
    }, undefined)
    if (!result.ok) throw new Error(result.error.message)
  }
  const run: AcpSettingsFace['run'] = async (action, value) => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, RUN_ENDPOINT, { action, ...(value === undefined ? {} : { value }) }, undefined)
    if (!result.ok) throw new Error(result.error.message)
    if (action === 'sign-out' || action === 'sign-in') invalidateUsage()
    return result.value
  }
  const pick: AcpSettingsFace['pick'] = async () => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, PICK_ENDPOINT, {}, undefined)
    if (!result.ok) throw new Error(result.error.message)
    const path = (result.value as { path?: string | null }).path
    return path ?? null
  }
  ctx.slots.inject('settings.provider.item', () => ctx.slots.register({
    name: 'settings.provider.item',
    key: 'antigravity',
    locale: localeNamespace,
    inject: (): AcpSettingsFace => ({ t, load, save, run, pick, quota }),
  }, ExternalAgentsSection))
  // Per-turn native container in the Chat transcript: the definition folds
  // standard turn/start+end only (no Core writes); node bodies share one
  // session-scoped sidecar subscription and partition by loaded Chat starts.
  ctx.effect(() => ctx.uiConversation.events.register(nativeTurnDefinition), 'dsh-acp-antigravity: native turn fold')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'antigravity-native',
    inject: (sessionId: string) => ({ t, conversationT: ctx.locale.bind('conversation'), rpc, sessionId: sessionId as SessionId, uiConversation: ctx.uiConversation }),
  }, NativeTurnContainer))
  ctx.effect(() => {
    let warned = false
    const hasProviders = (): boolean =>
      ctx.slots.entries('settings.section').some(entry => entry.options.id === 'providers')
    // The providers page registers its section only once the settings snapshot
    // arrives and the page is visible, so a check at mount time always warns.
    // The warning waits out the grace period and is dropped if the section appears.
    const check = (): void => {
      if (hasProviders() || warned) return
      warned = true
      console.warn('[dsh-acp-antigravity] LLM Providers page missing; install dsh-llm-providers-ui to show the Antigravity card.')
    }
    const timer = setTimeout(check, MISSING_OWNER_GRACE_MS)
    const stop = ctx.slots.subscribe('settings.section', () => {
      if (!hasProviders()) return
      warned = true
      clearTimeout(timer)
    })
    return () => { clearTimeout(timer); stop() }
  }, 'dsh-acp-antigravity: providers page diagnostic')
}
