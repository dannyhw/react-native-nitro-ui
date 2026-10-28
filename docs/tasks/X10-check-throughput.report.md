# X10 — `check` throughput: parallel steps, per-step timing, merge reuse

**Branch:** `task/X10-check-throughput` (from `main` at `20b4069`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — tooling only, no device (`AGENTS.md`: this task's brief names none)

## Summary

`bun run check` is now a dependency graph instead of one `&&` chain. The steps are the
same sixteen, in the same order: `scripts/check-steps.mjs` holds them as data, each with
the steps it `needs` and the output regions it `reads`/`writes`, and
`scripts/check.mjs` schedules that. `bun run check:serial` is the old chain, kept as the
reference and for timing against.

Three things a reviewer needs before the diff:

**Where the ordering comes from.** `prepare` (`bob build`) is the only interesting
writer: its `custom` target has `clean: "nitrogen/"`, so it *deletes and regenerates*
`nitrogen/` before writing `lib/`. Three steps read that tree — `nitrogen:check` (the
whole point of it), `test` (`src/__tests__/viewConfigs.test.ts` reads the generated
`*Config.json`) and `perf:renders` (its crawl walks `nitrogen/`) — so `prepare` runs
after all three. That also preserves a property the serial chain had by accident: after
`prepare` regenerates the directory, `nitrogen:check` could no longer fail. `api-extractor:check`,
`publint` and `manifest:check` wait on `prepare` because they read `lib/`.

**The one race that is not on disk.** `test` and `perf:renders` share Jest's cache
directory: reassure spawns Jest with `--runInBand` and no `--config`, so both runs get
the same `id` (`jest-config` hashes rootDir + config path + project index) and the same
roots, and `jest-haste-map`'s cache path is derived from exactly those — one file,
written with a plain `writeFileSync`, no lock. They share the `jest` group, so they
never overlap. Everything else is per-process (`native-tests.sh` uses `$$`,
`nitrogen-check.mjs` uses `mkdtemp`, api-extractor writes `.turbo/`, which nothing
reads). `findOutputConflicts` checks the declared regions structurally and the runner
refuses to start on a conflict.

**Output order is declared order, not completion order.** Each log is buffered and
printed whole, and the blocks go out in step order as they become ready. That keeps the
ledger quoting the *unit-test* Jest summary rather than whichever Jest finished first
(X2's M3). One live summary line per step keeps a long first step from looking like a
hang; a failing step's log is repeated last. First failure stops new starts, running
steps finish, everything else is reported `skipped`, exit 1.

Default concurrency is `min(4, cores/2)` (the heavy steps already fan out internally —
Jest uses cores−1 workers — so the graph only has to hide the tails around the long
pole); `--jobs N` overrides. `test` alone is 147 s of a ~180 s chain, which is the
honest limit on the win: see the timing table.

## Timings

Same tree (`790094a85f39`), 10 logical cores, alternating order after one discarded
warm-up. `<fill from /private/var/folders/x4/gfxkqk050bsfv_m60wfk2psc0000gn/T/opencode/x10-timings.jsonl>`

| Run | Wall | Load avg before → after |
| --- | --- | --- |
| medians | serial `<x>` s / parallel `<y>` s | — |

Machine load: `<contended or not — X11 was running device work on this box; state the
load numbers and whether they moved during the series>`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `<node scripts/gate.mjs table>` |

`need --for review`: `<line>`

## Red proofs

19 mutations, each applied alone and reverted (`test -> mutation -> the line that went
red`):

- `check-runner › check:serial is exactly what the graph declares` -> append `&& bun run smoke:pack` to `check:serial` -> `expect(serialChainFromSteps(CHECK_STEPS)).toBe(packageJson.scripts['check:serial'])`
- same test -> delete ` && bun run readme:check` from the chain -> same assertion, the other direction
- `check-runner › the runner refuses to start when the chain and the graph differ` -> `prepare.needs: []` -> `shared output: prepare writes nitrogen/generated while test reads it`
- `check-runner › the runner refuses…` -> `perf:renders.group: null` -> `shared output: test and perf:renders both write jest-cache`
- `check-runner › prints each step log whole, in step order` -> forward `chunk` to stdout as it arrives -> the owners array interleaves at the first foreign line
- `check-runner › on a failing step… prints that log last` -> drop the `done` summary line -> `expect(run.stdout).toMatch(/✗ lock:check fail/)`
- `check-runner › on a failing step…` -> `for (const name of [])` around the trailing logs -> `expect(lastRule).toBeGreaterThan(-1)`
- `check-runner › never runs more steps at once than --jobs` -> `slots = 99` -> `expect(peak).toBeLessThanOrEqual(jobs)`
- `check-runner › on the first failure it starts nothing new` -> `if (false …) halted = …` -> `expect(status['nitrogen:check']).toBe('skipped')`
- `check-runner › a log is printed whole, in declared step order` -> flush in completion order -> `expect(flushes).toEqual(stepNames())`
- `gate-check › puts them on the ledger line, and table --full prints them` -> gate.mjs never sets `NITRO_UI_CHECK_STEPS_FILE` -> `expect(line.stepTimings.jobs).toBe(4)`
- `gate-check › a corrupt timing file is ignored` -> drop the shape check in `readStepTimings` -> `expect(line.stepTimings).toBeNull()`
- `gate-check › refuses a commit that is not in this history` -> skip `headIsAncestor` -> squash-merge case reads as proof
- `gate-check › refuses a red line` -> drop `result === 'pass'` -> the reuse is accepted
- `gate-check › will not carry a device gate across` -> ignore `entry.gate` -> `harness:ios` reused
- `gate-check › refuses a run whose tree moved under it (N1)` -> ignore `treeAfter` -> a mid-run tree move reads as proof
- `gate-check › does not touch review` -> reuse at any stage -> `expect(row.state).toBe('missing')`
- `gate-check › renderGateTable agrees with need` -> drop `*(reused)*` from the label -> the table hides the borrow
- `gate-check › scripts/check.mjs is check-only tooling` -> remove it from `TOOLING_FILES` -> `isToolingPath('scripts/check.mjs')` is false

## Files changed

- `scripts/check-steps.mjs` (new) — the step graph as data, the scheduler, `planProblems`, the default-jobs formula. No `import.meta`, so jest can import it.
- `scripts/check.mjs` (new) — spawn, buffer, print, write the timing record.
- `package.json` — `check` → the runner; `check:serial` → the old chain.
- `scripts/gate.mjs`, `scripts/gate-core.mjs` — `stepTimings` on the line (LEDGER_VERSION 3), `table --full` step table, `findReusableCheck`/`applyReusedCheckRow`, `TOOLING_FILES`.
- `scripts/__tests__/check-runner.test.js`, `scripts/__tests__/gate-check.test.js` (new); `registry.test.js`, `example-lock.test.js` — assert against `check:serial` and the graph.
- `docs/tasks/ORCHESTRATOR.md`, `CONTRIBUTING.md` — the merge-reuse rule, the runner.

## Follow-ups

- check: `test` is 147 s of a ~180 s chain, so the ceiling on this work is ~1.2×; a real
  win needs someone to split the jest run, which is out of scope here.
- context-pack claim that is wrong: `manifest:check` does **not** re-run `prepare` —
  `scripts/package-files.mjs` passes `npm pack --dry-run --ignore-scripts`, so nothing
  is rebuilt and no tarball is written. The graph treats it as a `lib/` reader only.
- gate: `gate.mjs table --full` prints step rows for whatever the newest line has, which
  is `check` today; if a second gate ever records a breakdown the heading already says
  which gate it belongs to.
