# Antigravity sits on DSH as a native-agent runtime

Antigravity is an LLM adapter so Model Switch sees it. The Provider card copies Codex chrome (install and sign-in as one flow, quota, catalog overlay, settings overlay). The catalog overlay enables upstream models and thinking levels fetched from the vendor; it does not set the current session model. After the first successful ACP open, Model Switch locks other groups for this DSH session (including DSH subagent route). ACP's own nested-agent picker is unchanged. Tool activity is a conversation node copying DSH ToolRow tokens, never a DSH tool-call block.

Quota is the vendor remaining-percent on Provider Usage tiles, not usage-monitor token fold.

**Status:** accepted

Provider directory, role badge, and quota live in `dsh-llm-providers-ui` (ADR 0001). This plugin registers there as Agent.

## Considered

- A third Settings tab for External Agents — rejected; the card is `settings.provider.item`.
- Card overlay writes the live session model — rejected; that is Model Switch. The card owns the enabled catalog.
- Runtime lock also blocks ACP nested agents — rejected; lock is a DSH Model Switch constraint only.
- Emit DSH `tool-call` for pixel-level tool chrome — rejected; the agent-loop would execute those calls.
- Full-access via ACP `permissionMode: full-access` — rejected; Danger maps to ACP yolo after open.
- Fake quota from estimated tokens — rejected.
