# G22 — Popover

**Branch:** `task/G22-popover` (from `main` at `3e6756cb`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `LEASE_PLACEHOLDER`

## Summary

**Shipped.** `<Popover isPresented onIsPresentedChange anchor children onDismiss maxWidth testID style>`
(`src/components/Popover/Popover.tsx`), controlled through the event-count handshake with
Tooltip's refusal warning; every native prop always passed, `testID`/`nuiPerfId` as `T | null`.
`sizing: null`, `hostable: false`, `realInput: true`, `bench: false`. API table, platform
mapping and limits in `docs/components/popover.md`; README row, import, Usage section and both
screenshots.

**Sizing.** The content lays itself out in the app's own tree, capped at
`min(maxWidth ?? 320, windowWidth - 32)`, and native shows that box — there is no measuring
round-trip to wait for. iOS sets `preferredContentSize` from the content box *before*
presenting and refuses to present at all until the box has a size (bounded to 60 turns);
Android composes the popup only once the box is sized and passes
`usePlatformDefaultWidth = false`. The suite asserts the first drawn frame equals the settled
box for five fixtures (narrow, tall, short, `maxWidth`-capped, window-capped) rather than
trusting the ordering.

**Decision 1 — iOS presents from its own window**, as Tooltip does (D41), not through D35's
presentation chain. *Why:* a popover in the app's chain is what UIKit dismisses when the app
closes a `Modal`, and the next `Modal` the app opens is refused — measured for Tooltip (G18)
and re-measured here. *Tested by:* `example/__tests__/isolated/PopoverModalHazard.harness.tsx`,
which asserts `ownWindow=1` with a `ModalHostViewController` on top while both are up, and that
the window, the popover controller and every modal host are gone afterwards. The source
rectangle is the anchor's box converted into the presentation window's root, because using the
anchor as source view puts the popover back in the chain.

**Decision 2 — Android reuses BottomSheet's `NitroUiSheetRootView`** for the presented RN root
instead of extracting a shared class, as iOS already reuses `NitroUiTouchRoot` for both Tooltip
and ContextMenu. It gained a KDoc note saying a popover uses it too.

**Keyboard (D44 item 1).** Android reads `WindowInsets.Type.ime()` and keys the position
provider's `remember` on it, so the popup re-places above the keyboard and stays focusable
enough for a `TextInput` inside to bring it up; iOS leaves the move to UIKit. Documented as an
API 30+ path.

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
- DEVICE_PLACEHOLDER

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
