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
| `disabled`         | `boolean \| undefined`              | `false`   | No events while set. iOS: SwiftUI `.disabled()`. Android: the `compact` field's `enabled = false`; the M3 `DatePicker`/`TimePicker` take no `enabled`, so a disabled picker is dimmed, offered to TalkBack as one disabled node, and swallows touches. |
| `tintColor`        | `ColorValue \| undefined`           | platform  | iOS accent (field text, selected day, wheel highlight) / M3 primary (headline, selected day, dial, field outline). |
| `style`            | `ViewStyle`                         | —         | Overrides the measured box (see Sizing). |
| `testID`           | `string \| undefined`               | —         | iOS `accessibilityIdentifier` (RN's own), Android `View.tag`. |
| `accessibilityLabel` | `string \| undefined`             | —         | The *label* of the control, not of a box around it. The localised *value* is announced too: by the platform picker on the picker variants, by the field's own announcement on `compact` (which is our control on both platforms). |
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
DST boundary unchanged: `2026-03-29 12:30` in a zone that changes on that date stays
`12:30` local, and so does an instant whose *local* day is not its UTC day (`01-05 23:45`
in Lisbon is `23:45` local, `01-06` in UTC). The harness does not set the zone — it
refuses to run vacuously instead, failing if the device's January and July offsets are
equal and logging the zone on every case. Android's `DatePickerState` internally stores
UTC midnight of the selected local day; that conversion lives in one place next to the
clamp, and the pick test is routed through it.

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
| Recycle | hosting controller reused; popover closed before the state resets | same host reused; the model resets and the `Dialog` stops being composed. `onDropView` *disposes* the composition — nothing of the dropped mount survives it |

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
  today's date needs; on Android the probe is an invisible `Text` (`alpha(0f)`,
  `clearAndSetSemantics`) stacked with the real value in one `Box`, so the field is
  `max(probe, value)` in the width Compose itself measures — right for the current locale
  and font scale, with no measuring cache of its own.
