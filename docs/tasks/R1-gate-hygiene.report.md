# R1 — Release readiness 1: gate hygiene: report

**Branch:** `task/R1-gate-hygiene` (from `main` at `d9ad897`) · **Devices:** iPhone 17
`F08675D3-A32B-4F88-BC81-02D7E0CB797E`, AVD `nitroui_t01` (`emulator-5570`, adb server
`5041`), Metro `8293` — both booted by hand for this task and shut down at the end
(iPhone Air, `nitroui_t02`/`emulator-5572` and `emulator-5560` belong to G4 and the owner and
were not touched) · **Platforms:** both.

## Verdict

All four items are done, and the interesting one is item 1: the wall-clock gates are now
reported-everywhere / judged-only-on-a-quiet-machine, which is what D21 asked for, but the
assertion side needed a channel that did not exist. An in-app test cannot read this host's
load average, and Metro's dev server in this repo turns out to serve **no project file at
any path** — the first version of this gate published a JSON file and got 404 for it
everywhere. So the runner publishes the number and `example/metro.config.js` declares one
exact-path route that serves it (see §1 for why it has to ride the Metro port).

1. **Six wall-clock thresholds across five assertions** now go through
   `expectTimingBudget()`: reported on every run, judged only under `HARNESS_TIMING=1`, and
   a hard failure ("refuses to judge") when `load1 >= 10`. Structural counters and every
   pixel-delta assertion stayed gated on all runs. Shown red twice: once as the busy refusal,
   once as a forced-slow miss.
2. **`ERR_STREAM_WRITE_AFTER_END` is gone.** Reproduced on the old code (exit 7), green on
   the new one (exit 0, port released), and proven end-to-end by running real-input on both
   platforms with no pre-started Metro.
3. **Node 26 now says what is wrong.** Both device entry points refuse it (and Node < 22.11,
   and 25) with the pinned version from `.nvmrc` and a copy-pasteable fix, before the
   harness's misleading ESM error. One line in CONTRIBUTING.
4. **Gates:** `bun run check` green; full harness suites green on both platforms **without**
   `HARNESS_TIMING` (72 tests each); real-input **3/3 on iOS and 3/3 on Android**.

## 1. Wall-clock gates behind `HARNESS_TIMING` (D21)

### Every converted assertion

`expectTimingBudget()` is `example/__tests__/timingGate.ts`; helper, thresholds and labels
below are the whole set — nothing else in `example/__tests__` asserts a duration.

| Site | Assertion before | Label | Limit |
| --- | --- | --- | --- |
| `example/__tests__/Sizing.harness.tsx:657` | `expect(flushMs).toBeLessThan(mountedIn * 0.1)` | cold batch of 200: one correction flush | `mountedIn * 0.1` |
| `example/__tests__/Sizing.harness.tsx:663` | `expect(flushMs).toBeLessThan(Platform.OS === 'android' ? 250 : 40)` | cold batch of 200: one correction flush | 250 (Android) / 40 (iOS) |
| `example/__tests__/Sizing.harness.tsx:1822` | `expect(row.mountedIn).toBeLessThan(count > 1 ? 12000 : 4000)` | bench: mount a batch of N | 12000 / 4000 per row |
| `example/__tests__/Slider.harness.tsx:1515` | `expect(mountedIn).toBeLessThan(15000)` | Slider stress: mount 40 instances | 15000 |
| `example/__tests__/Switch.harness.tsx:671` | `expect(mountedIn).toBeLessThan(10000)` | Switch stress: mount 40 instances | 10000 |

Six thresholds over five call sites (the cold-batch test judges `flushMs` twice). What did
**not** move:

- **Structural counters** — corrections, immediate pushes, flush counts, stale frames, event
  counts — asserted on every run, as the brief requires.
- **Pixel deltas** — every remaining `toBeLessThan(0.6)` / `toBeLessThan(1.5)` in the suites
  is a layout tolerance, not a duration; I checked each one.

The three behaviours, from the same helper:

- `HARNESS_TIMING` unset → log `timing: <label> Xms (limit Yms) - reported, not gated
  (D21: HARNESS_TIMING=1 gates it) · load1 …/<n> cores`, assert nothing.
- `HARNESS_TIMING=1`, quiet machine → `expect(measuredMs).toBeLessThan(limitMs)`
  (`example/__tests__/timingGate.ts:291`).
