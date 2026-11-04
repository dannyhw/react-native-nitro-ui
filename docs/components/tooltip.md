# Tooltip

A tooltip the app opens next to its own views: a message, an optional title and up to
two actions (G18, Q7 Appendix C).

| Platform | Native                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------- |
| iOS      | a `UIHostingController` with SwiftUI content, presented `.popover` from a window of its own          |
| Android  | Material 3 `TooltipBox` with `PlainTooltip` (a message alone) or `RichTooltip` (a title or actions) |

```tsx
import { Tooltip } from 'react-native-nitro-ui';

const [tip, setTip] = useState(true);

<Tooltip
  isPresented={tip}
  onIsPresentedChange={setTip}
  title="Saved searches"
  message="Tap the star to keep this search."
  actions={[{ id: 'ok', title: 'Got it' }]}
>
  <StarButton />
</Tooltip>;
```

The children are the **anchor**: laid out in place inside a plain `View` that hugs them,
and they keep every touch. The tooltip points at that `View`'s box. iOS has no tooltip
control, so it gets the platform's popover; Android gets Material's tooltip. There is no
long-press or hover trigger: the app opens it, and it stays up until the user or the app
closes it.

## API

| Prop                  | Type                                            | Default  | Notes                                                                                     |
| --------------------- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `isPresented`         | `boolean`                                       | required | Controlled only. See [Presenting and dismissing](#presenting-and-dismissing).              |
| `onIsPresentedChange` | `((isPresented: boolean) => void) \| undefined` | —        | Every close the user (or the window) caused. Not called for a change the app made.        |
| `message`             | `string`                                        | required | The text, and what screen readers announce.                                               |
| `title`               | `string \| undefined`                           | none     | A title above the message. An empty string is no title.                                   |
| `actions`             | `readonly TooltipAction[] \| undefined`         | none     | Up to two `{ id, title }` buttons, in order. A dev build throws for a third or a repeated `id`; a release build keeps the first two. |
| `onAction`            | `((id: string) => void) \| undefined`           | —        | The tapped action's `id`, **before** the `onIsPresentedChange(false)` the tap causes (D32). |
| `placement`           | `'auto' \| 'above' \| 'below' \| undefined`     | `'auto'` | The preferred side. See [Placement](#placement).                                          |
| `children`            | `ReactNode`                                     | —        | The anchor.                                                                               |
| `style`, `onLayout`, … | `ViewProps`                                    | —        | Go to the wrapping `View`. Its base style is `alignSelf: 'flex-start'`; an app `style` wins. |
| `testID`              | `string \| undefined`                           | —        | On the wrapping `View`; the presented tooltip gets `<testID>-tooltip`.                    |
| `hybridRef`           | `(view: handle) => void`                        | —        | **Internal.** Read-only handle for this repo's harness.                                   |
| `nuiPerfId`           | `number \| null \| undefined`                   | `null`   | **Internal.** Instance id for perf marks.                                                 |

`TooltipAction` and `TooltipPlacement` are exported types.

The wrapper hugs its anchor because React Native's default `alignItems: 'stretch'` would
otherwise widen a wrapper around an icon to the whole row, and the tooltip would point at
the row's middle. A `style` that stretches it moves the point the tooltip aims at.
The base style also wins over a parent's `alignItems`: inside a parent that centres its
children, pass `style={{ alignSelf: 'center' }}` (the Storybook `CoachMark` story does).

## Presenting and dismissing

| What happened                                                          | What the app is told                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| The app writes `isPresented = true` / `false`                          | nothing — it opens / closes                              |
| A tap outside the tooltip                                              | `onIsPresentedChange(false)`                             |
| Back, on Android, for a tooltip with actions                           | `onIsPresentedChange(false)`                             |
| A tap on an action                                                     | `onAction(id)`, then `onIsPresentedChange(false)`        |
| Its anchor leaves its window (a push; on iOS, a full-screen `Modal` over the screen) | `onIsPresentedChange(false)`              |
| Its anchor moves — a layout change, a scroll, an animation             | nothing — the tooltip follows it                         |
| Time passes                                                            | nothing — it never closes itself                         |

- **It never times out.** Material's plain tooltip hides itself after 1.5 s by default;
  here both kinds are persistent, so the two platforms mean the same thing.
- **A refused close presents again**, with one development warning, as a dialog's does
  (D33): a parent that leaves `isPresented` true after `onIsPresentedChange(false)` gets
  the tooltip back.
- **`isPresented` true at mount** presents once, as soon as the anchor is on screen.
- **A tap outside is a close, not a pass-through, on iOS**: UIKit's popover takes the
  tap. On Android a tooltip **with actions** is focusable and takes it too; a **plain**
  one is not focusable (an open keyboard keeps its field), and whether Material also
  passes that tap on to what is under it was not measured.
- **A `Modal` closing with a tooltip inside it**: on iOS React Native keeps the closing
  `Modal`'s content mounted until its dismissal ends, so the tooltip sees its window go
  first and reports the close; on Android the content unmounts first, which reports
  nothing. Measured (`example/__tests__/isolated/TooltipModalHazard.harness.tsx`).

## Placement

`'auto'` lets iOS pick the side with room and puts Android's above the anchor (Material's
default). `'above'` and `'below'` prefer that side and **flip** to the other when the
content does not fit there — Material's position provider does this itself; on iOS the
library permits only the side that fits, since with a single permitted direction UIKit
would squeeze the content into the room on that side instead. The tooltip is centred on
the anchor where the window allows. Measured: Android puts the popup 4 dp from the
anchor (Material's `SpacingBetweenTooltipAndAnchor`), iOS leaves the arrow's gap.

**It follows its anchor.** On Android Material places the popup again whenever the
anchor moves. On iOS the popover's source is the anchor's box in the presentation
window, so the library moves it every frame while the popover is up (a `CADisplayLink`)
— and only when the anchor's box actually changed. Both are pinned by the harness for a
layout move and for a scroll. Nothing closes a tooltip whose anchor scrolls off screen:
it follows it there.

## Where iOS presents from

Always from a window of its own (`NitroUiPresentation.presentInOwnWindow`), as the
dialogs do, never from the app's presentation chain. Measured in G18: a popover in the
chain is what the app's top controller is presenting, so UIKit **refuses** an RN `Modal`
the app opens while the tooltip is up — the Modal never appears. From its own window the
`Modal` presents, takes the screen's views out of the window if it is full-screen, and
the tooltip closes and says so. The source rectangle is the anchor's box converted into
that window's root view: with the anchor itself as the source view, UIKit presented in
the app's chain after all (measured).

The isolated harness file `example/__tests__/isolated/TooltipModalHazard.harness.tsx`
closes a `Modal` while a tooltip inside it is up, and pins that no `Modal` host is left
behind (DECISIONS D35 item 5's hazard). With the popover put back in the chain, that
case did **not** strand the Modal (measured); it is kept as a pin, not as the reason.

## Platform mapping

**iOS.** The view React Native lays out is the anchor: a plain `UIView` the wrapper
fills with its own box, behind the children, with `isUserInteractionEnabled = false` and
hidden from VoiceOver. No hosting view exists until the tooltip presents. Each
presentation builds a `UIHostingController` around a SwiftUI `VStack` — the title in
`.headline`, the message, and the actions as a row of `Button`s — sized with
`sizeThatFits` at most 320 pt wide, then re-measured in place when the content changes
while it is up. `adaptivePresentationStyle` returns `.none`, so a phone keeps the
popover. A tap outside reaches the popover delegate's `presentationControllerDidDismiss`;
a dismissal UIKit makes for any other reason is caught in the controller's
`viewDidDisappear`.

**Android.** A `NitroComposeHost` composes `TooltipBox` with
`TooltipDefaults.rememberTooltipPositionProvider`, a `TooltipState(isPersistent = true)`,
`enableUserInput = false` (no long-press trigger), `focusable` and `hasAction` set for a
tooltip with actions, and an anchor `Box` the size of the host's own box. The content is
`PlainTooltip` for a message alone and `RichTooltip` (title, message, a row of
`TextButton`s) otherwise. The host is a `ReactPointerEventsView` answering
`PointerEvents.NONE`, so React Native's touch targeting skips it and every tap lands on
the children; it is not important for accessibility. A popup is part of its host's
composition, so disposing the composition takes it down.

## Sizing

`sizing: null`: no row in `nitro-ui.sizing.json`, no declared fallback, no
`measureContent`. The native view fills the wrapper (`StyleSheet.absoluteFill`), and the
wrapper's size is its children's.

## Recycling and cleanup

`RecyclableView`. A reset takes an open tooltip down without animation and resets every
prop, both event counts and the per-mount flags (the conformance suite's residue probe:
a user dismissal leaves one native event, which a kept count would use to refuse the next
owner's `isPresented`). A drop does the same and drops the callbacks first, so nothing
the teardown causes reaches JS; on iOS the presentation helper carries a dismissal to a
presentation still arriving.

## Accessibility

What this covers was checked by automation only:

- **The anchor carries no name of its own**: iOS hides the native view from VoiceOver,
  Android marks it not important for accessibility, and the in-app conformance rule
  asserts that nothing on screen carries a closed tooltip's message.
- **The presented tooltip is in the accessibility tree**: real input finds its title,
  message and action by their text, taps the action through that tree on both platforms
  (`A11Y_PRESENTATIONS`), and on iOS finds it by `<testID>-tooltip`.
- **It announces itself**: iOS posts `.screenChanged` with the tooltip's view when it
  appears; Android's content is a polite live region. These are set, not heard: no run of
  VoiceOver or TalkBack has listened to what they say, nor checked where focus goes when
  a tooltip with actions opens. That is a human pass.

## Limits

- **No trigger.** No long-press, hover or focus opening; the app sets `isPresented`.
- **Two actions at most**, Material's rich tooltip's room.
- **Not hostable**: a `<Host>` refuses it, because its anchor is the app's own views.
- **iOS is a popover, not a tooltip**: it has an arrow and takes the tap that closes it.
- **A page-sheet `Modal` opened over an open tooltip** is expected not to close it on
  iOS — the anchor stays in its window under the sheet, and the tooltip's own window is
  above it (read from the design, not measured). Close the tooltip before presenting
  over it.
- **A follow on iOS can lag a frame** behind a fast animation: the source moves on the
  display link, after the anchor did.
