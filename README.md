# @deepseek-ai/dsh-acp-antigravity

Google Antigravity ACP provider for DeepSeek Harness.

This package adapts the official @agentclientprotocol/sdk to the provider-neutral contracts in @deepseek-ai/dsh-acp-provider. Antigravity owns native sessions, model discovery, ACP tool execution, OAuth transport, and native permission prompts; DSH receives bounded activity events and supplies interaction and filesystem callbacks.

## Install and verify

Install every required package in one command. `dsh-acp-provider` is a profile dependency with no bundle of its own; omitting it leaves Antigravity unable to load. Native tool rows render through the plugin-owned read-only card; no unofficial ui-tool build is required. Model Switch owns the composer picker and runtime lock used with Antigravity.

```sh
dsh plugin --profile web add --force \
  https://github.com/NOirBRight/dsh-llm-providers-ui/releases/latest/download/dsh-llm-providers-ui.tgz \
  https://github.com/NOirBRight/dsh-acp-provider/releases/latest/download/deepseek-ai-dsh-acp-provider.tgz \
  https://github.com/NOirBRight/dsh-model-switch/releases/latest/download/dsh-model-switch.tgz \
  https://github.com/NOirBRight/dsh-acp-antigravity/releases/latest/download/deepseek-ai-dsh-acp-antigravity.tgz
dsh plugin --profile web list
```

Then open Settings → Antigravity → Install. That downloads the pinned Google ACP zip, verifies SHA-256, and extracts `agy_acp_server.par` plus `localharness_external` (Windows: `.exe`). Linux and Windows use the stock binaries as shipped. The plugin tarball does not ship Google binaries and does not patch them. Point the card at an existing pair if you already have one.

Restart the Web profile after installation. Sign in with personal Google OAuth on the Antigravity card.

For source verification with the published dependency pins:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
```

## Native token telemetry

[ACP-only evidence](docs/acp-usage-evidence.md): the authorized 3082 runtime combines usage forwarding with UI metadata. Raw and SDK-decoded counts match, and the existing adapter displays them without parser, Core, or quota changes. The UI-only baseline has no token counts.

The adapter retains provider-reported reasoning, cache and total counters. DSH output includes reasoning exactly once; input excludes separately reported cache reads and writes. When ACP reports thought tokens separately, its total must establish whether output already includes them. Incomplete, unsafe or inconsistent samples are omitted, not estimated from text or filled with zeros.

The pinned `agy_acp_server_20260818_01_RC01` SDK has real turn usage, but its stock ACP server does not return it. The opt-in source patch in `scripts/agy-usage-forwarding.patch` forwards complete final-turn counters. Building this plugin alone does not enable native telemetry; a native runtime that emits usage is also required. Cancellation can retain observations delivered while the prompt was active; unreceived counters and spans remain missing. The optional runtime builder applies the patch and regenerates the bundled checked-hash `server.cpython-314.pyc` with a matching Python 3.14 compiler. It preserves the ELF executable and ZIP layout, updates the payload-size metadata, and refuses existing output paths. The rebuilt ACP server still needs compatible `localharness_external` and normal authentication; the builder does not configure a profile or replace a runtime.

Validate the patch against the pinned archive without running a model or modifying the archive:

```sh
python3 scripts/check-agy-usage-patch.py --par /path/to/agy_acp_server.par
python3 scripts/build-agy-usage-runtime.py --par /path/to/agy_acp_server.par --out /new/path/agy_acp_server.par
```

The rebuild needs Python stdlib, the system `patch` command, and temporary disk space for the archive. A compiler round-trip must reproduce the original bytecode before it writes the new executable. Loader verification uses an isolated `--sentinel` build and a clean `--help` comparison; this does not verify live model usage or activate the result in DSH.

Native telemetry derives ACP aggregate usage from cumulative SDK snapshots around the completed native chat attempt. SDK prompt and total exclude cache; ACP `inputTokens` and `totalTokens` add the cache counter so the existing adapter can subtract `cachedReadTokens`. A missing cache counter cannot form that aggregate and omits usage; it is not treated as zero. Only a newly created native session establishes a zero baseline; a missing baseline after restore, missing end counters, and counter rewinds do not establish usage. Explicit zeros stay zero. Cache may exceed uncached prompt. Raw SDK snapshots are forwarded as `agy.usageSnapshots`; they remain distinct from raw upstream counters. Child-owned text (`parentTrajectoryId` set and different from `trajectoryId`) is stored on the sidecar and rendered in the child panel, not appended to the parent assistant stream.

`scripts/agy-request-telemetry.patch` measures each CCPA upstream call through response-body completion and forwards its last raw `usageMetadata` with a request ID, model, completion status and monotonic duration in `agy.requestTelemetry`. Association is native-session scoped, not child-agent attribution. Completed requests and changed live SDK counters are sent as metadata-only `session_info_update` notifications before the prompt returns. The bridge persists this evidence and emits provisional `usageComplete: false` reports, replacing same-attempt values rather than summing updates. A successful final report clears partiality only when its accounting is complete; unknown SDK cache preserves known uncached input/output but omits cache and total. Hosts must support the completeness flag before enabling progressive reporting. `requestThroughput` sums output tokens, including thoughts exactly once, and durations from matched completed requests with usable counters. Concurrent durations sum; prefill, first-token wait and streaming proxy overhead are included, while tool waits between calls are excluded. Missing counters are not filled with zero. SDK-reported cache counts and an omitted upstream cache field remain separately inspectable.

`generationElapsedMs` stays `null`: request throughput is not pure decode speed. Hosts display the separately labelled Request throughput rather than deriving it from whole-turn wall time or subtracting tools from assistant text spans. The native telemetry check (`python3 scripts/check-agy-request-telemetry.py --par <ownership-enabled-runtime.par>`) applies both telemetry patches to an isolated copy and exercises their actual wrappers without model calls. To build both, pass their concatenated patch to the runtime builder with `--patch`; enabling the plugin alone does not instrument the native binary.

Older activity readers reject the additional evidence record types. Back up session and activity histories before enabling telemetry; a downgrade must restore compatible histories while retaining newer histories separately, not discard their evidence.

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
  modelDiscoveryTimeoutMs: 30_000,
})
const registry = new ExternalAgentProviderRegistry()
const unregister = registry.register(provider)
const models = await provider.listModels()
await unregister()
```