- `HARNESS_TIMING=1`, `load1 >= busyLoad1` (10) → fail loudly, never a silent skip.

Startup prints which mode it is in, so nobody mistakes a reported run for a judged one:
`harness: wall-clock gates off (HARNESS_TIMING=unset) · load average … over 14 cores · a
gate refuses at load1 >= 10 · published to harness-timing/state.json`.

### The channel, and why `example/metro.config.js` is touched

The brief did not name `metro.config.js`; it is the smallest thing that works, and it is one
route, not a browser.

- The assertion runs **inside the app**, so the host load average has to come over the
  network. An Android emulator reaches this machine only through the `adb reverse` the
  harness already sets up for Metro, so a second host port would be readable on iOS and
  unreachable on Android. It has to be the Metro port.
- **Discovery:** this repo's dev server serves no project file at any path —
  `harness-timing/state.json`, dot-directories, `assets/…` all answered 404, and only the
  harness's own `/status` answered at all. Publishing a file was not enough. So
  `scripts/harness-timing-gate.js` exports `withTimingGateRoute()` and the config installs it
  via `server.enhanceMiddleware` (honoured by `createConnectMiddleware`, and preserved
  because `withRnHarness` spreads `config.server`). It answers exactly `TIMING_GATE_URL` and
  hands every other path on — `/some/other/path.json` still 404s.
- The publisher is **CJS** (`scripts/harness-timing-gate.js`) so `metro.config.js` (CJS) and
  `rn-harness.config.mjs` (ESM) import one source of truth:
  `TIMING_GATE_FILE = 'harness-timing/state.json'`, the matching URL, `BUSY_LOAD1 = 10`, and
  a payload carrying `load1`, `load5`, `cores`, `busyLoad1`, `metroPort`, `updatedAt`.
- The file is refreshed while the run lives, so a reader sees the load at the moment it
  asserts, not at bundle time; the refresh timer is `unref()`'d so it can never keep the CLI
  alive. Readers reject a stale file: `metroPort` must match and `updatedAt` must be < 15s
  old. A missing file (404) is reported, not gated — a run without a publisher says nothing.
- `harness-timing/` is gitignored (root `.gitignore`). Note `<projectRoot>/.harness/` was the
  first guess and is `react-native-harness`'s own cache directory — not ours to write.

### How the gate was shown to fail first

Both required proofs, on a real device run (`Switch`, iOS):

- **Busy refusal** — `HARNESS_TIMING=1 bunx react-native-harness --harnessRunner ios Switch`
  on a saturated host (`/tmp/r1-proof-refusal.log`): `Tests: 1 failed, 14 passed, 15 total`,
  exit 1 —
  `timing gate for "Switch stress: mount 40 instances" refuses to judge: this machine is busy (load1 223.81 >= 10). Measured 29.5ms against a 10000ms limit …`.
  This also proves the app really read the host `load1` through the route.
- **Forced-slow red** — with two deliberate temporary edits (publisher `BUSY_LOAD1 = 1000` so
  it judges at load 140, and `limitMs: 1` so a correct run misses): failure is
  `expected 26.1429580450058 to be less than 1` from `timingGate.ts:291`, 1 failed/15, exit 1
  (`/tmp/r1-proof-red2.log`). **Both temporary edits reverted; the tree was clean before the
  report commit.**

Where the numbers land: `console.log` from a harness test only surfaces when that suite has a
failing assertion, so §4's green runs are the shape, and the two runs above are the samples
of the format. See follow-ups.

## 2. `scripts/real-input/support.mjs` — `ERR_STREAM_WRITE_AFTER_END`

**Cause:** `startMetro` piped *both* `stdout` and `stderr` into one
`createWriteStream(...)`. When the script owned Metro and shut it down, the first child pipe
end ended the shared stream and the second pipe's write threw — an uncaught error after the
run had already decided it passed.

**Fix:** one `stdio: ['ignore', fd, fd]` on the child (no pipes, so nothing can write after
end), `fs.openSync(logFile, 'w')`, plus an idempotent `stopMetro` and an `appendFileSync`
exit note on close. `example/ios/Podfile.lock` style noise: none — no library code involved.

