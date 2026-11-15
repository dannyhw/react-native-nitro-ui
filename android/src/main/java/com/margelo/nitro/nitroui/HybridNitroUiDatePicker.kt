@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.margelo.nitro.nitroui

import android.app.Activity
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.TextPaint
import android.view.View
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DatePicker
import androidx.compose.material3.ScrollField
import androidx.compose.material3.ScrollFieldColors
import androidx.compose.material3.ScrollFieldState
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePickerState
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.TimePickerDialog
import androidx.compose.material3.TimePickerState
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberScrollFieldState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLocale
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
import androidx.compose.ui.unit.dp
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.NullType
import com.margelo.nitro.nitroui.core.NitroComposeHost
import com.margelo.nitro.nitroui.core.NuiWheelRow
import com.margelo.nitro.nitroui.core.nuiOwnVerticalDrags
import com.margelo.nitro.nitroui.core.nuiReportAtWheelRest
import com.margelo.nitro.nitroui.core.nuiWheelColors
import com.margelo.nitro.nitroui.core.NitroUiControlledValue
import com.margelo.nitro.nitroui.core.NitroUiModel
import com.margelo.nitro.nitroui.core.NitroUiPerf
import com.margelo.nitro.nitroui.core.NitroUiSizing
import com.margelo.nitro.views.RecyclableView
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// Material 3's date and time pickers. Must stay in this package: the generated manager
// finds the implementation through a wildcard import of it.

internal class DatePickerModel : NitroUiModel() {
  /**
   * The selected instant in ms since the epoch: [state]'s `displayed`, mirrored into snapshot
   * state because the handshake is plain state that Compose does not observe.
   */
  var displayed by mutableStateOf(0.0)

  /**
   * A request from the test hook to roll the time wheels. The wheels live in the
   * composition, so the hook leaves a request and the composition turns it into a scroll.
   */
  var timeWheelRequest by mutableStateOf<TimeWheelRequest?>(null)

  var enabled by mutableStateOf(true)

  /** ARGB `processColor` int, or `null` for the scheme's own colours. */
  var tintColor by mutableStateOf<Int?>(null)

  var accessibilityLabel by mutableStateOf<String?>(null)

  /**
   * Whether the `compact` field's dialog is open. Read-only because every write goes through
   * [setPresented], and a `var` would generate a clashing setter.
   */
  val presented: Boolean
    get() = presentedSnapshot

  private var presentedSnapshot by mutableStateOf(false)

  var sizingKey = ""

  /**
   * Event-count handshake over the selected instant. Stores what React sent raw: it cannot be
   * clamped in the setter, because the bounds may arrive later in the same batch. Not observed.
   */
  val state = NitroUiControlledValue<Double>(0.0)

  /** Uncontrolled seed, in ms. Applied once, in `afterUpdate()`. */
  var defaultValueMillis: Double = 0.0

  var didApplyDefault = false

  /** `'date'`, `'time'` or `'datetime'`. Observed: it can change on a live mount. */
  var mode by mutableStateOf("date")

  /** `'compact'`, `'inline'` or `'wheel'`. Not observed: JS remounts the view when it changes. */
  var variant = "compact"

  /** Lowest selectable instant, or `null` for no lower bound. */
  var minimum: Double? by mutableStateOf(null)

  /** Highest selectable instant, or `null` for "no upper bound". */
  var maximum: Double? by mutableStateOf(null)

  var onChange: ((Double, Double) -> Unit)? = null

  // The test report can be read from the JS thread, so it is a string written under a lock.
  private val reportLock = Any()

  private var report = "0|0"

  /** What [publishReport] last formatted, so an unchanged batch builds no string. */
  private var publishedDisplayed = 0.0

  private var publishedPresented = false

  /**
   * What the composed calendar says about itself: the month it shows, and whether it kept
   * its selection (Material stores `null` for a year outside its range). [NO_CALENDAR] while
   * no calendar is on screen.
   */
  private var calendarMonthUtcMillis: Long = NO_CALENDAR

  private var calendarHasSelection: Long = NO_CALENDAR

  override fun reset() {
    presentedSnapshot = false
    displayed = 0.0
    timeWheelRequest = null
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
     * Dialogs open in this process right now. Process-wide, because a dropped mount cannot
     * report its own leak.
     */
    val livePresentations = AtomicInteger(0)
  }

  /**
   * How many Material 3 calendar states this mount has built. A bounds change rebuilds the
   * calendar, losing the page the user turned to. Not observed: it is incremented during
   * composition.
   */
  private val controlBuilds = AtomicInteger(0)

  /** The control last counted, by identity: Compose may run a composition more than once. */
  private var countedControl: Any? = null

  /** The bounds the calendar on screen was built with. */
  private var builtMinimum: Double? = null
  private var builtMaximum: Double? = null

  fun noteControlBuild(control: Any) {
    if (countedControl !== control) {
      countedControl = control
      controlBuilds.incrementAndGet()
      // Under the lock [readReport] takes, so a reader never sees one new bound with one old.
      synchronized(reportLock) {
        builtMinimum = minimum
        builtMaximum = maximum
      }
    }
  }

  // MARK: - Bounds

