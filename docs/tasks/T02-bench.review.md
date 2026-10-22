# T02 review — benchmark app, BenchProbe, runner/report, Reassure gate

Reviewer: independent adversarial review of `task/T02-bench` (`d7f546e`) against
`main` (now at `024989d`, T03 merged). Read: AGENTS.md, PLAN.md, DECISIONS.md, the
brief, the report, setup-decisions §6, every file in the diff, and Nitro 0.37.1
`Promise.hpp`, Reassure 1.6.1 `measure-renders.js`, RN 0.88 `MountItemDispatcher.kt`.

Ran: `bun run check` passed (exit 0). `bun run perf:renders` passed with "nothing
to measure". I typechecked a throwaway `bench/src` import of `react-native-nitro-ui`
(see B2), then deleted it. I used no device time: I checked the crash fix from the
crash log and from the result files already on disk. `git merge-tree main HEAD`
gave 3 conflicts (B4).

**Verdict: CHANGES-REQUIRED.** The infrastructure is serious and mostly sound. The
probe, the protocol, the stale-result guard, the AVD-name resolution and the
failure handling are all good work, and the iOS crash is fixed. Four things still
have to change before merge: the gate logic can never fail, the one-file
`nitro-ui` slot does not typecheck, and there are merge conflicts. Several metrics
also measure something other than what their labels say.

---

## BLOCKING

### B1. The control-drift guard makes `--check` (and mostly `--compare`) unable to fail
`scripts/bench/run.mjs:514-525`, `scripts/bench/report.mjs:472-483`, `scripts/bench/lib.mjs:536-562`, `report.mjs:240-253`

- For `--check`, the guard compares **absolute** `rn-core` numbers in the committed
  baseline with absolute numbers from today's run. If any one of the roughly 11
  control metrics, in any scenario, moved more than 10 %, the whole run is marked
  `noisy` and nothing can fail. Ratio-to-`rn-core` baselines exist precisely
  because absolute numbers drift between sessions and machines, so this re-imports
  the drift the normalisation removed.
- The report's own data shows the effect. Between two identical builds on the same
  machine, Android had 7 of 11 control metrics over 10 % and iOS had 1 of 11. Any
  `--check` against a baseline from another day, load level or runner image will
  read "noisy, inconclusive". So the guardrail never fires.
- `--compare` has the same any-metric, whole-run scope.

**Fix:**
- In `--check`, gate on control-normalised, launch-paired ratios only (that code
  already exists) and drop the absolute-drift suppression.
- If you want a noise guard, base it on **within-run** stability: for example, the
  spread of the `rn-core` per-launch medians, or the bootstrap CI width of the
  paired ratio.
- In `--compare`, also gate on head(x/rn-core) ÷ base(x/rn-core). Scope any drift
  suppression to the same `(scenario, metric)` it was observed on, never to the
  whole run.
- Only gate the implementation under test (`nitro-ui`). `expo-ui-*` are reference
  arms: an `@expo/ui` bump must not fail a nitro-ui PR (see S9).

### B2. The "one-file" `nitro-ui` slot fails `bench:typecheck`, and so fails `bun run check`
`bench/tsconfig.json`, `bench/src/implementations/nitroUi.tsx:16-37`

- The root package is never linked into `node_modules`. Metro finds it through
  `extraNodeModules`, but TypeScript cannot.
- I added `import { nitroUiCore } from 'react-native-nitro-ui'` to a temp file in
  `bench/src` and got `TS2307: Cannot find module 'react-native-nitro-ui'`.
- The snippet is also internally inconsistent. It uses `ROW_HEIGHT` and
  `onValueChange` without importing them, and it leaves `rowStyle` unused, which
  trips `noUnusedLocals`.
- It also uses an inline `style={{ height: ROW_HEIGHT }}`.
- T10's real API matches the snippet (`Switch`, `value`, `onValueChange`, `style`
  in `T10/src/components/Switch/Switch.tsx`), so only the plumbing is wrong.

**Fix:**
- Add `"paths": { "react-native-nitro-ui": ["../src/index.ts"] }`, with a
  `baseUrl` if needed, to `bench/tsconfig.json`.
- Rewrite the snippet to use `rowStyle` and to import `onValueChange` explicitly.
- Prove it: temporarily point the slot at `nitroUiCore` (or a `View`) through the
  real import, and run `bun run bench:typecheck`.