**Proof, same command before and after** (`/tmp/r1-repro/metro-stream.mjs`, the shipped
`startMetro`/`stopMetro` against a real server, own port):

| | exit | result |
| --- | --- | --- |
| pre-fix code | **7** | `UNCAUGHT: Error [ERR_STREAM_WRITE_AFTER_END]: write after end` |
| shipped code | **0** | server stopped, port released, exit note in the log |

Then the real thing, with **no pre-started Metro** on either platform (§4): both runners
started Metro themselves, logged `metro: started on 8293`, and exited 0 with the port free
afterwards (curl → `000`).

## 3. Node 26: an early, clear refusal

`.nvmrc` pins 24; on Node 26 the harness dies with a misleading ESM error (recorded in
`docs/tasks/G1-slider.report.md`). `scripts/node-version.mjs` exports
`assertSupportedNode()`, called first in `example/rn-harness.config.mjs`,
`scripts/real-input/ios.mjs` and `scripts/real-input/android.mjs` — before any device or
Metro work. It refuses anything below 22.11, plus 25 and 26, reads the pin from `.nvmrc`
rather than duplicating it, and stays out of the way of Bun. Message names the symptom it is
pre-empting and gives the fix, including a form that does not leave your shell:

```
nvm use            (or: fnm use)
without leaving your shell: fnm exec --using 24 -- <command>
```

**Proof:** both device entry points, invoked on Node 26.3.1, exit **1** with that message and
no ESM error. **CONTRIBUTING.md** gained a line on the floor and why, next to the harness and
real-input sections.

## 4. Gates

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.18.0/installation/bin:$PATH"   # default node here is 26.3.1
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd example
IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8293 \
  HARNESS_APP_PATH="$(pwd)/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app" \
  bun run harness:ios
ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 \
  HARNESS_APP_PATH="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk" \
  bun run harness:android
IOS_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8293 bun run test:real-input:ios
ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 bun run test:real-input:android
```

| Gate | Result |
| --- | --- |
| `bun run check` | **green**, exit 0 — run last, with `metro.config.js` and `harness-timing-gate.js` in place (nitrogen: no drift, autolinking, bob, api-extractor, publint, package-files all pass) |
| iOS harness, no `HARNESS_TIMING` | **`Tests: 72 passed, 72 total`**, exit 0 (`/tmp/r1-harness-ios3.log`) |
| Android harness, no `HARNESS_TIMING` | **`Test Suites: 5 passed`, `Tests: 72 passed, 72 total`**, exit 0 (`/tmp/r1-harness-android2.log`) |
| real-input iOS, Metro owned by the script | **`real-input (ios): 3/3 controls passed`**, exit 0, port released after (`/tmp/r1-realinput-ios3.log`) |
| real-input Android, Metro owned by the script | **`real-input (android): 3/3 controls passed`**, exit 0 (`/tmp/r1-realinput-android.log`) |

Builds used were the ordinary ones: `bundle exec pod install`, an
`xcodebuild … -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` for the Simulator `.app`,
and `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`.

## Follow-ups (not in scope, all observed here)

- **Load-induced flakes.** At `load1 ~100`, `Sizing`'s cold-Switch `measureContent` returned
  null and real-input's Switch tap was dropped; both passed on retry at load ~13–20. Item 1
  removes the *timing* class of this, not the *event delivery* class. A load check in front of
  real-input is a plausible R2 item.
- **Give `HARNESS_TIMING` runs a log.** `console.log` from a harness test surfaces only with a
  failing suite, so the reported numbers need the harness to echo them (a verbose flag) or the
  gate file to keep the last N measurements. Documented rather than invented here.
- **CocoaPods version.** This machine runs 1.15.2; the committed `Podfile.lock` says 1.17.0,
  so `pod install` rewrites that trailer. Restored before committing — it needs either a
  version pin in the repo or a note.
- **Harness Android emulator launch.** Its own emulator launch died here; I booted
  `nitroui_t01` by hand and passed `ANDROID_AVD` (it also warns "Hardware acceleration appears
  unavailable" on this host).
- **Channel test worth keeping:** the route was checked against a real `react-native start`
  (200 with live state, other paths 404, `HARNESS_TIMING` flipped false→true on a live server
  without a restart, 404 after stop, no leftover file). If the route ever matters in CI,
  `/tmp/r1-repro/route.mjs` is that test.
