@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.margelo.nitro.nitroui

import android.app.Activity
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.TextPaint
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePickerState
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDialog
import androidx.compose.material3.TimePickerState
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.text.DateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/*
 * The DatePicker component: Material 3's date and time pickers on the core runtime.
 *
 * The structure is the Switch's (`HybridNitroUiSwitch.kt`) - a user-editable value
 * behind the event-count handshake - plus the Button's sizing story
 * (`HybridNitroUiButton.kt`) because the `compact` field's width comes from what it
 * renders, and one thing no shipped component has: a *dialog*. That difference
 * shapes three decisions in this file, all of them the same decision seen from
 * different angles - the mount must own the presentation:
 *
 *  1. The dialog is composed from `model.presented`, inside the host's own
 *     composition. Compose's `Dialog` opens a window and closes it when the
 *     composition that asked for it is disposed, and `NitroComposeHost.drop()`
 *     disposes the composition (`core.md` section 6) - so a dialog cannot outlive
 *     the mount that opened it, which is the B1 class of bug
 *     (`docs/tasks/B1-android-mount-oom.report.md`, lessons in
 *     `docs/tasks/G6-picker.md`). Nothing registers with a table that survives a
 *     drop: not a `DialogManager`, not a listener on the activity.
 *  2. `wheel` has no Material 3 equivalent, so it renders the inline picker
 *     (`docs/components/date-picker.md`). A wheel is an iOS control; inventing one
 *     here would mean drawing a picker instead of hosting the platform's.
 *  3. `datetime` is two Material 3 dialogs - a date one, then a time one - because
 *     Material 3 has no combined control, only the two.
 *
 * Dates cross the bridge as ms since the epoch, an *absolute instant*, and Material
 * 3's `DatePickerState` speaks **UTC midnight of the selected day**. The two
 * conversions live in [DatePickerModel] next to the clamp, because both are the
 * "what does this number mean" question and that question is answered in one place
 * here (see [toUtcMidnightOfLocalDay]).
 *
 * This file must stay in the package `com.margelo.nitro.nitroui`: the generated
 * manager resolves the implementation through a wildcard import of exactly that
 * package. Core helpers live in `...nitroui.core`.
 */

/** State of one DatePicker. See [NitroUiModel] for the shape this has to have. */
internal class DatePickerModel : NitroUiModel() {
  /**
   * The selected instant the composable renders, in ms since the epoch.
   *
   * A mirror of [state]'s `displayed`, observed because writing the handshake is
   * invisible to Compose - `NitroUiControlledValue` is plain state, and only a write
   * to snapshot state reaches the UI (the Switch and SegmentedControl do the same).
   */
  var displayed by mutableStateOf(0.0)

  /** `!disabled`, spelled positively where a composable wants it. */
  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  /** `accessibilityLabel`, read by the composable so it can go on the control. */
  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * Whether the `compact` field's dialog is open.
   *
   * Observed (it is what composes the dialog) *and* readable from JS through
   * `nuiTestStateReport`, because "the dialog closed when the view went away" has to
   * be a structural assertion rather than a screenshot. Every write goes through
   * [setPresented], which is also why the property is read-only: Kotlin would give a
   * `var presented` a `setPresented` of its own, and the two would clash.
   */
  val presented: Boolean
    get() = presentedSnapshot

  private var presentedSnapshot by mutableStateOf(false)

  /**
   * The size configuration React sent. The sizing engine reads the key out of Fabric
   * state itself; the host only needs to hear that it changed (see
   * [NitroComposeHost.noteSizingKeyChanged]).
   */
  var sizingKey = ""

  /**
   * Event-count handshake, over the selected instant.
   *
   * A `Double` rather than a `Long` because the bridge has no 64-bit integer prop
   * type that both platforms agree on, and a `Double` is what the handshake stores
   * *raw*: `js` cannot be clamped in the setter, because the bounds it belongs to can
   * arrive in the same batch after it (`docs/architecture/core.md` section 3).
   * `afterUpdate()` clamps both `js` and `displayed`, so everything the composable
   * reads is already in range. Not observed: it drives [displayed].
   */
  val state = NitroUiControlledValue<Double>(0.0)

  /** Uncontrolled seed, in ms. Applied once, in `afterUpdate()`. */
  var defaultValueMillis: Double = 0.0

  var didApplyDefault = false

  /**
   * `'date'`, `'time'` or `'datetime'`. Size-affecting, so it is in `nuiSizingKey`.
   *
   * Observed, and not only because it is in the size key: it is what the field
   * formats and which picker the inline variant builds, and a `mode` change is a
   * props change on the *same* mount - `DatePicker.tsx` keys the native view on
   * `variant`, not `mode`. As plain state it would be read once and never again, and
   * the control would go on showing a date field after being asked for a clock.
   */
  var mode by mutableStateOf("date")

  /**
   * `'compact'`, `'inline'` or `'wheel'`. The most size-affecting prop here, and the
   * one that is *not* observed - because it is the one that cannot change in place:
   * `DatePicker.tsx` keys the native view on it, so a variant change is a new mount
   * with a new model, a new `nuiSizingId`, and the policy chosen at `init`. Reading it
   * once per composition is therefore reading it once per mount.
   */
  var variant = "compact"

  /**
   * Lowest selectable instant, or `null` for "no lower bound" (`null` on the wire).
   *
   * Observed along with [maximum]: both are read by the inline picker and by the
   * dialog, as the calendar's year range and as its `SelectableDates`, so a range
   * React widens or narrows has to reach a picker that is already on screen.
   */
  var minimum: Double? by mutableStateOf(null)

  /** Highest selectable instant, or `null` for "no upper bound". */
  var maximum: Double? by mutableStateOf(null)

  /** `onValueChange`, as Nitro delivered it. */
  var onChange: ((Double, Double) -> Unit)? = null

  // The test report. `nuiTestStateReport()` may be called from the JS thread, so the
  // answer is a string written under a lock rather than two live reads: the main
  // thread is never blocked for JS, and JS never blocks for it.
  private val reportLock = Any()

  private var report = "0|0"

  /**
   * The pair [publishReport] last formatted, so an unchanged batch skips the string
   * build. Every mutation path calls it, including the ones that cannot change
   * anything, and a benchmark sends many value writes.
   */
  private var publishedDisplayed = 0.0

  private var publishedPresented = false

  /**
   * The composed calendar's own reading of itself, for [readReport].
   *
   * [displayed] and [presented] describe the *model*. A Material 3 calendar owns two
   * facts only it knows: which month it is showing, and whether it kept the selection
   * it was handed (`DatePickerStateImpl` stores `null` for a year outside its
   * `yearRange`, so "the model has a value" and "the calendar shows a day" can
   * disagree). [syncDatePicker] publishes both while a calendar is composed, which is
   * what lets the harness see a calendar that opens on the wrong month or loses its
   * day - neither of which the model's own pair can show.
   *
   * [NO_CALENDAR] in both means this mount has no calendar on screen: a `compact`
   * field with its dialog closed, or the `time` mode's clock.
   */
  private var calendarMonthUtcMillis: Long = NO_CALENDAR

  private var calendarHasSelection: Long = NO_CALENDAR

  override fun reset() {
    presentedSnapshot = false
    displayed = 0.0
    enabled = true
    tintColor = null
    accessibilityLabel = null
    sizingKey = ""
    mode = "date"
    variant = "compact"
    minimum = null
    maximum = null
    defaultValueMillis = 0.0
    didApplyDefault = false
    onChange = null
    state.displayed = 0.0
    state.js = null
    state.unreported = null
    state.nativeEvents = 0
    state.jsEvents = 0
    clearCalendar()
    publishReport()
  }

  companion object {
    /** [calendarMonthUtcMillis]/[calendarHasSelection] when no calendar is composed. */
    private const val NO_CALENDAR = -1L

    /** [readReport]'s built-bounds fields for "this mount has built no control". */
    private const val NO_BUILT_CONTROL = -1L

    /** [readReport]'s built-bounds fields for "the app never set that bound". */
    private const val NO_BUILT_BOUND = -2L

    /**
     * How many presentations this process has open right now.
     *
     * Process-wide rather than per mount, because the property it guards is "no
     * presentation outlives the mount that opened it" - and a mount that has been
     * dropped has nothing left to ask. [DatePickerHost.Presentation] counts itself in
     * a `DisposableEffect`, so the number only returns to zero when the *composition*
     * that opened the dialog went away: closing the dialog, dropping the view and
     * disposing the composition each take their own path, and a leak on any of them
     * leaves the count above zero for a fresh mount to read.
     */
    val livePresentations = AtomicInteger(0)
  }

  /**
   * How many Material 3 calendar states this mount has built - the last field of
   * [readReport].
   *
   * A rebuild is what a bounds change costs a calendar (see the `key(...)` at each
   * `rememberDatePickerState` call site): the page the user turned to and an open
   * dialog's provisional pick go with it. That is the right price for a *day* of
   * movement in a bound and the wrong price for a millisecond of it, and the only
   * honest way to say which one a re-render cost is to count them. Not observed state
   * on purpose: nothing may recompose because a counter moved, and the counter is
   * incremented from inside a `key` block, which runs during composition.
   */
  private val controlBuilds = AtomicInteger(0)

