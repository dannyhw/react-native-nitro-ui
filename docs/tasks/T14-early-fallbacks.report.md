# T14 — Register declared sizing fallbacks before the first measure: report

**Branch:** `task/T14-early-fallbacks` (from `main` at `19025b1`) · **Devices:** iPhone 17
`F08675D3-A32B-4F88-BC81-02D7E0CB797E`, AVD `nitroui_t01` (adb server 5041, `emulator-5570`), Metro 8293
(D13) · **Platforms:** both.

## Summary

`NitroUiSizing::setFallback` was called by a component's first Hybrid View, in `init`. Fabric measures a
shadow node before it creates the view, so that declaration arrived one measure too late for exactly the
instance that needs it: the first one. `NitroUiSizingEngine::measure` answers cache → state → guesses →
fallbacks, and there is no engine default size, so "no fallback yet" is not a guess — it is **no size at
all**, `NitroUiMeasuredSize{}`, i.e. `0 × 0` (`cpp/NitroUiSizingEngine.cpp`).

Both platforms now register the table before anything can be measured:

| Platform | Where | When |
| --- | --- | --- |
| iOS | `ios/core/NitroUiDeclaredFallbacks.swift` + `ios/core/NitroUiDeclaredFallbacksLoader.m` | `+load`, before `main()` |
| Android | `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt`, called from `NitroUiPackage`'s companion `init` | after `initializeNative()` (a fallback is a JNI call), before the package hands Fabric a view manager |

The numbers stay in the components — the only place that knows what each one hosts and which OS's control
size applies (D14): `HybridNitroUiSwitch.declareFallback()` / `HybridNitroUiSlider.declareFallback()` and
their Kotlin twins, each once per process (a lazy Swift static / an `AtomicBoolean.compareAndSet`, because
the two callers are different threads). `init` still calls `declareFallback()` as the backstop, so a
component missing from the table costs a stale first frame rather than a broken layout. No JS-visible API
change (`api-extractor:check` agrees), and `nitro-ui.sizing.json` is unchanged; the published-files list
gained the two new native files and, through the trap described in Gate results, lost one line that
`1f6d0d8` puts back.

**Why the startup table and not the brief's `nextSizingId()` hook.** `nextSizingId()` lives in the shared
C++ core (`cpp/HybridNitroUiCore.cpp`), and the numbers are platform-specific, so hooking it needs a
C++ → platform upcall that does not exist: on iOS an `@_cdecl` symbol *and* on Android a JNI call with
`JNIEnv` acquisition from a C++ thread. The table needs no new seam — both platforms already have an earlier
native hook that runs before React starts, and the generated component files use the same iOS one
(`nitrogen/generated/ios/c++/views/HybridNitroUiSwitchComponent.mm`'s `+load` registers the component
class).
Fewer moving parts, and it is strictly earlier than the first render.

## The bug, measured red on `main`

