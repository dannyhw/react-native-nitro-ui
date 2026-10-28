# X10 review: `check` throughput

**Branch:** `task/X10-check-throughput` @ `b46e42c` (branch point `20b4069`; reviewed `git diff main...HEAD`)
**Verdict: FIX ROUND.** The runner is sound. The graph is equivalent to the serial chain, and I verified each serialisation claim against the tools. The merge-reuse rule is not sound yet: it can mark `check` green on a merged tree that `check` never ran on (M1, M2). The runner can also exit 0 having run nothing (M3). All three fixes are small but need tests shown red, so they belong in a round, not in a merge fix-up.

## What I verified

- **Step list = chain.** `CHECK_STEPS` has the same 16 names in the same order as the old `check`. `planProblems` parses `check:serial` and refuses on any difference or on a non-plain section. Both directions are tested.
- **Shared outputs, checked against the tools:**
  - `prepare` deletes `nitrogen/`: confirmed. bob's `custom.js` calls `deleteAsync(nitrogen/)` before running `nitrogen src && patch-nitrogen`.
  - The readers that `prepare` now waits for (`test` via `viewConfigs.test.ts`, `perf:renders`, `nitrogen:check`) are right.
  - `typecheck` does not read `nitrogen/`: the `*Config.ts` files are inline copies.
  - `test:native` compiles only `cpp/`, `ios/` and `scripts/native-tests` files.
  - `registry:check`, `autolinking:check` and `readme:check` don't touch `nitrogen/` or `lib/`.
- **Jest cache claim:** confirmed. `@callstack/reassure-cli` `measure.js` spawns Jest with only `--runInBand --testMatch=…`, and `jest-haste-map`'s `getCacheFilePath` hashes `id` plus roots, extensions and ignorePattern, none of which `testMatch` changes. So the two runs share one cache file, and the `jest` group is justified.
- **Context-pack correction:** the report is right. `package-files.mjs:24` runs `npm pack --dry-run --json --ignore-scripts`, so `manifest:check` rebuilds nothing.
- **Fail-fast, flush order and exit codes** read correctly (exit 2 on a plan or argument problem, 1 on a step failure). With 4 slots, `test` always starts before `perf:renders`, so a failing `test` never lets the perf Jest summary become the ledger's `counts`.
- **Can a parallel ordering pass where the serial chain fails, or the reverse?** Not through ordering. The only steps that now run in a different position relative to `prepare` are `readme:check`, `registry:check` and `autolinking:check`, and none of them reads `nitrogen/` or `lib/`. The one way to "pass" without running anything is M3.
- **Ledger format:** v3 lines add `stepTimings` only. Nothing in the repo gates on `v`, and `stepTimingsOf` tolerates missing or garbage values, so v1 and v2 files still read, and an older `gate.mjs` reading a v3 export just ignores the field.
- **TOOLING_FILES:**
  - Nothing in a build path imports `gen-registry.mjs`/`registry-core.mjs` (git grep: only tests, generated-region headers and docs). Their outputs (`nitro.json`, `nitro-ui.sizing.json`, `src/**` regions) are mapped files, so a codegen change cannot reach a binary without a mapped diff.
  - `build-slot-core.mjs` is imported by the mapped `build-app.mjs`, but it only decides when a build starts.
  - `devices.example.json` is only a template.
  - `scripts/` is not in `package.json` `files`.
  - Agreed: none of these can reach the app or the package.
- **CI:** `ci.yml` is unchanged. Job `checks`, name `Checks`, `run: bun run check`, Node from `.nvmrc` (so `import.meta.dirname` is fine).
- **Mutations I ran (each reverted with `git checkout -- .`; the worktree is clean):**
  - Drop the `groupsBusy` gate → `two steps in a group never overlap` red.
  - Drop `headIsAncestor` → three reuse tests red.
  - CI runs `check:serial` → **stayed green** (N2).
  - Disable the `failedNeeds` guard → **stayed green** (N3).
  - Main moves in `bench/` instead of `ios/` → reuse accepted (M1).