  /**
   * The control last counted, by identity. A rebuild is a *new* state object; a
   * recomposition of the one already there is not, and Compose may run a composition
   * more than once - so the count is keyed on the object rather than on how often a
   * block ran. Written from the main thread only, like the composition itself.
   */
  private var countedControl: Any? = null

  /**
   * The bounds the calendar on screen was built with, as the last two fields of
   * [readReport].
   *
   * Recorded where the build is counted, because that is where a calendar is built:
   * the `key(...)` block runs exactly when the `key` produced a new slot, so the
   * bounds read there are the ones the new state was handed. iOS publishes the same
   * pair from the control's own appearance
   * (`HybridNitroUiDatePicker.swift`, `noteControlBuilt(minimum:maximum:)`), which is
   * what lets one harness test assert "the identity's bounds reached the live
   * control" on both platforms.
   */
  private var builtMinimum: Double? = null
  private var builtMaximum: Double? = null

  /** One platform control built (see [controlBuilds]); counted once per control. */
  fun noteControlBuild(control: Any) {
    if (countedControl !== control) {
      countedControl = control
      controlBuilds.incrementAndGet()
      // Under [reportLock], because that is the lock [readReport] takes to print the
      // pair: the two fields are one statement about one control, and writing them
      // unguarded would let a reader see the new minimum with the old maximum. The
      // harness polls, so the race it prevents is not one a test would trip often -
      // which is exactly why it costs a lock rather than a comment saying "careful".
      synchronized(reportLock) {
        builtMinimum = minimum
        builtMaximum = maximum
      }
    }
  }

  // MARK: - Bounds

  /**
   * [millis] inside `[minimum, maximum]`, with either bound possibly absent.
   *
   * Runs in `afterUpdate()` (never in a prop setter: value and bounds arrive in one
   * batch in unspecified order) and on every user selection, so a day cell the
   * calendar should not have offered, or a dial turned past the bound, is clamped
   * natively and the event JS gets is already legal - the JS wrapper clamps the same
   * way, and both have to agree exactly.
   *
   * Inverted bounds (`minimum > maximum`) make the lower one win: it is the bound the
   * caller wrote first in the common `minimumDate=a maximumDate=b` mistake, and the
   * iOS side collapses its `ClosedRange` to the same answer.
   */
  fun clamp(millis: Double): Double {
    if (!millis.isFinite()) {
      return 0.0
    }
    var value = millis
    maximum?.let { if (value > it) value = it }
    minimum?.let { if (value < it) value = it }
    return value
  }

  /** [clamp] for a number that is not a date at all - `NaN` means "not a date". */
  fun clampOrNull(millis: Double?): Double? = millis?.let { clamp(it) }

  // MARK: - Presentation

  /**
   * Open or close the `compact` field's dialog.
   *
   * Every write goes through here - the press, `onDismissRequest` (outside tap and
   * the platform back gesture), `reset()`, `onDropView()`, the `disabled` write in
   * [afterUpdate] and the dialog subtree's `onDispose` - because the flag has to
   * describe reality for [readReport] to be worth testing with.
   */
  fun setPresented(next: Boolean) {
    if (next == presented) {
      return
    }
    presentedSnapshot = next
    publishReport()
  }

  // MARK: - Interaction

  /**
   * The user picked [millis] - through a day cell, a dial, or a simulated selection.
   *
   * Optimistic (`core.md` section 4): [displayed] moves now, so there is no visual
   * latency while React round-trips, and `(millis, eventCount)` goes out under a
   * fresh count. A write React sends later either lands on the next `afterUpdate()`
   * (accepted) or the handshake reverts `displayed`, which is the snap-back.
   *
   * A selection that does not move the displayed instant reports nothing, which is
   * what keeps the two platforms emitting the same events: iOS's `DatePicker` binding
   * only writes when the date changes, while Material 3 hands a click handler that
   * fires for every day cell including the selected one. It is also what makes a
   * rejected change *observable*: once the revert has landed, tapping the same day
   * again must report nothing.
   */
  fun applyUserSelection(millis: Double) {
    // A disabled control is inert. The composable also blocks input
    // ([nuiBlockInput] for the two picker variants, and Material 3's own disabled
    // button for `compact`), but `nuiTestSelect` does not go through the view, and
    // "disabled emits nothing" is only assertable if this path agrees.
    if (!enabled) {
      return
    }
    val next = clamp(millis)
    if (next == displayed) {
      return
    }
    val eventCount = state.user(next)
    displayed = next
    publishReport()
    onChange?.invoke(next, eventCount.toDouble())
  }

  // MARK: - Reports

  /** Snapshot [displayed] and [presented] for [readReport]. */
  fun publishReport() {
    val shown = displayed
    val open = presented
    synchronized(reportLock) {
      if (shown == publishedDisplayed && open == publishedPresented) {
        return
      }
      publishedDisplayed = shown
      publishedPresented = open
      report = "${shown.toLong()}|${if (open) 1 else 0}"
    }
  }

  /**
   * Publish what the composed calendar is showing (see [calendarMonthUtcMillis]).
   *
   * Idempotent, like [publishReport]: the effect that calls it re-runs whenever the
   * calendar's month or selection changes, and a string build per recomposition is
   * exactly the per-render work the perf contract forbids.
   */
  fun publishCalendar(monthUtcMillis: Long, hasSelection: Boolean) {
    val selection = if (hasSelection) 1L else 0L
    synchronized(reportLock) {
      if (calendarMonthUtcMillis == monthUtcMillis && calendarHasSelection == selection) {
        return
      }
      calendarMonthUtcMillis = monthUtcMillis
      calendarHasSelection = selection
    }
  }

  /** The calendar this mount composed is gone; the two calendar fields say so. */
  fun clearCalendar() {
    synchronized(reportLock) {
      calendarMonthUtcMillis = NO_CALENDAR
      calendarHasSelection = NO_CALENDAR
    }
  }

