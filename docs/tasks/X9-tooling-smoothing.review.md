# X9 review — tooling: dry runs, warm caches, one build at a time, gate waits

**Branch:** `task/X9-tooling-smoothing` @ `3549be7` (merge-base `d572e68`) · **Reviewer round:** 1

## Verdict: MERGE WITH FIXES

All six brief items are implemented, and the code is careful. `need --for review` is satisfied on
this tree (re-run by the reviewer). Both must-fixes are documentation: CONTRIBUTING's release section
now says something false about `release:version`, and one docstring names a script that does not
exist. Neither needs a device or a code change. The strongest nice-to-have is N1, a churn guard on the
release refresh.

## What I verified

- **Release workflow (item 2), against the orchestrator's conditions.**
  - *The action commits the whole tree:* `version-script: bun run release:version` runs
    `changeset version && node scripts/sync-example-lock.mjs --fix` in the action's working tree,
    and the action commits straight after it, so the lock is part of the Version Packages commit.
    I could not read the pinned action's source here (no local clone). The report's mechanism
    (`@changesets/ghcommit`) is unconfirmed, but the default git-cli mode also commits every
    non-ignored change, so the conclusion holds either way (N8).
  - *Fails loudly:* if `pod install` fails, or the lock is still stale after it, `--fix` exits 1.
    The action then fails the step before it commits or pushes. The post-step
    `Confirm the lock followed the version` (`release.yml:308`) is honestly labelled as a report,
    not a guard.
  - *The guard names the fix:* I bumped `package.json` to 0.3.2 and `bun run lock:check` exited 1
    with "Fix locally: … --fix" plus the release-path explanation, then reverted.
  - *Proven locally:* the report's real CocoaPods 1.17.0 run is plausible and consistent with the code.
- **Could anything in `.github/workflows/` break a release?** I found nothing.
  - `macos-26` is already a label in `ci.yml:74`.
  - The `setup-ruby` SHA and Ruby 3.3 match `ci.yml`'s iOS job.
  - `permissions` are unchanged (`contents`/`pull-requests: write`, no `id-token`).
  - `stage` and `pack` are untouched, `version` has no outputs, and nothing `needs: version`.
  - The composite setup action already runs on macOS for `harness-ios`.
  - `RCT_USE_PREBUILT_RNCORE`/`RCT_USE_RN_DEP` are not set in `version`, but this RN's
    `react_native_pods.rb:116-117` defaults both to `1`. So the pod graph matches the committed lock
    (`React-Core-prebuilt`, `ReactNativeDependencies`).
  - `pack` now runs `lock:check` on Linux, which is green on main (0.3.1 / 0.3.1).
- **Tests and mutations I ran** (each reverted with `git checkout -- .`; tree clean afterwards):
  - 6 suites, 166 tests green under Node 24; `bun run lock:check` green.
  - `sideEffectsToUndo` scope dropped from `remove` → 2 red. ✔
  - `releaseBuildSlot` also releasing by task name → `releases only the slot it took…` red. ✔
  - runner never writes `done` (`gate.mjs` `if (options.recordPath != null)` → `if (false)`) → 4
    background/wait tests red. ✔
  - `const echo = true` for a backgrounded run (every log line written twice) → **all green** (N5).
  - `sync-example-lock.mjs`: `git restore` removed **and** `keepCocoapodsStamp` disabled → **all 23
    green** (N2).
- **Premises:** every file and symbol the report names exists at the tip, except
  `bun run release:version:lock` (M2). The report's "package untouched" claim holds:
  `git diff d572e68 HEAD -- src ios cpp android nitrogen etc` is empty.

## Must fix

**M1 — CONTRIBUTING's release section is now wrong.** `CONTRIBUTING.md:773-777`, `:826`, `:903-905`.
- Step 2 says the Version Packages PR "bumps `package.json`, prepends the notes to `CHANGELOG.md`
  and deletes the changeset files". It now also refreshes `example/ios/Podfile.lock`.
- The jobs table describes `version` without its macOS runner or CocoaPods.
- `:903` says "`bun run release:version` on a laptop writes the same files as the Version Packages
  pull request". That is no longer true for a contributor without CocoaPods.

*Failure scenario:* a Linux contributor follows the doc to preview the next version.
`changeset version` rewrites `package.json`, `CHANGELOG.md` and `.changeset/`. Then `--fix` fails
("pod install exited …") and the command exits 1, leaving a half-applied tree the doc never
mentioned. A maintainer on a Mac gets a multi-minute `pod install` instead.

