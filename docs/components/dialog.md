# AlertDialog and ConfirmationDialog

Two exports over one native view, `NitroUiDialog` (DECISIONS D33). A dialog has no box:
the view React Native lays out is a `0 × 0` anchor, and the window is the platform's.

| Export               | iOS                                                    | Android                                                       |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `AlertDialog`        | `UIAlertController(preferredStyle: .alert)`            | Material 3 `AlertDialog`                                      |
| `ConfirmationDialog` | `UIAlertController(preferredStyle: .actionSheet)`      | Material 3 `ModalBottomSheet`, one Expressive segmented row per action |

```tsx
import { AlertDialog } from 'react-native-nitro-ui';

const [asking, setAsking] = useState(false);

<AlertDialog
  isPresented={asking}
  onIsPresentedChange={setAsking}
  title="Delete the draft?"
  message="The draft and its photos go for good."
  actions={[
    { id: 'keep', title: 'Keep', role: 'cancel' },
    { id: 'delete', title: 'Delete', role: 'destructive' },
  ]}
  onAction={(id) => id === 'delete' && remove()}
/>;
```

A dialog has a value — whether it is presented — so it follows `Switch`, not `Menu`:
`isPresented` is controlled, behind the event-count handshake
(`docs/architecture/core.md` §4). The actions are data, never child views, as a Menu's
rows are.

## API

| Prop                  | Type                                       | Default       | Notes                                                                                      |
| --------------------- | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------ |
| `isPresented`         | `boolean`                                  | required      | Controlled only. See [Presenting and dismissing](#presenting-and-dismissing).               |
| `onIsPresentedChange` | `((isPresented: boolean) => void) \| undefined` | —        | Every **native** open or close. Not called for a change the app made.                       |
| `title`               | `string`                                   | required      | Also the dialog's accessibility name: there is no `accessibilityLabel`.                    |
| `message`             | `string \| undefined`                      | —             | Body text under the title.                                                                 |
| `actions`             | `DialogAction[]`                           | required      | At least one; ids unique; at most one `role: 'cancel'`. Development builds throw otherwise. |
| `onAction`            | `((id: string) => void) \| undefined`      | —             | The tapped action's `id`, **before** the close it causes (D32).                            |
| `dismissible`         | `boolean \| undefined`                     | `true`        | Whether a tap outside, Back or a swipe closes it. An action always closes it.              |
| `tintColor`           | `ColorValue \| undefined`                  | platform      | iOS: the alert view's `tintColor`. Android: the action text colour (destructive keeps `error`). |
| `titleVisibility`     | `'automatic' \| 'visible' \| 'hidden'`     | `'automatic'` | **`ConfirmationDialog` only** — SwiftUI's `Visibility`. See below.                          |
| `style`               | `ViewStyle`                                | —             | Places the anchor; on iPad the action sheet points at it. The base is `position: 'absolute'`, `0 × 0`. |
| `testID`              | `string \| undefined`                      | —             | Stays React Native's on the anchor; the presented window gets `<testID>-dialog`.           |
| `hybridRef`           | `(view: handle) => void`                   | —             | **Internal.** Read-only handle for this repo's harness.                                    |
| `nuiPerfId`           | `number \| null \| undefined`              | `null`        | **Internal.** Instance id for perf marks.                                                  |

```ts
interface DialogAction {
  id: string; // what onAction reports; unique and stable
  title: string;
  role?: 'default' | 'cancel' | 'destructive';
  disabled?: boolean; // drawn disabled, takes no tap, reports nothing
}
```

The anchor always gets `pointerEvents="none"`, so it never takes a touch from what is
under it. A dropped-in release build demotes a second `cancel` to `default` rather than
crash; a development build throws, as it does for an empty list or a duplicate id.

`titleVisibility`: `'visible'` always shows the title. `'automatic'` follows each
platform's own default — an iOS action sheet hides it (SwiftUI's default for a
confirmation dialog), the Android sheet shows it. `'hidden'` hides it on both.
`AlertDialog` always shows its title.

## Presenting and dismissing