- **Incident:** the main checkout's reflog (read as a file, no git run there) shows `merge task/X10-check-throughput` at 1793181111 and `reset: moving to b943a3f` 29 s later, with nothing between. The report's account is accurate. The proof worktree, its branch and the nested `nitro-ui-worktrees/nitro-ui-worktrees/` directory are gone. Nothing the branch ships runs a merge, and `gate.mjs` only runs read-only git (`cat-file`, `merge-base --is-ancestor`). The new tests do run `checkout`/`merge`, though, and they can be redirected (N1).
- **Premises:** every file and symbol the report cites exists at the tip, and the exported line's tree `1dbe8b4dc4f3` is still the tip's code tree (`gate.mjs status`).

## Must fix

**M1. Merge reuse keys on the code tree, but `check` reads files the code tree leaves out.**

Where: `scripts/gate-core.mjs:779` `findReusableCheck`, and its doc `docs/tasks/ORCHESTRATOR.md:57`.

The problem: `isCodeFile` excludes `bench/`, `.github/`, `docs/` and every `*.md`. `check` reads several of those:
- `bench:typecheck`, `lint` and `format` read `bench/`;
- `format` reads `README.md`, `CONTRIBUTING.md` and `CHANGELOG.md`;
- `readme:check` reads `README.md`;
- `check-runner.test.js` (inside `test`) reads `.github/workflows/ci.yml`.

So when `main` gains only such files after the branch point, the merged code tree still equals the branch tip's, and reuse marks `check` green although no step ever saw the combination. That is common here: `95f209d perf(bench)` and the A3/A4 bench merges are examples.

Failure scenario: branch X renames an export in `src/`. Meanwhile `main` merges a bench task whose `bench/src/*.tsx` imports the old name. Merging X gives a code tree equal to X's tip → `✓ check — green, reused`, but `bench:typecheck` fails on the merged result.

Shown: in `does not reuse when the merge brought in code as well`, I changed `main`'s new file from `ios/core/Main.swift` to `bench/src/Main.tsx`, and the CLI printed `✓ check — green, reused from task/x10-check-throughput's ledger`.

ORCHESTRATOR's "When `main` moved as well the digests differ" is false for these paths. The brief's own parenthetical ("when `main` gained nothing since the branch point") is the rule that was meant.

Fix: additionally require that every path in `git diff --name-only <entry.head> HEAD`, plus any uncommitted or untracked path, is under `docs/`. I found no check step that reads `docs/`: Prettier, ESLint and tsc all exclude it, and the test hits are fixture strings. Add a red test for `bench/`, `README.md` and `.github/`.

**M2. Reuse overrides a newer red on the same tree.**

Where: `scripts/gate-core.mjs:940` (`applyReusedCheckRow` only declines when the local row is green), and `:789` (`findReusableCheck` skips reds and takes an older pass from the same ledger).

Failure scenario 1: on `main` after the merge, `check` ran and failed on tree T (a real failure, or one that only happens on this machine or in this checkout). `need --for merge` then shows check green, reused from task/Y, because the red row is swapped for Y's older green. I checked this with `decideNeed({entries:[red on T], reusedCheck: green on T})`: the result is `green`.

Failure scenario 2: branch Y's own ledger has a pass on T at 10:00 and a fail on T at 11:00. `findReusableCheck` returns the 10:00 pass, while `gateRowFor` on that same ledger would call it red.

Fix: reuse only when the local row is `missing` or `stale`, never `red`. In each source ledger, take the latest *decisive* line on the tree (the same rule as `gateRowFor`) and reuse it only if that line is a pass. Add a red test for each.

**M3. `check.mjs` can exit 0 having run nothing.**

Where: `scripts/check.mjs:330-333`.

The entry guard compares `import.meta.url` with `` `file://${path.resolve(argv[1])}` ``. ESM URLs are percent-encoded and symlink-resolved; that string is neither. If the checkout path contains a space, `%` or `#`, or the script is invoked through a symlinked path, `main()` never runs and the process exits 0 with no output. `gate.mjs check` would then record `result: pass`: `gate.mjs:689` only looks at the exit code.

