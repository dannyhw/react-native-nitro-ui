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
- In a cold process the two cold tests assert the full claim (first frame **at the declared size**). Coldness
  is therefore captured once — in the first cold test, before anything in this file has mounted — and both
  cold tests use that one value: `measurements` is a process-wide running total that never resets, so a
  re-read in the third test had already counted this file's own two Slider mounts and the Switch test's
  declared-size assertion could never run (review; fixed in fix round 1, which also re-ran both
  `harness:cold:*`). In a whole-suite run the captured value is false, the log says `NOT COLD`, the two
  cold tests drop to the weaker claim that still holds there (the first frame is *some* size, never 0) and
  the two poisoned tests keep asserting the correction. `harness:cold:ios` / `harness:cold:android` are the
  discriminating invocation, and are what the red/green table above cites.

## Proposed D17 wording (orchestrator edits DECISIONS.md)

Only the parenthetical changes today-ness. Replace:

> (today: height 0 for a cold first `fillWidth` instance, until T14 registers fallbacks before the first measure)

with:

> (registered at startup — `NitroUiDeclaredFallbacks`, T14 — so what that frame shows is the component's
> declared size and never 0: a cold first `fillWidth` instance gets its real height with the declared width,
> a cold first `intrinsic` instance its declared box, which on both platforms today *is* the control — the
> one exception being an iOS 26+ app that sets `UIDesignRequiresCompatibility`, which gets the declared
> 61×28 laid over its 51×31 control and pays one correction (`docs/architecture/sizing.md` §8) — so a
> correctly declared fallback costs 0 corrections)

Full bullet as it would read:

