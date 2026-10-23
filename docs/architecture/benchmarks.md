# Benchmarks

The perf guardrail every component task runs. It answers one question: **did this
component make mounting, updating or memory worse than the same thing built on RN
core?** Absolute milliseconds are not comparable between machines, so every gate
is a **ratio against `rn-core` measured in the same run**.

Device numbers **inform review**. They block only on a clear regression on the
canonical device (D9). The gates that always block are static: lint, typecheck,
nitrogen drift, autolinking, manifest, Jest, and the Reassure render-count gate.

Implements `docs/research/setup-decisions.md` §6.

## Layout

```
bench/                       Expo app, release builds only (CNG: bench/ios and
                             bench/android are generated and gitignored)
bench/src/                   plan parsing, scenarios, implementations registry, NDJSON emit
bench/modules/bench-probe/   private Nitro module (Swift/ObjC++ + Kotlin + C++)
bench/results/               <sha>[-dirty]-<platform>-<stamp>.{json,md} (gitignored)
bench/baselines/             committed ratio baselines + renders.json (see its README)
scripts/bench/               build.mjs run.mjs report.mjs render.mjs devices.mjs lib.mjs
scripts/perf/renders.mjs     Reassure render-count gate
```

`lib.mjs` holds the aggregation and the gate, `render.mjs` holds the markdown and
the verdict, and both are free of filesystem access so
`scripts/__tests__/bench-gate.test.js` can prove the gate fires without a device.
`report.mjs` and `run.mjs` are the two CLIs on top of them.

`BenchProbe` is **private and local**: it is never published, its nitrogen output
lives inside `bench/modules/bench-probe/nitrogen/`, and the library's own
`nitrogen` run never scans it. Regenerate it with `bun run probe:nitrogen`.

## Running

```sh
bun bench --platform ios     --plan quick     # a few minutes
bun bench --platform android --plan quick
bun bench --platform ios     --plan full      # every N, plus the leak slope
```

The device comes from the environment, exactly like the Harness config:

| Variable         | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `IOS_SIM_UDID`   | Simulator UDID from your task brief (boots it if needed)           |
| `ANDROID_AVD`    | AVD name - the runner resolves the serial from the running AVD     |
| `ANDROID_SERIAL` | Fallback when there is no AVD name (physical device)               |
| `BENCH_ABIS`     | Android ABIs to build (`arm64-v8a` locally, `x86_64` on CI)        |
| `BENCH_LAUNCH_TIMEOUT_S` | Wall-clock budget per launch; raise it on a busy machine |

`ANDROID_AVD` is preferred over `ANDROID_SERIAL`: console ports are allocated by
availability, so a serial from a brief goes stale as soon as another emulator
boots or dies. Matching on the AVD name is what keeps a run on its own device.

There is **no Metro**: release builds embed the bundle, which is also what makes
numbers mean something (Hermes bytecode, R8, no dev tools). `METRO_PORT` is
unused by the bench app.

Useful flags:

| Flag                  | Effect                                                          |
| --------------------- | --------------------------------------------------------------- |
| `--only <impl,impl>`  | Restrict the implementation dimension                           |
| `--launches N`        | Overrides the launches per cell (for a fast smoke test)         |
| `--skip-build`        | Reuse the installed release artifact instead of rebuilding       |
| `--prebuild`          | Force `expo prebuild --clean` first                              |
| `--compare <ref\|file>` | head/base ratios against another commit or results file       |
| `--check`             | Compare against the committed baseline, ratios only              |
| `--update-baseline`   | Record this run as the baseline (refuses dirty/broken/busy runs) |
| `--force`             | Override a `--update-baseline` refusal (local experiments only)  |
| `--shutdown`          | Shut down a device the runner itself booted when it finishes     |
| `--perf-marks`        | Diagnostic run: turn on the library's own native perf marks    |

The runner restores Android animation scales it reset, and `--shutdown` covers
the "I booted it, I clean it up" case; a device that was already up is left
alone.

`bun run bench:report <results.json> [--compare <ref>] [--check]
[--update-baseline]` re-renders an existing results file without touching a
device.

