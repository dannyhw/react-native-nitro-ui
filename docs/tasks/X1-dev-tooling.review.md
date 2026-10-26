# X1 dev tooling: review

**Branch:** `task/X1-dev-tooling` at `9e0122a`, compared with `main...`. **Round:** 1 of 3 (D19).
**Verdict: FIX ROUND.** There are four must-fix items. Three are false greens or lease theft in the
two new gates, and each fix is small. The CI half is close to mergeable. The lease and stamp halves
need one more round.

## What I ran

| Check | Result |
| --- | --- |
| `fnm exec --using 24 -- bun run check` (worktree, macOS) | PASS, exit 0. Jest 19 suites / 286 tests, `test:native` PASS |
| `actionlint .github/workflows/*.yml` | clean |
| `node --check` on every changed `.mjs` | clean |
| All `uses:` pinned by SHA | yes, including `.github/actions/setup` |
| `pull_request_target` / `issue_comment` / `schedule` triggers | none left. `bench.yml` and `smoke.yml` are `workflow_dispatch` only |
| Last real CI run on `main` (run 40093077581, 2026-10-24) | Checks green on ubuntu, with `test:native` skipped with its reason. Build Android (release) green. `xcode-27` resolved to image `xcode-27-arm64` |
| Stamp probe on this worktree as it stands | **refused**. The stamp is at `e5d1aab`; HEAD `9e0122a` adds only the report `.md` (see M4) |
| Lease probe in a scratch `NITRO_UI_HOME` | a `--ttl-minutes 1` acquire **evicted** a 5-minute-old exclusive lease that had ttl 900 (see M1) |
| Dex probe on the built APK | the needle `HybridNitroUiSwitch` matches 61 times; the implementation descriptor `Lcom/margelo/nitro/nitroui/HybridNitroUiSwitch;` matches 5 (see S7) |

These look correct:

- `checks` should stay green on ubuntu. It was green on 2026-10-24, and the new suites are portable:
  they use `NITRO_UI_HOME` and `tmpdir()`, spawn `process.execPath`, and `bunx` is on PATH.
- `test:native` is the only step in `check` that skips on Linux, and the macOS job now runs it.
- `build-android` (debug) is realistic on a hosted runner. The heavier release build was green there.
- The `if: github.event_name == 'workflow_dispatch'` jobs are inert. A job-level `if` is evaluated
  before a runner is assigned, so `harness-ios` never queues for `xcode-27`.
- The lease lock handles a crash mid-write. `leases.json` is written by tmp-and-rename, and an empty
  lock goes stale after 30 s.
- The 8-process race test is meaningful: without the lock it would show 8 winners and one lease.
- The re-exec cannot loop because `NITRO_UI_NODE_REEXEC` stops it.
- Without fnm, the re-exec falls through to the refusal. In CI (Node 24) it returns early.
- The pod-stamp reconcile is correct. Smoke `expo.sh` / `rn-cli.sh` still exit non-zero on a pod
  failure, because `process.exit(status)` runs under `set -e`.
- `devices.example.json` contains no personal data.

## Must-fix

**M1. Any `acquire` prunes every lease by the caller's TTL and writes the result back.**
`scripts/lease.mjs:145-149, 164-168, 212-215`, and `list` at `:261-265`.

- **Problem.** `pruneExpired(state, now, options.ttlMinutes)` judges each lease by the TTL of the
  process that is asking, not by the `ttlMinutes` stored in the lease. The pruned list is then
  persisted.
- **Scenario, reproduced.** `BENCH` takes `acquire --exclusive --ttl-minutes 900`. Five minutes later
  `acquire --task G7 --ttl-minutes 1` succeeds on pair-a, and `leases.json` now contains only G7.
- **Same bug with defaults.** A bench run with `--ttl-minutes 900` is evicted by the first
  default-TTL (240) acquire after 4 h. Benches run 8 to 14 h (PROCESS review §4), so the quiet window
  the exclusive lease exists for is lost mid-run.
- **Fix.**
  - Expire each lease by `lease.ttlMinutes ?? DEFAULT_TTL_MINUTES`, in `pruneExpired`,
    `activeLeases` and `list`.
  - Add `lease.mjs renew <id>` (bump `acquiredAt`), or a heartbeat.
  - Make `--exclusive` require an explicit `--ttl-minutes`, or default to ≥ 16 h.
  - Add a test where two TTLs coexist.

**M2. The stamp is not bound to the artifact under test, so a foreign binary passes.**
`scripts/app-stamp-core.mjs:314-335`, `scripts/app-stamp.mjs:365-396`, `example/rn-harness.config.mjs:42-51`.

- **Problem.** `assertFreshApp` reads *this worktree's* stamp file and compares its tree with this
  worktree. It then counts components in whatever `artifact` it was given. `stamp.artifact` is
  recorded but never compared, and the stamp has no fingerprint of the binary.
