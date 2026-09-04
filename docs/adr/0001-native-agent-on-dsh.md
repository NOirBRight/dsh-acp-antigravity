# Antigravity sits on DSH as a native-agent runtime

Antigravity is an LLM adapter so the official picker and Model Switch both see it. Tools, plan, and permission stay in ACP except where this glossary names a DSH card. After the first successful ACP open in a session, other Model Switch groups lock; High/Low inside Antigravity stays allowed. Native tool activity is a conversation node that copies DSH ToolRow tokens, never a DSH `tool-call` block. DSH subagent means a DSH parent whose child model is Antigravity; an Antigravity parent does not call DSH subagent tools.

**Status:** accepted

Provider directory, role badge, and quota live in `dsh-llm-providers-ui` (ADR 0001). This plugin registers on that port; it does not fork the Providers page.

## Considered

- A third Settings tab for External Agents — rejected; the card is `settings.provider.item`.
- Emit DSH `tool-call` for pixel-level tool chrome — rejected; the agent-loop would execute those calls.
- Full-access via ACP `permissionMode: full-access` — rejected; that needs the provider-registry confirmation we do not own. Danger maps to ACP `yolo` after open.