Installation paths are explicit. On Linux the launch uses the provider-required --uid= argument; Windows accepts drive-letter and UNC working directories. cancelGraceMs controls the validated delay between native cancellation and process termination; it and both event byte limits must be positive safe integers.

`modelDiscoveryTimeoutMs` bounds native initialization, OAuth and model discovery together; it defaults to 30,000 ms and accepts integers from 1 through 4,294,967,295. This startup budget is independent of request-throughput measurements. Ordinary Settings edits preserve an explicitly configured timeout.

## Authentication and Settings

Authentication uses personal Google OAuth through the ACP server. OAuth data is stored in a profile derived from stateDirectory and instanceId; credentials and authorization codes are not returned in health or Settings snapshots.

Use createAntigravitySettingsEditor() to expose installation validation, negotiated ACP version, model refresh, sign-in, and sign-out through the generic Settings editor. The editor reports installation, authentication, liveness, and readiness separately; session startup fails before session creation when authentication cannot be verified.

## Native turn lifecycle

The bridge uses the shared ExternalAgentTurnRunner and the same provider registry as Settings. Model and permission mode are selected on every native turn; there is no extra configure method outside the session interface. Provider replacement and sign-out await runner reset, and session/disposed releases only that conversation. Prepared calls reject a changed provider generation. Native failures produce an error terminal, and automatic retries are disabled because native tools may already have run.

Ready records persist the native reference before prompting. Resume cursors are bound to the private profile and workspace. Legacy ready-only history remains readable, but continuing it requires a new DSH session; failed resume never falls back to a context-free native session. Full-access uses the resolved DSH policy as explicit authority and records an audit before native execution. Ordinary native permission requests still use the canonical approval path.

## Paired provider development

Normal builds use the published provider and UI artifact pins. To develop a later shared-provider change before publication, check both source trees explicitly without changing installed dependencies:

```sh
pnpm run check:provider -- /absolute/path/to/dsh-acp-provider
```

The command checks each TypeScript face and runs keyless tests against only the provider package’s published exports. It does not launch the native executable or modify the running DSH GUI. Release verification uses a clean frozen-lockfile installation and built host/client smoke without this source override.

## Session behavior

