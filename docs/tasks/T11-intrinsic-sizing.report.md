# T11 — Report

Branch `task/T11-intrinsic-sizing`, from `main` (T01 + T03 + T10). Rebased onto `main`
after the orchestrator's doc commits (`2c76050`, `9484a30`), so the branch's diff is
only T11 work.

**Status: P0 PASSED, and P1 PASSED on both platforms — see `# P1 — correctness` below.
No Plan B was needed: no exit criterion failed, so no silent switch happened.**

## P0 summary

A control's size is now decided by the control, not by a hardcoded style:

1. the native host measures what it hosts on the main/UI thread and **reports** the
   size into a C++ cache (`NitroUiSizing.report`);
2. Yoga asks the shadow node for a size (`measureContent`), which is a **pure C++
   lookup** — cache → Fabric state → per-component fallback. It never calls into
   SwiftUI/Compose, and never blocks (`core-architecture.md` §1.4);
3. when a report disagrees with what an instance was laid out with, the engine pushes
   a new Fabric `State` carrying the measured size. Reports are batched and applied at
   the end of the run loop / before draw, so a mount normally costs **zero** extra
   commits and a cache miss costs **one**.

Built:

- **Engine** — `cpp/NitroUiSizingEngine.{hpp,cpp}` (439 + 226 lines): size cache keyed
  by `hash(component, sizingKey, environmentEpoch)`, per-component fallback map, a
  layout ledger (what each instance last laid out with, and whether that was exact),
  an instance registry (id → weak `State` + typed push fn), and the pending-report
  queue with the per-turn immediate budget (2) and 0.5pt/dp epsilon. `measure()` is
  the only layout-thread entry point and is lock + hash map only.
- **Shadow-node layer** — `cpp/NitroUiIntrinsic.hpp` (374 lines):
  `NitroUiIntrinsicProps` (the `nuiSizingKey`/`nuiSizingId` pair),
  `NitroUiIntrinsicViewState` (measured size + flags, goes in the `State`),
  `NitroUiIntrinsicShadowNode` (`LeafYogaNode` + `MeasurableYogaNode`),
  `NitroUiIntrinsicComponentDescriptor` (keeps Nitro's prop parsing; Android `adopt`
  carries the measured size forward).
