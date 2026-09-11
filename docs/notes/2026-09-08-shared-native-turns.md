# Shared native turns

The DSH LLM adapter and the provider registry use one native-turn runner. It owns per-conversation serialization, provider generation checks, persistence-before-prompt, model selection, authorization, cancellation and quiescent disposal. Antigravity owns ACP transport, profile/workspace cursor validation, model/mode translation and native event decoding. The native activity store remains independent of Core history.

A failed or cancelled transport is released without replaying the prompt. Its retained cursor is used for the next explicit turn. Unknown or unavailable native context fails closed; it cannot be reconstructed from the bridge’s latest-prompt-only projection. Native failures use an error terminal, and the adapter has no automatic retry budget.

The shared event declaration includes trajectory ownership, missing-name semantics and usage fields. Vendor metadata is validated before entering it. Existing wall-clock turn association remains a display-only heuristic because the current LLM interface has no DSH turn identifier; unassigned activity must not be assigned a fabricated identity.

The paired-source check verifies the declared provider exports in both TypeScript faces and keyless tests. A coordinated release must publish the provider changes and update the Antigravity archive pin together; no live deployment is part of this change.