- Native turns start only on a blank DSH session or a session already bound by a saved ready record. Existing DSH history cannot convert onto Antigravity (`ACTIVITY_HISTORY_LOCKED`), including a prior non-native `request/header` whose response produced no assistant token. The current first native header remains allowed; unavailable canonical history blocks unbound native execution.
- The provider requires negotiated native resume support, accepts approval-required, auto-accept-edits, and full-access modes, and applies the native mode before each prompt.
- The provider registry confirms and audits full access once before ACP startup.
- Native permission option IDs are preserved exactly; allow_always is accepted only with a native session or thread scope.
- Native tool activity is published as activity and is never re-executed by DSH. Malformed updates fail and cancel the active turn without exposing their raw payload.
- Native tool rows render through the plugin-owned read-only card as read-only presentation: presentation-only blocks, never a durable DSH tool-call event or execution, with no file-open or inspect affordance; unknown names stay verbatim with their data preserved. The metadata-only runtime forwards actual SDK call names as `agy.toolName`; these take precedence over human-readable command titles. Later names replace permission-preview labels; omitted names preserve the known identity. Both `CommandLine` and `command_line` map to the canonical command argument.
- Rows group by native runtime epoch and validated trajectory ownership; `agent-observed` descriptors cover zero-tool children, unowned pending previews remain in the approval UI, whose reason includes native input fields within the configured interaction bounds, until execution metadata arrives, other rows without ownership stay flat, and conflicting or cyclic ancestry keeps agent containers at safe roots without guessing a parent, and child groups start collapsed. No child lifecycle is fabricated: a launch row never claims its child outcome.
- Assistant deltas and their accumulated turn result are bounded by maxEventTextBytes; provider failure text remains a failed result even when ACP returns end_turn.
- ACP cancellation sends session/cancel, then closes the transport if the process does not quiesce within the bounded escalation window. Session close and transport-failure teardown use the same bound.
- Filesystem mediation is enabled only when the individual session opts in. DSH-owned filesystem roots are forwarded to ACP as additional directories. Read and write requests use the host filesystem adapter and its required operation-aware path resolver; host terminal methods are not exposed. The Settings warning states that Antigravity's native terminal may still reach paths outside these roots.

## Host composition

A DSH web profile loads this package as a bundle. The host plugin registers RPC; the `./client` entry contributes the Antigravity card to `settings.provider.item`, registers its Provider Directory role as Agent, and adds no conversation tabs. The official Chat and Trajectory views remain unchanged. ACP tool activity is stored in plugin-owned history, never as a durable DSH tool-call event or execution, nor as assistant transcript text. Install Antigravity downloads the pinned Google ACP zip, verifies SHA-256, and extracts `agy_acp_server.par` plus `localharness_external` into a DSH-managed directory. Linux and Windows use the stock binaries. The card can also locate an existing pair, sign in with personal Google OAuth, and refresh account-visible models. The plugin does not ship Google binaries or an unverified brand mark. The client build bundles shared-library values rather than treating them as browser plugins, and its build check rejects non-platform external imports. Stock `@deepseek-ai/dsh-client-ui-tool` 0.1.2-rc.1 lacks the public card export; the installation command above includes the published 0.1.2-rc.1-native.1 compatibility artifact. This is the supported artifact combination, rather than an implicit local patch.

installAntigravityProvider() remains the library mount for hosts that own their own registry. The LLM bridge supports native turns, permission prompts, cancellation and resume. Reading saved history does not require native execution; continuing a native turn still requires the runtime and authentication.

### Native history storage

Startup and tool activity records live under `$DSH_HOME/plugin-data/antigravity/history`, independently of native binaries, account profiles and DSH session logs. Session identifiers select hashed filenames; records carry a schema version and sequence. Files are private, symlinks are rejected, and malformed or incomplete histories fail without being rewritten. One writer owns each history root; appends currently read the session file to determine its next sequence.

Native startup is reusable only after its ready record is saved. Failed startup persistence disposes the new native session; startup, tool-persistence and execution failures propagate as failed turns rather than successful assistant text. The host does not append these custom records to Core. Existing DSH logs containing unmarked `antigravity/*` events remain unreadable on rc1 and are not rewritten. Saved native tool details remain available through the authenticated `activity/read` RPC; this plugin provides no conversation tab for displaying them. The 3082 lab verifies saved prompt/reply and activity replay after Host restart, including executable absence; basic conversation history also remains readable with the native plugin disabled. The lab also verifies a durable `ACTIVITY_BINDING_REJECTED` turn for a forced non-native route, successful native continuation after restoration, and a completed DeepSeek-parent/Antigravity-child subagent (foreground one-shot). No background continuable coverage is claimed. Lab and production share this release; 3082 remains the isolated verification plane. Account quota and settings can be exercised independently.