- **`inline` and `wheel` are `fillWidth`:** the box's width, and the height the picker
  asks for at that width (a graphical calendar's own width is fixed at 320 pt so a day
  cell stays a touch target, and the popover is not in the React Native layout at all).
  On Android that width is a decision rather than a given: Material 3 lays the calendar's
  seven weekday columns out with `Arrangement.SpaceEvenly` and gives each one
  `LocalMinimumInteractiveComponentSize` — 48 dp by default — so the grid wants 360 dp,
  and in a narrower box the columns past the squeeze *lose width* instead of the box
  growing (`Modifier.size` enforces the incoming maximum, and a `fillWidth` control is
  measured at its box's width, so nothing ever asks for more). The inline calendar
  therefore asks Material for its **40 dp day cell** rather than 48 dp of interactive
  padding — the token the cell's own disc is drawn at — and 7 × 40 + 2 × 12 = **304 dp**
  is what the grid then needs, so the 320 dp box the stories and the README use fits with
  every column equal. Below 304 dp the calendar still cannot fit and is not made to
  pretend it did: it comes out clipped at the right, measured at a 240 dp box as six
  40 dp columns and a 15.6 dp sliver. That is a box too small for its content saying so;
  give the picker a wider box rather than scaling a touch target down further. The
  `compact` dialog is untouched by all of this — it is a window of its own, laid out at
  Material's 360 dp.
- Declared fallbacks (the D17 first-frame size for a cold configuration, registered at
  startup by `NitroUiDeclaredFallbacks`): **107 × 36.33 pt** on iOS, **131 × 48 dp** on
  Android — the `compact` `date` field, which is the default configuration and the one a
  cold mount is most likely to be. Both are the size the control measures on the gate
  device in the locale the harness pins — `en_US` on iOS (`xcrun simctl launch
    -AppleLocale en_US`), the emulator's own default on Android — and the harness logs
  `field=107.00x36.33` / the Android box is 48 dp tall because Material 3 puts a 48 dp
  interactive minimum under a 40 dp outline. So a cold mount is laid out at its own size
  and pays no correction. The width is locale-dependent: the same field is 103.00 under
  `en_PT`, and a locale whose date format differs from the pinned one costs that
  configuration's first instance one horizontal correction. `prewarm` cannot help here:
  it seeds only a component's empty configuration, and a DatePicker's key always names
  its variant and mode.
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
platform control is told about them (iOS `DatePicker(in:)`; Android `SelectableDates`,
which *greys* days outside the range rather than hiding them, plus the calendar's
`yearRange`), native clamps any incoming value into it, and the JS wrapper clamps before
sending.

Changing the bounds **re-creates the platform control on both platforms**, which costs
that calendar its own page and nothing else — where "changed" means moved as far as the
control can see: a **day** for a picker that shows no time, and a **minute** for one that
shows one. `minimumDate={new Date()}` is the first example on this page and hands the
control a new instant on every render; keying the rebuild on that instant would throw away
the page the user turned to, a wheel's scroll position and an open dialog's provisional
pick on every parent render, and none of those is a day of movement in a bound. iOS also
rebuilds when the value has left the range the control on screen was built with, which is
the crash below and too narrow a change to catch by granularity alone.
Android has to: its `DatePickerState` reads
`yearRange` and `selectableDates` once, at construction, so bounds that arrive later
would otherwise grey out the wrong days and — worse — a value whose year the old range
does not cover is *stored as no selection at all*, leaving a calendar with no lit day and
a field that reads one. iOS has to for a different reason: `UIDatePicker` applies a new
`date` before a new `maximumDate`, so an update that moves the value past the *old* upper
bound gets clamped by UIKit mid-update, and the reload that follows asserts in
`UICalendarView._setVisibleMonth:` (a crash, not a glitch). A control rebuilt from the
new bounds has both bounds before it has a value to clamp.

An uncontrolled picker seeds from `defaultValue` (or the mount moment) once; a remount
starts from its own default, not from what the previous mount ended with.

## Accessibility

A screen-reader user hears a *label* and a *localised value* ("Saturday, 14 March 2026",
"3:00 PM") from the one node that is the control, on every variant.

- **Where the label goes.** `accessibilityLabel` is applied to the control — iOS's field
  `Button` / `DatePicker`, Android's `OutlinedButton` / `DatePicker` / `TimePicker` — and
  never to a box around it. A container `contentDescription` is a stop of its own, so the
  user hears the label and then arrives at a nameless control (`docs/architecture/core.md`
  §3 bans it).
- **Where the value comes from.** On the picker variants the platform control already
  knows its value. The `compact` field is ours on both platforms, so it announces the same
  localised string it paints: iOS through `accessibilityValue`, Android through
  `stateDescription` (with a `contentDescription` set, TalkBack reads that as the node's
  name and would otherwise never say the day).
- **`disabled`.** Exposed on the node the user is on, not only on an ancestor. Android's
  pickers have no `enabled`, so a disabled inline/wheel picker replaces its subtree's
  semantics with one disabled node and swallows touches at the initial pointer pass —
  otherwise TalkBack offers every day cell of a disabled calendar as an enabled button.
- The invisible width probe is `clearAndSetSemantics`, so TalkBack never reads a date
  nobody picked.

## Limits

- **Android has no wheel** (`variant: 'wheel'` renders the inline picker), and **no
  combined date+time control**: `datetime` is a date dialog followed by a time dialog, and
  the inline form of `datetime` shows the calendar only.
- **Android's Material 3 pickers are dialogs or full inline calendars** — there is no
  small inline field, and `DatePickerDialog` is modal. Nothing else of theirs is exposed:
  not the calendar's year-picker *mode toggle* (it swaps the grid for text entry, which is
  a keyboard nobody asked for), nor the time picker's text-input toggle, nor a `TimePicker`
  in the dialog's date step.
- The `compact` field's width is the widest value the mode can produce, not the current
  one. That is the trade described in Sizing, not a bug to file.
- Locale and time zone come from the device; there is no `locale` or `timeZone` prop, and
  no custom format string (the field text is `.medium` date + `.short` time, per mode).
- The calendar's tappable area, week-start, era and calendar system are the platform's.
- The picker does not validate that `minimumDate <= maximumDate`. The clamp applies the
  upper bound and then the lower one, so an inverted range is **not** empty: the lower
  bound wins and the control settles on `minimumDate` on both platforms. (The JS
  wrapper checks the lower bound first, so the value it sends can be `maximumDate`;
  native then moves it to `minimumDate`.)
  A greyed calendar grid on Android is what that looks like, because no day is inside the
  range — while the *value* is `minimumDate`, and selecting it reports nothing.
