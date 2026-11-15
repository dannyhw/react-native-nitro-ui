# Benchmarks

The perf guardrail a release runs. It answers one question: **is this release slower than
the last one?** Absolute milliseconds are not comparable between machines or between
sessions, so every verdict is a **ratio against `rn-core` measured in the same run**, and
the release verdict measures two runs side by side: the last release and the candidate,
one device, one session (`--compare-release`, see "The release comparison").

Device numbers **inform review**. They block only on a clear regression on the canonical
device. The gates that always block are static: lint, typecheck, nitrogen drift,
autolinking, manifest, Jest, and the Reassure render-count gate.

## Layout

```
bench/                       Expo app, release builds only (CNG: bench/ios and
                             bench/android are generated and gitignored)
bench/src/                   plan parsing, scenarios, implementations registry, NDJSON emit
bench/modules/bench-probe/   private Nitro module (Swift/ObjC++ + Kotlin + C++)
bench/results/               <sha>[-dirty]-<platform>-<stamp>.{json,md} (gitignored)
bench/baselines/             renders.json — the committed JS render counts (README)
scripts/bench/               build.mjs run.mjs report.mjs render.mjs devices.mjs lib.mjs
                             compare.mjs — the release comparison: its plan and its base side
scripts/perf/renders.mjs     Reassure render-count gate
```

`lib.mjs` holds the aggregation and the gate, and `render.mjs` holds the markdown and the
verdict. Both are free of filesystem access, so `scripts/__tests__/bench-gate.test.js` proves
the gate fires without a device. `compare.mjs` holds the two-sided plan. `report.mjs` and
`run.mjs` are the two CLIs on top of them.

`BenchProbe` is private and local: it is never published, its nitrogen output lives inside
`bench/modules/bench-probe/nitrogen/`, and the library's own `nitrogen` run never scans it.
Regenerate it with `bun run probe:nitrogen`.

## Running

```sh
bun bench --platform ios     --plan quick
bun bench --platform android --plan quick
bun bench --platform ios     --plan full      # every N, plus the leak slope
bun bench --platform ios     --plan full --compare-release   # the release check
```

The device comes from the environment, like the Harness config:

| Variable                 | Meaning                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `IOS_SIM_UDID`           | Simulator UDID to measure on (boots it if needed)                 |
| `ANDROID_AVD`            | AVD name - the runner resolves the serial from the running AVD    |
| `ANDROID_SERIAL`         | Fallback when there is no AVD name (physical device)              |
| `BENCH_ABIS`             | Android ABIs to build (`arm64-v8a` by default, `x86_64` on Intel) |
| `BENCH_LAUNCH_TIMEOUT_S` | Wall-clock budget per launch; raise it on a busy machine          |

Prefer `ANDROID_AVD` over `ANDROID_SERIAL`: console ports are allocated by availability, so
a serial goes stale as soon as another emulator boots or dies.

There is no Metro: release builds embed the bundle (Hermes bytecode, R8, no dev tools).
`METRO_PORT` is unused by the bench app.

Flags:

| Flag                       | Effect                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--only <impl,impl>`       | Restrict the implementation dimension                                                                                                   |
| `--component <name>`       | Restrict the run to one component's cells                                                                                               |
| `--scenario <name>`        | Restrict it to one scenario's cells, e.g. `mount.date-picker`                                                                           |
| `--n <value>`              | Restrict it to cells measured at that instance count                                                                                    |
| `--launches N`             | Overrides the launches per cell (for a fast smoke test)                                                                                 |
| `--skip-build`             | Reuse the installed release artifact instead of rebuilding                                                                              |
| `--prebuild`               | Force `expo prebuild --clean` first                                                                                                     |
| `--compare <ref\|file>`    | head/base ratios against results already on disk                                                                                        |
| `--compare-release [ref]`  | the release check: measure `ref` (default: the newest release tag) **and** this tree, in one session on one device, then gate head/base |
| `--dry-run`                | Print what the run would do, without booting, building or measuring                                                                     |
| `--shutdown`               | Shut down a device the runner itself booted when it finishes                                                                            |
| `--perf-marks`             | Diagnostic run: turn on the library's own native perf marks                                                                             |
| `--timeout-mount <ms>`     | How long each iteration waits for the mount signal (default 1500)                                                                       |
| `--timeout-presented <ms>` | …and for the presenting frame (default 8 000 on iOS, 2 000 on Android)                                                                  |

The two `--timeout-*` flags answer a question a results file cannot: did an arm's frame never
come, or did it come later than the run waited? A count of missing samples cannot tell a slow
arm from a dead probe.

- The value travels in the launch string (`…:presentedTimeout=40000`), not an env var: a
  release build has no env, and one launch is fully described by the string the runner
  passed it.
- Each platform's native "this window never drew" backstop is a ceiling, not the wait: 90 s
  on iOS, 2 s on Android. A requested wait is capped below it (80 s on iOS, 1 900 ms on
  Android), because a request at or above the ceiling would be recorded as a timeout the run
  never asked for.
- A run that asks for anything other than its platform's default timeout is a diagnostic, in
  either direction: a sample that arrives keeps its value, but which samples arrive moves the
  median. It says so at startup, and `--compare-release` refuses the two flags. Every run
  records the rule it measured under in its own `timeouts` block, read back from what the app
  reported; a run whose app reported nothing says so.

The defaults are per platform (`BENCH_DEFAULT_TIMEOUTS` in `bench/src/plan.ts` is where both
numbers are written):

- On iOS `presented` waits 8 000 ms. On an iPhone 17 simulator, `@expo/ui`'s DatePicker at
  N=200 presents its first frame at p50 2.7-3.0 s, and the slowest iOS frame measured is
  3 565 ms (3 850 ms in a 40 s diagnostic run).
- `mounted` waits 1 500 ms on both platforms. The slowest mount measured is 226 ms.
- On Android `presented` waits 2 000 ms. The Android cells that lose presenting samples have
  no frame between 2 s and 8 s: the 8 affected `update.progress`/`update.picker` `@expo/ui`
  cells await both signals and time out on every iteration, because those arms never produce
  a Fabric transaction there. A longer wait cannot recover such a sample; it only inflates the
  CPU rows bracketing the wait and adds ~2.7 h to a full Android run.

A longer wait does not change a cell that was already complete: a sample that arrived inside
2 s arrives with the identical stamp under 8 s. Only cells that were losing samples change,
and they move towards the truth, because the dropped iterations are the slow ones.

The per-launch wall-clock budget follows the platform's defaults and any longer wait a run
asks for (`launchBudgetMs`, and `DEFAULT_SCENARIO_BUDGETS` / `TIMEOUTS` per platform). An
iteration of `mount` waits for two mount signals and one presenting frame, so a default iOS
launch can spend 25 x (2 x 1 500 + 8 000) = 275 s waiting. iOS's budget is 300 s (420 s for
`leak`), and a 40 s presented wait adds ~800 s on top. Android's worst default wait is
25 x (2 x 1 500 + 2 000) = 125 s and its budget is 180 s (300 s for `leak`); a launch that
asks for longer widens it the same way.

### When a signal does not arrive

Every iteration that gets no `mountedNs`/`presentedNs` records why, in that iteration's
`missing` array: `probe-timeout` (with the timeout in force and how long the wait ran),
`not-awaited` (the cell declares `mountSignal: false`, so the null is by construction), or
`probe-error` (the probe threw or answered unparseably, with its message). Those reasons are
tallied per cell (`cell.missing`), printed per launch in the progress line
(`80 iterations, 80 presented probe-timeout (2000 ms)`) and per cell in the report. A cell key
never carries a timeout, so a diagnostic run lands in the same rows as a normal one. Only its
values are not comparable.

The runner restores the Android animation scales it reset. `--shutdown` shuts down a device
the runner booted; a device that was already up is left alone.

`--scenario` and `--n` narrow a run to one cell. When the reasons say `probe-timeout`, the
next question is how long that frame would have taken, which needs one cell, its arms and a
long wait:

```sh
node scripts/bench/run.mjs --platform ios --plan full --component date-picker \
  --scenario mount.date-picker --n 200 --launches 8 --timeout-presented 40000