- **Scenario.**
  - Worktree G7 has a fresh stamp.
  - The shell still exports `HARNESS_APP_PATH=…/G6/example/ios/build/…/NitroUiExample.app` from the
    previous task, which is the exact mistake the process review describes.
  - G6's app registers every component, so the gate prints "app is fresh" and the suite runs G6's
    binary green.
  - The same applies to a copied or downloaded `.apk`.
- **Fix.**
  - Record `artifactSha256` in the stamp, or size plus mtime plus a hash of the executable/dex.
    Recording `realpath(artifact)` is optional.
  - Refuse unless `realpath(artifact) === stamp.artifact` and the fingerprint matches.
  - Add a refusal test for "stamp fresh, artifact elsewhere".

**M3. The tree is hashed after the build, so edits made during the build are stamped as built.**
`scripts/app-stamp.mjs:318` (`recordBuild`), called from `scripts/build-app.mjs:218-220` and
`scripts/real-input/ios.mjs` (after `build-for-testing`).

- **Scenario.**
  - An agent backgrounds `build-app.mjs --platform ios`, which takes minutes under load.
  - Meanwhile it edits `ios/components/Switch/*.swift`, or runs `git merge main`.
  - The edit lands after xcodebuild compiled that file. The stamp then records the *edited* tree.
  - `bun run harness:ios` reports the app as fresh and passes against a binary without the edit.
    This is the stale-binary class the stamp exists to stop.
- **Fix.**
  - Compute `currentCodeTree()` before the build starts and again after it.
  - If the two differ, do not stamp. Print "the tree changed during the build; rebuild".
  - Do the same in real-input iOS.

**M4. HEAD is folded into the digest, so every commit, including a docs-only one, invalidates the
stamp.** `scripts/app-stamp-core.mjs:101-108` (`hash.update(\`HEAD\0${head}\n\`)`).

- **Problem.** The brief asks for "HEAD's code tree excluding `docs/`". The module's own comment
  (`:18-19`) promises that writing a report does not invalidate a build.
- **Observed.** This worktree is refused right now. The stamp is at `e5d1aab`, and HEAD `9e0122a`
  only adds `docs/tasks/X1-dev-tooling.report.md`.
- **Effect.** Every final-tree re-run after a report commit needs a rebuild, which is the friction
  §4 rank 4 targets.
- **The stated rationale does not hold.** "A rename recorded as identical content" already changes
  the path-to-hash map.
- **Fix.**
  - Drop `head` from the digest and keep it in the stamp as information only.
  - Add a test: commit a `docs/` change and the tree stays equal.

## Should-fix

**S1. The dispatch-only CI harness jobs now always refuse.** `.github/workflows/ci.yml:185-198, 244-265`
with `example/rn-harness.config.mjs:62-82`.

- **Problem.** The harness action exports `HARNESS_APP_PATH` from its `app:` input (see
  `action.yml` at the pinned SHA). CI builds with plain `gradlew` / `xcodebuild` and never writes a
  stamp, so `assertFreshApp` throws "no app.stamp" before the suite starts.
- **Contradiction.** The report says re-enabling these jobs is a one-block change. That is no longer
  true.
- **Fix.**
  - Build through `node scripts/build-app.mjs --platform android --arch x86_64` (and
    `--platform ios`) in those jobs.
  - Do the same in `build-android`: it then also proves that the dex contains every registered
    component on a clean checkout, at no extra cost.

**S2. `ci.yml` has no `permissions:` block.** `.github/workflows/ci.yml:20-35`. `smoke.yml` has none
either.

- **Problem.** Push-to-main jobs get the repository's default `GITHUB_TOKEN` scope, which can be
  write-all depending on settings, and no job here needs it.
- **Fix.** Add top-level `permissions: { contents: read }` to both files.

**S3. Stale-lock stealing races, and release deletes whatever lock is there.**
`scripts/lease-core.mjs:399-411` and `:427-428`.

- **Scenario.**
  - A process dies inside `mutate`, so the lock goes stale.
  - A and B both `stat` it as stale. A unlinks it, creates its own lock and enters.
  - B's `unlinkSync` now deletes **A's live lock**, then B creates one and enters too.
  - When A finishes, its `finally` unlinks **B's** lock, so a third process can enter as well.
  - Two writers then both decide pair-a is free.
- **Likelihood.** Low: it needs a crash plus contention. It is still the race the brief asks about,
  and no test covers it. The fake-fs tests have only a single stealer.
- **Fix.**
  - Write a random token into the lock.
  - Release with read-compare-unlink, unlinking only if the token is ours.
  - Steal with `renameSync(lock, lock + '.stale-' + token)`, then verify that the renamed file's
    content is the stale one you `stat`ed. If it is not, it was a fresh lock: put it back or retry.
  - Alternatively, check `process.kill(pid, 0)` on the recorded pid before stealing.
  - Add a test with two stealers.

