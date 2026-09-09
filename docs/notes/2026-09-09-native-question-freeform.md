# Native question freeform answers

**Status:** paired native and adapter implementation; lab validation, not publication or production promotion.

The pinned native SDK has `QuestionResponse.freeform_response` and the harness copies it to `MultipleChoiceAnswer.freeform_response`. Its ACP question callback must return that response object through `hooks.py`; a non-numeric `optionId` cannot carry text because the event processor converts selected ids to indices. Both patched source files require matching checked-hash Python bytecode.

Question requests with `interaction_` tool-call ids advertise `_meta["agy.supportsFreeform"]=true`. Custom responses use `outcome: { outcome: "cancelled" }` plus `_meta["agy.freeformResponse"]`: no offered option was selected. Native reads freeform metadata before interpreting cancellation. Ordinary permission requests do not use this extension. Non-string metadata is rejected, and a custom workspace-trust answer does not grant trust.

The shared host answer retains flattened `answers` plus `custom` provenance. Nonempty Other text is not a selection even when it matches an option id or label. Empty custom fields do not replace a selection. Generic text-answer methods retain the flattened answers; native ACP questions remain single-select.

The plugin writes `antigravity/user-question-answer` to its native activity sidecar before returning the answer to ACP. The record retains the question, request id, selected labels, and exact custom text without creating a tool row or Core event. A failed write prevents delivery. An assistant echo is not a substitute for the human answer record; old logs are not backfilled from echoes.

## Checks

`python3 scripts/check-agy-user-question.py --par <pinned-unpatched-or-v8.par>` checks metadata, selection, cancellation, workspace trust, and SDK freeform propagation. `build-agy-usage-runtime.py --question-patch` rebuilds both `server.py` and `hooks.py`; its existing `--patch` still supplies the server-only telemetry patch. Build from the stock archive, not an already telemetry-patched archive.

The keyless GUI transcript is `tests/fixtures/acp-freeform.expected.md`. It exercises the actual question form, Host bridge, and stdio ACP transport. Its peer asserts freeform metadata before emitting `Received Other: 1`; selecting native option 1 cannot satisfy the transcript. The peer performs no model calls and reports no invented usage.

Copy `tests/fixtures/acp-freeform-peer.mjs` into an isolated test runtime directory with an executable sibling `localharness_external` (a no-op executable suffices; the peer never invokes it). Configure the test profile with those executable/harness paths and model `gemini-3.8-flash-high`, then restart the existing local test GUI. Do not use a production profile. Set these environment variables before running the check:

- `DSH_GUI_URL`: the existing GUI authenticated launch URL; keep it private.
- `DSH_WEB_PACKAGE_JSON`: an installed DSH Web package manifest whose dependencies include Playwright.
- `DSH_AGY_SETTINGS`: the isolated Antigravity settings JSON.
- `DSH_QUESTION_WORKSPACE`: an existing workspace display name in that GUI.
- `DSH_CHROME_PATH`: optional local Chromium executable; otherwise use Playwright’s installed browser.

```sh
node scripts/check-user-question-gui.mjs
node scripts/check-user-question-gui.mjs --runtime-lock
```

The check validates the configured peer bytes, submits literal Other text `1`, and compares the rendered question, submitted fields, and agent response against the snapshot. `--runtime-lock` creates a blank session, confirms Codex or other DSH choices are still enabled, sends `LAB runtime lock pretoken`, and while Stop is active with zero assistant chunks asserts those DSH picker radios (`role=menuitemradio`) are disabled and current Gemini/AGY radios stay enabled, then Stop-cancels. Expected transcript: `tests/fixtures/acp-runtime-lock.expected.md`. Restore the real native executable and model setting, then restart the test GUI after replay. Native API delivery is checked separately with a unique Chinese answer absent from the initial prompt; the agent must echo that answer.
