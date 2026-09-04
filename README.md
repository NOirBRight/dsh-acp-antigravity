# @deepseek-ai/dsh-acp-antigravity

Google Antigravity ACP provider for DeepSeek Harness.

This package adapts the official @agentclientprotocol/sdk to the provider-neutral contracts in @deepseek-ai/dsh-acp-provider. Antigravity owns native sessions, model discovery, ACP tool execution, OAuth transport, and native permission prompts; DSH receives bounded activity events and supplies interaction and filesystem callbacks.

## Install and verify

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## Configuration

Configure the Antigravity ACP executable, its sibling localharness_external executable, and an isolated state directory. The provider does not search for alternate binaries or reuse ambient profiles.

```ts
import { AntigravityProvider } from "@deepseek-ai/dsh-acp-antigravity"
import { ExternalAgentProviderRegistry } from "@deepseek-ai/dsh-acp-provider"

const provider = new AntigravityProvider({
  executablePath: '/opt/antigravity/agy_acp_server',
  harnessPath: '/opt/antigravity/localharness_external',
  stateDirectory: '/var/lib/dsh/antigravity',
  instanceId: 'default',
  cancelGraceMs: 500,
})
const registry = new ExternalAgentProviderRegistry()
const unregister = registry.register(provider)
const models = await provider.listModels()
await unregister()
```

Installation paths are explicit. On Linux the launch uses the provider-required --uid= argument; Windows accepts drive-letter and UNC working directories. cancelGraceMs controls the validated delay between native cancellation and process termination.

## Authentication and Settings

Authentication uses personal Google OAuth through the ACP server. OAuth data is stored in a profile derived from stateDirectory and instanceId; credentials and authorization codes are not returned in health or Settings snapshots.

Use createAntigravitySettingsEditor() to expose installation validation, negotiated ACP version, model refresh, sign-in, and sign-out through the generic Settings editor. The editor reports installation, authentication, liveness, and readiness separately; session startup fails before session creation when authentication cannot be verified.

## Session behavior

- The provider accepts approval-required, auto-accept-edits, and full-access modes and applies the native mode before each prompt.
- The provider registry confirms and audits full access once before ACP startup.
- Native permission option IDs are preserved exactly; allow_always is accepted only with a native session or thread scope.
- Native tool activity is published as activity and is never re-executed by DSH. Malformed updates fail and cancel the active turn without exposing their raw payload.
- Assistant deltas and their accumulated turn result are bounded by maxEventTextBytes; provider failure text remains a failed result even when ACP returns end_turn.
- ACP cancellation sends session/cancel, then closes the transport if the process does not quiesce within the bounded escalation window. Session close and transport-failure teardown use the same bound.
- DSH-owned filesystem roots are forwarded to ACP as additional directories. Read and write requests use the host filesystem adapter and its required operation-aware path resolver; host terminal methods are not exposed. The Settings warning states that Antigravity's native terminal may still reach paths outside these roots.

## Host composition

installAntigravityProvider() mounts the provider in an external-agent registry and optionally mounts its Settings editor. The package is usable with a host implementing those registry interfaces; the DSH checkout currently lacks the primary external-agent turn-driver and session-event hooks required for in-tree mounting.

The provider does not start a replacement DSH server and does not claim that an out-of-tree registry adapter is a complete DSH integration.
