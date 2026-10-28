# X10 re-review: `check` throughput, fix round 1

**Branch:** `task/X10-check-throughput` @ `4e27dd6` (fix round = `d1599fb..4e27dd6`)
**Verdict: FIX ROUND.** M2 and M3 are fixed, and each new test goes red on its own. M1 is fixed for the cases the round tested, but merge reuse can still accept a `check` on a tree it never ran on: `git diff --name-only` uses rename detection, so a move out of `bench/` (or any other non-docs path) into `docs/` shows up as a docs-only change (M1 below, reproduced end to end). The new `check-docs-drift.mjs` is a useful tripwire but not the proof it is described as. It fails open on relative imports, template literals, argv arrays and a test file under `docs/` (M2, M3). All of these are small to fix, but they need red tests, so they belong in a round.

## What I verified

- **M1 (round 0), the cases it names.** I replaced `const outside = pathsOutsideReuseExemption(...)` with `[]`, and 12 tests went red, including the CLI test with `bench/` only. The allowlist is matched by path, not by substring (`bench/docs/x.md` is refused).
- **M2 (round 0).** I mutated three things, and each one went red alone:
  - dropped `red` from the `applyReusedCheckRow` refusal → `a red local row is never overridden…` went red;
  - kept the *first* decisive line instead of the last → two M2 tests went red;
  - the newest-across-ledgers rule is covered by `a newer fail … beats an older pass`.
- **M3 (round 0).** Each mutation went red:
  - put the old `file://${path.resolve}` guard back in `check.mjs` → the space, symlink and no-op tests went red (3);
  - set `ranNothing = false` in `gate.mjs` → `a check that reports zero steps is a fail` went red.
- **N1–N6 (round 0)** are done as claimed:
  - **N1:** `gitEnv` deletes the `GIT_*` overrides, and `gitInTempRepo` asserts `--show-toplevel`.
  - **N2:** I pointed CI at `check:serial` and the test went red.
  - **N3:** I added `if (false && failedNeeds…)` and the test went red.
  - **N4:** reworded in the report and in ORCHESTRATOR.
  - **N5:** `nitrogen/` is a region, and lint/format are its readers.
  - **N6:** all five comment/doc fixes are present, and the duplicate JSDoc is gone.
- **Dependency.** `package.json` and `bun.lock` are unchanged in the fix round, and `scripts/` is not in `files`. So the published package is unchanged, and the lockfile is trivially consistent. But `@babel/parser` is imported without being declared (N1 below).
- **The jest files** `check-allowlist`, `gate-check` and `check-runner` pass at the tip: 139/139 under Node 24. The worktree is clean after every mutation (`git checkout -- .`, temp files removed).
- **Premises.** Every file and symbol the fix-round report names exists. `CHECK_REUSE_ALLOWLIST`/`EXCLUDE` semantics: an excluded path is always "outside", so it refuses reuse. That direction is correct.

## Must fix

**M1. A rename into `docs/` hides the deleted source from the reuse diff.**

Where: `scripts/gate.mjs:993` (`git diff --name-only -z sha..HEAD`) and `:1019` (status parsing); the comment at `:982` says "no rename detection".

The problem: `git diff` turns on rename detection by default (`diff.renames=true`), so `--name-only` prints only the destination of a rename. Separately, porcelain status codes are uppercase `R`/`C`, but the code tests `startsWith('r')`/`'c'`. So a staged rename's source path is parsed as a new entry with `slice(3)`: `bench/…` becomes `ch/…`. That happens to fail closed, but a three-character prefix such as `lib/docs/x` becomes `/docs/x`, which is then cleaned to `docs/x` and accepted.

Failure scenario: `main` runs `git mv bench/baselines/README.md docs/bench-baselines.md`. That README is the file gate-core itself says a jest test reads. Then the branch is merged.
- The code tree is unchanged, and `pathsChangedSince` returns only `docs/bench-baselines.md`.
- `need --for merge` prints `✓ check — green, reused … 1 path(s), all on the reuse allowlist (docs/bench-baselines.md)`.
- `bun run check` on that tree would fail the test that reads the README.

I reproduced this by injecting a test into `gate-check.test.js` next to the `bench/` CLI case, then reverted it.

Fix:
- pass `--no-renames` to both `git diff` and `git status`;
- test for `R`/`C`, not `r`/`c`;
- add a red CLI test for a rename `bench/… → docs/…`.

**M2. `check` runs test files under `docs/`, and nothing says so.**

Where: `package.json:211` (`testPathIgnorePatterns` has no `docs/`; `testMatch` is `**/*.test.[jt]s?(x)`), and `scripts/check-docs-drift.mjs:1244` onward.

The problem: the drift proof lists the tests and judges only their fs calls. It never asks whether a listed test file is itself under the allowlist, and it has no directory-level check for jest like `ignoreCoversDirectory` does for prettier and ESLint.

Failure scenario: a task commits a repro test as `docs/tasks/ZZ/repro.test.js`.
- `jest --listTests` lists it.
- `checkDocsDrift` returns `code 0`. I verified both.
- A merge that adds only that file passes the docs-only rule and reuses `check`, although `bun run check` would run it and fail.

Fix:
- add `<rootDir>/docs/` to `testPathIgnorePatterns`;
- have the proof fail when any `--listTests` entry, or any jest root/`testMatch` reach, lies under the allowlist (a directory check, as for prettier/ESLint);
- add a red test with a fixture `docs/x.test.js`.

