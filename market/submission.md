# DSH market submission checklist

Status: `NOT_PUBLISHED` — runtime smoke complete, publication blocked on authorization and credentials.

## Verified locally (2026-11-17)

- Full suite: 50/50 PASS (`npm test`, Node v24.14.0, Windows 11) after whole-branch review fixes.
- Release tarball: `release/agentranch-dsh-0.1.0.tgz` (11861 bytes, SHA-256 `40dc6ca158019364f59b358ba2da8f061bc34c55e788c1050a17c1efa57c62e9`).
- Real-host smoke: `dsh 0.2.2-rc.1` clean-profile install → compose → boot → four `agentranch_*` tools advertised in the session header (27 tools total) → uninstall leaves the profile clean. Misconfigured `awCliPath` surfaces a loud activation warning.
- Model-loop tool calls: NOT_RUN (no `DEEPSEEK_API_KEY` in this environment).

## Public repository prerequisites

1. Create or use the public repository `https://github.com/gongxianjin/agentranch-dsh` only with explicit owner authorization.
2. Put the plugin package's `package.json` at repository root.
3. Add the GitHub topic `dsh-plugin`.
4. Keep the repository README, SECURITY.md, LICENSE, package entry, and `dsh.bundle.patch` discoverable.
5. Prefer an npm publication of `agentranch-dsh`; otherwise the market may pin a public Git commit according to its current rules.

## Verification sequence

- Run `npm.cmd test` and `npm.cmd pack --dry-run` from the package root.
- Publish to npm only after explicit authorization and a configured npm account.
- Verify the public repository and npm package from a clean environment.
- Wait for the DSH Bazaar daily scan, then query the official index/search endpoint and perform a clean-profile install/list check.

The market index and listing are discovery mechanisms, not security endorsements. A local tarball, a GitHub repository, or an npm package alone is not evidence that the plugin has been accepted, indexed, or installable by the official market.

## Current blockers

- No authenticated npm account and no GitHub push authorization in this environment; publication requires explicit user authorization.
- DSH Bazaar daily scan cannot run until the package is actually public.

Record any later publication URL, package version, commit, scan date, and clean-profile result in `VERIFICATION.md` and `submission-result.json`; never infer publication from local packaging.
