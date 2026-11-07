# Popover

| Platform | Native                                                                            |
| -------- | --------------------------------------------------------------------------------- |
| iOS      | `UIPopoverPresentationController`, presented from a window of its own             |
| Android  | a Compose `Popup` under a Material 3 `Surface`, with this library's own position provider |

A popover is a small bubble anchored to one of your views, whose content is React
Native views rather than a string. Menus that are not lists, a confirm that belongs
to a row, a field that renames the thing it sits next to.

- [API](#api)
- [Presenting and dismissing](#presenting-and-dismissing)
- [Sizing](#sizing)
- [Placement](#placement)
- [Where iOS presents from](#where-ios-presents-from)
- [Platform mapping](#platform-mapping)
- [Recycling and cleanup](#recycling-and-cleanup)
- [Accessibility](#accessibility)
- [Limits](#limits)

## API

| Prop                  | Type                                        | Default  | Notes                                                                                    |
| --------------------- | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `isPresented`         | `boolean`                                   | required | Controlled only. See [Presenting and dismissing](#presenting-and-dismissing).             |
| `onIsPresentedChange` | `((isPresented: boolean) => void) \| undefined` | —      | Every close the user (or the window) caused. Not called for a change the app made.        |
| `anchor`              | `ReactNode`                                 | required | The element the popover points at. It stays in the app's own layout.                      |
| `children`            | `ReactNode \| undefined`                    | —        | The popover's content, laid out in the app's tree before the popover shows it.            |
| `onDismiss`           | `(() => void) \| undefined`                 | —        | The popover has gone, however it was closed.                                              |
| `maxWidth`            | `number \| undefined`                       | `320`    | The widest the content may be, in points. Never more than the window less 32 either.      |
| `testID`              | `string \| undefined`                       | —        | The presented popover's content is `<testID>-popover`. The wrapper carries no id.         |
| `style`               | `StyleProp<ViewStyle> \| undefined`         | —        | For the wrapper around the anchor. Its base style is `alignSelf: 'flex-start'`; this wins.|
| `hybridRef`           | `(view: handle) => void`                    | —        | **Internal.** Read-only handle for this repo's harness.                                   |
| `nuiPerfId`           | `number \| null \| undefined`               | `null`   | **Internal.** Instance id for perf marks.                                                 |

## Presenting and dismissing

`isPresented` is a controlled value behind the same event-count handshake the rest of
the library uses, so native shows what the user did immediately and JS catches up in
the next render rather than the other way round.

| What happened                                                          | What the app is told                              |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| The app writes `isPresented = true` / `false`                          | nothing — it opens / closes                       |
| A tap outside the popover                                              | `onIsPresentedChange(false)`, then `onDismiss`    |
| Back, on Android                                                       | `onIsPresentedChange(false)`, then `onDismiss`    |
| Its anchor leaves its window (a push; a `Modal` over the screen)        | `onIsPresentedChange(false)`, then `onDismiss`    |
| Its own view is unmounted while it is up                                | **nothing** — it closes silently                  |
| The content's box changes while it is up                                | nothing — the popover resizes to it               |

Keep `isPresented` in step with `onIsPresentedChange`. A parent that leaves it `true`
after a close gets the popover back — the app's wish always wins over the user's — and
a dev build warns once about it.

The last row is [BottomSheet's rule](bottom-sheet.md), and it is deliberate: an
unmounted popover has no handler left to receive a close, and on iOS a close sent from
that teardown arrived while the app's next screen was being installed.

`children` are mounted from the render that asks for presentation and stay mounted
until native says the popover has gone, so they survive the exit animation and cost
nothing once it has.

## Sizing

Nothing is measured on the native side. The wrapper renders `children` in the app's own
tree, inside a box of `min(maxWidth, window width - 32)` with `alignItems:
'flex-start'`, so Yoga lays the content out at its own width (at most that cap) and its
own height. Native reads that box and makes the popover exactly that size:

- **iOS** sets `preferredContentSize` from it *before* presenting, one turn after the
  commit that mounted the content, and waits for a layout rather than presenting without
  one.
- **Android** composes the `Popup` only once the box has a size, and at that size.

Because the box is sized by its content, the content has to bring a width of its own.
`width: '100%'` asks a box whose width is still unknown for a share of it, which resolves
to nothing: native gets a box with no width, and waits for a layout rather than presenting
a popover of nothing. Say how wide the row is, or let a `Text` decide — `maxWidth` is
already there to stop it being too wide.

That ordering is the whole reason the first frame is the final size. Present first and
iOS shows its default 320×480 for a frame before resizing; compose first and Android
draws one width and then the real one. The device suite counts *distinct drawn sizes*
per presentation and requires exactly one.

A content box that changes while the popover is up resizes it on both platforms.

## Placement

Both platforms put the popover below the anchor, start-aligned, and above it when there
is no room below. Android's position provider also keeps the popover inside the window
and above the keyboard: it reads the keyboard's height from the popup's own window and
places the open popover again when it changes, so a `TextInput` inside a popover is
never under the keyboard (DECISIONS D44 item 1).

iOS lets UIKit place the popover and permits the `.up` and `.down` arrows, which is the
same rule with an arrow on it; a wide regular-width window is still placed by UIKit's
own preference.

There is no `placement` prop: unlike a tooltip, a popover's arrow points at something
specific, and the two directions the arrow can take already cover the cases.

## Where iOS presents from

A window of its own, as [Tooltip](tooltip.md#where-ios-presents-from) does. React Native
closes a `Modal` by dismissing *its own* controller, and a popover sitting in that
controller's chain is what UIKit dismisses instead — and, measured for Tooltip, a
popover left in the chain is also what makes UIKit refuse the *next* `Modal` the app
opens. Presenting from its own window takes the popover out of the chain entirely, so
closing a `Modal` reaches the `Modal` and nothing else.

The consequence is that the anchor's own view cannot be the popover's source: UIKit
would put the popover back in the app's chain. So the source rectangle is the anchor's
box, expressed in the presentation window's root view.

## Platform mapping

| Concept        | iOS                                                        | Android                                                          |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| The bubble     | `UIPopoverPresentationController`, `.none` adaptive style   | a `Popup` window with a Material 3 `Surface`                      |
| Its size       | `preferredContentSize`, set from the box before presenting | `PopupProperties(usePlatformDefaultWidth: false)` at the box       |
| Where content goes | the content box is moved into the presentation's view  | the content is moved into the popup's window                       |
| Anchoring      | `sourceRect` from the wrapper's box, `.up` / `.down` arrow | our own `PopupPositionProvider`                                    |
| Keyboard       | UIKit moves the popover                                      | the position provider re-places it above `WindowInsets.Type.ime()` |
| Focus          | the popover's own window                                    | `focusable = true`, so a `TextInput` inside gets the keyboard      |
| Content root   | the app's own views, moved                                  | one React Native root per presentation, released on dispose        |

## Recycling and cleanup

`RecyclableView` with a full reset: the callbacks, the handshake, the box and every
witness go back to their first values, and the content is put back where Fabric put it.
`onDropView` nils the callbacks *first* and then closes, so nothing a teardown causes can
reach JS for a mount React has finished with. The Android root is released when the
popup's window goes, and a window-loss close waits one turn so a drop in the same mount
batch gets there first and reports nothing.

The device suite checks 50 open/close cycles, drops at 0, 80 and 150 ms into the entry
transition, a recycle while open and a drop of an open popover all leave no window, no
controller, no React Native root and no lifecycle observer behind.

## Accessibility

VoiceOver and TalkBack stay inside the popover while it is up: the presented content is
modal to both, and a screen reader is told the screen changed when the app opens it.
Your content keeps its own roles and labels — it is the app's own tree, moved rather than
copied — so a `Pressable` inside is a button and a `TextInput` inside is a field.

## Limits

- **A popover does not follow an anchor that moves.** A scroll, a layout change or a
  rotation while it is open leaves the popover where it was; close it in `onScroll` or
  on a layout change.
- **iOS keeps UIKit's entrance animation** (D44 item 3). The layout is final from the
  first frame; the zoom-and-fade over it is the platform's, and there is no prop to turn
  it off in v1.
- **No arrow styling.** Arrow direction is UIKit's to choose from `.up` / `.down`, and
  Android has no arrow.
- **Not for a `Host`.** Its content *and* its anchor are React Native views presented in
  a window of their own; a `<Host>` refuses it by name.
- **The Android keyboard path is API 30+.** `WindowInsets.Type.ime()` does not exist
  below it, and there the popover is placed as it was before: with the keyboard ignored.
