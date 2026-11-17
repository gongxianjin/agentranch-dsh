# agentranch-dsh

A bounded DeepSeek Harness (DSH) plugin for controlling a user-installed AgentRanch CLI.

## Compatibility

- DSH: `@deepseek-ai/dsh 0.2.2-rc.1` (the `0.2.x` range declared in `package.json`)
- Node.js: `>=24.9.0`
- Formal AgentRanch target: Windows AgentRanch `0.2.0` and its `aw-cli.exe`
- The plugin does not bundle AgentRanch, `aw-cli.exe`, DLLs, Python, credentials, or test state.

A runnable DSH 0.2.2-rc.1 installation is required for a real DSH load/call smoke test. Package and unit-test results must not be described as a DSH runtime verification.

## Configure

The plugin is configured by the DSH host when it invokes the plugin entry. Supply an explicit absolute executable path and at least one existing allowed root:

```json
{
  "awCliPath": "C:\\Program Files\\AgentRanch\\aw-cli.exe",
  "allowedRoots": ["C:\\Users\\me\\AgentRanch-workspaces"],
  "defaultTimeoutMs": 30000,
  "maxOutputBytes": 65536
}
```

`awCliPath` is configuration-only; no tool argument can replace it. `configPath` and `stateDir` must be existing absolute paths inside an allowed root. Symlinks, junctions, and Windows reparse-point escapes are rejected. Configuration changes are user actions, not model actions.

For a local package check, build first and create a tarball:

```text
npm.cmd run build
npm.cmd pack --pack-destination .\\release
```

Install that tarball through the DSH profile/plugin manager. Do not treat a local npm install as proof that the official DSH runtime or market can discover the package.

## Tools

Only four tools are registered:

- `agentranch_identity({})` → `aw-cli --identity`
- `agentranch_check({ configPath, timeoutMs? })` → `aw-cli check --config <path>`
- `agentranch_local_check({ stateDir, timeoutMs? })` → `aw-cli local-check --state-dir <path>`
- `agentranch_run_once({ mode: "runner" | "controller", configPath, timeoutMs? })` → `aw-cli <mode> --config <path> --once`

Arguments are schema-validated. There is no arbitrary argv, shell, cwd, environment, executable override, `mcp`, SSH gateway, owner command, fixture command, or long-running mode.

`runner` and `controller` can have AgentRanch side effects. Every call requires a fresh host approval for the current agent and call; an absent approval service, unavailable outcome, cancellation, or rejection fails closed before process start.

## Result semantics

Results preserve bounded, redacted stdout/stderr, exit status, timeout state, diagnostics, and best-effort JSON. Model-visible output redacts private-key material, token/password/API-key assignments, and bearer Authorization values.

`agentranch_check` retains `active_probe: false` and `external_readiness: not_probed`: it is a local configuration check, not proof of external readiness. `agentranch_local_check` returns exit code 2 with `local fixture timed out; uncertain task remains in ledger` on Windows: the fixture child itself runs and verifies (sum=6, exit 0), but a run only becomes `done` through admitted M0 owner evidence, which only the Linux `owner-exec` path can produce. The `unknown` run state and retained reservation are the honest result, not an error to retry away. It is a local simulated fixture, never real remote AO/Reason/model execution.

A successful process exit is not a claim that AgentRanch completed a remote job. Inspect the returned JSON and diagnostics.

## Non-goals

This plugin is not a GUI replacement, remote-execution authorization layer, SSH/MCP bridge, secret manager, or substitute for AgentRanch evidence gates. It does not modify configuration, create keys, upload files, or publish data.

## Development

```text
npm.cmd install
npm.cmd test
npm.cmd run pack:dry
```

The repository's `VERIFICATION.md` separates package verification, AgentRanch integration verification, DSH runtime verification, and official market publication. A market listing is not a security endorsement.

## License

MIT. See `LICENSE`.
