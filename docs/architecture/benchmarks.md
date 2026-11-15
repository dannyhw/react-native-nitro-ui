# Benchmarks

The perf guardrail a release runs. It answers one question: **is this release slower than
the last one?** Absolute milliseconds are not comparable between machines or between
afternoons, so every verdict is a **ratio against `rn-core` measured in the same run**, and
the release verdict measures two runs side by side — the last release and the candidate,
one device, one session (`--compare-release`, see "The release comparison").

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
bench/baselines/             renders.json — the committed JS render counts (README)
scripts/bench/               build.mjs run.mjs report.mjs render.mjs devices.mjs lib.mjs
                             compare.mjs — the release comparison: its plan and its base side
scripts/perf/renders.mjs     Reassure render-count gate
```

`lib.mjs` holds the aggregation and the gate, `render.mjs` holds the markdown and
the verdict, and both are free of filesystem access so
`scripts/__tests__/bench-gate.test.js` can prove the gate fires without a device.
`compare.mjs` holds the two-sided plan, free of the filesystem until it is time to extract
a ref. `report.mjs` and `run.mjs` are the two CLIs on top of them.

`BenchProbe` is **private and local**: it is never published, its nitrogen output
lives inside `bench/modules/bench-probe/nitrogen/`, and the library's own
`nitrogen` run never scans it. Regenerate it with `bun run probe:nitrogen`.

## Running

```sh
bun bench --platform ios     --plan quick     # a few minutes
bun bench --platform android --plan quick
bun bench --platform ios     --plan full      # every N, plus the leak slope
bun bench --platform ios     --plan full --compare-release   # the release check
```

The device comes from the environment, exactly like the Harness config:

| Variable         | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `IOS_SIM_UDID`   | Simulator UDID to measure on (boots it if needed)                  |
| `ANDROID_AVD`    | AVD name - the runner resolves the serial from the running AVD     |
| `ANDROID_SERIAL` | Fallback when there is no AVD name (physical device)               |
| `BENCH_ABIS`     | Android ABIs to build (`arm64-v8a` by default, `x86_64` on Intel)  |
| `BENCH_LAUNCH_TIMEOUT_S` | Wall-clock budget per launch; raise it on a busy machine |

`ANDROID_AVD` is preferred over `ANDROID_SERIAL`: console ports are allocated by
availability, so a serial goes stale as soon as another emulator
boots or dies. Matching on the AVD name is what keeps a run on its own device.

There is **no Metro**: release builds embed the bundle, which is also what makes
numbers mean something (Hermes bytecode, R8, no dev tools). `METRO_PORT` is
unused by the bench app.

Useful flags:

| Flag                  | Effect                                                          |
| --------------------- | --------------------------------------------------------------- |
| `--only <impl,impl>`  | Restrict the implementation dimension                           |
| `--component <name>`  | Restrict the run to one component's cells                       |
| `--scenario <name>`   | Restrict it to one scenario's cells, e.g. `mount.date-picker`    |
| `--n <value>`         | Restrict it to cells measured at that instance count             |
| `--launches N`        | Overrides the launches per cell (for a fast smoke test)         |
| `--skip-build`        | Reuse the installed release artifact instead of rebuilding       |
| `--prebuild`          | Force `expo prebuild --clean` first                              |
| `--compare <ref\|file>` | head/base ratios against results already on disk                |
| `--compare-release [ref]` | the release check: measure `ref` (default: the newest release tag) **and** this tree, in one session on one device, then gate head/base |
| `--shutdown`          | Shut down a device the runner itself booted when it finishes     |
| `--perf-marks`        | Diagnostic run: turn on the library's own native perf marks    |
| `--timeout-mount <ms>` | How long each iteration waits for the mount signal (default 1500) |
| `--timeout-presented <ms>` | …and for the presenting frame (default 8 000 on iOS, 2 000 on Android) |

The two `--timeout-*` flags exist to answer one question a results file otherwise cannot:
**did that arm's frame never come, or did it come later than we were willing to wait?**
A4 needed it - `@expo/ui`'s DatePicker at N=200 on one machine arrived on 55 of 160 and 87
of 160 iterations at the 2 000 ms wait of the time (66 % and 46 % lost), and a count of nulls
cannot tell a slow arm from a dead probe. Three things make that work, and all three are
load-bearing:

- the value rides the **launch string** (`…:presentedTimeout=40000`), not an env var: a
  release build has no env, and one launch must be fully described by the string the
  runner passed it;
- each platform's native "this window never drew" backstop is a **ceiling**, not the wait:
  90 s on iOS, 2 s on Android. It used to be a hardcoded 2 s on both, so raising only the JS
  timeout changed nothing - every long wait was answered `-1` by the ceiling at 2 s. Which
  is also why the two platforms cap a requested wait differently (80 s on iOS, 1 900 ms on
  Android): a request at or above the ceiling would be recorded as a timeout the run never
  asked for;
- a run that asks for anything other than its platform's default timeout is a
  **diagnostic**, in either direction: a sample that arrives keeps its value, but *which*
  samples arrive moves the median. It is a diagnostic like `--perf-marks`, and says so at
  startup - which is also why `--compare-release` refuses the two flags: a comparison of two
  different waits is not a comparison. Every run records the rule it measured under in its
  own `timeouts` block, read back from what the app reported - a run whose app reported
  nothing says so rather than being stamped with today's default.

The defaults themselves are a measured rule, not a habit, and they are **per platform**
(`BENCH_DEFAULT_TIMEOUTS` in `bench/src/plan.ts` is the one place either number is written).
On iOS `presented` waits 8 000 ms because A4 measured the same cell's first frame at p50
2.7-3.0 s on the canonical iPhone 17 simulator - above the 2 000 ms it used to wait - with
the slowest iOS frame measured anywhere at 3 565 ms (3 850 ms in the 40 s diagnostic);
`mounted` stays at 1 500 ms on both because the slowest mount measured was 226 ms. **Android
keeps 2 000 ms**, because the evidence for 8 s is iOS evidence and the Android cells that
lose presenting samples do not have a frame between 2 s and 8 s: the 8 affected
`update.progress`/`update.picker` `@expo/ui` cells await both signals and time out on every
iteration, because those arms never produce a Fabric transaction there at all (A3, "never
mounted"). On that shape a longer wait cannot recover a sample; it only inflates the CPU
rows bracketing the wait and adds ~2.7 h to a full Android run.

Raising a wait is **value-neutral for every cell that was already complete**: a sample that
arrived inside 2 s arrives with the identical stamp under 8 s, so its median cannot move.
Only cells that were losing samples change, and they change towards the truth, since the
dropped iterations are the slow ones. That is why iOS's raise does not invalidate the iOS
tables measured under the old wait: a metric with incomplete cells is `n/a` and gates
nothing, and the iOS cells that were losing samples are the two `mount.date-picker`
reference cells that the completeness rule keeps out of every table anyway.
Android needs no such argument - nothing on Android changed.

The per-launch wall-clock budget follows that platform's defaults and any longer wait a run
asks for (`launchBudgetMs`, and `DEFAULT_SCENARIO_BUDGETS` / `TIMEOUTS` per platform): an
iteration of `mount` waits for two mount signals and one presenting frame, so a default iOS
launch can spend 25 x (2 x 1 500 + 8 000) = 275 s waiting - which is why iOS's budget went
180 s -> 300 s (420 s for `leak`) - and a 40 s presented wait adds ~800 s more on top.
Android's table is the pre-A4 one (180 s, 300 s for `leak`) because its worst default wait is
25 x (2 x 1 500 + 2 000) = 125 s; a launch that asks for longer widens it the same way.

### When a signal does not arrive

Every iteration that gets no `mountedNs`/`presentedNs` records **why**, in that
iteration's `missing` array: `probe-timeout` (with the timeout in force and how long the
wait actually ran), `not-awaited` (the cell declares `mountSignal: false`, so the null is
by construction, not a lost signal), or `probe-error` (the probe threw or answered
unparseably, with its message). Those reasons are tallied per cell (`cell.missing`),
printed per launch in the progress line (`80 iterations, 80 presented probe-timeout
(2000 ms)`) and per cell in the report. A cell key never
carries a timeout, so a diagnostic run lands in the same rows as a normal one - only its
*values* are not comparable, which is why `--compare-release` refuses a run that asks for
non-default waits.

The runner restores Android animation scales it reset, and `--shutdown` covers
the "I booted it, I clean it up" case; a device that was already up is left
alone.

`--scenario` and `--n` exist for exactly the run above: once the reasons say
`probe-timeout`, the next question is "how long would that frame have taken?", and that
needs one cell, four arms and a long wait - not three hours of plan:

```sh
node scripts/bench/run.mjs --platform ios --plan full --component date-picker \
  --scenario mount.date-picker --n 200 --launches 8 --timeout-presented 40000
