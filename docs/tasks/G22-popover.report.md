# G22 — Popover

**Branch:** `task/G22-popover` (from `main` at `3e6756cb`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G22-q9eoq` (pair-a: iPhone 17 / iOS 27.0, `emulator-5574`, Metro 8295)

## Summary

**Shipped.** `<Popover isPresented onIsPresentedChange anchor children onDismiss maxWidth testID style>`
(`src/components/Popover/Popover.tsx`), controlled through the event-count handshake with
Tooltip's refusal warning; every native prop always passed, `testID`/`nuiPerfId` as `T | null`.
`sizing: null`, `hostable: false`, `realInput: true`, `bench: false`. API table, platform
mapping and limits in `docs/components/popover.md`; README row, import, Usage section and both
screenshots.

**Sizing.** The content lays itself out in the app's own tree, capped at
`min(maxWidth ?? 320, windowWidth - 32)`, and native shows that box - no measuring round-trip.
iOS sets `preferredContentSize` from the content box *before*
presenting and refuses to present at all until the box has a size (bounded to 60 turns);
Android composes the popup only once the box is sized and passes
`usePlatformDefaultWidth = false`. The suite asserts the first drawn frame equals the settled
box for five fixtures (narrow, tall, short, `maxWidth`-capped, window-capped).

**Decision 1 — iOS presents from its own window**, as Tooltip does (D41), not through D35's
presentation chain. *Why:* a popover in the app's chain is what UIKit dismisses when the app
closes a `Modal`, and the next `Modal` is refused — measured for Tooltip (G18), re-measured
here. *Tested by:* `example/__tests__/isolated/PopoverModalHazard.harness.tsx`,
which asserts `ownWindow=1` with a `ModalHostViewController` on top while both are up, and that
the window, controller and modal hosts are all gone afterwards. The source
rectangle is the anchor's box converted into the presentation window's root, because using the
anchor as source view puts the popover back in the chain.

**Decision 2 — Android reuses BottomSheet's `NitroUiSheetRootView`** for the presented RN root
instead of extracting a shared class, as iOS already reuses `NitroUiTouchRoot` for both Tooltip
and ContextMenu.

**Keyboard (D44 item 1).** Android reads `WindowInsets.Type.ime()` and keys the position
provider's `remember` on it, so the popup re-places above the keyboard and stays focusable
enough for a `TextInput` inside to raise it; iOS leaves the move to UIKit. Documented as API 30+.

**What the gates found.** Three bugs only a device run showed: three of the example
screen's anchors rendered without an `onPress`, so no real tap could open their popover
(`3ec7d8af`, found by `real-input:ios` before it had ever run green); the publish manifest did
not list the built popover files, which `check`'s package step caught (`26aad5b5`); and two
fixtures read their "nothing up" baseline in the same commit as the presentation they measure
from, which reads as a leak under load (`6c1b82ff` opens them later instead).

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
  — the popup, the position provider, the IME inset, and the draw witnesses.
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

## Questions for orchestrator

None.