  /**
   * [millis] inside `[minimum, maximum]`. Called from `afterUpdate()`, never a prop setter:
   * value and bounds arrive in one batch in no particular order. With inverted bounds the
   * minimum wins. The JS wrapper clamps the same way.
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

  fun clampOrNull(millis: Double?): Double? = millis?.let { clamp(it) }

  // MARK: - Presentation

  /** The one writer of the dialog's open flag, so the test report always matches reality. */
  fun setPresented(next: Boolean) {
    if (next == presented) {
      return
    }
    presentedSnapshot = next
    publishReport()
  }

  // MARK: - Interaction

  /**
   * The user picked [millis]. Optimistic: [displayed] moves before React has seen the event.
   * A pick that does not move the displayed instant reports nothing; Material calls its click
   * handler for the selected day too.
   */
  fun applyUserSelection(millis: Double) {
    // The composable blocks input too, but the test hook does not go through the view.
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

  /** Idempotent: the effect that calls it re-runs whenever the month or selection changes. */
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

  fun clearCalendar() {
    synchronized(reportLock) {
      calendarMonthUtcMillis = NO_CALENDAR
      calendarHasSelection = NO_CALENDAR
    }
  }

  /**
   * `<displayed ms>|<presented>|<calendar month>|<calendar has selection>|<live
   * presentations>|<calendar builds>|<built minimum>|<built maximum>`. Safe from any thread.
   */
  fun readReport(): String =
    synchronized(reportLock) {
      // `-1` on both for no control built yet; `-2` for a bound the app never set.
      val built = controlBuilds.get() > 0
      "$report|$calendarMonthUtcMillis|$calendarHasSelection|${livePresentations.get()}|${controlBuilds.get()}|${
        if (built) builtMinimum?.toLong() ?: NO_BUILT_BOUND else NO_BUILT_CONTROL
      }|${if (built) builtMaximum?.toLong() ?: NO_BUILT_BOUND else NO_BUILT_CONTROL}"
    }

  // MARK: - Material 3's calendar arithmetic

  /**
   * UTC midnight of the local day [millis] falls on. Material 3's `DatePickerState` stores a
   * day as UTC midnight; handed a local instant it would read the day in UTC.
   */
  fun toUtcMidnightOfLocalDay(millis: Double): Long {
    val local = Calendar.getInstance().apply { timeInMillis = millis.toLong() }
    return utcCalendar().apply {
      clear()
      set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH))
    }.timeInMillis
  }

  /**
   * The day `utcMidnightMillis` names, at the wall-clock time [millis] already had.
   * [Calendar.set] keeps the wall-clock fields, so the time shown survives a DST boundary.
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

  /** UTC midnight of the first day of the local month [millis] falls in. */
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
   * Test-only: the instant of local wall-clock fields. Fields the mode does not show keep
   * the displayed value.
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
        // A day the month does not have becomes its last day. `getActualMaximum` reads the
        // current year and month, so both sets above must come first.
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
      // The same conversion the time dialog's OK button uses; it zeroes seconds and millis.
      calendar.timeInMillis = fromTimeOfDay(
        calendar.get(Calendar.HOUR_OF_DAY),
        calendar.get(Calendar.MINUTE),
        calendar.timeInMillis.toDouble(),
      ).toLong()
    }
    if (mode != "time") {
      // The same two conversions a real tap on a day cell goes through.
      calendar.timeInMillis = fromUtcMidnightKeepingTimeOfDay(
        toUtcMidnightOfLocalDay(calendar.timeInMillis.toDouble()),
        // The clock assembled above, not the one the control was showing.
        calendar.timeInMillis.toDouble(),
      ).toLong()
    }
    return calendar.timeInMillis.toDouble()
  }
}

/**
 * The `compact` field's text, and the widest text its mode can produce. The field is sized
 * for the widest text, laid out invisibly, because the sizing key does not include the
 * value. Candidates are ranked by measured width, not string comparison. Process-wide,
 * keyed by (mode, locale): hosted controls are separate compositions.
 */
private object DatePickerFieldText {
  private val cache = HashMap<String, Pair<DateFormat, String>>()

  fun format(
    mode: String,
    millis: Double,
  ): String = entry(mode).first.format(millis.toLong())