```

`--plan full` still supplies the cell list (so an unmeasured cell cannot sneak in), the
three filters cut it to one cell, and the reported numbers land in the same cell keys as a
normal run - they are simply not comparable with one. A narrowed run is a measurement of
what it measured, and the report says which cells it did not.

`bun run bench:report <results.json> [--compare <ref>]` re-renders an existing results
file without touching a device.

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

On Android the runner also puts the app in the compiled state a device eventually leaves
it in (`scripts/bench/run.mjs`): it asks `androidx.profileinstaller` to install the APK's
merged baseline profile (the `INSTALL_PROFILE` broadcast), compiles from it
(`cmd package compile -m speed-profile -f`), and logs the `dumpsys package dexopt` status it
ended up with. An install alone only *stores* that profile — nothing reads it until the app
itself writes the profile file, and the compiler that would do this in the background runs
on an idle window — so without this step a measured launch may or may not have run
AOT-compiled code depending on how long the device sat idle. All implementations live in
one APK behind one install, so it lands on every arm identically (D9's pairing); what it can
change is not only the effect of a library's own `baseline-prof.txt`
(`docs/architecture/core.md` §13). Priming changes every arm's absolutes *and* the ratios
between the arms, because the arms gain unequally from compiled Compose and RN: T12 measured
mount `presented` against the shared host move 1.22× → 0.99× and memory 2.28× → 2.45× with no
library change at all. ART compile state is therefore a **comparability break like a runtime
change is** — Android runs before T12 (`status=verify`: interpreter + JIT) and runs after it are
two regimes, and neither absolutes nor ratios may be compared across that boundary. A run that
ends at anything but `speed-profile` measured the interpreter, and the runner says so in its
header rather than waiting for someone to notice (T12 round 2).

Scenarios: `mount` (N = 1/50/200), `update` (N = 1/50, K flips awaited per
frame), `memory` (N = 200, after GC), `leak` (repeated mount/unmount of N = 200).
Plans, per component (switch, slider, button, progress, segmented-control,
date-picker, picker): `quick` = `mount:50`, `update:50`, `memory:200`; `full` adds
N = 1/200 and the leak slope. `--component` narrows either plan to one component.

### Native perf marks (`--perf-marks`)

`BenchProbe` measures the black box. The library additionally reports what it
knows about itself: a host with `nuiPerfId >= 0` records `propsApplied` (props
landed on the UI thread) and `firstFrame` (the hosted content drew), in the same
D1 clock base, and `nitroUiCore.drainPerf()` takes them
(`docs/architecture/core.md` §8). Neither mark is a GPU-completed frame, so they
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
`--compare-release` refuses the combination. Only `nitro-ui` has marks; the flag narrows the
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

## The release comparison

No device number is committed to compare against. A release check brings its own base:

```sh
bun bench --platform ios --plan full --compare-release          # newest release tag
bun bench --platform ios --plan full --compare-release v0.9.0   # or a named ref
```

With no ref it takes the newest release tag by *creatordate* — the release that shipped
last, not the biggest version number, because a hotfix on an older line is still the thing
running in the world — and skips a tag that points at the commit under review: measuring a
tree against itself produces 1.00 in every row and a gate that cannot fail.

**How the base side is measured.** The ref is extracted with `git archive` into
`~/.nitro-ui/bench-base/<repo>/<ref>/` (`NITRO_UI_BENCH_BASE_DIR` moves it), deliberately
*outside* the checkout: a second copy of the library inside it would be linted, typechecked,
jest-ed and scanned by every `git ls-files` check, and a stale copy of the library would be
found by tools looking for the current one. There `bun install` runs and the ref's **own**
`scripts/bench/build.mjs` builds its **own** bench app. That is the whole trick: the base
side is the app the last release shipped with, described by the code that release contained,
so a plan format, an arm or a waiting rule that changed since then cannot make the base side
claim something about a version it never ran. Its schedule is read out of that ref's own
`lib.mjs` — which is also why `--dry-run` can print both sides without installing or building
anything, since `lib.mjs` has no dependencies.

Both apps answer to the same app identifier, so exactly one of them is installed at a time.
The session therefore runs in **launch rounds**: for launch N of every cell it installs one
side, drives that side's launches for the round, and installs the other side for the next
round. The per-round order is the ABBA the arms inside one launch already use, so over four
rounds each side goes first twice and last twice, and a host that warms up or cools down
across a long session does not land on one library version. The cost, for a four-launch
`quick` plan: one extra app build, one `bun install` in the base checkout, and six installs
instead of one — against 992 launches, which is why the pairing is worth it. Side granularity
is per round on purpose: an install is on the order of tens of seconds (not yet measured on a
real run), and swapping per cell instead would be ~250 installs — hours of installing added to
a plan that is already hours of measuring.

`--dry-run` prints the whole session before it is paid for:

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

What is compared is the cell key (`mount.switch:nitro-ui:50`). A cell only the candidate
knows about reads `not measured in base` — a component added since the tag has nothing to be
slower than — and a cell only the release knows about is measured and then not gated. Both
asymmetries are counted in the plan lines above, because a table where a quarter of the rows
read `-` needs saying out loud before the run, not after. Each side is also written to its own
results file, so the comparison can be re-rendered offline with
`bun run bench:report <head.json> --compare <base.json>` without the device that made it.

A session has three bad endings, each non-zero and each named in its own words. **Slower**
is the verdict above. **Not compared** is a cell the plan measured on both sides that ended
with no verdict because one side has no record or no sample of it, or of its `rn-core`
control: the release's app crashed, or its launches were lost. And a launch of the release
that **did not complete** fails the session even when every cell still got a verdict. A run
that stops early because an app could not be installed keeps and reports what it had
measured, and its unmeasured cells read as not compared.

Two shapes are refused rather than run: `--perf-marks` (marks instrument this tree only, and
a comparison needs both sides measured the same way) and either `--timeout-*` flag (a
comparison of two different waits is not a comparison).

### What makes the two sides comparable

`deviceKey` is `platform + OS runtime + device class` (D9): `ios27-sim-iphone17`,
`android35-emu-pixel9`. The class is the device's **hardware type**, never what it was named:
a simulator's key comes from `simctl`'s `deviceTypeIdentifier` (`…SimDeviceType.iPhone-17`
-> `iphone17`) and an emulator's from its AVD hardware profile, because the lease pool names
its devices `nitro-ui A`/`nitro-ui B` and a comparison cannot be keyed on a local nickname. A
runtime change is a comparability break and shows up as a different key.

The launch-paired ratio to `rn-core` cancels drift *inside* one machine and explains nothing
between two: simulators and emulators run on their host's CPU and GPU, so core count, GPU and
memory pressure move the UI-CPU cells (`docs/tasks/PROCESS-review-2026-10-26.md` §5). That is
why the base of a verdict is a run on this device in this session rather than a number from
somewhere else, and why every run records what machine produced it — core count, CPU model
(`os.cpus()[0].model`), load averages, RAM, Xcode version or Android image — under `machine`,
because a class-level key cannot tell same-class hosts apart. On Android it records the ART
state the run was measured in as well (`art: { packageName, status, primed, attempts }`),
because that state decides which of the two regimes above a result belongs to; a result
without it is pre-T12 and is a `verify` number.

## Gating

The gate exists once (`gate()` in `scripts/bench/lib.mjs`) and is used identically by
`run.mjs --compare-release`, `run.mjs --compare` and `report.mjs --compare`:

1. Each metric becomes a **launch-paired ratio to `rn-core`**: launch N's arm
   median over launch N's control median, from the same launch, so machine drift
   cancels instead of being measured and then excused.
2. The gated number is `head(x/rn-core) ÷ base(x/rn-core)`, where base is another run:
   the other half of a `--compare-release` session, or a results file named by
   `--compare <ref|file>`.
3. A gated cell fails when the ratio is over **1.20**, its bootstrap 95 % CI
   **excludes 1.05**, *and* that `(scenario, N, metric)` was **quiet inside its
   own run** - the relative MAD of its launch-paired ratios under 10 %. Noise is
   judged per cell and metric, never as absolute drift against another session: that
   is what made round 1 unable to fail.
4. **Only the `nitro-ui` arm gates.** `rn-core` is the control and the `expo-ui-*`
   arms are reference arms: an `@expo/ui` bump is review information, not a
   failed nitro-ui pull request. The `nitro-ui-host` arm (controls inside
   `<Host>`, scheduled on Android only, and only on the eight controls a Host can draw —
   `ARM_SCOPES` in `scripts/bench/lib.mjs`) is reported and not gated either. The two Android
   `expo-ui-*` arms have no DatePicker cells (`ARMS_WITHOUT_COMPONENT`).
5. A leak fails the same way when the climb is **monotonic** and the slope ratio
   clears the threshold. A slope over a series that does not climb is not
   comparable and cannot gate.
6. `rn-core` moving more than 10 % between two runs is printed as context. It
   cannot suppress a verdict (the within-run noise guard does that job) and it
   cannot create one.

Completeness is judged **per metric, per cell** (D9's A4 amendment): a metric that lost
more than `MAX_MISSING_SAMPLE_RATIO` (10 %) of its samples is `n/a` and gates nothing, on
any arm — `ratioTable`, the absolute table, `--compare` and the gate all read through
`comparableMetrics`, so an incomplete metric is missing everywhere at once instead of being
quietly averaged over the survivors. Each lost sample carries its reason (see "When a signal
does not arrive"), which is what distinguishes an arm that never drew a frame from one that
drew a slow one.

A cell that was noisy inside its own run is not gated, and only that cell is spared: a busy
minute costs a verdict on one cell, not a run. The quiet rule is also the reason the host's
load is a *reported* number rather than a refusal. The runner still samples
`os.loadavg()[0]` every `LOAD_SAMPLE_INTERVAL_MS` (30 s) and at every launch boundary and
still stores `{ count, ceiling, median, p90, max, over, overFraction }` in
`machine.loadSamples`, and the report prints it — what changed is that a load over the
0.5 x core-count ceiling is printed as `the machine was busy` instead of throwing the
measurement away. The record is why: the run that this policy was built for reported 13
failures on cells its branch had not touched, on a host that peaked at 27.77 against a
ceiling of 7.0 ([`H2b` report](../tasks/H2b-host-popups.report.md)). Refusing a finished run
for its load was a way to lose hours and still have no answer; a cell that was quiet inside
its own run is a verdict whatever the host was doing, and one that did not bounce is not.

Exit codes: `0` ok, `1` conclusive regression (and the run names the cells), `2` the
comparison could not be made (a ref that does not resolve or is the commit under review, a
base side that cannot be planned or built, launches that did not complete).

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
Every component has one (`src/components/<Name>/<Name>.perf-test.tsx`);
`src/components/Switch/Switch.perf-test.tsx` is the reference (count 6: mount,
3 flips, 2 parent renders).

A root Profiler cannot see a `React.memo` bail-out inside the tree, nor prop
churn going into the native host. Pair every perf-test with a deterministic Jest
test that `jest.mock`s the host component with a counter and asserts: one host
render per value change, **zero** host renders on an unrelated parent render, and
a stable callback identity across renders. That is the stable-callback /
no-prop-churn half of the perf contract, enforced directly. (T10 owns the first
instance of both.)

## Adding a component to the matrix

1. Add the implementation in `bench/src/implementations/` and register it in
   `bench/src/implementations/index.ts` (see `BenchImplementation` in `bench/src/types.ts` for
   the fields an arm declares).
   Pass **every** prop explicitly - never `undefined` (nitro#1184).
2. Run the quick plan on both platforms, filtered to your component:
   `bun bench --platform ios --plan quick --component <name>` and
   `--platform android`. A cell's scenario carries the component as
   `mount.<component>` / `update.<component>` / `memory.<component>` /
   `leak.<component>`, and the bare `mount`/`update`/`memory`/`leak` name is the
   first component (`switch`) - so pre-existing plans and report rows
   still line up. `componentOf` (`scripts/bench/lib.mjs`) is the only reader of
   that encoding, and `--component` is the filter.
3. Paste both summary tables (absolute **and** ratio-to-`rn-core`) into your pull
   request, plus the sanity/noise lines, so a reader can see the column was
   measurable.
4. Add `src/components/<Component>/<Component>.perf-test.tsx` per the scenario contract above and commit
   the recorded render baseline.
5. Do not gate on absolute milliseconds. Report and compare ratios to `rn-core`.
6. A component's **first** `nitro-ui` arm cannot fail a gate: the release it is compared
   against has no cell for it, so it reads `not measured in base` (D15). Its pull request must show ratios to `rn-core` *and*
   to both `expo-ui-*` arms on `mount presented`, UI CPU and memory, and a miss
   against the D15 target (`<= 1.0x expo-ui-shared-host`, well below
   `expo-ui-host-per-control`) needs an explanation - a `--perf-marks` run is how
   to write one - plus a follow-up item.

The `nitro-ui` arm is live: `bench/src/implementations/nitroUi.tsx` is the only
file that renders the library (named imports of every component and `Host` from
`'react-native-nitro-ui'`, typechecked by `bun run bench:typecheck` through
`bench/tsconfig.json`'s `paths`, which mirrors Metro's `extraNodeModules`). Before
T10 exported a component the arm resolved `Switch` at runtime and reported itself
*skipped* with a reason, so nobody benchmarked a stub; that lookup is gone, and an
arm for a component the library does not export is now a build error instead.
Every arm must do **equivalent work**: RN core `Switch`, `@expo/ui` `Toggle`
(`labelsHidden()`, no label text) and the nitro-ui `Switch` are all a bare
switch, because a SwiftUI `Text` next to the control is a real cost that belongs
to nobody's comparison.

Where RN core has no control to compare against, `rn-core` is a **floor** rather
than a peer, and the report must say so. RN core's `Slider` left the framework in
0.80, so the `slider` floor is a bare `View` in the same box: it hosts no control,
runs no gesture code and owns no value, so its ratio answers "what does any native
slider cost over drawing nothing" and the `expo-ui-*` arms answer "over another
native slider". A floor that changes nothing per update also produces **no mount
signal** in an `update` cell, so that cell's `mountedNs`/`presentedNs` are
unreportable by construction (`MAX_MISSING_SAMPLE_RATIO`) and each of its
iterations pays the probe's timeout - visible in the log as
`N without a mount signal`, which is expected rather than a fault.

## Troubleshooting

| Symptom                                   | Cause / fix                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `ClassNotFoundException: HybridBenchProbe` | R8 renamed a class Nitro looks up by name via JNI. Keep rules live in `bench/modules/bench-probe/android/proguard-rules.pro` (consumer rules). |
| `new com.margelo.nitro.nitroui.<word>()` in `PackageList.java` | autolinking regex-matches the ReactPackage declaration in `android/src/main/.../NitroUiPackage.kt`; prose that reads like a class declaration gets picked up. Delete the generated `bench/android` (`--prebuild`) after fixing the wording. `bun run autolinking:check` covers it. |
| `cmd: Can't find service: settings` right after boot | The runner retries; if it persists, the emulator is still booting. |
| `mount` crashes on iOS with a promise mutex abort | A freed frame-context; contexts are `shared_ptr` captured by both the display-link and fallback timers. |
| `presented` missing on most samples (`missingPresented` high) | A metric over 10 % missing prints `n/a` and is ungated, so this row means "go look", not "read the survivors". Until T02 round 4 the dominant cause was the Android probe itself: its vsync filter rejected the very frame that presents a Fabric mount, and only cells whose screen invalidated *again* (the Switch's thumb animation on `update`) ever produced a sample - static `mount` cells timed out at ~80/80 on every arm, which is deterministic, not selective. Check the build predates that fix before chasing machine causes: the listener needs a focused window, and each platform gives up at its own presentation ceiling (`PRESENTATION_CEILING_MS` on Android, `kBenchPresentationCeilingSeconds` on iOS - 2 s and 90 s respectively) and answers `-1`, so confirm the app was in the foreground and re-run. |
| Android launch ~5-10x slower than usual, frame signals missing | The AVD may be booting without a host GPU (`hw.gpu.enabled=no` in `~/.android/avd/<name>.avd/config.ini` - `avdmanager create` can leave it, and the runner does not boot Android devices, so nothing corrects it). Boot it yourself with `emulator -avd <name> -port <port> -gpu host`. |
| `--compare-release` refuses before starting | It names the reason: no release tag to compare against (`--compare-release <ref>` takes one explicitly), the ref resolves to the commit under review - measuring a tree against itself cannot fail, so it cannot pass either - `--perf-marks` or a `--timeout-*` flag, which the comparison cannot hold constant, or a base side whose plan could not be read. All of them are answered by `--dry-run` in a second, without a device. |
| `--compare-release` says the base ref could not be built | The base checkout is a real checkout with real dependencies: its `bun install` and its build are its own, so a toolchain or registry change since the tag can break the *base* side alone. `~/.nitro-ui/bench-base/<repo>/<ref>/` is a cache — delete it and re-run, or compare against a nearer tag. Both sides must build before a launch is spent. |
| A whole side reads `not measured in base` | Either the two sides ran different plans - `--component`, `--scenario`, `--n` or `--launches` are applied to both, but a cell the release never had cannot appear there, and the plan lines print the head-only and base-only counts before the run starts - or the release side failed. The second case exits non-zero and lists the cells under **Not compared** with the side that has no record of them; the release's own results file carries its problems list. |
| The host is busy (`the machine was busy` in the header) | Reported, not refused: judge the run by its own noise flags, which are per cell. Cells that bounced inside the run are not gated; if the whole session looks unstable, run it again when the machine is free — the comparison re-measures both sides either way. |
| Stale native code despite editing sources | `build.mjs` rebuilds when any source is newer than the artifact; `--prebuild` forces a full CNG regen. |
| Emulator vanished mid-run (`device not found`) | qemu aborts occasionally on macOS. Re-run the same command: each cell is independent and results are per-file. |
| `no end sentinel within 180s`, cells report 0 iterations | The device was starved by other work on the machine (another emulator, a concurrent gradle/Xcode build) and did not finish a launch inside its budget. Re-run when the machine is quieter, or pass `BENCH_LAUNCH_TIMEOUT_S=600`. |
| Numbers 3x worse than yesterday | Something else is using the machine. Ratios still hold if the whole cell degraded together; if only one cell did, the within-run noise guard marks it noisy and it cannot carry a verdict. |
