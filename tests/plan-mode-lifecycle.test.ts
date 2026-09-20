import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { mountPlugin, runtimeConfig } from './support/mount-plugin.js'

const home = mkdtempSync(join(tmpdir(), 'acp-plan-mode-lifecycle-'))
process.env.DSH_HOME = home
afterAll(() => { rmSync(home, { recursive: true, force: true }) })
const STATE_DIRECTORY = join(home, 'antigravity')
const SUPPORTED_MODES = ['approval-required', 'auto-accept-edits', 'full-access']

vi.mock('../src/activity-binding.js', () => ({ installActivityBindingGuard: vi.fn() }))
vi.mock('../src/rpc.js', () => ({ registerAcpSettingsRpc: vi.fn() }))
vi.mock('../src/plugin.js', () => ({
  installAntigravityProvider: (services: { externalAgents: { register(provider: unknown): () => void } }) => {
    let turns = 0
    const provider = {
      info: { id: 'antigravity', name: 'Antigravity' },
      health: { status: 'ready' },
      validateInstallation: async () => ({}),
      listModels: async () => [{ id: 'gemini', name: 'Gemini', supportedModes: [...SUPPORTED_MODES] }],
      openSession: async (request: { session: string }) => ({
        ref: { provider: 'antigravity', session: request.session, nativeSession: 'native-plan', resumeCursor: { provider: 'antigravity', value: '{"v":1,"nativeId":"native-plan","scope":"test"}' } },
        supportedModes: [...SUPPORTED_MODES],
        dispose: async () => undefined,
        runTurn: async () => ({ status: 'completed' as const, text: ++turns === 1 ? 'plan' : 'done' }),
      }),
    }
    services.externalAgents.register(provider)
    return { provider, dispose: async () => undefined }
  },
}))

it('commits an approved Plan exit after the Host turn becomes idle', async () => {
  const session = {}
  let openTurnStartSeq: number | null = 1
  let active = true
  let pending: boolean | undefined
  const outcomes: string[] = []
  const planMode = {
    get: () => ({ active, ...(pending === undefined ? {} : { pending }) }),
    set: (_agent: unknown, next: boolean) => {
      if (openTurnStartSeq !== null) {
        if (pending === next || (pending === undefined && active === next)) { outcomes.push('noop'); return 'noop' as const }
        pending = next
        outcomes.push('queued')
        return 'queued' as const
      }
      if (pending !== undefined) {
        if (next === active) {
          pending = undefined
          outcomes.push('cancelled')
          return 'cancelled' as const
        }
        outcomes.push('noop')
        return 'noop' as const
      }
      if (active === next) { outcomes.push('noop'); return 'noop' as const }
      active = next
      outcomes.push('committed')
      return 'committed' as const
    },
  }
  const base = runtimeConfig(STATE_DIRECTORY)
  const { adapter } = await mountPlugin(name => {
    if (name === 'agents') return { get: () => openTurnStartSeq === null ? undefined : { session, ctx: { reflect: { store: { [Symbol.for('test-plan-mode')]: { name: 'planMode', value: planMode, fiber: { state: 2 } } } } } } }
    if (name === 'sessionProjections') return { stateOf: (_session: unknown, key: string) => key === 'plan' ? { active } : key === 'turnBoundary' ? { openTurnStartSeq } : undefined }
    if (name === 'userQuestions') return { ask: async (request: { questions: { id: string }[] }) => ({ answers: [{ id: request.questions[0]!.id, selected: ['Approve'] }] }) }
    return undefined
  }, base)
  try {
    for await (const _chunk of adapter.stream({ provider: 'antigravity', model: 'gemini', sessionId: 'plan-lifecycle', messages: [{ source: { kind: 'user' }, content: 'plan' }] })) { /* drain */ }
    expect(active).toBe(true)
    openTurnStartSeq = null
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(active).toBe(false)
    expect(outcomes).toEqual(['queued', 'cancelled', 'committed'])
  } finally { await adapter.dispose() }
})
