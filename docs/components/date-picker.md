# DatePicker

Native date and time selection: SwiftUI `DatePicker` on iOS, Material 3 `DatePicker` /
`TimePicker` (and their dialog forms) on Android. The calendar cells, the clock dial, the wheel's
momentum, press feedback, haptics, dynamic type and localisation belong to the platform control.

```tsx
import { DatePicker } from 'react-native-nitro-ui';

const [date, setDate] = useState(new Date());
<DatePicker value={date} onChange={setDate} minimumDate={new Date()} />;
```

## API

| Prop                 | Type                                  | Default     | Maps to                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`              | `Date \| undefined`                   | —           | Controlled instant. `undefined` makes the control uncontrolled. Sent to native as `valueMillis` (`number \| null`).                                                                                                                                            |
| `defaultValue`       | `Date \| undefined`                   | mount time  | Seed for an uncontrolled control; ignored while `value` is set.                                                                                                                                                                                                |
| `onChange`           | `((date: Date) => void) \| undefined` | —           | One call per user selection that changes the displayed instant.                                                                                                                                                                                                |
| `mode`               | `'date' \| 'time' \| 'datetime'`      | `'date'`    | Which components the picker shows. Affects the size.                                                                                                                                                                                                           |
| `variant`            | `'compact' \| 'inline' \| 'wheel'`    | `'compact'` | How it is presented. Affects the size most.                                                                                                                                                                                                                    |
| `minimumDate`        | `Date \| undefined`                   | —           | Lower bound. `undefined` is sent as `null`: no lower bound.                                                                                                                                                                                                    |
| `maximumDate`        | `Date \| undefined`                   | —           | Upper bound, in the same way.                                                                                                                                                                                                                                  |
| `disabled`           | `boolean \| undefined`                | `false`     | No events while set. iOS: SwiftUI `.disabled()`. Android: the `compact` field's `enabled = false`; the Material 3 `DatePicker`/`TimePicker` take no `enabled`, so a disabled picker is dimmed, offered to TalkBack as one disabled node, and swallows touches. |
| `tintColor`          | `ColorValue \| undefined`             | platform    | iOS accent (field text, selected day, wheel highlight) / Material 3 primary (headline, selected day, dial, field outline).                                                                                                                                     |
| `style`              | `ViewStyle`                           | —           | Overrides the measured box (see Sizing).                                                                                                                                                                                                                       |
| `testID`             | `string \| undefined`                 | —           | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`.                                                                                                                                                                                                  |
| `accessibilityLabel` | `string \| undefined`                 | —           | The label of the control, not of a box around it. The localised value is announced too: by the platform picker on the picker variants, by the field's own announcement on `compact`.                                                                           |
| `hybridRef`          | `(view: handle) => void`              | —           | Internal. Read-only handle for this repo's harness and benchmarks.                                                                                                                                                                                             |
| `nuiPerfId`          | `number \| null \| undefined`         | `null`      | Internal. Instance id for perf marks.                                                                                                                                                                                                                          |

`DatePicker` is a `View`, so any other `ViewProps` work as usual. `hybridRef` and `nuiPerfId` are
not app API.

The wrapper always sends every native prop and uses `null` for "not set". An absent bound is
`null`, never a sentinel number: both platforms derive their scrollable year range from the
bounds they receive. `accessibilityLabel` is also the SwiftUI `DatePicker`'s required title
(hidden visually, still announced).

## Values, time zones and DST

A date is sent to native as milliseconds since the epoch: one absolute instant. The device's time
zone and calendar decide how it is shown and what "the same day" means, and `onChange` reports an
instant, not a `y/m/d` triple. Nothing is normalised to UTC midnight, so a value survives a DST
boundary unchanged: `2026-03-29 12:30` in a zone that changes on that date stays `12:30` local,
and so does an instant whose local day is not its UTC day (`01-05 23:45` in Lisbon is `23:45`
local, `01-06` in UTC). Android's `DatePickerState` stores UTC midnight of the selected local day
internally; that conversion is in one place, next to the clamp.

## Platform mapping

