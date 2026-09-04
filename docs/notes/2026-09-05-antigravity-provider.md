# Agent Note: Antigravity ACP provider

## Decision

The Antigravity provider implements the provider-neutral External Agent contract with the official @agentclientprotocol/sdk. Each configured instance owns an executable pair, isolated OAuth profile, ACP connections, native sessions, model selection, permission mode, per-session filesystem adapter, and quiescent disposal.

## Security and ownership

Installation and identity checks fail before a session is exposed. Personal Google OAuth uses the instance profile; credential-like environment values, authorization codes, raw stderr, symlinked profile files, and private ACP metadata stay out of public health and interaction payloads. Full access requires confirmation and a value-free audit callback before process startup.

ACP owns tool execution and native history. The provider publishes normalized, bounded activity, preserves native permission option IDs, maps interaction-prefixed native prompts to user questions, sends session/cancel on abort, and closes the wire when cancellation does not quiesce within the bounded escalation window. DSH-owned filesystem handlers remain responsible for path policy and terminal denial.

## Alternatives considered

- Reusing a shared Google profile would mix credentials and native history between configured instances.
- Reconstructing permission choices from DSH logs would lose native option identity and scope.
- Implementing filesystem policy inside the provider would duplicate host-owned symlink and workspace rules.
- Starting an ACP process with shell lookup or inherited environment would allow an unintended executable or ambient credential to be selected.

## Integration limit

installAntigravityProvider() targets a host exposing the external-agent registry and Settings editor registries. The current DSH checkout lacks the primary external-agent turn-driver and session-event hooks, so this package does not claim a complete in-tree mount.

## Verification

Provider tests cover identity and model validation, mode mapping, permission option preservation, OAuth profile isolation, installation paths, filesystem mediation, cancellation, and provider disposal. Typecheck and declaration build cover the official ACP SDK integration.