**S4. `--exclusive` can starve, and one lock timeout aborts the wait.** `scripts/lease-core.mjs:250-260`,
`scripts/lease.mjs:157-228`.

- **Starvation.** A waiting exclusive acquire records nothing, so new non-exclusive acquires keep
  succeeding. With two device tasks overlapping, `held.length` never reaches 0, and the bench gives
  up after 60 min.
- **Abort.** `withLock` throws after 10 s (`LOCK_TIMEOUT_MS`, shorter than `LOCK_STALE_MS` = 30 s),
  and the throw escapes the wait loop. One slow or crashed holder therefore ends an hour-long wait
  with exit 2.
- **Fix.**
  - Have a waiting exclusive acquire write a `pendingExclusive` entry with its own short TTL,
    refreshed on each poll. `decideAcquire` then refuses new non-exclusive leases while the entry
    exists, so the machine drains.
  - Catch the lock-timeout error inside the poll loop and retry.

**S5. The lease's `ANDROID_SERIAL` / `EMULATOR_PORT` are not what the harness boots, so the 5560 rule
only checks port numbers.**

- **The mismatch.** The harness boots `emulator @<avd>` with no `-port`
  (`node_modules/@react-native-harness/platform-android/dist/emulator-startup.js:23-30`). Nothing in
  `example/rn-harness.config.mjs` reads `EMULATOR_PORT`. The emulator takes the lowest free console
  port.
- **What breaks.** The lease exports `ANDROID_SERIAL=emulator-5574` (`scripts/lease-core.mjs:338-345`).
  `real-input/android.mjs:2244-2257` then refuses with "ANDROID_SERIAL=emulator-5574 is not
  connected" whenever the harness-booted AVD landed elsewhere.
- **5560.** When 5554-5558 are busy and the human's emulator is not running, the harness can boot a
  *leased* AVD as `emulator-5560`. The guarantee holds for config port numbers, not for devices.
- **Fix.**
  - Either pass `-port $EMULATOR_PORT` to the emulator (a harness patch or option), or stop
    exporting `ANDROID_SERIAL` and leave real-input on its AVD-name lookup.
  - At acquire, if adb answers, ask `emulator-5560` for `emu avd name` and refuse a pair with that
    AVD.
  - Document that the human's AVD belongs in `reservedIdentifiers`.

**S6. iOS `build-app` skips `pod install` when only new source files were added.**
`scripts/build-app.mjs:111-120`.

