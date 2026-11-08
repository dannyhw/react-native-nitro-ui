# G22 — Popover

**Branch:** `task/G22-popover` (from `main` at `3e6756cb`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G22-q9eoq` (pair-a: iPhone 17 / iOS 27.0, `emulator-5574`, Metro 8295)

## Summary

**Shipped.** `<Popover isPresented onIsPresentedChange anchor children onDismiss maxWidth testID style>`
(`src/components/Popover/Popover.tsx`), controlled through the handshake with
Tooltip's refusal warning; every native prop always passed, `testID`/`nuiPerfId` as `T | null`.
`sizing: null`, `hostable: false`, `realInput: true`, `bench: false`; docs page, README row,
import, Usage, both screenshots, changeset.

**Sizing.** The content lays itself out in the app's own tree, capped at
`min(maxWidth ?? 320, windowWidth - 32)`, and native shows that box - no measuring round-trip.
iOS sets `preferredContentSize` and refuses to present until the box is sized; Android composes
only once it is. Five fixtures (narrow, tall, short, capped two ways) assert the first drawn frame equals the settled box, on both platforms.

**Decision 1 - iOS presents from its own window**, as Tooltip does (D41), not through D35's
chain: a popover in the app's chain is what UIKit dismisses when the app closes a `Modal`, and
the next `Modal` is refused (measured for Tooltip, re-measured here).
`example/__tests__/isolated/PopoverModalHazard.harness.tsx` asserts `ownWindow=1` under a
`ModalHostViewController` while both are up, and nothing left after.

**Decision 2 - Android reuses BottomSheet's `NitroUiSheetRootView`** for the presented RN root.

**Keyboard (D44 item 1).** The placement is arithmetic in `PopoverPlacement`, against the host
window's *visible display frame* - below the status bar, stopping at the keyboard - read each
time the provider runs; the ime inset is what has an open popup place itself again.
The popup is focusable, so a `TextInput` inside raises the keyboard; the frame is everywhere,
the re-placement trigger (`ime()`) is API 30+.

**What the gates found.** Nine bugs only a device run showed: three example anchors without
`onPress` (`3ec7d8af`); the publish manifest omitting the built popover files (`26aad5b5`); two
fixtures reading their "nothing up" baseline in the commit that measures it (`6c1b82ff`); a
keyboard check demanding a log *ending* in `typed:ab` (`494dced2`); an IME probe comparing
`[object Object]`, then matching a dump shape API 34+ dropped (`3aa02ef1`, `f817fcc6`);
the popup flipping above an anchor behind the keys (`bce1fd8f`); that edge read from the
popup's own window, 43 px short (`44330c62`); and placing
against the *height* Compose hands a position provider - the frame's height with its origin
dropped and the keyboard already off it - so the popup was asked for y=60 and pinned to the top
of the screen, 985 px above its edge, while "the field stays above the keyboard" passed
(`27d1d7ae`; `328b3c22` adds the check that catches it).

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1870 tests / 77 suites | `44e2c8a666b8` | 2 m 47 s | start 7.2 / med 7.6 / max 9.1 |
| `harness:ios` | **PASS** | 484 tests / 26 suites + isolated 6 tests / 3 suites | `44e2c8a666b8` (ios tree) | 12 m 39 s | start 4.3 / med 7.2 / max 28.2 |
| `harness:android` | **PASS** | 540 tests / 26 suites + isolated 6 tests / 3 suites | `44e2c8a666b8` (android tree) | 15 m 58 s | start 4.7 / med 4.8 / max 14.5 |
| `real-input:ios` | **PASS** | — | `44e2c8a666b8` (ios tree) | 31 m 09 s | start 4.2 / med 10.0 / max 42.5 |
| `real-input:android` | **PASS** | — | `44e2c8a666b8` (android tree) | 47 m 19 s | start 6.0 / med 3.5 / max 10.5 |

Lease `G22-q9eoq`. The ledger also carries filtered runs (`harness:ios:Popover`,
`real-input:android:--control:popover`, …) on older trees: evidence from the round, satisfying
nothing, all reported `stale` by `gate.mjs table`. The device rows ran one at a time with nothing
else on the pair.

`need --for review`: satisfied on this code tree — `check` green, both harnesses green on their
platform's tree; `need` names the example's harness/screen files as counting for both platforms.

## Red proofs

- `src/__tests__/popover.test.tsx` "caps the content at the smaller of maxWidth and the window
  less its margins" -> `WINDOW_MARGIN` 16 -> 0 -> that test, 1 failing
- `src/__tests__/popover.test.tsx` "lays the content out inside the cap, not as the cap" ->
  dropped `alignItems: 'flex-start'` from the node's style -> that test, 1 failing
- `src/__tests__/popover.test.tsx` "reports a dismissal only when a presentation really ended"
  -> `if (ended)` -> `if (!ended)` -> that test, 1 failing
- `src/__tests__/popover.test.tsx` "stays quiet when the parent follows the close and opens it
  again later" -> warning condition `lastNativeWasClose.current && presented` ->
  `lastNativeWasClose.current` -> that test, 1 failing
- `src/__tests__/popover.test.tsx` "sends a null testID rather than no testID" ->
  `testID ?? null` -> `testID ?? undefined` -> that test, 1 failing
- `scripts/__tests__/patch-nitrogen.test.js` "is applied to every view that mounts React Native
  children" -> `'HybridNitroUiPopover'` removed from `CONTENT_CHILDREN_VIEWS` -> that test;
  and `nitrogen:check` -> `HybridNitroUiPopoverComponent.mm differs from codegen`
- `scripts/__tests__/patch-nitrogen.test.js`, same test -> the marker comment renamed in the
  committed `.mm` -> that test
- `scripts/__tests__/conformance.test.js` "passes as the repo stands" + "covers Dialog,
  BottomSheet, Tooltip and Popover…" -> the a11y row's `hybridView` renamed -> both; same two
  -> `Popover`'s manifest `realInput: false`
- `scripts/__tests__/component-coverage.test.js` "every manifest is covered, or has a stated
  reason" -> `selfSizing: false` removed from the Popover fixture -> that test
- `PopoverPlacementTest.kt` "anAnchorBehindTheKeyboardDoesNotFlipThePopupIntoIt" -> the flip
  condition back to `above >= minTop` alone -> that test: `expected:<1085> but was:<1221>`, which
  is 94 px of the popup behind the keys
- same file, two tests -> `usableBottom` built from the frame's *height* (`frameBottom - frameTop
  - margin`), which is the double-count as shipped -> `expected:<1085> but was:<943>` and
  `expected:<1763> but was:<1621>`
- same file "contentTooTallForTheFrameStartsAtTheFramesTopMargin" -> `minTop = marginPx`, the
  frame's origin ignored -> `expected:<184> but was:<42>`: a popup starting under the status bar
- same file "thePopupStaysInsideTheFrameHorizontally" -> `placeLeft` without the frame's left edge
  -> `expected:<142> but was:<42>`
- `scripts/__tests__/real-input-popover-placement.test.js` -> the above-anchor tolerance widened to
  2000 px -> 3 failing, among them "rejects the popup pinned to the top of the screen"
- same file -> the behind-the-keys and missing-popup guards dropped -> 2 failing: "rejects a popup
  whose own bottom is behind the keyboard", "fails when the popup is not in the dump at all"
- `scripts/__tests__/real-input-ime-frame.test.js` "says nothing about a keyboard that is not up"
  -> the `visible=true` filter dropped -> that test, `Received: 142` - the status bar, the number
  the two window-frame readers answered with on a device and the reason it may never be answered
- same file, "will not take another inset type for the keyboard" -> `type=ime` matched as any type
  -> that test
- same file, "takes the strictest answer when a dump carries more than one window" -> `<` -> `>` ->
  that test
- the keyboard check as shipped -> both real-input runs red on a claim that cannot be true:
  `real-input:ios` at "real keystrokes reach the field inside the popover: ... typed:a >
  typed:ab > field:presented:false" (the log it demanded *ends* with `typed:ab`, which the
  screen's record of the close it was told to do forbids), and the same line in
  `scripts/real-input/android.mjs` -> `494dced2` reads the order instead
- `scripts/real-input/android.mjs`'s IME probes -> `shell()` returns `{ stdout }` ->
  `real-input:android -- --control popover` red at "a real tap on the TextInput inside the
  popover brings up the keyboard - expected true, saw false" and then
  `TypeError: text.match is not a function`; with that fixed, red again on "nothing reported the
  keyboard frame" until the API 34+ dump shape was learned -> `3aa02ef1`, `f817fcc6`
- `HybridNitroUiPopover.swift` `presentIfPossible()` -> `preferredContentSize = CGSize(width: 320, height: 480)`
  (what UIKit picks when nothing is asked for) -> all five "the first frame is the final size"
  fixtures red at the drawn-size check, plus "opens below its anchor":
  `expected 134 to be less than 96`
- `HybridNitroUiPopover.swift` `onDropView` -> callbacks cleared *after* `teardown()` with the
  controller's `onGone` kept alive -> "leaves nothing when dropped 80 ms / 150 ms into the entry"
  and "reports nothing for a popover dropped while it is presented (D44 item 2)" red, each naming
  the `controllers=14/15/16` the run left behind
- `HybridNitroUiPopover.swift` -> `popoverSource.sourceView = source` (a view in the app's own
  window) -> `harness:ios:PopoverModalHazard` 2/2 red (`expected 'NitroUiPopoverController' to
  contain 'ModalHostViewController'`), and three ordinary Popover tests red because the *second*
  popover in a file never appears (`viewW=0`, `popRect=-`): D35's chain really is what UIKit
  takes down. Tree `d57c8b115df1`.
- `HybridNitroUiPopover.kt` `Component` -> `contentWpx < 0` (compose at an unsized box) -> all
  five first-frame fixtures red: `expected ['0x0', '389x252'] to have a length of 1 but got 2`
- `HybridNitroUiPopover.kt` `onDropView` -> `host.drop()` skipped -> the three "leaves nothing when
  dropped _N_ ms into the entry" tests and "reports nothing for a popover dropped while it is
  presented (D44 item 2)" red: `"drop-open" never reached its view dropped by Fabric; ...
  drops=0;recycles=22`. Tree `1ace1bfbdd79`.
- Android's `onDropView` clears its callbacks *before* dropping (D44 item 2's reason) - and the
  order is **not** observable: swapping it (callbacks cleared after `host.drop()`) left all 24
  Android fixtures green (tree `77566d55c79e`), so the suite pins the teardown, not the ordering.
  The iOS side of that ordering *is* pinned, two lines above.
- `PopoverScreen.tsx` -> three anchors rendered with no `onPress` -> both real-input checks red on
  their first-ever run for this control: `real-input:android` at "the real tap that opens the
  popover: 3 real taps opened nothing" and `real-input:ios` at "3 real presses on the popover's
  anchor (popover-short-anchor) left it at 0 row(s) named \"Do the thing\"" - the check found the
  example screen's bug (`3ec7d8af`) before it could pass

## Files changed

- `src/components/Popover/*`, `src/index.ts`, `src/components/Host/HostChildren.ts` — the
  component, its spec, its manifest, and the Host refusal list that now names it.
- `ios/components/Popover/HybridNitroUiPopover.swift` — the popover controller, its own window,
  the sampler that watches the content box, and the report the harness reads.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPopover.kt` + `NitroUiPopoverViewManager.kt`
  — the popup, `PopoverPlacement`, the IME inset and its two observers, and the draw witnesses.
- `android/src/test/java/com/margelo/nitro/nitroui/PopoverPlacementTest.kt` — the placement rule, on the geometry a device produced.
- `scripts/real-input/popover-placement.mjs` + `scripts/__tests__/real-input-popover-placement.test.js`
  — the popup's box judged from outside the process: against its anchor, or against the
  keyboard's edge, with the parked popup as one of the fixtures.
- `scripts/patch-nitrogen.mjs`, `scripts/__tests__/patch-nitrogen.test.js` — the content-children
  patch extended to the popover's generated `.mm`, with the expected set in the test.
- `example/__tests__/Popover.harness.tsx`, `example/__tests__/isolated/PopoverModalHazard.harness.tsx`,
  `example/__tests__/Conformance.harness.tsx`, `src/__tests__/popover.test.tsx`.
- `scripts/real-input/{a11y.mjs,android.mjs,screens.mjs}`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the real-input checks and the
  presentation-aware a11y row.
- `example/src/PopoverScreen.tsx`, `example/src/stories/Popover.stories.tsx`, `README.md`,
  `docs/components/popover.md`, `docs/images/components/popover-*.png`, `.changeset/g22-popover.md`.

## Follow-ups

- tests: iOS's "don't present at a zero-sized box" guard has no device fixture that reaches it -
  `size.width <= 0` -> `< 0` changed nothing observable, because the wrapper has the box laid out
  before the present. Android's identical guard does go red (five fixtures, above), so the
  ordering is pinned on one platform and untested on the other.
- tests: `unheard` asserts `['unheard:dismiss']` on both platforms - a popover the app never heard
  about still reports the presentation that ended. Suppressing it would be a spec change, so the
  suite reads it as shipped.
- bench: `bench: false`, so the brief's comparison against `react-native-popover-view` and the
  component's bench cells are left for the merge mint (X14), and no Popover row is minted on
  this machine either. The first-frame claim is therefore only carried here as the harness
  measurement it is: five fixtures x two platforms, each asserting one distinct drawn size
  equal to the box (`firstDrawMs`/`contentWaits` in each report), which is a correctness claim
  and not a benchmark.
- core: `NitroUiSheetRootView` is now shared by BottomSheet and Popover on Android; a shared
  "presented RN root" class for both platforms is worth extracting when a third control needs it.
- a11y: `accessibilityLabel` still never reaches a presented window on either platform (D44
  records it); a Popover has no label prop of its own, so the content's own names are what a
  screen reader gets.
- core: `Tooltip` and `Menu` place through Material's position provider, which is handed the same
  size-without-an-origin (`PopupLayout.getDisplayBounds`) and so has the same blind spot Popover
  had; worth a look at whether either of their placements is a status bar out on a device whose
  frame is not its window.

## Appendix

- iOS's source rectangle is the anchor's box converted into the presentation window's root:
  `popoverSource.sourceView = source` (the anchor itself) puts the popover back in the app's
  presentation chain, which is what Decision 1 exists to avoid.
- The coordinate space, measured on the API 35 emulator so the next reader does not have to:
  `PopupLayout.updatePosition` asks the host window for its visible display frame, keeps the
  *size* as `windowSize` (2219 px tall with no keyboard, 1399 with one, of a 2424 px screen) and
  puts the provider's answer straight into the popup window's `LayoutParams.x/y`, measured from
  the window's own top edge. `getWindowVisibleDisplayFrame` on the same view answers
  `[0,142][1080,2361]` and `[0,142][1080,1541]`: the two edges the placement needed, and the
  keyboard's own top is the frame's bottom. A y of 60 draws at 142, because the window manager
  will not put a popup over the status bar.
- **That paragraph said "a y of 1763 draws at screen 1763", and fix round 1 removed it: it is
  only true of a host window at the screen's origin.** The frame above is in *screen*
  coordinates, `anchorBounds` and the returned offset are the *window*'s, and every fixture this
  repo has ever run has the RN window at (0, 0), where the two are the same numbers. `27d1d7ae`
  fixed the frame's *height* and left its origin dropped, which is the same bug one coordinate
  further along; `PopoverPlacement.windowFrame` now subtracts the host's `rootView` location, and
  `PopoverPlacementTest.theVisibleFrameIsConvertedIntoTheWindowThatHostsThePopover` runs a window
  at screen y = 1200, where the two answers are 275 and 897.
- Incident: while iterating on the keyboard check, a throwaway probe of mine force-stopped and
  relaunched the example while `real-input:android:--control:popover` was in its a11y sweep, and
  that sweep failed for that reason alone. Filtered runs are evidence only; the gate rows below
  are runs with nothing else on the device.

## Questions for orchestrator

None.
