# X10 — `check` throughput: parallel steps, per-step timing, merge reuse

**Branch:** `task/X10-check-throughput` (from `main` at `20b4069`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — the brief names no device and this task touches none.

## Summary

`bun run check` is a dependency graph now instead of one `&&` chain. The steps are the
same sixteen, in the same order: `scripts/check-steps.mjs` holds them as data, each
with the steps it `needs` and the output regions it `reads`/`writes`, and
`scripts/check.mjs` schedules that graph. `bun run check:serial` is the old chain, kept
as the reference and for timing against.

What a reviewer needs before the diff:

**Where the ordering comes from.** `prepare` (`bob build`) is the only interesting
writer: its `custom` target has `clean: "nitrogen/"`, so it *deletes and regenerates*
`nitrogen/` before writing `lib/`. Three steps read that tree — `nitrogen:check` (the
point of it), `test` (`viewConfigs.test.ts` reads the generated `*Config.json`) and
`perf:renders` (its crawl walks `nitrogen/`) — so `prepare` runs after all three. That
keeps a property the serial chain had by accident: once `prepare` regenerates the
directory, `nitrogen:check` can no longer fail. `findOutputConflicts` compares the
declared regions structurally and the runner refuses to start on a conflict, so a new
unordered writer is caught in a test, not as a flaky gate.

**The one race that is not on disk.** `test` and `perf:renders` share Jest's cache:
reassure spawns Jest with no `--config`, so both runs get the same `id`
(`jest-config` hashes rootDir + config path + project index) and the same roots, and
`jest-haste-map`'s cache path comes from exactly those — one file, no lock. They share
the `jest` group. Everything else is per-process (`$$`, `mkdtemp`, `.turbo/`).

**Output order is declared order, not completion order.** Logs are buffered, printed
whole, in step order as they become ready — which keeps the ledger quoting the
*unit-test* Jest summary rather than whichever Jest finished first (X2's M3). A live
summary line per step keeps a long first step from looking like a hang; a failing
step's log is repeated last. First failure stops new starts, running steps finish, the
rest report `skipped`, exit 1. Default concurrency is `min(4, cores/2)` — the heavy
steps fan out internally already (Jest uses cores−1 workers), so the graph only hides
tails. `--jobs N` overrides. `test` alone is 147 s of a ~180 s chain: the ceiling.

Merge reuse went wider than the brief: it also reads the **committed**
`docs/tasks/<ID>/gates.jsonl`, because `.gates/` is gitignored and the checkout where a
merge is confirmed has never seen the worktree's ledger. What that copy proves is
narrower than "as good as an original" (fixed-round N4): ancestry ties a line to this
history and tree equality ties it to content, but nothing in git signs the line, so a
committed ledger is self-attested text. ORCHESTRATOR step 5 says so where a merge is
decided, and fix round 1 is what makes the borrow sound enough to lean on.

## Timings

Tree `1dbe8b4dc4f3`, one 10-core box, alternating after one discarded warm-up. **Serial
median 171.7 s, parallel median 152.0 s — 1.13×.** Spread within a kind was ≤ 0.6 s, so
the difference is not noise.

| Run | Kind | Wall | Load avg (1m) before → after |
| --- | --- | --- | --- |
| warm-up (discarded) | parallel | 152.2 s | 1.80 → 1.90 |
| serial-1 | serial | 171.7 s | 1.90 → 2.11 |
| parallel-1 | parallel | 152.0 s | 2.11 → 1.93 |
| serial-2 | serial | 171.8 s | 1.93 → 1.57 |
| parallel-2 | parallel | 152.3 s | 1.57 → 3.36 |
| serial-3 | serial | 171.2 s | 3.36 → 3.04 |
| parallel-3 | parallel | 151.4 s | 3.04 → 2.33 |

**The machine was close to idle, and the runs agree with each other.** The 1-minute load
average stayed between 1.57 and 3.36 across all six runs (10 cores). X11's device work
was on this box during the window and does show up in the tail of it, but not as
sustained load, and the three serial runs agree to within 0.6 s against each other —
which they would not have done under real contention — that agreement is the stronger
of the two arguments. Two caveats, stated rather than papered over: macOS's load average
runs lower than Linux's for the same work, so it is a trend indicator here and not an
absolute; and the harness samples its `jest|gradle|swiftc` count *after* each run, where
it read 1 every time, so it shows nothing heavy lingering between runs but says nothing
about what else ran during one.

1.13× is the honest number and it is close to the ceiling: `test` alone is 147 s of the
171 s chain and nothing can overlap it (it must precede `prepare`, and `perf:renders`
must not run beside it), so at most ~25 s of tail is available to hide. Default
concurrency is 4 (`min(4, cores/2)`); I did not sweep other job counts on this tree, so
the number above is what the default delivers rather than a tuned optimum.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 744 tests / 35 suites | `1dbe8b4dc4f3` | 2 m 31 s | start 1.9 / med 2.2 / max 3.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android`
— **review is not satisfied.** This round took no lease and touched no device, as the
brief instructs, so it reports the gap rather than claiming the bar. The cause is the
mapping, not the change: the only file in the diff that is neither tooling nor docs is
`package.json`, which is unmapped → both platforms. Its diff is two lines inside
`scripts` (`check` points at the runner; the old chain moves to `check:serial`) — no
dependency, no bob target, nothing a binary reads. X9's report already lists
`package.json`'s mapping as a follow-up.

**Net of both effects, in the recorded run:** the step durations sum to 176.1 s against
a 150.9 s wall, so 25.2 s of tail was hidden — but that sum is 4.4 s *above* the serial
chain's 171.7 s, because Jest shared cores with `lint` and `test:native`. The 20.8 s
saving is what is left after paying for that. The step table is in the appendix. (The
row's 744 tests / 35 suites is this branch's own total: 665 / 33 with the two files
added here removed, plus `check-runner` 38 and `gate-check` 41. The log's *second* Jest
summary is the perf run's 7 / 7, which is the one `counts` must not quote; X2's M3.)

## Live proofs

- **Merge reuse, in the checkout where it matters.** A second worktree at `main`
  (`x10-merge-proof`, no `.gates/` of its own), merging `task/X10-check-throughput`:
  `need --for merge` printed `✓ check — green, reused from
  \`task/X10-check-throughput\`'s ledger` with the note naming
  `docs/tasks/X10/gates.jsonl`, tree `1dbe8b4dc4f3`, commit `67d9af5`; `table --for
  merge` showed `**PASS** *(reused)*`; `--no-reuse` went back to `✗ check — never run
  on this tree` and 5 missing. Adding one commit to that branch and re-running refused
  the reuse (0 mentions, `✗ check`) — the merged tree was no longer the tree that
  passed. Proof worktree and branch removed afterwards.
- **Incident, reported not hidden.** The first attempt at that proof had a `cd` that
  silently failed, so its `git merge` ran in the **human's main checkout** and left a
  merge commit on `main`. Undone with `git reset --keep b943a3f` within the minute —
  nothing was pushed, nothing else was on `main` (the pre-merge commit `b943a3f` and its
  tree are intact, `git status` clean, no hooks ran). The redo used a quoted absolute
  path and checked `pwd` before merging. Also caught: `git worktree add` from inside
  another worktree resolves relative paths against the *repository*, not the cwd, so it
  had created a nested `nitro-ui-worktrees/nitro-ui-worktrees/` directory; removed.
- **The 4 jobs are real.** The recorded run's step durations sum to 176.1 s against a
  150.9 s wall, and `test` (139.6 s) is 92% of it — the visible overlap is
  `typecheck`/`lint`/`format`/`test:native`/`nitrogen:check` running beside it.
- 29 mutations, each applied alone to the committed tree, jest run, file restored —
  **28 went red**, and the 1 that stayed green is listed as such below with why.

## Red proofs

29 mutations, each applied alone to the final tree, jest run, file restored
(`test -> mutation -> the line that went red`):

- `` `check:serial` is exactly what the graph declares `` -> append `&& bun run smoke:pack` to `check:serial` -> `expect(serialChainFromSteps(CHECK_STEPS)).toBe(packageJson.scripts['check:serial'])`
- same test -> delete ` && bun run readme:check` -> same assertion, other direction
- `the runner refuses to start when the chain and the graph differ` -> `prepare.needs = []` -> `shared output: prepare writes nitrogen/generated while test reads it`
- `the runner refuses a graph that races over a shared output` -> `perf:renders.group = null` -> `shared output: test and perf:renders both write jest-cache`
- same test -> `publint.needs = []` -> `shared output: prepare writes lib while publint reads it`
- `prints each step log whole, in step order, however the children interleave` -> write each stdout chunk to the parent as it arrives -> `expect(owners).toEqual(CHECK_STEPS.flatMap(step => Array(21).fill(step.name)))`, foreign line inside the first block
- `on a failing step: … prints that log last` -> drop the `done` summary line -> `expect(run.stdout).toMatch(/✗ lock:check fail/)`
- same test -> `for (const name of [])` around the trailing blocks -> `expect(lastRule).toBeGreaterThan(-1)`
- `writes the per-step timing record, and does not leak the file variable` -> keep `NITRO_UI_CHECK_STEPS_FILE` in the child env -> `expect(…every(e => e.extra === 'stepsfile=unset')).toBe(true)`
- `never runs more steps at once than --jobs` -> `slots = 99` -> `expect(peak).toBeLessThanOrEqual(jobs)`
- `on the first failure it starts nothing new…` -> never set `halted` -> `expect(status['nitrogen:check']).toBe('skipped')`
- `a log is printed whole, in declared step order` -> flush in completion order -> `expect(flushes).toEqual(stepNames())`
- `two steps in a group never overlap` -> ignore `groupsBusy` on start -> `expect(inFlight.has('jest')).toBe(false)`
- `the CI job runs this same runner, under the same name` -> CI runs its own `typecheck && test` -> `expect(job[1]).toContain('run: bun run check')`
- same test -> rename the job `Checks (parallel)` -> `expect(job[1]).toMatch(/^ {4}name: Checks\n/)`
- `puts them on the ledger line, and table --full prints them` -> gate.mjs never sets `NITRO_UI_CHECK_STEPS_FILE` -> `expect(line.stepTimings.jobs).toBe(4)`
- `a corrupt timing file is ignored rather than recorded as nonsense` -> drop the shape check in `readStepTimings` -> `expect(line.stepTimings).toBeNull()`
- `drops entries that are not steps rather than rendering an empty row` -> loosen the filter to `step != null` -> the nameless entry survives into the row list
- `refuses a commit that is not in this history` -> skip `headIsAncestor` -> a squash merge reads as proof
- `refuses a red line` -> drop `result === 'pass'` -> the reuse is accepted
- `will not carry a device gate across` -> ignore `entry.gate` -> `harness:ios` is reused
- `refuses a run whose tree moved under it (N1)` -> ignore `treeAfter` -> a mid-run tree move reads as proof
- `does not touch review` -> apply reuse at any stage -> `expect(row.state).toBe('missing')`
- same guard from the CLI's side -> `commandNeed` asks for reuse at review too -> **stayed green**: the CLI-side mutation only adds a call that `applyReusedCheckRow`'s own guard refuses, and that guard is the line proven above. The new `does not reuse at review, even when another branch has a qualifying line` case is the CLI-level assertion for the behaviour.
- `renderGateTable agrees with need, pipe for pipe` -> drop `*(reused)*` from the label -> the table hides the borrow
- `scripts/check.mjs is check-only tooling` -> remove it from `TOOLING_FILES` -> `isToolingPath('scripts/check.mjs')` is false
- `scripts/registry-core.mjs is check-only tooling` -> remove it -> same
- `what a device run really depends on is still mapped` -> add `scripts/build-app.mjs` to `TOOLING_FILES` -> `expect(isToolingPath('scripts/build-app.mjs')).toBe(false)`
- `--no-reuse asks the strict question` -> `reuse = true` on the flag -> the strict run still borrowed

### Fix round 1

Each applied alone, jest run, file restored:

- `refuses when the merge adds bench/src/Main.tsx - M1` (and 10 siblings, incl. the CLI-level bench case) -> `const outside = pathsOutsideReuseExemption(...)` replaced by `[]` -> the pure-function cases and `need --for merge` both print `reused`
- `takes the newest line when two branches both qualify` -> sort by `a.ts` before `b.ts` (oldest wins) -> `expect(found.branch).toBe('task/newer')`
- `a newer fail on the tree beats an older pass, even from another branch - M2` -> same inversion -> the older pass wins and reuse is accepted
- `a ledger whose own newest line on the tree is a fail offers nothing - M2` -> keep the *first* decisive line instead of the last -> the 10:00 pass is reused over the 11:00 fail
- `a red local row is never overridden by another branch pass` -> drop `red` from `applyReusedCheckRow`'s refusal -> the borrowed green prints over this checkout's failure
- `runs steps from a checkout whose path contains a space` / `…through a symlink to itself` / `a no-op runner is visible` -> entry guard back to `` `file://${path.resolve(argv[1])}` `` -> all three: exit 0 with no step-list header
- `a check that reports zero steps is a fail` -> `ranNothing = false` -> exit 0 and `result: pass` for a run that started nothing
- same test -> `if (result === 'fail') return …` removed from the CLI tail -> the ledger records the fail but `gate.mjs check` exits 0
- `strips every environment variable that overrides cwd` (N1) -> `gitEnv` stops deleting the `GIT_*` overrides -> `--show-toplevel` answers about the second repo, exactly as in the review's incident
- `a redirected git really does reach the victim, and gitEnv stops it` -> helper keeps `GIT_DIR` -> the victim's HEAD moves
- `a step whose need failed is never started - and that guard has a mode that reaches it` (N3) -> `if (false && failedNeeds.length > 0)` -> `expect(startedWide.sort()).toEqual(['a','d'])`
- `the CI job runs this same runner, under the same name` (N2) -> CI's step to `run: bun run check:serial` -> `/^ {8}run: bun run check\n/m`
- `` `nitrogen/` as a whole is a region, and lint/format are its readers `` (N5) -> drop `lint`/`format` from `prepare.needs` -> `findOutputConflicts` names both pairs
- `is red for source that will not parse` (M1 proof) -> unparseable `.mjs` falls through to the text branch -> `violations` is empty for a file the scan cannot read
- `refuses the mkdtemp excuse for a path that exists in this checkout` -> the real-file check returns `false` -> the read is excused as fixture data
- `an excluded read is recorded, and never smuggled through an exemption` + `passes: no step of check reads the reuse allowlist` -> exclude-awareness removed -> `ORCHESTRATOR.md` is reported as a violation, and the accounting test has no excluded reads


## Files changed

- `scripts/check-steps.mjs` (new) — the step graph as data, the scheduler, `planProblems`, the default-jobs formula. No `import.meta`, so jest can import it.
- `scripts/check.mjs` (new) — spawn, buffer, print, write the timing record.
- `package.json` — `check` → the runner; `check:serial` → the old chain.
- `scripts/gate.mjs`, `scripts/gate-core.mjs` — `stepTimings` on the ledger line (LEDGER_VERSION 3), `table --full` step table, `findReusableCheck`/`applyReusedCheckRow` over `.gates/` and the committed task exports, `TOOLING_FILES`.
- `scripts/__tests__/check-runner.test.js`, `scripts/__tests__/gate-check.test.js` (new); `registry.test.js`, `example-lock.test.js` — assert against `check:serial` and the graph.
- `docs/tasks/ORCHESTRATOR.md`, `CONTRIBUTING.md` — the merge-reuse rule and the runner. CI needed no change: the `Checks` job already calls `bun run check`, so it inherits the runner with its name and required status intact, which a test now pins.

## Fix round 1

**M1.** Reuse now requires every path the merge adds (committed diff plus untracked) to be on
`CHECK_REUSE_ALLOWLIST`, and `scripts/check-docs-drift.mjs` *proves* that list from each step's
own inputs: script graphs, the jest run's real `--listTests`, prettier/eslint's ignore verdicts,
the pack list. It runs inside `test`, so the step list is unchanged. It found two violations on
its first runs — `gate.mjs` walking `docs/tasks`, and my own new test reading
`docs/tasks/ORCHESTRATOR.md` — now excluded paths reuse refuses over, not exemptions I granted
myself. The reviewer's `bench/` case is a CLI test; 28 proof tests, each shown red.

**M2.** Newest decisive line per ledger, newest across ledgers, fail beats pass, a red local row
never overridden — both directions red.

**M3.** The entry guard realpaths its own path; `gate.mjs` fails a `check` reporting zero steps
and exits non-zero for it.

**N1–N6** done; N4 stated in ORCHESTRATOR. New files are tooling; the package is byte-identical.
`need` still owes the two device gates — `package.json` is unmapped, as in round 0.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 804 tests / 36 suites | `28842f15a375` | 2 m 33 s | start 15.1 / med 5.6 / max 15.1 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`gate.mjs check` green on tree `28842f15a375` at `c0d97f6`; `need --for review` exits 1 with
`2 gate(s) missing for review: harness:ios, harness:android`. `test` is 2 m 21 s of that wall
at 4 jobs — the drift proof adds ~7 s of a ~150 s run.

## Fix round 2

**Reuse is now exact-tree.** `check` records `fullTree` (`git rev-parse HEAD^{tree}`) and
`worktreeClean` on every line (ledger v4), and `need --for merge` accepts a line only when its
`fullTree` equals the merge result's, it ran clean, the caller's worktree is clean, its commit is
merged, and it is the newest decisive line on that tree. Any change since — a report, a rename —
re-owns the run. The allowlist, the exclusions, `pathsChangedSince`, `check-docs-drift.mjs` and its
tests are deleted, so N1's undeclared `@babel/parser` and N3's vacuous spec-glob check go with them;
M1/M2/M3 close together, because an exact hash is not fooled by a rename or by a file nobody listed.
N2 fixed (a fail now wins a timestamp tie); N4's two raw calls went with the tests that held them.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 772 tests / 35 suites | `8495687a1138` | 2 m 36 s | start 2.9 / med 5.5 / max 7.7 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`gate.mjs check` green on tree `8495687a1138` (git tree `d8c342eac4b3`) at `efcbc46`;
`need --for review` exits 1 with `2 gate(s) missing for review: harness:ios, harness:android`,
`package.json` unmapped as in round 0. Red proofs in their own section below. `check` is 3 s
slower than round 1 — deleting the drift proof is offset by nine new end-to-end cases.

## Files changed (fix round 2)

- `scripts/gate-core.mjs` — ledger v4 (`fullTree`, `worktreeClean`), `fullTreesMatch`, `shortTreeHash`; `CHECK_REUSE_ALLOWLIST`, `CHECK_REUSE_EXCLUDE`, `isReuseAllowlistedPath` and `pathsOutsideReuseExemption` deleted; `findReusableCheck` rewritten; N2 tie-break.
- `scripts/gate.mjs` — `readTrees` reads the git tree and the worktree state, `runGate` records both ends of the run, `status` and the run banner print them; `pathsChangedSince` deleted.
- `scripts/check-docs-drift.mjs`, `scripts/__tests__/check-allowlist.test.js` — deleted, with the undeclared `@babel/parser` import that only they used.
- `scripts/__tests__/gate-check.test.js` — the reuse suites rewritten; the refusals are now also run end to end through the CLI.
- `docs/tasks/ORCHESTRATOR.md` — step 5 states the exact-tree rule and what it costs.

## Red proofs (fix round 2)

- `` `fullTreesMatch` is exact `` -> `return false` -> 11 refusals-styled assertions red (the accept cases: `accepts a pass on this exact tree…`, both CLI reuse cases); -> `return true` -> 7 assertions red (`refuses a line about a different tree`, the docs-only merge, the rename, the export merge, `is exact, and nothing short of exact`).
- `refuses a line recorded over a dirty worktree…` -> `worktreeClean` on the line ignored -> that assertion plus `says why it refused`; -> `gate.mjs` records `worktreeClean: true` -> `will not reuse a check recorded over uncommitted edits` red end to end.
- `refuses when this worktree is dirty…` (both) -> the caller's `worktreeClean` ignored -> `expect(…diagnostics).toContain('uncommitted changes')` and the CLI's `check — never run on this tree`.
- `will not reuse a check whose tree moved out from under it` -> `fullTree: before.fullTree` -> `expect(line.fullTree).toBeNull()` red on a mid-run docs commit.
- `a ledger whose own newest line on the tree is a fail offers nothing` -> keep the *first* decisive line -> `expect(ask(…)).toBeNull()`; -> cross-ledger sort inverted -> 4 M2 assertions red.
- `an exact timestamp tie resolves against reuse (N2)` -> the round-1 comparison back -> that test red, alone.
- `prints the reuse pair in status…` -> the `git tree` line dropped -> `expect(clean.stderr).toContain('git tree')`; dirty half red on `'worktree clean'`.

## Follow-ups

- check: `test` is 147 s of a ~180 s chain, so this work's ceiling is ~1.2x; a real win needs someone to split the Jest run, which the brief puts out of scope.
- context-pack claim that is wrong: `manifest:check` does **not** re-run `prepare` - `scripts/package-files.mjs` passes `npm pack --dry-run --ignore-scripts`, so nothing is rebuilt and no tarball is written. The graph treats it as a `lib/` reader only.
- gate: `gate.mjs wait`'s progress line shows the gate's own heartbeat, not the runner's step list; `table --full` only reports steps after the run. X9's territory.
- gate: reuse takes the newest qualifying line across all task exports; on this machine `docs/tasks/*/gates.jsonl` is 6 files and reads in milliseconds, but a repo with hundreds of exports would want an index.
- gate (fix round): reuse can never borrow from an export that arrives with the merge it certifies (an export is always younger than the line inside it). That is correct but surprising, and `gate.mjs export` could say so at the point of use rather than in ORCHESTRATOR.
- gate (fix round 2, flake): `scripts/__tests__/gate.test.js` > "starts detached, records the same line a foreground run would, and wait reports it" - `expect(wait.stderr).toContain('Compiling Switch.swift')` saw only the `gate: log …` line and then `gate: … passed`, i.e. `wait` printed no progress line carrying the fake heartbeat. Green 3/3 under `-t "starts detached"` and inside the round-2 `check`; load-sensitive, not reproduced on demand.

## Questions for orchestrator

None. Round 2 is the last under D19 and the brief was unambiguous once the exact-tree decision came down.
