# T11 — Report

Branch `task/T11-intrinsic-sizing`, from `main` (T01 + T03 + T10). Rebased onto `main`
after the orchestrator's doc commits (`2c76050`, `9484a30`), so the branch's diff is
only T11 work.

**Status: P0 gate PASSED on both platforms. P1 in progress.**

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