  /**
   * The last published report, as
   * `"<displayed ms>|<presented>|<calendar month>|<calendar has selection>|<live presentations>|<calendar builds>|<built minimum>|<built maximum>"`.
   * Safe from any thread.
   *
   * The first two fields are published (they are model state); the calendar pair is
   * published by the calendar's own effect; the presentation count is read live,
   * because it is process-wide state that this mount does not own; the build count is
   * read live too, because the point of reading it is to compare it before and after a
   * re-render. The last pair is what the calendar on screen was *built* with
   * (see [noteControlBuild]) - `-1` for "no calendar built yet", `-2` for "that bound
   * is unset" - so the same harness assertion about identity can be made on both
   * platforms.
   */
  fun readReport(): String =
    synchronized(reportLock) {
      // -1 on both fields for "no control built yet", exactly as iOS spells it, and
      // -2 for one bound the app never set. The two cannot be told apart from the
      // bounds alone (both are `null` there), so the build count decides.
      val built = controlBuilds.get() > 0
      "$report|$calendarMonthUtcMillis|$calendarHasSelection|${livePresentations.get()}|${controlBuilds.get()}|${
        if (built) builtMinimum?.toLong() ?: NO_BUILT_BOUND else NO_BUILT_CONTROL
      }|${if (built) builtMaximum?.toLong() ?: NO_BUILT_BOUND else NO_BUILT_CONTROL}"
    }

  // MARK: - Material 3's calendar arithmetic

  /**
   * UTC midnight of the *local* day [millis] falls on.
   *
   * Material 3's `DatePickerState.selectedDateMillis` is documented as "UTC
   * midnight", deliberately: a calendar cell is a day, and a day belongs to a time
   * zone. Storing the local day as UTC midnight is what stops the picker from
   * deciding the day for itself - handing it a local instant would make it read the
   * day in UTC, which is the previous or next day for half the planet.
   */
  fun toUtcMidnightOfLocalDay(millis: Double): Long {
    val local = Calendar.getInstance().apply { timeInMillis = millis.toLong() }
    return utcCalendar().apply {
      clear()
      set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH))
    }.timeInMillis
  }

  /**
   * The instant of the day `utcMidnightMillis` names, at the time of day [millis]
   * already had.
   *
   * The other half of the round trip, and the reason a pick preserves the clock:
   * [Calendar.set] on the year/month/day keeps `HOUR`/`MINUTE`/`SECOND` as wall-clock
   * values and recomputes the offset, so crossing a DST boundary keeps the time the
   * user sees rather than the instant - which is what a calendar cell means.
   */
  fun fromUtcMidnightKeepingTimeOfDay(utcMidnightMillis: Long, millis: Double): Double {
    val utc = utcCalendar().apply { timeInMillis = utcMidnightMillis }
    val local = Calendar.getInstance().apply {
      timeInMillis = millis.toLong()
      set(
        utc.get(Calendar.YEAR),
        utc.get(Calendar.MONTH),
        utc.get(Calendar.DAY_OF_MONTH),
      )
    }
    return local.timeInMillis.toDouble()
  }

  /**
   * UTC midnight of the first day of the *local* month [millis] falls in.
   *
   * `DatePickerState` asks for the displayed month, not the displayed day, and both
   * `initialDisplayedMonthMillis` and the `displayedMonthMillis` setter mean "the
   * month starting at this instant". Handing them the day itself works (Material 3
   * truncates it) but says something imprecise, and the day-of-month is exactly the
   * part a page-turn is not supposed to care about.
   */
  fun toUtcMonthStartOfLocalDay(millis: Double): Long {
    val local = Calendar.getInstance().apply { timeInMillis = millis.toLong() }
    return utcCalendar().apply {
      clear()
      set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), 1)
    }.timeInMillis
  }

  /** The instant of the *displayed* day at `hour:minute`, for a time pick. */
  fun fromTimeOfDay(hour: Int, minute: Int, millis: Double): Double =
    Calendar.getInstance().apply {
      timeInMillis = millis.toLong()
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis.toDouble()

  /** Local wall-clock fields of [millis], for a dialog's initial state. */
  fun localFields(millis: Double): Calendar =
    Calendar.getInstance().apply { timeInMillis = millis.toLong() }

  private fun utcCalendar(): Calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"))

  /**
   * The instant of local wall-clock fields, with the day clamped to what that month
   * actually has. Used only by `nuiTestSelect`; see the spec for why fields the mode
   * does not show keep the displayed value.
   */
  fun resolveTestSelection(
    year: Double,
    month: Double,
    day: Double,
    hour: Double,
    minute: Double,
  ): Double {
    val calendar = localFields(displayed)
    if (mode != "time") {
      if (year.isFinite()) {
        calendar.set(Calendar.YEAR, year.toInt())
      }
      if (month.isFinite()) {
        calendar.set(Calendar.MONTH, (month.toInt() - 1).coerceIn(0, 11))
      }
      if (day.isFinite()) {
        val requested = day.toInt().coerceAtLeast(1)
        // A day the target month does not have becomes its last day rather than
        // rolling into the next month, which is what `java.time` and iOS's
        // `DateComponents` both do. `getActualMaximum` reads the *current* year and
        // month, so both sets above have to happen first.
        calendar.set(Calendar.DAY_OF_MONTH, requested.coerceAtMost(calendar.getActualMaximum(Calendar.DAY_OF_MONTH)))
      }
    }
    if (mode != "date") {
      if (hour.isFinite()) {
        calendar.set(Calendar.HOUR_OF_DAY, hour.toInt().coerceIn(0, 23))
      }
      if (minute.isFinite()) {
        calendar.set(Calendar.MINUTE, minute.toInt().coerceIn(0, 59))
      }
      // The dial's own round trip: `fromTimeOfDay` is what the time dialog's OK
      // button calls, so a simulated time pick lands on the instant a real one does
      // (both pin the second and the millisecond, which the dial's fields do not carry).
      calendar.timeInMillis = fromTimeOfDay(
        calendar.get(Calendar.HOUR_OF_DAY),
        calendar.get(Calendar.MINUTE),
        calendar.timeInMillis.toDouble(),
      ).toLong()
    }
    if (mode != "time") {
      // And the day cell's. A real tap hands Material 3 the *local day as the calendar
      // stores it* - UTC midnight - and the control's own conversion turns it back into
      // an instant that keeps the clock. Going through those two functions is what makes
      // `round-trips an instant across a DST boundary` price the conversions rather than
      // the arithmetic in this seam: a `toUtcMidnightOfLocalDay` that stopped converting
      // reads the day back as the *UTC* day, so the instant comes back one day off for
      // any value whose local day is not its UTC day - an instant in the first hour of a
      // day in a positive-offset zone, which is what the DST test picks.
      calendar.timeInMillis = fromUtcMidnightKeepingTimeOfDay(
        toUtcMidnightOfLocalDay(calendar.timeInMillis.toDouble()),
        // The clock the caller assembled above, not the one the control was showing:
        // in `datetime` the hour and minute were just written into `calendar`, and this
        // is the step that only moves the *day*.
        calendar.timeInMillis.toDouble(),
      ).toLong()
    }
    return calendar.timeInMillis.toDouble()
  }
}

/**
 * The `compact` field's text, and the string it must be wide enough for.
 *
 * The width must not depend on the *value*: `nuiSizingKey` is `"<variant>|<mode>"`
 * (`sizingVariantFor` in `DatePicker.tsx`), and two pickers that share a key have to
 * want the same box. If the width came from the displayed date, "Mar 5" and
 * "December 28, 2288" would share a key and each first instance would report a size
 * that corrects the other's box - a layout ping-pong. So the field is as wide as the
 * *widest* string its mode can produce, and [probe] is that string: the composable
 * lays it out invisibly and the real value on top of it, which makes the answer
 * locale- and font-scale-correct without this file measuring text at all (Compose's
 * own measure pass then reports the size, which is why Android needs no width cache).
 *
 * Which candidate is widest is a question about *pixels*, so it is answered by
 * measuring ([WIDEST_MEASURE]) rather than by comparing the strings: `maxOf` over
 * the formatted strings themselves compares them lexicographically, and in a
 * `.MEDIUM` date format a one-digit day sorts *after* a two-digit one, so the
 * alphabetical winner (`Sep 8, 2288`) is a character narrower than the dates people
 * have - `Oct 25, 2026` did not fit the width its own probe selected.
 *
 * Keyed by `(mode, locale)` and process-wide, because a hosted control is its own
 * composition and `remember` cannot share anything between controls
 * (`core.md` "Shared objects"). Dynamic Type is *not* in the key on purpose: it
 * changes what the probe needs to be *in pixels*, not which characters are the
 * widest, and the pixels are Compose's problem. That still holds now that the
 * ranking measures: this object takes the *identity* of the widest string from the
 * measurement and never a size. A text width is a sum of glyph advances times the
 * text size and [TextPaint]'s tracking is in em, so the order is the same at every
 * font scale - only the pixels move, and Compose still produces those.
 */
private object DatePickerFieldText {
  private val cache = HashMap<String, Pair<DateFormat, String>>()

  /** The field's text for [millis]. */
  fun format(
    mode: String,
    millis: Double,
  ): String = entry(mode).first.format(millis.toLong())

  /** The widest text this mode can produce, in the same format as [format]. */
  fun probe(mode: String): String = entry(mode).second

  /** Forget everything. Nothing calls it today - a locale change makes a new key -
   * but the cache is process-wide and this is the handle for whoever needs it. */
  @Synchronized
  fun invalidate() {
    cache.clear()
  }

  @Synchronized
  private fun entry(mode: String): Pair<DateFormat, String> {
    val locale = Locale.getDefault()
    val key = "$mode|${locale.toLanguageTag()}"
    cache[key]?.let { return it }
    val formatter = formatter(mode, locale)
    val widest =
      PROBES.map { probe ->
        val calendar =
          Calendar.getInstance(locale).apply {
            clear()
            set(probe[0], probe[1], probe[2], probe[3], probe[4])
          }
        formatter.format(calendar.time)
      }.maxBy { text -> WIDEST_MEASURE.measureText(text) }
    // The cache is bounded by the handful of modes and locales one app renders; the
    // cap is what stops a control that renders under many `LocaleList`s from growing
    // it for the life of the process.
    if (cache.size >= MAX_ENTRIES) {
      cache.clear()
    }
    val built = formatter to widest
    cache[key] = built
    return built
  }

  private fun formatter(
    mode: String,
    locale: Locale,
  ): DateFormat =
    when (mode) {
      "time" -> DateFormat.getTimeInstance(DateFormat.SHORT, locale)
      "datetime" -> DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale)
      else -> DateFormat.getDateInstance(DateFormat.MEDIUM, locale)
    }

  private const val MAX_ENTRIES = 32

  /**
   * The instrument that picks the widest candidate: the field's own text style
   * (`labelLarge` is 14 sp Medium with 0.05 em tracking) at an arbitrary size,
   * because only the *order* of the candidates is read from it.
   *
   * No width measured here reaches the layout - the composable lays the winning
   * string out and Compose's measure pass turns it into pixels at the user's font
   * scale, which is why this cache holds a string and not a size.
   */
  private val WIDEST_MEASURE =
    TextPaint().apply {
      textSize = 40f
      letterSpacing = 0.05f
      // The face `labelLarge`'s Medium weight resolves to under the default font
      // family. The weight only matters insofar as it can change which candidate is
      // widest; nothing here decides how wide anything is drawn.
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

  /**
   * The dates whose formatting is widest: every digit at its widest form, every month
   * name in the locale rather than the one that *looks* longest in English, and both
   * AM/PM halves. Not a guess at "a long date" - the same set iOS measures, so the
   * two platforms agree about what "fits" means.
   *
   * `year, month(1-based), day, hour, minute`.
   */
  private val PROBES: Array<IntArray> =
    Array(12 * 2 * 5) { index ->
      val month = index / 10 + 1
      val day = if (index % 10 < 5) 8 else 28
      val hour = intArrayOf(0, 8, 12, 20, 23)[index % 5]
      intArrayOf(2288, month, day, hour, 8)
    }
}


