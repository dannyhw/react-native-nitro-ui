# X10 context pack: real paths (checked at `main` when the brief was written)

| Item | Files and facts |
|---|---|
| The chain today | `package.json` `scripts.check`: `typecheck` (tsc), `bench:typecheck` (`bun --cwd bench typecheck && … typecheck:android`), `lint` (eslint), `format` (prettier --check .), `test` (jest), `test:native` (`scripts/native-tests.sh`, builds into `$TMPDIR/nitro-ui-native-tests-$$`, so it's already per-process), `perf:renders` (`scripts/perf/renders.mjs`, runs `reassure measure` and writes `.reassure/current.perf`), `nitrogen:check` (`scripts/nitrogen-check.mjs`, temp dir), `registry:check` (added by X3), `autolinking:check` (`scripts/check-autolinking.mjs`), `prepare` (`bob build`, writes `lib/`), `api-extractor:check` (`etc/api-extractor.json`, reads `lib/typescript`), `publint`, `manifest:check` (`scripts/package-files.mjs`: runs `npm pack`, which re-runs `prepare` and rewrites `lib/`, so it races with `prepare` and with anything reading `lib/`), `readme:check` (`scripts/readme-examples-check.mjs`) |
| Ledger | `scripts/gate.mjs` (spawns the gate and appends to `.gates/<branch>.jsonl`), `scripts/gate-core.mjs` (`MERGE_GATES`, `requiredGatesFor`, `TOOLING_PREFIXES`/`TOOLING_FILES`; any new `scripts/check.mjs` belongs in `TOOLING_FILES`) |
| CI | `.github/workflows/ci.yml`, job `checks` (name `Checks`), step `run: bun run check` |
| Playbook | `docs/tasks/ORCHESTRATOR.md` "The loop" step 5 |
| Tests | `scripts/__tests__/gate.test.js` (ledger and need), new tests next to it |
