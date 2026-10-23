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
| R1 nitrogen coupling | **Open by design, mitigated as far as it can be here.** Patch applies to nitro 0.37.1, both platforms build, `nitrogen:check` fails on drift (53 files, 4 patched views), 17 patch tests assert idempotency and hard-fail. Upstream draft recorded (`docs/upstream.md` N6) — filing it is not a task-branch action. | P0 report + `bun run check` above |
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

## Questions for orchestrator — all answered

Answered in Round 3 by D16, D17 and the work there; each letter's outcome is in that
round's "Answers" table. Kept verbatim below as the record of what was asked. (a)–(e) and
(g)–(h) are decided; only (f), the `Modal` perf-mark gap, is still open, and it belongs
to T10's attribution rather than to sizing.

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

---

# Round 2

Opus review (`docs/tasks/T11-intrinsic-sizing.review.md`, committed here) returned
CHANGES-REQUIRED. Findings in the order I was asked to take them.

## Gate status this round (exact commands)

| Gate | Result |
| --- | --- |
| `bun run check` | **PASS** (exit 0; includes `test:native`, `nitrogen:check`, `api-extractor:check`, `manifest:check`) |
| `bun run test:native` | **PASS** — 147 checks, and the same suite again under `-fsanitize=address,undefined` |
| iOS harness, iPhone 17 `F08675D3` | **FAIL — 29 passed, 3 failed** (details below) |
| Android harness, `nitroui_t01` | **not run this round** |

## Blocking

