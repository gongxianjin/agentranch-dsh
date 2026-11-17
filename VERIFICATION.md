# AgentRanch DSH Plugin Verification

## Status

- Package implementation: complete; full suite 50/50 PASS (`npm test`, Node v24.14.0, Windows 11)
- Release artifact: `release/agentranch-dsh-0.1.0.tgz` (11861 bytes, SHA-256 `40dc6ca158019364f59b358ba2da8f061bc34c55e788c1050a17c1efa57c62e9`), manifest `release/PACKAGE-MANIFEST.json`
- DSH runtime baseline: `@deepseek-ai/dsh 0.2.2-rc.1`
- Node baseline: `>=24.9.0`
- Formal AgentRanch compatibility target: AgentRanch 0.2.0 Windows `aw-cli.exe`
- Official DSH install/smoke test: PASS (clean-profile install, load, tool advertisement, uninstall; verified 2026-11-17)
- Model-driven tool-call loop: `NOT_RUN` (no `DEEPSEEK_API_KEY` in this environment; boot reaches the LLM stage and fails there with `MISSING_CREDENTIAL`)
- Official market publication: `NOT_RUN` (blocked on authorized GitHub/npm publication; see `market/submission-result.json`)

## Package contract

Verified from the npm tarball for `@deepseek-ai/dsh@0.2.2-rc.1` and `@deepseek-ai/dsh-tools@0.2.2-rc.1`:

- Plugin package uses root `package.json` with `dsh.bundle.patch` pointing to `./cordis.patch.yml`.
- Bundle patch is a YAML sequence with an `insert` entry containing matching `id` and `name`.
- Plugin entry exports `name` and `apply(ctx, rawConfig?)`.
- `apply` is **synchronous** (returns `void`): the DSH host loader does not await an async `apply`, and an async rejection is silently dropped (probed 2026-11-17: an async throw inside `apply` produced no startup diagnostic, while a synchronous throw surfaced `dsh: warning: 1 entry did not activate`). All validation (`loadConfig`) and tool registration therefore run synchronously.
- Tools are registered with `ctx.tools.register(defineTool({...}))` from `@deepseek-ai/dsh-tools`.
- Each tool declares `parameters`, `output.schema`, `output.render(args, value)`, and `execute(args, exec)`.
- DSH tool policy pipeline exposes `ctx.tools.guard` and `tools/pre-execute`; the side-effect confirmation instead uses the `ApprovalService.request` seam directly so a replaceable policy cannot remove the mandatory per-call confirmation.

Source checks:

```text
npm pack @deepseek-ai/dsh@0.2.2-rc.1 --pack-destination <empty-dir>
npm pack @deepseek-ai/dsh-tools@0.2.2-rc.1 --pack-destination <empty-dir>
npm pack dsh-wewrite@0.5.5 --pack-destination <empty-dir>
```

Task 1 test:

```text
cd agentranch-dsh-plugin
npm run build
node --test test/dsh-contract.test.mjs
```

Result: PASS (3 tests, 0 failures).

## AgentRanch CLI integration (real binary)

Binary: `agent-workspace/target/x86_64-pc-windows-gnu/release/aw-cli.exe`, `--identity` → `{"binary":"aw-cli","package":"agentranch","version":"0.2.0"}`.

```text
node --test test/integration.test.mjs
```

Result: PASS (5 tests, 0 failures).

| Command | Observed result (verified 2026-11-17) |
|---|---|
| `--identity` | exit 0, package `agentranch`, version `0.2.0` |
| `check --config <valid>` | exit 0, `configuration_valid:true`, `active_probe:false`, `external_readiness:"not_probed"` |
| `check --config <invalid slots:0>` | exit 2, no `node-1.key` secret bytes in stdout/stderr |
| `local-check --state-dir <dir>` | exit 2, stderr `local fixture timed out; uncertain task remains in ledger`, empty stdout; durable fixture evidence shows the child ran and verified (sum=6, exit_code 0) while the persisted run stays `unknown` |