| Concept              | iOS                                                                                                                   | Android                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compact` `date`     | The library's own field (a `Button` + `Text`) opening a UIKit popover whose content is `DatePicker` with `.graphical` | Material 3 `OutlinedButton` field opening `DatePickerDialog`                                                                                             |
| `compact` `time`     | same field, popover shows `.wheel`                                                                                    | field opens `TimePickerDialog`                                                                                                                           |
| `compact` `datetime` | popover shows `.graphical` with `[.date, .hourAndMinute]` (calendar + time row)                                       | two dialogs: the date one commits, then the time one opens                                                                                               |
| `inline`             | `DatePicker` with `.graphical`                                                                                        | `DatePicker(state, showModeToggle = false)`; `time` → `TimePicker`                                                                                       |
| `wheel`              | `DatePicker` with `.wheel`                                                                                            | `time` → a drum per field (hour, minute, and AM/PM on a 12-hour device) drawn with Material 3's `ScrollField`; `date` / `datetime` → the inline calendar |
| Bounds               | `DatePicker(in: ClosedRange<Date>)`                                                                                   | `SelectableDates` + the calendar's `yearRange`                                                                                                           |
| Host                 | `UIHostingController` inside `NitroSwiftUIHost`, plus containment for the popover (`needsContainment`)                | `NitroComposeHost<M>: AbstractComposeView`; the dialog is composed from `model.presented` inside that composition                                        |
| Test id              | RN `testID` → `accessibilityIdentifier`                                                                               | `host.tag` (Compose has no test id)                                                                                                                      |
| Recycle              | hosting controller reused; popover closed before the state resets                                                     | same host reused; the model resets and the `Dialog` stops being composed. `onDropView` disposes the composition                                          |

The `compact` field is the library's own on both platforms, not the platform's compact style:

- the mount owns whether the presentation is open, so `prepareForRecycle()`, `onDropView()` and
  a disposed composition close it;
- the open state is readable from JS for tests (`nuiTestStateReport`);
- the field's width does not depend on the value (see Sizing).

The platform picker is still what the user touches: it is the content of the popover or dialog.
On Android the back gesture or button dismisses a dialog through the ordinary Dialog path, and
`onDismissRequest` clears `model.presented`.

## Sizing

- `compact` is `intrinsic`. Its `nuiSizingKey` is `"<variant>|<mode>"`, without the displayed
  value. The field's width is the width of the widest string its mode can produce (every month
  name in the locale, one- and two-digit days and hours, both AM/PM halves, a four-digit year),
  measured per `mode` × Dynamic Type × locale and cached process-wide. Two pickers that share a
  key therefore want the same box, and a value change is never a new configuration. The cost is
  that the field is wider than today's date needs. On Android the probe is an invisible `Text`
  (`alpha(0f)`, `clearAndSetSemantics`) stacked with the real value in one `Box`, so the field
  is `max(probe, value)` wide.
- `inline` and `wheel` are `fillWidth`: the box's width, and the height the picker asks for at
  that width. On iOS a graphical calendar's own width is fixed at 320 pt so a day cell stays a
  touch target, and the popover is not in the React Native layout.
- On Android the calendar adapts to the width it is given. Material 3 gives each of the seven
  weekday columns `LocalMinimumInteractiveComponentSize`, 48 dp by default, so the grid wants
  360 dp. At 360 dp and above the calendar keeps Material's 48 dp. Below 360 dp it uses
  Material's 40 dp day cell, so the grid needs 7 × 40 + 2 × 12 = 304 dp and a 320 dp box fits
  with every column equal. The narrow case gives up 8 dp of touch-target padding on the day
  cells, the previous/next month buttons and the year toggle; 40 dp is above WCAG 2.2 AA's 24 px
  minimum and below Material's recommended 48 dp. Below 304 dp the calendar is clipped at the
  right: at a 240 dp box it shows five 40 dp columns and a 15.6 dp sliver. Give the picker a
  wider box.
- The Android calendar's height does not depend on its width: an `inline` or `wheel` calendar
  measures 512 dp tall at 320 dp wide and at 411 dp wide, in `date` and `datetime`, for a month
  of four rows and of six. So the width is not in the sizing key. The `compact` dialog is a
  window of its own, laid out at Material's 360 dp.
- The declared fallbacks are 107 × 36.33 pt on iOS and 131 × 48 dp on Android: the `compact`
  `date` field, the default configuration, as measured in the `en_US` locale on iOS and the
  emulator's default locale on Android. The Android box is 48 dp tall because Material 3 puts a
  48 dp interactive minimum under a 40 dp outline. A cold mount in those locales is laid out at
  its own size. The width depends on the locale: the same field is 103.00 under `en_PT`, and a
  locale whose date format differs costs that configuration's first instance one horizontal
  correction. `prewarm` does not help: it seeds only a component's empty configuration, and a
  DatePicker's key always names its variant and mode.
- Because the width never comes from the value, a value change causes no re-measure. Changing
  `mode` or `variant` re-measures (a different key, and `variant` also changes the sizing
  policy), and may show the fallback for one frame.

## Selection, clamping and the handshake

A user pick is displayed at once and reported with a new event count; native accepts a `value`
write only once JS has processed that many events ([DESIGN.md](../DESIGN.md), section 3.5). So a
change the parent refuses reverts to the date React is still showing. Selecting the instant that
is already displayed reports nothing, on both platforms.

`minimumDate` and `maximumDate` are enforced in three places: the platform control is given them
(iOS `DatePicker(in:)`; Android `SelectableDates`, which greys days outside the range, plus the
calendar's `yearRange`), native clamps any incoming value into the range, and the JS wrapper
clamps before sending.

Changing the bounds re-creates the platform control on both platforms, which loses that
calendar's current page and nothing else. A bound counts as changed when it moves by a day for a
picker that shows no time, and by a minute for one that shows a time, so
`minimumDate={new Date()}`, which is a new instant on every render, does not rebuild the control
on every render. iOS also rebuilds when the value has left the range the control on screen was
built with. The rebuild is required on both platforms:

- Android's `DatePickerState` reads `yearRange` and `selectableDates` once, at construction.
  Bounds that arrived later would grey out the wrong days, and a value whose year the old range
  does not cover would be stored as no selection.
- On iOS `UIDatePicker` applies a new `date` before a new `maximumDate`, so an update that moves
  the value past the old upper bound is clamped by UIKit mid-update, and the reload that follows
  asserts in `UICalendarView._setVisibleMonth:`. A control rebuilt from the new bounds has both
  bounds before it has a value to clamp.

An uncontrolled picker seeds from `defaultValue` (or the mount moment) once; a remount starts
from its own default.

Android's `wheel` reports a pick when the drums come to rest, not as they turn: one rest is one
`onChange`. A drum is active while a finger is on it or it is still turning, and the report is
made after the pointer is up and the snap animation has finished, never on a timer. The dial
(`compact` and `inline` time) writes its hour once, when the finger lifts.

What a contributor must keep true of the Android time wheel:

- A refused pick is reverted by an instant `scrollToOption` on each drum from the props pass,
  right after the reconcile that reverts the instant. An effect keyed on the instant would miss
  a revert that happens within one frame.
- The pair of values the drums were last put on by the control is recorded with that write, so a
  rest the control caused is not read as a pick.
- Every path that moves a drum (the revert, a new `value`, a roll, the end of a rest) takes one
  mutex.
- The drums are drawn with `ScrollField` directly, not Material's `TimeScroll`, because the
  settle needs each drum's `ScrollFieldState`.

A drum keeps the vertical drag that begins on it, as `Picker variant="wheel"` does, so scroll a
page with a wheel in it from beside the wheel.

## Accessibility

A screen-reader user hears a label and a localised value ("Saturday, 14 March 2026", "3:00 PM")
from the one node that is the control, on every variant.

- `accessibilityLabel` is applied to the control (iOS's field `Button` / `DatePicker`, Android's
  `OutlinedButton` / `DatePicker` / `TimePicker`), never to a box around it.
- On the picker variants the platform control announces its value. The `compact` field announces
  the same localised string it paints: iOS through `accessibilityValue`, Android through
  `stateDescription`.
- `disabled` is exposed on the node the user is on. Android's pickers have no `enabled`, so a
  disabled inline or wheel picker replaces its subtree's semantics with one disabled node and
  swallows touches at the initial pointer pass.
- The invisible width probe uses `clearAndSetSemantics`, so TalkBack never reads it.
- On the Android time wheel the control is one named node (`content-desc`, `enabled`,
  `scrollable=false`), and inside it each drum publishes a node of its own, named with Material's
  localised strings ("Select hour", "Select minutes"). On a 12-hour device the AM/PM column is a
  third drum, named by the two values it holds. A screen reader hears one stop per drum, and each
  drum speaks the row it is on; the rows are not in the tree (see Limits).

## Limits

- Android's wheel is a time wheel. `variant: 'wheel'` with `mode: 'time'` draws the drums;
  `variant: 'wheel'` in `date` or `datetime` renders the inline picker, because Material 3 has no
  wheel calendar. There is no combined date and time control on Android: `compact` `datetime` is
  a date dialog followed by a time dialog, and the inline form of `datetime` shows the calendar
  only.
- Android's Material 3 pickers are dialogs or full inline calendars. There is no small inline
  field, and `DatePickerDialog` is modal. The calendar's mode toggle (text entry) and the time
  picker's text-input toggle are not exposed.
- The Android time wheel's rows are not in the accessibility tree. A screen reader gets one stop
  per drum with no row to activate, and the control node reports `scrollable=false`, so no scroll
  actions are offered on it.
- The `compact` field's width is the widest value the mode can produce, not the current one (see
  Sizing).
- Locale and time zone come from the device; there is no `locale` or `timeZone` prop and no
  custom format string (the field text is `.medium` date + `.short` time, per mode).
- The calendar's tappable area, week start, era and calendar system are the platform's.
- The picker does not validate that `minimumDate <= maximumDate`. The clamp applies the upper
  bound and then the lower one, so with an inverted range the control settles on `minimumDate`
  on both platforms. (The JS wrapper checks the lower bound first, so the value it sends can be
  `maximumDate`; native then moves it to `minimumDate`.) On Android the calendar grid is greyed,
  because no day is inside the range, and selecting `minimumDate` reports nothing.
