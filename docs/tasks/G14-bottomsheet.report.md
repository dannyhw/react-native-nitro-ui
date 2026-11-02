# G14 — BottomSheet

**Branch:** `task/G14-bottomsheet` (from `main` at `9375659`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G14-ndzag` (pair-a: iOS `49D5024D` / `emulator-5574` / Metro `8295`)

## Summary

`BottomSheet` ships to Appendix C as amended by D35: `isPresented` behind the event-count
handshake, detents in SwiftUI's names (`'fit'` default, `'medium'`, `'large'`, `{ height }`,
`{ fraction }`; index reported via `onDetentChange`, not controlled), `onDismiss` once the
sheet has gone, `dismissible`, `showsGrabber`, `cornerRadius`, `containerColor`,
`accessibilityLabel` (names the sheet, not a box), `testID` (`<testID>-sheet`). Content is
mounted only while presented. Not hostable; `sizing: null`. No `style` prop (the node is the
content box; a background on it would paint the app window) — deviation from C1's `ViewProps`.

**Decision a reviewer must read — S2's iOS mount premise was wrong.** In RN 0.88
`RCTViewComponentView` mounts children into `currentContainerView`, which is the component
view itself, *beside* the Hybrid View's `contentView`: S2's children never moved into the
sheet (its witnesses read the container, not the children). `patch-nitrogen.mjs` gains a
content-children step (C2's original `.mm` plan) that mounts them into the content view;
hard-fails on a missing anchor or a generated override. Real input now presses a `Pressable`
inside the sheet with a real finger on both platforms.

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

**Isolation:** `__tests__/isolated/` is left out of the shared harness run
(`jest.harness.config.mjs`); `NITRO_UI_HARNESS_ISOLATED=1` runs it alone. The stranded-Modal
case lives there; with D35's rule removed it reproduces the strand and the next test in that
instance cannot present.

**react-native-screens 4.30.1** (commit `edb090b`, reverted `9174970`): iOS — in-chain from a
native-stack screen, a push closes and reports, a `formSheet` closing under the sheet leaves
nothing. Android — not measured: `ScreenStack` crashes this app instance at mount
(`addViewAt … child already has a parent`) with or without a sheet in it.

Bench arms: not built (FOLLOWUPS line). README screenshots are the Storybook story
`FitsItsContent` (light, opened on mount by an uncommitted local tweak), full-width crops
scaled to 804 px (iOS, 3x) and 720 px (Android), because a sheet is screen-wide.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1666 tests / 63 suites | `4fc9d4bc1a19` | 2 m 45 s | start 3.2 / med 6.8 / max 11.3 |
| `harness:ios` | **PASS** | 301 tests / 19 suites | `4fc9d4bc1a19` (ios tree) | 6 m 51 s | start 7.5 / med 4.6 / max 13.9 |
| `harness:android` | **PASS** | 350 tests / 19 suites | `4fc9d4bc1a19` (android tree) | 10 m 57 s | start 14.9 / med 5.7 / max 24.1 |
| `real-input:ios` | **PASS** | — | `4fc9d4bc1a19` (ios tree) | 18 m 26 s | start 3.6 / med 5.5 / max 38.1 |
| `real-input:android` | **PASS** | — | `4fc9d4bc1a19` (android tree) | 25 m 36 s | start 3.9 / med 3.5 / max 14.8 |
| `harness:android:BottomSheet.harness` | stale | 10 failed of 24 tests / 1 suites | 32079ce34574 (not this tree) | 1 m 42 s | start 4.4 / med 3.8 / max 4.5 |
| `harness:android:BottomSheetModalHazard` | **PASS** | 2 tests / 1 suites | `4fc9d4bc1a19` (android tree) | 16.0 s | start 11.1 / med 9.6 / max 11.1 |
| `harness:android:BottomSheetScreens` | stale | 0 tests / 1 suites | 3541b67947d2 (not this tree) | 16.1 s | start 10.9 / med 9.2 / max 10.9 |
| `harness:ios:BottomSheet.harness` | stale | 7 failed of 24 tests / 1 suites | e8e6e1149cbe (not this tree) | 2 m 24 s | start 7.8 / med 5.6 / max 7.8 |
| `harness:ios:BottomSheetModalHazard` | **PASS** | 2 tests / 1 suites | `4fc9d4bc1a19` (ios tree) | 18.2 s | start 9.7 / med 11.1 / max 11.1 |
| `harness:ios:BottomSheetScreens` | stale | 2 tests / 1 suites | 9774eabe8a2e (not this tree) | 17.6 s | start 19.6 / med 16.1 / max 19.6 |
| `real-input:android:--control:bottom-sheet` | stale | — | 73ea5130b01e (not this tree) | 2 m 57 s | start 6.8 / med 3.0 / max 6.8 |
| `real-input:ios:--control:bottom-sheet` | stale | — | 2d398ef66a0e (not this tree) | 6 m 32 s | start 5.8 / med 10.4 / max 42.2 |

The five unsuffixed rows are the final code tree. The filtered rows are the isolated and
red-proof runs: `BottomSheetModalHazard` passed 2/2 on both platforms on this tree before the
README screenshots (docs only) were retaken, and its `stale` iOS row with 2 failed is the D35
mutation; the other `stale` rows with failures are the mutated trees under Red proofs;
`BottomSheetScreens` is the reverted react-native-screens commit (iOS 2/2; Android 0 tests,
the `ScreenStack` crash).

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
