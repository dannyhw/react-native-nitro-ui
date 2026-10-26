# X1 — Dev tooling: CI checks, fresh-build helper, device lease

**Branch:** `task/X1-dev-tooling` (from `main` at `892324a`) · **Rounds:** 1, then fix round 1
(D19) · **Node:** `fnm exec --using 24 --` (v24.22.1), bun 1.4.0 · **Devices:** the leased pair
only — AVD `nitroui_t03` as `emulator-5574` on a private adb server (5043), Metro 8295, booted by
the harness under a lease and powered off afterwards. No device outside the lease was touched, the
reserved emulator serial was never used, the default adb server was never killed, and no process
was killed by name. The gate ran after the post-publish smoke task had finished with its devices
(its all-green report is merged into `main` at `7499b15`).

## 1 — CI, checks only

`ci.yml` runs on push to `main` and on pull requests as three free hosted jobs: `checks`
(ubuntu, `bun run check`, Node from `.nvmrc`, bun 1.4), `native-tests` (macOS, pinned to
`macos-26` — the one part of `check` that prints a skip reason on Linux) and `build-android`
(debug, x86_64). Both harness jobs, the Android release build and everything in `bench.yml` /
`smoke.yml` are `workflow_dispatch` only now, their schedule and label triggers off; the jobs
stay, so re-enabling is a one-block change. `ci.yml` gained `workflow_dispatch` to keep them
startable, and both files carry `permissions: contents: read`. Fixed what only bites away from
this Mac: shellcheck findings that appear when run bodies are parsed on Linux, and a `smoke.yml`
job name that read `${{ env.SDK }}` (the `env` context is unavailable in a job name).
`.github/actionlint.yaml` declares the one self-hosted label. No workflow was enabled on GitHub.

## 2 — `scripts/build-app.mjs` + `app.stamp`

One build per worktree, fixed output path (`-derivedDataPath` under `example/ios/build`;
`app-debug.apk`), pods through the repo's one path, and `packageDebug --rerun` when the built
dex is missing a registered component. It writes `app.stamp`: the digest of the code tree (every
tracked/untracked non-`build`, non-`.md` file — HEAD is recorded beside it, not inside it), the
resolved artifact path and a digest of the bytes it scanned, and per-component mention counts in
the binary. The tree is hashed before the compile and again when the stamp is written; if the two
disagree nothing is written. `example/rn-harness.config.mjs` and both real-input entry points read
the stamp and **refuse before touching a device**, and refuse an artifact that is not the file the
stamp was written for — so a refusal cannot run someone else's binary or hold a device another
task needs. `HARNESS_APP_PATH` is set from it, so `bun run harness:android` needs no environment
in a built worktree.

## 3 — `scripts/lease.mjs`

`acquire|renew|release|list` (+ pure `lease-core.mjs`). Pool from `~/.nitro-ui/devices.json`
(shape documented, example shipped at `scripts/devices.example.json`), state in
`~/.nitro-ui/leases.json` under an `O_EXCL` lock with token-checked stale-lock stealing. Every
lease expires by its own ttl, max 2 device leases, `--exclusive` waits until every other lease
has ended and defaults to 16 h, and a task waiting for an exclusive lease holds new leases back
while the machine drains. `emulator-5560` can never be leased — a pool containing it is refused
when read — and the harness boots the leased AVD on the leased console port, so the serial a lease
names is the serial that exists. It prints names the scripts already read (`IOS_SIM_UDID`,
`ANDROID_AVD`, `ANDROID_SERIAL`, `ANDROID_ADB_SERVER_PORT`, `EMULATOR_PORT`, `METRO_PORT`, …), so
leasing is a `source`, not an edit.

## 4 — Small fixes

