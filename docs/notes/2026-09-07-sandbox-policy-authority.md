# Sandbox policy from the authoritative service, never message text

Native permission mode and workspace root resolve per stream call through
`ctx.sandboxPolicy` for the exact session (`BridgeHost.resolvePolicy`).
User and tool text cannot select policy: text markers (`danger-full-access`,
`workspace-write`, `read-only`) and forged `session workspace:` lines are
ignored, so the previous `permissionModeFromMessages` / `workspaceRootFromMessages`
scanners are deleted. Missing service, unresolvable session, failed reads, and
unknown shapes fail closed to approval-required with no workspace root.
Ask routing attaches the exact session agent; the first-root fallback is removed.

Regression checks: `tests/llm-bridge.test.ts` (hostile flags, prompt-not-allow,
policy change on a reused session, unknown-context fail-closed).

Native permissions ask the canonical approval service (`ctx.approval.request`
with the exact session agent; `BridgeHost.requestApproval`). The service
enforces session approval policy (including `never`) and audits itself, so the
generic `userQuestions.ask` bypass is gone; it stays for plan review and
user-input questions. Only `allowed-once` grants native `allow_once`; every
other outcome denies, and a missing service or session cancels. No native tool
id is ever passed as the Core call id. Full-access keeps its existing
no-escalation auto-allow.

Regression checks: `tests/llm-bridge.test.ts` (canonical ask routing,
no-escalation mapping, missing-callback cancel), `tests/dsh-plugin.test.ts`
(exact agent without call id, missing service/session cancel, reject without
generic ask).