| What happened                                    | What the app is told                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| The app writes `isPresented = true`              | nothing — the dialog presents                                 |
| The app writes `isPresented = false`             | nothing — the dialog closes, animated                         |
| A tap on an enabled action                       | `onAction(id)`, then `onIsPresentedChange(false)`             |
| A tap on a disabled action                       | nothing, and the dialog stays up                              |
| A tap outside, Back, a swipe, iOS's own Cancel   | `onIsPresentedChange(false)` alone (only while `dismissible`) |
| The anchor leaves its window while presented     | `onIsPresentedChange(false)` alone — see the contexts below   |

- **A refused dismissal presents again.** If the app keeps `isPresented` true once it has
  seen the dismissal's event, the dialog is presented again, and a development build
  warns once per instance ("dismissed by the user but `isPresented` is still true"). This
  is also what lets an app that never wires `onIsPresentedChange` reopen the dialog by
  writing `true` again — Expo's alert, which follows the prop only through `.onChange`,
  cannot.
- **An action always closes.** iOS cannot keep an alert up after an action, so Android
  closes too, although Material leaves that to the caller.
- **`isPresented` true at mount** presents once, when the anchor first has a window.
- **iOS's implicit Cancel.** A `ConfirmationDialog` with no `cancel` action gets the
  Cancel button UIKit (and SwiftUI) put on an action sheet, labelled with UIKit's own
  localised word. Its tap — and a tap outside the sheet, which UIKit routes to it — is a
  dismissal without an action. It is not added while `dismissible` is false. Android adds
  no row: outside and Back are the sheet's way out. Measured by real input on an iOS 27
  iPhone: UIKit does not *draw* that Cancel — the sheet's buttons were only the app's
  three actions — but it is in the controller, and the tap outside it is routed to
  closes the sheet with `onIsPresentedChange(false)` alone.

## Platform mapping

**iOS.** The anchor is a plain `UIView`, not interactive and hidden from accessibility —
no `UIHostingController`, so a closed dialog in every row of a list costs a view. The
controller is a `UIAlertController`, with each action a `UIAlertAction` (`.default`,
`.cancel`, `.destructive`; `isEnabled = !disabled`). A title, message or `disabled`
change while presented is applied in place; a change to the *set* of actions applies at
the next presentation, because `UIAlertController` cannot remove an action.

