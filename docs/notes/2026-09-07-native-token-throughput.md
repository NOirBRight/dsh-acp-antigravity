# Native token accounting and effective throughput

ACP usage is normalized before the provider host receives it; canonical reasoning and cache details survive the same-process host and LLM bridge. A prompt contributes its final valid cumulative snapshot once. Distinct plan/execution prompts contribute summed complete totals, never a mixture of partial counts. Text tokenization is not a fallback for absent provider telemetry. The bridge uses the host StreamChunk type, including structured finish reasons, so terminal events and assembled usage use the same protocol. Cancellation of a plan continuation remains cancellation of the enclosing stream.

Receipt-time measurements are separate from token accounting and event timestamps. `generationElapsedMs: null` excludes ambiguous native samples from speed statistics without discarding their real token counts. Native database step timestamps and `streaming_duration` are not validated decode intervals. The supported formula, limitations and runtime prerequisites are in [README](../../README.md#native-token-telemetry).

Regression checks: `tests/usage.test.ts`, `tests/generation-timer.test.ts`, `tests/throughput.test.ts`, and the provider-to-LLM test in `tests/provider.test.ts`. The native patch checker validates the pinned source separately. Live native output and the existing GUI require verification before deployment.
