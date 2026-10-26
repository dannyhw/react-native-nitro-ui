# X1 dev tooling: re-review of fix round 1

**Branch:** `task/X1-dev-tooling` at `73ea67f`. The fix round is `9e0122a..73ea67f`, minus the merge of
main (`551cfd1`, main at `152e059`). **Round:** 2 of 3, the last one allowed.

**Verdict: MERGE WITH FOLLOW-UPS.**

- All four must-fix items are fixed.
- Each must-fix fix is covered by a test that fails when the fix is reverted. I checked this by
  mutation testing, below.
- Nine of the ten should-fix items are fixed. S6 is only partly fixed (F1): it is a one-line change,
  and it fails loudly rather than giving a false green.
- I found no new defect that produces a false green or lets a task take another task's device.
- CI should be green on its first run. The one risk worth acting on is a timing-sensitive lease test
  (F2).

## What I ran

| Check | Result |
| --- | --- |
| `fnm exec --using 24 -- bun run check` (worktree, macOS) | exit 0. Jest 21 suites / 344 tests. `test:native` PASS. Worktree still clean afterwards |
| `actionlint .github/workflows/*.yml` | clean |
| `node --check` on every `.mjs` changed vs main | clean |
| Fresh `bun install --frozen-lockfile --ignore-scripts` on a `git archive HEAD` copy (the CI install command) | exit 0. The new `-port` patch **is applied**: `nitro-ui patch` is in `platform-android/dist/emulator-startup.js` |
| Live stamp probe against the worktree's own APK (stamp head `6bed6c6`, HEAD `73ea67f`) | **fresh**. The only commits since the stamp are ci.yml and docs, so M4 holds live |
| Same probe, APK copied to `/tmp/…/app-debug.apk` | **refused**: "app.stamp was written for a different file" (M2 holds live) |
| Same probe, symlink to the own APK | fresh (realpath) |
| Mutation runs in a scratch copy: revert each fix, run `app-stamp.test.js` + `lease.test.js` | each one is caught: M1 2 failures, M2-path 1, M2-fingerprint 1, M3 1, M4 1, S3 1, S4-pending 2, S4-retry 1, S7 2, S5-patch 1 |
| 42 parallel runs of `lease.test.js` on 14 cores (3x oversubscribed) | 15/42 fail `keeps a lock-timeout from ending a wait`. Everything else stays green (F2) |

## Round-0 findings