Results files are named `<sha>[-dirty]-<platform>-<utc-stamp>.json`, so two runs
of one commit do not overwrite each other and a dirty-tree run can never be
mistaken for the clean commit's data. `--compare <sha>` resolves to the newest
**clean** file for that sha (never a `-marks.json`, see below).

## What is measured

| Metric                 | Source                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `jsCommitNs`           | probe clock around the JS commit (state set → commit returned)  |
| `mountedNs`            | native mount observer (Fabric), absolute on the same clock      |
| `presentedNs`          | native frame stamp, armed at the mount (see below)              |
| `jsNsPerOp`            | JS/Hermes thread CPU time per iteration                         |
| `mainNsPerOp`          | UI/main thread CPU time per iteration, mount bracket only       |
| `unmountMainNsPerOp`   | UI/main thread CPU time per iteration, teardown bracket only    |
| `bytesPerInstance`     | footprint(full) − footprint(empty), divided by N                |
| `leakSlopeBytesPerCycle` | slope across mount/unmount cycles in the `leak` scenario      |

Protocol per `(scenario, implementation, N)` cell: **fresh process**, 1 s settle,
5 warmup + 20 measured iterations, **4 launches** interleaved ABBA so no
implementation always runs last. The reported number is the **median of the
per-launch medians**, with the MAD of those launch medians beside it; `p95` is
over the pooled iterations, because a tail only shows up there. Confidence
intervals come from a **hierarchical bootstrap** (resample launches, then
iterations inside each launch), never from collapsing launches first. Results
come back as NDJSON written inside the app container (`Documents/bench.ndjson` on
iOS, external files dir on Android) and echoed to the system log under
`NITRO_BENCH` as a fallback.

