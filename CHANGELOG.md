# Changelog

## 0.1.0

- Added a DSH 0.2.2-rc.1-compatible package contract.
- Added strict configured executable and allowed-root path policy.
- Added bounded no-shell AgentRanch CLI execution, timeout handling, process-tree termination, and model-output redaction.
- Added `agentranch_identity`, `agentranch_check`, `agentranch_local_check`, and confirmation-gated `agentranch_run_once`.
- Added package, security, and market-submission documentation.

Runtime smoke test against the real DSH 0.2.2-rc.1 host passed (install, load, four-tool advertisement, failure visibility, clean uninstall). Model-loop tool calls and official market publication remain environment-dependent verification steps (API key / publication authorization).