`bun run harness:cold:ios` / `:android` (this task's new suite, alone in the process).

| Case | First frame on `main` | Assertion |
| --- | --- | --- |
| first Slider ever, iOS | height **0** | `expected 0 to be greater than 0` at `expect(laidOut[0]!.height).toBeGreaterThan(0)` (`example/__tests__/ColdSizing.harness.tsx:305`) |
| first Switch ever, iOS | **`0.00x0.00`** | `expected 0 to be greater than 0` at `expect(laidOut[0]!.width).toBeGreaterThan(0)` (`…harness.tsx:408`) |
| first Slider ever, Android | height **0** | same assertion |
| first Switch ever, Android | width **0** | same assertion |

The two `main` runs ran a revision of that file before its last comment-only edits, so their logs
(`/tmp/t14-harness-main3.log`, `/tmp/t14-harness-adroid-main.log`) quote the same two assertions at `:288`
and `:382`; the line numbers above are HEAD's.

The trace event for the Switch on `main` shows the whole story in one line, including that the correction is
what eventually makes the box right — a frame later (D17's allowance, which is the point of the fix):

```
t14 cold switch: id=93 firstLaidOut=0.00x0.00 declared=61x28 box=61.00x28.00
  events=["laidOut:93:0.0x0.0","corrected:93:61.0x28.0","drew:93:61.0x28.0"]
```

The same file on the same `main` binary also showed the *warm* contrast, which is why the suite's own
coldness has to be asserted: the Slider's suite had been allowed to run first, so its fallback was already
registered by that suite's first view and its cold case read `402x31` — passing on the bug.

## The fix, measured green

The suite with the fix, in a process nothing has measured in (`t14 COLD process: measurements=0`, so the
first instance of each really is instance 1 and instance 3):

```
iOS — /tmp/t14-harness-ios12.log
  cold slider: firstLaidOut=351.00x31.00 declaredHeight=31 box=402.00x31.00 measured=402.00x31.00
    events=["laidOut:1:351.0x31.0","drew:1:402.0x31.0"]
  cold switch: firstLaidOut=61.00x28.00 declared=61x28 box=61.00x28.00
    events=["laidOut:3:61.0x28.0","drew:3:61.0x28.0"]

Android — /tmp/t14-f2-android-coldprint.log
  cold slider: firstLaidOut=328.00x48.00 declaredHeight=48 box=411.43x48.00 measured=411.43x48.00
    events=["laidOut:1:328.0x48.0","drew:1:411.4x48.0"]
  cold switch: firstLaidOut=52.00x48.00 declared=52x48 box=52.19x48.00
    events=["laidOut:3:52.0x48.0","drew:3:52.2x48.0"]
```

Both blocks are from runs that put the suite next to a throwaway file and carried a deliberate
`expect(1).toBe(0)`, because the harness prints a suite's `console.log` only when that suite fails
(Follow-ups) — so a green cold invocation shows only its pass counts, which are in Gate results. What the
assertions are worth is shown by the red `main` runs above, not by these.

- The first `fillWidth` frame is the *declared* box on both platforms: the control's real height (`31` pt /
  `48` dp) with the declared width, which Yoga replaces with the caller's width on the way to screen
  (`351 → 402`, `328 → 411.43`). No `0`-tall frame, and nothing to correct about the height.
- The first `intrinsic` frame is the declared box, which *is* the control, and neither trace has a
  `corrected` stage at all: a correctly declared fallback now costs **zero** Fabric state updates, where
  `main` needed one push per configuration. Android's `52` laid out against a measured `52.19` is a
  confirmation, not a correction (`reportsConfirmed`, not `corrections`).
- The poisoned twins still land on both platforms (`100 × 13` → `corrected 402.0x31.0` /
  `corrected 411.4x48.0`, `40.0x20.0` → `corrected 61.0x28.0` / `corrected 52.2x48.0`), so `setFallback`'s
  semantics are unchanged: declared is provisional until a report outranks it (D16), it survives
  environment bumps, and a wrong declaration is still corrected.

| Invocation | `main` native | with the fix |
| --- | --- | --- |
| iOS `harness:cold:ios` | 2 failed / 4 | **4 passed** |
| iOS full suite | — | 57 passed / 58 (one pre-existing red, below) |
| Android `harness:cold:android` | 2 failed / 4 | **4 passed** |
| Android full suite | — | **58 passed / 58** |

## The cold test, and what it can honestly claim

`example/__tests__/ColdSizing.harness.tsx` — four tests: cold Slider, poisoned Slider, cold Switch, poisoned
Switch. The oracle is the instance's first `laidOut` event, because that event *is* the size the first
measure answered with; `nuiSizingId` is read through a local handle type so D14 keeps it off the exported
handle types. Nothing is seeded in the cold tests, because `seedSizingSize` writes the declared fallback —
the thing under test.

A declared fallback is process-global and outlives `resetEnvironmentBetweenTestFiles: 'runtime'`, so
"the first instance ever" cannot be manufactured once a component has had a view. Two things learned the
hard way while writing this:

- **jest does not run this file first** (it sequences the largest file first, `Slider.harness.tsx`), and
  `--runTestsByPath` does not change that — measured: `measurements=3420` by the time the suite ran. So the
  suite *checks* the condition instead of assuming it: the engine's cumulative `measurements` counter is
  `0` only in a process nothing has measured in (the harness does not mount the example app's screens —
  that was checked too, and the app's own testIDs are not reachable through `HarnessUI.queryByTestId`).
- In a cold process the two cold tests assert the full claim (first frame **at the declared size**). In a
  whole-suite run they log `NOT COLD`, drop to the weaker claim that still holds there (the first frame is
  *some* size, never 0) and the two poisoned tests keep asserting the correction. `harness:cold:ios` /
  `harness:cold:android` are the discriminating invocation, and are what the red/green table above cites.

## Proposed D17 wording (orchestrator edits DECISIONS.md)

Only the parenthetical changes today-ness. Replace:

> (today: height 0 for a cold first `fillWidth` instance, until T14 registers fallbacks before the first measure)

with:

> (registered at startup — `NitroUiDeclaredFallbacks`, T14 — so what that frame shows is the component's
> declared size and never 0: a cold first `fillWidth` instance gets its real height with the declared width,
> a cold first `intrinsic` instance its declared box, which on both platforms today *is* the control, so a
> correctly declared fallback costs 0 corrections)

Full bullet as it would read:

> **D17 (T11 round 2, amended by T14)** Sizing frame budget, both platforms: the **first instance of a
> sizing configuration per environment epoch** (no exact cache entry yet) may show the declared fallback
> (registered at startup — `NitroUiDeclaredFallbacks`, T14 — so what that frame shows is the component's
> declared size and never 0: a cold first `fillWidth` instance gets its real height with the declared width,
> a cold first `intrinsic` instance its declared box, which on both platforms today *is* the control, so a
> correctly declared fallback costs 0 corrections) for one frame before its correction lands; every instance
> whose configuration is already exact in the cache must lay out exact on its first frame (0 stale). …
> (unchanged from here: the immediate-per-flush budgets, the gated/not-gated lists, no budget increase, no
> "hide until measured", fallbacks accurate per OS (D14), `prewarm` recommended, harness tests assert the
> rule with poisoned fallbacks)

`docs/architecture/sizing.md` §5 carries the rule, §6's trap paragraph, `docs/components/slider.md`'s
zero-height invariant and `docs/architecture/core.md` §7 + the §9 checklist (one line per component in the
startup table) all said "the fallback is registered by its first *view*", which is now the backstop rather
than the mechanism; those sentences are corrected.

## `Slider › ignores a drag while disabled` is red on iOS on `main`

Not T14, and it blocks "harness green on both platforms" for anyone running iOS. Proof: with `main`'s own
native files checked out and the same `Slider.harness.tsx`, the suite run **alone** fails
`expected '#1 performed accessibilityIncrement on NitroUiSliderAccessibilityElement[4096] 0.0->3.0' to
contain 'disabled=true'`; the fix build fails it identically, and Android passes it. The iOS probe prints
traits as a number (`nitroUiDescribeAccessibilityNode`, `ios/components/Slider/HybridNitroUiSlider.swift:511`),
so `disabled=true` is Android-only text and the assertion cannot pass there — `381b1f2` verified it on
TalkBack. Two things for whoever owns that test: gate it by platform or teach the iOS probe the flag, and
the traits reported were `4096` (`.adjustable`, no `.notEnabled`), so the iOS half of that announcement may
deserve a look of its own.

The timeline explains why it merged: the assertion landed in `381b1f2` at 12:19, and G1's last iOS harness
run finished at 11:36 with 54/54 (`/tmp/g1-ios-harness-final3.log`). Every iOS harness run of `main` since
has been 57/58 for this one test; T14 changes neither the probe nor the assertion.

## The Modal flake (one attempt, per D19)

Reproduced once on Android, and its cause is not T14's.

`Sizing › sizes a control inside a Modal` failed in `bun --cwd example harness:android Sizing` (a pattern
that matches `Sizing.harness.tsx` *and* this task's `ColdSizing.harness.tsx`;
`/tmp/t14-f2-android-sizing.log`), one stage short in its own trace:

```
expected [ 'laidOut', 'drew' ] to deeply equal ArrayContaining ["laidOut", "corrected"]
modal: content=52.19x48.00 trace=["laidOut:511:40.0x20.0","drew:511:40.0x20.2"]
       d={"corrections":0,…,"flushes":0,"queued":1,"measurements":1,"confirmed":0,"epoch":11}
```

The dialog's Switch laid out from the seeded `40 × 20`, **drew** it, and its report was queued with no
flush in the window the test collects. So it is FOLLOWUPS's `corrections=0`, caught one assertion earlier:
the correction never arrived *in time*, not never. Two things it says that are worth more than the flake —
RN's Modal is a second window, and on that surface Android's pre-draw cancellation did not suppress the
stale frame (`docs/architecture/sizing.md` §3 says it does), and a `queued` correction is waiting for a
commit this test never performs.

T14 does not move the cause: the guess that control mounted from is the one the test seeds, so the
startup table's number was never consulted, and the file's own change here is the *evidence rule* in
`lays a cold Switch out at the size the control measures`, which now counts corrections for its own
instance rather than the process's. Per D19 that is the one attempt: two repeats of the same invocation
(`…-2f-1/2.log`), one run of `Sizing.harness.tsx` alone (`…-sizing-only.log`, 18/18) and two whole-suite
Android runs all passed, so it is a low-rate race and it is routed below rather than chased.

## Gate results

- `bun run check`: **green**, on the committed tree (`/tmp/t14-f2-check.log`, `CHECK_EXIT=0`, ending
  `package-files: tarball matches … (205 files)`). Its first attempt failed only the last step:
  `lib/typescript/src/tsdoc-metadata.json` is written by `api-extractor`, which runs *after* `prepare` in
  `bun run check`, while `bob build` cleans `lib/typescript` — so a `manifest:update` run outside a full
  `check` regenerates the list without it and the check that follows can never match it. `1f6d0d8` puts the
  line back; the trap is that the two scripts only agree about the tree when `check` is what runs them.
- Harness, on the committed tree, on this task's devices only (iPhone 17 `F08675D3…`, `nitroui_t01` on adb
  server 5041 / `emulator-5570`, Metro 8293), each shut down afterwards, G2's iPhone Air / `nitroui_t02`
  and `emulator-5560` untouched:
  - iOS — `harness:ios` **57 passed / 58** (`/tmp/t14-f2-ios-full.log`), the one red being the pre-existing
    `Slider › ignores a drag while disabled` above; `harness:cold:ios` **4 passed / 4**
    (`/tmp/t14-f2-ios-cold.log`).
  - Android — `harness:android` **58 passed / 58** (`/tmp/t14-f2-android-full.log`);
    `harness:cold:android` **4 passed / 4** (`/tmp/t14-f2-android-cold.log`).
  - On `main`, `harness:cold:ios` / `:android` are **2 failed / 4** on both platforms (the red table).
- So "harness green on both platforms" is met by T14 and not by `main`: the one red is G1's iOS assertion,
  and it is theirs to fix.
- No bench run (correctness fix; the harness frame evidence above is the evidence).
- Two edits landed after the device runs and change no behaviour: this file, and one comment line in
  `ios/core/NitroUiDeclaredFallbacksLoader.m` whose `nitrogen/generated/...` reference named a line that
  moved.

## Files changed

| File | What |
| --- | --- |
| `ios/core/NitroUiDeclaredFallbacks.swift`, `…Loader.m` | new: the iOS startup table and its `+load` trigger |
| `android/.../core/NitroUiDeclaredFallbacks.kt`, `NitroUiPackage.kt` | new table + the static-init call after `initializeNative()` |
| `ios/components/{Switch,Slider}/HybridNitroUi*.swift`, `android/.../HybridNitroUi*.kt` | `declareFallback()` becomes the once-per-process entry point the table calls; `init` keeps it as the backstop |
| `example/__tests__/ColdSizing.harness.tsx` | new suite (4 tests) |
| `package.json`, `example/package.json` | `harness:cold:ios` / `harness:cold:android` |
| `example/__tests__/Sizing.harness.tsx` | the cold Switch's correction is asserted on its own instance's trace, not the process's counters |
| `example/__tests__/Slider.harness.tsx` | the zero-height test's premise comment, which named the cold-mount case T14 removes |
| `docs/architecture/sizing.md`, `docs/architecture/core.md`, `docs/components/slider.md` | the claims listed above |
| `etc/package-files.txt` | `manifest:update` for the two new native files |
| `docs/tasks/T14-early-fallbacks.report.md` | this report |

## Follow-ups

- The iOS half of `Slider › ignores a drag while disabled` (above) — route to G1's owner.
- The Android Modal flake (above): on RN's second surface a stale first frame *is* drawn, and the
  correction that follows it sits `queued` until some later commit pumps it. Both halves contradict
  `docs/architecture/sizing.md` §3 as written for normal hosts, and the test's oracle
  (`collectTrace(hasDrawnSample, …)` stops at the first drawn sample) is on the wrong side of that race.
  Worth its own task, with the log line above.
- `react-native-harness` prints a suite's `console.log` only when **that suite fails** — measured: the iOS
  whole-suite run has a red `Slider` suite and prints none of the green `ColdSizing` suite's lines, and a
  green single-file run prints nothing either. A task that wants frame evidence out of a green run has to
  fail it on purpose, as this report did twice.
- If a task ever wants every harness file in a fresh process, `resetEnvironmentBetweenTestFiles: 'process'`
  exists upstream and would also retire the shared-global-state flake class this file and `Sizing.harness.tsx`
  both work around — a config decision, not a T14 one.

## Commits

| Commit | What |
| --- | --- |
| `d5699ad` | the fix — `NitroUiDeclaredFallbacks` on both platforms, `declareFallback()` as the shared entry point |
| `1f6d0d8` | the published-files line the fix commit lost (gate failure, above) |
| `93ac0dc` | `ColdSizing.harness.tsx`, the two `harness:cold:*` scripts, and the cold Switch's per-instance evidence rule |
| `fb3f1c5` | `sizing.md`, `core.md`, `slider.md` |
| `9d2f63c` | the one stale line reference in `…Loader.m`'s comment |
| this report's commit | this file |
