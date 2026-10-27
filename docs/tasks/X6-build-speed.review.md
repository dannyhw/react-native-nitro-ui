# X6 — build speed: review (round 1)

**Verdict: MERGE WITH FIXES.** Nothing here reaches a library user. The diff
(`git diff cdcd6a8...HEAD --stat`) touches no packaged path: not `src/`, `lib/`,
`android/`, `ios/`, `cpp/`, `nitrogen/`, `*.podspec`, `package.json` or
`CHANGELOG.md`. The ccache launcher reaches the package's CMake only through a
`-I` init script that `build-app.mjs` passes on the command line. The four
speed-ups are sound in mechanism, and none of them can serve a stale binary that
a gate then passes. There is one exception: the skip ignores the requested ABI
(M1), which gives a wrong-ABI APK. It fails at install rather than passing
silently. The other must-fixes are a report that overstates what it measured,
undisclosed and ineffective machine-global state, and the harness gate that has
not run.

Checked without builds: the diff, RN 0.88's `ccache-clang.sh` / `ccache.conf` /
`set_ccache_compiler_and_linker_build_settings`, RN's gradle plugin task
annotations, `ccache --show-config` on this machine, the built APK's `lib/`
entries, and `jest scripts/__tests__/{build-speed,app-stamp}.test.js` (37/37
pass). No simulator, emulator or full build was used.

## M — must fix

**M1. The skip ignores the requested ABI.** `scripts/build-app.mjs:450`
decides freshness before `resolveAndroidAbis` runs (`:472`). The stamp
(`recordBuild`, `scripts/app-stamp.mjs`) has no ABI field, so `--arch` and
`NITRO_UI_ANDROID_ARCH` play no part in the decision. Here is how it goes wrong:
the APK in this worktree is `arm64-v8a` only (checked with `unzip -l`). After
that build, `node scripts/build-app.mjs --platform android --arch x86_64` (an
x86_64 AVD, or reproducing the CI command at `ci.yml:122`/`:212`) prints
"fresh, not rebuilt" and exits 0. `adb install` then fails with
`INSTALL_FAILED_NO_MATCHING_ABIS`, or a multi-ABI request gets a one-ABI APK.
The command line said one thing and the script silently did another.
Fix: record `abis` in the Android stamp and skip only on an exact match. A
missing field means "build". The alternative is to read the APK's `lib/<abi>/`
set. Add a test next to `decideSkipBuild`. Note that `decideFreshness` (the
gate) should *not* refuse on ABI; this decision belongs only to the skip.

**M2. The report overstates its "cold" and "pessimistic" claims**
(`docs/tasks/X6-build-speed.report.md:12,22,25,30,35-39`).
- The X6 "cold" cells were not cold. The report itself says the Android
  "fresh worktree, cold" build had 36 `FROM-CACHE` tasks, and the first iOS
  pass got 236/890 ccache hits. Both caches were partly warm from earlier X6
  runs. Bench Android "cold" (341.85 → 27.04 s) is nearly all cache: it ran
  after the example populated ccache (129/129) and the gradle cache. The real
  first-ever build is what a new contributor or a cache-less CI runner gets,
  and it was not measured. Neither was ccache's miss overhead on it. So
  180 → 119 s cannot be attributed to X6.
- "X6 is if anything pessimistic" (`:30`) does not follow from one run per cell
  at a load of 20–190 against 5–60. Load that high makes the noise larger than
  some of the deltas, in either direction. iOS "1-line Swift change"
  220 → 195 s is one such case: nothing in X6 touches `swiftc`, so that delta
  is noise, not a gain.
- The claims that do hold are the ones whose mechanism the hit rates
  corroborate: the skip (0.56/0.86 s), the iOS `cpp/` rebuild 215 → 55 s at
  234/236 hits, and both second-worktree rows (17 s / 138 s at 99% ccache).
Fix: relabel the X6 cold cells "first X6 build, caches partly warm (N
from-cache / M ccache hits)" and drop "pessimistic". Mark the Swift row "no
change expected". Either measure one truly cold cell (`NITRO_UI_CCACHE=0`, plus
`--no-build-cache` or an empty `GRADLE_USER_HOME`) or say it was not measured.

