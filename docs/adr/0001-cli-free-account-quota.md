# Query account quota with the ACP profile, without a CLI dependency

Status: accepted; plugin implementation pending.

Antigravity account quota is distinct from ACP turn token consumption. The Host will reuse the selected isolated ACP personal-OAuth profile to query the vendor quota-summary API and expose normalized quota windows through ProviderDirectory usage registration; users must not install the CLI or maintain a separate login for quota.

## Evidence

The installed Google runtime `agy_acp_server_20260818_01_RC01` bundles `cloudcode-pa_prod_google_rest_v1internal.json`, defining `POST v1internal:retrieveUserQuotaSummary` with a required project and cloud-platform OAuth scope. Its response contains `groups[].buckets[]` with bucket identity, window, remaining fraction and reset timestamp; legacy top-level buckets are deprecated. A real request using the lab ACP profile successfully returned Gemini and Claude/GPT groups, each with weekly and five-hour windows. This verifies one personal-OAuth account and runtime version, not all subscription types.

Vendor sources under `google3/cloud/developer_experience/antigravity_extensions/acp_server/` define credential storage in `oauth/credential_store.py`, personal token/project loading in `ccpa_connection/oauth_manager.py`, endpoint discovery in `ccpa_connection/onboard.py`, and client identification in `useragent.py`. The runtime archive is the evidence source; temporary extracted files are not a deployment dependency.

## Request and ownership requirements

Refresh access tokens in Host memory using only the selected ACP profile. Identify requests using the vendor structured ACP User-Agent, including the actual runtime version and truthful host surface. A probe omitting that header received `UNSUPPORTED_CLIENT` from account discovery and misleading downstream `SUBSCRIPTION_REQUIRED` errors; adding the required identification made quota retrieval succeed with the same credentials.

Resolve project and endpoint through `loadCodeAssist` using the vendor selection rules. HTTP success alone is insufficient: validate entitlement and project before querying quota; do not hide missing discovery data with a stale cached project. Restrict credential-bearing requests to verified Google endpoints and reject redirects. Never expose credentials, project identifiers or raw authentication responses to browser state, logs or session events.

The ACP runtime remains the login/logout owner. Quota refresh must not overwrite its credential file; scope cached access tokens and quota results to the provider instance, invalidate them on logout/account change, and prevent late responses from restoring previous-account data. Coordinate refreshes and bound request duration.

Preserve each returned group and bucket rather than hardcoding model families or reset cadence. Missing fields remain unavailable, not zero; do not estimate quota from token consumption. Publish explicit authentication, permission and transport failures; stale displayed values must retain their observation time.

## Alternatives and remaining validation

Do not invoke CLI `/usage`, require a desktop IDE service, or send `/usage` as a model prompt. The inspected ACP runtime advertises no quota capability and its native command list contains plan and logout, so account quota uses a separate Host HTTP request rather than an invented ACP method.

The `v1internal` API and credential-file format are vendor implementation details, not a stable public compatibility promise. Keep this dependency inside the Antigravity provider. Remaining work includes secure profile loading, refresh/account-change regression checks, response validation and ProviderDirectory/UI integration. Enterprise, API-key and other authentication modes have not been verified and must not inherit personal-OAuth support claims.
