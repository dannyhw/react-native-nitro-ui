# ContextMenu

A `View` that opens a menu on a long press (G16, DECISIONS D36 and D37; design
`docs/tasks/Q6-contextmenu-design.report.md`, measured by the S3 spike).

| Platform | Native                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------ |
| iOS      | `UIContextMenuInteraction` on the view itself, with the system's lifted preview and a `UIMenu`   |
| Android  | Material 3 `DropdownMenu`, opened at the finger, in a `View` styled by React Native's own manager |

```tsx
import { ContextMenu } from 'react-native-nitro-ui';

<ContextMenu
  group={{
    actions: [
      { id: 'reply', title: 'Reply', systemImage: 'arrowshape.turn.up.left' },
      { id: 'copy', title: 'Copy text' },
    ],
    sections: [
      { id: 'danger', items: [{ id: 'delete', title: 'Delete', destructive: true }] },
    ],
  }}
  onSelect={(id) => run(id)}
  style={styles.message}
>
  <Pressable onPress={openMessage}>
    <Text>Hold this message</Text>
  </Pressable>
</ContextMenu>;
```

The children stay where they are and keep their own gestures: a tap is theirs, a scroll
is the scroll view's, and a hold that opens the menu **cancels** their touch, so a
`Pressable` inside never fires `onPress` for it. The items are Menu's `group`, as data.

## API

| Prop                 | Type                                     | Default  | Notes                                                                                         |
| -------------------- | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `group`              | `MenuGroup`                              | required | Menu's type, unchanged: see [Menu, "The group"](menu.md#the-group).                          |
| `children`           | `ReactNode`                              | —        | The content the long press is made on, laid out in place.                                    |
| `title`              | `string \| undefined`                    | —        | A header over the rows: the `UIMenu`'s title on iOS, a header row on Android.                |
| `disabled`           | `boolean \| undefined`                   | `false`  | No menu; the children keep every gesture. An open menu closes, on **both** platforms.         |
| `onSelect`           | `((id: string) => void) \| undefined`    | —        | The picked row's `id`. Fires **before** `onClose` (D32).                                     |
| `onOpen`             | `(() => void) \| undefined`              | —        | The menu opened. **Both platforms** — unlike Menu's, which is Android-only.                  |
| `onClose`            | `(() => void) \| undefined`              | —        | Once for every `onOpen`, however it closed: a pick, outside tap, Back, `disabled`, a drop.   |
| `style`              | `ViewStyle`                              | —        | A full `View` style. The box is Yoga's: there is no base style and nothing is measured.      |
| `accessible`, …      | React Native's `View` accessibility props | —       | Opt in to make the ContextMenu **one** screen-reader element with the menu on it. See below. |
| `testID`             | `string \| undefined`                    | —        | The wrapper's own, as on a `View`.                                                            |
| `hybridRef`          | `(view: handle) => void`                 | —        | **Internal.** Test seams for this repo's harness.                                             |
| `nuiPerfId`          | `number \| null \| undefined`            | `null`   | **Internal.** Instance id for perf marks.                                                     |

There is no value, no `open()` and no tap-to-open (D36 item 3): a button that opens a
menu on a tap is [Menu](menu.md). No custom preview and no `previewBackgroundColor` in v1.

## Platform mapping

**iOS.** The interaction is attached to the generated component view — the view React
Native styles and mounts the children into — once, for that view's lifetime. The Hybrid
View's own view is an empty, touch-transparent content view whose job is to find it.
There is **no** content-children patch (D36 item 5): Fabric already mounts the children
in the component view at Yoga's frames, and the patch would inset a padded ContextMenu's
children twice. The configuration is `nil` (no highlight, no menu) while `disabled` or
with no pickable rows; rows keep `group`'s order (`preferredMenuElementOrder = .fixed`,
iOS 16+); a `group` change while open is applied in place (`updateVisibleMenu`). The
lifted preview is the view itself, its corners rounded to the style's `borderRadius`
(D37 item 3).