**M3. The drift "proof" fails open on anything it cannot resolve, and the code claims it is a proof.**

Where: `scripts/check-docs-drift.mjs`:
- `:494-497`: a template literal with substitutions evaluates to `null`;
- `:612`/`:497`: an `ArrayExpression` argument is never evaluated, so `spawnSync('cat', ['docs/x'])` is invisible;
- `:643`: an unresolvable walk is not reported, on purpose;
- `:926`: a mention counts only if `join(root, value)` exists, so relative imports (`'./registry-core.mjs'`, `'../reader.mjs'`) are never followed;
- `:914`: `maxFiles` truncation stops silently.

Claims: the `gate-core.mjs:84-95` comment and the report ("*proves* that list") describe a proof.

Failure scenarios, each a mutation I ran and reverted; each returned `code 0`:
- (B) an existing test adds ``readFileSync(`${process.cwd()}/docs/PLAN.md`)``;
- (C) a new `scripts/__tests__/zz.test.js` imports `../zz-reader.mjs`, which does `readFileSync(path.join(repoRoot, 'docs', 'PLAN.md'))`;
- (D) a test does `spawnSync('cat', ['docs/PLAN.md'])`.

The control (the same read spelled `path.join(process.cwd(), 'docs', 'PLAN.md')` in the test itself) went red. The notes confirm the reach: `registry:check`, `perf:renders`, `autolinking:check` and `manifest:check` each judge **1** file, because `gen-registry.mjs` → `./registry-core.mjs` is never followed.

Today no real read slips through: I grepped every non-test file and test for `docs` paths. So this is about what the gate claims, not a current false green.

Fix, the minimum:
- follow relative `import`/`require`/`import()` specifiers, resolved from the importing file;
- treat a template literal whose static quasis name an allowlisted path as a read;
- evaluate array elements of spawn/exec calls;
- make truncation a violation.

Then either reword the comments and the report from "proves" to "a tripwire for the spellings it can resolve", or make an unresolved fs argument in a reached file a violation (with an exemption table).

## Nits / notes

- **N1.** `@babel/parser` is a phantom dependency.
  - Where: `scripts/check-docs-drift.mjs:58`.
  - It is imported but not declared. It resolves only because bun hoists `@babel/parser@7.29.9` as a transitive dependency of `@babel/core`/`@react-native/codegen`.
  - Failure scenario: a dependency bump or an isolated linker moves it, and the `test` step fails with a module-not-found error unrelated to the change. That fails closed, but it is confusing.
  - Fix: declare it as a devDependency (pinned to the locked version, so the lock stays consistent).
- **N2.** The tie-break is the opposite of its comment.
  - Where: `scripts/gate-core.mjs:969-974`.
  - The comment says "a fail wins a tie", but `b.result.localeCompare(a.result)` sorts `pass` first.
  - Failure scenario: a fail and a pass on the same tree with the same `ts`. With `findReusableCheck`, the result is `reused task/b (pass)`. Millisecond timestamps make this rare.
  - Fix: invert the comparison, and add a test.
- **N3.** The codegen spec-glob check is vacuous.
  - Where: `scripts/check-docs-drift.mjs:1259`.
  - It reads `nitro.specs`/`commonHeaders`, and `nitro.json` has neither key, so the check always prints "no specs" and passes. That is harmless today because bob runs `nitrogen src`, but the `gate-core.mjs:98` claim rests on nothing.
  - Fix: probe the real input (`nitrogen src`), or drop the claim.
- **N4.** Two read-only git calls inherit the environment.
  - Where: `scripts/__tests__/gate-check.test.js:1126`, `:1295`.
  - These are `spawnSync('git', ['rev-parse'|'merge-base' …])` with the inherited environment. They are read-only, so the worst case is a wrong assertion, not a mutation.
  - Fix: use `gitEnv(dir)` for consistency.

## Questions for orchestrator

- M3 scope: making the drift proof fail closed on every unresolved argument is a large change for a 1354-line file. I recommend the four mechanical closures listed under M3, plus rewording "proves" to "checks the spellings it can resolve". The alternative is to drop the static proof and keep only the tool probes plus a jest/tsc/prettier/ESLint directory-ignore check for `docs/`.

**Verdict: FIX ROUND**

- M1: `gate.mjs:993/1019`: rename detection and lowercase status codes let a `bench/… → docs/…` move reuse `check` (reproduced at the CLI).
- M2: `package.json:211` / `check-docs-drift.mjs:1244`: jest runs `docs/**/*.test.js`, and the proof neither forbids nor notices it.
- M3: `check-docs-drift.mjs:494/612/643/926/914`: unresolvable paths, relative imports, argv arrays and truncation are silent passes, while the code calls itself a proof.
- N1: `check-docs-drift.mjs:58`: `@babel/parser` is an undeclared, hoisted, transitive import; declare it as a devDependency.
- N2: `gate-core.mjs:969-974`: a pass wins a timestamp tie, against the comment.
- N3: `check-docs-drift.mjs:1259`: the spec-glob check reads keys `nitro.json` does not have, so it is vacuous.
- N4: `gate-check.test.js:1126/1295`: read-only git calls inherit `GIT_*`.