### B3. iOS Expo arms render a text label that RN core and nitro-ui do not (fairness)
`bench/src/implementations/expoUi.ios.tsx:16-19,39-44`

- Every Expo `Toggle` gets `label={`bench-expo-…-${index}`}`, so SwiftUI lays out
  and renders N distinct `Text` views.
- RN `Switch` has no label, and T10's SwiftUI `Toggle` uses `.labelsHidden()`
  (`T10/ios/components/Switch/HybridNitroUiSwitch.swift:53`).
- This inflates Expo's mount, UI CPU and memory numbers in exactly the comparison
  the project will publish.

**Fix:** drop `label`, and pass `modifiers={[labelsHidden()]}` from
`@expo/ui/swift-ui/modifiers` so every arm renders a bare switch. Then re-run the
iOS tables.

### B4. Merge conflicts with `main` and a duplicate library fix
`android/.../NitroUiPackage.kt`, `package.json`, `CONTRIBUTING.md`

- T03 fixed the same autolinking-regex problem in `NitroUiPackage.kt`, with better
  wording and a new `autolinking:check` gate that covers it.
- `git merge-tree` reports conflicts in all three files.

**Fix:**
- Rebase on `main` and **drop `e7fbabd`** (take main's KDoc).
- Merge the `check` scripts so the result is `typecheck → bench:typecheck → lint →
  … → nitrogen:check → autolinking:check → prepare → …`.
- Merge both CONTRIBUTING command tables.

---

## SHOULD-FIX: measurement validity

### S1. "JS CPU/op" includes the JS polling loop, which scales with native latency
`bench/src/probe.ts:36-52`, `runner.ts:43`

`waitForMountNs` busy-polls `lastMountNs` with `setTimeout(0)` inside the CPU
bracket. The JS thread therefore burns CPU for as long as the native mount takes,
so a slower native mount looks like more JS work. On iOS, `JS CPU − JS commit` goes
up roughly with `mounted`:

| Arm              | mounted | JS CPU − JS commit |
| ---------------- | ------- | ------------------ |
| shared host      | 7.9 ms  | 1.3 ms             |
| rn-core          | 11.4 ms | 1.2 ms             |
| host-per-control | 21.5 ms | 2.0 ms             |

**Fix:** have the probe resolve a `Promise<number>` from the mount hook (`awaitMount(timeoutMs)`) and drop the polling, or limit the JS-CPU bracket to `commit()`.

### S2. "presented" goes through a JS round trip and is biased differently on each platform
`runner.ts:45`, `HybridBenchProbe.mm:233-278`, `HybridBenchProbe.kt:114-124`

- `nextFrameNs()` only starts after JS has observed the mount (poll), hopped back
  and dispatched to main. That can push it one frame past the frame that actually
  displayed the change.
- iOS reports `targetTimestamp`, the next display time, which runs about one frame
  ahead.
- Android reports `frameTimeNanos`, the vsync **start**. After a late frame that
  can be earlier than the mount.
- iOS `update` reads exactly 32.75 ms for every arm, so the metric is phase-locked
  to 2 frames and cannot tell the arms apart.
- Android `rn-core` `update` shows 57 ms between mounted and presented, which is
  too much to be one frame.

**Fix:**
- Arm the frame capture **natively at mount time**. In the iOS hook, add a one-shot
  `CADisplayLink` on main in the same run-loop turn. In Android `didMountItems`,
  call `Choreographer.postFrameCallback` directly, or better, use a one-shot
  `Window.OnFrameMetricsAvailableListener` with `INTENDED_VSYNC_TIMESTAMP + TOTAL_DURATION`.
- Store the result as `lastPresentedNs`.
- Document that the value is a frame count, and add a sanity counter for samples
  where `presented < mounted` or `mounted < jsCommit`.

### S3. Android thread CPU comes from 100 Hz ticks
`HybridBenchProbe.kt:128-158`

`/proc/.../stat` `utime+stime` are in 10 ms jiffies. **Fix:** read the first field
of `/proc/self/task/<tid>/schedstat` (ns run time; present on Android kernels), and
fall back to `stat`. Also correct the report text: with K=20 the granularity per op
is 0.5 ms, not "0 or 10 ms".

### S4. `React.Profiler` is dead in release, but its zeros are still reported
`BenchApp.tsx:116-122,231`, `report.mjs:190`, baselines `profilerMsPerUpdate: 0`

§6 lists Profiler `actualDuration` as a metric. **Fix (pick one):**
- Alias `ReactFabric-prod` → `ReactFabric-profiling` in `bench/metro.config.js`.
  This applies to every arm equally.
- Remove the field, and print `n/a` instead of "React.Profiler 0.00 ms/op".

### S5. The mount CPU bracket also covers unmount, two idle frames and a 20 ms sleep
`runner.ts:120-147`

"UI CPU/op" for `mount` is really the cost of a mount+unmount cycle. That is useful,
but it has to be labelled as such, or the mount alone has to be bracketed.
Unmounting 50 hosting controllers is not free.

### S6. "Median of medians" is actually a pooled median
`lib.mjs:291-307`, `report.mjs:9`, `docs/architecture/benchmarks.md:82`

`metrics[m].median` and `.mad` are computed over all pooled iterations. The brief
and the docs say "median of launch medians ± MAD". **Fix:** use
`median(launchMedians)` and the MAD of the launch medians, or fix the docs.

Related: `bootstrapMedianRatio` collapses every launch to its median and then
resamples 4 values. The comment at `lib.mjs:437` ("bootstrap over iterations") is
therefore wrong. A hierarchical bootstrap (resample launches, then iterations
within each launch) would give honest and tighter CIs.

### S7. The clock offset is unnecessary, the reason given is wrong, and it breaks D1 interop
`HybridBenchProbe.mm:55-65`, `.hpp:28-34`, `.kt:38-39`

- `CLOCK_UPTIME_RAW` ns only exceed 2^53 after about 104 days of awake uptime. At
  1e15 the ULP of a double is 0.125 ns. Neither "~1e17 ns" nor "quantise to ~16 ns"
  is true.
- Because of the offset, probe timestamps cannot be lined up with
  `NitroUiCore.now()` or the perf events T10 emits (`nuiPerfId` /
  `NitroUiPerfEvent`), which D1 put on the same clock.

**Fix:** report absolute D1 values, or at minimum emit `originNs` in the `meta`
record. Correct the docs either way.

### S8. Memory samples skip the JS heap; the leak slope is not gated
`runner.ts:193-259`, `HybridBenchProbe.mm:296-298`, `lib.mjs:569-595`

- iOS `gc()` is a no-op, and no path collects Hermes, even though both
  `phys_footprint` and PSS include the Hermes heap. **Fix:** call
  `globalThis.gc?.()` before sampling (check it exists in this Hermes build). On
  Android, consider `Debug.getNativeHeapAllocatedSize()` plus Java heap used
  alongside PSS, because the Expo arms read *below* `rn-core`.
- §6 says to "Fail on a monotonic increase". `leakMonotonic` and the slope are
  printed but never gated. **Fix:** gate on `leakMonotonic && slope > threshold`.

### S9. The gate covers reference arms
`lib.mjs:569-595` gates every implementation. Restrict conclusive failures to
`nitro-ui`; keep `expo-*` as information or as extra controls.

## SHOULD-FIX: runner, report and baselines

### S10. `--update-baseline` accepts any run, and the committed baselines are unattributable
`run.mjs:494-498`, `report.mjs:434-457`

- It accepts runs with `problems.length > 0` and dirty trees.
- Both committed baselines say `sha: e39db3c` (that is `main`) and were recorded
  from a **dirty tree**.

**Fix:**
- Refuse to write a baseline when there are problems or the tree is dirty, unless
  `--force` is passed.
- Record the machine, load average, Xcode/emulator image and OS runtime.
- Re-record both baselines on the final commit.

### S11. The standalone `report.mjs --compare` ignores `noisy`
`report.mjs:430` exits 1 on any conclusive failure, but `run.mjs:488` applies
`&& !noisy`. The baseline-writing and `--check` code is also duplicated between the
two files, which is how this drift happened. **Fix:** extract one `gate()` and use
it from both.

### S12. Results files collide
`resultsPath(sha, platform)` overwrites earlier runs, and the `*.run1.json` files
had to be renamed by hand. A dirty-tree run also takes the clean commit's name and
can become a `--compare` base. **Fix:** name files
`<sha>[-dirty]-<platform>-<timestamp>.json` and resolve a ref to the newest clean
file.

### S13. The perf hard gate is not wired anywhere
`perf:renders` is not in `check` and not in `ci.yml`. **Fix:** add it to `check`
(it is cheap while there are no tests) or give it its own CI job.

### S14. `bench.yml` problems (written, not run, but must be fixed before enabling)
- **Wrong revision.** `issue_comment` runs check out the *default branch*, so
  `/bench` compares main with main. **Fix:** `gh pr checkout "$PR"`, or check out
  `refs/pull/<n>/head`.
- **Security.** Once the workflow does build PR code, any commenter can trigger it
  with a `pull-requests: write` token. **Fix:** require
  `github.event.comment.author_association` to be `OWNER`, `MEMBER` or
  `COLLABORATOR`.
- **Trigger match.** `grep -q '/bench'` matches any comment that mentions
  `scripts/bench/...`. **Fix:** `grep -qE '^/bench(\s|$)'`.
- **Concurrency.** `concurrency: …${{ github.ref }}` is the same for every comment
  run, so PRs cancel each other and the nightly. **Fix:** key the group on the PR
  number.
- **Runner image.** `runs-on: macos-15` contradicts D2 (`xcode-27`); Xcode 16
  cannot build SDK 58 / RN 0.88.
- **Android emulator.** The workflow never installs the system image or the
  emulator package, and never enables KVM. **Fix:** use
  `reactivecircus/android-emulator-runner`.
- **Stale native projects.** Base and head share `bench/ios` and `bench/android`,
  but prebuild is not forced. **Fix:** pass `--prebuild` so native config changes
  in head apply.
- **Nightly.** The nightly runs merge-base(HEAD, main) = HEAD twice. That is fine
  as a noise sample, but label it that way.
- **Docs.** `benchmarks.md:180` says CI runs base and head "interleaved"; it runs
  them sequentially (the report admits this).

---

## NIT

- `HybridBenchProbe.mm:127-157`: use `pthread_mach_thread_np(pthread_main_thread_np())`.
  The main thread's name is usually empty, so you always end up on the `threads[0]`
  fallback. The unused `task_threads` port rights also leak; deallocate them.
- `shared.ts:17-19`: `stackStyle(n)` creates a new style object on every render,
  so the shared-host `Host` gets a prop update on every flip. Memoise it per `n`.
- `bench/metro.config.js:21-23`: `packageExportConditionTranslations` is not a
  Metro option as far as I can tell, so it does nothing. `extraNodeModules`
  already does the work; remove it, or use `unstable_conditionNames`.
- `devices.mjs`: the runner boots the simulator but never shuts down what it
  booted, and it leaves Android animation scales at 0. Offer `--shutdown` and
  restore the scales, or document both.
- `renders.mjs:112-118`: the median of 10 counts hides nondeterminism. Require all
  runs to be equal, and fail if they differ.
- `HybridBenchProbe.kt:114-124`: `nextFrameNs` has no timeout (iOS has 2 s).
- Report §"Noise": "short ops read as 0 or 10 ms" is wrong; see S3.
- Cross-task, outside T02: the R8 problem in bug 7 hits any Kotlin
  **HybridObject** autolinked by class name. T10's Kotlin classes are Hybrid
  *Views* created by direct reference, so they are fine. Any future Kotlin
  HybridObject in the library needs `@Keep @DoNotStrip` or consumer keep rules.
  T03's Release smoke test is what would catch it.

---

## The known iOS crash: fixed, and fixed robustly

The crash report `~/Library/Logs/DiagnosticReports/nitrouibench-2026-10-22-203649.ips`
(20:36 local) shows this path:

`__throw_system_error ← mutex::lock ← Promise<double>::resolve (Promise.hpp:125) ← settle lambda (.mm:249) ← dispatch_after block (.mm:269) ← _dispatch_source_invoke`

That is the 2 s **fallback timer** resolving a promise whose context had already
been freed, after the display link won the race. `HybridBenchProbe.mm` was edited at
20:38, after that crash.

Why the current code is safe:
- `FrameContext` is a `shared_ptr` that holds the `shared_ptr<Promise>`. Both
  blocks capture it by value (block-copy of a C++ object).
- A `settled` atomic `exchange` makes the resolve happen exactly once.
- Both paths run on main.
- Both paths invalidate the display link.
- There is no retain cycle: the handler uses `sender`, not `link`.
- Nitro's `resolve` releases its lock before calling listeners, so there is no
  re-entrancy risk.

Supporting evidence: there are no crash reports after 20:36. The `7cc3c95` iOS run
has 80/80 samples in every mount cell, and the report says `problems: none`. The
only side effect left is that the context lives for 2 s after resolving, which is
harmless.

---

## Re-render gate (report question 2): concrete proposal

Reassure 1.6.1 *can* measure re-renders. `measureRenders(ui, { scenario })` counts
every commit of the `REASSURE_ROOT` Profiler, including the ones the scenario
triggers. It also writes `issues.initialUpdateCount` and `issues.redundantUpdates`
(commits whose host tree did not change) into `current.perf`. `renders.mjs` ignores
both.

```tsx
// src/components/Switch/Switch.perf-test.tsx
function Harness() {
  const [value, setValue] = useState(false);
  const [, bump] = useState(0);
  return (<>
    <Pressable testID="flip" onPress={() => setValue((v) => !v)} />
    <Pressable testID="parent" onPress={() => bump((n) => n + 1)} />
    <Switch value={value} onValueChange={noop} />
  </>);
}
test('Switch: mount, 3 flips, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async (screen) => {
      for (let i = 0; i < 3; i++) fireEvent.press(screen.getByTestId('flip'));
      for (let i = 0; i < 2; i++) fireEvent.press(screen.getByTestId('parent'));
      await act(async () => {}); // flush effects inside the measured window
    },
  });
});
```

Extend the gate to:
- require `counts` to be identical across runs and equal to the baseline;
- require `initialUpdateCount === 0`;
- require `redundantUpdates` to be empty.

A root Profiler cannot see a memo bail-out, or prop churn into the native view.
Pair the test above with a plain deterministic Jest test:
- `jest.mock` the Nitro host component (`NativeNitroUiSwitch` /
  `getHostComponent`) with a counting component that records props per render;
- assert that the host renders once per value change and **zero** times on an
  unrelated parent render;
- assert that the `{ f }` callback wrapper keeps the same identity across renders.

That directly enforces the stable-callback / no-prop-churn part of the perf
contract. I recommend that T10 adopt both, and that T02 (or a small follow-up)
teach `renders.mjs` to read `issues`.

## Recommendations on the report's questions

1. **NitroUiPackage.kt:** take main's T03 version and drop `e7fbabd` (B4).
   `autolinking:check` now covers the `example/` consumer and fresh apps.
2. **Reassure contract:** see above. Gate on scenario render counts plus
   `redundantUpdates`, together with a host-mock prop-churn test. T10 owns the
   tests; the gate script owns reading `issues`.
3. **METRO_PORT:** agreed. Drop it from bench briefs and the CONTRIBUTING example;
   D3 ports are for Metro-using apps only.
4. **CI baselines:**
   - Keep committed **ratio-only** baselines in the repo; they are small and
     reviewable.
   - Regenerate them only from one canonical environment (a `workflow_dispatch`
     job, or a designated quiet machine), with `--plan full`, about 8 launches, and
     a clean tree (S10). Land them in a dedicated PR.
   - Keep absolute trend data out of git: upload artifacts, optionally to Bencher.
   - Until CI is green, the local baselines are acceptable once they have been
     re-recorded on a clean final commit.
5. **Device keys:**
   - Use one canonical device per platform for baselines (for example the iPhone 17
     sim on iOS 27, and an API 36 arm64 AVD named `nitroui-bench`).
   - Add the OS runtime to the key (`ios-iphone-17-27.0-sim`). A runtime change
     breaks comparability more than a model change does.
   - Tasks on other hardware use same-run ratio tables and `--compare`, not `--check`.
6. **Port churn:** agreed. Resolving by AVD name is right; T03/T10 runners should
   do the same.
7. **Machine load:**
   - Record `os.loadavg()` and the CPU count in `run`.
   - Mark a run "unquiet" above about 0.5 × the core count; refuse
     `--update-baseline` on an unquiet run.
   - PLAN.md should say plainly that device benchmarks inform review and only the
     static/Reassure gates block.