- **Platform primitive surface** — `cpp/core/NitroUiSizing.hpp` (73 lines, no RN
  headers, so Swift's C++ interop can parse it): `report`, `flush`,
  `invalidateEnvironment`, `setFallback`, `cachedSizeCount`.
- **Nitrogen post-processing** — `scripts/patch-nitrogen.mjs` grew the three alias
  swaps (`.mm`/`.kt` state, shadow node, component descriptor), the `.mm`
  `updateState:oldState:` hook and the Kotlin manager `onState` bind, driven by
  `nitro-ui.sizing.json` (`{"HybridNitroUiSwitch": "intrinsic"}`). Hard-fails on a
  missing anchor or an unknown policy, idempotent, one script as required.
- **iOS** — `ios/core/NitroSwiftUIHost.swift`: hosts report from
  `refreshContentSize()`; the engine installs a `kCFRunLoopBeforeWaiting` observer
  (order 1e6, i.e. below CA's commit observer) on the first report, so flushes land
  before the frame is committed and no Swift-side flusher is needed.
- **Android** — `android/src/main/cpp/NitroUiSizingJni.cpp` +
  `core/NitroUiSizing.kt`: StateWrapper unwrap, flush from an `OnPreDrawListener` that
  returns `!flush()` (skips the stale frame), dp units. `onConfigurationChanged`
  clears the reported size and bumps the environment epoch.
- **Switch** — declares its fallback (iOS 61×28 on 26+, 51×31 earlier, Android 52×48)
  and passes a constant `nuiSizingKey`; T10's hardcoded default-size style is gone.

## P0 gates (exact commands, after the rebase)

| Command | Result |
| --- | --- |
| `bun run typecheck` | PASS (exit 0) |
| `bun run lint` | PASS (exit 0) |
| `bun run format` | PASS — "All matched files use Prettier code style!" |
| `bun run test` | PASS — 7 suites, 80 tests (incl. 17 patch-nitrogen tests, 7 of them new sizing ones) |
| `bun run test:native` | PASS — `sizing.test.cpp: 47 checks passed`, handshake green |
| `bun run nitrogen:check` | PASS — "no drift (51 generated files match, 4 view(s) patched)" |
| iOS `xcodebuild … -sdk iphonesimulator` | ** BUILD SUCCEEDED ** |
| Android `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` | ** BUILD SUCCESSFUL ** |

Patch idempotency and hard-fail are covered by tests rather than by hand:
`scripts/__tests__/patch-nitrogen.test.js` → *repoints the state, shadow node and
component descriptor aliases*, *teaches the generated iOS component view about Fabric
state*, *binds the generated Android manager to the sizing engine*, *is idempotent on
all three files*, *fails when nitrogen stops using the shadow node template*, *fails
when the config lists a view that is not generated*, *fails on a policy it does not
know*, *leaves sized-looking views alone without the config*.

## P0 on-device evidence

Both runs use the T03/T10 harness suite `example/__tests__/Switch.harness.tsx`
(15 assertions-worth of tests, 15 `it`s incl. the Modal and many-instance cases).

- **iOS** (iPhone 17 sim `F08675D3…`, iOS 27, Metro 8293):
  `Tests: 15 passed, 15 total` — `/tmp/t11-harness-ios3.log`, exit 0, 9.7s.
- **Android** (AVD `nitroui_t01`, port 5570, API 35, `ANDROID_ADB_SERVER_PORT=5041`):
  `Tests: 15 passed, 15 total` — `/tmp/t11-harness-android.log`, exit 0, 26.4s.
  The suite's "reports the size of what it hosts" and "reports the control size and
  not the box when the box is bigger" both pass with the box coming from the measured
  size rather than a style.

Invocation (kept here because it is not obvious — the harness needs a prebuilt app):

```sh
cd example && HARNESS_APP_PATH="$(pwd)/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app" \
  IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8293 \
  bunx react-native-harness --harnessRunner ios
# android: HARNESS_APP_PATH=…/app-debug.apk ANDROID_AVD=nitroui_t01 METRO_PORT=8293 --harnessRunner android
```

## The two bugs P0 caught (these are the real value of the gate)

**1. Deadlock: pushing Fabric state while holding the engine lock.** The first harness
run on iOS died with `app heartbeat timed out` / "The app bridge stopped responding"
and zero tests (`/tmp/t11-harness-ios.log`). `applyReports` called the component's
push (Fabric `updateState`) *inside* the engine's non-recursive `std::shared_mutex`.
A same-thread re-entrant lock is a hang: pushing state schedules a commit, whose
layout calls `measureContent` → `measure()` → the same mutex on the same thread.
Fix (`02641c6`): collect the work under the lock into
`struct Pending { push, state, measured, immediate }`, unlock, then push. Rule now
written into the code: *the engine lock is never held across a call into Fabric.*
This is exactly the class of bug the plan's "never block a thread on another" rule
warns about, and no JS-side test could have found it.

**2. Yoga stretch swallowed the measured size.** Second run: 14/15 passed, one failure
`expected 341 to be less than 0.6` (`/tmp/t11-harness-ios2.log`) — a Switch laid out
402pt wide (full screen width) with a 61pt control inside it. Cause: the harness'
column container has `alignItems: stretch`, and Yoga hands a stretched child the row's
width as an **exact** constraint, so `measureContent` is never consulted. Fix
(`cac5f05`): a base style `alignSelf: 'flex-start'` on the native view, applied *before*
the caller's style, so an explicit `width`/`flex`/`alignSelf` still wins. React
Native's own `Switch.js` does the same thing for the same reason. Worth a line in
`sizing.md`: any self-sizing control needs it, or it must be documented that a
stretched parent resizes it.

Smaller fixes in the same commits: `react/renderer/graphics/Size.h` (not
`core/Size.h`); `using namespace facebook;` inside
`namespace margelo::nitro::nitroui` in `NitroUiIntrinsic.hpp`; and
`NitroUiStateRef = std::shared_ptr<const void>` — the `const` is required because a
`shared_ptr<const State>` → `shared_ptr<void>` cast is illegal in C++.

## P0 commits

| SHA | Subject |
| --- | --- |
| `aac097f` | feat(core): add the intrinsic-sizing engine |
| `c7dbccf` | feat(core): post-process nitrogen for intrinsic sizing |
| `fe51137` | feat(core): let a component declare its cache-miss size |
| `4d80727` | feat(core): bridge the sizing engine on Android |
| `429ddd0` | feat(core): size controls from what native measured |
| `02641c6` | fix(core): issue size corrections outside the engine lock |
| `cac5f05` | fix(switch): stop the box from being stretched |

53 files, +4043/−96.

## Risk status after P0

| Risk | Status |
| --- | --- |
| R1 nitrogen coupling | **Open but mitigated.** Patch applies to nitro 0.37.1 and both platforms build with it; `nitrogen:check` re-runs it on every check and the tests assert it hard-fails when the shape changes. Upstream issue still owed (`§1.5`) — see `docs/upstream.md`. |
| R2 same-turn commits | **Untested → P1.** Needs frame evidence and commit counts. |
| R3 `sizeThatFits` before the view is in a window | **Partly answered.** Cold mount measures correctly on both platforms (iOS measures off-window through `UIHostingController.sizeThatFits`; Android through `NitroUiMeasuredRoot`), so the mechanism works; P1 must show no wrong-size frame. |
| R4 N commits from N cache misses | **Untested → P1** (200 instances, flush cost measured, budget 16ms). |
| R9 Android state/props races | **Untested → P1** (rapid prop stress; the ledger makes a lost size self-healing, so the assertion is "props are never stale + final size right"). |
| R10 `extends IntrinsicProps` | **RESOLVED — nitrogen 0.37.1 flattens it.** Generated Props contain `nuiSizingKey: ReactProp<std::string>` and `nuiSizingId: ReactProp<double>` plus both `validAttributes` entries, so no per-spec declaration is needed (the props *are* declared per spec in `Switch.nitro.ts` via the interface; nothing extra was required). |
| R11 RN floor | **Satisfied** — `peerDependencies.react-native` is `>=0.86.0`, above the 0.82 floor `unstable_Immediate` needs; the nitro#1655 base-props patch from T10 is still applied by the same script and covered by its tests. |
| R12 measure/feedback loops | **Mitigated, P1 to prove it** — Expo's budget-of-2 immediate pushes per turn plus a 0.5pt/dp epsilon are in the engine (`kImmediateBudgetPerTurn = 2`, `kEpsilon = 0.5f`) and unit-tested off-device; the accessibility-text-size case is a P1 test. |

## Benchmark note (T02 not available)

The T02 bench app/probe is **not merged** — `main` has only `docs/tasks/T02-bench.md`
(confirmed with `git ls-tree -r main`). Per the brief, mount timings therefore come
from the core perf ring buffer (`NitroUiCore.drainPerf()`, D1 clock in C++) and the
in-app harness, not from the bench runner, and no `@expo/ui`/`rn-core` ratios are
available. Numbers are in the P1 section.

---

# P1 — correctness

**Status: both P1 exit criteria are met on both platforms. Plan B is not needed.**

- *No wrong-size frame*: measured per instance from the box the platform actually
  painted — 0 stale frames on Android, at most 1 on iOS and only in the one scenario
  where the size cannot exist in the first turn (§"Frame evidence").
- *Bounded commits*: 0 for a warm or pre-warmed mount, 1 for a cold first instance,
  and 200 cold instances cost **one** flush with 2 immediate + 198 batched pushes.

Everything below is from the final test file (`87771c7`..HEAD) re-run on both devices,
not the earlier drafts of it.

## Gates (final, on this branch)

`bun run check` → **exit 0**, whole chain in one run (`/tmp/t11-final-check.log`):

| Step | Result |
| --- | --- |
| `bun run typecheck` | PASS |
| `bun run lint` | PASS |
| `bun run format` | PASS — "All matched files use Prettier code style!" |
| `bun run test` | PASS — **7 suites, 80 tests** |
| `bun run test:native` | PASS — `sizing.test.cpp: 79 checks passed`, clock + handshake green |
| `bun run nitrogen:check` | PASS — "no drift (53 generated files match, 4 view(s) patched)" |
| `bun run autolinking:check` | PASS |
| `bun run prepare` + `api-extractor:check` | PASS — the emitted API report matches the committed one (which now includes `prewarm`) |
| `bun run publint` | PASS — "All good!" |
| `bun run manifest:check` | PASS — tarball matches, 148 files |

Device runs, same binaries as P0 plus the Kotlin first-frame fix (`767a303`, built
02:36), final harness file:

| Run | Result | Log |
| --- | --- | --- |
| iOS, full suite (Switch + Sizing) | **25 passed / 25**, exit 0, 13.7 s | `/tmp/t11-p1-ios-final.log` |
| Android, full suite | **25 passed / 25**, exit 0, 37.7 s | `/tmp/t11-p1-android-final.log` |
| iOS, Sizing only under Dynamic Type `AccessibilityLarge` | 10 passed / 10 | `/tmp/t11-p1-ios-a11y3.log` |
| Android, Sizing only under `font_scale 1.3` | 10 passed / 10 | `/tmp/t11-p1-android-fontscale.log` |

The app's `console.log` does not reach the harness' stdout, so every number quoted
below is captured from the app's own log stream — iOS through
`xcrun simctl spawn <UDID> log stream --predicate 'process == "NitroUiExample"'`
(`/tmp/t11-syslog-ios2.log`, the final run is the block starting `02:48:14`, PID
22479), Android through `adb -s emulator-5570 logcat` (`/tmp/t11-logcat-android.log`,
final block from line 87, PID 4470). Both captures were started by this task and killed at the end.

## Frame evidence — "does anyone see a wrong size?"

`docs/research/core-architecture.md` §1 asked for "no frame shows the wrong size",
which a plain size assertion cannot answer. Two things make it answerable:

1. **Per-frame layout log** — the trace on `nitroUiCore`
   (`setSizingTraceEnabled` / `drainSizingTrace`) records, per instance and only on
   change: `laidOut` (what Yoga was told), `corrected` (what the engine pushed).
2. **A drawn-box sample** — `b5148ff` added the piece that turns "Yoga was corrected"
   into "nobody saw a wrong size": the host samples its own layer's box on its first
   frame (`recordDrawnSize` in `ios/core/NitroSwiftUIHost.swift:345`,
   `android/.../core/NitroComposeHost.kt`) and it arrives as `drew`. Plus, on Android,
   the `OnPreDrawListener` counter of frames it cancelled.

For a Switch this alone proves nothing — the guess and the truth are both 61×28, so
every frame is right by construction. The suite therefore **poisons the cache** first,
which is exactly what an environment change leaves behind:
`nitroUiCore.seedSizingSize("NitroUiSwitch", "", 120, 90)`, then mount one Switch and
read its trace. Final runs:

| | `laidOut` | `drew` | `corrected` | stale frames seen |
| --- | --- | --- | --- | --- |
| iOS | 120×90 | **120×90** | 61×28 | **1** |
| Android | 120×90 | 52.19×48 | 52.19×48 | **0** |

`poison frames: drawn=1 stale=1 skipped=1` (iOS) / `drawn=1 stale=0 skipped=1`
(Android), and Android's cold-mount `drew` in the un-poisoned case is the *corrected*
size (`["laidOut:52.2x48.0","corrected:52.2x48.0","laidOut:52.2x48.0","drew:52.2x48.0"]`).

- **Android never shows it**: the pre-draw pass applies the correction and returns
  `false`, cancelling that one draw; the traversal redraws at the measured size.
- **iOS shows it once**: the turn's frame goes up with the wrong box and the
  correction is committed in the next turn. This is not a flush that could have
  happened earlier — a natively measured size cannot exist before the native side has
  laid the control out, so the first turn has nothing to flush. Stock RN behaves the
  same way (it keeps the old box until something re-measures). One frame, only after
  an environment change, self-healing on the next one → **question (d)**.

The Modal case is clean on both platforms in the final runs
(`["laidOut:411:52.2x48.0","drew:411:52.2x48.0","corrected:…","laidOut:…"]`), though
`drew` is one-shot and the test does not require it: RN's `Modal` mounts its tree on
the second surface separately, so a host can paint before it holds a sizing id.

## Commit counts — the other exit criterion

Brief's expectation: "0 extra for pre-warmed, 1 sync for cold first instance". Measured
(final runs; `corrections`/`immediate`/`batched`/`flushes` are engine counters, read as
deltas over a snapshot taken inside the test):

| Scenario | corrections | immediate | batched | flushes | worst flush |
| --- | --- | --- | --- | --- | --- |
| Cold first instance | 1 | 1 | 0 | 1 | 0.55 ms iOS / 7.6 ms Android |
| Second instance (warm) | **0** (1 report dropped) | — | — | 0 | — |
| Prewarmed instance | **0** (1 dropped) | — | — | 0 | — |
| 200 instances, pre-warmed | **0** (200 dropped) | — | — | 0 | — |
| 200 instances, cold | 200 | 2 | 198 | **1** | 4.85 ms iOS / 8.54 ms Android |
| 30 rapid prop turns | **0** | — | — | 0 | — |

So: the brief's expectation holds exactly, and the batch case is bounded by the
per-turn immediate budget (2) with everything else riding in the same flush — one
flush, not 200 commits. "Batched" here means *not* pushed with
`unstable_Immediate`; the pushes all happen inside one flush, so they coalesce into
one commit rather than N.

`maxFlushMs` for a cold batch of 200 measured **8.54 ms** on a quiet machine and
**17.9–24.2 ms** while another task's device work was loading the same machine
(D13). Against R4's ~16 ms budget that means: inside it at rest, over it under load,
and in the worst case the cost is ~24 ms in one pre-draw pass plus the frame Android
already cancelled. → R4 status below.

## The P1 suite

`example/__tests__/Sizing.harness.tsx` — 10 tests, run on both platforms, plus the
15 T10 Switch tests re-run against sizing-owned boxes (25 total, all green).

| Test | What it pins | Measured |
| --- | --- | --- |
| lays a cold Switch out at the size the control measures | box == `measureContent` == what the control is, and the first mount's one correction | box 61×28 / 52.19×48, 1 correction, trace incl. `drew` |
| costs the next instance nothing at all | warm mount = 0 corrections, report dropped by the ledger | `corrections:0, dropped:1, measurements:1` |
| pre-warms from the declared size so the first mount is exact | `prewarmSizing` makes the first mount exact | 0 corrections, 1 dropped, epoch bumped |
| mounts 200 at the measured size with nothing to correct | R8-adjacent + pre-warm at scale | iOS 295.0 ms (1.48 ms ea), Android 899.1 ms (4.50 ms ea), 0 corrections, 200 dropped |
| corrects a cold batch of 200 with one correction each, few of them immediate | **R4** | 200 corrections = 2 immediate + 198 batched, 1 flush, 4.85/8.54 ms |
| keeps an explicit width, height and flex in charge | Yoga still wins; the cross-axis trade | fixed 120×60 / 120×60.19, `flex:1` 300×28 / 300.19×48, `alignSelf:'stretch'` 300×28 / 300.19×48 |
| corrects a wrong guess before the user sees it | **R2**, the frame question above | 1 stale frame iOS, 0 Android |
| sizes a control inside a Modal | RN `Modal` (separate surface) | content 61×28 / 52.19×48, 1 correction, `drew` present |
| takes a storm of prop changes without re-sizing | **R9** | 30 turns → `measures:0, corrections:0, newCacheEntries:0`, last value applied, box unchanged |
| mounts the same batch warm and cold, and both at the right size | mount timings, both paths | n=1 and n=50, see table below |

`Switch.harness.tsx`'s 15 tests still pass unchanged — including "reports the size of
what it hosts" and "reports the control size and not the box when the box is bigger",
now with the box coming from the engine rather than a style.

## Mount timings (T02 not merged — core clock deltas)

Confirmed again on this branch: `main` has `docs/tasks/T02-bench.md` and no bench
runner, so there are no `@expo/ui` / `rn-core` ratios. The numbers below are
`nitroUiCore.now()` (D1 clock, C++) around an in-app render in the harness — mount
time including React, not a published benchmark. Final runs:

| | iOS warm | iOS cold | Android warm | Android cold |
| --- | --- | --- | --- | --- |
| n=1 | 22.8 ms | 34.0 ms | 141.5 ms | 62.9 ms |
| n=50, per instance | 0.71 ms | 0.78 ms | 6.09 ms | 7.49 ms |
| 200, total | 295.0 ms (pre-warmed) | 137.2 ms | 899.1 ms (pre-warmed) | 830.3 ms |

Read as *the mount dominating, not the sizing*: on iOS the whole correction path is
inside 70 µs of per-instance noise, and the two 200-instance rows differ by less than
the order they run in — the pre-warmed one goes first and pays the screen/host
warm-up, so the cold one that follows can measure *faster* overall despite doing 200
corrections in one flush. That the correction path is not separable at this
resolution is the finding. Android's n=1 warm figure swings 137–352 ms between runs
and its emulator mount cost moves 2–3×, which is why these numbers belong to T02
rather than to this report as a result. What the sizing path itself provably costs is
the flush column above: ~0.5 ms on iOS, 8.5–24 ms for a 200-instance cold batch on
Android.

## Environment change (R12's text-size half)

No component in the library changes size with text size yet — measured, not assumed:

- Android at `font_scale 1.3` (`settings put system font_scale`): cold Switch still
  **52.19 × 48**, suite green (`/tmp/t11-p1-android-fontscale.log`).
- iOS with the Dynamic Type override set to Accessibility Large
  (`UIPreferredContentSizeCategoryName = UICTContentSizeCategoryAccessibilityLarge`):
  cold Switch still **61 × 28**, suite green (`/tmp/t11-p1-ios-a11y3.log`).
- Both settings were **reset** afterwards and verified (`font_scale` back to `1.0`,
  the content-size override removed).

So the epoch is exercised mechanically (`invalidateSizingEnvironment()` in tests,
`traitCollectionDidChange` / `onConfigurationChanged` in the hosts) and stays correct
by construction, but no real environment change has yet had a size to invalidate. The
first component with a text-derived size (Button, Picker) exercises it for real, and
the fallback-survives-invalidation rule (`sizing.md` §5) is unit-tested so it cannot
silently regress into a 0×0 first mount.

## Three bugs P1 caught (plus two environment discoveries)

1. **Android's first-frame watch unregistered itself before deciding to stay armed**
   (`767a303`). Consequence: on Android `firstFrame` — and therefore `drew`, the whole
   frame-evidence feature — never fired for a host whose first frame arrives after the
   watch's first check. T10's perf marks shared the bug's shape. The watch now stays
   registered until it has actually sampled (`firstFrameWatchRegistered`).
2. **An engine comment asserted something false, and the suite disproved it**
   (`b07fbda`). `staleFramesSkipped` was documented as "the frame the caller skipped",
   true on Android and not on iOS. The poison run measured iOS drawing one stale frame,
   so the comment now says what the counter means per platform and `sizing.md` §7 says
   the `drew` samples are the real evidence. Renaming it (`changedFlushes`) is a
   pre-release question, not a correctness one.
3. **Reading the trace raced the `drew` sample** (`87771c7`). A drawn sample is
   recorded a runloop turn after the frame it describes, so tests that drained the ring
   too early consumed the `laidOut`/`corrected` events and missed the one they were
   asserting. `collectTrace()` now accumulates across drains until the sample arrives —
   same shape as the T10 perf-ring helper, and a fixed sleep would have been a flaky
   test.
4. *Environment*: `react-native-harness` 1.6's `it()` takes two arguments (no per-test
   timeout) and its default is too small for a test that mounts 200 hosted controls —
   `example/rn-harness.config.mjs` sets `testTimeout:
   Number(process.env.HARNESS_TEST_TIMEOUT ?? 30000)`. Not recorded in
   `docs/upstream.md`: it is a config knob, not a defect.
5. *Environment*: the harness awaits one render per `rerender()`, so a 30-turn prop
   storm loops with awaits rather than firing 30 rerenders (which fails with "Element
   did not update within 1000ms").

## P1 commits

| SHA | Subject |
| --- | --- |
| `097866f` | feat(core): make the sizing engine measurable, and pre-warm it |
| `c79c290` | refactor(core): a sizing key is a variant, not a whole key |
| `b5148ff` | feat(core): record the box a control first drew at |
| `e14accc` | test(core): test intrinsic sizing on a device |
| `b07fbda` | test(core): assert what the sizing engine was measured doing |
| `767a303` | fix(core): stop the first-frame watch from unregistering too early |
| `87771c7` | test(core): read the sizing trace instead of guessing when it is ready |
| `d986e62` | feat(core): let an app pre-warm the components on its first screen |
| `ff8a017` | docs: describe intrinsic sizing as built, with what devices measured |
| `d852851` | docs: record the nitrogen sizing hook as an upstream ask |
| `8e589aa` | docs: describe sizes as measured now that the engine owns them |

Branch total vs `main`: **72 files, +6622/−179** (P0 was 53 files, +4043/−96; P1
added 19 files and +2579/−83 — the measurable surface, the drawn-box sample, the
609-line suite, and the documentation).

## Risk status after P1

| Risk | Status | Evidence |
| --- | --- | --- |
| R1 nitrogen coupling | **Open by design, mitigated as far as it can be here.** Patch applies to nitro 0.37.1, both platforms build, `nitrogen:check` fails on drift (53 files, 4 patched views), 17 patch tests assert idempotency and hard-fail. Upstream draft recorded (`docs/upstream.md` N5) — filing it is not a task-branch action. | P0 report + `bun run check` above |
| R2 same-turn immediate commits | **Measured, bounded, no loops/crashes.** Cold mount: 1 immediate push in 1 flush. Poisoned cache: corrected, 1 stale frame on iOS / 0 on Android, no re-layout loop across 25 tests × 2 platforms × repeated runs. | `poison` + `cold` lines above |
| R3 `sizeThatFits` reflects the pending update / right traits | **Partly answered — and only partly answerable today.** Cold mount measures correctly on both platforms (R3's mechanism), and traits are right (Dynamic Type XL and 1.3× leave the size correct). But the *pending-update* half needs a prop that changes size, and no component in the library has one: a Switch's `value` moves the thumb, not the box. What exists instead is the contract — a bounds change re-measures, everything else must call `invalidateContentSize()` (`docs/architecture/core.md` §7), deliberately not per-commit (T10 review SF5). Keying is exercised off-device (distinct keys cannot share a cache slot). → **question (a)**. | a11y + font-scale runs; `sizing.test.cpp` key checks |
| R4 N commits from N cache misses | **Bounded, and cheaper than feared — with one qualifier.** 200 cold instances → **one** flush, 2 immediate + 198 batched: 4.85 ms iOS / 8.54 ms Android quiet, 17.9–24.2 ms Android under machine load. Under the brief's ~16 ms at rest; over it under load, where the cost is one pre-draw pass plus the frame Android already cancelled. `cloneMultiple` (§1.5) is the lever if it ever matters, and a 200-cold-mount screen is a benchmark case for T02, not a reason to build it now. | `200 cold` lines above |
| R9 Android state/props races | **Nothing to race, measured.** 30 prop turns: `measures:0`, `corrections:0`, no new cache entries, last value applied, box unchanged — the report path is not on the prop path at all, so a lost push cannot strand a size on a prop turn. When a size *is* pushed, `adopt` carries it forward and the ledger makes a miss self-healing. | `storm` line above |
| R10 `extends IntrinsicProps` | **Resolved** (P0). Nitrogen 0.37.1 flattens it; the shared interface lives in a non-`.nitro.ts` file because nitrogen prints "No specs found" for a spec file with no specs. | P0 report |
| R11 RN floor | **Satisfied.** `peerDependencies.react-native` `>=0.86.0` (above the 0.82 the same-turn semantics need); nitro#1655 patch still applied by the same script and covered by its tests. | `package.json`, patch tests |
| R12 measure/feedback loops | **Mitigated; the text-size half has nothing to test yet.** Budget-of-2 + 0.5 pt/dp epsilon held across every run above (no run ever shows >1 correction per instance, no oscillation in any trace: `laidOut → corrected → laidOut` and stop). Switch is font-scale invariant at 1.3 / AccessibilityLarge, so the epoch is mechanical until a text-sized component arrives. | flush columns, a11y runs, traces |

## Decisions P1 added

- **The key is a variant, not an identity** (`c79c290`): `nuiSizingKey` carries the
  size-affecting props only (component name and epoch are composed by the engine,
  `keyFor`). Getting this wrong would have made `prewarm` unable to find the default
  configuration and fragmented the cache per environment.
- **`drew` is a diagnostic, not a contract** — one-shot, host-attributed, and absent
  when a host paints before it holds a sizing id. Tests assert it when present and
  never require it from a dialog.
- **`prewarm` is the only sizing call that is app API** (`d986e62`); everything else
  stayed on `nitroUiCore` as `@internal` diagnostics (D14).
- **Cross-axis fill is opt-in** via `alignSelf: 'stretch'`. A measured size is an
  explicit size, and an explicit size is what stops Yoga stretching — so `flex: 1`
  grows only the axis flex controls. Deliberate, measured, documented
  (`sizing.md` §6); stock RN's `Switch` differs.

## Questions for orchestrator

None of these block merging T11 as it stands; (a) and (b) are scope decisions, (c)–(e)
are product/API calls worth making before 0.1 while there are no users.

**(a) R3's "prop that changes size" has no subject in the library yet.** The brief
allowed a temporary test-only view for it. I did not build one: it means a new Nitro
spec + nitrogen run + both native builds for a component we then delete, and the
engine's key separation is already unit-tested while the frame-evidence tooling (poison
+ `drew` + `collectTrace`) is built and would work against it.
*Recommend:* accept R3 as "mechanism measured, pending-update half deferred", and close
it with the first genuinely size-affecting component (Button's label, or a G1/G3
control). *Alternative:* I add a `SizingProbe` test-only view now — say the word and
it is about one round trip.

**(b) `prewarm` is v0.1 only, and `prewarmKeys` is not implemented.** It seeds each
named component's *declared* size for the empty variant, so the first mount of a
default-config control is exact; a component with several variants needs a per-component
list of keys, which nothing has needed because the only self-sizing control has one.
It is also a declared number, not a measurement — though it cannot make a layout worse,
since a wrong guess is corrected like any cold mount.
*Recommend:* accept as-is; revisit `prewarmKeys` with Button, and treat the stronger
"really pre-measure one instance off-screen" variant as its own task (main-thread cost
at app start, and T10's Android recycling notes say off-screen Compose is where
surprises live).

**(c) Cross-axis fill is now opt-in.** Because a correction writes an explicit size,
`alignItems: 'stretch'` no longer widens a control the way it widens stock RN's
`Switch`; `flex: 1` grows only the axis flex controls. Measured, and the reason the base
style is `alignSelf: 'flex-start'` (`sizing.md` §6). *Recommend:* accept as a documented
difference — a control that reports its own size cannot also be undefined in one axis —
but this is the one place a user of `nitro-ui` could reasonably say "that's not how
RN works", so it is worth a decision rather than a doc line.

**(d) iOS can show one stale frame after an environment change** (Android never does —
it cancels that frame). Not fixable by flushing earlier: the size does not exist in the
turn that mounts it. *Recommend:* accept (stock RN keeps the old box too, and less
predictably). *Alternative:* "hide the control until its size is confirmed", which buys
certainty with a visible fade-in on every cold mount.

**(e) `staleFramesSkipped` is misleading on iOS** (P1 measured that; see bug 2).
*Recommend:* rename to `changedFlushes` before 0.1 — it is on an `@internal` diagnostics
object, so now is the cheap moment. Say so and I will do it in this task.

**(f) `Modal` instances get sizing trace events but no perf marks.** The iOS modal runs
showed `marks={}` while the sizing trace was complete — the first-frame watch does not
attribute marks across the second surface. That is T10's perf area, not sizing
correctness; flagging it so it is not lost.

**(g) Timings here are not benchmarks.** T02 is still unmerged on `main`, so mount
numbers are core-clock deltas around an in-app render (`nitroUiCore.now()`, D1). No
`@expo/ui`/`rn-core` ratios exist for T11 and none are claimed. *Recommend:* when T02
lands, its bench should include a 200-instance cold-cache mount — that is the one case
where this task measured something close to a limit (Android's flush at 8.5–24 ms).

**(h) One stale sentence in `docs/DECISIONS.md` that I deliberately did not touch:**
D14 ends "…until T11's measured sizing replaces defaults" (`docs/DECISIONS.md:47`),
which T11 has now done. DECISIONS.md is cross-task and other agents edit it, so this is
a one-line change for whoever next owns it rather than something I changed mid-flight.
