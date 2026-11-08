# G22 — Popover

**Branch:** `task/G22-popover` (from `main` at `3e6756cb`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G22-q9eoq` (pair-a: iPhone 17 / iOS 27.0, `emulator-5574`, Metro 8295)

## Summary

**Shipped.** `<Popover isPresented onIsPresentedChange anchor children onDismiss maxWidth testID style>`
(`src/components/Popover/Popover.tsx`), controlled through the event-count handshake with
Tooltip's refusal warning; every native prop always passed, `testID`/`nuiPerfId` as `T | null`.
`sizing: null`, `hostable: false`, `realInput: true`, `bench: false`. `docs/components/popover.md`,
the README row, import, Usage section, both screenshots and a minor changeset.

**Sizing.** The content lays itself out in the app's own tree, capped at
`min(maxWidth ?? 320, windowWidth - 32)`, and native shows that box - no measuring round-trip.
iOS sets `preferredContentSize` before presenting and refuses to present until the box is sized;
Android composes the popup only once it is. Five fixtures (narrow, tall, short, `maxWidth`-capped,
window-capped) assert the first drawn frame equals the settled box, on both platforms.

**Decision 1 - iOS presents from its own window**, as Tooltip does (D41), not through D35's
chain: a popover in the app's chain is what UIKit dismisses when the app closes a `Modal`, and
the next `Modal` is refused - measured for Tooltip (G18), re-measured here.
`example/__tests__/isolated/PopoverModalHazard.harness.tsx` asserts `ownWindow=1` with a
`ModalHostViewController` on top while both are up, and that all three are gone afterwards.

**Decision 2 - Android reuses BottomSheet's `NitroUiSheetRootView`** for the presented RN root.

**Keyboard (D44 item 1).** The placement is arithmetic in `PopoverPlacement`, keyed on the ime
inset so an open popup places itself again; the inset is read from the window the popup is placed
in - both it and the popup's own window trigger the read - and the popup is focusable so a
`TextInput` inside can raise the keyboard. Documented as API 30+.

**What the gates found.** Seven bugs only a device run showed: three example anchors without
`onPress` (`3ec7d8af`, caught by `real-input:ios` before it had ever run green); the publish
manifest omitting the built popover files (`26aad5b5`, `check`); two fixtures reading their
"nothing up" baseline in the commit that measures it (`6c1b82ff`); a keyboard check demanding a
log *ending* in `typed:ab`, which the close it was told to do forbids (`494dced2`); an IME probe
comparing `[object Object]`, then matching a dump shape API 34+ no longer prints (`3aa02ef1`,
`f817fcc6`); **the popup flipping above an anchor that was itself behind the keyboard**, leaving
its lower edge under the keys (`bce1fd8f`); and measuring that edge from the popup's own window,
whose inset is 43 px short of the window the popup is placed in (`44330c62`).

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: GATE_PLACEHOLDER

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
- `PopoverPlacementTest.kt` "an anchor behind the keyboard does not flip the popup into it" ->
  the flip condition back to `above >= marginPx` -> that test: `expected 1085 but was 1228`, which
  is 143 px of the popup behind the keys
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
- `HybridNitroUiPopover.swift` `present()` -> `preferredContentSize = CGSize(width: 320, height: 480)`
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
  component's bench cells are left for the merge mint (X14); the report carries the
  harness-measured first-frame numbers instead.
- core: `NitroUiSheetRootView` is now shared by BottomSheet and Popover on Android; a shared
  "presented RN root" class for both platforms is worth extracting when a third control needs it.
- a11y: `accessibilityLabel` still never reaches a presented window on either platform (D44
  records it); a Popover has no label prop of its own, so the content's own names are what a
  screen reader gets.

## Appendix

- iOS's source rectangle is the anchor's box converted into the presentation window's root:
  `popoverSource.sourceView = source` (the anchor itself) puts the popover back in the app's
  presentation chain, which is what Decision 1 exists to avoid.
- Incident: while iterating on the keyboard check, a throwaway probe of mine force-stopped and
  relaunched the example while `real-input:android:--control:popover` was in its a11y sweep, and
  that sweep failed for that reason alone. Filtered runs are evidence only; the gate rows below
  are runs with nothing else on the device.

## Questions for orchestrator

None.
