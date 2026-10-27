# X6 — faster local/agent builds

**Branch:** `task/X6-build-speed` (from `main` at `cdcd6a8`) · **Round:** 1 of up to 3 (D19), fix
round 1, then the merge-bar run · **Leases:** `X6-wk682` and `X6-y20xj` (both pair-b: one iOS
simulator + one API 35 AVD, Metro port 8293)

## Summary

**What a library user installs did not change.** `npm pack` here and in a `main` worktree (both
`react-native-nitro-ui@0.2.0`, main at `3c15fc4`) give 465 files each, the same list, the same
sha256 for every file, and the same tarball bytes
(`6957a219dc73f34cf0aa68b5bff50fb4689864c81ac9b5625142702f78ffa408`). No packaged path is in the
diff: not `src/`, `lib/`, `android/`, `ios/`, `cpp/`, `nitrogen/`, `*.podspec`, `package.json` or
`CHANGELOG.md`. The ccache launcher reaches the library's CMake only through a `-I` init script that
`build-app.mjs` puts on the gradle command line, and `bun run manifest:check` keeps the file list
honest.

Four speed-ups, all in `scripts/`, the example app, the bench app and CI: **one ABI** (the host's
instead of the four in `example/android/gradle.properties`, overridable by `--arch` /
`NITRO_UI_ANDROID_ARCH`); **gradle build + configuration caches** in the example and bench apps;
**ccache** (Homebrew, 4.14.2) for C/C++/ObjC++ on both platforms; and **no build at all when nothing
moved**.

Two decisions a reviewer needs before the diff:

- The skip asks the *same question the device gate asks* — `checkFreshApp`, the code-tree digest
  plus the artifact path and fingerprint — so it cannot bless a binary the gate would refuse. Since
  fix round M1 it also compares ABIs: the stamp records what went into the APK and the skip fires
  only on an exact match, so `--arch x86_64` after an arm64 build builds instead of exiting 0 with a
  package that could not install. `decideFreshness` (the gate) still ignores ABIs on purpose.
- ccache state is environment only (`CCACHE_BASEDIR`, `CCACHE_NOHASHDIR`, `CCACHE_BINARY`), never a
  config file: on macOS ccache reads `~/Library/Preferences/ccache/ccache.conf`, and React Native
  points `CCACHE_CONFIGPATH` at its own file for the iOS compiles, so an exported variable is both
  the only layer that reaches both builds and the only one that stays inside the repo.
  `NITRO_UI_CCACHE=0` opts out and every Android CI job sets it.

`CONTRIBUTING.md` → Build speed is the user-facing doc, including the two caveats fix round 1 asked
for: cached objects keep the `DW_AT_comp_dir` of the worktree that compiled them, and iOS inherits
React Native's ccache `sloppiness`. `NITRO_UI_CCACHE=0` is the answer to both.

## Timing — wall seconds, one run per cell, `/usr/bin/time -l`

`load1` is the 1-minute load average where the cell started (14 cores; tasks share this machine).

| cell | main | X6 | load1 (main → X6) | what the X6 run's caches say |
| --- | --- | --- | --- | --- |
| example Android: first X6 build in a fresh worktree, caches partly warm | 179.95 | 119.46 | 5.3 → 194.0 | 36 `FROM-CACHE` + 231 up-to-date of 366 tasks |
| example Android: no change | 7.37 | **0.56** (skipped) | 32.1 → 123.2 | stamp match |
| example Android: 1-line `cpp/` change | 9.72 | 6.79 | 18.7 → 123.2 | 1/1 ccache |
| example Android: 1-line Kotlin change | 9.84 | 5.86 | 17.2 → 114.0 | 1/1 ccache |
| example iOS: first X6 build, fresh worktree + `pod install`, caches partly warm | 540.24 | 315.86 | 13.5 → 23.1 | 236/890 ccache (27%) — filling |
| example iOS: no change | 17.17 | **0.86** (skipped) | 60.4 → 70.8 | stamp match |
| example iOS: 1-line Swift change | 220.29 | 194.91 | 49.7 → 70.8 | 0 ccache calls — no change expected, noise |
| example iOS: 1-line `cpp/` change | 214.91 | **54.83** | 33.9 → 47.9 | 234/236 ccache (99%) |
| **2nd fresh worktree, same commit — Android** | 179.95 | **17.31** | — → 88.2 | 24 `FROM-CACHE` + 268 up-to-date of 366 |
| **2nd fresh worktree, same commit — iOS** | 540.24 | **137.72** | — → 43.7 | 884/890 ccache (99%) |
| bench Android: cold (`prebuild` + `assembleRelease`) | 341.85 | 27.04 | 100.5 → 22.8 | 129/129 ccache — this row is cache |
| bench Android: `--rebuild` | 9.79 | 6.30 | 37.5 → 23.7 | 0 ccache calls |
| bench Android: no change | 0.06 | 0.05 | 37.5 → 36.7 | skip path |
| bench iOS: cold | 224.34 | 167.62 | 41.9 → 53.3 | 0 ccache calls (measured before the iOS ccache fix) |
| bench iOS: `--rebuild` | 34.38 | 17.07 | 53.3 → 41.6 | 0 ccache calls |
| bench iOS: no change | 0.64 | 0.49 | 53.3 → 41.6 | skip path |