*Fix:* update those three places. While there, add `maxConcurrentBuilds` to the `devices.json`
example (`CONTRIBUTING.md:217`, `scripts/devices.example.json`), and put `doctor --prime` next to
`--setup` at `:50`.

**M2 — a docstring points at a script that does not exist.** `scripts/sync-example-lock.mjs:20`
says `--fix` is "the release path's step (`bun run release:version:lock`, on a macOS runner)". No
such script exists: the step is inside `release:version`.

*Failure scenario:* someone debugging a failed release runs `bun run release:version:lock` and gets
"script not found". *Fix:* name `bun run release:version`.

## Nice to have

**N1 — nothing catches a lock that churns beyond the version line.**
`scripts/sync-example-lock.mjs:138-185`. `--fix` accepts any lock whose `PODS:` NitroUi version
matches. A macos-26 runner on a different Xcode or gem set could rewrite other `SPEC CHECKSUMS` or
`PODFILE CHECKSUM` lines. That lock would be committed green, and the next maintainer `pod install`
would rewrite it back. That dirties the tree and invalidates `app.stamp`, which is the exact bug
item 2 exists to fix, coming back silently. *Fix:* a pure `lockDiffIsVersionOnly(before, after)`
that allows only the NitroUi `PODS:` line and its checksum line, called before `--fix` returns 0.
That turns churn into a loud release-job failure.

**N2 — `--fix`'s glue has no automated test.** `scripts/sync-example-lock.mjs:138, 162`. Removing
the `git restore` and the trailer-keep together leaves every test green. Only the one live run
covers them, and the earlier `--name-only` bug lived in exactly this layer. *Failure scenario:* a
refactor drops the restore, and the next release commit carries `project.pbxproj` and workspace
churn. `pack`'s clean-tree check runs before `version`, so nothing notices. *Fix:* an env override
for the repo root, plus a CLI test in a temp git repo with a fake `COCOAPODS_BIN` that rewrites the
lock and touches a tracked project file.

**N3 — the build-slot TTL only ever fires against a live process.** `scripts/build-slot-core.mjs:54`.
On the same host, a dead pid is reclaimed at once, so the 45-minute TTL only expires slots whose
holder is still alive, or whose pid has been reused. *Failure scenario:* a wedged or very slow
`--clean` iOS build passes 45 minutes and a second build is admitted beside it, which is the load
spike this item prevents. *Fix:* exempt live same-host pids from the TTL, or document that the TTL
deliberately admits a second build.

**N4 — `doctor --prime` can kill a build that is still queued.** `scripts/doctor.mjs:853`. The build
timeout is 45 minutes, but a queued build may wait up to 60 (`DEFAULT_BUILD_WAIT_MINUTES`) before it
even starts. `spawnSync`'s SIGTERM then kills `build-app.mjs` without running its exit handler,
which can orphan `xcodebuild`/Gradle children. The slot itself is reclaimed by the dead-pid check.
*Fix:* a timeout of at least the wait plus the build, or no timeout.

**N5 — a doubled background log is untested, and the comment overstates the risk.**
`scripts/gate.mjs:553`. Setting `echo = true` writes every line twice into a backgrounded run's log,
and no test fails. The comment says "a doubled summary would be parsed twice", but the ledger parses
`logText`, not the file. *Fix:* assert that a background log holds the fake runner's
`Tests: 391 passed` line exactly once, and correct the comment.

**N6 — `NITRO_UI_GATE_LOG` leaks into the gate's own child processes.** `scripts/gate.mjs:249, 572`.
The detached runner passes the variable on to `bun run check` and everything under it. A nested
`gate.mjs` in the same checkout would append to the parent's log and mark the parent's record done
with its own exit code. Today the CLI tests run in temp repos, where the path check rejects it, and
only a stray warning results. *Fix:* delete it from the env passed to the gate's command.

**N7 — `dry-run.mjs` rebuilds `labelPreFlightProblem`'s dispatch instead of calling it.**
`scripts/bench/dry-run.mjs:295`. It calls `machineLabelProblem` and then re-derives the
minting/checking choice. The brief says to reuse X8's refusal functions, not copy them. Behaviour is
the same today, so this is about drift.

**N8 — report wording.** The commit-mechanism claim (`report.md:29`, `@changesets/ghcommit`) cannot
be verified locally; the action's default mode may be git-cli. The conclusion is unaffected. Also,
`takeBuildSlot`'s JSDoc documents an `options.deps` object that the function does not take
(`build-slot-core.mjs:483`).

## Scope

Tooling only; the published package is unchanged. No out-of-scope work found. The follow-ups in the
report are each one line, as required.