**M3. The machine-global ccache edit has no effect, and the report never
mentions it.** The implementer wrote `max_size = 25G` and `hash_dir = false` to
`~/.config/ccache/ccache.conf`. On this Mac `XDG_CONFIG_HOME` is unset, so
ccache never reads that file. `ccache -sv` names
`~/Library/Preferences/ccache/ccache.conf` (absent) as the config file, and
`--show-config` reports `(default) max_size = 5.0 GiB`,
`(default) hash_dir = true`. Today the edit is therefore harmless to other
projects, but it is dead machine state that misleads the next person. It also
stops being harmless the moment anything sets `XDG_CONFIG_HOME`: from then on,
every other project on the machine would share objects across directories and
get the wrong `DW_AT_comp_dir`. Even had it worked, the edit would be the wrong
layer. For iOS, RN's `ccache-clang.sh` sets `CCACHE_CONFIGPATH` to its own file
when unset, which replaces the user config entirely, and `CCACHE_NOHASHDIR` in
the environment already covers Android.
Fix: delete the file (or restore what was there) and say so in the report. If
the owner wants more than 5 GiB, add `CCACHE_MAXSIZE` to `ccacheEnv()`
(`scripts/build-speed-lib.mjs:124`). It is per-repo, outranks every config file
including RN's, and so applies to both platforms. A per-repo
`CCACHE_CONFIGPATH` is the wrong tool: exporting it would also displace RN's
sloppiness settings for iOS. Currently 1.2 of 5.0 GiB are in use, so this is
not urgent. Also correct the comment at `build-speed-lib.mjs:106`: that file is
not read for *any* build on macOS, not just iOS ones.

**M4. The brief's harness gate has not run** (report `:64`). X6 changes how
the example's iOS objects are compiled (`:ccache_enabled`, `base_dir` path
rewriting) and the example Podfile's post-install. A successful stamp proves the
components are in the binary; it does not prove the app runs. Run the two
commands the report lists once pair-a's lease is free, before merging. This is
an orchestrator action, not a code fix.

## N — nice to have

**N1. The CI release job got slower, and the report does not say so**
(`.github/workflows/ci.yml:165`). On `main` the job ran with
`-PreactNativeArchitectures=x86_64`. It now builds all four ABIs, which
roughly quadruples the native compile on a hosted runner. The brief's "the
release build keeps all four" assumed it already did. Coverage is arguably
better: consumers' apps build four ABIs by default, and this is the only job
that would catch an `armeabi-v7a`/`x86` compile break in `cpp/`. But it is a
CI cost the owner should choose knowingly. State it in the report, or revert to
`x86_64` if CI time wins.

**N2. CI now uses the Gradle build cache and configuration cache too.** The
example's `gradle.properties` is tracked, and `setup-gradle` persists
`~/.gradle`. Both caches are content-keyed and none of RN's gradle-plugin tasks
are `@CacheableTask` (checked: `BundleHermesCTask` has no annotation, and its
`sources` excludes `node_modules`, so it is *not* cache-restorable), so no
stale bundle can come out of the cache. It is still a CI behaviour change and
belongs in the report. `NITRO_UI_CCACHE=0` in the CI env would also make CI's
ccache state explicit rather than depending on whether the runner image ships
ccache.

**N3. The `--rerun` safety net drops the init script**
(`scripts/build-app.mjs:405`). The first gradle invocation passes
`...ccache.gradleArgs` and the rerun does not. If the rerun ever fires, it gets
a different configuration-cache key and CMake arguments without the launcher.
That means a full reconfigure and uncached recompile of the library's C++ and
nitro-modules, and a second reconfigure on the next normal build. The result
stays correct, but the slowest path is now the one the safety net takes. Pass
the same args.

**N4. Debug info points at the worktree that first compiled the object.**
`CCACHE_NOHASHDIR=1` with `-g`, which is what ccache's manual warns about. In a
second worktree, lldb/Xcode/Android Studio resolve C++ sources to the first
worktree's paths, or to nothing once that worktree is deleted. It does not
affect gates. Document it in CONTRIBUTING's Build speed section (the fix there
is `NITRO_UI_CCACHE=0` or `--force` for a native-debugging session), or add
`-fdebug-prefix-map`.