**What this supports:** the skip (0.56 s and 0.86 s against 7.37 s and 17.17 s), the iOS `cpp/`
rebuild (214.91 → 54.83 s at 234/236 hits), and both second-worktree rows (17.31 s and 137.72 s
against the 119.46 s and 315.86 s of the worktree that filled the caches). **What it does not:** the
X6 cold cells were not cold — that Android run served 36 tasks `FROM-CACHE` and that iOS pass took
236 ccache hits, both from earlier X6 runs, so 179.95 → 119.46 is not attributable to X6 on its own.
Bench Android is cache, not speed-up: 129/129 hits, measured right after the example had compiled
the same objects in the same worktree. The bench iOS rows were measured before the iOS ccache fix
landed and show 0 ccache calls, so their delta is unattributed. The Swift row is noise: X6 touches
nothing `swiftc` reads and that run made no ccache calls. One run per cell at loads of 5–194 against
5–100 leaves noise larger than several of these deltas. A truly cold cell (`NITRO_UI_CCACHE=0` with
`--no-build-cache` and an empty `GRADLE_USER_HOME` — what a new contributor or a cache-less CI
runner gets) was **not** measured, so the first-ever build time and ccache's cost on a miss are both
unknown.

The iOS cold cell was measured three times: 426.66 s and 457.87 s before the `CCACHE_BINARY` fix
below, 315.86 s after it. The second-worktree iOS row was measured last, once the cache held that
worktree's objects.

## Cache hit rates

Session cumulative from empty, `ccache 4.14.2`: **1486/3024 = 49%** at the end of the measurements;
the first full iOS pass filled it at 236/890 = 27%; the table cites per-cell deltas. Gradle's
`build-cache-1` is per user, so a second worktree of the same commit took 24 `FROM-CACHE` + 268
up-to-date of 366 tasks — 74 tasks did work.

The builds the device gates ran were themselves the cached path, and the gates then skipped rather
than rebuilding:

- iOS: 71 s, `ccache` **+312 hits / +312 calls (100%)**, stamp `4ee8d95a`, 8 components.
- Android: `ccache` **+46 / +46 (100%)**, gradle **308 `UP-TO-DATE` + 12 `NO-SOURCE` of 366**, APK
  contains `lib/arm64-v8a` only.
- Both suites printed `app is fresh, not rebuilt` in well under a second instead of building, so
  what ran on the devices is what those cached builds wrote, and `gate.mjs` stamped tree
  `4ee8d95a` on each row.

## Two bugs only measurement could see

1. `CCACHE_HASH_DIR=false` is not a variable ccache reads — the real one is `CCACHE_NOHASHDIR` — so
   `hash_dir` stayed on and a second worktree's Android build logged 140 cacheable calls with 0
   hits. Fixed, and `build-app.mjs` now reads `ccache --show-config` back once and warns when
   `base_dir`/`hash_dir` did not take: a wrong name here changes nothing but timings.
