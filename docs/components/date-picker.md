# DatePicker

Native date and time selection: SwiftUI `DatePicker` on iOS, Material 3
`DatePicker` / `TimePicker` (and their dialog forms) on Android. Both are hosted by the
core runtime (`docs/architecture/core.md`), so the calendar cells, the clock dial, the
wheel's momentum, press feedback, haptics, dynamic type and localisation belong to the
platform control, not to us.

```tsx
import { DatePicker } from 'react-native-nitro-ui';

const [date, setDate] = useState(new Date());
<DatePicker value={date} onChange={setDate} minimumDate={new Date()} />;
```

## API

| Prop               | Type                                | Default   | Maps to |
| ------------------ | ----------------------------------- | --------- | ------- |
| `value`            | `Date \| undefined`                 | —         | Controlled instant. `undefined` makes the control uncontrolled. On the wire: `valueMillis` (`number \| null`). |
| `defaultValue`     | `Date \| undefined`                 | mount time | Seed for an uncontrolled control; ignored while `value` is set. |
| `onChange`         | `((date: Date) => void) \| undefined` | —       | One call per user selection that changes the displayed instant. |
| `mode`             | `'date' \| 'time' \| 'datetime'`    | `'date'`  | Which components the picker shows. Size-affecting. |
| `variant`          | `'compact' \| 'inline' \| 'wheel'`  | `'compact'` | How it is presented. The most size-affecting prop. |
| `minimumDate`      | `Date \| undefined`                 | —         | Lower bound. `undefined` → `null` on the wire → *no lower bound*. |
| `maximumDate`      | `Date \| undefined`                 | —         | Upper bound, same spelling. |
| `disabled`         | `boolean \| undefined`              | `false`   | SwiftUI `.disabled()` / Compose `enabled = false`; no events while set. |
| `tintColor`        | `ColorValue \| undefined`           | platform  | iOS accent (field text, selected day, wheel highlight) / M3 primary (headline, selected day, dial, field outline). |
| `style`            | `ViewStyle`                         | —         | Overrides the measured box (see Sizing). |
| `testID`           | `string \| undefined`               | —         | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`. |
| `accessibilityLabel` | `string \| undefined`             | —         | The *label*; the platform control supplies the localised *value*. |
| `hybridRef`        | `(view: handle) => void`            | —         | **Internal.** Read-only handle for this repo's harness and benchmarks. |
| `nuiPerfId`        | `number \| null \| undefined`       | `null`    | **Internal.** Instance id for perf marks. |

`DatePicker` is a `View`, so any other `ViewProps` work as usual. `hybridRef` and
`nuiPerfId` are not app API (DECISIONS D14).

No view prop is optional (D7 / nitro#1184): the wrapper always sends every prop and uses
`null` for "not set". **An absent bound is `null`, not a magic number** — both platforms
derive their scrollable year range from the bounds they are handed, so a sentinel that
means "unbounded" to one is the year 1 to the other, and a `NaN` comparison is silently
always false. `accessibilityLabel` doubles as the SwiftUI `DatePicker`'s required title
(hidden visually, still announced).

## Values, time zones and DST

A date crosses the bridge as **milliseconds since the epoch** — one absolute instant, no
format to argue about. The device's time zone and calendar decide how it is *shown* and
what "the same day" means, and `onChange` reports an instant rather than a `y/m/d`
triple. Nothing normalises to UTC midnight on the way in or out, so a value survives a
DST boundary unchanged (`2026-03-29T00:30` in Lisbon stays `00:30` local across the
change — the harness pins this). Android's `DatePickerState` internally stores UTC
midnight of the selected local day; that conversion lives in one place next to the clamp.

## Platform mapping

| Concept | iOS | Android |
| ------- | --- | ------- |
| `compact` `date` | Our own field (a `Button` + `Text`) opening a **UIKit popover** whose content is `DatePicker` with `.graphical` | M3 `OutlinedButton` field opening `DatePickerDialog` |
| `compact` `time` | same field, popover shows `.wheel` | field opens `TimePickerDialog` |
| `compact` `datetime` | popover shows `.graphical` with `[.date, .hourAndMinute]` (calendar + time row) | **two dialogs**: the date one commits, then the time one opens |
| `inline` | `DatePicker` with `.graphical` | `DatePicker(state, showModeToggle = false)`; `time` → `TimePicker` |
| `wheel` | `DatePicker` with `.wheel` | **no M3 wheel** — renders the inline picker |
| Bounds | `DatePicker(in: ClosedRange<Date>)` | `SelectableDates` + the calendar's `yearRange` |
| Host | `UIHostingController` inside `NitroSwiftUIHost`, plus containment for the popover (`needsContainment`) | `NitroComposeHost<M>: AbstractComposeView`; the dialog is composed from `model.presented` inside that composition |
| Test id | RN `testID` → `accessibilityIdentifier` | `host.tag` (Compose has no test id) |
| Recycle | hosting controller reused; popover closed | composition reused; dialog composed away |

The `compact` field is ours on both platforms rather than the platform's own compact
style, for three reasons that all matter more than the ~25 lines it costs:

- the mount owns whether the presentation is open, so `prepareForRecycle()` /
  `onDropView()` / a disposed composition can and must close it (the B1 class of bug);
- the state is readable from JS (`nuiTestStateReport`), so "it closed when the view went
  away" is a structural assertion rather than a screenshot;
- the field's width is value-independent (see Sizing).

The platform picker is still what the user touches — it is the content of the popover or
dialog. On Android the app's back gesture/button dismisses a dialog through the ordinary
Dialog path, and `onDismissRequest` is what clears `model.presented`, so nothing is left
behind either way.

## Sizing

- **`compact` is intrinsic.** Its `nuiSizingKey` is `"<variant>|<mode>"` — deliberately
  *not* including the displayed value. The field's width is the width of the **widest
  string its mode can produce** (every month name in the locale, one- and two-digit days
  and hours, both AM/PM halves, a four-digit year), measured per `mode` × Dynamic Type ×
  locale and cached process-wide. Two pickers that share a key therefore want the same
  box, so they cannot correct each other's width back and forth; had the value been in
  the key, a list of rows would add a cache entry per date ever rendered and every value
  change would be a cold configuration. The visible cost is that the field is wider than
  today's date needs; on Android the probe is an invisible `Text` that the real value is
  overlaid on (`matchParentSize`, `clearAndSetSemantics`), so it is right for the current
  locale and font scale with no measuring cache of its own.
- **`inline` and `wheel` are `fillWidth`:** the box's width, and the height the picker
  asks for at that width (a graphical calendar's own width is fixed at 320 pt so a day
  cell stays a touch target, and the popover is not in the React Native layout at all).
- Declared fallbacks (the D17 first-frame size for a cold configuration, registered at
  startup by `NitroUiDeclaredFallbacks`): **118 × 36 pt** on iOS, **150 × 40 dp** on
  Android — the `compact` `date` field, which is the default configuration and the one a
  cold mount is most likely to be. `nitroUiCore.prewarm` is the way to make a first mount exact.
- Because the width never comes from the value, a value change is a props-only turn: no
  re-measure, no correction. Changing `mode` or `variant` does re-measure (different
  key, and `variant` also moves the sizing policy), and that costs the D17 one frame.

## Selection, clamping and the handshake

A user pick is applied optimistically and reported with a fresh event count; native only
accepts a `value` write once JS has processed that many of its own events
(`docs/architecture/core.md` §4). So a change the parent refuses reverts to the date React
is still showing, and the field snaps back. Selecting the instant that is already
displayed reports nothing — on both platforms (Android's `TimePickerState` would
otherwise fire a no-op). `minimumDate` / `maximumDate` are enforced three times over: the
platform control cannot show a day outside the range, native clamps any incoming value
into it, and the JS wrapper clamps before sending.

An uncontrolled picker seeds from `defaultValue` (or the mount moment) once; a remount
starts from its own default, not from what the previous mount ended with.

## Accessibility

Both platforms give their picker a localised value announcement of its own ("Saturday,
14 March 2026", "3:00 PM"), which is what the brief asks for; `accessibilityLabel` is the
*label* that makes the announcement say what the field is. iOS gets it through the
`DatePicker` title (hidden visually with `labelsHidden()`) and through the field's button;
Android through `contentDescription` semantics, with the invisible width probe wrapped in
`clearAndSetSemantics` so TalkBack never reads a date nobody picked. `disabled` is exposed
as a disabled element on both.

## Limits

- **Android has no wheel** (`variant: 'wheel'` renders the inline picker), and **no
  combined date+time control**: `datetime` is a date dialog followed by a time dialog, and
  the inline form of `datetime` shows the calendar only.
- **Android's Material 3 pickers are dialogs or full inline calendars** — there is no
  small inline field, and `DatePickerDialog` is modal. `variant: 'inline'` with `disk`
  behaviour, year-picker mode and the M3 time "input" toggle are not exposed.
- The `compact` field's width is the widest value the mode can produce, not the current
  one. That is the trade described in Sizing, not a bug to file.
- Locale and time zone come from the device; there is no `locale` or `timeZone` prop, and
  no custom format string (the field text is `.medium` date + `.short` time, per mode).
- The calendar's tappable area, week-start, era and calendar system are the platform's.
- The picker does not validate that `minimumDate <= maximumDate`; an inverted range is an
  empty range on both platforms and shows as an unselectable picker.
