# Managed installation release scope

On 2026-09-08 the release owner explicitly approved retaining the existing Install Antigravity feature while reviewing the complete branch from main. This supersedes the initial issue #1 first-version restriction on managed downloads for this release; the explicit approval is tracked in [issue #5](https://github.com/NOirBRight/dsh-acp-antigravity/issues/5).

The installer downloads only the official Registry-pinned Google artifact, checks its fixed SHA-256 and extracts the configured executable pair into the user-selected managed installation root. Our release archives do not contain Google executables or authenticated profiles. User-supplied executable and harness paths remain supported. Distribution metadata and download verification are not a legal warranty concerning third-party license terms.

The review approval covers this existing feature and these constraints; it does not authorize mirroring Google archives, redistributing patched runtimes, or changing production account data during E2E.
