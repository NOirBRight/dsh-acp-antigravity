/** Browser half: External Agents page inside Settings. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  ACP_SETTINGS_RPC_CHANNEL,
  PICK_ENDPOINT,
  RUN_ENDPOINT,
  SAVE_ENDPOINT,
  SNAPSHOT_ENDPOINT,
  decodeSnapshot,
  type AcpSettingsRow,
} from '../client-contract.ts'
import { ExternalAgentsSection, type AcpSettingsFace } from './ExternalAgentsSection.tsx'
import { en, zh, type AcpSettingsKey } from './locales.ts'

type ClientContext = Omit<Context, 'connection'> & { readonly connection: ConnectionHandle }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.external-agents': AcpSettingsKey
  }
}

export const name = 'dsh-acp-antigravity-client'
export const inject = ['slots', 'locale', 'connection']

function installProviderDirectory(ctx: ClientContext): void {
  let directory: { register(entry: { key: string; role: 'agent' }): () => void } | undefined
  try {
    directory = ctx.get('providerDirectory', false) as typeof directory
  } catch {
    return
  }
  if (directory !== undefined) ctx.effect(() => directory.register({ key: 'antigravity', role: 'agent' }), 'dsh-acp-antigravity: provider directory registration')
}

export function apply(ctx: ClientContext): void {
  installProviderDirectory(ctx)
  const localeNamespace = 'settings.external-agents'
  ctx.effect(() => ctx.locale.register(localeNamespace, { zh, en }), 'dsh-acp-antigravity: Settings page copy')
  const t = ctx.locale.bind(localeNamespace) as AcpSettingsFace['t']
  const { rpc } = ctx.connection
  const load: AcpSettingsFace['load'] = async () => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SNAPSHOT_ENDPOINT, {}, undefined)
    if (!result.ok) throw new Error(result.error.message)
    const decoded = decodeSnapshot(result.value)
    if (decoded === undefined) throw new Error(t('failed'))
    return decoded
  }
  const save: AcpSettingsFace['save'] = async (row: AcpSettingsRow) => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SAVE_ENDPOINT, {
      executablePath: row.executablePath,
      harnessPath: row.harnessPath,
      stateDirectory: row.stateDirectory,
      instanceId: row.instanceId,
      ...(row.model === undefined ? {} : { model: row.model }),
      enabled: row.enabled,
    }, undefined)
    if (!result.ok) throw new Error(result.error.message)
  }
  const run: AcpSettingsFace['run'] = async (action, value) => {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, RUN_ENDPOINT, { action, ...(value === undefined ? {} : { value }) }, undefined)
    if (!result.ok) throw new Error(result.error.message)
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
    inject: (): AcpSettingsFace => ({ t, load, save, run, pick }),
  }, ExternalAgentsSection))
  ctx.effect(() => {
    let warned = false
    const check = (): void => {
      const hasProviders = ctx.slots.entries('settings.section').some(entry => entry.options.id === 'providers')
      if (!hasProviders && !warned) {
        warned = true
        console.warn('[dsh-acp-antigravity] LLM Providers page missing; install dsh-llm-providers-ui to show the Antigravity card.')
      }
    }
    const timer = setTimeout(check, 0)
    const stop = ctx.slots.subscribe('settings.section', check)
    return () => { clearTimeout(timer); stop() }
  }, 'dsh-acp-antigravity: providers page diagnostic')
}