Reproduced with the same guard:
- `/tmp/x10rev/a b/g.mjs` → `main skipped`, exit 0.
- `node /tmp/x10rev/plain/g.mjs` (macOS `/tmp` → `/private/tmp`) → `main skipped`, exit 0.
- `cd /tmp/x10rev/plain && node g.mjs` → ran.

Current machine and CI paths happen to be safe. The tests also run it from a safe absolute path, so nothing catches this.

Fix: use the repo's own idiom (`pathToFileURL(fs.realpathSync(process.argv[1])).href`, as in `lease.mjs:571`/`pod-install.mjs:157`), or make `bun run check` call an always-run entry. Add a test that runs the runner through a symlinked path, or a path with a space, and expects the step list header.

## Nits / notes

**N1. The new git-driving tests inherit `GIT_DIR`/`GIT_WORK_TREE`.**

Where: `scripts/__tests__/gate-check.test.js:474` `gitIn` and `:544` `runCli` (both spread `process.env`).

This is the incident class. With `GIT_DIR`/`GIT_WORK_TREE` exported (git hooks, `submodule foreach`, a wrapper), `makeRepo`'s `commit`/`checkout -b`, and the reuse tests' `checkout main`/`merge`, act on that repository instead of the temp dir.

Shown on a throwaway repo: running `accepts it once the branch is merged` with `GIT_DIR=/tmp/x10rev/victim/.git` wrote a `base` commit into it and switched it to `task/x10-check-throughput`.

These are the repo's first tests that run `checkout`/`merge`. Fix: delete `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` and `GIT_OBJECT_DIRECTORY` from both environments.

**N2. The CI pin passes when CI runs `check:serial`.**

Where: `scripts/__tests__/check-runner.test.js:956`.

`toContain('run: bun run check')` matches `run: bun run check:serial`, so the test named "runs this same runner" stays green when CI runs the old chain (mutation shown). Fix: match `/run: bun run check\n/`.

**N3. A test name claims a mode that doesn't exist.**

Where: `scripts/__tests__/check-runner.test.js:621`.

`a step whose need failed is never started even with fail-fast off`: there is no fail-fast-off mode. The test goes through the `halted` path, so disabling the `failedNeeds` guard (`check-steps.mjs:702`) stays green. Either rename it and say the guard is defence only, or add a hook that actually exercises the guard.

**N4. Ancestry doesn't prove what the report says it proves.**

Where: `docs/tasks/X10-check-throughput.report.md:43` ("The ancestry proof is what makes that copy as good as an original").

Ancestry ties a line to history, not to its `tree`. An edited `docs/tasks/*/gates.jsonl` line with any ancestor `head` and the current `tree` is accepted. Tree equality is the real evidence. Reword the claim, or bind `tree` to the digest of `head`'s commit. The M1 diff check would also make an edited line much harder to pass off.

**N5. Declared regions are incomplete.**

`lint`/`format` read the `nitrogen/` directory (only `nitrogen/generated` is ignored) and `manifest:check` lists `nitrogen/`. Neither is declared as reading `nitrogen/`. Today's order makes this safe only because `prepare` waits behind the ~140 s `test`, and `manifest:check` already `needs: ['prepare']`. The report's "everything else is per-process" overstates what the structural guard covers.

**N6. Stale or misleading comments and docs.**

- `check.mjs:251-256` says forwarding "re-raises on self so the exit status is still the signal". Installing a SIGINT/SIGTERM listener removes Node's default exit, so the run exits 1 after the children die.
- `gate-core.mjs:50` says "v3 adds `steps`"; the field is `stepTimings`.
- `gate.mjs:823-846` has the JSDoc for `otherBranchLedgers` twice.
- `CONTRIBUTING.md:142` says "up to half the machine's cores" but leaves out the cap of 4.
- `check-steps.mjs:264` says "~184 s chain"; the report measured 171.7 s.

## Questions for orchestrator

- M1 narrows the rule the brief worded as "code tree identical". I recommend the narrower rule: the diff from the checked commit to the merged `HEAD` must be `docs/`-only. It keeps the common case (main gained only task docs) and drops the false greens. The alternative is to put `bench/`, `.github/` and root `*.md` into a separate "check inputs" digest recorded on `check` lines. That is more general, but it changes the ledger again.