2. iOS: `:ccache_enabled => true` was set and `xcodebuild -showBuildSettings` named RN's wrapper as
   `CC`, yet rebuilding 236 C++ files moved `ccache -s` by nothing. RN's wrapper ends in
   `exec $CCACHE_BINARY clang`, and RN supplies that path as an Xcode *build setting*, which Xcode
   does not put in the compiler's environment — it ran plain clang, silently. The scripts now export
   the resolved path; the same rebuild registers those calls.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 451 tests / 25 suites | `4ee8d95a9bff` | 3 m 08 s | start 3.8 / med 6.6 / max 8.3 |
| `harness:ios` | **PASS** | 159 tests / 12 suites | `4ee8d95a9bff` | 1 m 55 s | start 4.1 / med 4.7 / max 5.2 |
| `harness:android` | **PASS** | 187 tests / 12 suites | `4ee8d95a9bff` | 5 m 42 s | start 18.0 / med 7.1 / max 18.0 |
| `real-input:ios` | **FAIL** | — | `4ee8d95a9bff` | 19.2 s | start 13.3 / med 13.3 / max 13.4 |
| `real-input:android` | **PASS** | — | `4ee8d95a9bff` | 8 m 24 s | start 7.7 / med 7.7 / max 15.4 |

`need --for review`: `need: review is satisfied on this code tree.` ·
`need --for merge`: `need: 1 gate(s) missing for merge: real-input:ios` — see
[Merge bar: real-input](#merge-bar-real-input).

- The first attempt at each suite was taken at a load the machine could not carry and each failed on
  one load-bound test, nothing else: `harness:android` 186/187 with the B1 post-GC heap-floor test
  timing out at 30 s (ledger load start 13.2 / median 218.0 / max 496.5), and `harness:ios` on
  `Sizing · intrinsic (T11)`'s cold Switch (`expected null not to be null`, load1 240) — the same two
  tests `docs/tasks/G6-picker.report.md` and `docs/tasks/G3-progress.report.md` record as
  load-sensitive. Both were re-run in a quiet window and passed whole: 187/187 and 158 passed. The
  iOS row's skipped suite is the cold-start `ColdSizing` suite and its skipped test is
  `MountChurn`'s Android-only placeholder, both pre-existing guards.
- `gradlew --stop` was run once before the Android gate build (idle daemons of this worktree only),
  so that build started its own daemon instead of inheriting one from the measurement phase.
- **Pack identity**, re-run on this tree: `npm pack` in this worktree and in a `main` worktree at
  `3c15fc4`, both `0.2.0` → `LIST IDENTICAL` (465 files), `ALL BYTES IDENTICAL` (sha256 per file, no
  path rewriting needed), tarball sha256 `6957a219dc73f34cf0aa68b5bff50fb4689864c81ac9b5625142702f78ffa408`
  on both sides. `docs/tasks/X6/gates.jsonl` is the exported ledger.
- **Machine state.** Round 1 wrote `~/.config/ccache/ccache.conf` (review M3). It was created by
  this task, it is read by nothing on macOS, and it has been **deleted**, along with the empty
  directory. Nothing outside the repo configures ccache now: `ccache --show-config` with no repo
  env prints `(default) base_dir = `, `(default) hash_dir = true`, `(default) max_size = 5.0 GiB`,
  and with the scripts' env `(environment) base_dir = <this worktree>`, `(environment) hash_dir =
  false`. `max_size` is deliberately left at the default — 1.2 of 5.0 GiB is in use — so no
  `CCACHE_MAXSIZE` was added, and no `CCACHE_CONFIGPATH` anywhere (it would displace RN's iOS
  settings). ccache 4.14.2 from Homebrew is the only install.

## Merge bar: real-input

The fixes from round 1 were accepted, and the owner added the last merge condition: X6 changes how
the app binaries are built, so the real-input suites count too. They ran on `3380e34` with **no code
changes**, and nothing below is a repair attempt — one of the two is red, so it is reported.

Lease `X6-y20xj` (pair-b: one iOS simulator + one API 35 AVD, Metro 8293). The AVD was not running
and was booted with the arguments the harness itself uses. Each gate consumes an artifact from
`build-app.mjs`, and both sides were on the cached path when the gates ran: `✓ android example app
is fresh, not rebuilt` and `✓ ios example app is fresh, not rebuilt`, each in well under a second
against stamp tree `4ee8d95a9bff`.

| Gate | Result | Counts | Duration | Load |
| --- | --- | --- | --- | --- |
| `real-input:android` | **PASS** | 10/10 controls, 105 assertions | 8 m 24 s | start 7.7 / med 7.7 / max 15.4 |
| `real-input:ios` | **FAIL** | — (test build failed, exit 65) | 19.2 s | start 13.3 / med 13.3 / max 13.4 |

Android passes end to end on an APK this branch built: the switch, slider, button, segmented
control, date picker and picker on their own screens, then the hosted switch, button, slider and
the mixed composition — every check against what the real screen renders and what the accessibility
tree reports, not against a JS call log.

**What the iOS failure is.** Not a UI-test failure, and not load: the run dies compiling one file,
at 19 s, with the machine idle enough either way.

```
ios/core/NitroUiDeclaredFallbacksLoader.m:16:2: fatal error: module 'Foundation' is defined
in both 'example/ios/Pods/../build/ModuleCache.noindex/2RMXKLR3IP4PI/Foundation-2D6I54GZO0EPV.pcm'
    and 'example/ios/build/ModuleCache.noindex/2RMXKLR3IP4PI/Foundation-2D6I54GZO0EPV.pcm'
```

Two spellings of one directory. What was checked, in order:

1. **ccache did not run in that build.** `scripts/real-input/ios.mjs` has no ccache wiring, and RN
   hands Xcode `CCACHE_BINARY` as a *build setting*, so RN's own wrapper script execs plain clang.
   ccache's counters are the same on both sides of the gate run: 3919 calls, 2241 hits.
2. `real-input:ios` builds its own app — it needs the UI-test bundle — with plain `xcodebuild`, and
   into the same derived data path as `build-app.mjs`, which means the same module cache.
3. 588 `.pcm` files in this worktree's module cache carry the `Pods/../build/...` spelling. The same
   layout on a `main` worktree has none.
4. **Control on main**, same machine, same simulator, same derived-data layout: main's own
   `build-app.mjs --platform ios` (exit 0, 5 m 13 s), then the same `build-for-testing` command →
   exit 0 in 56 s.
5. The failing compile, extracted and run on its own from `example/ios/Pods`: with no ccache in the
   environment — the shape of the gate's own build — it reproduces verbatim, exit 1; with
   `CCACHE_BINARY`, `CCACHE_BASEDIR` and `CCACHE_NOHASHDIR` exported it exits 0, and it is a real
   compile: ccache counted one more call with the hits unchanged, so that is a miss, not a skip.

So the env X6 gives the compiler makes clang record module paths relative to `base_dir` inside a
module cache shared with every build that does not set it — today `real-input:ios`, and equally any
contributor who opens the example in Xcode or runs `xcodebuild` by hand instead of through
`build-app.mjs`. Deleting `example/ios/build/ModuleCache.noindex` clears it until the next ccache
build writes it back. It is dev-loop only: no packaged path is involved, and the pack identity
above stands.

Three ways out, none taken here because this round was no-code by instruction: give ccache builds
their own `MODULE_CACHE_DIR`; wire `ccacheEnv()` into `scripts/real-input/ios.mjs` as well; or keep
`CCACHE_BASEDIR`/`CCACHE_NOHASHDIR` out of the app-side ObjC and Swift compiles. The first is the
smallest, and the only one that removes the sharing instead of making every consumer agree to it.

## Red proofs

- `decideSkipBuild > will not serve an artifact built for different ABIs` -> `abisMatch` returns
  `true` unconditionally -> `Expected: false / Received: true` at
  `scripts/__tests__/build-speed.test.js:217`.
- `the freshness question > reports an artifact that is not there as missing` -> `checkFreshApp`
  sets `missing: false` -> `Expected: true / Received: false` at
  `scripts/__tests__/app-stamp.test.js:469`.
- Not mutated: the one line in `recordBuild` that writes `stamp.abis` (it needs a real artifact to
  reach), which is instead shown by the live run below.

## The M1 fix, live

Same worktree, same APK, exactly the review's command:

1. `--platform android` (host ABI) → `Nothing in the code tree or the binary moved…` — skipped.
2. `--platform android --arch x86_64` → builds (`BUILD SUCCESSFUL`), stamp becomes
   `"abis": "x86_64"`. Before the fix this printed "fresh, not rebuilt" and exited 0 over an
   arm64-only APK.
3. `--platform android` again, now that the stamp says `x86_64` → builds again, stamp back to
   `"abis": "arm64-v8a"`.
4. `--platform android` once more → skipped, and the stamp still says `arm64-v8a`.

## Files changed

- `scripts/build-speed-lib.mjs` — the shared logic: ABI default, ccache env plus the
  `--show-config` read-back, gradle args, `abisMatch` and `decideSkipBuild` (M1).
- `scripts/build-app.mjs` — resolves the requested ABIs *before* deciding to skip, passes
  `platform`/`abis`/`stampedAbis` into that decision, records the ABIs, and keeps the ccache init
  script and env on the `packageDebug --rerun` fallback (N3), which is the slowest path and was the
  one without them.
- `scripts/app-stamp.mjs` — `checkFreshApp` returns a `missing` flag and `assertFreshApp` routes on
  it instead of matching a message string (N7); `recordBuild` stores the Android ABIs.
- `scripts/gradle-ccache.init.gradle`, `example/android/gradle.properties`, `example/ios/Podfile`,
  `scripts/bench/build.mjs` — the caches themselves; `USE_CCACHE` is scoped to the env `pod install`
  sees instead of the whole process (N6).
- `.github/workflows/ci.yml` — see CI notes.
- `CONTRIBUTING.md` — Build speed section, with the two caveats (N4, N5).
- `scripts/__tests__/{build-speed,app-stamp}.test.js` — 44 tests, 19 + 25.

## CI notes

- **The release job builds four ABIs where `main` passed `-PreactNativeArchitectures=x86_64`.** The
  brief asks that "the release build keeps all four", so this is the brief's ask rather than X6's
  own preference, and it roughly quadruples that job's native compile on a hosted runner; the job is
  `workflow_dispatch`-only, never a pull-request gate, and the comment in `ci.yml` records the cost.
  Reverting is one line if CI time wins.
- CI also inherits the two gradle caches, because `example/android/gradle.properties` is tracked and
  `setup-gradle` persists `~/.gradle`. Both are content-keyed and RN's gradle-plugin tasks are not
  `@CacheableTask`, so no stale bundle can come out of them; it is still a CI behaviour change and
  belongs here. `NITRO_UI_CCACHE: '0'` on the three Android jobs makes CI's ccache state explicit
  instead of depending on whether the runner image happens to ship the binary.

## Follow-ups

- `scripts/native-tests-android.sh` deliberately got neither the init script nor the ccache env
  (N8): it configures CMake with its own arguments, and alternating with `build-app.mjs` would
  reconfigure the native build on every switch. The JVM tests are gradle-dominated anyway.
- What the merge bar still needs is the module-cache fix: give ccache builds their own
  `MODULE_CACHE_DIR` and the duplicate-module failure in
  [Merge bar: real-input](#merge-bar-real-input) loses its route to a plain `xcodebuild`.
  `rm -rf example/ios/build/ModuleCache.noindex` unblocks a build in the meantime, once per
  occurrence.
- Nothing here measures the first-ever build (no ccache, no build cache). One such cell would close
  the M2 question; it costs ~10 minutes and a scratch `GRADLE_USER_HOME`.

## Fix round 1

M1 was real and is fixed: the ABIs a build was asked for are resolved before the skip decision,
recorded in the stamp, compared as a set, and an absent field means "build". `decideFreshness` still
ignores ABIs — the gate's question is "is this binary from this tree", not "is it the right ABI" —
and it is demonstrated live above, with a test for each half. M3: the `~/.config/ccache` file
round 1 wrote is deleted, verified by `ccache --show-config` above. M2: the timing section was
corrected *in place*, not merely annotated here, because the review's complaint was that the
claims themselves were wrong — the cold cells are now labelled for what they were, bench
Android is called cache, the Swift row is called noise, "if anything pessimistic" is gone, and the
unmeasured truly-cold cell is stated. M4: both harness suites ran on a leased pair through
`gate.mjs`, on builds that came from the cached path; the ledger is exported beside this report. Of
the N list, N1–N7 are done (N1 by keeping the brief's four ABIs and recording the cost, not by
reverting); **N8 is skipped on purpose** and is in the follow-ups.
