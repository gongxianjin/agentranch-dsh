# Security model

## Trust boundary

This package runs inside the DSH host and starts a user-configured AgentRanch CLI. The host, the configured executable, AgentRanch itself, and the local filesystem remain outside this package's trust boundary. The plugin is a narrow adapter, not a replacement security boundary.

## Command boundary

- Child processes use `spawn(file, args, { shell: false })`.
- The executable is fixed by user configuration; model arguments cannot replace it.
- Arguments are fixed per tool. No arbitrary argv, shell string, cwd, env object, stdin secret, interpreter, `mcp`, SSH gateway, owner command, or fixture command is exposed.
- Only `--identity`, `check --config`, `local-check --state-dir`, and `runner/controller --once` are reachable.

## Filesystem boundary

The executable and allowed roots must be explicitly configured. Invocation paths must be absolute, existing, and inside canonical allowed roots. Empty, relative, control-character, NUL-containing, overlong, directory/file-type mismatches, symlink, junction, and Windows reparse-point escapes fail closed.

Residual race (inherent to the subprocess design): path validation and process start are separate steps, and AgentRanch opens the path itself. If an actor with local write access to the allowed root replaces a validated file with a link between the plugin's validation and the child's `open` — a window the plugin narrows by revalidating after the human approval wait but cannot close — the escape is not caught by this plugin. Treat allowed roots as trusted-writable only for actors you already trust with the aw-cli configuration.

## Side effects and approval

`runner` and `controller` may write state or perform AgentRanch work. Each invocation requires an approval request through the DSH approval service for the active agent and call. Missing approval support, rejection, cancellation, unavailable approval, or a cancelled caller never starts the child process. Approval is not inferred from model text or an input flag.

## Output and secrets

stdout and stderr are bounded before model exposure. Output is redacted for PEM private keys, token/access-token/refresh-token fields, password/passwd/secret fields, API-key fields, and bearer Authorization values. A `redacted` flag and category list remain visible. Local diagnostic evidence must not be treated as a secret vault or unrestricted transcript.

The plugin does not read private keys or upload credentials. Do not place secrets in AgentRanch config files that are expected to be returned to a model.

## Semantic honesty

`check` preserves `active_probe: false` and `external_readiness: not_probed`. On Windows `local-check` ends `unknown` with exit 2 ("uncertain task remains in ledger"): the fixture runs and verifies, but run completion requires Linux-only M0 owner evidence, which the plugin cannot and must not fabricate. Neither result proves external readiness or real remote model execution.

## Reporting

Report security issues privately through the repository's configured security contact or the maintainers before public disclosure. Do not include private keys, tokens, complete config files, or machine-specific paths in a report.