Design note (verified from source `src/core/store.rs`, `src/core/runner.rs`, and upstream test `tests/rust_mcp.rs::native_cli_local_check_preserves_uncertain_observer_result`): a run reaches `done` only through admitted M0 owner evidence, produced exclusively by the Linux `owner-exec` path. On Windows the honest result is `unknown` + exit 2; the plugin documents and surfaces exactly that and never fabricates completion.

## Package scan and release evidence

```text
node tools/verify-package.mjs --package-dir <extracted-tarball>
node tools/build-release.mjs --release-dir release
```

Result: PASS. Tarball contains only declared runtime files/docs (`package.json`, `dist/*`, `cordis.patch.yml`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE`); no `.exe/.dll/.pem/.key/.env`, no test/source/market directories, no absolute machine paths, no token-like secrets. SHA-256 digest independently recomputed with Python `hashlib` and matched the manifest. The compiled entry imports successfully in a clean directory with only a stubbed `@deepseek-ai/dsh-tools` peer (no source checkout required).

## DSH runtime smoke test (real host, clean profile; 2026-11-17)

Environment: Windows 11, Node v24.14.0, `@deepseek-ai/dsh@0.2.2-rc.1` via `npm exec`, isolated `DSH_HOME` (`/tmp/tmp.agentranch-final`), real `aw-cli.exe` configured through a `--patch` overlay.

| Step | Command (essence) | Observed result |
|---|---|---|
| 1. Install | `dsh plugin --profile headless add release/agentranch-dsh-0.1.0.tgz` | pnpm install succeeded; profile manifest lists the plugin in `dsh.profile.bundles` and `dependencies` |
| 2. Compose | `dsh --profile headless --patch <config overlay> --dump-config` | entry `agentranch-dsh` composed with the configured `awCliPath`/`allowedRoots` |
| 3. Load | `dsh --profile headless --patch <config overlay> --json "hi"` | boot reaches the LLM stage; **27 tools advertised** (23 baseline + `agentranch_check`, `agentranch_identity`, `agentranch_local_check`, `agentranch_run_once`), each with closed parameters; run ends at `MISSING_CREDENTIAL` (no API key) — no plugin errors |
| 4. Failure visibility | same boot with an invalid `awCliPath` overlay | `dsh: warning: 1 entry did not activate` + `ENOENT ... lstat 'C:\definitely'` — misconfiguration is loud, not silent |
| 5. Uninstall | `dsh plugin --profile headless remove agentranch-dsh` | profile manifest restored (bundle list back to base+headless); subsequent boot shows no activation warnings |

Tool-call execution through the model loop was not exercised (no `DEEPSEEK_API_KEY`); the tools' execution paths are covered by the unit/integration suite against the real `aw-cli.exe`.

Root cause fixed during this smoke test: the original `apply` was async. The DSH host loader (dsh-app-boot `boot()` / startup audit) only surfaces synchronous failures from plugin activation; an async rejection inside `apply` is silently dropped, which made both failure modes invisible: misconfiguration produced no warning, and successful registration raced the first agent step. The fix makes `apply`, `loadConfig`, and all path validation synchronous (`fs.lstatSync`/`realpathSync`), pinned by the tests `apply is synchronous…` and `apply throws synchronously on invalid config…` in `test/tools.test.mjs`.

## Whole-branch review (fresh reviewer, 2026-11-17)

An independent reviewer re-verified the suite (46/46 at review time), the tarball digest, and probed the compiled output directly (junction escapes, timeout/abort kills with real descendant-PID death checks, clamp boundaries). Verdict: no Critical findings; 4 Important, 6 Minor. All four Important findings were fixed with tests (suite now 50/50):

1. **Truthful termination diagnostics** — `terminateTree` previously pushed `process_tree_terminated` unconditionally, even when `taskkill` failed (and the Unix branch swallowed kill failures). Now the diagnostic reflects the actual `taskkill` exit (`process_tree_terminated` only on exit 0, else `process_tree_termination_failed`), pinned by direct dead-pid/live-pid tests plus a real descendant-death assertion (`tasklist` polling, localized-output-safe).
2. **Junction coverage and honest NOT_RUN** — the only link-escape test silently no-op'd when symlink creation lacks privilege (EPERM), and no junction case existed (required by plan Task 2). Added a no-privilege `mklink /J` junction test (inside-root escape and junction-as-root both rejected) and the EPERM path now emits an explicit `NOT_RUN` diagnostic instead of counting as a pass.
3. **Repository hygiene** — `node_modules/` (1310 files) and `release/*.tgz` were not gitignored; a `git add` would have vendored the dependency tree and a binary tarball. Added `node_modules/` and `agentranch-dsh-plugin/release/` to `.gitignore` (1355 → 43 candidate files, source/tests/docs only).
4. **TOCTOU residual risk documented** — SECURITY.md's filesystem-boundary section now states the validation→spawn race explicitly (narrowed by post-approval revalidation, not closable) instead of implying unconditional fail-closed.

Deferred minors are recorded in the execution ledger.

## Evidence table

| Claim | Primary source | Method | Acceptance criterion | Status |
|---|---|---|---|---|
| DSH package contract | Official npm package declarations | Tarball inspection + contract test | Manifest, patch, entry and API fields match | PASS |
| AgentRanch CLI behavior | Real `aw-cli.exe` 0.2.0 + its source and upstream tests | `test/integration.test.mjs` against the real binary | Identity/check semantics preserved; local-check honest-unknown preserved; no secret leakage | PASS |
| Package hygiene | Release tarball bytes | `tools/verify-package.mjs` scan + independent digest recompute | Clean inventory + matching SHA-256 + clean-directory import | PASS |
| DSH runtime: install/load/advertise | Real dsh 0.2.2-rc.1 host, clean profile | `dsh plugin add`, `--dump-config`, `--json` boot, session `request/header` inspection | Four tools advertised exactly once; no activation warnings; uninstall clean | PASS |
| DSH runtime: tool call through model loop | Real dsh host | Requires `DEEPSEEK_API_KEY` | Tool invoked and returns AgentRanch semantics | NOT_RUN (missing credential; execution paths covered by unit/integration suite) |
| Market publication | DSH Bazaar/npm/GitHub | Pending authorized publication | Discoverable and installable from clean profile | NOT_RUN (blocked on user-authorized GitHub repo + npm publish; no credentials in this environment) |

## Four-question verification summary

1. **What would a domain expert add?** Host-loader semantics for plugin activation (sync vs async `apply`) — discovered and pinned only by probing the real host; the fix makes configuration failures loud and registration race-free. Remaining gap: the model-loop call path needs an API key to verify end-to-end; recorded as NOT_RUN rather than assumed.
2. **Primary sources used:** official npm tarballs (dsh, dsh-tools, dsh-wewrite) read directly; dsh-app-boot loader/audit source read from the installed host; real `aw-cli.exe` 0.2.0 executed; AgentRanch Rust source and upstream tests cited for the honest-unknown semantics; session `session.v4.jsonl.zstd` decoded for tool-list evidence.
3. **Methods/tools:** three controlled probes against the real host (module-throw, sync-throw-in-apply, async-rejection-in-apply) isolating the loader contract; clean-profile install/boot/uninstall sequence; TDD with the new sync-contract tests (RED→GREEN observed); full suite 46/46.
4. **Independent acceptance:** tool advertisement read from the persisted session file (not from plugin self-report); SHA-256 independently recomputed; failure-visibility verified with an intentionally invalid config; uninstall verified by re-booting the profile. Market publication deliberately left NOT_RUN — no publish action was taken without authorization.