```

`--plan full` supplies the cell list, the three filters cut it to one cell, and the reported
numbers land in the same cell keys as a normal run. The report says which cells a narrowed run
did not measure.

`bun run bench:report <results.json> [--compare <ref>]` re-renders an existing results file
without touching a device.

Results files are named `<sha>[-dirty]-<platform>-<utc-stamp>.json`, so two runs of one commit
do not overwrite each other and a dirty-tree run is not mistaken for the clean commit's data.
`--compare <sha>` resolves to the newest **clean** file for that sha (never a `-marks.json`,
see below).

## What is measured

| Metric                   | Source                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `jsCommitNs`             | probe clock around the JS commit (state set → commit returned) |
| `mountedNs`              | native mount observer (Fabric), absolute on the same clock     |
| `presentedNs`            | native frame stamp, armed at the mount (see below)             |
| `jsNsPerOp`              | JS/Hermes thread CPU time per iteration                        |
| `mainNsPerOp`            | UI/main thread CPU time per iteration, mount bracket only      |
| `unmountMainNsPerOp`     | UI/main thread CPU time per iteration, teardown bracket only   |
| `bytesPerInstance`       | footprint(full) − footprint(empty), divided by N               |
| `leakSlopeBytesPerCycle` | slope across mount/unmount cycles in the `leak` scenario       |

Protocol per `(scenario, implementation, N)` cell: **fresh process**, 1 s settle, 5 warmup +
20 measured iterations, **4 launches** interleaved ABBA so no implementation always runs last.
The reported number is the **median of the per-launch medians**, with the MAD of those launch
medians beside it; `p95` is over the pooled iterations, because a tail only shows up there.
Confidence intervals come from a **hierarchical bootstrap** (resample launches, then
iterations inside each launch), never from collapsing launches first. Results come back as
NDJSON written inside the app container (`Documents/bench.ndjson` on iOS, external files dir
on Android) and echoed to the system log under `NITRO_BENCH` as a fallback.

On Android the runner also puts the app in the compiled state a device eventually reaches
(`scripts/bench/run.mjs`): it asks `androidx.profileinstaller` to install the APK's merged
baseline profile (the `INSTALL_PROFILE` broadcast), compiles from it
(`cmd package compile -m speed-profile -f`), and logs the `dumpsys package dexopt` status it
ended up with. An install alone only stores that profile, and the background compiler runs on
an idle window, so without this step a measured launch may or may not run AOT-compiled code
depending on how long the device sat idle. All implementations live in one APK behind one
install, so priming applies to every arm identically, and its effect is not limited to the
library's own `baseline-prof.txt` (`core.md`, "The Android baseline profile").

Priming changes every arm's absolutes and the ratios between the arms, because the arms gain
unequally from compiled Compose and RN: with no library change, mount `presented` against the
shared host moves 1.22× → 0.99× and memory 2.28× → 2.45×. ART compile state is therefore a
**comparability break like a runtime change is**: a run at `status=verify` (interpreter + JIT)
and a run at `speed-profile` are two regimes, and neither absolutes nor ratios compare across
them. A run that ends at anything but `speed-profile` measured the interpreter, and the runner
says so in its header.

Scenarios: `mount` (N = 1/50/200), `update` (N = 1/50, K flips awaited per frame), `memory`
(N = 200, after GC), `leak` (repeated mount/unmount of N = 200). Plans, per component (switch,
slider, button, progress, segmented-control, date-picker, picker, menu, text-field, form):
`quick` = `mount:50`, `update:50`, `memory:200`; `full` adds N = 1/200 and the leak slope.
`form` is measured at N = 20 and 50, because its N is rows inside one container. `--component`
narrows either plan to one component.

### Native perf marks (`--perf-marks`)

`BenchProbe` measures the black box. The library also reports what it knows about itself: a
host with `nuiPerfId >= 0` records `propsApplied` (props landed on the UI thread) and
`firstFrame` (the hosted content drew), on the `nitroUiCore.now()` clock, and
`nitroUiCore.drainPerf()` takes them (`core.md`, "Perf marks"). Neither mark is a
GPU-completed frame, so they explain a `UI CPU/op` or `presented` number and do not replace
one.

```sh
bun bench --platform ios --plan quick --perf-marks --only nitro-ui
```

That launch prints a **Native perf marks** row per cell: marks per op, marks per instance,
whether anything drew, when props landed, when it drew, and the props-to-draw span. Reading
it:

- `propsApplied per instance` **should be 1.00** per React commit. Two means something commits
  twice per flip, and the fix is in the wrapper, not the bench.
- `props -> draw` is the hosted runtime's own render cost. If it is most of the gap to
  `rn-core`, the hosting layer is the cost; if it is small, the cost is in the Fabric/Nitro
  plumbing around it.
- `firstFrame` in `mount` is expected; in `update` it is 0, because the content already drew.

It is opt-in and never gated, because it is not free: a mark is a mutex-guarded ring write on
the UI thread and `drainPerf()` allocates on the JS thread. The bench only passes `nuiPerfId`
when the launch asked for marks, and drains between iterations, outside every CPU bracket.
Such a run is named `-marks.json`, is excluded as a `--compare` base, and `--compare-release`
refuses the combination. Only `nitro-ui` has marks, so the flag narrows the matrix to that
arm.

## Reading the numbers honestly

- **`presentedNs` is a frame stamp, not a duration.** The probe arms the capture natively
  inside the mount hook. iOS starts a one-shot `CADisplayLink` in the same run-loop turn and
  records `link.timestamp`; Android registers a one-shot
  `Window.OnFrameMetricsAvailableListener` and records
  `INTENDED_VSYNC_TIMESTAMP + TOTAL_DURATION` for the first frame after the mount. On Android
  Fabric mounts inside a Choreographer animation callback, and that same frame draws the
  change, so a frame qualifies when its animation phase ended no earlier than the mount
  (`INTENDED_VSYNC + UNKNOWN_DELAY_DURATION + INPUT_HANDLING_DURATION + ANIMATION_DURATION >= mountNs`);
  filtering on the vsync alone would reject the presenting frame itself. On iOS the stamp is
  the `targetTimestamp` of the first display-link callback the main thread reaches after the
  mount: "main thread free by the next vsync", not render-server presentation. `presented` is
  that stamp minus the cell's `t0`. It is frame-quantised (~16.7 ms at 60 Hz, often ~33 ms
  when the commit lands just after a vsync), so a real 2 ms regression is invisible in it and
  it is the noisiest column. The two platforms differ by a frame by construction: compare
  **arms**, never platforms. Every detail table prints sanity counters (`missingMount`,
  `missingPresented`, `presentedBeforeMount`, `mountBeforeCommit`), and a column whose
  counters are not zero is a broken probe, not a regression. A metric that lost more than
  10 % of its samples to those counters (`MAX_MISSING_SAMPLE_RATIO`) prints `n/a` and is not
  gated: a median over the survivors says nothing about the cell.
- **Android CPU is read in nanoseconds.** `/proc/self/task/<tid>/schedstat` field 0 is ns of
  run time; `/proc/.../stat` (100 Hz jiffies) is only the fallback, and the JS thread uses
  `Debug.threadCpuTimeNanos()` when the bracket runs on it. Short ops still quantise a little,
  so read Android CPU as a directional column with the `mount`/`unmount` split stated.
- **Mount and teardown CPU are separate columns.** `mainNsPerOp` brackets the mount only;
  `unmountMainNsPerOp` brackets the teardown, which is where a hosting-controller teardown
  regression shows up.
- **No `React.Profiler` numbers.** `Profiler.actualDuration` needs `__PROFILE__`, which a
  release bundle does not set. JS cost is `jsNsPerOp`. If an investigation needs profiler
  timings, alias `ReactFabric-prod` to `ReactFabric-profiling` in `bench/metro.config.js` for
  that experiment and say so where you report it.
- **Timestamps are absolute values of the `nitroUiCore.now()` clock**:
  `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` on iOS, `System.nanoTime()` on Android, with no
  origin offset, so a probe stamp lines up with `NitroUiCore.now()` and with the `nuiPerfId`
  perf marks. `CLOCK_UPTIME_RAW` needs about 104 days of awake uptime to reach 2^53 ns, where
  a double's ULP is 0.125 ns, so nothing is lost by keeping them absolute.
- **iOS hooks the presenter, not the observer protocol.** `RCTSurfacePresenter` forwards
  `mountingManager:didMountComponentsWithRootTag:` to its `RCTSurfacePresenterObserver`s, and
  registering as one needs a `RCTBridgeProxy` that bridgeless mode does not provide. The probe
  installs its own `IMP` on that method: same instant, no bridge required.
- **Footprint samples collect garbage first.** Each memory sample calls `globalThis.gc?.()`
  when Hermes exposes it (the run records `heapCollected` per sample, so a silent no-op is
  visible) and records the Hermes/native/Java heap breakdown next to `phys_footprint`/PSS,
  because the Expo arms have measured below `rn-core` on raw PSS. `bytesPerInstance` is the
  noisiest metric here, with one sample per launch, so treat a memory ratio as a lead and use
  the `full` plan on a quiet machine.
- **Emulator numbers are not device numbers.** They are comparable to each other within a
  run, which is all the gates use.

## The release comparison

No device number is committed to compare against. A release check brings its own base:

```sh
bun bench --platform ios --plan full --compare-release          # newest release tag
bun bench --platform ios --plan full --compare-release v0.9.0   # or a named ref
```

With no ref it takes the newest release tag by creatordate, which is the release that shipped
last, not the biggest version number. It skips a tag that points at the commit under review:
measuring a tree against itself produces 1.00 in every row.

**How the base side is measured.** The ref is extracted with `git archive` into
`~/.nitro-ui/bench-base/<repo>/<ref>/` (`NITRO_UI_BENCH_BASE_DIR` moves it), outside the
checkout, so the repository's lint, typecheck, Jest and `git ls-files` checks do not see a
second copy of the library. There `bun install` runs and the ref's own
`scripts/bench/build.mjs` builds its own bench app. The base side is therefore the app the
last release shipped with, described by the code that release contained: a plan format, an arm
or a waiting rule that changed since then does not apply to it. Its schedule is read from that
ref's own `lib.mjs`, which has no dependencies, so `--dry-run` prints both sides without
installing or building anything.

Both apps use the same app identifier, so one of them is installed at a time. The session runs
in **launch rounds**: for launch N of every cell it installs one side, drives that side's
launches for the round, and installs the other side for the next round. The per-round order is
the ABBA the arms inside one launch use, so over four rounds each side goes first twice and
last twice, and a host that warms up or cools down across a long session does not favour one
library version. For a four-launch `quick` plan the cost is one extra app build, one
`bun install` in the base checkout, and six installs instead of one, against 992 launches.
Sides switch per round, not per cell: switching per cell would be ~250 installs.

`--dry-run` prints the whole session before it starts:

```text
Platform:  ios
Plan:      quick (31 cells x 4 implementations x 4 launches = 496 launches)
Device:    UNKNOWN
Host:      10 cores, load 6.51 now (quiet under 5.0)
           note:    the machine was busy: load average 6.51 over 10 cores (ceiling 5.0)
