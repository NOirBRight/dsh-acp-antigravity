# External Agent on DSH

Antigravity (and later native agents) sit on DSH as an LLM adapter. DSH loop and picker stay; tools, plan, and permission belong to the native agent unless this glossary says otherwise.

Provider directory, role badge, and quota are defined in `dsh-llm-providers-ui` CONTEXT.md.

## Language

**Vendor**:
The product brand (Google, Cursor, OpenAI). One vendor may ship both an LLM route and a native agent.
_Avoid_: Provider, Runtime, Platform

**LLM route**:
DSH generates tokens; DSH owns tools and history. Used whenever the product can speak as a token API.
_Avoid_: Provider (overloaded with DSH route keys), Plugin

**Native agent**:
The foreign runtime owns the turn, tools, and subprocess (ACP). Used only when there is no LLM route, or that LLM route is retired (Cursor Agent replaces Cursor LLM).
_Avoid_: External Agent as a Settings tab name, Wrapper, Proxy

**Native turn**:
One prompt and its resulting native execution, with a completed, cancelled, or failed outcome. An approved DSH plan can continue as another native turn.
_Avoid_: Token request, DSH turn

**Native binding**:
The association between a DSH conversation and its native conversation. Its resume cursor identifies the native context; a ready record alone does not guarantee that context can be resumed.
_Avoid_: Ready flag, cached connection

**Runtime**:
Which of LLM route or native agent is running this DSH session. Shown as a group icon in Model Switch, not a third sidebar.
_Avoid_: Provider, Engine, Backend

**Runtime lock**:
After the first successful ACP open in a DSH session, other Model Switch groups are disabled (composer picker and DSH subagent route in Model Switch). Models and High/Low inside Antigravity stay allowed. A failed turn keeps the lock. A new DSH session unlocks. This does not constrain the native agent's own subagent picker.
_Avoid_: Per-turn lock, hide groups, locking ACP nested agents

**Enabled catalog**:
The subset of upstream models the user adds on the Provider card, plus visibility, thinking levels, and default thinking level. Those fields are filled from the vendor catalog; the user does not retype ids. Model Switch lists this catalog. It is not a per-session default model.
_Avoid_: Session default model, manual model id list

**Skill file**:
A DSH markdown instruction. Sent to a native agent only when the user invokes that skill, as extra prompt text, not as a dumped catalog.
_Avoid_: ACP tool, System prompt

**DSH Plan mode**:
A DSH session flag plus Plan-review questions (`intent: plan-review`). Native agents never call `exit_plan_mode`; the adapter asks the same review card, then continues ACP with an execute prompt.
_Avoid_: ACP plan-update (different event), Plan canvas

**ACP Plan**:
A native `plan-update` list. Displayed as transcript text; it is not DSH Plan mode.
_Avoid_: exit_plan_mode, DSH plan card

**Elicitation**:
A native protocol ask (permission or questions API) that can become a DSH question card. Markdown questions in assistant text are not elicitation.
_Avoid_: Grill card, ask_user_question (DSH tool the native agent does not have)

**DSH subagent (parent → EA)**:
A DSH parent loop starts a child whose selected model is Antigravity. The child is a new DSH session using the Antigravity LLM adapter (new ACP session). Model Switch's DSH subagent policy can pick it. An Antigravity parent does not call DSH subagent tools; ACP nested agents stay ACP's.
_Avoid_: ACP nested agent as DSH subagent, delegate RPC

**ACP tool row**:
Persisted plugin-owned native tool activity, readable via the authenticated `activity/read` RPC; never a DSH `tool-call` block (the loop would execute it) and never a conversation tab (official Chat/Trajectory unchanged).
_Avoid_: Markdown dump, fake DSH tool

**Vendor mark**:
The official Antigravity logomark, colored with the theme (`currentColor`). Used on the card, Model Switch, and Provider Usage tile.
_Avoid_: Sparkle/star placeholder, PNG invert as the long-term asset