/**
 * The dates a [androidx.compose.material3.DatePicker] may offer, from this control's
 * bounds.
 *
 * Material 3 enforces a range in two places and only one of them is exact:
 * `DatePickerState.yearRange` limits where the *calendar can navigate* (whole years),
 * while `SelectableDates.isSelectableDate` decides whether one day is tappable. Both
 * are needed - a `minimumDate` in the middle of a month has to grey that month's
 * earlier days, and a `maximumDate` in February has to stop the year picker in
 * January.
 *
 * Material 3 hands UTC midnights here, so the comparison is against the UTC midnight
 * of the *local* bound: the same conversion the picker's own `initialDateMillis`
 * uses, so "the 14th" means the same day to the calendar, to this class and to the
 * user.
 *
 * The state reads this object once, at construction: `DatePickerState` exposes it as a
 * read-only property, so new bounds reach a mounted calendar by rebuilding the state
 * (see the `key(...)` in [InlinePicker]) rather than by swapping the object here. The
 * caller still `remember`s the instance per `(min, max)` so a recomposition with the
 * same bounds is not a reason to build a new calendar.
 */
private class BoundsSelectableDates(
  private val minUtcMidnight: Long?,
  private val maxUtcMidnight: Long?,
) : SelectableDates {
  override fun isSelectableDate(utcTimeMillis: Long): Boolean =
    (minUtcMidnight == null || utcTimeMillis >= minUtcMidnight) &&
      (maxUtcMidnight == null || utcTimeMillis <= maxUtcMidnight)

  /**
   * A year is reachable when it is not entirely outside the bounds. Only the bound's
   * year number matters here, read in the local zone - a bound at 23:00 UTC on
   * 31 December still names the year that day is in where the user is, which is what
   * a year list shows.
   */
  override fun isSelectableYear(year: Int): Boolean {
    val minYear = minUtcMidnight?.let { localYear(it) }
    val maxYear = maxUtcMidnight?.let { localYear(it) }
    return (minYear == null || year >= minYear) && (maxYear == null || year <= maxYear)
  }

  private fun localYear(utcMidnightMillis: Long): Int =
    Calendar.getInstance().apply { timeInMillis = utcMidnightMillis }.get(Calendar.YEAR)
}

/**
 * The library's tint as a [ColorScheme].
 *
 * Material 3's date and time pickers have no per-instance colour argument meaning "the
 * accent": `DatePickerColors` and `TimePickerColors` are 20-odd-role objects that a
 * tint would have to fill role by role, and every one of those roles is derived from
 * the *scheme's* `primary` in the first place. So a tint is a scheme with a different
 * `primary` - which is also the one-role trade this library already makes for the
 * Switch (`checkedTrackColor`), the Button (`containerColor`) and the SegmentedControl
 * (the selected segment).
 *
 * Process-wide and keyed, because a hosted control is its own composition and `remember`
 * cannot share anything between controls (`core.md` "Shared objects"). The shape is
 * [SegmentedColorsCache]'s: one scheme at a time (identity is the key because identity
 * is what the caller compares), a bounded tinted set, and a scheme change drops
 * everything. `ColorScheme.copy` is 29 fields, so an untinted control must never reach
 * this: it gets the caller's own instance back.
 */
private object TintedSchemeCache {
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  private var tinted: HashMap<Int, ColorScheme>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int,
  ): ColorScheme? {
    adopt(scheme)
    return tinted?.get(tint)
  }

  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int,
    value: ColorScheme,
  ) {
    adopt(scheme)
    val entries = tinted ?: HashMap<Int, ColorScheme>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = value
  }

  /** Drop what a different scheme invalidates. Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    tinted?.clear()
  }
}

/** `model.tintColor` as a scheme, or [base] untouched when there is no tint. */
@Composable
private fun tintedScheme(
  base: ColorScheme,
  tint: Int?,
): ColorScheme {
  if (tint == null) {
    return base
  }
  TintedSchemeCache.get(base, tint)?.let { cached -> return cached }
  val built = base.copy(primary = ComposeColor(tint))
  TintedSchemeCache.put(base, tint, built)
  return built
}

/**
 * The label, the value and the disabled state - on the node the user is actually on.
 *
 * `core.md` §3 "testID and accessibility" bans putting `contentDescription` on a
 * container: TalkBack then stops at the box *and* at the control inside it, and the
 * control - the thing the date is in - arrives nameless. So this goes on the
 * `OutlinedButton`, the `DatePicker` or the `TimePicker` itself, and the container
 * carries no semantics at all. `stateDescription` carries the formatted value: with a
 * `contentDescription` set, TalkBack reads that as the node's name instead of the
 * button's own text, and without it the field would announce "Departure, button" and
 * never the day (the same bug M3 found on iOS, seen from Android).
 *
 * A *disabled* calendar is the second half of the same complaint. Material 3's
 * `DatePicker` and `TimePicker` take no `enabled` - the calendar is a layout, not a
 * control - so a plain `disabled()` on a container left every day cell of a disabled
 * picker offered to TalkBack as an enabled button, activatable, while "disabled" was
 * announced on a node the user was not on. Here the disabled state replaces the
 * subtree's semantics with one disabled node ([clearAndSetSemantics]) and swallows the
 * gestures ([nuiBlockInput]) so a tap cannot move a selection at all. Two things still
 * make `disabled` honest underneath: [DatePickerModel.applyUserSelection] refuses to
 * emit while disabled, and [syncDatePicker]/[syncTimePicker] write the model's value
 * back into the picker, so a selection that did arrive is put back by the same
 * recomposition rather than left painted.
 */
private fun Modifier.nuiFieldSemantics(
  label: String?,
  value: String,
  enabled: Boolean,
): Modifier =
  semantics(mergeDescendants = true) {
    if (label != null) contentDescription = label
    stateDescription = value
    if (!enabled) disabled()
  }

/** [nuiFieldSemantics] for the two picker variants, which also have to stop being usable. */
private fun Modifier.nuiControlSemantics(
  label: String?,
  value: String,
  enabled: Boolean,
): Modifier =
  if (enabled) {
    nuiFieldSemantics(label = label, value = value, enabled = true)
  } else {
    nuiBlockInput().clearAndSetSemantics {
      disabled()
      contentDescription = label ?: value
      stateDescription = value
    }
  }

/**
 * Swallow every gesture over this node at the [PointerEventPass.Initial] pass, so
 * nothing below it sees a touch.
 *
 * `Initial`, not `Main`, because that is the pass a parent is guaranteed to see before
 * its children do: consuming here means the day cells and the clock's dial never get
 * the event, rather than getting it and having it taken back.
 */
private fun Modifier.nuiBlockInput(): Modifier =
  pointerInput(Unit) {
    awaitEachGesture {
      awaitFirstDown(pass = PointerEventPass.Initial).consume()
      do {
        val event = awaitPointerEvent(PointerEventPass.Initial)
        event.changes.forEach { it.consume() }
      } while (event.changes.any { it.pressed })
    }
  }

/** The disabled *look*. The announcement is [nuiControlSemantics]'s job, not this one's. */
private fun Modifier.nuiDisabledLook(enabled: Boolean): Modifier =
  if (enabled) this else alpha(DISABLED_ALPHA)

private const val DISABLED_ALPHA = 0.38f

/**
 * The control's host: [NitroComposeHost] plus this component's composable.
 *
 * [Component] is fixed for the lifetime of the view, which is why it lives in a subclass
 * rather than being handed in as a lambda - there is no `setContent` anywhere in this
 * library after construction.
 */
