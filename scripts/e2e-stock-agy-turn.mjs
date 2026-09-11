/** Live turn against the official unpatched ACP binary (needs AGY_E2E=1 and a logged-in profile copy source).
 *
 * Proves the stock binary boots, lists models, and completes a turn without hanging where the
 * patched builds add question handling: stock cannot emit freeform user questions (verified by
 * diffing server.py), so a turn must settle with no question round-trip. Run:
 *   AGY_E2E=1 node scripts/e2e-stock-agy-turn.mjs
 * Env: AGY_E2E_EXECUTABLE, AGY_E2E_HARNESS, AGY_E2E_STATE (copied, never mutated),
 * AGY_E2E_MODEL, AGY_E2E_PROMPT.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  createSessionModelRoute,
  optionId,
  sessionId,
  turnId,
} from '@deepseek-ai/dsh-acp-provider'
import { AntigravityProvider } from '../dist/provider.js'
import { buildAntigravityLaunchSpec } from '../dist/installation.js'
import { providerInstanceId } from '@deepseek-ai/dsh-acp-provider'

if (process.env.AGY_E2E !== '1') {
  console.log('SKIP: set AGY_E2E=1 to run the live stock-binary turn')
  process.exit(0)
}

const OFFICIAL = '/home/noirbright/.dsh/runtimes/antigravity/versions/agy_acp_server_20260818_01_RC01'
const executablePath = process.env.AGY_E2E_EXECUTABLE ?? join(OFFICIAL, 'agy_acp_server.par')
const harnessPath = process.env.AGY_E2E_HARNESS ?? join(OFFICIAL, 'localharness_external')
const stateSource = process.env.AGY_E2E_STATE ?? '/home/noirbright/.dsh-lab/profiles/web/antigravity-ui-e2e'
const model = process.env.AGY_E2E_MODEL ?? 'gemini-3.7-flash-high'
const prompt = process.env.AGY_E2E_PROMPT ?? 'Reply with exactly the word: ready'

const root = await mkdtemp(join(tmpdir(), 'agy-e2e-stock-'))
const stateDirectory = join(root, 'profile')
const workspaceRoot = join(root, 'workspace')
await cp(stateSource, stateDirectory, { recursive: true })
const { mkdir } = await import('node:fs/promises')
await mkdir(workspaceRoot, { recursive: true })

const config = { executablePath, harnessPath, stateDirectory, instanceId: providerInstanceId('default'), platform: 'linux' }
const events = []
let questions = 0
const deadline = AbortSignal.timeout(180_000)
const provider = new AntigravityProvider(config, {
  cwd: workspaceRoot,
  launchSpec: async (_config, cwd) => buildAntigravityLaunchSpec(config, cwd),
})
try {
  const models = await provider.listModels()
  assert.ok(models.length > 0, 'stock binary must advertise models')
  assert.ok(models.some(entry => String(entry.id) === model), 'stock catalog must include ' + model)
  const session = await provider.openSession({
    route: createSessionModelRoute('external-agent', 'antigravity', model),
    session: sessionId('e2e-stock-turn'),
    clientFilesystem: {
      workspaceRoot,
      workspaceRoots: [workspaceRoot],
      attachmentRoots: [],
      readTextFile: async () => '',
      writeTextFile: async () => undefined,
      resolvePath: async path => {
        if (!path.startsWith(workspaceRoot)) throw new Error('outside configured roots')
        return path
      },
    },
    permissionMode: 'approval-required',
    signal: deadline,
  })
  try {
    const result = await Promise.race([
      session.runTurn({ turn: turnId('e2e-turn'), prompt, permissionMode: 'approval-required', signal: deadline }, {
        publish: async event => { events.push(event.type) },
        requestPermission: async request => ({ kind: 'allow-once', optionId: request.options[0]?.optionId ?? optionId('fallback') }),
        requestUserInput: async request => {
          questions += 1
          return { answers: [request.options?.[0] ?? 'proceed'] }
        },
      }),
      delay(170_000).then(() => { throw new Error('stock turn timed out') }),
    ])
    assert.equal(result.status, 'completed', 'stock turn must complete, got: ' + result.status + ' ' + (result.error ?? ''))
    assert.ok(result.text.trim().length > 0, 'stock turn must answer')
    console.log(JSON.stringify({ models: models.length, status: result.status, text: result.text.slice(0, 80), events, questions }, null, 2))
    assert.equal(questions, 0, 'stock binary must not open a user-question round-trip it cannot parse')
  } finally {
    await session.dispose()
  }
} finally {
  await provider.dispose?.().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
console.log('E2E OK: official binary completes a turn with no question round-trip')