It is presented **from a window of its own** at `UIWindow.Level.alert + 1`, the pattern
React Native's own `RCTAlertController` uses, through the core helper
`ios/core/NitroUiPresentation.swift` (also behind DatePicker's popover). The G11 spike is
why: presented in the screen's own controller chain, a dialog over an RN `Modal` breaks
the Modal — React Native closes a Modal with `dismissViewControllerAnimated` on the
Modal's controller, which with a dialog on top dismisses the dialog instead and leaves the
Modal on screen with nothing to close it. From its own window the dialog is outside every
app chain. A confirmation's popover (iPad) points at the anchor's rect.

The window is above the app's, so while it is up UIKit asks its root about the status bar
and the orientations: the root answers as the app's top controller did when the dialog
presented (an RN `Modal`'s `supportedOrientations`, say). When the window closes it hands
key status back — to the window that was key before it, else the app's — and posts a
VoiceOver screen change.

**Android.** The anchor is a `NitroComposeHost` at `0 × 0` that composes on attach and is
not important for accessibility. `AlertDialog` lays the non-cancel actions out in order,
with the cancel action as Material's dismiss button; `ModalBottomSheet` draws one
Expressive `SegmentedListItem` per action (destructive in `colorScheme.error`), gathered
into a group inset 16 dp inside the sheet — material3's own gap between the rows, and its
outer corners rounded by `ListItemDefaults.segmentedShapes(index, count)` — so the actions
read as one card inside the sheet. A row is interactive and knows it: `disabled` is the
row's own `enabled = false`, which is what stops the press, colours the label with the
component's own disabled colour, and says `disabled` to TalkBack — nothing is painted
faintly by hand. `dismissible = false` maps to
`DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)` and the
sheet's equivalents. A programmatic close of the sheet runs its hide animation before the
window leaves the composition. Changes while presented, including the action set, apply
in place.

## Presentation contexts

What `example/__tests__/Dialog.harness.tsx` proves on both platforms (and the spike also
ran against react-native-screens, see below):

| Context                                                     | iOS                                   | Android                         |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| A plain screen                                              | presents, closes                       | presents, closes                |
| Inside an RN `Modal`                                        | presents over the Modal                | presents over the Modal         |
| Over a `pageSheet` Modal (the dialog's screen is under it)  | presents over it, mid-slide too        | presents over it                |
| A second dialog over the first                              | both up, each closes on its own        | the same                        |
| `isPresented = false` during the entry animation            | closes, no window left                 | closes, no window left          |
| Unmounted at 0, 80, 150 and 1000 ms after presenting        | no window left behind                  | no window left behind           |
| Re-keyed 0, 80, 150 ms in, the recycled view presenting again | one dialog up, none after              | the same                        |
| The `pageSheet` Modal under an open dialog closes           | the Modal closes; nothing left         | the same                        |
| A **full-screen** Modal opens over the dialog's screen      | the dialog closes and reports it       | the dialog stays up             |
| react-native-screens `formSheet` (presents, sheet closes under it) | works, nothing left             | works, nothing left             |
| A screen pushed over the dialog's screen                    | the dialog closes and reports it       | the dialog closes and reports it |

The full-screen row is a platform difference, pinned by a test: a full-screen
presentation removes the presenting screen's views from the window, so on iOS the anchor
loses its window and the dialog closes with `onIsPresentedChange(false)`. The
react-native-screens rows were measured with `react-native-screens@4.30.1` added to the
example for the spike and then removed; there is no permanent gate for them.

## Inside a `Host`

Both exports are hostable: a `<Host>` composes the Android dialog in its shared
composition, and dropping the Host takes an open dialog down. On iOS a `<Host>` is a
passthrough. A layout move does not close a dialog: a window with no anchor is not
subject to the anchored-popup rule.

## Sizing

None: `sizing: null` in `component.json`. There is no row in `nitro-ui.sizing.json`, no
declared fallback and no `measureContent`; the platform lays out the presented window.
The conformance suite's fallback and leak rules print that reason for this component
(`selfSizing: false`) rather than asserting about an engine it never joins.

## Recycling and cleanup

`RecyclableView`. `prepareForRecycle()` closes without animation, then resets every prop,
both event counts and the per-mount flags, and forgets the previous controller — a reused
view shows none of the old dialog (`Dialog.harness.tsx`, and the conformance suite's
residue probe: a first owner's dismissal leaves one native event, which a reset that kept
it would use to refuse the second owner's `isPresented`). `onDropView()` closes — on iOS
through the helper, which hides the presentation at once if the drop lands mid-transition
and carries the dismissal to completion — and drops the callbacks. The helper keeps that
carried dismissal per controller, so a recycled view that presents its next mount's dialog
before the previous one has finished arriving still takes the previous one down. On Android the host's
drop disposes the composition, which closes the window.

## Accessibility

The anchor is invisible to screen readers on both platforms. The window is the
platform's: `UIAlertController` is modal to VoiceOver and reads the title, then the
message; the Compose `AlertDialog` window takes TalkBack focus, and the sheet carries
`paneTitle = title` so TalkBack announces it on open. A disabled action is
`isEnabled == false` on iOS and `enabled="false"` in Android's accessibility tree — on
Android that is the row's own state, not a label wearing grey — and both are asserted by
real input (`testRealInputDialog`, `CHECKS.dialog`) and by the Android harness, which reads
the open sheet's rows back through `nuiTestStateReport`. The a11y
sweep cannot open a window, so `A11Y_PRESENTATIONS` in `scripts/real-input/a11y.mjs`
names those checks as the rule's presentation-aware variant.

## Limits

- **No slot content.** Title, message and actions are strings and data. A trigger made of
  React Native children, or a custom body, needs the slot mechanism (Q5's C2).
- **iOS 26 roles** (`.confirm`, `.close`) are not mapped; `role` is `default`, `cancel` or
  `destructive`.
- **iOS, a non-dismissible sheet with a `cancel` action:** a tap outside an action sheet
  is UIKit's cancel, so it runs that action (reported as the action) even when
  `dismissible` is false. Leave the cancel action out of a sheet that only the other
  actions may close.
- **Changing the action set while an iOS dialog is up** applies at the next presentation.