  /** The widest text this mode can produce, in the same format as [format]. */
  fun probe(mode: String): String = entry(mode).second

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
    // Bounded, so rendering under many locales cannot grow it for the life of the process.
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
   * Ranks the candidates in the field's own text style. Only the order is used; Compose
   * measures the winning string at the user's font scale.
   */
  private val WIDEST_MEASURE =
    TextPaint().apply {
      textSize = 40f
      letterSpacing = 0.05f
      // The face `labelLarge`'s Medium weight resolves to with the default font family.
      typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

  /**
   * Candidates for the widest formatting: every month, a one- and a two-digit day, and hours
   * on both sides of noon. Each is `year, month (1-based), day, hour, minute`.
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
 * Material 3 enforces a range in two places: `yearRange` limits navigation to whole years,
 * and this decides whether one day can be picked. It is handed UTC midnights, so the bounds
 * are UTC midnights of the local bound days. `DatePickerState` reads it once, at
 * construction, so new bounds mean a new state.
 */
private class BoundsSelectableDates(
  private val minUtcMidnight: Long?,
  private val maxUtcMidnight: Long?,
) : SelectableDates {
  override fun isSelectableDate(utcTimeMillis: Long): Boolean =
    (minUtcMidnight == null || utcTimeMillis >= minUtcMidnight) &&
      (maxUtcMidnight == null || utcTimeMillis <= maxUtcMidnight)

  /** A year is reachable unless it is entirely outside the bounds, read in the local zone. */
  override fun isSelectableYear(year: Int): Boolean {
    val minYear = minUtcMidnight?.let { localYear(it) }
    val maxYear = maxUtcMidnight?.let { localYear(it) }
    return (minYear == null || year >= minYear) && (maxYear == null || year <= maxYear)
  }

  private fun localYear(utcMidnightMillis: Long): Int =
    Calendar.getInstance().apply { timeInMillis = utcMidnightMillis }.get(Calendar.YEAR)
}

/**
 * The tint as a [ColorScheme] with a different `primary`: Material's pickers derive their
 * many colour roles from it and take no single accent colour. Cached per (scheme, tint),
 * process-wide, because hosted controls are separate compositions.
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

  /** Called with the lock held. */
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
 * The label, value and disabled state go on the control itself, never its container: a
 * described container is a second TalkBack stop and leaves the control unnamed. The value
 * is in `stateDescription`, because a `contentDescription` replaces the button's own text.
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

/**
 * Material's `DatePicker` and `TimePicker` take no `enabled`, so a disabled one has its
 * subtree's semantics replaced by one disabled node and its gestures blocked.
 */
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

/** Consumes every gesture in the `Initial` pass, which a parent sees before its children. */
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

/** The disabled look only; [nuiControlSemantics] announces it. */
private fun Modifier.nuiDisabledLook(enabled: Boolean): Modifier =
  if (enabled) this else alpha(DISABLED_ALPHA)

private const val DISABLED_ALPHA = 0.38f

/**
 * The narrowest box in which Material's calendar keeps its 48 dp interactive minimum:
 * seven columns plus 12 dp at each edge.
 */
private val CALENDAR_WIDE_MIN_DP = 360.dp

private class DatePickerHost(
  context: ThemedReactContext,
  activity: Activity?,
  model: DatePickerModel,
) : NitroComposeHost<DatePickerModel>(context, activity, model) {
  /** A `<Host>` may compose this control: whichever composition shows a dialog closes it. */
  override val isHostable: Boolean
    get() = true

  /**
   * A device setting, read once: Material's `TimePickerState` only accepts it at
   * construction, so a change reaches a mounted picker when it is next built.
   */
  private val twentyFourHour: Boolean = android.text.format.DateFormat.is24HourFormat(context)

  /**
   * The time wheels' states while they are composed, else `null`, and whether a finger is on
   * a wheel or one is still turning. Back-references written from the composition, so the
   * props pass can move the wheels.
   */
  var timeHourDrum: ScrollFieldState? = null
  var timeMinuteDrum: ScrollFieldState? = null
  var timePeriodDrum: ScrollFieldState? = null
  var timeActive: State<Boolean>? = null

  /**
   * The composition's scope, for the props pass. Writing `selectedOption` only requests a
   * scroll that the pager applies at its next measure, which may never come; the suspending
   * `scrollToOption` scrolls at once.
   */
  var timeDrumScope: CoroutineScope? = null

  /**
   * One wheel movement at a time. A programmatic move and a roll act on the same pagers, and
   * a roll must start from where the previous move ended. `ScrollFieldState` has no queue.
   */
  val timeDrumMutex = Mutex()

  /**
   * The hour and minute the wheels were last moved to programmatically. A rest on that pair
   * is not a pick, so every programmatic move must update it.
   */
  var timePushed: MutableState<Pair<Int, Int>>? = null

  /**
   * Moves the wheels to the instant the control shows. Called from `afterUpdate()` because a
   * refused pick writes the instant and back within one frame, which an effect keyed on the
   * value never sees. Skipped while a wheel is touched or turning: it would cancel the roll.
   */
  fun seatTimeDrumsFromModel() {
    val scope = timeDrumScope ?: return
    val hour = timeHourDrum ?: return
    val minute = timeMinuteDrum ?: return
    val period = timePeriodDrum
    val pushed = timePushed
    val active = timeActive
    if (active?.value == true) {
      return
    }
    scope.launch {
      timeDrumMutex.withLock {
        // Checked again inside the lock: a roll can have started while this waited.
        if (active?.value == true) {
          return@withLock
        }
        seatTimeDrums(
          twentyFourHour,
          hour,
          minute,
          period,
          timeOfDayOf(model, model.displayed),
          pushed,
        )
      }
    }
  }

  @Composable
  override fun Component(model: DatePickerModel) {
    val tint = model.tintColor
    val scheme = MaterialTheme.colorScheme
    val mode = model.mode
    val enabled = model.enabled
    val variant = model.variant

    // One root `Box`: the host measures only the first root measurable. A `Dialog` is a
    // separate window, not a measurable, and composing it here means disposing this
    // composition closes it.
    MaterialTheme(colorScheme = tintedScheme(scheme, tint)) {
      Box(
        // No semantics on the container: it would be a TalkBack stop in front of the control.
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
        model.setPresented(true)
      },
      // A disabled Material button stops calling `onClick`, so the dialog cannot open.
      enabled = model.enabled,
      modifier = Modifier.nuiFieldSemantics(
        label = model.accessibilityLabel,
        value = formatted,
        enabled = model.enabled,
      ),
    ) {
      // The mode's widest text, laid out invisibly, so the button is as wide as any value
      // it can show. Its semantics are cleared so TalkBack does not read it. A `Box`, not
      // the button's `Row`, so the two texts stack instead of adding their widths.
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
          // If the probe under-estimates, the value widens the box rather than being cut off.
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }

  /**
   * The `wheel` variant of `mode="time"`: one `ScrollField` per field. The wheels share the
   * box's width, and the height is stated because a pager fills whatever height it is given.
   */
  @Composable
  private fun TimeWheel(
    model: DatePickerModel,
    twentyFourHour: Boolean,
    hourState: ScrollFieldState,
    minuteState: ScrollFieldState,
    periodState: ScrollFieldState?,
    touching: MutableState<Boolean>,
  ) {
    val colors = nuiWheelColors(model.tintColor)
    val enabled = model.enabled
    // Material's own localised strings for the hour and minute columns.
    val hourDrumLabel = stringResource(androidx.compose.material3.R.string.m3c_time_picker_hour_selection)
    val minuteDrumLabel = stringResource(androidx.compose.material3.R.string.m3c_time_picker_minute_selection)
    val amLabel = stringResource(androidx.compose.material3.R.string.m3c_time_picker_am)
    val pmLabel = stringResource(androidx.compose.material3.R.string.m3c_time_picker_pm)
    // Digits in the composition's locale: Material's own formatter for wheel rows is
    // internal, so a `NumberFormat` does the same.
    val localeTag = LocalLocale.current.toLanguageTag()
    val (padded, plain) =
      remember(localeTag) {
        // The composition's locale, not `Locale.getDefault()`: a per-app or
        // configuration-scoped locale can differ from the process default.
        val locale = java.util.Locale.forLanguageTag(localeTag)
        Pair(
          NumberFormat.getInstance(locale).apply {
            minimumIntegerDigits = 2
            isGroupingUsed = false
          },
          NumberFormat.getInstance(locale).apply {
            isGroupingUsed = false
          },
        )
      }
    Row(
      modifier =
        Modifier
          .fillMaxWidth()
          .nuiControlSemantics(
            label = model.accessibilityLabel,
            value = DatePickerFieldText.format("time", model.displayed),
            enabled = enabled,
          )
          // Inside React Native's scroll container the page would otherwise intercept the drags.
          .nuiOwnVerticalDrags(enabled, touching),
      horizontalArrangement = Arrangement.spacedBy(TimeWheelGap, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TimeWheelDrum(
        // `fill = false`, so a wheel in a wide box stays at most the capped width.
        modifier = Modifier.weight(1f, fill = false).widthIn(max = TimeWheelDrumWidth).height(TimeWheelHeight),
        state = hourState,
        label = hourDrumLabel,
        colors = colors,
        enabled = enabled,
        // 00..23 in 24-hour form; 12, 1, ... 11, unpadded, in 12-hour form.
        text = { index ->
          if (twentyFourHour) {
            padded.format(index.toLong())
          } else if (index == 0) {
            plain.format(12L)
          } else {
            plain.format(index.toLong())
          }
        },
      )
      TimeWheelDrum(
        modifier = Modifier.weight(1f, fill = false).widthIn(max = TimeWheelDrumWidth).height(TimeWheelHeight),
        state = minuteState,
        label = minuteDrumLabel,
        colors = colors,
        enabled = enabled,
        text = { index -> padded.format(index.toLong()) },
      )
      if (periodState != null) {
        TimeWheelDrum(
          modifier = Modifier.weight(1f, fill = false).widthIn(max = TimeWheelDrumWidth).height(TimeWheelHeight),
          state = periodState,
          // Material has no description for this column, so it is named by its two values.
          label = "$amLabel/$pmLabel",
          colors = colors,
          enabled = enabled,
          text = { index -> if (index == 1) pmLabel else amLabel },
        )
      }
    }
  }

  /** One column of [TimeWheel]: the drum, its rows, and the words a reader is given. */
  @Composable
  private fun TimeWheelDrum(
    modifier: Modifier,
    state: ScrollFieldState,
    label: String,
    colors: ScrollFieldColors,
    enabled: Boolean,
    text: (Int) -> String,
  ) {
    ScrollField(
      state = state,
      contentDescription = label,
      modifier = modifier,
      enabled = enabled,
      colors = colors,
      // The spoken row and the painted row come from one function.
      fieldAccessibilityDescription = { index -> text(index) },
      interactionSource = null,
      field = { index, selected, rowEnabled ->
        NuiWheelRow(
          text = text(index),
          selected = selected,
          enabled = rowEnabled,
          colors = colors,
        )
      },
    )
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
      val hour = fields.get(Calendar.HOUR_OF_DAY)
      val minute = fields.get(Calendar.MINUTE)
      if (model.variant == "wheel") {
        // The wheel states belong to this composable, because the pick is read from their
        // own scroll flags. On a 12-hour device the hour column is 12, 1..11 (the hour
        // modulo 12) with an AM/PM column beside it.
        val hourState =
          rememberScrollFieldState(
            itemCount = if (twentyFourHour) 24 else 12,
            index = if (twentyFourHour) hour else hour % 12,
          )
        val minuteState = rememberScrollFieldState(itemCount = 60, index = minute)
        val periodState =
          if (twentyFourHour) {
            null
          } else {
            rememberScrollFieldState(itemCount = 2, index = if (hour >= 12) 1 else 0)
          }
        // True while a finger is on a wheel; a roll is not over until it is false.
        val touching = remember { mutableStateOf(false) }
        // A finger on a wheel, or any wheel still turning. A `derivedStateOf` read only from
        // a flow, so a wheel starting or stopping recomposes nothing.
        val active =
          remember(hourState, minuteState, periodState, touching) {
            derivedStateOf {
              hourState.isScrollInProgress ||
                minuteState.isScrollInProgress ||
                periodState?.isScrollInProgress == true ||
                touching.value
            }
          }
        // Set in `remember`, not in an effect: `afterUpdate` can run before any effect of
        // this mount has.
        remember(hourState, minuteState, periodState) {
          this@DatePickerHost.timeHourDrum = hourState
          this@DatePickerHost.timeMinuteDrum = minuteState
          this@DatePickerHost.timePeriodDrum = periodState
        }
        remember(active) {
          this@DatePickerHost.timeActive = active
        }
        // The pair last written into the wheels, so a rest on it is not taken for a pick.
        val pushed = remember(model) { mutableStateOf(timeOfDayOf(model, shown)) }
        remember(pushed) {
          this@DatePickerHost.timePushed = pushed
        }
        val drumScope = rememberCoroutineScope()
        remember(drumScope) {
          this@DatePickerHost.timeDrumScope = drumScope
        }
        syncTimeWheel(
          model,
          twentyFourHour,
          hourState,
          minuteState,
          periodState,
          active,
          drumScope,
          this@DatePickerHost.timeDrumMutex,
          pushed,
        )
        TimeWheel(
          model = model,
          twentyFourHour = twentyFourHour,
          hourState = hourState,
          minuteState = minuteState,
          periodState = periodState,
          touching = touching,
        )
      } else {
        val state =
          rememberTimePickerState(
            initialHour = hour,
            initialMinute = minute,
            is24Hour = twentyFourHour,
          )
        // The clock dial commits a value when the finger leaves it.
        syncTimePicker(model, state)
        TimePicker(
          state = state,
          modifier = Modifier.nuiControlSemantics(
            label = model.accessibilityLabel,
            value = DatePickerFieldText.format(mode, shown),
            enabled = model.enabled,
          ),
        )
      }
    } else {
      val yearRange = remember(model.minimum, model.maximum, shown) { model.dateYearRange() }
      val selectable = model.rememberSelectableDates()
      val shownDayUtcMidnight = model.toUtcMidnightOfLocalDay(shown)
      // New bounds reach the calendar by rebuilding its state: `rememberDatePickerState`
      // keeps the arguments it was first given. The key is day-granular, so a bound that
      // moves by milliseconds on every render (`minimumDate={new Date()}`) rebuilds nothing.
      val state = key(selectable, yearRange) {
        rememberDatePickerState(
          initialSelectedDateMillis = shownDayUtcMidnight,
          // Named: left `null`, Material opens the calendar on today's month, with the
          // selected day off-screen.
          initialDisplayedMonthMillis = model.toUtcMonthStartOfLocalDay(shown),
          yearRange = yearRange,
          selectableDates = selectable,
        ).also { model.noteControlBuild(it) }
      }
      syncDatePicker(model, state)
      // No mode toggle: it would switch the calendar to a text-entry form.
      // Material's calendar sizes each day cell to the minimum interactive size (48 dp), so
      // it needs 360 dp; in a narrower box the last columns are squeezed, so it is given
      // 40 dp there. `BoxWithConstraints` has no modifier, so the measured size stays the
      // calendar's own.
      BoxWithConstraints {
        val narrow =
          constraints.hasBoundedWidth &&
            with(LocalDensity.current) { constraints.maxWidth.toDp() < CALENDAR_WIDE_MIN_DP }
        // One call site: an `if`/`else` around the picker would put it in two composition
        // slots, and crossing the width threshold would rebuild the calendar.
        CompositionLocalProvider(
          LocalMinimumInteractiveComponentSize provides
            if (narrow) 40.dp else LocalMinimumInteractiveComponentSize.current,
        ) {
          InlineCalendar(model, state, mode)
        }
      }
    }
  }

  @Composable
  private fun InlineCalendar(
    model: DatePickerModel,
    state: DatePickerState,
    mode: String,
  ) {
    DatePicker(
      state = state,
      showModeToggle = false,
      modifier = Modifier.nuiControlSemantics(
        label = model.accessibilityLabel,
        value = DatePickerFieldText.format(mode, model.displayed),
        enabled = model.enabled,
      ),
    )
  }

  /** The dialog, or the pair of them, behind the `compact` field. */
  @Composable
  private fun Presentation(
    model: DatePickerModel,
    mode: String,
  ) {
    val wantsDate = mode != "time"
    val wantsTime = mode != "date"
    // `datetime` shows one dialog at a time: Material 3 has no combined control.
    var step by remember(wantsDate, wantsTime) { mutableStateOf(if (wantsDate) Step.Date else Step.Time) }

    // Counted for as long as the composition that opened the dialog lives.
    DisposableEffect(Unit) {
      DatePickerModel.livePresentations.incrementAndGet()
      onDispose {
        DatePickerModel.livePresentations.decrementAndGet()
        // Clear the open flag with the window. Disposal also happens without a dismissal:
        // a hosted child that is removed, hidden with `display: 'none'`, or moved by layout.
        // Without this the flag outlives the window and the dialog reopens unasked.
        model.setPresented(false)
      }
    }

    if (step == Step.Date) {
      val yearRange = remember(model.minimum, model.maximum, model.displayed) { model.dateYearRange() }
      val selectable = model.rememberSelectableDates()
      // Day-granular: a rebuild inside an open dialog discards the provisional selection.
      val state = key(selectable, yearRange) {
        rememberDatePickerState(
          initialSelectedDateMillis = model.toUtcMidnightOfLocalDay(model.displayed),
          // Named: left `null`, the dialog opens on today's month.
          initialDisplayedMonthMillis = model.toUtcMonthStartOfLocalDay(model.displayed),
          yearRange = yearRange,
          selectableDates = selectable,
        ).also { model.noteControlBuild(it) }
      }
      // The dialog's selection is provisional until OK, so it is not synced into the model.
      publishCalendarFacts(model, state)
      // A value React sends while the dialog is open moves its page and selected day.
      followValueInDialog(model, state)
      DatePickerDialog(
        // Called for an outside tap and for Back.
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
                // The date is committed first, so dismissing the time dialog keeps it.
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
 * Publishes the month a composed calendar shows and whether it has a selection. Read-only:
 * the dialog uses it too, and the dialog's selection must not be synced.
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
  // `DatePickerState` keeps its own selection after construction, so the model writes
  // its value into it. A tap is told from the model's own write by `pushed`: the day
  // the model last wrote, set in the same block as the write.
  val pushed = remember(state) { mutableStateOf(state.selectedDateMillis) }
  LaunchedEffect(shown) {
    val wanted = model.toUtcMidnightOfLocalDay(shown)
    if (state.selectedDateMillis != wanted) {
      pushed.value = wanted
      state.selectedDateMillis = wanted
    }
    // The page too: the initial month is read only at construction.
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
    // Record the day the state holds even when no write is needed, so the next tap back
    // onto the previous day is not taken for the model's own write.
    pushed.value = wanted
    if (state.selectedDateMillis != wanted) {
      state.selectedDateMillis = wanted
    }
  }
}

/** A maximum: the wheels share whatever width the box has. */
private val TimeWheelDrumWidth = 100.dp

/** The wheel's height - three rows of 40 dp, the middle one snapped. */
private val TimeWheelHeight = 120.dp

/** The gutter between drums, so the centre band of one does not read as the other's. */
private val TimeWheelGap = 16.dp

/** [serial] makes a repeated request for the same time a new request. */
internal class TimeWheelRequest(
  val hour: Int,
  val minute: Int,
  val serial: Int,
)

/**
 * Built from `ScrollField` rather than Material's `TimeScroll`, which keeps its wheel
 * states private: a wheel's value is read when it comes to rest, and only the wheel's own
 * scroll flag says when that is.
 */
@Composable
private fun syncTimeWheel(
  model: DatePickerModel,
  twentyFourHour: Boolean,
  hourState: ScrollFieldState,
  minuteState: ScrollFieldState,
  periodState: ScrollFieldState?,
  active: State<Boolean>,
  scope: CoroutineScope,
  drumMutex: Mutex,
  pushed: MutableState<Pair<Int, Int>>,
) {
  val shown = model.displayed
  // The value the app holds moves the wheels, instantly. Not while a roll is in
  // progress: moving a turning wheel cancels the roll, which then reports nothing.
  LaunchedEffect(shown, hourState, minuteState, periodState) {
    drumMutex.withLock {
      if (active.value) {
        return@withLock
      }
      seatTimeDrums(
        twentyFourHour,
        hourState,
        minuteState,
        periodState,
        timeOfDayOf(model, model.displayed),
        pushed,
      )
    }
  }
  // A request from the test hook. Consumed by serial, and the field is cleared only
  // after the roll: writing it here would re-key this effect and cancel its scrolls.
  val request = model.timeWheelRequest
  var readRequestSerial by remember { mutableStateOf(0) }
  LaunchedEffect(hourState, minuteState, periodState, request) {
    if (request != null && request.serial > readRequestSerial) {
      readRequestSerial = request.serial
      // Wait for any programmatic move in progress, and start from where it ends.
      drumMutex.withLock {
        // All three at once: started one after another, there would be a frame in which
        // none is scrolling, which reads as a rest.
        val hour =
          launch {
            hourState.animateScrollToOption(
              if (twentyFourHour) request.hour else request.hour % 12
            )
          }
        val minute = launch { minuteState.animateScrollToOption(request.minute) }
        val period =
          periodState?.let { drum ->
            launch { drum.animateScrollToOption(if (request.hour >= 12) 1 else 0) }
          }
        hour.join()
        minute.join()
        period?.join()
      }
      if (model.timeWheelRequest === request) {
        model.timeWheelRequest = null
      }
    }
  }
  // One report per rest. A pair the model refuses is not reported, and the wheels are
  // moved back to the value the model holds.
  nuiReportAtWheelRest(active) {
    val rolled = readTimeDrums(twentyFourHour, hourState, minuteState, periodState)
    if (rolled != pushed.value) {
      model.applyUserSelection(model.fromTimeOfDay(rolled.first, rolled.second, model.displayed))
    }
    val wanted = timeOfDayOf(model, model.displayed)
    // Before the lock: this answers the rest that has just happened.
    pushed.value = wanted
    scope.launch {
      drumMutex.withLock {
        seatTimeDrums(twentyFourHour, hourState, minuteState, periodState, wanted, pushed)
      }
    }
  }
}

/** The hour-of-day and minute an instant stands for, as the drums hold them. */
private fun timeOfDayOf(
  model: DatePickerModel,
  millis: Double,
): Pair<Int, Int> {
  val fields = model.localFields(millis)
  return Pair(fields.get(Calendar.HOUR_OF_DAY), fields.get(Calendar.MINUTE))
}

/**
 * In 12-hour form the hour column's index is the hour modulo 12 and the AM/PM column
 * carries the other half; 0 is midnight and 12 is noon.
 */
private fun readTimeDrums(
  twentyFourHour: Boolean,
  hourState: ScrollFieldState,
  minuteState: ScrollFieldState,
  periodState: ScrollFieldState?,
): Pair<Int, Int> {
  val hour =
    if (twentyFourHour) {
      hourState.selectedOption
    } else {
      val half = periodState?.selectedOption ?: 0
      (hourState.selectedOption % 12) + if (half == 1) 12 else 0
    }
  return Pair(hour, minuteState.selectedOption)
}

/**
 * Moves the wheels to an hour and minute, leaving alone any already there. Writing
 * `selectedOption` alone only requests a scroll the pager applies at its next measure, so
 * the instant `scrollToOption` follows it. Callers hold [DatePickerHost.timeDrumMutex].
 */
private suspend fun seatTimeDrums(
  twentyFourHour: Boolean,
  hourState: ScrollFieldState,
  minuteState: ScrollFieldState,
  periodState: ScrollFieldState?,
  timeOfDay: Pair<Int, Int>,
  pushed: MutableState<Pair<Int, Int>>?,
) {
  pushed?.value = timeOfDay
  val hour = timeOfDay.first
  val wantedHour = if (twentyFourHour) hour else hour % 12
  val wantedPeriod = if (hour >= 12) 1 else 0
  if (hourState.selectedOption != wantedHour) {
    hourState.selectedOption = wantedHour
    hourState.scrollToOption(wantedHour)
  }
  if (minuteState.selectedOption != timeOfDay.second) {
    minuteState.selectedOption = timeOfDay.second
    minuteState.scrollToOption(timeOfDay.second)
  }
  if (periodState != null && periodState.selectedOption != wantedPeriod) {
    periodState.selectedOption = wantedPeriod
    periodState.scrollToOption(wantedPeriod)
  }
}

/** Keeps Material 3's clock and the model's time equal, in both directions. */
@Composable
private fun syncTimePicker(
  model: DatePickerModel,
  state: TimePickerState,
) {
  val shown = model.displayed
  // The pair last written into the state, so the model's own write is not taken for a pick.
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
    // A pick the model refused must not stay on the dial.
    val fields = model.localFields(model.displayed)
    val wanted = Pair(fields.get(Calendar.HOUR_OF_DAY), fields.get(Calendar.MINUTE))
    // Recorded even when no write is needed, as for the calendar.
    pushed.value = wanted
    if (state.hour != wanted.first || state.minute != wanted.second) {
      state.hour = wanted.first
      state.minute = wanted.second
    }
  }
}

/**
 * Model to dialog only. A dialog's selection is provisional until OK, so it is never read
 * back as a pick, but a value React sends while it is open moves its day and page.
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
 * Material 3's calendar can only be navigated inside a year range. Its default (1900-2100)
 * applies where a bound is absent, widened to include the displayed year, because a
 * calendar cannot show a selection outside its range.
 */
internal fun DatePickerModel.dateYearRange(): IntRange {
  val start = minOf(minimum?.let { localFields(it).get(Calendar.YEAR) } ?: DEFAULT_YEAR_START, localFields(displayed).get(Calendar.YEAR))
  val end = maxOf(maximum?.let { localFields(it).get(Calendar.YEAR) } ?: DEFAULT_YEAR_END, localFields(displayed).get(Calendar.YEAR))
  return start..end
}

/** `remember`ed per bound day, so a recomposition with unchanged bounds allocates nothing. */
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

class HybridNitroUiDatePicker(
  reactContext: ThemedReactContext,
) : HybridNitroUiDatePickerSpec(), RecyclableView {
  private val model = DatePickerModel()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val host = DatePickerHost(reactContext, reactContext.currentActivity, model)

  override val view: View
    get() = host

  init {
    host.wantsContentSize = true
    // `compact`, the default, is intrinsic; the `variant` setter changes the policy.
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // A backstop: fallbacks are normally declared at package init.
    declareFallback()
  }

  companion object {
    /** Must match the name in the generated C++ and in the generated manager's `getName()`. */
    private const val SIZING_COMPONENT_NAME = "NitroUiDatePicker"

    /**
     * The size used before anything has been measured, in dp: a `compact` `date` field. The
     * height is Material's 48 dp minimum touch target. Fallbacks are keyed by component, so
     * the other configurations are corrected after their first measure.
     */
    private const val FALLBACK_WIDTH_DP = 131.0
    private const val FALLBACK_HEIGHT_DP = 48.0

    private val fallbackDeclared = AtomicBoolean(false)

    /**
     * One JNI call per process. Called at package init, because Fabric can measure before this
     * class is first instantiated, and from `init` as a backstop, on a different thread.
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
        // The clamped instant, not the number React sent.
        Variant_NullType_Double.Second(model.clamp(it))
      } ?: Variant_NullType_Double.First(NullType.NULL)
    set(next) {
      // `afterUpdate()` applies it: the bounds may arrive later in the same batch.
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
      // Changes the size; Compose's own measure pass reports it.
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
      // The sizing policy follows the variant: the field is intrinsic, the pickers fill the width.
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
      // Can move the displayed instant, which `afterUpdate()` applies. Not a size change.
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
      // `processColor` hands back the ARGB int as a double. `toLong()` keeps the bit pattern;
      // `Double.toInt()` saturates, so an opaque colour would become `Int.MAX_VALUE`.
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
    // The view tag is what testID matchers read.
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
      // The label is on the control's semantics node, so a change needs a commit.
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
      // A new key needs a fresh measure and a report, even if the size is unchanged.
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
    // Only a batch that moves the shown instant may move the time wheels.
    val shownBefore = model.displayed
    // The props of one batch arrive in any order, so they are interpreted here.
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
    // The handshake decides whether React's instant wins over what the user just picked.
    if (model.state.reconcile()) {
      model.displayed = model.clamp(model.state.displayed)
      host.markDirty()
    }
    // Bounds that arrived after the displayed instant can leave it outside them.
    val shown = model.clamp(model.state.displayed)
    if (shown != model.displayed) {
      model.state.displayed = shown
      model.displayed = shown
      host.markDirty()
    }
    // A disabled control keeps no dialog open. Done here because the `disabled` setter
    // only changes `enabled`, and no prop carries the open flag.
    if (!model.enabled && model.presented) {
      model.setPresented(false)
    }
    // The wheels are not painted from `displayed`, so they have to be told.
    if (model.displayed != shownBefore) {
      host.seatTimeDrumsFromModel()
    }
    // A batch can move the displayed instant with no rendered change; keep the report current.
    model.publishReport()
    host.commit()
  }

  override fun prepareForRecycle() {
    host.tag = null
    // The wheel states belonged to the composition that is ending.
    host.timeHourDrum = null
    host.timeMinuteDrum = null
    host.timePeriodDrum = null
    host.timeActive = null
    host.timeDrumScope = null
    host.timePushed = null
    // Reset the policy here: the `variant` setter returns early when the next mount asks
    // for the default variant, which the model reset below restores.
    host.sizingPolicy = NitroUiSizing.POLICY_INTRINSIC
    // Resets the model, which closes an open dialog, and releases the sizing instance.
    host.prepareForRecycle()
  }

  override fun onDropView() {
    model.onChange = null
    host.timeHourDrum = null
    host.timeMinuteDrum = null
    host.timePeriodDrum = null
    host.timeActive = null
    host.timeDrumScope = null
    host.timePushed = null
    // `drop()` disposes the composition, and a `Dialog` it composed closes with it.
    model.setPresented(false)
    host.drop()
  }

  // MARK: - Methods

  /** The size Compose measured, from the host's cache. Safe on the JS thread. */
  override fun measureContent(): NitroUiDatePickerSize {
    val size = host.contentSize ?: return NitroUiDatePickerSize(0.0, 0.0)
    return NitroUiDatePickerSize(size.width, size.height)
  }

  /** Test-only: one selection through the real interaction path. */
  override fun nuiTestSelect(
    year: Double,
    month: Double,
    day: Double,
    hour: Double,
    minute: Double,
  ) {
    // The model is UI-thread state: run inline when already there, post otherwise. Never
    // wait: JS must not block on the UI thread.
    runOnUi {
      val target = model.resolveTestSelection(year, month, day, hour, minute)
      // The time wheel has nothing to press: the hook asks for a roll, and the rest at
      // its end emits.
      if (model.mode == "time" && model.variant == "wheel" && model.enabled) {
        val pair = timeOfDayOf(model, target)
        timeWheelRequestSerial += 1
        model.timeWheelRequest = TimeWheelRequest(pair.first, pair.second, timeWheelRequestSerial)
      } else {
        model.applyUserSelection(target)
      }
    }
  }

  private var timeWheelRequestSerial = 0

  /** Open the `compact` field's dialog, through the same entry point the press uses. */
  override fun nuiTestPresent() {
    runOnUi { performTestPresent() }
  }

  /** Safe from any thread. */
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
    // Only an enabled `compact` field has a dialog to open.
    if (!model.enabled || model.variant != "compact") {
      return
    }
    model.setPresented(true)
  }
}