| # | Status | Notes |
| --- | --- | --- |
| M1 caller's TTL | **Fixed** | `leaseIsLive` uses the lease's own `ttlMinutes`, and `pruneExpired` lost its TTL parameter, so the caller's TTL cannot be passed in again. `renew` was added. `--exclusive` now defaults to 960 min. The unit test (`lease.test.js` "judges each lease by its own ttl") fails without the fix. |
| M2 stamp not bound to the artifact | **Fixed** | Stamp v2 records `artifactPath` (realpath) and `fingerprint` (size plus the hashes of the scanned bytes). A v1 stamp is refused. `assertFreshApp` passes both. Confirmed live with a copied APK. |
| M3 tree hashed after the build | **Fixed** | `treeBefore` is taken in `build-app.mjs` (iOS after pod install, Android at entry) and in real-input iOS. `recordBuild` checks it before anything else. The test writes nothing and fails without the check. |
| M4 HEAD in the digest | **Fixed** | `codeTreeDigest` takes no head. The unit test fails if head is put back. Confirmed live across two non-code commits. |
| S1 CI harness jobs unstamped | **Fixed** | Both dispatch harness jobs and `build-android` run `scripts/build-app.mjs`. |
| S2 `permissions:` | **Fixed** | `contents: read` in `ci.yml` and `smoke.yml`. |
| S3 stale-lock steal race | **Fixed (small residual, F4)** | Token in the lock, release by token, steal by `rename` then re-check. The "puts back a lock" test fails without the re-check. |
| S4 exclusive starvation / lock timeout | **Fixed** | A `pendingExclusive` marker (60 s, refreshed every poll) holds back new non-exclusive leases. A lock timeout inside the wait now retries. Both have tests. |
| S5 harness port ≠ lease port | **Fixed** | Patch plus `checkEmulatorEnv` in the harness config and real-input. Real-input also filters out the reserved serial. See "New risks" below. |
| S6 new iOS files skip `pod install` | **Partly fixed, F1** | Covers `cpp/`, `nitrogen/generated/` and `example/ios/`, but **not the root `ios/`**, which is the scenario in the review. |
| S7 needle matched the spec | **Fixed** | Android uses the JVM descriptor, iOS the length-prefixed name. Live APK counts are 4–10 per component. |
| S8 pod-install status ignored | **Fixed** | Both `build-app.mjs:220` and `bench/build.mjs` throw. |
| S9 harness not re-exec'd | **Fixed** | `scripts/harness.mjs` runs the guard and then spawns `react-native-harness/bin.js`. The config keeps `assertSupportedNode` as a second check. |
| S10 Android with no artifact | **Fixed** | It refuses. The hatch is deliberate-only (see below). |
| S11 device names, wrong claims | **Fixed** | The report names only `nitroui_t03`, a task AVD from the lease pool. The two claims are corrected. |
| N1 fnm missing version | **Fixed** | Probes `fnm exec --using 24 -- node --version` first. A failed probe refuses with `fnm install 24`. |
| N2 `NITRO_UI_DEVICES` | **Fixed, inverted** | `lease.mjs:143` now *implements* `NITRO_UI_DEVICES`, but `devices.example.json` no longer mentions it. Harmless. Document it or drop it. |
| N3 prettier cwd | **Fixed** | `report.mjs:114` passes `cwd: REPO_ROOT`. |
| N4 `macos-latest` | **Fixed** | Pinned to `macos-26` (see F6). |
| N5 cancel-in-progress on main | Open | `ci.yml:41`. A cancelled run shows grey, not red. Still worth doing once CI is enabled. |
| N6 arch not in stamp | Open | An x86_64 vs arm64 mismatch still fails at install rather than being refused. |
| N7 Metro-only JS in tree | Open | Acceptable now that M4 is fixed. |
| N8 `test:native:android` in CI | Open | |
| N9 AGENTS.md pointer | Open | |

## New risks asked about

### The `platform-android@1.6.0` `-port` patch

- **Applied on a fresh install and in CI.**
  - Both `package.json` and `bun.lock` list it under `patchedDependencies`.
  - A fresh `bun install --frozen-lockfile --ignore-scripts`, the exact command in
    `.github/actions/setup`, applies it.
  - The `node_modules` cache key in `.github/actions/setup/action.yml` hashes `patches/**`, with no
    `restore-keys`, so CI cannot restore an unpatched `node_modules`.
  - `lease.test.js` "makes the harness boot the AVD on the leased port" imports the installed module.
    If the patch stops applying, `checks` goes red.
- **Unleased runs are unaffected.**
  - With `EMULATOR_PORT` unset or invalid, `portArgs` is `[]` and the argument list is the upstream
    one. A test covers this.
  - Harness discovery (`waitForEmulator`) finds the emulator by AVD name, not by port, so `-port`
    does not confuse it.
  - `getEmulatorStartupArgs` is called only from `startEmulator`, and it is not part of any AVD cache
    key.
  - Nothing in CI sets `EMULATOR_PORT`.
- **One edge.** A shell with a leftover `EMULATOR_PORT` whose port is now taken makes the emulator
  fail to start. That fails closed, which is the right outcome.
- **One side effect.** `checkEmulatorEnv` runs at config load for iOS runs too
  (`rn-harness.config.mjs:201`), so a bad leftover `EMULATOR_PORT` also refuses an iOS run. This is
  acceptable.

### `NITRO_UI_ALLOW_UNSTAMPED=1`

It can only be used on purpose:

- It needs the exact value `'1'`.
- It is checked only in the `else if` branch that runs when there is **no artifact at all**
  (`rn-harness.config.mjs:84`). It cannot bypass the check on an artifact that exists, including a
  stale `HARNESS_APP_PATH`.
- It prints a red line.
- Nothing sets it: `git grep` finds only the config and docs.
- On iOS it achieves nothing, because the patched apple platform still requires a path. In practice
  it means "Android, use whatever is installed".

