# BottomSheet

A modal sheet whose content is React Native (G14, DECISIONS D33 and D35).

| Platform | Native                                                                                     |
| -------- | ------------------------------------------------------------------------------------------ |
| iOS      | a `UIViewController` presented `.pageSheet`, configured through `UISheetPresentationController` |
| Android  | Material 3 `ModalBottomSheet`, the content in an `AndroidView` root                         |

```tsx
import { BottomSheet } from 'react-native-nitro-ui';

const [open, setOpen] = useState(false);

<BottomSheet
  isPresented={open}
  onIsPresentedChange={setOpen}
  detents={['medium', 'large']}
>
  <Text>Anything React Native can render</Text>
</BottomSheet>;
```

The children are laid out at the sheet's width, take touches like any other view, and
are mounted only while the sheet is up. The component has no box of its own in the
screen that renders it.

## API

| Prop                  | Type                                          | Default    | Notes                                                                                   |
| --------------------- | --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `isPresented`         | `boolean`                                     | required   | Controlled only. See [Presenting and dismissing](#presenting-and-dismissing).            |
| `onIsPresentedChange` | `((isPresented: boolean) => void) \| undefined` | —        | Every **native** close. Not called for a change the app made.                           |
| `children`            | `ReactNode`                                   | —          | The content. Mounted from `isPresented` turning true until the sheet has gone.          |
| `detents`             | `BottomSheetDetent[]`                         | `['fit']`  | Smallest first; the sheet opens at the first. See [Detents](#detents).                  |
| `onDetentChange`      | `((index: number) => void) \| undefined`      | —          | Index into `detents` after a **drag** to another detent. Reported, not controlled.      |
| `onDismiss`           | `(() => void) \| undefined`                   | —          | The sheet has gone, however it was closed. The content unmounts at the same moment.     |
| `dismissible`         | `boolean \| undefined`                        | `true`     | Whether a swipe down, a tap outside and Back close it.                                  |
| `showsGrabber`        | `boolean \| undefined`                        | `true`     | iOS `prefersGrabberVisible`; Android's drag handle.                                     |
| `cornerRadius`        | `number \| undefined`                         | platform   | iOS `preferredCornerRadius`; Android's top-corner shape.                                |
| `containerColor`      | `ColorValue \| undefined`                     | platform   | The sheet background (`systemBackground`; Material's `ContainerColor`).                 |
| `accessibilityLabel`  | `string \| undefined`                         | —          | Names the **sheet** (VoiceOver `.screenChanged`; TalkBack `paneTitle`), not a box.      |
| `testID`              | `string \| undefined`                         | —          | The presented sheet gets `<testID>-sheet`.                                              |
| `hybridRef`           | `(view: handle) => void`                      | —          | **Internal.** Read-only handle for this repo's harness.                                 |
| `nuiPerfId`           | `number \| null \| undefined`                 | `null`     | **Internal.** Instance id for perf marks.                                               |

There is no `style`: the node React Native lays out *is* the content's box, sized from
what the sheet reports, and a background or border on it would draw in the app's
window, not the sheet. Put padding and backgrounds on a `View` inside.

## Detents

SwiftUI's names, because the platform's names win where they differ (PLAN principle 1).

```ts
type BottomSheetDetent =
  | 'fit' // as tall as the content, and following it
  | 'medium' // about half the screen
  | 'large' // the full sheet
  | { height: number } // points, clamped to the largest a sheet can be
  | { fraction: number }; // share of the largest height, 0 < f <= 1
```

List them smallest first: the sheet opens at the first, and UIKit expects them in
order. A development build throws for an empty list, a repeat or an invalid size, and
warns for a list it can tell is out of order (`medium` after `large`, say).

| Detent                    | iOS 16+                                   | iOS 15             | Android (Material 3)                                              |
| ------------------------- | ----------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `'fit'`                   | custom detent: the content's height        | `large`            | expanded, the content at its own height                            |
| `'medium'`                | `.medium()`                               | `.medium()`        | `PartiallyExpanded` (half the window)                              |
| `'large'`                 | `.large()`                                | `.large()`         | expanded, the content at the sheet's full height                   |
| `{ height }`              | custom detent                             | `large`            | expanded, the content at that height                               |
| `{ fraction }`            | custom detent, `maximumDetentValue * f`   | `large`            | expanded, the content at that share of the sheet                   |

**Android has two rest positions**, `PartiallyExpanded` and `Expanded` (D33): `'medium'`
is the first, and the *largest* other detent is the second. A development build warns
when a list has more than one non-`medium` detent, because only the largest is used.
`['medium']` alone opens expanded at half height, since Material has no way to rest at
half without a taller detent above it. **Back steps down a detent first** on Android:
from the expanded detent it returns to `medium` (reported as `onDetentChange`), and the
next Back closes the sheet. That is Material's own behaviour.

`onDetentChange` reports a drag only — never the detent the sheet opens at, and never a
change the app made.

## Layout

The content is laid out at the sheet's width, through a round trip: native reports the
box the sheet gives its content (`onContentBox`), and the wrapper writes it into the
node's `style`, so Yoga lays the children out there (S2's mechanism). Before native has
said, the width is the window's (iOS) or `min(window, 640)` (Android's
`SheetMaxWidth`), which is the right answer on a phone, so a `fit` sheet's first frame is
already its content's height. Native's own report corrects it where that guess is wrong —
an iPad's page sheet, a landscape safe area.

- **`'fit'`**: Yoga sizes the node from the children; the sheet follows. On iOS the
  custom detent reads the content view's height each time UIKit resolves it, and every
  change of that height asks UIKit to resolve again (`invalidateDetents()`). The same
  holds in a window of its own (below): S2 measured that case moving by 0 pt; it now
  follows, +160 pt for 160 pt of rows, on both paths (`BottomSheet.harness.tsx`).
- **Any other list**: the node is the box's height. On iOS that is the current
  detent's safe area, so the content is laid out again when the sheet moves to another
  detent (how often during a drag was not measured); on Android it is the expanded
  height, with the half-expanded sheet showing its top.
- iOS presents one turn after the commit that asked for it, so the layout of content
  mounted in that same commit is in place before UIKit first resolves a `fit` detent.

## Presenting and dismissing

| What happened                                        | What the app is told                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| The app writes `isPresented = true`                  | nothing — the sheet presents                                 |
| The app writes `isPresented = false`                 | `onDismiss` once it has gone                                 |
| A swipe down, a tap outside, Back (while `dismissible`) | `onIsPresentedChange(false)`, then `onDismiss`             |
| A drag to another detent                             | `onDetentChange(index)`                                      |
| Its place in the app leaves the window (a push, a full-screen `Modal`) | `onIsPresentedChange(false)`, then `onDismiss` |
| A presented controller under it is dismissed (iOS)   | `onIsPresentedChange(false)`, then `onDismiss`               |

- **A refused dismissal presents again**, with one development warning, as a dialog's
  does (D33). The content stays mounted: the app never stopped asking for it.
- **An exit the app did not ask for** is recognised on iOS from
  `presentationControllerWillDismiss`/`DidDismiss` (a swipe or an outside tap) and from
  `isBeingDismissed` in `viewDidDisappear` (anything else), never from a view merely
  leaving the screen (D35 item 2).
- **`isPresented` true at mount** presents once the component's place in the app is in a
  window.

## Where iOS presents from (D35)

In the screen's own presentation chain — from the top-most presented controller of the
window the component is in — **unless that controller is an RN `Modal`'s host**; then
from a window of its own at `.alert + 1` (`ios/core/NitroUiPresentation.swift`, G11's
helper). React Native closes a `Modal` by dismissing *its own* controller, and a sheet in
that controller's chain is what UIKit would dismiss instead, leaving the `Modal` on screen
for good. The isolated harness file `example/__tests__/isolated/BottomSheetModalHazard`
closes a `Modal` under an open sheet; with the own-window rule removed it reproduces the
strand (`modalHosts=1`), which is why it runs in an app instance of its own.

One consequence of presenting in the chain, read from RN's source and not measured: an
RN `Modal` rendered on the *same screen* as an open sheet presents from that screen's
controller (`RCTModalHostViewComponentView` uses `reactViewController`), which is already
presenting the sheet, so UIKit would refuse it — the rule two RN `Modal`s on one screen
already live by. A `Modal` that must open over a sheet belongs inside the sheet's
content.

**react-native-screens** (measured with 4.30.1 added for one commit and reverted, D35
item 3): on iOS a sheet presents in a native-stack screen's chain, a push over that
screen closes it and reports the close, and a `formSheet` closing under a sheet
presented over it leaves nothing. On Android the measurement did not run: 4.30.1's
`ScreenStack` failed to mount in that app instance with or without a sheet in it.

## Platform mapping

**iOS.** The Hybrid View's own view is the content view; the generated component mounts
the children *into* it (a `patch-nitrogen` step: `RCTViewComponentView` would otherwise
mount them beside it), and the sheet's controller adopts it while it is up and hands it
back, hidden, after. A `0 × 0` anchor stays in the app's tree to know when the
component's place gains or loses a window. The controller owns an `RCTSurfaceTouchHandler`
for the content, as RN's `Modal` controller does, detached when the sheet goes.
`isModalInPresentation = !dismissible`; `largestUndimmedDetentIdentifier = nil` (modal);
`prefersScrollingExpandsWhenScrolledToEdge = true`.

**Android.** A hand-written `ViewGroupManager` (`NitroUiBottomSheetViewManager`, named by
`androidViewManager` in `component.json`) redirects the children into a
`NitroUiSheetRootView` — React Native's `Modal` root, copied: a `RootView` with its own
`JSTouchDispatcher` and `JSPointerDispatcher` — which sits in the sheet as an
`AndroidView` with a nested-scroll interop connection. The host is a `NitroComposeHost`:
the sheet is a window its composition composes, so disposing the composition takes the
window down. `dismissible = false` maps to `ModalBottomSheetProperties(
shouldDismissOnBackPress = false, shouldDismissOnClickOutside = false)` and a
`confirmValueChange` that refuses `Hidden`. A `ScrollView` inside hands a drag at its top
edge to the sheet with `nestedScrollEnabled`.

## Sizing

`sizing: null`: no row in `nitro-ui.sizing.json`, no declared fallback, no
`measureContent`. The node's box comes from what the sheet reports, through JS (above).

## Recycling and cleanup

`RecyclableView`. A reset closes without animation, takes the content view out of the
dismissed sheet and back into its component view, and resets every prop, both event
counts and the per-mount flags (the conformance suite's residue probe: a user dismissal
leaves one native event, which a kept count would use to refuse the next owner's
`isPresented`). A drop closes the same way and drops the callbacks; on iOS the
presentation helper hides a sheet that is still arriving and carries the dismissal to its
completion.

## Accessibility

The sheet is modal to VoiceOver (`accessibilityViewIsModal`); `accessibilityLabel` is
posted with `.screenChanged` on present and names the sheet's view. On Android it is the
sheet's `paneTitle`. The content keeps React Native's own accessibility, and real input
reads and presses it through the accessibility tree on both platforms
(`A11Y_PRESENTATIONS`). What TalkBack and VoiceOver say is a human pass.

## Limits

- **The selected detent is reported, not controlled.** Moving the sheet from JS needs a
  method with a main-thread hop; not in v1.
- **Android: two detents**, and Back steps down before it closes (above).
- **iOS 15** shows `fit`, `{ height }` and `{ fraction }` as `large`.
- **No `keepMounted`**: the content mounts with each presentation (D33).
- **Not hostable**: a `<Host>` refuses it, because its content is React Native views.
- **An RN `Modal` on the same screen** as an open sheet is expected not to open over it
  on iOS (above; not measured).