`bun run harness:*` runs through `scripts/harness.mjs`, which does the Node guard and then hands
over to the CLI; the app builds and the real-input gates re-exec under `.nvmrc`'s Node through fnm
and refuse honestly when fnm cannot provide it. `scripts/pod-install.mjs` is the only
`pod install`, used by `bench/build.mjs` and both smoke scripts, prefers the CocoaPods a
`Podfile.lock` records, and its exit status is now checked by every caller.
`--update-baseline` prettier-formats what it writes, from the repo root.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `bun run check` | **PASS** | exit 0 on the final tree: 21 suites / 344 tests, `test:native` PASS |
| `bun run test` (new suites) | **PASS 84** | lease 46, app-stamp 22, pod-install 12, bench-baseline-format 4 |
| `actionlint .github/workflows/*.yml` | **PASS** | clean; all action refs still SHA-pinned |
| `lease acquire` → `source` → `release` | **PASS** | `X1-kwv6c` for the device gate; `list` empty afterwards |
| `build-app.mjs --platform android` | **PASS** | 30 s, tree `591f955534d3` (499 files), 8 components |
| `build-app.mjs --platform android --arch x86_64` (the CI command) | **PASS** | 72 s from the same tree; the stamped build is what `build-android` now runs |
| **harness:android — leased device gate** | **PASS 162 tests / 11 suites** | 175.3 s, through `build-app.mjs` + a lease; log shows "app is fresh" and "nitroui_t03 boots on console port 5574 (serial emulator-5574)" |
| red: no `app.stamp` | **refused** | "nothing proves this binary was built from this checkout", exit 1, no device work |
| red: stale tree | **refused** | "built from a different code tree (stamp 3832dc40 …, now 7588a938 …)" |
| red: a copy of the APK at another path | **refused** | "app.stamp was written for a different file than the one about to be tested", both paths named |
| red: a `src/` edit after the build | **refused** | `591f9555` → `447fc3f4`, same HEAD — the digest moved, HEAD did not |
| red: component missing from the APK | **refused** | re-ran `:app:packageDebug --rerun`, then refused when still missing |
| red: unformatted baseline mint | **fails `bun run format`** | with the format step bypassed; green once restored |
| `lease renew` on a live lease | **PASS** | `X1-renew-probe-l7zj9` → "renewed … - 240m from now" (its own ttl), then released |

## Fix round 1

Four must-fix items and ten should-fix, all addressed; the `Gates` rows above are the fixed
tree re-run.

| Finding | Fix | Evidence |
| --- | --- | --- |
| M1 lease judged by the caller's ttl | `6bcdf3d` | each lease ages by its own ttl, `renew` by that ttl, exclusive defaults to 960 min; a two-TTL test |
| M2 stamp not bound to the artifact | `c67f7aa` | stamp v2 records `artifactPath` + scanned-bytes digest; copy-at-another-path refused; three new tests |
| M3 tree hashed after the build | `c67f7aa`, `3cada3e` | before/after hash in `build-app.mjs` and real-input iOS; no stamp written when they differ |
| M4 HEAD in the digest | `c67f7aa` | HEAD `72645784` → `d7ac634` (docs only) keeps the stamp green at `591f955534d3`; a `src/` edit turns it red at the same HEAD |
| S1 CI harness jobs build unstamped | `d251716`, `52611fc` | the dispatch jobs and `build-android` all go through `build-app.mjs` |
| S2 no `permissions:` | `d251716` | `contents: read` in `ci.yml` and `smoke.yml` |
| S3 stale-lock steal race | `6bcdf3d` | lock token, steal by `rename` + re-check; two-stealer test takes two pairs |
| S4 exclusive starvation | `6bcdf3d` | `pendingExclusive` marker holds new acquires back; a lock timeout retries inside the wait |
| S5 emulator console port unassigned | `f0cd251` | `-port $EMULATOR_PORT` patch, `checkEmulatorEnv` in the harness config and real-input; gate log shows `emulator-5574` |
| S6 new iOS files skip `pod install` | `3cada3e` | digest of what the last install was shown; install when it moves |
| S7 needle matched the spec | `c67f7aa` | JVM class descriptor / length-prefixed Swift name |
| S8 `pod install` exit ignored | `3cada3e` | both callers throw on a non-zero status |
| S9 harness refused the wrong Node | `a06cad1` | `scripts/harness.mjs`; a missing pinned Node now refuses with `fnm install 24` |
| S10 Android with no artifact | `c67f7aa` | refuses; `NITRO_UI_ALLOW_UNSTAMPED=1` is the logged escape |
| S11 device names in this report | this commit | no device outside the lease named; two claims corrected above |
| N1–N4 (fnm, config docs, prettier cwd, macOS pin) | `a06cad1`, `f0cd251`, `d36993f`, `d251716` | each message |
| lint red left by round 1's lease tests | `7264578` | `bun run check` exit 0 |

## Follow-ups, not fixes made here

- One adb server sees every emulator on the machine: the leased pair's private server (5043) also
  listed another task's emulator on port 5570. Serials and `reservedIdentifiers` are what keep a
  task off it; a per-task server is not actually private.
- `scripts/bench/run.mjs` does not re-exec under `.nvmrc`: a bench run on Node 26 refuses where a
  harness run restarts.
- The macOS `native-tests` job compiles with `-Werror`: a newer hosted clang could turn an
  unrelated warning red, which is why its image is now pinned.
- `harness-ios` still names the `xcode-27` preview label (dispatch-only, so nothing queues).
- Workflows stay disabled on GitHub for the orchestrator.
