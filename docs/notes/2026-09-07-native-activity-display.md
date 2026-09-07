# Native activity display and measured usage

The plugin registers one read-only Chat container per loaded turn, using standard turn boundaries and authenticated sidecar reads. Native tools are never submitted to the DSH execution loop. Inputs and structured results are bounded by the existing activity text limit; ACP content is retained when raw output is absent.

A subagent launch tool reports its own status, not the child outcome. Child lifecycle metadata absent from ACP remains unavailable; thought text and native diagnostic logs are not parsed to manufacture it.

Token usage requires complete provider-reported counters. Character estimates are not measured usage, and whole-native-turn wall time is not isolated model decoding time.

Regression checks: `tests/native-turn.test.ts`, `tests/native-activity.test.ts`, `tests/llm-bridge.test.ts`, `tests/settings-ui.test.ts`, and `tests/web-registration.test.ts`. Live Chat placement still requires verification on the existing 3082 instance before release.
