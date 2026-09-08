# DSH session events vs Antigravity native activity

Throwaway research for prototype A. Sources: `packages/core/session/src/types.ts`, `packages/llm/llm/src/types.ts`, `dsh-acp-antigravity/src/tool-events.ts`, `llm-bridge.ts`.

## DSH (what the GUI ToolRow / Think actually consume)

Wire is the session log, projected to the browser as mux frames. One event:

```
{ type, time, seq, data, ignorable? }
```

Relevant types (SessionEventMap):

| type | data | UI |
|---|---|---|
| `step/start` | `{ turn, step }` | starts decode/TTFT clock |
| `assistant/chunk` | `{ turn, step, chunk: StreamChunk }` | live text / Think |
| `assistant/message` | `{ turn, step, message, usage? }` | settles assistant; `usage.outputTokens` feeds tok/s |
| `tool/call` | `{ turn, step, callId, name, arguments }` | ToolRow title from `name` (`read`→Read, `bash`→Bash, `glob`→Search). Summary from parsed `arguments` JSON. |
| `tool/result` | `{ turn, step, message, error?, meta? }` | settles ToolRow; `meta` is tool-private card payload (diff/read/terminal) |

StreamChunk (inside `assistant/chunk`):

- `block-start { index, blockType: 'text' \| 'reasoning' \| ... }`
- `text-delta { index, text }`
- `reasoning-delta { index, text }` → **Think** row (`ReasoningRow`: title `Think`, summary = first line, or latest line while streaming)
- `tool-call-delta { index, id, name?, argumentsDelta }` → still a DSH tool (loop will execute it)
- `usage { usage: { inputTokens, outputTokens, ... } }`
- `finish`

Think is **not** a tool. It is reasoning content on the assistant message.

ToolRow chrome (DisclosureRow): 24px row, 16px leading (icon 14px inside), gap 6, title 14/24 secondary, 2×2 caption dot, summary tertiary ellipsis. Hover: `.iconIdle {opacity:0}` / `.chevronHover {opacity:1}` 100ms. Open: leading is chevron only.

## Antigravity (what 3080 actually stores today)

Native tools **must not** become DSH `tool/call` (ADR 0002: the loop would execute them). They go to plugin JSONL:

`$DSH_HOME/plugin-data/antigravity/history/<sha256(sessionId)>.jsonl`

Line: `{ v: 1, seq, time, type, data }`

| type | data | UI today |
|---|---|---|
| `antigravity/session-ready` | `{ provider: 'antigravity' }` | runtime lock |
| `antigravity/tool-start` | `{ toolId, name, status, location?, input? }` | green-dot row, `name` is ACP title e.g. `"Running view file"` |
| `antigravity/tool-update` | `{ toolId, status, location?, input?, output?, error? }` | same row, still ACP title |

`name` is **not** a DSH tool id. `toolName()` prefers `input.CommandLine`, else `activity.name.replace(/[_-]/g, ' ')` — that is why the transcript says "Running view file" instead of `Read · path`.

Thoughts **do** cross the DSH stream: `thought-delta` → llm-bridge yields `block-start reasoning` + `reasoning-delta`. Think rows can already be Core. Tools cannot.

## Mapping needed for prototype A (render-only, still no Core tool/call)

| ACP title / kind | DSH title | icon (ui-primitives) | summary |
|---|---|---|---|
| view file / read | Read | `IconBrowseOutline16` 14 | path (`AbsolutePath` / `file_path`) |
| search directory / glob / grep | Search | `IconSearchOutline16` 14 | pattern / glob |
| terminal / bash / CommandLine | Bash | `IconApiOutline14` 14 | command |
| start subagent | Task (others) | `IconSparkle16` 14 | prompt / child label |
| thought-delta | Think | `IconThinkOutline14` 14 | first line (settled) / latest line (running) |
| unknown | Tool call | sparkle | raw name |

Subagent children stay sidecar rows, **nested under the Task row**, never flattened. No extra card chrome.

## Why tok/s cannot be fixed by emitting fake `tool/call`

`decodeMs = assistant/message.time − firstTokenTime`. Native tools run **inside** `stream()`, so they sit between first `reasoning-delta`/`text-delta` and `assistant/message`. Logging synthetic `tool/call` would raise `toolMs` but **would not shrink decodeMs**. Clock must pause on `antigravity/tool-start` and resume on next assistant delta / tool completed.