`pnpm exec vitest run tests/activity-store.test.ts tests/activity-host.test.ts tests/activity-binding.test.ts` checks on-disk restoration, isolation from Core event writes, and execution-time provider checks without starting Antigravity. [ADR 0002](docs/adr/0002-plugin-owned-native-history.md) records ownership and display boundaries.

Deploy the built package without its development `node_modules`, beneath the profile’s normal peer-resolution hierarchy. A worktree link with its own `dsh-llm` copy shadows the Host SDK and breaks request-marker identity. Run `node scripts/check-sdk-identity.mjs <host-directory> <profile-directory>` against the actual installed profile before treating the guard as active. Never patch SDK markers or Core module resolution.

## Native usage accounting

The LLM bridge forwards only complete provider-reported token counters; missing usage is unavailable, not a character-count estimate or zero. Native tool execution and permission waits occur inside the ACP model turn, so the standard Harness elapsed-time/TPS readout is not an isolated model decoding benchmark. Native subagent launch completion does not establish child-task completion; child lifecycle details require explicit provider events.

## Account quota decision

[ADR 0003](docs/adr/0003-cli-free-account-quota.md) records the verified CLI-free personal-OAuth quota path and its security requirements. The Host quota reader (`createAntigravityQuotaReader`) supplies the sanitized `quota` RPC endpoint consumed by the settings card and Provider Usage panel.

## Real-binary smoke

Set `ANTIGRAVITY_ACP_EXECUTABLE` and `ANTIGRAVITY_HARNESS_EXECUTABLE`, then run `pnpm exec vitest run tests/real-binary.test.ts`. The initialize-only smoke validates the user-provided executable pair without authentication or a model request. Also set `ANTIGRAVITY_AUTHENTICATED_STATE_DIRECTORY` and `ANTIGRAVITY_AUTHENTICATED_INSTANCE_ID` to run the opt-in read-only turn, cancellation, and resume smoke against that isolated authenticated profile. Each smoke skips when its inputs are absent and neither runs in ordinary unit gates. The 3082 live suite verifies metadata-backed canonical Bash rendering, child-only tool placement, keyboard disclosure, zero-tool containers, and refresh. Keyless assembled replay covers nested/read/Bash/empty cases; the native turn reports nesting depth 1, so real grandchild execution is not claimed.

## Plan review

The adapter reads the exact session’s logged `sessionProjections.stateOf(agent.session, 'plan').active` flag before reviewing a completed native response. Tool availability, Markdown headings, `plan.md`, `Proceed`, and ACP plan updates never activate review. Missing plan projection or session means no review; state-read errors propagate. An explicitly active Plan session retains its review card and approved native continuation. See [Plan mode authority](docs/notes/2026-09-09-plan-mode-authority.md).

## Native question answers

Free-text Other answers require the paired native `agy-user-question.patch` and adapter. `build-agy-usage-runtime.py --question-patch` rebuilds both server and hook source/bytecode. The question-only metadata extension preserves literal text without inventing permission options; unsupported native runtimes reject custom answers. See [native question delivery](docs/notes/2026-09-09-native-question-freeform.md) for the wire and keyless GUI check.

## Provider settings integration

The browser card uses `dsh-llm-providers-ui/provider-ui` for its monochrome Agent header and segmented account-quota meters. ACP owns authentication and model capabilities. The card presents verified installation, login, then account/quota/model state; executable and harness paths remain backend configuration rather than ordinary card controls. Live status refreshes preserve unsaved configuration edits. Logout, account change and entitlement loss clear the displayed quota; transport errors retain a visibly stale last-successful snapshot.

`pnpm run typecheck` checks both Host and browser faces (`tsconfig.web.json`). `tests/settings-ui.test.ts` covers draft preservation and usage-directory mapping. `tests/live-quota.test.ts` is an opt-in read-only Google quota smoke using an existing isolated ACP profile.

Source manifests pin immutable shared-package URLs and lockfile integrity. Validate candidate artifacts on the existing 3082 lab; production promotion requires completed review, clean installation from published URLs, preserved profile data, and verified rollback readiness.
