# External Agent on DSH

Antigravity (and later native agents) sit on DSH as an LLM adapter. DSH loop and picker stay; tools, plan, and permission belong to the native agent unless this glossary says otherwise.

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

**Runtime**:
Which of LLM route or native agent is running this session. Locked after the first native-agent turn. Shown as a group icon in Model Switch, not a third sidebar.
_Avoid_: Provider, Engine, Backend

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