Compare:   v0.9.0 (ded5c9bf) vs HEAD (416f19be)
  head:    496 launches from /path/to/this-checkout
  base:    496 launches from ~/.nitro-ui/bench-base/this-checkout/v0.9.0 (built there, installed under the same app id)
  device:  UNKNOWN - both sides, one session
  rounds:  4, order base/head head/base head/base base/head
  installs 6 (one per side switch), 992 launches total
  cells:   124 compared, 0 head-only, 0 base-only
Reason:    IOS_SIM_UDID is not set, so no simulator can be resolved - lease one (node scripts/lease.mjs acquire --task <ID>)
Dry run:   1 reason(s) not to start it as asked
```

What is compared is the cell key (`mount.switch:nitro-ui:50`). A cell only the candidate has
reads `not measured in base`: a component added since the tag has nothing to be slower than.
A cell only the release has is measured and not gated. Both are counted in the plan lines
above. Each side is also written to its own results file, so the comparison can be re-rendered
offline with `bun run bench:report <head.json> --compare <base.json>`.

A session has three bad endings, each non-zero and each named. **Slower** is the verdict
above. **Not compared** is a cell the plan measured on both sides that ended with no verdict
because one side has no record or no sample of it, or of its `rn-core` control: the release's
app crashed, or its launches were lost. A launch of the release that **did not complete** fails
the session even when every cell still got a verdict. A run that stops early because an app
could not be installed keeps and reports what it had measured, and its unmeasured cells read
as not compared.

Two shapes are refused: `--perf-marks` (marks instrument this tree only, and a comparison
needs both sides measured the same way) and either `--timeout-*` flag (a comparison of two
different waits is not a comparison).

### What makes the two sides comparable

`deviceKey` is `platform + OS runtime + device class`: `ios27-sim-iphone17`,
`android35-emu-pixel9`. The class is the device's **hardware type**, never its name: a
simulator's key comes from `simctl`'s `deviceTypeIdentifier` (`…SimDeviceType.iPhone-17` ->
`iphone17`) and an emulator's from its AVD hardware profile, because pooled devices have local
names such as `nitro-ui A`. A runtime change is a comparability break and shows up as a
different key.

The launch-paired ratio to `rn-core` cancels drift inside one machine and explains nothing
between two: simulators and emulators run on their host's CPU and GPU, so core count, GPU and
memory pressure move the UI-CPU cells. So the base of a verdict is a run on this device in
this session, and every run records the machine that produced it under `machine`: core count,
CPU model (`os.cpus()[0].model`), load averages, RAM, Xcode version or Android image. On
Android it also records the ART state the run was measured in
(`art: { packageName, status, primed, attempts }`), because that state decides which of the
two regimes above a result belongs to; a result without it is a `verify` number.

## Gating

The gate exists once (`gate()` in `scripts/bench/lib.mjs`) and is used identically by
`run.mjs --compare-release`, `run.mjs --compare` and `report.mjs --compare`:

1. Each metric becomes a **launch-paired ratio to `rn-core`**: launch N's arm median over
   launch N's control median, from the same launch, so machine drift cancels.
2. The gated number is `head(x/rn-core) ÷ base(x/rn-core)`, where base is another run: the
   other half of a `--compare-release` session, or a results file named by
   `--compare <ref|file>`.
3. A gated cell fails when the ratio is over **1.20**, its bootstrap 95 % CI **excludes
   1.05**, and that `(scenario, N, metric)` was **quiet inside its own run**: the relative
   MAD of its launch-paired ratios is under 10 %. Noise is judged per cell and metric, never
   as absolute drift against another session.
4. **Only the `nitro-ui` arm gates.** `rn-core` is the control and the `expo-ui-*` arms are
   reference arms: an `@expo/ui` bump is review information, not a failed nitro-ui pull
   request. The `nitro-ui-host` arm (controls inside `<Host>`, scheduled on Android only, and
   only on the eight controls a Host can draw — `ARM_SCOPES` in `scripts/bench/lib.mjs`) is
   reported and not gated either. The two Android `expo-ui-*` arms have no DatePicker or
   Stepper cells (`ARMS_WITHOUT_COMPONENT`).
5. A leak fails the same way when the climb is **monotonic** and the slope ratio clears the
   threshold. A slope over a series that does not climb is not comparable and cannot gate.
6. `rn-core` moving more than 10 % between two runs is printed as context. It cannot suppress
   a verdict (the within-run noise guard does that job) and it cannot create one.

Completeness is judged **per metric, per cell**: a metric that lost more than
`MAX_MISSING_SAMPLE_RATIO` (10 %) of its samples is `n/a` and gates nothing, on any arm.
`ratioTable`, the absolute table, `--compare` and the gate all read through
`comparableMetrics`, so an incomplete metric is missing everywhere at once. Each lost sample
carries its reason (see "When a signal does not arrive"), which distinguishes an arm that
never drew a frame from one that drew a slow one.

A cell that was noisy inside its own run is not gated, and only that cell is spared. The
host's load is reported, not refused on: the runner samples `os.loadavg()[0]` every
`LOAD_SAMPLE_INTERVAL_MS` (30 s) and at every launch boundary, stores
`{ count, ceiling, median, p90, max, over, overFraction }` in `machine.loadSamples`, and the
report prints it. A load over the 0.5 x core-count ceiling is printed as
`the machine was busy`.

Exit codes: `0` ok, `1` conclusive regression (and the run names the cells), `2` the
comparison could not be made (a ref that does not resolve or is the commit under review, a
base side that cannot be planned or built, launches that did not complete).

## Render counts (hard gate)

`bun run perf:renders` runs Reassure over `src/**/*.perf-test.tsx`, inside `bun run check`,
and fails when a wrapper renders a different number of times than
`bench/baselines/renders.json`. Reassure measures **JS renders only**: it stops memoisation
and re-render regressions in the wrappers and measures nothing native.

The gate also reads what Reassure puts in `record.issues`:

- **all runs must agree**: the count must be identical across the 10 runs, so a wrapper that
  renders nondeterministically fails;
- `counts` must equal the baseline;
- `issues.initialUpdateCount` must be **0**: no extra commit straight after mount, i.e. no
  state-setting `useEffect` on the mount path;
- `issues.redundantUpdates` must be **empty**: no commit whose rendered host tree was
  unchanged, which is what prop churn and missing memoisation produce.

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

Flipping the control proves the wrapper re-renders **when told**; rendering an unrelated
parent proves it does **not** re-render when it should not. Two details matter:

- the bumped counter is **drawn** (`<Text>{bumps}</Text>`). Reassure's redundancy check
  compares whole rendered trees per commit, so a parent commit that changed nothing visible is
  itself flagged as a redundant update, which is true of the harness, not the wrapper;
- `fireEvent.press` is awaited (RNTL 14 returns a promise; an unawaited press leaves the act()
  queue to flush inside the next leg).

`measureRenders` is imported from `reassure`; the `@callstack/reassure/measurement` path does
not exist in reassure 1.6. Pick a scenario where you can state the exact expected count, then
run `bun run perf:renders -- --update-baseline` and review the one-line diff. A perf-test
lives at `src/components/<Name>/<Name>.perf-test.tsx`;
`src/components/Switch/Switch.perf-test.tsx` is the reference (count 6: mount, 3 flips, 2
parent renders).

A root Profiler cannot see a `React.memo` bail-out inside the tree, nor prop churn going into
the native host. Pair every perf-test with a deterministic Jest test that `jest.mock`s the
host component with a counter and asserts: one host render per value change, **zero** host
renders on an unrelated parent render, and a stable callback identity across renders. That
enforces the stable-callback / no-prop-churn half of the perf contract directly.

## Adding a component to the matrix

1. Add the implementation in `bench/src/implementations/` and register it in
   `bench/src/implementations/index.ts` (see `BenchImplementation` in `bench/src/types.ts` for
   the fields an arm declares). Pass **every** prop explicitly, never `undefined`
   (nitro#1184).
2. Run the quick plan on both platforms, filtered to your component:
   `bun bench --platform ios --plan quick --component <name>` and `--platform android`. A
   cell's scenario carries the component as `mount.<component>` / `update.<component>` /
   `memory.<component>` / `leak.<component>`, and the bare `mount`/`update`/`memory`/`leak`
   name is the first component (`switch`). `componentOf` (`scripts/bench/lib.mjs`) is the only
   reader of that encoding, and `--component` is the filter.
3. Paste both summary tables (absolute **and** ratio-to-`rn-core`) into your pull request,
   plus the sanity/noise lines, so a reader can see the column was measurable.
4. Add `src/components/<Component>/<Component>.perf-test.tsx` per the scenario contract above
   and commit the recorded render baseline.
5. Do not gate on absolute milliseconds. Report and compare ratios to `rn-core`.
6. A component's **first** `nitro-ui` arm cannot fail a gate: the release it is compared
   against has no cell for it, so it reads `not measured in base`. Its pull request must show
   ratios to `rn-core` _and_ to both `expo-ui-*` arms on `mount presented`, UI CPU and memory.
   The target is `<= 1.0x expo-ui-shared-host`, well below `expo-ui-host-per-control`; a miss
   needs an explanation, and a `--perf-marks` run is how to write one.

`bench/src/implementations/nitroUi.tsx` is the only file that renders the library (named
imports of every component and `Host` from `'react-native-nitro-ui'`, typechecked by
`bun run bench:typecheck` through `bench/tsconfig.json`'s `paths`, which mirrors Metro's
`extraNodeModules`). An arm for a component the library does not export is a build error.
Every arm must do **equivalent work**: RN core `Switch`, `@expo/ui` `Toggle`
(`labelsHidden()`, no label text) and the nitro-ui `Switch` are all a bare switch, because a
SwiftUI `Text` next to the control is a real cost that belongs to nobody's comparison.

Where RN core has no control to compare against, `rn-core` is a **floor**, not a peer, and
the report must say so. RN core has no `Slider`, so the `slider` floor is a bare `View` in the
same box: it hosts no control, runs no gesture code and owns no value, so its ratio answers
"what does any native slider cost over drawing nothing" and the `expo-ui-*` arms answer "over
another native slider". A floor that changes nothing per update also produces **no mount
signal** in an `update` cell, so that cell's `mountedNs`/`presentedNs` are unreportable by
construction (`MAX_MISSING_SAMPLE_RATIO`) and each of its iterations pays the probe's timeout.

## Troubleshooting

| Symptom                                                        | Cause / fix                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClassNotFoundException: HybridBenchProbe`                     | R8 renamed a class Nitro looks up by name via JNI. Keep rules live in `bench/modules/bench-probe/android/proguard-rules.pro` (consumer rules).                                                                                                                                                                                                                                                                                                                         |
| `new com.margelo.nitro.nitroui.<word>()` in `PackageList.java` | autolinking regex-matches the ReactPackage declaration in `android/src/main/.../NitroUiPackage.kt`; prose that reads like a class declaration gets picked up. Delete the generated `bench/android` (`--prebuild`) after fixing the wording. `bun run autolinking:check` covers it.                                                                                                                                                                                     |
| `cmd: Can't find service: settings` right after boot           | The runner retries; if it persists, the emulator is still booting.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `mount` crashes on iOS with a promise mutex abort              | A freed frame-context; contexts are `shared_ptr` captured by both the display-link and fallback timers.                                                                                                                                                                                                                                                                                                                                                                |
| `presented` missing on most samples (`missingPresented` high)  | A metric over 10 % missing prints `n/a` and is ungated, so this row means "go look", not "read the survivors". The listener needs a focused window, and each platform gives up at its own presentation ceiling (`PRESENTATION_CEILING_MS` on Android, `kBenchPresentationCeilingSeconds` on iOS - 2 s and 90 s respectively) and answers `-1`, so confirm the app was in the foreground and re-run.                                                                    |
| Android launch ~5-10x slower than usual, frame signals missing | The AVD may be booting without a host GPU (`hw.gpu.enabled=no` in `~/.android/avd/<name>.avd/config.ini` - `avdmanager create` can leave it, and the runner does not boot Android devices, so nothing corrects it). Boot it yourself with `emulator -avd <name> -port <port> -gpu host`.                                                                                                                                                                               |
| `--compare-release` refuses before starting                    | It names the reason: no release tag to compare against (`--compare-release <ref>` takes one explicitly), the ref resolves to the commit under review, `--perf-marks` or a `--timeout-*` flag, or a base side whose plan could not be read. `--dry-run` answers all of them in a second, without a device.                                                                                                                                                              |
| `--compare-release` says the base ref could not be built       | The base checkout is a real checkout with real dependencies: its `bun install` and its build are its own, so a toolchain or registry change since the tag can break the _base_ side alone. `~/.nitro-ui/bench-base/<repo>/<ref>/` is a cache — delete it and re-run, or compare against a nearer tag. Both sides must build before a launch is spent.                                                                                                                  |
| A whole side reads `not measured in base`                      | Either the two sides ran different plans - `--component`, `--scenario`, `--n` or `--launches` are applied to both, but a cell the release never had cannot appear there, and the plan lines print the head-only and base-only counts before the run starts - or the release side failed. The second case exits non-zero and lists the cells under **Not compared** with the side that has no record of them; the release's own results file carries its problems list. |
| The host is busy (`the machine was busy` in the header)        | Reported, not refused: judge the run by its own noise flags, which are per cell. Cells that bounced inside the run are not gated; if the whole session looks unstable, run it again when the machine is free — the comparison re-measures both sides either way.                                                                                                                                                                                                       |
| Stale native code despite editing sources                      | `build.mjs` rebuilds when any source is newer than the artifact; `--prebuild` forces a full CNG regen.                                                                                                                                                                                                                                                                                                                                                                 |
| Emulator vanished mid-run (`device not found`)                 | qemu aborts occasionally on macOS. Re-run the same command: each cell is independent and results are per-file.                                                                                                                                                                                                                                                                                                                                                         |
| `no end sentinel within 180s`, cells report 0 iterations       | The device was starved by other work on the machine (another emulator, a concurrent gradle/Xcode build) and did not finish a launch inside its budget. Re-run when the machine is quieter, or pass `BENCH_LAUNCH_TIMEOUT_S=600`.                                                                                                                                                                                                                                       |
| Numbers 3x worse than the last run                             | Something else is using the machine. Ratios still hold if the whole cell degraded together; if only one cell did, the within-run noise guard marks it noisy and it cannot carry a verdict.                                                                                                                                                                                                                                                                             |