private class DatePickerHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: DatePickerModel,
) : NitroComposeHost<DatePickerModel>(context, activity, model) {
  /**
   * A `<Host>` composes this control, dialog and all (H2b).
   *
   * The allowlist line the other controls have, with the matching JS row in
   * `src/components/Host/HostChildren.ts`. A Material 3 dialog is a window, and a
   * window is what a Host was said not to be able to own. What decides it is *which
   * composition* composes the `Dialog`, because that composition is what closes the
   * window: composed by the Host, the dialog goes away with the Host's disposal - the
   * same rule that keeps an unhosted dialog from outliving its mount (`onDropView`),
   * with the Host's composition standing in for the control's own.
   * `example/__tests__/HostPopups.harness.tsx` measures it rather than reasoning it.
   */
  override val isHostable: Boolean
    get() = true

  /**
   * Whether this device shows clocks in 24-hour time.
   *
   * Read once from the context this host belongs to: it is a device setting rather
   * than a prop, and Material 3's `TimePickerState` only accepts it at construction.
   * Flipping the system setting under a mounted picker therefore leaves a clock face
   * in the old convention until the picker is next built, which is the same class of
   * gap as a locale change (see `docs/components/date-picker.md`, Environment).
   */
  private val twentyFourHour: Boolean = android.text.format.DateFormat.is24HourFormat(context)

  @Composable
  override fun Component(model: DatePickerModel) {
    val tint = model.tintColor
    val scheme = MaterialTheme.colorScheme
    val mode = model.mode
    val enabled = model.enabled
    val variant = model.variant

    // One `Box` for the whole control, because `NitroUiMeasuredRoot` measures
    // `measurables.firstOrNull()`: a second root measurable would make the size the
    // engine is told depend on which child Compose visited first. A `Dialog` is not a
    // measurable - it is a separate window - so it can live in this Box, and living
    // here is the point: it is composed by *this* composition, so the composition
    // disposal in `NitroComposeHost.drop()` closes it with the mount.
    MaterialTheme(colorScheme = tintedScheme(scheme, tint)) {
      Box(
        // The container carries no semantics: a `contentDescription` here would be a
        // TalkBack stop of its own, in front of the control that has the date
        // (`core.md` §3, and the reason `model.accessibilityLabel` is applied one level
        // down, on the button or the picker, instead).
        modifier = Modifier.nuiDisabledLook(enabled),
      ) {
        if (variant == "inline" || variant == "wheel") {
          InlinePicker(model, mode)
        } else {
          CompactField(model, mode)
        }
        if (model.presented) {
          Presentation(model, mode)
        }
      }
    }
  }

  /** The `compact` field: a Material 3 outlined button whose width the value cannot move. */
  @Composable
  private fun CompactField(
    model: DatePickerModel,
    mode: String,
  ) {
    val formatted = DatePickerFieldText.format(mode, model.displayed)
    OutlinedButton(
      onClick = {
        // The same entry point `nuiTestPresent()` uses, so a harness press and a real
        // one are one code path.
        model.setPresented(true)
      },
      // A disabled M3 button greys its own content and stops calling `onClick`, so the
      // dialog cannot be opened from a disabled field at all - the same rule iOS's
      // `.disabled(_:)` applies to the field's button.
      enabled = model.enabled,
      modifier = Modifier.nuiFieldSemantics(
        label = model.accessibilityLabel,
        value = formatted,
        enabled = model.enabled,
      ),
    ) {
      // The probe: this mode's widest possible text, laid out invisibly. It is what
      // makes the button as wide as any value it could show, so two pickers sharing an
      // `nuiSizingKey` cannot correct each other's box (see [DatePickerFieldText]).
      // Done with layout rather than a `TextMeasurer`, which is why it is automatically
      // right for the current locale *and* font scale and needs no size cache.
      //
      // `clearAndSetSemantics {}` empties the node: without it TalkBack reads the probe
      // as well, and the field announces a date nobody picked.
      // `Box` rather than the button's own `Row`: a `Row` would place the two texts
      // side by side and make the field as wide as probe *plus* value. Stacked, the
      // field is as wide as the wider of the two - which is the probe for every date
      // this mode can show.
      Box {
        Text(
          text = DatePickerFieldText.probe(mode),
          style = MaterialTheme.typography.labelLarge,
          maxLines = 1,
          modifier = Modifier
            .alpha(0f)
            .clearAndSetSemantics { },
        )
        Text(
          text = formatted,
          style = MaterialTheme.typography.labelLarge,
          maxLines = 1,
          // Asks the `Box` for its own width as well, so the field is
          // `max(probe, value)` instead of exactly the probe. While the probe really
          // is the widest string the mode can produce the two agree and the value
          // cannot move the box; when a probe under-estimates - a locale this file has
          // not met, an era designator, a five-digit year - the cost is a field a few
          // dp too wide for one measure rather than a date the user cannot read.
          // `DatePicker.harness.tsx`'s "gives two compact pickers one box" test keeps
          // that honest: a narrow date and a wide date share one sizing key and must
          // get one box, so a value that moves the box because the probe is short
          // fails there.
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }

  /** The always-visible picker: Material 3's calendar, or its clock. */
  @Composable
  private fun InlinePicker(
    model: DatePickerModel,
    mode: String,
  ) {
    val shown = model.displayed
    if (mode == "time") {
      val fields = model.localFields(shown)
      val state = rememberTimePickerState(
        initialHour = fields.get(Calendar.HOUR_OF_DAY),
        initialMinute = fields.get(Calendar.MINUTE),
        is24Hour = twentyFourHour,
      )
      syncTimePicker(model, state)
      TimePicker(
        state = state,
        modifier = Modifier.nuiControlSemantics(
          label = model.accessibilityLabel,
          value = DatePickerFieldText.format(mode, shown),
          enabled = model.enabled,
        ),
      )
    } else {
      val yearRange = remember(model.minimum, model.maximum, shown) { model.dateYearRange() }
      val selectable = model.rememberSelectableDates()
      val shownDayUtcMidnight = model.toUtcMidnightOfLocalDay(shown)
      // The bounds reach the calendar by *rebuilding* it. `rememberDatePickerState`
      // keeps what it was handed - it stores its arguments in a `rememberSaveable`
      // with no keys, and the public `DatePickerState` exposes `yearRange` and
      // `selectableDates` as read-only properties (the setter for the latter is only
      // on the internal `BaseDatePickerStateImpl`) - so React widening the range has
      // to produce a new state, which is what `key` does. The key is the pair of
      // keys the state consumes: the `SelectableDates` built from the bounds and the
      // navigable year range. Both are *day*-granular - `selectable` is `remember`ed on
      // the bounds' UTC-midnight days, `yearRange` is a pair of years - which is exactly
      // how far a bound reaches this calendar, so a real change to
      // `minimumDate`/`maximumDate` costs the calendar its scroll position: the honest
      // trade, because a calendar offering days this control would clamp away is not the
      // same calendar. Keying the raw bound instants instead costs a rebuild on *every*
      // parent render for the `minimumDate={new Date()}` idiom the docs lead with, which
      // throws away the page the user turned to and an open dialog's provisional pick.
      val state = key(selectable, yearRange) {
        rememberDatePickerState(
          initialSelectedDateMillis = shownDayUtcMidnight,
          // Named, because the second positional argument is *not* a minimum: it is
          // `initialDisplayedMonthMillis`, and leaving it `null` makes Material 3
          // open the calendar on *today's* month - a July value on an October page,
          // with the selected day off-screen.
          initialDisplayedMonthMillis = model.toUtcMonthStartOfLocalDay(shown),
          yearRange = yearRange,
          selectableDates = selectable,
        ).also { model.noteControlBuild(it) }
      }
      syncDatePicker(model, state)
      // No mode toggle: it switches the calendar to a *text entry* form, which is a
      // second control nobody asked for, and for the `wheel` variant - "the picker, not
      // a dialog" - one whose keyboard would take over the screen. The calendar is what
      // this variant means.
      DatePicker(
        state = state,
        showModeToggle = false,
        modifier = Modifier.nuiControlSemantics(
          label = model.accessibilityLabel,
          value = DatePickerFieldText.format(mode, shown),
          enabled = model.enabled,
        ),
      )
    }
  }

  /** The dialog, or the pair of them, behind the `compact` field. */
  @Composable
  private fun Presentation(
    model: DatePickerModel,
    mode: String,
  ) {
    val wantsDate = mode != "time"
    val wantsTime = mode != "date"
    // Which of the two dialogs is up, for `datetime`: exactly one at a time, because
    // Material 3 has no combined control. The step resets with the dialog, since
    // `remember` lives inside the `if (presented)` subtree that disposal destroys.
    var step by remember(wantsDate, wantsTime) { mutableStateOf(if (wantsDate) Step.Date else Step.Time) }

    // Count this presentation for as long as the *composition* that opened it lives.
    // `onDispose` runs when the subtree leaves the composition - the dialog closed, the
    // view dropped (`NitroComposeHost.drop()` disposes), or the host recycled - so the
    // process-wide count returns to zero exactly when nothing of this presentation is
    // left. `DatePickerModel.livePresentations` says why the count is process-wide:
    // the dropped mount has nothing left to report, so `presents nothing after the
    // mount that opened it is gone` reads it through a fresh instance instead.
    DisposableEffect(Unit) {
      DatePickerModel.livePresentations.incrementAndGet()
      onDispose {
        DatePickerModel.livePresentations.decrementAndGet()
        // Take the open flag down with the window (`MenuWitness` in
        // `HybridNitroUiPicker` writes `model.expanded` for the same reason, and says so).
        // Disposal is not only what a close does. Three teardowns reach here with no
        // dismissal in them: the child leaves the Host's list, `display: 'none'` on it
        // (`isHiddenByReact`, which composes no child at all), and the child's row being
        // *moved by layout* - which takes its group out and recomposes it somewhere else.
        // Nothing else clears the flag on those paths: `setVisibility` only tells the
        // Host its drawn content moved. Without the write, the flag outlives the window,
        // and the case that shows the child again composes a dialog over the screen with
        // nobody having asked for it - with no provisional selection left, because
        // `rememberDatePickerState` lives inside the subtree that died.
        //
        // The third of them is what this line *changes* rather than reports, and it was
        // measured both ways: without the write, a hosted dialog whose row moved read
        // `presented=1` with `live=1`, a dialog still open for a row that had moved -
        // the stale-window bug this release fixed for menus. With it, the dialog follows
        // its row, so `docs/components/host.md` can state one rule for both popup
        // controls. The harness reads the flag and the count, never the dialog's rect,
        // so "over the wrong place" is argued from the menu case and not measured here.
        // A change that moves nothing - a sibling's own identity, say - leaves
        // this group alone, so the dialog is not closed by it either (both halves gated
        // in `example/__tests__/HostPopups.harness.tsx`).
        //
        // A no-op on every path that already closed the dialog: dismiss, OK, `disable`,
        // `onDropView` and `reset` all call `setPresented(false)` first, and it returns
        // early when the flag already says `false`.
        model.setPresented(false)
      }
    }

    if (step == Step.Date) {
      val yearRange = remember(model.minimum, model.maximum, model.displayed) { model.dateYearRange() }
      val selectable = model.rememberSelectableDates()
      // Day-granular, for the same reason as the inline calendar's: keying the raw
      // bound instants makes every parent render a rebuild, and inside an open dialog
      // a rebuild discards the selection the user has provisionally made.
      val state = key(selectable, yearRange) {
        rememberDatePickerState(
          initialSelectedDateMillis = model.toUtcMidnightOfLocalDay(model.displayed),
          // Named, and the dialog needs it most: with the second argument positional
          // this dialog opened on *today's* month (or the minimum's), so the day the
          // field was showing was usually not on the page the user was offered.
          initialDisplayedMonthMillis = model.toUtcMonthStartOfLocalDay(model.displayed),
          yearRange = yearRange,
          selectableDates = selectable,
        ).also { model.noteControlBuild(it) }
      }
      // The dialog's *selection* stays provisional until OK, so nothing here syncs it
      // back into the model; what it does publish is the page and whether a day is lit,
      // so `nuiTestStateReport` can see a dialog opened on the wrong month.
      publishCalendarFacts(model, state)
      // ...and the model's value reaches the dialog in one direction only. The
      // provisional pick belongs to the user, so an open dialog never *emits*; a value
      // React sends while it is up is a different thing, and it moves the dialog's page
      // and lit day with it (the G5 follow-up, fixed here because H2b made the hosted
      // case observable - `docs/tasks/FOLLOWUPS.md`).
      followValueInDialog(model, state)
      DatePickerDialog(
        // Outside tap, the platform back gesture and the back *button* all land here:
        // `DialogProperties` defaults dismiss on both, which is the brief's "the app's
        // back gesture dismisses it", and it is the same entry point a dismiss button
        // uses. Nothing here has to own the window to close it.
        onDismissRequest = { model.setPresented(false) },
        confirmButton = {
          TextButton(
            onClick = {
              val picked = state.selectedDateMillis
              model.applyUserSelection(
                if (picked == null) {
                  model.displayed
                } else {
                  model.fromUtcMidnightKeepingTimeOfDay(picked, model.displayed)
                },
              )
              if (wantsTime) {
                // `datetime`: the date is committed *first*, so a time dialog that the
                // user then dismisses still left a committed date - the same thing iOS's
                // single combined control does when the popover closes.
                step = Step.Time
              } else {
                model.setPresented(false)
              }
            },
          ) { Text(stringResource(android.R.string.ok)) }
        },
        dismissButton = {
          TextButton(onClick = { model.setPresented(false) }) { Text(stringResource(android.R.string.cancel)) }
        },
      ) {
        DatePicker(state = state, showModeToggle = false)
      }
    } else {
      val fields = model.localFields(model.displayed)
      val state = rememberTimePickerState(
        initialHour = fields.get(Calendar.HOUR_OF_DAY),
        initialMinute = fields.get(Calendar.MINUTE),
        is24Hour = twentyFourHour,
      )
      // [followValueInDialog] for the dial: the same one-directional rule.
      followTimeValueInDialog(model, state)
      TimePickerDialog(
        onDismissRequest = { model.setPresented(false) },
        title = { Text(stringResource(androidx.compose.material3.R.string.m3c_time_picker_dialog_title)) },
        confirmButton = {
          TextButton(
            onClick = {
              model.applyUserSelection(model.fromTimeOfDay(state.hour, state.minute, model.displayed))
              model.setPresented(false)
            },
          ) { Text(stringResource(android.R.string.ok)) }
        },
        dismissButton = {
          TextButton(onClick = { model.setPresented(false) }) { Text(stringResource(android.R.string.cancel)) }
        },
      ) {
        TimePicker(state = state)
      }
    }
  }

  private enum class Step { Date, Time }
}

/**
 * Keep Material 3's calendar selection and the model's date equal, in both directions.
 *
 * The direction that matters is model → picker. Material 3's `DatePickerState` owns its
 * selection and *keeps* it: `rememberDatePickerState` does not re-read
 * `initialDateMillis` after construction, so a value React sends later - or a change JS
 * rejected, which is the whole content of the controlled-rejection test - would leave
 * the calendar on a day the control does not have. The model decides what is selected,
 * so the model writes it here.
 *
 * The other direction turns a tap into an event. An inline picker has no confirm
 * button, so the calendar moving *is* the pick; iOS's graphical `DatePicker` writes its
 * binding on the same tap, which is the behaviour this matches. A selection the model
 * did not take (disabled, or a clamp back onto the same instant) is written back into
 * the state at the end, which is what makes the picker inert rather than lying.
 *
 * The two effects cannot loop: each writes only when the value it is about to write
 * differs from what it just read, so the second effect sees `next == displayed` and
 * stops.
 */
/**
 * Publish the two facts a composed Material 3 calendar owns (see
 * [DatePickerModel.publishCalendar]) for as long as it is composed.
 *
 * Both are `mutableStateOf`-backed properties of the state, so reading them here
 * subscribes: a page turned under a finger re-publishes, and the harness can see a
 * month that never followed the value - which the model's own pair cannot show.
 *
 * Read-only on purpose, and used by both calendars this component composes: the inline
 * picker (through [syncDatePicker], which *also* syncs) and the `compact` dialog (which
 * must not sync - its selection is provisional until OK). Without the dialog half, the
 * case the screenshot got wrong - a dialog open on the wrong month - would be exactly
 * the one the report could not see.
 */
@Composable
private fun publishCalendarFacts(model: DatePickerModel, state: DatePickerState) {
  val calendarMonth = state.displayedMonthMillis
  val calendarSelected = state.selectedDateMillis
  DisposableEffect(state) {
    onDispose { model.clearCalendar() }
  }
  LaunchedEffect(calendarMonth, calendarSelected) {
    model.publishCalendar(calendarMonth, calendarSelected != null)
  }
}

@Composable
private fun syncDatePicker(
  model: DatePickerModel,
  state: DatePickerState,
) {
  publishCalendarFacts(model, state)
  val shown = model.displayed
  // The day the *model* last wrote into the state, written next to that write.
  //
  // `LaunchedEffect(selected)` below has to tell a user's tap from the model's own
  // write, and the instant it used to compare against - `model.displayed` - can be a
  // frame behind the day it pushed: the frame that moves the value writes the new day,
  // and a read-back that then prices the *old* instant against the *new* day calls
  // the model's own page change a pick, and the control emits the instant it was just
  // given. A day compared against the day that was written is the same decision
  // without the race, because both sides of it are written in one synchronous block.
  val pushed = remember(state) { mutableStateOf(state.selectedDateMillis) }
  LaunchedEffect(shown) {
    val wanted = model.toUtcMidnightOfLocalDay(shown)
    if (state.selectedDateMillis != wanted) {
      pushed.value = wanted
      state.selectedDateMillis = wanted
    }
    // ...and the *page* moves with it. `initialDisplayedMonthMillis` is read once at
    // construction, so without this a programmatic value - the example screen's
    // "Reset to 2026-01-01", or a parent refusing a pick - selects a day on a page the
    // user is not looking at. An inline picker's scroll back to a rejected day is the
    // same write.
    val wantedMonth = model.toUtcMonthStartOfLocalDay(shown)
    if (state.displayedMonthMillis != wantedMonth) {
      state.displayedMonthMillis = wantedMonth
    }
  }
  val selected = state.selectedDateMillis
  LaunchedEffect(selected) {
    val picked = selected ?: return@LaunchedEffect
    if (picked != pushed.value) {
      model.applyUserSelection(model.fromUtcMidnightKeepingTimeOfDay(picked, model.displayed))
    }
    val wanted = model.toUtcMidnightOfLocalDay(model.displayed)
    // Record the day the state holds *whether or not* this block had to write it. A
    // pick the model accepted needs no write, so writing only inside the `if` left
    // `pushed` on the day before the tap - and the next tap, back onto that day, then
    // read as the model's own write: nothing was emitted, and the calendar snapped
    // forward again under the finger. The race the guard exists for stays closed
    // because `pushed` is still set before every write this control makes.
    pushed.value = wanted
    if (state.selectedDateMillis != wanted) {
      state.selectedDateMillis = wanted
    }
  }
}

/** [syncDatePicker] for Material 3's clock, which stores hour and minute instead of a day. */
@Composable
private fun syncTimePicker(
  model: DatePickerModel,
  state: TimePickerState,
) {
  val shown = model.displayed
  // `syncDatePicker`'s own-write guard, in the clock's two fields: comparing the dial
  // against `model.displayed` prices a model-driven write as a pick when the instant is
  // a frame behind, so the pair written to the state is remembered next to the write.
  val pushed = remember(state) {
    mutableStateOf(Pair(state.hour, state.minute))
  }
  LaunchedEffect(shown) {
    val hour = model.localFields(shown).get(Calendar.HOUR_OF_DAY)
    val minute = model.localFields(shown).get(Calendar.MINUTE)
    if (state.hour != hour || state.minute != minute) {
      pushed.value = Pair(hour, minute)
      state.hour = hour
      state.minute = minute
    }
  }
  val hour = state.hour
  val minute = state.minute
  LaunchedEffect(hour, minute) {
    if (hour != pushed.value.first || minute != pushed.value.second) {
      model.applyUserSelection(model.fromTimeOfDay(hour, minute, model.displayed))
    }
    // Same snap-back: a pick the model refused must not stay painted on the dial.
    val fields = model.localFields(model.displayed)
    val wanted = Pair(fields.get(Calendar.HOUR_OF_DAY), fields.get(Calendar.MINUTE))
    // Recorded unconditionally, exactly as in `syncDatePicker`: a dial returned by
    // hand to the hour it started on is a pick, not the model's own write.
    pushed.value = wanted
    if (state.hour != wanted.first || state.minute != wanted.second) {
      state.hour = wanted.first
      state.minute = wanted.second
    }
  }
}

/**
 * [syncDatePicker]'s model -> dialog half, for a dialog whose selection is provisional.
 *
 * The half, not the whole: an open Material 3 dialog does not emit while the user turns
 * its calendar, so the second effect of [syncDatePicker] - the one that reads a changed
 * state back as a pick - would turn every provisional tap into an event and break the
 * confirm-button contract the dialog exists for. What stays is the direction that was
 * missing: a value React writes *while the dialog is open* now moves the dialog's day
 * and page, instead of the dialog sitting on a date the control no longer has until it
 * is closed.
 *
 * A user's provisional pick does not move `model.displayed` - only OK does - so the two
 * writers cannot race: this fires when React changes the value, and a provisional tap
 * is not such a change. `DatePickerState` keeps what it was handed
 * (`rememberDatePickerState` does not re-read its arguments), which is exactly why the
 * write has to be made here rather than at construction.
 */
@Composable
private fun followValueInDialog(
  model: DatePickerModel,
  state: DatePickerState,
) {
  val shown = model.displayed
  LaunchedEffect(shown) {
    val wanted = model.toUtcMidnightOfLocalDay(shown)
    if (state.selectedDateMillis != wanted) {
      state.selectedDateMillis = wanted
    }
    val wantedMonth = model.toUtcMonthStartOfLocalDay(shown)
    if (state.displayedMonthMillis != wantedMonth) {
      state.displayedMonthMillis = wantedMonth
    }
  }
}

/** [followValueInDialog] for Material 3's clock dialog, which stores hour and minute. */
@Composable
private fun followTimeValueInDialog(
  model: DatePickerModel,
  state: TimePickerState,
) {
  val shown = model.displayed
  LaunchedEffect(shown) {
    val fields = model.localFields(shown)
    val hour = fields.get(Calendar.HOUR_OF_DAY)
    val minute = fields.get(Calendar.MINUTE)
    if (state.hour != hour || state.minute != minute) {
      state.hour = hour
      state.minute = minute
    }
  }
}

/**
 * Material 3's navigable year range for this control's bounds.
 *
 * Material 3's own default (1900-2100) applies where a bound is absent, widened to
 * include the year being displayed: a calendar whose range excludes the day it should
 * show cannot show it - the state clamps its selection into the range, so a
 * `defaultValue` of 2300 with no `maximumDate` would otherwise open on a month with
 * nothing selected. Documented as a platform gap in `docs/components/date-picker.md`:
 * unlike SwiftUI, whose picker scrolls to any instant, Material 3's calendar can only
 * be navigated inside a range, and "no bounds" means *this* range on Android.
 */
internal fun DatePickerModel.dateYearRange(): IntRange {
  val start = minOf(minimum?.let { localFields(it).get(Calendar.YEAR) } ?: DEFAULT_YEAR_START, localFields(displayed).get(Calendar.YEAR))
  val end = maxOf(maximum?.let { localFields(it).get(Calendar.YEAR) } ?: DEFAULT_YEAR_END, localFields(displayed).get(Calendar.YEAR))
  return start..end
}

/**
 * Material 3's `SelectableDates` for this control's bounds, stable while the bounds are.
 *
 * `remember`ed so a recomposition with unchanged bounds is not a reason to allocate a
 * new one. It is *not* what makes new bounds reach a mounted calendar - the state reads
 * it once, so that is the `key(...)` at each call site of
 * [androidx.compose.material3.rememberDatePickerState]'s job.
 */
@Composable
private fun DatePickerModel.rememberSelectableDates(): SelectableDates =
  remember(
    minimum?.let { toUtcMidnightOfLocalDay(it) },
    maximum?.let { toUtcMidnightOfLocalDay(it) },
  ) {
    BoundsSelectableDates(
      minimum?.let { toUtcMidnightOfLocalDay(it) },
      maximum?.let { toUtcMidnightOfLocalDay(it) },
    )
  }

private const val DEFAULT_YEAR_START = 1900
private const val DEFAULT_YEAR_END = 2100

/** The Hybrid View React renders as `NitroUiDatePicker`. */
class HybridNitroUiDatePicker(
  reactContext: ThemedReactContext,
) : HybridNitroUiDatePickerSpec(), RecyclableView {
  private val model = DatePickerModel()

  /** Where [runOnUi] sends work that is not already on the UI thread. */
  private val mainHandler = Handler(Looper.getMainLooper())
  private val host = DatePickerHost(reactContext, reactContext.currentActivity, model)

  /** The Nitro `view` - created once here and never replaced. */
  override val view: View
    get() = host

  init {
    // The fitting size is both measured and pushed (docs/architecture/sizing.md).
    host.wantsContentSize = true
    // `compact` - the default - is intrinsic. The `variant` setter moves this for the
    // two picker variants, and the JS wrapper remounts on a variant change so the
    // policy is a property of the mount, not of prop order.
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // The backstop: `NitroUiDeclaredFallbacks` registers this at startup, which is the
    // point that matters (see its doc comment).
    declareFallback()
  }

  companion object {
    /**
     * This component's name in the sizing engine: `HybridNitroUiDatePickerComponentName`
     * in the generated C++, and `getName()` in the generated manager.
     */
    private const val SIZING_COMPONENT_NAME = "NitroUiDatePicker"

    /**
     * The size to lay a DatePicker out with before anything has been measured, in dp.
     *
     * One pair for a component with six configurations, because the engine's fallback is
     * keyed by component alone: this is the most common one - a `compact` `date` field -
     * and every other configuration is a first instance of *its own* configuration that
     * gets corrected the turn it measures (`docs/architecture/sizing.md` section 9).
     *
     * Measured on `nitroui_t02` (420 dpi, API 35, `en-US` - the emulator's default)
     * for `variant = "compact"`, `mode = "date"`: the compact field's box is
     * **131.05 x 48 dp**. `131.0` is within the engine's 0.5 dp epsilon
     * (`NitroUiSizingEngine.hpp`'s `kEpsilon`), so a cold `compact` `date` mount is
     * laid out at its own size and pays no correction (D17); the old `150 x 40` was
     * 8 dp short vertically, so every cold compact field on Android corrected on its
     * second frame.
     *
     * The 48 dp is not the button's own height (Material 3 draws a 40 dp outline) but
     * the 48 dp minimum interactive size M3 puts under it - the same reason stock
     * `Switch` and `Button` boxes are 48 tall here. The width is the widest `date`
     * string this locale's formatter can produce (see `DatePickerFieldText`), so it
     * moves with the locale - a locale with a longer format costs one horizontal
     * correction on that configuration's first instance, which is the documented
     * trade of a key that excludes the value.
     */
    private const val FALLBACK_WIDTH_DP = 131.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process, before the first DatePicker can be measured.
     *
     * Called from `NitroUiDeclaredFallbacks.registerAll()` at package init - a Fabric
     * measure can happen before this class has ever been instantiated, so a fallback
     * declared from `init` is one measure too late for the first instance (T14) - and
     * from `init` as the backstop. The two calls land on different threads, hence the
     * atomic.
     */
    internal fun declareFallback() {
      if (!fallbackDeclared.compareAndSet(false, true)) {
        return
      }
      NitroUiSizing.setFallback(
        SIZING_COMPONENT_NAME,
        FALLBACK_WIDTH_DP,
        FALLBACK_HEIGHT_DP,
        NitroUiSizing.POLICY_INTRINSIC,
      )
    }
  }

  // MARK: - Props
  // Setters only store and mark dirty; everything is applied in `afterUpdate()`.

  override var valueMillis: Variant_NullType_Double
    get() =
      model.state.js?.let {
        // The *clamped* instant, not the number React sent - same as Slider's `value`
        // and SegmentedControl's `selectedIndex`, and what makes a value the bounds
        // rejected visible to a test instead of readable as if it were live.
        Variant_NullType_Double.Second(model.clamp(it))
      } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // Not visual on its own: `displayed` only follows once the event count says JS has
      // caught up, and the instant only means something against the bounds, which can be
      // in this same batch. Both happen in `afterUpdate()`.
      model.state.js = next.asSecondOrNull()
    }

  override var defaultValueMillis: Double
    get() = model.defaultValueMillis
    set(next) {
      // Stored raw: it has to be clamped against bounds that may arrive after it.
      model.defaultValueMillis = next
    }

  override var mostRecentEventCount: Double
    get() = model.state.jsEvents.toDouble()
    set(next) {
      model.state.jsEvents = next.toInt()
    }

  override var mode: String
    get() = model.mode
    set(next) {
      if (next == model.mode) {
        return
      }
      model.mode = next
      // A time field is not the same width as a date field, and Material 3's clock is
      // not the same height as its calendar. Compose notices the recomposition and its
      // own measure pass reports the new size (sizing.md section 5), so Android needs no
      // explicit "the size may have moved" call - unlike iOS, which has to ask.
      host.markDirty()
    }

  override var variant: String
    get() = model.variant
    set(next) {
      if (next == model.variant) {
        return
      }
      model.variant = next
      host.markDirty()
      // The biggest size change this component can make - a 40 dp field versus a
      // ~400 dp calendar - and it also changes *how* the size is decided, which is what
      // Progress does per `variant` and Slider does statically.
      host.sizingPolicy =
        if (next == "compact") {
          NitroUiSizing.POLICY_INTRINSIC
        } else {
          NitroUiSizing.POLICY_FILL_WIDTH
        }
    }

  override var minimumMillis: Variant_NullType_Double
    get() =
      model.minimum?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      if (raw == model.minimum) {
        return
      }
      // Repaints (Material 3 greys the days it is told are unselectable) and can move the
      // displayed instant, which `afterUpdate()` applies. Not a size change: the
      // calendar's shape does not depend on the range.
      model.minimum = raw
      host.markDirty()
    }

  override var maximumMillis: Variant_NullType_Double
    get() =
      model.maximum?.let { Variant_NullType_Double.Second(it) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      if (raw == model.maximum) {
        return
      }
      model.maximum = raw
      host.markDirty()
    }

  override var disabled: Boolean
    get() = !model.enabled
    set(next) {
      val enabled = !next
      if (enabled == model.enabled) {
        return
      }
      model.enabled = enabled
      host.markDirty()
    }

  override var tintColor: Variant_NullType_Double
    get() =
      model.tintColor?.let { Variant_NullType_Double.Second(it.toDouble()) }
        ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      val raw = next.asSecondOrNull()
      // `processColor` on Android hands back the ARGB int as a double. Going via
      // `toLong()` keeps the bit pattern (D10): `Double.toInt()` saturates, so an opaque
      // colour above `Int.MAX_VALUE` would become `Int.MAX_VALUE`.
      val argb = if (raw != null && raw.isFinite()) raw.toLong().toInt() else null
      if (argb == model.tintColor) {
        return
      }
      model.tintColor = argb
      host.markDirty()
    }

  override var testID: Variant_NullType_String
    get() =
      (host.tag as String?)?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    // Same as RN's own `BaseViewManager.setTestID`: the tag is what
    // `findNodeByName`/testID matchers read on Android.
    set(next) {
      host.tag = next.asSecondOrNull()
    }

  override var accessibilityLabel: Variant_NullType_String
    get() =
      model.accessibilityLabel?.let { Variant_NullType_String.Second(it) }
        ?: Variant_NullType_String.First(NullType.NULL)
    set(next) {
      val label = next.asSecondOrNull()
      if (label == model.accessibilityLabel) {
        return
      }
      // Rendered, not bookkeeping: the label goes on the control's semantics node, so it
      // needs a commit or a late-set label never reaches TalkBack.
      model.accessibilityLabel = label
      host.markDirty()
    }

  override var nuiPerfId: Variant_NullType_Double
    get() =
      if (host.perfInstanceId == NitroUiPerf.NO_INSTANCE) {
        Variant_NullType_Double.First(NullType.NULL)
      } else {
        Variant_NullType_Double.Second(host.perfInstanceId.toDouble())
      }
    set(next) {
      val raw = next.asSecondOrNull()
      host.perfInstanceId = if (raw != null && raw.isFinite()) raw.toInt() else NitroUiPerf.NO_INSTANCE
    }

  override var nuiSizingKey: String
    get() = model.sizingKey
    set(next) {
      if (next == model.sizingKey) {
        return
      }
      model.sizingKey = next
      // The engine has no answer for a key it has not seen, so it lays this out at the
      // declared fallback; the new configuration may measure exactly what the old one
      // did, and that is the size the host's dedupe would swallow the correcting report
      // against (review F1). Guarded, because React re-sends an unchanged key on every
      // render and the reset costs a measure.
      host.noteSizingKeyChanged()
    }

  override var nuiSizingId: Double
    get() = host.sizingInstanceId.toDouble()
    set(next) {
      host.sizingInstanceId = if (next.isFinite()) next.toLong() else NitroUiSizing.NO_INSTANCE
    }

  override var onValueChange: ((Double, Double) -> Unit)?
    get() = model.onChange
    set(next) {
      model.onChange = next
    }

  // MARK: - Lifecycle

  override fun afterUpdate() {
    val minimum = model.minimum
    val maximum = model.maximum
    // The value, the default and the two bounds can all land in one batch in any order,
    // so none of them is interpreted until the batch is complete - an instant outside the
    // range only means something once the range it belongs to is known (core.md section
    // 3, and Slider's `value` does the same thing against its range).
    model.state.js?.let { js ->
      val clamped = model.clamp(js)
      if (clamped != js) {
        model.state.js = clamped
      }
    }
    if (model.state.js == null && !model.didApplyDefault) {
      model.didApplyDefault = true
      val seeded = model.clamp(model.defaultValueMillis)
      if (seeded != model.displayed) {
        model.state.displayed = seeded
        model.displayed = seeded
        host.markDirty()
      }
    }
    // The event-count handshake decides whether React's instant wins over what the user
    // just picked - including a change JS rejected (core.md section 4).
    if (model.state.reconcile()) {
      model.displayed = model.clamp(model.state.displayed)
      host.markDirty()
    }
    // Bounds that arrived *after* the displayed instant can leave it outside them. The
    // same clamp, and idempotent, so an instant that is already legal comes back
    // unchanged - which is why this runs on every batch without knowing which prop moved.
    val shown = model.clamp(model.state.displayed)
    if (shown != model.displayed) {
      model.state.displayed = shown
      model.displayed = shown
      host.markDirty()
    }
    // A control that has been disabled does not keep a dialog on screen (H2b; the G5
    // review's recommendation for this exact path). Its picks were already refused -
    // `applyUserSelection` is inert while disabled - but a window that offers a list
    // which answers nothing is the half-open state that report named.
    //
    // It lives here because this is the only route to it: [disabled] moves
    // `model.enabled` and nothing else, and there is no JS prop for the open flag -
    // `presented` is written by a press, a dismissal or a teardown, never by a props
    // batch - so this line cannot be replaced by an ordering between two writes. The
    // Picker keeps the same rule in its `disabled` setter
    // (`HybridNitroUiPicker.disabled`); this control cannot, and the difference is
    // visible at the harness: stubbing this line out turns "closes when the control is
    // disabled while the dialog is open" red, where the Picker's copy of it does not.
    if (!model.enabled && model.presented) {
      model.setPresented(false)
    }
    // A batch can move the displayed instant without any rendered change (React
    // confirming what native already picked), and the report must not go stale; the call
    // itself costs two comparisons when nothing moved.
    model.publishReport()
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // `host.perfInstanceId` is cleared inside `host.prepareForRecycle()`, after it has
    // marked the recycle: clearing it here would hide that mark.
    // The dialog first, before anything else: `host.prepareForRecycle()` resets the model
    // (which clears `presented`, and a `Dialog` that stops being composed closes its
    // window), and the next mount must not inherit an open dialog - or, worse, the
    // *previous* mount's, if something kept the composition alive past this call.
    // Not cleared here: `host.prepareForRecycle()` releases the sizing instance (which
    // needs the id to tell the engine), and `onDropView` has already run.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    // The other half of the leak rule, and the reason `presented` is composed rather than
    // tracked: `drop()` disposes the composition, and a `Dialog` composed by a disposed
    // composition is gone with it. Nothing of this mount survives in a window, a listener
    // list or a `DialogManager` (`docs/tasks/B1-android-mount-oom.report.md`).
    model.setPresented(false)
    host.drop()
  }

  // MARK: - Methods

  /**
   * The size Compose measured for this control, from the host's cache. Never calls into
   * Compose, so it is safe on the JS thread (core.md section 5).
   */
  override fun measureContent(): NitroUiDatePickerSize {
    val size = host.contentSize ?: return NitroUiDatePickerSize(0.0, 0.0)
    return NitroUiDatePickerSize(size.width, size.height)
  }

  /**
   * Drive one selection through the real interaction pipeline. Test-only; see the spec's
   * doc comment for why it exists (a calendar cell in a dialog is a *separate window*, so
   * the harness's window-level touch dispatch cannot reach it).
   */
  override fun nuiTestSelect(
    year: Double,
    month: Double,
    day: Double,
    hour: Double,
    minute: Double,
  ) {
    // Props arrive on the UI thread and a `hybridRef` call can arrive on the JS thread;
    // the model is UI-thread state, so hop when needed - and run inline when this call is
    // already where the model lives, rather than paying for a queue round trip the perf
    // contract forbids. Never `sync`: JS must not wait on the UI thread.
    runOnUi {
      model.applyUserSelection(model.resolveTestSelection(year, month, day, hour, minute))
    }
  }

  /** Open the `compact` field's dialog, through the same entry point the press uses. */
  override fun nuiTestPresent() {
    runOnUi { performTestPresent() }
  }

  /** `(displayed, presented)` as one lock-guarded line - the only way JS sees the picker. */
  override fun nuiTestStateReport(): String = model.readReport()

  /** Run [action] on this view's UI thread, now if already there, queued otherwise. */
  private inline fun runOnUi(crossinline action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
      return
    }
    mainHandler.post { action() }
  }

  private fun performTestPresent() {
    // The two picker variants present nothing, and a disabled field cannot be pressed, so
    // both are no-ops - which is also what makes "disabled does not open" a test.
    if (!model.enabled || model.variant != "compact") {
      return
    }
    model.setPresented(true)
  }
}
