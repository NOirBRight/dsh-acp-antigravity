# @deepseek-ai/dsh-acp-antigravity

Google Antigravity ACP provider for DeepSeek Harness.

This package adapts the official @agentclientprotocol/sdk to the provider-neutral contracts in @deepseek-ai/dsh-acp-provider. Antigravity owns native sessions, model discovery, ACP tool execution, OAuth transport, and native permission prompts; DSH receives bounded activity events and supplies interaction and filesystem callbacks.

## Install and verify

A source checkout expects dsh-acp-provider in the sibling ../dsh-acp-provider directory. Published installs satisfy it as a peer dependency.

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## Configuration

Configure the Antigravity ACP executable, its sibling localharness_external executable, and an isolated state directory. The provider does not search for alternate binaries or reuse ambient profiles. Profile clearing atomically detaches its target and rejects symbolic links, and spawned processes omit ambient credential-like environment variables.

```ts
import { AntigravityProvider } from "@deepseek-ai/dsh-acp-antigravity"
import { ExternalAgentProviderRegistry, providerInstanceId } from "@deepseek-ai/dsh-acp-provider"

const provider = new AntigravityProvider({
  executablePath: '/opt/antigravity/agy_acp_server',
  harnessPath: '/opt/antigravity/localharness_external',
  stateDirectory: '/var/lib/dsh/antigravity',
  instanceId: providerInstanceId('default'),
  cancelGraceMs: 500,
})
const registry = new ExternalAgentProviderRegistry()
const unregister = registry.register(provider)
const models = await provider.listModels()
await unregister()
```

Installation paths are explicit. On Linux the launch uses the provider-required --uid= argument; Windows accepts drive-letter and UNC working directories. cancelGraceMs controls the validated delay between native cancellation and process termination; it and both event byte limits must be positive safe integers.

## Authentication and Settings

Authentication uses personal Google OAuth through the ACP server. OAuth data is stored in a profile derived from stateDirectory and instanceId; credentials and authorization codes are not returned in health or Settings snapshots.

Use createAntigravitySettingsEditor() to expose installation validation, negotiated ACP version, model refresh, sign-in, and sign-out through the generic Settings editor. The editor reports installation, authentication, liveness, and readiness separately; session startup fails before session creation when authentication cannot be verified.

## Session behavior

- The provider requires negotiated native resume support, accepts approval-required, auto-accept-edits, and full-access modes, and applies the native mode before each prompt.
- The provider registry confirms and audits full access once before ACP startup.
- Native permission option IDs are preserved exactly; allow_always is accepted only with a native session or thread scope.
- Native tool activity is published as activity and is never re-executed by DSH. Malformed updates fail and cancel the active turn without exposing their raw payload.
- Assistant deltas and their accumulated turn result are bounded by maxEventTextBytes; provider failure text remains a failed result even when ACP returns end_turn.
- ACP cancellation sends session/cancel, then closes the transport if the process does not quiesce within the bounded escalation window. Session close and transport-failure teardown use the same bound.
- Filesystem mediation is enabled only when the individual session opts in. DSH-owned filesystem roots are forwarded to ACP as additional directories. Read and write requests use the host filesystem adapter and its required operation-aware path resolver; host terminal methods are not exposed. The Settings warning states that Antigravity's native terminal may still reach paths outside these roots.

## Host composition

A DSH web profile loads this package as a bundle. The host plugin registers RPC; the `./client` entry registers the provider Settings item and a replayable native tool row. ACP tool activity is durably recorded as `antigravity/tool-start` and `antigravity/tool-update`, never as a DSH `tool-call` block or assistant transcript text. Install Antigravity downloads the pinned Google ACP zip, verifies SHA-256, and extracts `agy_acp_server.par` plus `localharness_external` into a DSH-managed directory. The card can also locate an existing pair, sign in with personal Google OAuth, and refresh account-visible models. The plugin does not ship Google binaries.

installAntigravityProvider() remains the library mount for hosts that own their own registry. The current DSH checkout still lacks the primary external-agent turn-driver and session-event hooks, so selecting Antigravity as a primary model is not claimed.

## Real-binary smoke

Set `ANTIGRAVITY_ACP_EXECUTABLE` and `ANTIGRAVITY_HARNESS_EXECUTABLE`, then run `pnpm exec vitest run tests/real-binary.test.ts`. The initialize-only smoke validates the user-provided executable pair without authentication or a model request. Also set `ANTIGRAVITY_AUTHENTICATED_STATE_DIRECTORY` and `ANTIGRAVITY_AUTHENTICATED_INSTANCE_ID` to run the opt-in read-only turn, cancellation, and resume smoke against that isolated authenticated profile. Each smoke skips when its inputs are absent and neither runs in ordinary unit gates.