**B1 (use-after-free) — fixed.** `pushMeasuredSize` captures `measured` by value; the
reasoning is at the capture site. A `[&measured]` capture is a `Pending::measured`
reference into a vector owned by `applyReports`, which an `Asynchronous` update runs on
the JS thread after that returns.
Evidence it can fail: `scripts/check-sizing-capture.sh` (a grep — no fake push can see
the engine's own header) is wired into `test:native` and goes red on `[&measured]`;
`test:native` now also runs the whole sizing suite under ASan+UBSan (kept in the gate;
the suite is milliseconds, the run is seconds), including
`testDeferredPushesReadSizesAfterFlush`, whose fake push stores the callback and runs it
after `flush()` returns, and a re-entrant push that calls `measure()`/`bind()` to pin the
no-push-under-the-lock rule. Leak checking is off deliberately (N3 leaks the engine).

**B2 (prewarm poisons the cache) — fixed, plus a second bug it exposed.**
Seeded/pre-warmed entries are `provisional`: they answer the layout, and the first
report either promotes the entry (matching size, still zero commits) or replaces it with
the measured size. `prewarmKeys` pre-warms only from a *declared* fallback.
Then the device tests still failed, and reproducing the scenario natively in milliseconds
found the next layer: `fallbacks_` is keyed by **component**, and `applyReports` was
writing every measured size into it — so one configuration became another one's guess.
Repro (host, this repo): after a `|w100` variant reports 100x28, a fresh default mount
answers **100x28**. Fixed by filing a learned size under (component, sizingKey)
(`guesses_`) and never under the component; the declared fallback is now written only by
declarations. This also keeps the property D14 wanted (a configuration's own last size is
its guess across an environment bump, so a control that did not move still costs nothing).
`testALearnedSizeBelongsToItsOwnConfiguration` + the rewritten key-change check cover it:
re-introducing the one-line leak turns both red (verified, then reverted).

## Should-fix

- **S1 — fixed in code, not yet green on device.** The dirty check now compares the
  incoming props with the props the *state* still carries (`completeClone` passes the node
  itself as source, so the old comparison was a node with itself). Native coverage added
  (`testKeyChangeReMeasuresAndCorrects`). The on-device test still fails — see "What is
  not green".
- **S2 — fixed in code, not yet green on device.** The bump keeps ledger entries, marks
  them inexact and recomputes their key; hosts invalidate once per real change via a
  signature (content size category + legibility weight / font scale + density + locale)
  instead of once per view. Native coverage added
  (`testEnvironmentChangeCorrectsAMountedInstance`).
- **S3 — fixed.** `forget(id)` from `onDropView`/`prepareForRecycle` on both platforms
  (Android via JNI), plus a bounded expired sweep. Ledger/registry flat across
  mount/unmount is asserted in the host suite and in a new harness test.
- **S4 — fixed, with the reviewer's first option.** One process-global atomic in C++
  behind `nitroUiCore.nextSizingId()`, handed out once per mount by a single
  `useSizingId` hook in `src/core`. Chosen over keying maps by (componentHash, id) +
  a per-runtime salt because that still needs a salt that survives a reload and a
  cross-component uniqueness rule, while one counter is uniqueness by construction and
  costs one atomic increment per mount.
- **S5 — implemented; iOS still draws one fallback frame on a cold mount.** The host now
  measures an `intrinsic` control on the first commit regardless of bounds and `report()`
  calls `CFRunLoopWakeUp`. Measured trace for a cold mount after the fix:
  `laidOut:40.0x20.0 → drew:40.0x20.0 → corrected:61.0x28.0`, `corrections=1
  immediate=1`. The correction is issued, but SwiftUI's fitting size does not exist until
  its own layout pass, so it lands in the next turn. See Questions.
- **S6 — not fixed; honest number.** `immediate` budget is 2 per flush, so in the cold
  batch of 200 exactly **2 corrections can land in the cancelled frame and 198 arrive
  after it redraws** (`corrections=200 immediate=2 batched=198 flushes=1`). Making pushes
  synchronous inside `onPreDraw` would fix the number and risk a deadlock (a synchronous
  commit re-enters `measureContent`, which takes the same lock), so I left the budget and
  corrected the claim in `sizing.md` instead.
- **S7 — fixed.** An unbound target is put back into `needsCorrection_`, and an unbound
  report is requeued for a bounded number of flushes instead of being dropped.
- **S8 — mostly done.** Wrong-guess seeds, all-200 assertions, Android tightened to 0
  stale frames, mount/unmount stress with rapid props, teardown with corrections in
  flight, and the deferred/re-entrant native pushes are all in. Not done: a reload test,
  and Android's 0-stale assertion is unrun this round.

## NITs

N1 (narrow through `react::State`), N2 (`flushScheduled` reset), N3 (leaked singleton),
N4 (epsilon comment matches value), N5 + N6 + N8 + N9 (docs; `staleFramesSkipped` renamed
everywhere including the regenerated API report), N7 (patch script hard-fails on a
generated `updateState:oldState:` / a second Kotlin bind, with fixtures), N10 (JNI
comment says the missing class is survivable only because Kotlin catches the link error)
— all done. None skipped.

## What is not green, and the next experiment

> **Corrected in Round 3.** The diagnosis below is wrong: the key does vary, and the
> cheap check it proposes (`delta(before).cachedSizes`) returns a new configuration. Both
> failures were the iOS host measuring content it had not yet rendered, plus a recycled
> host handing on the previous instance's size - see "The first-commit bug" in Round 3.

Two of the three iOS failures are one symptom, and I could not close them: the
`nuiSizingKey` does not appear to vary on device. The evidence:

- a **default**-configuration mount is laid out **100x28** — the *wide* variant's size —
  which is only possible if both variants share one cache entry that the wide instance
  made authoritative;
- after an environment change, rerendering the same instance to the wide configuration
  leaves it at **61x28**, which is what S1's fix cannot do if the key actually moved;
- both survive my per-configuration fix (the fix changes the *guess*, not an overwritten
  *authoritative* entry), while the identical scenario passes in the host suite.

Cheapest decisive check: log `delta(before).cachedSizes` around the wide mount in the
key-change test. One new configuration means the key moved and the bug is elsewhere; zero
means Fabric is not varying `nuiSizingKey` and the trail goes to the generated prop
plumbing (`ReactProp<std::string>` with an empty-string default for the base variant).
The third failure is `lastSampleIsRight` on a cold iOS mount — S5's residual frame, above.

## Questions for orchestrator — all answered in Round 3

1. Accepted as **D17** - one declared frame for the first instance of a configuration,
   zero for anything already exact, no "hide until measured", and the harness now asserts
   exactly that on both platforms.
2. Chased, and the premise was wrong: the key and `nuiTestWidth` arrive correctly on
   mount and on update on both platforms. The remaining failures were the iOS host
   measuring content it had not yet rendered, plus a recycled host handing on the
   previous instance's size. No nitrogen patch, no new upstream entry.
3. The immediate budget stays at **2** - the documented number is the rule (D17).

1. **D16's assumption for cold mounts does not hold.** "One stale iOS frame after an
   environment change, accepted" also implies a cold mount, and even with S5's first-commit
   measure iOS still draws the fallback box on frame 1 of a cold mount (measured trace
   above). Accept it as platform truth and relax the harness, or fund "hide the control
   until its size is confirmed"?
2. **Do you want me to keep chasing the key plumbing?** My read is that the remaining two
   failures are one bug in prop delivery, not in the engine, and it is a small isolated
   hunt; I stopped rather than guess at an API/Architecture decision about how
   `nuiTestWidth`/`nuiSizingKey` are declared.
3. **S6's number.** "Up to `kImmediateBudgetPerTurn` (2) instances per frame get a
   correction before the redraw" is now the documented claim on Android. Do you want the
   budget raised instead, given 198 of 200 is the realistic cold-batch number?

---

# Round 3

Asked for three things: encode D17 in the harness, chase the `nuiSizingKey` plumbing to
its root because Button's key will vary, and run the Android harness, which round 2 had
not run. The headline is that **the key plumbing is innocent** - props and keys arrive
correctly on mount and on update - and round 2's diagnosis pointed at the wrong layer.
The bug is in the iOS host's measure timing, it is fixed, and both platforms' suites are
green.

## Gate status this round (exact commands)

| Gate | Result |
| --- | --- |
| `bun run check` | **PASS** (exit 0 - all 13 steps, incl. `test:native`, `perf:renders`, `nitrogen:check`, `api-extractor:check`, `manifest:check`) |
| Unit tests (`jest`, inside check) | **PASS** - 109 tests, 8 suites |
| `bun run test:native` (inside check) | **PASS** |
| iOS harness, iPhone 17 `F08675D3`, `METRO_PORT=8293` | **PASS - 33/33**, 2 suites |
| Android harness, AVD `nitroui_t01` (`emulator-5570`), `ANDROID_ADB_SERVER_PORT=5041` | **PASS - 33/33**, 2 suites - incl. D17's `stale == 0` |
| New first-commit gate, **before** the fix | **RED** (evidence below) |
| `bun run perf:renders` | **PASS** - 6 commits vs baseline 6, no redundant render |

Commands, from `example/`:

```sh
# iOS
HARNESS_APP_PATH="…/DerivedData/…/Debug-iphonesimulator/NitroUiExample.app" \
  IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8293 \
  bunx react-native-harness --harnessRunner ios
# Android (APK from `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`)
HARNESS_APP_PATH="…/outputs/apk/debug/app-debug.apk" ANDROID_AVD=nitroui_t01 \
  ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 \
  bunx react-native-harness --harnessRunner android
```

## The first-commit bug: what it actually was

The symptom survived round 2's S1 fix: a `nuiTestWidth` that arrives **with the view's
first props** changes the control and never changes the size Yoga is told. Round 2 read
that as the key not moving, because a default-configuration mount came back at the wide
variant's size. That reading was wrong in both directions: the key was fine, and the
default mount was not reading the wide variant's cache entry - it was reading **the
previous instance's size off a recycled host**.

What was actually happening, on iOS only, in two layers:

1. **`commit()` measured in the same turn as the update it triggered.**
   `model.objectWillChange.send()` only *invalidates* SwiftUI's graph; the body is
   re-evaluated in a later pass. `measureFittingSize()` in the same turn therefore
   numbers the content the commit had just replaced - the plain 61x28 Toggle - and the
   engine files a report as exact and stops asking. A size-affecting prop that arrives
   after the first commit still gets a later measure pass and recovers; one that arrives
   *with* the first commit never does.
2. **The first commit runs while the host has no window**, where a forced
   `layoutIfNeeded()` has nothing to lay out. `refreshContentSize()` guarded on
   `hasCommitted`, so no layout pass ever preceded the measure either.

The fix is one flag, `contentUpdatePending`, that carries the update to a measure point
that can apply it: `measureFittingSize()` lays the hosted view out first;
`refreshContentSize()` refuses to answer while the host is outside a window rather than
cache a number describing content that is on screen no more ("a wrong number is worse
than a late one", since the engine treats a report as final); `didMoveToWindow()` is the
deferred measure point, because a recycled host whose frame does not change gets no
later `layoutSubviews`. `prepareForRecycle()` now also clears `_contentSize`, which is
what leaked a wide size onto the next instance - round 2's "100-wide default Switch".

### Evidence

On-device probes, before the fix (JS facts carried in a thrown error, native facts in
`NSLog`):

```
FACTS::B wide key:"|w100" tw:100 content:61x28 box:[61,28] corr:0   <- key AND width arrived; size did not
FACTS::C after content:61x28 box:[61,28]
```

After the fix, the same probes: `B wide content:100x28 box:[100,28]`, plain-after-mount
`61x28 corr:0`, `C after content:100x28 box:[100,28] corr:1`, `A 61x28 corr:0`. The key
string was correct in every one of them, which is the answer to round 2's question 2:
**no `scripts/patch-nitrogen.mjs` change was needed and `docs/upstream.md` gained no
entry**, because Nitro's generated props were never the problem.

Gate, before the fix (host reverted to `HEAD`, rebuilt):

```
● Sizing · intrinsic (T11) › measures the width that arrived with the first commit
  testID "first-commit-wide" (a control whose width arrived with its first props)
  never reached 100 wide - last box 61.00x28.00.
Tests: 1 failed, 17 passed        # the same suite, all 18
```

After the fix: 18/18 on iOS, 18/18 on Android, and 33/33 for the whole suite on both.

An intermediate attempt is worth recording: applying only `layoutIfNeeded()` (no window
guard, no `didMoveToWindow()`) left a *fresh* wide mount at 61 while the update was
already lost - the probe reported `content:0x0` for a mount that had never been measured
- which is what pointed at the window guard as the second half of the fix.

### The fixture is the test

The gate seeds the **accurate declared size**, not a poisoned one, and that choice is
what makes it able to fail. With a poisoned (wrong) starting guess, the correction moves
the box, and on iOS *a moving box is what triggers the re-measure* that then finds the
real content - so the stale number survives one frame, is corrected, and the test passes
with the bug in. Seeded at the declared 61x28, the stale number equals the guess, the
box never moves, and nothing but a measure of the actual content can reach 100. It is
also the case a real control hits: its declared fallback is right for the library and
wrong for it.

Android is unaffected by the race - `NitroComposeHost` uses `NitroUiMeasuredRoot(onMeasured:)`,
so Compose reports its own size rather than being asked for one - and the Android run
this round is what confirms that, rather than the reasoning.

## D17, encoded

`lastSampleIsRight` cannot express D17 and is gone. `markFirstFrameIfNeeded` samples the
frame a host first commits and disarms until its next recycle, so there is exactly **one
`drew` sample per mounted instance** and "the last sample" is decided by a race, not by
the engine. What the cold tests now assert is D17 as written: at most one stale frame on
iOS, **zero on Android**, every sample either the declared fallback or the control's own
size, and the box that stays up.

Three tests that assert settled boxes inherited the process-global fallback and needed
their own accurate declaration: `prewarm()` seeds from the *declared* number, which
measurements never overwrite, so a poisoned test running first used to leave them
reading it.

## Android: run for the first time since round 2

Two of round 2's Android edits had never been compiled - the APK the suite was tested
against was built at 02:36 and the commits landed at 03:55 - and `assembleDebug` failed
on both:

```
HybridNitroUiSwitch.kt:117:39  Unresolved reference 'width'.        # Modifier.width, no import
NitroComposeHost.kt:540:39     Unresolved reference 'joinToString'. # android.os.LocaleList is not Iterable
NitroComposeHost.kt:540:59     Unresolved reference 'it'.
```

Fixed in `517230a` (`toLanguageTags()` is the platform's own rendering of the same
list). Nothing else failed to compile, and the rest of the suite passed on the first
Android run - one failure, below.

### The cold-batch gate was measuring the wrong thing

`expected 105.297667 to be less than 64`. `maxFlushMs` is a **process-wide high-water
mark** that `delta()` passes through un-differenced: every test in the run logged the
identical `maxFlushMs=100.503`, including tests that logged `flushes=0`. It cannot
support a per-batch assertion at all.

`lastFlushMs`, sampled while the batch is still the most recent work, is the batch's own
flush. Measured with it, debug build:

| Platform | Flush that applies 200 corrections | Mount of the same 200 |
| --- | --- | --- |
| iOS | 8.5 ms (1 flush) | 4546 ms |
| Android, cold | 125 ms | 4295 ms |
| Android, warm (second identical batch) | 84 ms | 2177 ms |

The Android gap is not one-time initialisation - a second, warm batch still cost 84 ms -
and it is not the engine's bookkeeping: it is the re-layout that 200 pushes trigger
inside the pre-draw pass, which is the same pass that cancels the wrong-size frame
(D17), so the frame it spends is the frame it replaces. Round 2's comment claimed
"about 18 ms on Android", a number this tree does not produce. The bound is now the
flush's own duration against a fraction of the mount plus an absolute ceiling, both
documented with these measurements.

The test's 200-box sweep had its own race, seen red on iOS with the test run alone: a
flush may push only two synchronous updates, so a cold batch reaches its control's size
on a later frame than the one that mounted it, while `mountMany` waits for the last view
to *exist*, not to be sized. `waitForAllBoxes` polls all 200 and names the rows that
never arrive. The warm-batch sweep is left immediate on purpose - nothing corrects it, so
its boxes are set by its own mount frame.

## `perf:renders` after the merge

The T02 render contract went red: rendering a `Switch` now asks native for its sizing id
(`useSizingId`), and the perf test had no `NitroUiCore` mock. It needed the mock, not a
new baseline: the hook answers **once per mounted instance and keeps the id in a ref**,
which is not a render. Measured after adding the mock: **6 commits against a baseline of
6**, no redundant update, so `bench/baselines/renders.json` is untouched.

## Answers, and the two earlier question blocks

Round 1's (a)-(h) and round 2's three questions are answered by D16, D17 and this
round's work; the blocks are marked resolved in place and the answers are:

| Question | Where it went |
| --- | --- |
| (a) R3 has no size-affecting subject | D16 - G2 Button owns the real test; `nuiTestWidth` stays test-only. Round 3's gate covers the mechanism for a prop arriving at mount *and* on update. |
| (b) `prewarmKeys` | D16 - deferred past 0.1. |
| (c) cross-axis fill is opt-in | D16 - documented difference. |
| (d) one stale iOS frame | D17 - generalised to the first instance per configuration per epoch; zero on Android. |
| (e) `staleFramesSkipped` | D16 - renamed `changedFlushes`, in the stats above. |
| (f) Modal instances get trace events but no perf marks | **Still open**, T10/bench area, unchanged by this round. Flagged again in "Still open". |
| (g) timings are not benchmarks | T02 merged. Its bench now owns benchmarks; the 200-instance cold-cache flush this question asked about is measured above, with an instrument that reports it per batch. |
| (h) D14's "until T11" sentence | D16 records the clause as fulfilled. |
| R2 Q1 cold-mount frame | **Accepted as D17**, harness re-encoded, no "hide until measured". |
| R2 Q2 chase the key? | Chased. The key arrives correctly on both platforms; the bug was measure timing plus a recycled host's stale size. No nitrogen patch, no new upstream entry. |
| R2 Q3 immediate budget | Kept at 2 - the documented number is the rule (D17). |

## Docs corrected

`docs/upstream.md` renumbered this task's entry to **N6** when main's N5 landed in the
merge; the P1 table above still cited it as N5 and now reads N6. (`docs/architecture/core.md`'s
"Upstream N5" is main's and is left alone.)

## Round 3 commits

| Commit | What |
| --- | --- |
| `1d3fff9` | Merge `main` (T02 bench, D17, AGENTS' fail-proof rule) into the branch |
| `517230a` | `fix(sizing)` - compile the Android host's test width and environment signature |
| `c8895af` | `fix(sizing)` - measure the content a commit changed, not the one before it |
| `9bbbf46` | `test(sizing)` - gate the size a first commit brings, and assert D17's budget |
| `cfc15f9` | `test(sizing)` - make the cold-batch gate measure the flush and frame it owns |
| `bd390e1` | `test(perf)` - give the Switch render contract the core it now needs |

## Still open

- **Android's batch flush is ~10x iOS's** (84-125 ms vs 8.5 ms for the same 200). It is
  bounded by the instances in a turn, and the knob is a per-flush instance cap. Not
  wrong, but it is the sizing cost that grows with a cold list, so it belongs in a
  benchmark before anyone ships a 500-row cold mount.
- **(f) from round 1**: a `Modal` instance gets sizing trace events but no perf marks -
  the first-frame watch does not attribute marks across the second surface. Sizing is
  correct there (the Modal test passes); the gap is in T10's perf attribution.
- **G2 Button's real R3 test** (D16), and `prewarmKeys` past 0.1.
- The warm-batch and frame-counting sweeps are still immediate reads, deliberately: one
  has nothing to correct, the other exists to sample frames as they land.