The trouble is the message, not the hatch (F3). The refusal text says "or point HARNESS_APP_PATH at
an app built another way". Such an app has no stamp and is refused.

## CI on first enable

- **`checks` (ubuntu): likely green.**
  - The new suites have no macOS dependency: no `xcrun`, `fnm` or `/private` in tests. They use
    `tmpdir()` and `process.execPath`, and the `linkSync`/`utimesSync`/`Atomics.wait` calls are
    portable.
  - `bun run check` passes locally.
  - The suites merged from main (changesets, release catch-up) also pass.
  - The one risk is the flake in F2.
- **`native-tests` (`macos-26`): probably green, not verifiable here (F6).** The job has never run on
  a hosted runner. It compiles with `-Werror` on whatever Xcode is the image default. Locally it
  passes on Xcode 27 / Swift 6.4 / clang 21.
- **`build-android` (stamped): likely green.**
  - It is the same `:app:assembleDebug -PreactNativeArchitectures=x86_64` that went green as
    "Assemble debug APK" in run 40093077581 (2026-10-24). That run's red came only from the two
    Harness steps, which are now dispatch-only.
  - The stamp's before/after tree check is stable on a clean checkout. Everything gradle writes is
    ignored: `.gradle`, `.cxx`, `build/`, and `example/android/.kotlin/` via `example/.gitignore:36`.
    `isCodeFile` also drops any path that contains a `build` segment.
  - Node comes from `.nvmrc` (24), so `assertSupportedNodeOrReexec` returns early.
  - Checkout v7 leaves a real `HEAD`.
  - The dex scan needles are verified on a real debug APK (stamp counts 4–10).
  - The daemon now runs without `--no-daemon`, which is fine for a one-shot job.

## New findings

**F1 (should-fix, small, before the next G task). The S6 fingerprint omits the library's own `ios/`
sources.**
`scripts/build-app.mjs:146-150`, and the comment at `:199-206`.

- **Problem.** `NitroUi.podspec:17-18` globs `ios/**/*.{swift}` and `ios/**/*.{m,mm}`, but the roots
  are `example/ios`, `cpp` and `nitrogen/generated`.
- **Scenario.** This is the usual G-task order:
  1. Add the spec.
  2. Run `bun run nitrogen`.
  3. Run `build-app.mjs --platform ios`. Nitrogen's output moved, so pod install runs. The compile
     then fails, because `HybridNitroUiFoo` does not exist yet.
  4. Write `ios/components/Foo/HybridNitroUiFoo.swift`.
  5. Rebuild. The fingerprint is unchanged, so there is no pod install, and the same "cannot find
     HybridNitroUiFoo" error comes back.
- **No way out with the tool.** `--clean` removes only `example/ios/build` and leaves the `Pods/`
  marker, so it does not help either. The agent has to run pod install by hand.
- **The same gap** applies to any new helper file under `ios/core` or `ios/components/*`.
- **Severity.** It fails loudly, not falsely green. That is why this is a follow-up and not a fix
  round.
- **Fix.**
  - Add `path.join(REPO_ROOT, 'ios')` to `roots`.
  - Make `--clean` also delete `Pods/.nitro-ui-pod-inputs`.

**F2 (should-fix, CI flake). One lease test depends on a 400 ms sleep.**
`scripts/__tests__/lease.test.js:1120-1146` ("keeps a lock-timeout from ending a wait").

- **Problem.** The test spawns the CLI, sleeps 400 ms and then removes the lock. The child has to
  start up *and* use up one 200 ms lock timeout within that 400 ms, or `stderr` never contains
  `lock busy`.
- **Evidence.** Under 3x CPU oversubscription it failed 15 of 42 runs, with `Received string: ""`.
- **Likelihood.** A 4-vCPU hosted runner with 3 jest workers is far less loaded, so the chance per
  run is low but not zero. A red `checks` from it on a push to main is exactly the noise to avoid.
- **Same pattern, never failed under stress.** The S4 drain test (`:1095`) and the waiter test
  (`:914`) also sleep 400 ms.