**Android.** A hand-written `ReactViewManager` (`NitroUiContextMenuViewManager`, named
by `androidViewManager`), so the wrapper takes every prop RN's `View` takes — borders,
radius, `overflow`, `pointerEvents`, `hitSlop`. The menu is a 0 × 0 `NitroComposeHost`
kept as the wrapper's last child and hidden from Fabric's indices, composing a
`DropdownMenu` anchored to a zero-size box **at the press point** (S3 measured the
popup's top-start at the press, 0 px off). Near the bottom edge Material opens it above
the finger, and keeps it 48 dp from the window edge. The rows, headers and the popup
witness are Menu's own (`MenuRows.kt`, D36 item 4): a submenu draws inline under a
divider, as Menu's does (D29).

## The gesture

**What opens it.** A still hold: iOS's own lift (measured ~744 ms touch-down to menu,
S3 Q7); Android at `ViewConfiguration.getLongPressTimeout()` (400 ms by default, and the
user's touch-and-hold setting), with haptic feedback.

**What it does to the children.** At the open, React Native's touch is cancelled:

- iOS: the nearest `RCTSurfaceTouchHandler` is reset — React Native's own
  `_cancelTouches` — so the `Pressable` gets `onPressOut` and never `onPress`. On iOS 27
  UIKit's lift already ends React Native's touch, so the reset is unproven there (D37
  item 1; it is kept for older systems);
- Android: `NativeGestureUtil.notifyNativeGestureStarted` (JS gets one CANCEL), the
  ancestors are told not to intercept, and the rest of the gesture is the wrapper's, so a
  scroll view under an open menu does not move.

**What does not open it.** A tap; a drag that leaves the touch slop (a scroll starting on
the ContextMenu scrolls and opens nothing); a second finger; a `ScrollView` inside the
ContextMenu taking the drag. Nested ContextMenus open the innermost.

**`onLongPress` inside.** Don't put one on a child. On iOS Pressability's 500 ms comes
about 240 ms before UIKit's lift, so the child's `onLongPress` always fires and the menu
then opens over it (S3). On Android the CANCEL at 400 ms wins at the default setting, and
loses with a 1 s or 1.5 s touch-and-hold setting.

## Open and close

`onOpen` fires when the menu is shown (iOS `willDisplayMenu`, Android at recognition);
`onClose` fires exactly once for each, after `onSelect` on a pick (UIKit calls the row's
handler before `willEnd`, 10/10 in S3; `onClose` comes from the end animator's
completion). A drop while open reports `onClose` before the view goes, so open state an
app tracks never outlives the menu. Android also closes an open menu when a layout
**moves** the ContextMenu: the popup follows its anchor, and would otherwise point where
the finger never was (S3 measured 73 dp off). A scroll is not a layout move.

## Sizing

`sizing: null`: no row in `nitro-ui.sizing.json`, no declared fallback, no
`measureContent`. A ContextMenu lays out exactly like a `View` with the same style and
children — the harness holds it to a twin `View`, with padding and a border.

## Recycling and cleanup

`RecyclableView`. A reset closes the menu first (iOS `dismissMenu`, Android
`expanded = false`), then clears the rows, title, flags, counters and the press point. On
iOS the interaction stays on the component view it was recycled with: every iOS recycle
is also a drop, and an interaction removed there would leave the recycled view with no
menu. On Android React Native's own recycle removes every child, so the manager puts the
compose host back. A drop cancels a pending long press, reports the close of an open
menu and disposes the composition, which takes the popup down.

## Accessibility

A ContextMenu is not an accessibility element by default, because that would hide the
buttons inside it. Set `accessible` and an `accessibilityLabel` on the ContextMenu to make
it **one** element that carries the menu (D36 item 1):

- iOS: the view is the element, and the menu is UIKit's own on it. React Native answers
  `isAccessibilityElement` from a component's content view, so the content view answers
  with the value React Native stored on the component view (D37 item 2);
- Android: the wrapper is the focusable node, and carries `ACTION_LONG_CLICK` labelled
  "Show menu" — the action TalkBack's double-tap-and-hold sends — which opens the menu at
  its centre.

An inner focusable child keeps the focus and its own actions.

**What is verified, and how.** Only by automation (D37 item 4), on both platforms:

| Claim                                                        | iOS                                                                  | Android                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `accessible` makes it an element; without it, it is not one  | harness (`ax`: the view's own `isAccessibilityElement`)              | harness (`ax`: the wrapper is focusable)                     |
| one element carries the label, on the wrapper's box          | real input: XCUITest's tree, with nothing under the wrapper a stop   | real input: `uiautomator`'s tree, one node with the label    |
| that element can be acted on                                 | real input (enabled, hittable)                                       | real input (focusable, `long-clickable`)                     |
| it offers the menu as an action                              | harness: the view carries the `UIContextMenuInteraction`, only that  | harness: `ACTION_LONG_CLICK` "Show menu", none while disabled |
| performing that action opens the menu                        | not exercised: UIKit derives the action, and no tool here reads it   | harness: the action performed on the node opens the menu     |
| a recycled wrapper keeps no previous owner's label           | harness                                                              | harness                                                      |

**Not exercised:** VoiceOver and TalkBack themselves. Neither screen reader ran, and their
double-tap-and-hold was not performed on a device: the simulator has no VoiceOver, and the
emulator could not produce TalkBack's gesture (S3). What the table proves is the tree and
the actions a screen reader is handed, not what it does with them.

## Limits

- **No custom preview**, no `previewBackgroundColor`, no tap-to-open, no `open()`.
- **Android: no mouse or stylus right-click** (`performContextClick`); iOS gets a
  pointer's secondary click from UIKit.
- **`systemImage` is iOS-only**, and a submenu is inline on Android, as on Menu (D29).
- **Android `removeClippedSubviews`** on the ContextMenu itself is ignored, with a dev
  warning.
- **Not hostable**: a `<Host>` refuses it, because it is a `View` around React Native
  children.
- **react-native-gesture-handler** (a swipeable row with a context menu) is not measured.
