# G18 — Tooltip

**Branch:** `task/G18-tooltip` (from `main` at `6f84bebf`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G18-rcjjt` (build, red proofs, `harness:ios`), then `G18-rmhr8` (`iPhone Air` /
`emulator-5570` / Metro `8293`) and `G18-uswhw` (same pair) for the remaining gates

## Summary

**Final API** (`src/components/Tooltip/Tooltip.tsx`), as Q7 C1 drew it:

```ts
export interface TooltipAction { id: string; title: string }
export type TooltipPlacement = 'auto' | 'above' | 'below';
export interface TooltipProps extends ViewProps {
  isPresented: boolean;                                // controlled, event-count handshake
  onIsPresentedChange?: (isPresented: boolean) => void; // every native close
  message: string;
  title?: string;                                      // title or actions: rich, else plain (Android)
  actions?: readonly TooltipAction[];                  // <= 2, unique ids (dev throw)
  onAction?: (id: string) => void;                     // before onIsPresentedChange(false) (D32)
  placement?: TooltipPlacement;                        // default 'auto'
  children?: ReactNode;                                // the anchor
}
```

Settled where C1 left it open: `above`/`below` flip when the content does not fit, on both
platforms. `sizing: null`, `hostable: false`, `realInput: true`, `bench: false`.

**Early checks (C9) passed:** taps reach the anchor; Android's popup sits 4 dp off (Material's
spacing); the iOS popover points at the anchor, also inside an RN `Modal`.

**Departure 1: iOS always presents from its own window**, not through the core helper's D35
chaining (C2). *Why:* measured, a popover in the app's chain made UIKit refuse the next RN
`Modal` the app opened, so the Modal never appeared. With the anchor as source view, UIKit put
the popover back in the chain, so the source is the anchor's box in the own window's root, moved
by a `CADisplayLink` while the popover is up. *Tested by:* "closes and reports when a full-screen
Modal takes its view out of the window" (the close proves the Modal came up); `presenter=ownWindow`
in the placement and check 3 tests; `TooltipModalHazard.harness.tsx`.

**Departure 2: on Android a move does not close the tooltip; it follows its anchor.** C3 and C7
item 12 asked for Picker's rule, where a move closes the tooltip. *Why:* Material's position
provider places the popup again whenever the anchor moves, so it never points where the
anchor was (C9 check 2), and iOS follows too, so both platforms agree. *Tested by:* "follows
its anchor when a layout move carries it away" and "… a scroll carries it away" (both platforms:
the popup moved, still points at the anchor, no event).

**Gates.** `real-input:ios` first went red on Picker (untouched here); the re-run passed.
`BottomSheetModalHazard` (Android) read `onDismiss` straight after `live=0`: red 4 of 4 here and
2 of 3 on the base `6f84bebf`. Approved: it now waits for the event (3 s cap).
Real input passed on `0b4960556a26`, which differs from HEAD only by that harness file.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1713 tests / 67 suites | `5456b4919ea7` | 1 m 59 s | start 5.8 / med 7.1 / max 10.0 |
| `harness:ios` | **PASS** | 367 tests / 21 suites + isolated 4 tests / 2 suites | `5456b4919ea7` (ios tree) | 9 m 26 s | start 16.1 / med 7.5 / max 26.0 |
| `harness:android` | **PASS** | 416 tests / 21 suites + isolated 4 tests / 2 suites | `5456b4919ea7` (android tree) | 11 m 33 s | start 7.6 / med 9.7 / max 52.9 |
| `real-input:ios` | stale | — | 0b4960556a26 (not this tree) | 16 m 28 s | start 5.2 / med 5.2 / max 10.0 |
| `real-input:android` | stale | — | 0b4960556a26 (not this tree) | 30 m 03 s | start 5.9 / med 3.4 / max 5.9 |
| `harness:android:BottomSheetModalHazard` | stale | 2 tests / 1 suites | 0de90f7e9371 (not this tree) | 12.8 s | start 3.1 / med 3.1 / max 3.1 |
| `harness:android:Tooltip` | stale | 6 failed of 22 tests / 1 suites | 9cd2af8d319b (not this tree) | 40.8 s | start 9.8 / med 7.7 / max 9.8 |
| `harness:android:Tooltip:-t:dropped` | stale | 22 tests / 1 suites | 768538d47e5b (not this tree) | 10.9 s | start 4.4 / med 5.5 / max 6.5 |
| `harness:android:Tooltip:-t:dropped%20while%20open` | stale | 0 tests / 1 suites | ef4da26ba078 (not this tree) | 7.2 s | start 6.2 / med 6.4 / max 6.6 |
| `harness:android:Tooltip:-t:into%20its%20entry` | stale | 0 tests / 1 suites | ef4da26ba078 (not this tree) | 6.9 s | start 6.6 / med 6.5 / max 6.6 |
| `harness:android:Tooltip:-t:never%20closes` | stale | 2 failed of 22 tests / 1 suites | 3da2a2ecbed4 (not this tree) | 20.1 s | start 6.9 / med 6.3 / max 6.9 |
| `harness:android:Tooltip:-t:never%20closes%20itself%20.rich` | stale | 1 failed of 22 tests / 1 suites | 3da2a2ecbed4 (not this tree) | 11.1 s | start 5.0 / med 5.0 / max 5.0 |
| `harness:android:Tooltip:-t:presents%20once%20when%20mounted` | stale | 1 failed of 22 tests / 1 suites | e06ae4d5dc2c (not this tree) | 8.6 s | start 4.0 / med 4.1 / max 4.2 |
| `harness:android:Tooltip:-t:recycled%20view` | stale | 0 tests / 1 suites | ef4da26ba078 (not this tree) | 6.7 s | start 6.2 / med 6.1 / max 6.2 |
| `harness:android:TooltipModalHazard` | stale | 2 failed of 2 tests / 1 suites | 3da2a2ecbed4 (not this tree) | 14.0 s | start 6.2 / med 6.3 / max 6.3 |
| `harness:ios:Tooltip` | stale | 8 failed of 22 tests / 1 suites | 18f1afff6126 (not this tree) | 1 m 13 s | start 7.2 / med 5.9 / max 7.2 |
| `harness:ios:Tooltip:-t:dropped%20while%20open` | stale | 1 failed of 22 tests / 1 suites | 77cb1afa3afa (not this tree) | 20.1 s | start 8.9 / med 8.3 / max 8.9 |
| `harness:ios:Tooltip:-t:never%20closes` | stale | 2 failed of 22 tests / 1 suites | 3da2a2ecbed4 (not this tree) | 18.8 s | start 5.6 / med 6.5 / max 6.5 |
| `harness:ios:Tooltip:-t:presents%20once%20when%20mounted%7Crecycled%20view%7Cleaves%20nothing%20when%20dropped` | stale | 6 failed of 22 tests / 1 suites | 77cb1afa3afa (not this tree) | 1 m 03 s | start 11.9 / med 10.1 / max 12.4 |
| `harness:ios:Tooltip:-t:recycled%20view` | stale | 1 failed of 22 tests / 1 suites | 094a489811c0 (not this tree) | 19.3 s | start 6.9 / med 6.5 / max 6.9 |
| `harness:ios:TooltipModalHazard` | stale | 2 failed of 2 tests / 1 suites | 9cd2af8d319b (not this tree) | 26.5 s | start 13.9 / med 12.5 / max 13.9 |
| `real-input:android:--control:tooltip` | stale | — | 9cd2af8d319b (not this tree) | 1 m 10 s | start 6.5 / med 4.6 / max 6.5 |
| `real-input:ios:--control:tooltip` | stale | — | 18f1afff6126 (not this tree) | 8 m 13 s | start 4.7 / med 27.4 / max 108.3 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

Mutation scripts were applied to the native files and the wrapper, the app rebuilt, then reverted.
Rounds J, N, D, C, S; the lines are from the gate log store.

- check 1 (both) + real-input -> J1: the overlay last, taking touches -> `leaves a tap on its anchor to the anchor` red; Android real input `the star's count says "star presses: 0"`, iOS `testRealInputTooltip` red
- barrier twin (both) -> J2: a JS close reported -> `expected 'quiet:presented:false,twin:presented:…' to be 'twin:presented:false'`
- plain kind -> J3: empty title sent as a title -> Android `expected 'rich' to be 'plain'`, iOS `expected '' to be '-'`
- refusal warns once (both) -> J5: warn on every refusal -> `presents again when the app refuses a close, and warns once` red
- placement (both) -> N1: above/below swapped -> `expected 'below' to be 'above'`
- follow (both) -> N2: iOS never follows / Android keeps its first position -> iOS `a layout move: gap 113 pt, source never moved`, Android `a layout move: gap -95.6 dp`
- action order (both) + real-input -> N3: close before action -> `expected 'act:presented:false,act:action:ok' to be 'act:action:ok,act:presented:false'`; Android real input `3 real taps on "Got it" left … action:ok` last; iOS `testRealInputTooltip` red
- message in place -> N7 (Android) / C3 (iOS, re-measure before layout) -> `expected '2' to be '1'` / `expected 69 to be greater than 69`
- drop and recycle (iOS) -> N4/N5: no `dismissForTeardown` -> `leaves nothing when dropped while open` / `… 50/100/150 ms into its entry` / `gives a recycled view none of the open tooltip` red
- drop and recycle (Android) -> N4/N5: no `drop()` disposal and no `reset()` -> the app crashed (`The app bridge disconnected`); with `drop()` alone removed the drop tests stayed green. **Not shown red by an assertion.**
- mount once (both) -> N6: present on every schedule / re-key on anchor size -> Android `expected '2' to be '1'`, iOS `presents once when mounted presented` red
- own window (iOS) -> C1: present in the app's chain, anchor as source -> `expected 'chain' to be 'ownWindow'` (placement and `TooltipModalHazard`), the full-screen Modal test red
- outside tap -> C2 (iOS) / C5 (Android): a tap outside does nothing -> iOS real input `3 real presses … left it at "none"`; Android `timed out waiting for a tap outside to take the tooltip down`
- spacing (Android) -> C4: 12 dp -> `expected 8.19 to be less than or equal to 1`
- full-screen Modal (Android) -> C6: close on window-focus loss -> `expected '0' to be '1'`
- never closes (both) -> S1 (iOS, hide after 2 s) / S2 (Material's timeout on) -> `expected 'presented=1;js=1;live=0;…' to be 'up'` (Android); iOS `never closes itself (plain)` red
- hazard event log (Android) -> S3: a dropped mount reports its window-loss close -> `TooltipModalHazard` both cases red
- `BottomSheetModalHazard` wait (Android) -> `onDismiss` never called (`BottomSheet.tsx`) -> `expected [] to deeply equal [ 'dismiss' ]` after the wait; reverted, 3 of 3 green
- Android Back -> not shown red on its own (shares `onDismissRequest` with the outside tap, whose mutation aborts first; FOLLOWUPS)

## Files changed

- Component: `src/components/Tooltip/*`, `ios/components/Tooltip/HybridNitroUiTooltip.swift`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiTooltip.kt`, `NitroUiPackage.kt`, `nitro.json`, `nitrogen/generated/**`, `src/index.ts`
- Core: `ios/core/NitroUiPresenterChain.swift` (BottomSheet's chain helpers moved here;
  `HybridNitroUiBottomSheet.swift` uses it), `src/components/Host/HostChildren.ts` (refused)
- Tests: `example/__tests__/Tooltip.harness.tsx`, `example/__tests__/isolated/TooltipModalHazard.harness.tsx`,
  `example/__tests__/Conformance.harness.tsx`, `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `scripts/real-input/{android,a11y,controls}.mjs`,
  `scripts/__tests__/conformance.test.js`, `src/__tests__/viewConfigs.test.ts`,
  `example/__tests__/isolated/BottomSheetModalHazard.harness.tsx` (waits for `onDismiss`)
- Example and docs: `TooltipScreen.tsx`, `Tooltip.stories.tsx`, `App.tsx`, `readme-examples.tsx`,
  `docs/components/tooltip.md`, `README.md`, `docs/images/components/tooltip-{ios,android}.png`,
  `.changeset/tooltip.md`, `etc/*`

## Follow-ups

- Tooltip: no bench arm; `present.tooltip` needs a present/dismiss timing helper (in FOLLOWUPS).
- iOS: a popover in the app's chain refuses the next RN `Modal`; BottomSheet presents in the chain by D35 and was not measured for it.
- Android: Tooltip drop/recycle teardown not shown red by an assertion (the mutation crashed the app).
- Android: the Back step of real input not shown red on its own.
- iOS: a page-sheet `Modal` over an open tooltip is unmeasured.
- `real-input:ios` Picker cycle 2 ("drop button raised no echo") failed once here, passed on re-run.
- Remaining lines are in `docs/tasks/FOLLOWUPS.md` under G18.

## Merge round

`task/G18-merge` from `7d7040a9`, lease `G18merge-6veff` (`G18merge-wc3ty` expired mid-run). Merged `origin/main` (Checkbox, ContextMenu, X18), X19 (`d310fc45`), then E2's main (`0081b2ad`). Conflicts kept both sides; generated files regenerated. Tooltip's tab follows X19's `TABS` navigation. X19's tab-target test now invents only components not yet landed.

The merged tree failed 11 Android Tooltip cases: material3 1.5's `TooltipBox` re-keys its content once the anchor is placed, so it composed twice (`presentCount=2`, placement wiped). Readings now follow the popup (`state.isVisible`). The recycle case now waits for the drop's pool entry before the next mount; run alone it got a fresh instance (`recycles=0`).

Item 4 not done (FOLLOWUPS). One re-run each, on earlier trees: `harness:android` (render timeout, load 51), `real-input:ios` (X19's TextField flake).

Red proofs:
- recycle reset -> `model.reset()` removed -> `expected '1' to be '0'` (`presentCount`, no crash)
- recycle oracle -> `lifetime.onRecycle()` removed -> `"recycled-dropped" never reached round 1: the dropped mount in the pool`
- Android Back -> second dismiss ignored -> `✗ timed out waiting for Back to take the tooltip down` (`focusable = false` hides the popup from the dump; the check aborts at opening)

Gates on the merged tree (main + X19 + E2 + G18); the filtered rows are the red-proof runs:

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1748 tests / 70 suites | `d651692a9c89` | 2 m 46 s | start 8.7 / med 24.9 / max 33.5 |
| `harness:ios` | **PASS** | 421 tests / 24 suites + isolated 4 tests / 2 suites | `d651692a9c89` (ios tree) | 10 m 16 s | start 4.9 / med 5.6 / max 9.0 |
| `harness:android` | **PASS** | 470 tests / 24 suites + isolated 4 tests / 2 suites | `d651692a9c89` (android tree) | 12 m 56 s | start 20.6 / med 5.6 / max 20.6 |
| `real-input:ios` | **PASS** | — | `d651692a9c89` (ios tree) | 23 m 11 s | start 4.9 / med 6.0 / max 48.1 |
| `real-input:android` | **PASS** | — | `d651692a9c89` (android tree) | 36 m 11 s | start 3.5 / med 3.4 / max 7.3 |
| `harness:android:Tooltip:-t:presents%20once%20when%20mounted` | stale | 1 failed of 22 tests / 1 suites | 0e8a0f655e2a (not this tree) | 15.6 s | start 9.5 / med 11.2 / max 12.2 |
| `harness:android:Tooltip:-t:recycled%20view` | stale | 1 failed of 22 tests / 1 suites | a14b5747a9a7 (not this tree) | 15.8 s | start 9.7 / med 9.8 / max 9.8 |
| `real-input:android:--control:tooltip` | stale | — | b9f8b3800a0a (not this tree) | 2 m 13 s | start 5.5 / med 5.6 / max 6.2 |