On Android the runner also forces ART to compile the app right after the install
(`cmd package compile -m speed-profile -f`, `scripts/bench/run.mjs`). An install only
*stores* a baseline profile — the compiler that consumes it usually runs later, in
`BackgroundDexOptService` — so without this a measured launch may or may not have run
AOT-compiled code depending on how long the device sat idle. All implementations live in
one APK behind one install, so the command lands on every arm identically (D9's pairing);
what it can change is only the effect of a library's own `baseline-prof.txt`
(`docs/architecture/core.md` §13).

Scenarios: `mount` (N = 1/50/200), `update` (N = 1/50, K flips awaited per
frame), `memory` (N = 200, after GC), `leak` (repeated mount/unmount of N = 200).
Plans: `quick` = `mount:50`, `update:50`, `memory:200`; `full` adds N = 1/200 and
the leak slope.

### Native perf marks (`--perf-marks`)

`BenchProbe` measures the black box. The library additionally reports what it
knows about itself: a host with `nuiPerfId >= 0` records `propsApplied` (props
landed on the UI thread) and `firstFrame` (the hosted content drew), in the same
D1 clock base, and `nitroUiCore.drainPerf()` takes them
(`docs/architecture/core.md` SS8). Neither mark is a GPU-completed frame, so they
explain a `UI CPU/op` or `presented` number rather than replacing one.

```sh
bun bench --platform ios --plan quick --perf-marks --only nitro-ui
```

That launch prints a **Native perf marks** row per cell: marks per op, marks per
instance, whether anything drew, when props landed, when it drew, and the
props-to-draw span. Reading it:

- `propsApplied per instance` **should be 1.00** per React commit. Two means
  something commits twice per flip, and the fix is in the wrapper, not the bench.
- `props -> draw` is the hosted runtime's own render cost. If it is most of the
  gap to `rn-core`, the hosting layer is the cost; if it is small, the cost is in
  Fabric/Nitro plumbing around it.
- `firstFrame` in `mount` is expected; in `update` it is 0, because the content
  already drew.

It is **opt-in and never gated**, because it is not free: a mark is a
mutex-guarded ring write on the UI thread and `drainPerf()` allocates on the JS
thread. The bench therefore (a) only passes `nuiPerfId` when the launch asked for
marks, and (b) drains **between** iterations, outside every CPU bracket. Such a
run is named `-marks.json`, is excluded as a `--compare` base, and
`--update-baseline` refuses it. Only `nitro-ui` has marks; the flag narrows the
matrix to that arm rather than burning launches that report nothing.

## Reading the numbers honestly

- **`presentedNs` is a frame stamp, not a duration.** The probe arms the capture
  *natively inside the mount hook* - iOS starts a one-shot `CADisplayLink` in the
  same run-loop turn and records `link.timestamp`; Android registers a one-shot
  `Window.OnFrameMetricsAvailableListener` and records
  `INTENDED_VSYNC_TIMESTAMP + TOTAL_DURATION` for the first frame after the mount.
  "The first frame after the mount" needs care on Android: Fabric mounts inside
  a Choreographer animation callback, and **that same frame** draws the change,
  so a frame qualifies when its animation phase ended no earlier than the mount
  (`INTENDED_VSYNC + UNKNOWN_DELAY_DURATION + INPUT_HANDLING_DURATION +
  ANIMATION_DURATION >= mountNs`) - filtering on the vsync alone rejects the
  presenting frame itself (T02 round 3's bug, fixed in round 4). On iOS the
  stamp is the `targetTimestamp` of the first display-link callback the main
  thread reaches after the mount: "main thread free by the next vsync", not
  render-server presentation.
  `presented` is that stamp minus the cell's `t0`. It is still frame-quantised
  (~16.7 ms at 60 Hz, often ~33 ms when the commit lands just after a vsync), so
  a real 2 ms regression is invisible in it and it stays the noisiest column. The
  two platforms differ by a frame by construction: compare **arms**, never
  platforms. Every detail table prints sanity counters - `missingMount`,
  `missingPresented`, `presentedBeforeMount`, `mountBeforeCommit` - and a column
  whose counters are not zero is a broken probe, not a regression.
  A metric that lost more than 10 % of its samples to those counters
  (`MAX_MISSING_SAMPLE_RATIO`) prints `n/a` and is not gated at all: a median
  over the survivors says nothing about the cell (round 4).
- **Android CPU is read in nanoseconds.** `/proc/self/task/<tid>/schedstat`
  field 0 is ns of run time; `/proc/.../stat` (100 Hz jiffies) is only the
  fallback, and the JS thread uses `Debug.threadCpuTimeNanos()` when the bracket
  runs on it. Short ops still quantise a little, so read Android CPU as a
  directional column with the `mount`/`unmount` split stated.
- **Mount and teardown CPU are separate columns.** `mainNsPerOp` brackets the
  mount only; `unmountMainNsPerOp` brackets the teardown, which is where a
  hosting-controller teardown regression shows up. Round 1 put both in one
  bracket, so a slow unmount was reported as a slow mount.
- **No `React.Profiler` numbers.** `Profiler.actualDuration` needs
  `__PROFILE__`, which a release bundle does not set, so the wrapper was removed
  rather than printing zeros as if they were measurements. JS cost is
  `jsNsPerOp`; if a specific investigation needs profiler timings, alias
  `ReactFabric-prod` to `ReactFabric-profiling` in `bench/metro.config.js` for
  that experiment and say so in the report.
- **Timestamps are absolute D1 values** - `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)`
  on iOS, `System.nanoTime()` on Android - with no origin offset, so a probe
  stamp lines up with `NitroUiCore.now()` and with the `nuiPerfId` perf events T10
  emits. `CLOCK_UPTIME_RAW` needs about 104 days of awake uptime to reach 2^53
  ns, where a double's ULP is 0.125 ns: nothing is lost by keeping them absolute.
- **iOS hooks the presenter, not the observer protocol.** `RCTSurfacePresenter`
  forwards `mountingManager:didMountComponentsWithRootTag:` to its
  `RCTSurfacePresenterObserver`s, and registering as one needs a `RCTBridgeProxy`
  that bridgeless mode does not give us. The probe installs its own `IMP` on that
  method - same instant, no bridge required.
- **Footprint samples collect garbage first.** Each memory sample calls
  `globalThis.gc?.()` when Hermes exposes it (which needs
  `hermes_enableGCCoreDump`-style exposure; the run records `heapCollected` per
  sample so a silent no-op is visible) and records the Hermes/native/Java heap
  breakdown next to `phys_footprint`/PSS, because the Expo arms have measured
  *below* `rn-core` on raw PSS. `bytesPerInstance` is still the noisiest metric
  here - one sample per launch - so treat a memory ratio as a lead, and use the
  `full` plan on a quiet machine.
- **Emulator numbers are not device numbers.** They are comparable to each other
  within a run, which is all the gates use.

## Baselines and gating

`bench/baselines/<deviceKey>.json` is the trend record, with
`deviceKey = platform + OS runtime + device class` (D9): `ios27-sim-iphoneair`,
`android35-emu-pixel9`. A runtime change is a comparability break, so it gets a
new file, and anything that is not the canonical device for its platform uses
same-run ratio tables and `--compare`, never `--check`. Baselines are
**ratio-only** - see `bench/baselines/README.md`.

**As of T02 round 4 no latency baseline is committed on either platform** - the
one Android file that existed was recorded while nitro-ui self-skipped and
gated nothing, so it was deleted; `--check` reports `no baseline at …` and is
inert until a clean `--plan full --launches 8` run mints one. The
`renders.json` gate is separate, live, and committed.

The gate exists once (`gate()` in `scripts/bench/lib.mjs`) and is used identically
by `run.mjs --check`, `run.mjs --compare`, and `report.mjs --check/--compare`:

1. Each metric becomes a **launch-paired ratio to `rn-core`**: launch N's arm
   median over launch N's control median, from the same launch, so machine drift
   cancels instead of being measured and then excused.
2. `--compare <ref>` gates `head(x/rn-core) ÷ base(x/rn-core)`; `--check` gates
   the same ratios against the committed baseline ratios.
3. A gated cell fails when the ratio is over **1.20**, its bootstrap 95 % CI
   **excludes 1.05**, *and* that `(scenario, N, metric)` was **quiet inside its
   own run** - the relative MAD of its launch-paired ratios under 10 %. Noise is
   judged per cell and metric, never as absolute drift against a baseline: that
   is what made round 1 unable to fail.
4. **Only `nitro-ui` arms gate.** `rn-core` is the control and the `expo-ui-*`
   arms are reference arms: an `@expo/ui` bump is review information, not a
   failed nitro-ui pull request.
5. A leak fails the same way when the climb is **monotonic** and the slope ratio
   clears the threshold. A slope over a series that does not climb is not
   comparable and cannot gate.
6. `rn-core` moving more than 10 % between two runs is printed as context. It
   cannot suppress a verdict (the within-run noise guard does that job) and it
   cannot create one.

Exit codes: `0` ok, `1` conclusive regression, `2` the run could not be judged
(incomplete launches, incompatible baseline, refusal).

Refresh baselines in a dedicated commit with `--plan full --launches 8` on a
clean tree and an idle machine; `--update-baseline` refuses otherwise and prints
why (dirty tree, `problems`, load average over 0.5 x cores, missing load
average).

Every run also records what machine produced it - hostname, core count, CPU
model (`os.cpus()[0].model`), load averages, RAM, Xcode version or Android image
- because D15 keeps device *keys* class-level (`android35-emu-pixel9` is this
desk's AVD and CI's) and uses the recorded CPU to tell same-class machines apart.

## Render counts (hard gate)

`bun run perf:renders` runs Reassure over `src/**/*.perf-test.tsx`, inside
`bun run check`, and fails when a wrapper renders a different number of times
than `bench/baselines/renders.json`. Reassure measures **JS renders only** - it
exists to stop memoisation and re-render regressions in the wrappers, not to
measure anything native.

Counts alone are not the contract, so the gate also reads what Reassure puts in
`record.issues` and round 1 ignored:

- **all runs must agree**: the count is required to be identical across the 10
  runs, so a wrapper that renders nondeterministically fails instead of hiding
  behind a median;
- `counts` must equal the baseline;
- `issues.initialUpdateCount` must be **0** - no extra commit straight after
  mount, i.e. no state-setting `useEffect` on the mount path;
- `issues.redundantUpdates` must be **empty** - no commit whose rendered host
  tree was unchanged, which is what prop churn and missing memoisation produce.

### Adding a `*.perf-test.tsx`

A bare mount measures one render, so there is nothing redundant to find: drive a
**scenario**.

```tsx
// src/components/Switch/Switch.perf-test.tsx
import { test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { Switch } from './Switch';

function Harness() {
  const [value, setValue] = useState(false);
  const [bumps, setBumps] = useState(0);
  return (
    <>
      <Pressable testID="flip" onPress={() => setValue((current) => !current)}>
        <Text>flip</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <Switch value={value} onValueChange={setValue} />
    </>
  );
}

test('Switch: mount, 3 flips, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      for (let index = 0; index < 3; index += 1) {
        await fireEvent.press(screen.getByTestId('flip'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
    },
  });
});
```

Flipping the control proves the wrapper re-renders **when told**; rendering an
unrelated parent proves it does **not** re-render when it should not. Two
details are load-bearing, both learned from the first real test (T02 round 4):

- the bumped counter is **drawn** (`<Text>{bumps}</Text>`). Reassure's
  redundancy check compares whole rendered trees per commit, so a parent
  commit that changed nothing visible is itself flagged as a redundant
  update - true of the harness, not the wrapper, and impossible to tell apart;
- `fireEvent.press` is awaited (RNTL 14 returns a promise; an unawaited press
  leaves the act() queue to flush inside the next leg).

`measureRenders` is imported from `reassure` itself - the old
`@callstack/reassure/measurement` path does not exist in reassure 1.6. Pick a
scenario where you can state the exact expected count, then
`bun run perf:renders -- --update-baseline` and review the one-line diff.
`src/components/Switch/Switch.perf-test.tsx` is the live instance (count 6:
mount, 3 flips, 2 parent renders).

A root Profiler cannot see a `React.memo` bail-out inside the tree, nor prop
churn going into the native host. Pair every perf-test with a deterministic Jest
test that `jest.mock`s the host component with a counter and asserts: one host
render per value change, **zero** host renders on an unrelated parent render, and
a stable callback identity across renders. That is the stable-callback /
no-prop-churn half of the perf contract, enforced directly. (T10 owns the first
instance of both.)

## Adding a component to the matrix

1. Add the implementation in `bench/src/implementations/` and register it in
   `bench/src/implementations/index.ts` (`{ name, available, skipReason, List }`).
   Pass **every** prop explicitly - never `undefined` (nitro#1184).
2. Run the quick plan on both platforms:
   `bun bench --platform ios --plan quick` and `--platform android`.
3. Paste both summary tables (absolute **and** ratio-to-`rn-core`) into your task
   report, plus the sanity/noise lines, so a reader can see the column was
   measurable.
4. Add `src/<Component>.perf-test.tsx` per the scenario contract above and commit
   the recorded render baseline.
5. Do not gate on absolute milliseconds. Report and compare ratios to `rn-core`.
6. A component's **first** `nitro-ui` arm cannot fail a gate - there is no prior
   ratio to regress against (D15). Its report must show ratios to `rn-core` *and*
   to both `expo-ui-*` arms on `mount presented`, UI CPU and memory, and a miss
   against the D15 target (`<= 1.0x expo-ui-shared-host`, well below
   `expo-ui-host-per-control`) needs an explanation - a `--perf-marks` run is how
   to write one - plus a follow-up item.

The `nitro-ui` arm is live: `bench/src/implementations/nitroUi.tsx` is the only
file that renders the library (a named `import { Switch } from
'react-native-nitro-ui'`, typechecked by `bun run bench:typecheck` through
`bench/tsconfig.json`'s `paths`, which mirrors Metro's `extraNodeModules`). Before
T10 exported a component the arm resolved `Switch` at runtime and reported itself
*skipped* with a reason, so nobody benchmarked a stub; that lookup is gone, and an
arm for a component the library does not export is now a build error instead.
Every arm must do **equivalent work**: RN core `Switch`, `@expo/ui` `Toggle`
(`labelsHidden()`, no label text) and the nitro-ui `Switch` are all a bare
switch, because a SwiftUI `Text` next to the control is a real cost that belongs
to nobody's comparison.

## CI

`.github/workflows/bench.yml` is **report-only**: an on-demand `bench` label or a
`/bench` comment (restricted to `OWNER`/`MEMBER`/`COLLABORATOR` commenters) builds
base and head in one job on the `xcode-27` runner, runs them **sequentially** -
two separate fresh processes per cell per revision, not interleaved - and comments
the ratio table. Android uses `ReactiveCircus/android-emulator-runner` so the
system image, AVD and KVM actually exist, and `--prebuild` forces a fresh native
project between base and head so head's native config changes cannot be tested
against base's generated directories. Concurrency is keyed per pull request, so
two PRs do not cancel each other. The nightly runs one revision twice and labels
it a noise sample - same-sha ratios are by definition ~1.00x, so what it reports
is run-to-run variation. It never fails a PR: hosted runners are too noisy for
that, which is why the hard gates are the static ones plus Reassure render counts.
Raw results are uploaded as artifacts instead of going into git.

## Troubleshooting

| Symptom                                   | Cause / fix                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `ClassNotFoundException: HybridBenchProbe` | R8 renamed a class Nitro looks up by name via JNI. Keep rules live in `bench/modules/bench-probe/android/proguard-rules.pro` (consumer rules). |
| `new com.margelo.nitro.nitroui.<word>()` in `PackageList.java` | autolinking regex-matches the ReactPackage declaration in `android/src/main/.../NitroUiPackage.kt`; prose that reads like a class declaration gets picked up. Delete the generated `bench/android` (`--prebuild`) after fixing the wording. `bun run autolinking:check` covers it. |
| `cmd: Can't find service: settings` right after boot | The runner retries; if it persists, the emulator is still booting. |
| `mount` crashes on iOS with a promise mutex abort | A freed frame-context; contexts are `shared_ptr` captured by both the display-link and fallback timers. |
| `presented` missing on most samples (`missingPresented` high) | A metric over 10 % missing prints `n/a` and is ungated, so this row means "go look", not "read the survivors". Until T02 round 4 the dominant cause was the Android probe itself: its vsync filter rejected the very frame that presents a Fabric mount, and only cells whose screen invalidated *again* (the Switch's thumb animation on `update`) ever produced a sample - static `mount` cells timed out at ~80/80 on every arm, which is deterministic, not selective. Check the build predates that fix before chasing machine causes: the listener needs a focused window, and both platforms give up after 2 s (`FRAME_TIMEOUT_MS`) and answer `-1`, so confirm the app was in the foreground and re-run. |
| Android launch ~5-10x slower than usual, frame signals missing | The AVD may be booting without a host GPU (`hw.gpu.enabled=no` in `~/.android/avd/<name>.avd/config.ini` - `avdmanager create` can leave it, and the runner does not boot Android devices, so nothing corrects it). Boot it yourself with `emulator -avd <name> -port <port> -gpu host`. |
| `--update-baseline` refused | The tree was dirty, the run had `problems`, or `loadavg1` was over 0.5 x the core count. Wait for a quiet machine; `--force` is for experiments only. |
| `--check` says no baseline | Baselines are per canonical device (`bench/baselines/README.md`). Use `--compare <ref>` on other hardware. |
| Stale native code despite editing sources | `build.mjs` rebuilds when any source is newer than the artifact; `--prebuild` forces a full CNG regen. |
| Emulator vanished mid-run (`device not found`) | qemu aborts occasionally on macOS. Re-run the same command: each cell is independent and results are per-file. |
| `no end sentinel within 180s`, cells report 0 iterations | The device was starved by other work on the machine (another emulator, a concurrent gradle/Xcode build) and did not finish a launch inside its budget. Re-run when the machine is quieter, or pass `BENCH_LAUNCH_TIMEOUT_S=600`. |
| Numbers 3x worse than yesterday | Something else is using the machine. Ratios still hold if the whole cell degraded together; if only one cell did, the within-run noise guard marks it noisy and it cannot carry a verdict. |