> **D17 (T11 round 2, amended by T14)** Sizing frame budget, both platforms: the **first instance of a
> sizing configuration per environment epoch** (no exact cache entry yet) may show the declared fallback
> (registered at startup — `NitroUiDeclaredFallbacks`, T14 — so what that frame shows is the component's
> declared size and never 0: a cold first `fillWidth` instance gets its real height with the declared width,
> a cold first `intrinsic` instance its declared box, which on both platforms today *is* the control — the
> one exception being an iOS 26+ app that sets `UIDesignRequiresCompatibility`, which gets the declared
> 61×28 laid over its 51×31 control and pays one correction (`docs/architecture/sizing.md` §8) — so a
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
the correction never arrived *in time*, not never. What the trace shows, precisely (review; the first
wording here over-claimed a cause): the first-frame watcher records `drew` only when the engine has no
report queued, so at the frame that drew there was nothing queued for a pre-draw cancellation to cancel —
the report arrived *after* that draw, and nothing in the dialog's window requested another one. An
idle second window plus a late report is all that is observed; the cause of the lateness was not chased
(D19). Fixed in fix round 1 from the other side: `scheduleSizingFlush` now requests the draw its flush
listener needs (`postInvalidateOnAnimation()` on the host, whose observer is the window the correction has
to reach), and the test waits for its own instance's `corrected` so unrelated activity cannot carry it
green. The request itself is pinned by `scripts/check-sizing-flush-draw-request.sh`, which is the only
check that goes red on demand — the measured reason is in "Fix round 1" below.

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
- What landed after the device runs changes no behaviour: the extra cold-evidence run above, this file, one
  comment line in `ios/core/NitroUiDeclaredFallbacksLoader.m` whose `nitrogen/generated/...` reference named
  a line that moved (`9d2f63c`, after which `bun run check` is green — `/tmp/t14-f3-check-final.log`), and
  the `STATUS.md` / `FOLLOWUPS.md` lines, which are markdown: `prettier --check .` is the only step of the
  gate that reads them.

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
- The Android Modal stuck report (above): fixed in fix round 1 — the host requests a draw when it queues a
  flush, the test waits for its own instance's `corrected`, and `scripts/check-sizing-flush-draw-request.sh`
  guards the request. Not chased (deliberately): why Compose's first report can land after a settled
  dialog's last draw at all.
- Re-laying out an *already mounted* control at a wrong guess produces no report on Android at all
  (measured in fix round 1: `marginTop: 0` → `1` on a mounted dialog Switch moved its box to the seeded
  `40 × 20` — `laidOut:2:40.0x20.0`, ledger inexact — and Compose never re-measured, so nothing was
  queued and the control stayed clipped at the guess until something recomposed it). `sizing.md`'s claim
  that an environment bump means "every mounted instance is asked to measure again" is therefore
  prospective on Android: nothing asks, and a configuration change that only moves the box relies on the
  composition re-measuring to notice. Worth a task of its own (it is the same seam as the two
  `nuiTestWidth`-based tests, which change the content and so do recompose).
- `Sizing.harness.tsx`'s per-instance cold check waits with `collectTrace(hasDrawnSample)`, which stops at
  *any* instance's `drew` — it could stop before this instance's `corrected` and become the next flake
  (review).
- `docs/architecture/core.md:295` cites `HybridNitroUiSwitch.swift:104-113`; the code is now at `:131-136`
  (already stale on `main`, found by the review).
- The iOS Switch fallback could read `Bundle.main`'s `UIDesignRequiresCompatibility` at `+load` and declare
  51×31 for those apps instead of 61×28 (`HybridNitroUiSwitch.swift:131-136`; the D17 exception above).
- Nothing runs the new `+load` under `use_frameworks!` (dynamic or static) or an Expo prebuild; reasoned
  safe in the review, `smoke:expo` would confirm it.
- The startup cost of loading the `HybridNitroUi*` Kotlin classes from `NitroUiPackage.<clinit>` was not
  measured (expected negligible; review).
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

## Fix round 1

Verdict: merge-after-small-fixes, three items. All three are in; one of them needed a different kind of
check than the review assumed, and that is measured below rather than argued.

### 1. The cold tests read their own coldness after it had gone

`measurements` is a process-wide total that never goes down, and the first cold test measures a control, so
the `coldProcessStats()` each cold test called was reporting how much of this file had already run. The
declared-size assertion in `lays a cold Switch out at the size the control measures` therefore had never
run anywhere — not on this branch, not on `main`, and not in either `harness:cold:*` run. The header's
ordering contract and the note under it said otherwise; both now say what is measured. The witness is
captured once, on the first call, which the first cold test makes before anything here mounts
(`coldOnEntry`, `ColdSizing.harness.tsx:170-181`), and both cold tests assert against that one value
(`:330`, `:430`). Verified that the branch is now *taken* rather than skipped: with a `throw` inside it,
`harness:cold:android` reports `laidOut=52x48` against a declared `52x48` and `harness:cold:ios` reports
`61x28` against `61x28` — the declared-size assertion runs, and on a cold process the first frame really is
the declared box.

The same file's review note: it restored the Slider's declared fallback with Android's width on both
platforms. iOS declares 351 (D14), so every test after the poisoning one ran against `328 × 48` on iOS.
`SLIDER_FALLBACK` is a `Platform.select` now (`:121-125`), so poison and restore agree per platform.

### 2. Android's flush asked to be consulted, not for the draw

`scheduleSizingFlush` registers a `ViewTreeObserver.OnPreDrawListener` — a request to be consulted at the
next draw, not a request for one — so a report arriving after a quiet window's last draw waited for an
unrelated redraw. It now requests the traversal too (`NitroComposeHost.kt:503-540`).

Why `postInvalidateOnAnimation()` is the cheapest correct request:

- It has to come from this host: a `Modal` host's `ViewTreeObserver` is the dialog's, so anything rooted in
  the main window (`decorView`, the content view) would wake the window that is not waiting.
- It is vsync-aligned and coalesces with any invalidation already pending, and when the flush does apply a
  correction it returns `false` from `onPreDraw` — so the frame it asked for is the one that gets skipped.
  The common case (a report inside a live frame) costs nothing at all.
- `requestLayout()` also traverses, but re-measures the native subtree for a size that same traversal is
  about to correct; a bare `postOnAnimation { }` block runs without scheduling a traversal, so it does not
  guarantee the listener is ever reached.

### 3. The Modal test, and the red that could not be forced

The test has two phases now (`Sizing.harness.tsx:829`), both judged on this instance's own trace events:

| Phase | What it does | Measured on `nitroui_t01` |
| --- | --- | --- |
| cold mount in the dialog | poisoned `40 × 20` guess, control mounted into a presenting dialog | `laidOut 40.0x20.0` → `drew 40.0x20.2` → `corrected 52.2x48.0`; 1 correction, 1 flush, 1 changed flush |
| size that arrives late | the same control asked for a genuinely different size (`nuiTestWidth`) after the dialog has presented, drawn and gone quiet — no presenting draw left to carry a correction | `laidOut 40.0x20.0` → `corrected 100.2x48.0`; 1 correction, 1 flush |

`/tmp/T14r1-logcat-final.log`; three green runs on Android in `/tmp/T14r1-modal-fix3-r1.log` … `-r3.log`, and
green inside the iOS whole-suite run.

**What it does not do is go red without the fix, and no version of it can.** The host was instrumented
(`Log` in `onMeasure`, `measureNow`, `reportToSizingEngine` and both pre-draw listeners) and four
arrangements were run against a build with `postInvalidateOnAnimation()` commented out: the committed
fresh-dialog mount; a dialog presented and settled 1.5 s before the control mounts into it; that again with
the control inside an invisible wrapper; and a mounted control asked for a new size once the dialog had
settled. Nine runs, nine passes (`/tmp/T14r1-modal-nofix-r1..6.log`, `/tmp/T14r1-modal-nofix-run1..3.log`).
The instrumented reason: a report is only ever produced by a measure — Compose's `Layout` block is the only
caller of `reportToSizingEngine` — so a report always arrives *inside* a traversal, and an RN dialog always
has at least one more after it (report at `t`; dialog traversals at `t+4 ms` and `t+11 ms`). The stuck run
of round 0 (`queued=1, flushes=0`) is the rare ordering in which the composition's invalidations and
Fabric's layout pass collapse into a single traversal; nothing arrangeable from JS reproduced it. The oracle
was still tightened, so a lost correction now fails this test instead of riding along on someone else's
redraw — but the honest check for the mechanism is static, and the repo already has the pattern (review B1's
`scripts/check-sizing-capture.sh`): `scripts/check-sizing-flush-draw-request.sh`, run by `bun run check` as
`── sizing flush requests its draw`. Red on 3 runs out of 3 with the request removed, green with it, and it
explains itself when it fires.

### 4. Docs

- The Modal cause, in this report and in `docs/tasks/FOLLOWUPS.md`, is now what the trace shows — the
  first-frame watcher records `drew` only when no report is queued, so the report arrived after that
  window's last draw — plus the fix, named as `postInvalidateOnAnimation()`. `invalidate()` appeared in
  prose written before the code settled; the code always said this.
- The proposed D17 wording above carries the exception `docs/architecture/sizing.md:438` records: an iOS 26+
  app that sets `UIDesignRequiresCompatibility` really is `51 × 31`, which is why the declared `61 × 28` is
  a declared number and not an answer.
- One new follow-up, from the instrumentation: re-laying out an *already mounted* control at a wrong guess
  produces no report on Android at all, so `sizing.md`'s "asked to measure again" is prospective there. In
  Follow-ups, unfixed (D19).

### Gates, fix round 1

| Gate | Result |
| --- | --- |
| `bun run check` | green on the committed tree (`/tmp/T14r1-check.log`, `/tmp/T14r1-check-final.log` after the doc commits), new guard line included, ending `package-files: tarball matches … (205 files)` |
| `harness:ios` | 58 / 58 (`/tmp/T14r1-ios-suite.log`) — round 0's lone red, `Slider › ignores a drag while disabled`, is green since FIX1 |
| `harness:android` | 58 / 58 (`/tmp/T14r1-android-suite.log`) |
| `harness:cold:ios` | 4 / 4 (`/tmp/T14r1-ios-cold.log`) |
| `harness:cold:android` | 4 / 4 (`/tmp/T14r1-android-cold.log`) |
| Modal test | 3 / 3 Android; green in the iOS suite; its guard red 3 / 3 without the fix |
| Devices | iPhone 17 `F08675D3…`, `nitroui_t01` (adb server 5041, `emulator-5570`), Metro 8293; G2's iPhone Air / `nitroui_t02` and `emulator-5560` untouched; both devices shut down afterwards |

### Commits, fix round 1

| Commit | What |
| --- | --- |
| `b173065` | the review, committed as the round started |
| `25a1e60` | `main` merged in: FIX1's iOS Slider a11y probe (which retires round 0's iOS red) and its doc updates |
| `b016aa4` | coldness captured once, and `SLIDER_FALLBACK` per platform |
| `eb90728` | the flush's draw request, and the Modal test's per-instance oracle |
| `8042f24` | the Modal cause reworded, the D17 exception, the review's other follow-ups as lines |
| `0dbb4ad` | `scripts/check-sizing-flush-draw-request.sh`, wired into `test:native` |
| `2ca01e3` | the Modal test's two phases, with the measured determinism note |
| this section's commit | this section, and the two places that said `invalidate()` |