- **Fix.** Wait for the condition instead of a fixed delay. For example, resolve a promise when the
  child's `stderr` first contains `lock busy`, then unlink. For the drain test, poll `leases.json`
  until `pendingExclusive` appears.

**F3 (nit). The refusal text advertises a path that is refused.**
`example/rn-harness.config.mjs:106`.

- **Problem.** "or point HARNESS_APP_PATH at an app built another way" is wrong. That app has no
  stamp and `assertFreshApp` refuses it. CONTRIBUTING (`:278`) gets this right.
- **Docs gap.** The hatch is not mentioned in CONTRIBUTING.
- **Fix.**
  - Reword to "an app built another way is refused; NITRO_UI_ALLOW_UNSTAMPED=1 with no artifact runs
    against whatever is installed (Android only)".
  - Add one line about the hatch to the stamp section of CONTRIBUTING.

**F4 (nit, low likelihood). Two narrow windows remain in the stale-lock steal.**
`scripts/lease-core.mjs:610-635, 684-692`.

- **Window (a).** It needs a corpse plus four contending processes.
  - Stealer S renames a *fresh* lock aside. That lock belongs to A, which took the path after S's
    stat.
  - Between S's `rename` and its `linkSync` back, C can `open('wx')` and enter beside A.
- **Window (b).** It needs a corpse plus three contending processes.
  - `parseLockTime` returns `null` for a lock A has created but not yet written to.
  - S then treats A's lock as a corpse and unlinks it.
- **Severity.** Both are far narrower than the round-0 race, and release by token keeps the damage
  local. Neither needs action before merge.
- **Fix.**
  - Create the lock fully written: write a tmp file, then `linkSync(tmp, lockFile)`, which fails
    with EEXIST atomically.
  - Treat an unparseable moved lock as live and restore it.

**F5 (nits).**

- `scripts/app-stamp-core.mjs:135`: the measurement table says `20HybridNitroUiSwitch`. The needle
  is, and must be, `19HybridNitroUiSwitch`, and the test asserts 19. Correct the table.
- `scripts/__tests__/lease.test.js:1052`: `bench.ttlMinutes * 60 >= 14` is always true (seconds
  compared with hours). It should be `bench.ttlMinutes >= 14 * 60`. The unit test at the
  `EXCLUSIVE_TTL_MINUTES` check covers it meanwhile.
- `scripts/__tests__/lease.test.js:978-1036`: the CLI "coexist" test cannot catch a caller-TTL
  regression in the CLI, because the 1-minute probe is longer than the LONG lease's 1.5 s age. The
  pure `pruneExpired` test does catch it, and `pruneExpired` no longer accepts a TTL. Fine as is;
  the comment "the exact scenario from the review" overstates it.
- `scripts/harness.mjs:55`: `command: 'bun run harness:android'` also labels iOS refusals. Use
  `bun run harness`, or derive it from `--harnessRunner`.

**F6 (watch). `native-tests` on `macos-26` has never run.** `.github/workflows/ci.yml:74`.

- **Problem.** The image's default Xcode is older than the local Xcode 27 / Swift 6.4, and the
  script uses `-Werror`. Nothing I can run here predicts the outcome.
- **The comment is also off.** "check it is registered before the next scheduled run" refers to a
  schedule; there is none.
- **Fix.** If the first run is red for a toolchain reason, switch to the `xcode-27` label, which is
  proven to schedule, or select Xcode with `DEVELOPER_DIR`.

## Personal data

- The new and changed files contain none.
  - The bench baselines' hostname reads `maintainer-mac-1`.
  - `git grep` finds no `INV-0391` or `Daniel-Williams` at HEAD.
  - The report names only the pool AVD `nitroui_t03` and generic ports.
  - `devices.example.json` holds placeholders only.
- The commit author identity is the repository owner's, and it lives in git metadata, not in files.

## Merge notes

- Merge as is. F1 and F2 are each a few lines. They can go in the merge commit or a follow-up
  before CI is enabled, and F2 ideally before CI is enabled.
- N5 (`cancel-in-progress` on main) is worth doing at the same time as enabling CI.