**N5. iOS inherits RN's `sloppiness` across worktrees.** That includes
`modules`, `pch_defines`, `file_stat_matches` and `system_headers`. This is
upstream's choice, and stats differ per worktree (inode, mtime), so the stat
shortcut does not cross worktrees. The residual risk is `@import`-ed module
changes that are not hashed. No file under `ios/` uses `@import` today, so it is
noted, not blocking. `--force` / `NITRO_UI_CCACHE=0` is the escape hatch;
CONTRIBUTING could say so.

**N6. Importing `scripts/bench/build.mjs` has a side effect**
(`scripts/bench/build.mjs:144`). The file sets `process.env.USE_CCACHE = '1'`
at import time, so `bench/run.mjs` and any future importer inherit it for every
child process. `buildEnv()` already adds it, so set it only in the env that
`installPods`/`pod install` receives.

**N7. Test gaps.** `checkFreshApp` (new) has no direct test. Only
`decideSkipBuild`, which is trivial, is covered, not the build-app wiring. The
ABI case of M1 is untested. `assertFreshApp` now routes on
`problems[0].endsWith('does not exist')` (`scripts/app-stamp.mjs:501`), a
string match that a reworded message breaks. Return a `missing: true` flag
from `checkFreshApp` instead.

**N8. `scripts/native-tests-android.sh` gets neither the init script nor the
ccache env.** The JVM-test configure still compiles the library's CMake, so it
gets no cache. Wire it in, or say it was left out on purpose.

## The questions asked

1. **Safety of each speed-up.**
   - *arm64 local builds:* already the default on `main` (`defaultArch`). X6
     only adds the env override. Safe apart from M1.
   - *Gradle caches:* keys are content-based, RN's tasks are not cacheable, and
     init-script and env reads are configuration-cache inputs. I found no
     stale-hit path across worktrees. Config cache is correctly off for the
     bench, whose Expo `app/build.gradle` runs `node` at configuration time.
   - *ccache:* flags, the target triple (per ABI) and the compiler identity are
     all hashed. `base_dir` is the worktree root, and Pods, `node_modules` and
     DerivedData all live under it, so relative paths line up and a different
     header in another worktree hashes as a different file, which is a miss.
     The `CCACHE_BINARY` diagnosis is right: RN's wrapper is
     `exec $CCACHE_BINARY clang`, and a build setting is not compiler env. The
     0 → 236 movement proves it. Without ccache, RN takes its "remove" branch,
     or its "warn" branch if `:ccache_enabled` is set and the binary is
     missing. Neither breaks a build.
   - *Skip:* it uses exactly the gate's question (tree digest plus artifact
     path and fingerprint), so it cannot pass anything the gate would refuse.
     The only new hole is M1.
   - *Leaks to consumers:* none. CI keeps full-ABI release builds (N1) and
     builds without ccache wherever the runner has none.
2. **Tracked example files.**
   - `example/android/gradle.properties`: needed, and harmless to consumers. It
     also turns the caches on in CI (N2).
   - `example/ios/Podfile`: needed. The post-install stripping of
     `CC`/`CXX`/`LD`/`LDPLUSPLUS`/`CCACHE_BINARY` from the user project is
     right, because it keeps a machine path out of the tracked `.pbxproj`,
     which is unchanged in the diff.
   - `example/ios/Podfile.lock` (`3b3bb7c`): the `PODFILE CHECKSUM` line is
     required by the Podfile edit. `NitroUi 0.1.0 → 0.1.1` and its checksum are
     a catch-up: `main` is already at 0.1.1 and its lock was stale, so any
     `pod install` would write them. Harmless; keep it.
3. **Global ccache state.** Not acceptable as left, though it is inert on this
   machine (M3). Per-repo is the right shape, and the env vars are the per-repo
   mechanism. `CCACHE_CONFIGPATH` is not.
4. **Measurements.** Mechanism-backed rows are credible, and the "cold" and
   "pessimistic" framing is not (M2). The npm-pack claim is consistent with
   the diff: no packaged path changed, and build outputs land in paths that
   `files` excludes.
5. **Tests, docs, hygiene.**
   - Tests: pass, with gaps (N7).
   - CONTRIBUTING: accurate apart from the `~/.config` comment (M3) and the
     debug-info caveat (N4).
   - Personal info: none in the diff. The only home-relative path is the
     generic `~/.config/ccache/ccache.conf` in a comment, and there are no
     hostnames or emails. Commit author lines match the repo's existing
     convention.
