# F4 — CI green on every trigger

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task F4 --boot`), needed only if you touch harness
code. A6 is running on another machine, so both of this machine's pairs are free.

Read first: `docs/tasks/Q4-followups-triage.md`, rows 6, 12, 53, 54 and 55, and the F4 line in
`docs/tasks/FOLLOWUPS.md`. Some cells there may already be fixed on `main`, so re-read each one against `main`
before you change it. If an item is already done, close it with one line saying where.

## Why

`main` was red for about 7 hours on 31 Oct, and nobody noticed: CI's depth-1 checkout had no `HEAD~5`; fixed in
`96ad69c`. The workflows still have known holes:
- **Pushes to `main` cancel each other's CI runs.** Several runs today ended `cancelled`, so a sha can land with
  no result at all.
- **The two harness jobs run only on `workflow_dispatch`,** and the Android one was red inside the upstream action
  the last time anyone ran it.
- **A handful of release-pipeline nits** are still open.

## Do

1. **CI concurrency.** `ci.yml` cancels in-progress runs on every ref, `main` included.
   - Cancel superseded runs on PR and feature refs only. Every push to `main` must finish with a conclusion.
   - Check `release.yml` and `release-tag.yml` keep `cancel-in-progress: false`.
2. **The harness jobs work when dispatched.**
   - `Harness (Android)` failed inside `callstackincubator/react-native-harness` (Q4 row 55: `app:` is passed as a
     relative path, and the action parsed an empty JSON input). Read the action's `action.yml` at the pinned sha
     from its repo, read-only, and fix the inputs. Do the same check for `Harness (iOS)`.
   - Don't change the triggers; dispatch-only is deliberate, for cost.
3. **Release pipeline nits** (row 53):
   - **Cron minute:** `release-tag.yml`'s cron runs at minute 0. Move it off the hour.
   - **Cache in `pack`:** the `pack` job installs through the cached composite. A publish artifact shouldn't be
     built from a restored `node_modules`. Make `pack` install without the cache, as `stage` already does.
   - **"Already staged" branch:** check it matches both npm wordings, the E409 "Cannot stage previously
     published version" and the older one. It may already be fixed.
   - **`release-catch-up.mjs`:** R6's N-2 says it tags the wrong commit. Verify it, and fix it with a test shown
     red.
4. **X1 re-review leftovers** (row 54):
   - The `HARNESS_APP_PATH` refusal must not suggest the path it then refuses (`example/rn-harness.config.mjs`).
   - Correct the doc table's `20HybridNitroUiSwitch` to 19 characters (`scripts/app-stamp-core.mjs`).
   - Fix the always-true assertion in `scripts/__tests__/lease.test.js` (around line 1066). Show it red.
   - `scripts/harness.mjs` names `harness:android` on every platform. Name the real one.
   - `build-app.mjs --clean` drops DerivedData only. Either make it clean what its help says, or make the help
     say what it does.
5. **iOS < 26 fallback row** (rows 6 and 12).
   - Find out whether the `macos-26` runner image has an iOS 18 simulator runtime: its published image manifest,
     read-only.
   - If it does, add a dispatch-only `Harness (iOS 18)` row (or a matrix entry) that runs the declared-fallback
     suites on it.
   - If it doesn't, say so with the source, and leave a one-line follow-up. Don't download runtimes onto this
     machine.

## How CI gets proven

You can't push. When your round is done:
- give me a list of exactly which workflow runs to dispatch on your branch, and what each one should show;
- end your report with a "CI to dispatch" section.

I'll push the branch to origin, dispatch them, and send you the results as a fix round. Locally, lint every
workflow you change. `actionlint` isn't installed, so use a pinned `npx`/`bunx` copy if you need one, or YAML
parsing plus the repo's workflow tests in `scripts/__tests__`, which already read `ci.yml`.

Every new test or check must be shown red first (AGENTS.md).

## Not in scope

F5 (perf axes), the G1/Button/G3/G4 verifier leftovers, and changing which events trigger the harness jobs.

## Gates

`check`. Run both `harness:*` only if you change harness-side code (`example/rn-harness.config.mjs`,
`scripts/harness.mjs`), and in that case on both platforms. Then `need --for review`. Report at
`docs/tasks/F4-ci-green.report.md`, with the ledger exported.