- **Problem.** `podsAreStale` compares `Manifest.lock` with `Podfile.lock` only. `NitroUi.podspec`
  uses globs (`ios/**/*.{swift}` …, plus nitrogen's generated files). A new component's files, or
  `bun run nitrogen` output, are not in `Pods.xcodeproj` until `pod install` runs again.
- **Scenario.** A G-task adds `ios/components/Foo/*.swift`. xcodebuild fails on
  `NitroUiAutolinking.swift` referencing `HybridNitroUiFoo`, or `recordBuild` refuses with "does not
  contain Foo". The suggested `--clean` only deletes `example/ios/build`, so it does not help.
- **Fix.** Run `installPods` whenever the list of files under `ios/`, `cpp/` and
  `nitrogen/generated/ios/` differs from the last stamp's, or on `--clean`. Running it always also
  works; a no-op install takes seconds.

**S7. The component check matches the generated spec, not the implementation class.**
`scripts/app-stamp.mjs:264-271`.

- **Problem.** The needle `HybridNitroUi${name}` is a prefix of `HybridNitroUi${name}Spec` and
  `…SpecSwift`, which nitrogen always generates.
- **Scenario.** A dex or dylib that contains the generated spec but lost the handwritten
  `HybridNitroUiSwitch.kt` / `.swift` still counts > 0 and passes. On the current APK, 61
  "mentions" correspond to 5 for the real class descriptor.
- **Fix.** Use exact needles.
  - Android: `Lcom/margelo/nitro/nitroui/HybridNitroUi${name};`.
  - iOS: the length-prefixed Swift name, `${('HybridNitroUi'+name).length}HybridNitroUi${name}`.
    The spec's length prefix differs, so it cannot match.

**S8. Neither pod-install caller checks the exit status.** `scripts/build-app.mjs:119`,
`scripts/bench/build.mjs:177`.

- **Problem.** `installPods` returns `{status}`, and both callers ignore it.
- **Regression.** Before this branch, `bench/build.mjs` used `execFileSync`, which threw on a failed
  `pod install`. Now the run continues and fails later inside xcodebuild with a sandbox or "missing
  Pods" error that hides the cause.
- **Fix.** Throw when `status !== 0`, in both places.

**S9. The harness still refuses on the wrong Node, and the report says it restarts.**

- **Code.** `example/rn-harness.config.mjs:34` still calls `assertSupportedNode`. A config module
  cannot re-exec. Importing it under Node 26 throws "needs Node 22.11 - 24".
- **Spec gap.** Brief item 4 asks the device scripts to re-exec, and the harness is the main one.
- **Report.** `docs/tasks/X1-dev-tooling.report.md:74` says "a harness run restarts". That is
  incorrect.
- **Fix.**
  - Point `example/package.json`'s `harness:*` scripts at a small `node ../scripts/harness.mjs …`
    entry that calls `assertSupportedNodeOrReexec` and then spawns `react-native-harness`.
  - Correct the report.

**S10. On Android, the stamp check is skipped when there is no artifact.**
`example/rn-harness.config.mjs:83-89`.

- **Problem.** With no `HARNESS_APP_PATH` and no APK at the fixed path, the config only logs a note.
  The Android platform then runs whatever `nitroui.example` is already installed on the AVD
  (`platform-android/dist/instance.js:149-158`). iOS is safe because the patched platform requires a
  path.
- **Scenario.** A fresh worktree reuses a long-lived AVD that another worktree installed on. The
  suite runs green against that other worktree's app.
- **Fix.** Refuse in red when there is no artifact. Allow an explicit, logged escape hatch such as
  `NITRO_UI_ALLOW_UNSTAMPED=1`, which also covers S1's interim and a hand-built artifact.

**S11. The report names the human's devices, and two of its claims are wrong.**

- **D25.** `docs/tasks/X1-dev-tooling.report.md:6-7` names the human's own simulators and AVDs.
  D25 forbids names of the human's own devices and apps (generic model names are fine). Older reports
  on main do the same, but this is a new file. Replace it with "no device outside the lease was
  touched". The names are redacted here for the same reason.
- **Claim, `:48`.** "the refusal stays when … the pinned version is missing" is incorrect (see N1).
- **Claim, `:74`.** See S9.

## Nits

- **N1** `scripts/node-version.mjs:169-180`: when fnm is present but the pinned major is not
  installed, `fnm exec` exits 1 with no spawn `error`. The code then prints "re-ran under Node 24
  from .nvmrc" and exits 1 without the refusal text. Treat a non-zero status from a child that never
  started as a failure, and fall through to `assertSupportedNode`. Also, `process.execArgv` is
  dropped on re-exec.
- **N2** `scripts/devices.example.json:2` documents a `NITRO_UI_DEVICES` override that does not
  exist. Only `--config` and `NITRO_UI_HOME` are implemented. Implement the override or remove it
  from the comment.
- **N3** `scripts/bench/format.mjs:36-45` runs `bunx prettier` with no `cwd`. Started from outside
  the repo, `bunx` may fetch a different prettier, and `.prettierignore` is resolved from the cwd.
  Pass `cwd: REPO_ROOT`, or call `node_modules/.bin/prettier`.
- **N4** `.github/workflows/ci.yml:63`: `macos-latest` floats, and `native-tests.sh` compiles with
  `-Werror`, so a runner image bump can turn the job red with no code change. Pin `macos-26`, or the
  `xcode-27` label, which the 2026-10-24 run proves resolves. The comments at `ci.yml:203-205` and in
  `actionlint.yaml` say it may never get a runner; that is contradicted by that run.
- **N5** `.github/workflows/ci.yml:32-34`: `cancel-in-progress: true` also applies to pushes to
  `main`, so in a burst of merges some commits never finish CI. Use
  `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- **N6** The stamp does not record `--arch`. An arm64 APK installed on an x86_64 AVD fails at
  install rather than being refused. Record the arch and compare it.
- **N7** The code tree includes Metro-served JS (`example/__tests__/**`, `src/**/*.ts` other than
  specs, `scripts/**`). A debug build does not contain that JS, so editing a harness test forces a
  native rebuild. The brief allows this; consider excluding it once M4 is fixed.
- **N8** `build-android` could also run `bun run test:native:android`, the Kotlin handshake JVM test.
  JDK and Gradle are already set up there.
- **N9** `AGENTS.md` does not mention `lease.mjs` / `build-app.mjs`, and agents read AGENTS.md
  first. A one-line pointer to the CONTRIBUTING sections would help.

## Regressions for someone not using the new helpers

- **Hand-built artifacts are refused.** A plain `gradlew assembleDebug` / `xcodebuild` artifact is
  now refused by the harness and by Android real-input. This is by design, and CONTRIBUTING says so,
  but there is no escape hatch (S10 fix).
- **CI harness jobs** break (S1).
- **Bench** no longer fails fast on a pod error (S8).
- **Smoke, `bun run check` and the lefthook gates** are unaffected: no new required environment, and
  the pod path still fails `set -e` on error.
