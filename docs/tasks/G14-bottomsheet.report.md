# G14 — BottomSheet

**Branch:** `task/G14-bottomsheet` (from `main` at `9375659`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G14-ndzag` (pair-a: iOS `49D5024D` / `emulator-5574` / Metro `8295`)

## Summary

`BottomSheet` ships to Appendix C as amended by D35: `isPresented` behind the event-count
handshake, detents in SwiftUI's names (`'fit'` default, `'medium'`, `'large'`, `{ height }`,
`{ fraction }`; index reported via `onDetentChange`, not controlled), `onDismiss` once the
sheet has gone, `dismissible`, `showsGrabber`, `cornerRadius`, `containerColor`,
`accessibilityLabel` (names the sheet), `testID` (`<testID>-sheet`). Content mounts only
while presented; not hostable; `sizing: null`. No `style` prop (the node is the content box,
so a background would paint the app window) — a deviation from C1's `ViewProps`.

**Decision a reviewer must read — S2's iOS mount premise was wrong.** In RN 0.88
`RCTViewComponentView` mounts children into `currentContainerView`, which is the component
view itself, *beside* the Hybrid View's `contentView`: S2's children never moved into the
sheet (its witnesses read the container). `patch-nitrogen.mjs` gains a content-children
step (C2's original `.mm` plan) mounting them into the content view, hard-failing on a
missing anchor. Real input now presses a `Pressable` inside the sheet on both platforms.

**iOS** presents in the screen's chain, or from G11's own window when the top presented
controller is an RN `Modal` host (D35); the unasked-exit witness is
`presentationControllerWillDismiss`/`DidDismiss` plus `isBeingDismissed`. The own-window
`fit` gap is **closed**: `invalidateDetents()` on every content-size change follows +160 pt
in both paths. Layout uses S2's JS round trip, seeded with the window width (640 dp cap on
Android) so a `fit` sheet's first frame is already its height; presenting waits one turn for
the mount transaction's layout. **Android** registers a hand-written `ViewGroupManager`
(new manifest key `androidViewManager`, registry-checked both ways) redirecting children into
a copy of RN's `Modal` root inside Material 3's `ModalBottomSheet`. Back from expanded steps
to `medium` first (Material's behaviour, documented).

**Isolation:** `__tests__/isolated/` is left out of the shared harness run;
`NITRO_UI_HARNESS_ISOLATED=1` runs it alone. The stranded-Modal case lives there; with D35's
rule removed it reproduces the strand.

**react-native-screens 4.30.1** (commit `edb090b`, reverted `9174970`): iOS — in-chain from a
native-stack screen, a push closes and reports, a `formSheet` closing under the sheet leaves
nothing. Android — not measured: `ScreenStack` crashes this app instance at mount
(`addViewAt … child already has a parent`) with or without a sheet in it.

Bench arms: not built (FOLLOWUPS line). README screenshots are the Storybook story
`FitsItsContent` (light, opened on mount by an uncommitted local tweak), full-width crops
scaled to 804 px (iOS, 3x) and 720 px (Android), because a sheet is screen-wide.

## Gates

Round 1's generated table described code tree `4fc9d4bc1a19`, which fix round 1 replaced;
the fresh table is in "Fix round 1" below, and `docs/tasks/G14/gates.jsonl` keeps every run
of both rounds. On that tree all five gates passed, and `BottomSheetModalHazard` passed
2/2 on both platforms.

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

Device reds ran on mutated trees (filtered `harness:*:BottomSheet.harness`, `…:BottomSheetModalHazard`,
`real-input:*:--control:bottom-sheet` rows in the ledger); each mutation was reverted.

- `BottomSheet.harness` "follows its content (fit)" + "…in a window of its own" (iOS) -> `invalidateFit()` skipped -> `"grow" never reached sheetH 160 taller than 274 … contentH=400;…sheetH=274`
- same two (Android) -> `fitHeightPx` set once only -> `"grow" never reached contentH 160 taller than 240 … contentH=240;hostH=400`
- "takes touches through a touch root of its own" (iOS) -> no `RCTSurfaceTouchHandler` -> `expected 0 to be greater than or equal to 1` (`touchRoots`)
- `testRealInputBottomSheet` -> the same -> `the real tap inside the sheet to reach JS: 3 real presses on the Pressable inside the sheet`
- `CHECKS['bottom-sheet']` -> `eventDispatcher = null` -> `✗ a real tap inside the sheet presses its Pressable once — expected Pressed 1 times, saw -`
- JS-close / user-close / mid-entry unmount tests -> wrapper never `setMounted(false)` -> `the content did not unmount: undefined`
- drop tests, 50-cycle (iOS) -> touch root never detached -> `touchRoots=69` after 50 cycles, `touchRoots=12..14` after drops
- drop tests (iOS) -> teardown without `dismissForTeardown()` -> `never reached nothing left after a drop at 0 ms … live=9`
- recycle tests (iOS) -> `prepareForRecycle` keeps the handshake counts -> recycled views refuse presents: `presented=0;js=1;…drops=29;recycles=29`
- recycle tests (Android) -> no `prepareForRecycle` reset -> `expected '3' to be '0'` (`presentCount`) and `presented=0;js=1`
- mid-entry false (Android) -> `releaseSheetRoot` not called -> `never reached nothing left … roots=1`
- `BottomSheetModalHazard` (iOS) -> D35's own window removed (always in-chain) -> `never reached no Modal host left … appTop=RCTFabricModalHostViewController;modalHosts=1;unasked=1; events=[presented:false,dismiss]`
- "presents inside an RN Modal" + own-window fit (iOS) -> the same -> `expected '0' to be '1'` (`ownWindow`)
- `registry.test.js` androidViewManager -> check disabled / generated rows for every manifest -> `reports a manifest whose hand-written manager is not registered` and `keeps the generated manager out` red; `gen-registry` itself printed `NitroUiPackage.kt: BottomSheet names androidViewManager … does not register it` before the row existed
- `patch-nitrogen.test.js` content children -> `setContentView` guard off / `nitro.json` filter off -> `fails when the view is no longer the content view` red and the fixture CLI tests red
- **Not shown red:** the Android drop tests stayed green with the drop's model close, `host.drop()` *and* the recycle reset all removed — some other path I did not find takes the window down; the stays-up assertions (`staysUp`) stayed green against an unstable `confirmValueChange` (strong skipping memoises it), so that change is defensive, unproven.

## Files changed

- `src/components/BottomSheet/*` (new), `src/index.ts`, `src/components/Host/HostChildren.ts` (first `UNHOSTABLE_CONTROLS` row).
- `ios/components/BottomSheet/HybridNitroUiBottomSheet.swift` (new); `scripts/patch-nitrogen.mjs` (content children) and the patched generated `.mm`.
- `android/…/HybridNitroUiBottomSheet.kt`, `NitroUiBottomSheetViewManager.kt` (new), `NitroUiPackage.kt`.
- `scripts/registry-core.mjs` (`androidViewManager`), `scripts/real-input/{android,a11y,controls}.mjs`, `example/jest.harness.config.mjs`.
- Tests: `example/__tests__/BottomSheet.harness.tsx`, `…/isolated/BottomSheetModalHazard.harness.tsx`, `Conformance.harness.tsx`, `RealInputTests.swift`, `scripts/__tests__/{registry,patch-nitrogen,conformance}.test.js`, `src/__tests__/host.test.tsx`.
- `example/src/{BottomSheetScreen,readme-examples}.tsx`, `example/src/stories/BottomSheet.stories.tsx`, `docs/components/bottom-sheet.md`, README, screenshots, `.changeset/bottom-sheet.md`, `etc/*`.

## Follow-ups

- Bench: `present.bottom-sheet` / `mount.bottom-sheet` (C9) not built; no scenario can stamp a presentation (G11's line).
- C2: the `PresentedContainerShadowNode` (state push instead of the JS box round trip) is not built.
- Android: react-native-screens 4.30.1 `ScreenStack` crashes a fresh harness app instance at mount (`addViewAt` "child already has a parent"), sheet or no sheet; G11's run was mid-file.
- Android: the drop tests could not be shown red (see red proofs); find the fourth path that removes the window.
- Android: once, on a cold launch with Metro just started, the two-detent sheet closed itself with `presented:false`; not reproduced in three tries.
- iOS: how often the content box is re-reported during an interactive detent drag (non-`fit`) was not measured.
- iOS: an RN `Modal` on the same screen as an open in-chain sheet is expected not to present (RN presents from `reactViewController`); not measured.
- Hygiene incident: one `pkill -f "react-native start --port 8295"` on my own Metro (leased port, my process only) instead of a PID kill.

## Questions for orchestrator

1. **Patching the generated `.mm` (content children) is now load-bearing for BottomSheet**, and
   the next container (ContextMenu, Popover) needs the same. Options: (a) keep the list in
   `patch-nitrogen.mjs` (`CONTENT_CHILDREN_VIEWS`); (b) move it to a manifest key like
   `androidViewManager`; (c) upstream an option to nitrogen. Recommend (a) now, (b) when a
   second view needs it.
2. **Android react-native-screens is unmeasured.** Options: (a) a follow-up that reproduces
   the `ScreenStack` crash in a fresh instance without nitro-ui and reports it upstream; (b)
   accept iOS-only evidence. Recommend (a), small.

## Fix round 1

All seven review items. **1:** drop tests keep a probe BottomSheet mounted beside the
dropped one; a probe mounted afterwards was the recycled dropped view, and its first props
batch closed the sheet. **2:** iOS's present budget is per request, with a separate total.
**3:** the Android root passes `requestDisallowInterceptTouchEvent` up instead of setting
it (RN's `ReactRootView`), and forwards hover. A horizontal `ScrollView` stayed green
without it (RN cancels JS on its native gesture); a `TextInput` tap did not. **4:** Android
keeps one `SheetState` per presentation; adding or dropping `medium` while up applies at the
next presentation (documented). **5:** `harness:<platform>` runs `__tests__/isolated/` as a
second app launch (`scripts/harness-isolated.mjs`). That exposed a bug: the harness's own
`--testPathIgnorePatterns` replaced the config's, so the shared run had been running the
isolated files too; they are excluded by `testMatch` now. **6, 7:** Swift header corrected;
`patch-nitrogen` fails on an undeclared listed view; README resets its detent on dismiss;
the iOS report is built only once a harness has asked.

Red proofs, after the table.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1672 tests / 64 suites | `f689bee18780` | 2 m 49 s | start 3.5 / med 9.3 / max 11.9 |
| `harness:ios` | **PASS** | 301 tests / 18 suites | `f689bee18780` (ios tree) | 7 m 20 s | start 9.0 / med 4.8 / max 9.0 |
| `harness:android` | **PASS** | 350 tests / 18 suites | `f689bee18780` (android tree) | 10 m 43 s | start 7.0 / med 3.5 / max 7.0 |
| `real-input:ios` | **PASS** | — | `f689bee18780` (ios tree) | 19 m 31 s | start 3.5 / med 23.2 / max 381.2 |
| `real-input:android` | **PASS** | — | `f689bee18780` (android tree) | 25 m 60 s | start 7.0 / med 5.1 / max 40.7 |
| `harness:android:BottomSheet.harness` | stale | 26 tests / 1 suites | 67ccf97e1893 (not this tree) | 1 m 45 s | start 11.5 / med 7.4 / max 11.5 |
| `harness:android:BottomSheet.harness:-t:detents%20changed` | stale | 1 failed of 27 tests / 1 suites | b8f04a65ddf0 (not this tree) | 10.9 s | start 4.0 / med 3.8 / max 4.0 |
| `harness:android:BottomSheet.harness:-t:dropped` | stale | 3 failed of 27 tests / 1 suites | b8f04a65ddf0 (not this tree) | 38.0 s | start 3.8 / med 3.9 / max 4.0 |
| `harness:android:BottomSheetModalHazard` | stale | 2 tests / 1 suites | 4fc9d4bc1a19 (not this tree) | 16.0 s | start 11.1 / med 9.6 / max 11.1 |
| `harness:android:BottomSheetScreens` | stale | 0 tests / 1 suites | 3541b67947d2 (not this tree) | 16.1 s | start 10.9 / med 9.2 / max 10.9 |
| `harness:ios:BottomSheet.harness` | stale | 26 tests / 1 suites | 67ccf97e1893 (not this tree) | 2 m 13 s | start 9.9 / med 6.9 / max 9.9 |
| `harness:ios:BottomSheet.harness:-t:round%20after%20round` | stale | 1 failed of 26 tests / 1 suites | 4a81b081febd (not this tree) | 29.9 s | start 12.5 / med 12.6 / max 14.6 |
| `harness:ios:BottomSheetModalHazard` | stale | 2 tests / 1 suites | 4fc9d4bc1a19 (not this tree) | 18.2 s | start 9.7 / med 11.1 / max 11.1 |
| `harness:ios:BottomSheetScreens` | stale | 2 tests / 1 suites | 9774eabe8a2e (not this tree) | 17.6 s | start 19.6 / med 16.1 / max 19.6 |
| `real-input:android:--control:bottom-sheet` | stale | — | 9552728ceaa3 (not this tree) | 7 m 40 s | start 3.3 / med 4.6 / max 11.9 |
| `real-input:ios:--control:bottom-sheet` | stale | — | 2d398ef66a0e (not this tree) | 6 m 32 s | start 5.8 / med 10.4 / max 42.2 |

The five unsuffixed rows are this tree; each `harness:*` ledger line also carries its
isolated run's summary (2/2 on both). The filtered rows are red-proof and isolated runs on
earlier or mutated trees (`stale`).

`need --for review`: `need: review is satisfied on this code tree.`

- drop tests (Android) -> drop close, dispose, recycle reset removed -> `never reached nothing left after a drop at 80 ms … live=1;…roots=1`
- busy-chain rounds (iOS) -> budget per mount -> `"over" never reached round 6 … presented=1;…onScreen=0;…presentWaits=61`
- `CHECKS['bottom-sheet']` TextInput step -> no interception override -> `expected Input touches: in 1 out 1, saw Input touches: in 1 out 0`
- detents changed while up (Android) -> state not frozen -> `"change" did not stay up after medium joined the list … sheetValue=Hidden`
- full `harness:ios` -> a failing file in `isolated/` -> shared run 299 passed, isolated `1 failed`, gate FAIL with both summaries in the ledger
- `harness-isolated.test.js` -> `testPathIgnorePatterns` exclusion back -> the shared list holds `isolated/…`; exit-code rule ignoring the isolated run -> `Expected: 1 Received: 0`
- `patch-nitrogen.test.js` -> the old silent skip -> `Expected: 1 Received: 0`
