# X1 — Dev tooling: CI checks, fresh-build helper, device lease

**Branch:** `task/X1-dev-tooling` (from `main` at `892324a`) · **Round:** 1 of 3 (D19) ·
**Node:** `fnm exec --using 24 --` (v24.22.1), bun 1.4.0 · **Devices:** the leased pair only —
AVD `nitroui_t03` as `emulator-5574` on a private adb server (5043), Metro 8295, booted and
shut down by the harness. The iPhone Air, `nitroui_t01`, the `RNSB …` simulators and
`emulator-5560` were not touched, the default adb server was never killed, no process was
killed by name. The gate ran only after the post-publish smoke task had finished with its
devices (its all-green report is merged into `main` at `7499b15`).

## 1 — CI, checks only

`ci.yml` runs on push to `main` and on pull requests as three free hosted jobs: `checks`
(ubuntu, `bun run check`, Node from `.nvmrc`, bun 1.4), `native-tests` (macOS — the one part of
`check` that prints a skip reason on Linux) and `build-android` (`:app:assembleDebug`, x86_64).
Both harness jobs, the Android release build and everything in `bench.yml` / `smoke.yml` are
`workflow_dispatch` only now, their schedule and label triggers off; the jobs stay, so
re-enabling is a one-block change. `ci.yml` gained `workflow_dispatch` to keep them startable.
Fixed what only bites away from this Mac: shellcheck findings that appear when run bodies are
parsed on Linux, and a `smoke.yml` job name that read `${{ env.SDK }}` (the `env` context is
unavailable in a job name). `.github/actionlint.yaml` declares the one self-hosted label. No
workflow was enabled on GitHub.

## 2 — `scripts/build-app.mjs` + `app.stamp`

One build per worktree, fixed output path (`-derivedDataPath` under `example/ios/build`;
`app-debug.apk`), pods through the repo's one path, and `packageDebug --rerun` when the built
dex is missing a registered component. It writes `app.stamp`: a content hash of the code tree
(every tracked/untracked non-`build`, non-`.md` file, HEAD folded in), the
HEAD sha, and per-component mention counts in the binary. `example/rn-harness.config.mjs` and
both real-input entry points read it and **refuse before touching a device**, so a refusal
cannot hold a device another task needs. `HARNESS_APP_PATH` is set from it, so
`bun run harness:android` needs no environment in a built worktree.

## 3 — `scripts/lease.mjs`

`acquire|release|list` (+ pure `lease-core.mjs`). Pool from `~/.nitro-ui/devices.json` (shape
documented, example shipped at `scripts/devices.example.json`), state in `~/.nitro-ui/leases.json`
under an `O_EXCL` lock with stale-lock stealing and a TTL. Max 2 device leases; `--exclusive`
waits until every other lease has ended; `emulator-5560` can never be leased — a pool containing
it is refused when read. It prints names the scripts already read
(`IOS_SIM_UDID`, `ANDROID_AVD`, `ANDROID_SERIAL`, `ANDROID_ADB_SERVER_PORT`, `METRO_PORT`, …),
so leasing is a `source`, not an edit.

## 4 — Small fixes

Device scripts re-exec under `.nvmrc`'s Node through fnm instead of refusing (the refusal stays
when there is no fnm, the pinned version is missing, or a re-exec already happened);
`scripts/pod-install.mjs` is the only `pod install`, used by `bench/build.mjs` and both smoke
scripts, and prefers the CocoaPods a `Podfile.lock` records; `--update-baseline`
prettier-formats what it writes.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `bun run check` | **PASS** | full run in this worktree, through `readme:check` |
| `bun run test` (new suites) | **PASS 60** | lease 30, app-stamp 14, pod-install 12, baseline-format 4 |
| `bunx eslint scripts/ example/rn-harness.config.mjs` | **PASS** | 0 errors, 0 warnings |
| `actionlint .github/workflows/*.yml` | **PASS** | clean; all action refs still SHA-pinned |
| `lease acquire` → `source` → `release` | **PASS** | `X1-h0zgd`, `X1-hcr2u`; `list` empty afterwards |
| `build-app.mjs --platform android` | **PASS** | 6 s at `e5d1aab` (23 s and 58 s for full builds) |
| **harness:android — leased device gate** | **PASS 162 tests / 11 suites** | 191.3 s at `e5d1aab`, tree `97dac2a019f5`; 196.8 s on the earlier round |
| red: no `app.stamp` | **refused** | "nothing proves this binary was built from this checkout", exit 1, no device work |
| red: stale tree | **refused** | "built from a different code tree (stamp 3832dc40 …, now 7588a938 …)" |
| red: component missing from the APK | **refused** | re-ran `:app:packageDebug --rerun`, then refused when still missing |
| red: unformatted baseline mint | **fails `bun run format`** | with the format step bypassed; green once restored |

## Follow-ups, not fixes made here

- Committed `bench/baselines/*.json` carry the minting machine's `hostname` — a D25 leak from
  `report.mjs`. Needs a decision: drop `machine` or reduce it to a device key.
- `scripts/bench/run.mjs` does not re-exec under `.nvmrc`: a bench run on Node 26 refuses where
  a harness run restarts.
- The macOS `native-tests` job compiles with `-Werror`: a newer hosted clang could turn an
  unrelated warning red.
- `harness-ios` still names the `xcode-27` preview label (dispatch-only, so nothing queues).
- The stamp folds in HEAD, so committing invalidates it by design; expect a rebuild after each
  commit (incremental: seconds). Workflows stay disabled on GitHub for the orchestrator.
