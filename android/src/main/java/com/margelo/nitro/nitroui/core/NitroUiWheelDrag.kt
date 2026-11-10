package com.margelo.nitro.nitroui.core

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollFieldColors
import androidx.compose.material3.ScrollFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.lerp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Keep a vertical drag that *starts on* this node with the node, for the whole gesture.
 *
 * A wheel is a pager, and a pager is the first thing in this library that wants the same
 * gesture as the page it sits in: React Native's scroll container decides a vertical drag
 * is its own the moment the drag passes its touch slop, and it decides that in
 * `onInterceptTouchEvent` — before the hosted Compose subtree has accumulated anything. The
 * drum then receives `ACTION_CANCEL` and snaps back where it started, so the roll moves the
 * page and reports nothing. Measured on `nitroui_b`: a fling aimed at the middle of a drum
 * moved the window by 489 px and the drum by none, and the app reported no change at all —
 * which is not a wheel, it is a picture of one.
 *
 * The answer is Android's own, the one [com.margelo.nitro.nitroui.HybridNitroUiContextMenu]
 * already uses for a long press: ask the ancestors to stand down for this gesture. It is
 * asked from the `Initial` pass of the pointer's *down*, which reaches this node before any
 * ancestor has a reason to intercept, and it is taken back on the up, so the page is scrollable
 * again from the next gesture. `AndroidComposeView` is a `View` rather than a `ViewGroup`, so
 * the request goes to its parent — that is where the flag lives, and from there `ViewGroup`
 * carries it to every ancestor above.
 *
 * What it costs is the other half of the same decision: a drag that begins on the drum rolls
 * the drum and does not scroll the page, so the page has to be dragged somewhere else. It is
 * the trade a drum-shaped control makes wherever it is drawn, and `docs/components/picker.md`
 * tells app developers so rather than leaving them to find the dead patch of screen. It is
 * also why the request is not made for a [enabled] control: a drum that cannot roll has no
 * claim on the gesture, and there the page keeps it.
 *
 * [touching], when the caller passes one, is this node's own answer to "is a finger on the
 * wheel" — set on the down and cleared on the up, the *cancel* included. It is here rather
 * than in each component because the down and the up are already being awaited here, and
 * [nuiReportAtWheelRest] needs the same fact: a roll is not over when the finger leaves, but
 * the two together are what bounds it.
 */
@Composable
internal fun Modifier.nuiOwnVerticalDrags(
  enabled: Boolean = true,
  touching: MutableState<Boolean>? = null,
): Modifier {
  if (!enabled) {
    // A drum that cannot roll is not having a gesture, so the flag is cleared rather than
    // left at whatever the last one left it at: the prop can be turned off while a finger
    // is down (React re-renders for its own reasons), and a wheel stuck believing a finger
    // is on it reports nothing ever again. `SideEffect`, not a write here, because this
    // runs during composition.
    if (touching != null) {
      SideEffect {
        if (touching.value) {
          touching.value = false
        }
      }
    }
    return this
  }
  val view = LocalView.current
  return pointerInput(view, touching) {
    awaitEachGesture {
      // The `Initial` pass, and `requireUnconsumed = false`: this only listens, so the
      // pager underneath still receives the whole stream. What it does between listening
      // is the one thing the pager cannot do for itself.
      awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
      touching?.value = true
      view.parent?.requestDisallowInterceptTouchEvent(true)
      try {
        var rolling = true
        while (rolling) {
          val event = awaitPointerEvent(PointerEventPass.Initial)
          rolling = event.changes.any { change -> change.pressed }
        }
      } finally {
        // Including the cancelled case — the wheel leaving composition or a prop
        // restarting this block — so the page is never left standing down for a gesture
        // nobody is having.
        touching?.value = false
        view.parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
  }
}

/**
 * One report per rest — the rule every wheel in this library turns a roll into with.
 *
 * A drum is a pager, and a pager names the row nearest its snap line *continuously*:
 * `ScrollFieldState.selectedOption` moves every time the wheel crosses one, so reading the
 * value as it turns prices a roll from 09:20 to 14:05 at fifty-odd events, each of them a
 * pick with its own event count. That is the failure mode this rule exists to prevent
 * (`docs/tasks/Q8-expressive-and-holdbacks.report.md` pass 3 A: "the value commits on
 * settle"): one settled value, one event — never one per row the wheel passed.
 *
 * So the value is read at a **rest**, and the rest is the wheel's own, not a clock's:
 * [active] holds a finger on the drum *or* any of its drums still scrolling, and it falls
 * when the scrollable's `isScrollInProgress` does, which is the frame the pager's own
 * snap/fling animation finished. [onRest] runs there — once, because the latch below only
 * arms on a wheel that was *having* a gesture.
 *
 * It cannot be a quiet period on the value stream, which is what this rule replaced (a
 * 180 ms window in G29's first draft), and the reason is the bug that window left behind on
 * a loaded box: a drum's rows are only *named* as they cross, so the gap between two
 * crossings — and the run from the last crossing to the end of the decel — is as long as
 * the frames the machine can make. One real fling reported two changes at 180 ms, which is
 * what "tuned until it stops failing" looks like before anyone tunes it. Frames stretch;
 * the end of an animation does not stretch, it just happens.
 *
 * What is *not* armed is the mount: a wheel composed at rest reports nothing, because
 * nothing was ever active. A seat the app asked for (`selectedOption = …` to put a refused
 * value back, or to follow a new `value`) does scroll and so *does* arrive here — and is
 * answered by reading the row it just landed on, which is the value the component already
 * has, which its handshake refuses. Same rest, same read, no event.
 */
@Composable
internal fun nuiReportAtWheelRest(
  active: State<Boolean>,
  onRest: () -> Unit,
) {
  val report by rememberUpdatedState(onRest)
  LaunchedEffect(active) {
    var gestured = false
    // `snapshotFlow` rather than observed state: reading the flag in the composition would
    // recompose the whole wheel twice per roll, and the wheel is the one variant here
    // already redrawing a pager. The flow also gives the *edge*, which is the whole rule.
    snapshotFlow { active.value }.collect { isActive ->
      if (isActive) {
        gestured = true
      } else if (gestured) {
        gestured = false
        report()
      }
    }
  }
}

/**
 * How far a drum row's text sits from each edge of the drum.
 *
 * Eight dp on each side of a drum: enough that
 * the centre row's larger type does not touch the glass, little enough that a three-letter
 * option ("Flint") and a fourteen-letter one ("A considerably longer mineral name") share
 * one row and one ellipsis instead of one box width each. Material's own `Item` uses the
 * same inset on the numbers it draws.
 */
private val WheelRowHorizontalPadding: Dp = 8.dp

/**
 * One drum row: the row's text, in the shape `ScrollFieldDefaults.Item` gives a number.
 *
 * The default `field` renders `index.toLocalString(minDigits = 2)` — a wheel of numbers,
 * which is what a time drum wants and not what a Picker's drum wants — but the
 * *presentation* around it is the whole look of the control: the type lerps from
 * `displayMedium` to `displayLargeEmphasized` as a row arrives at the centre, and the
 * colours animate through the same expressive spec. Both halves are copied from Material's
 * own `Item` so that this library's wheels animate alike with a Material one; what differs
 * is only the string, plus the ellipsis a number never needed.
 *
 * Shared because both wheels here paint rows that are not plain numbers — a Picker's option
 * text, and a 12-hour wheel's "12" — and a wheel that drifts from the other one's
 * typography is two controls pretending to be one.
 */
@Composable
internal fun NuiWheelRow(
  text: String,
  selected: Boolean,
  enabled: Boolean,
  colors: ScrollFieldColors,
) {
  val targetColor =
    when {
      enabled && selected -> colors.selectedContentColor
      enabled && !selected -> colors.contentColor
      !enabled && selected -> colors.disabledSelectedContentColor
      else -> colors.disabledContentColor
    }
  val motion = MaterialTheme.motionScheme
  val selectionFraction by
    animateFloatAsState(
      targetValue = if (selected) 1f else 0f,
      animationSpec = motion.fastSpatialSpec(),
    )
  val color by animateColorAsState(targetValue = targetColor, animationSpec = motion.fastSpatialSpec())
  Text(
    text = text,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    textAlign = TextAlign.Center,
    style =
      lerp(
        MaterialTheme.typography.displayMedium,
        MaterialTheme.typography.displayLargeEmphasized,
        selectionFraction.coerceIn(0f, 1f),
      ),
    color = color,
    modifier = Modifier.padding(horizontal = WheelRowHorizontalPadding),
  )
}

/**
 * The drums' `ScrollFieldColors`, so that a tinted wheel costs one colour set per
 * (colour scheme, tint) instead of one per recomposition — the rule in
 * `docs/architecture/core.md` ("Shared objects").
 *
 * The tint replaces **`selectedContentColor`** — the colour of the row the wheel is stopped
 * on, which is the only role a wheel paints for the value it holds. `contentColor` (the
 * rows either side) and `containerColor` keep the scheme's colours: a tint that painted the
 * whole drum would say "accent" about every option at once, and `ScrollFieldDefaults.colors()`
 * takes `Color.Unspecified` to mean "keep the scheme's", which is what makes this a
 * one-role trade rather than a rebuilt set. It is *more* than iOS's wheel takes — a SwiftUI
 * `.wheel` Picker ignores `.tint()` entirely — and it is the same trade both of this
 * library's wheels make, which is why the cache is here and not in one component.
 */
private object WheelColorsCache {
  /** Tinted sets to remember before starting over; see the caches in each component. */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  /** The untinted set — one slot, filled once per scheme. */
  private var untinted: ScrollFieldColors? = null

  /** Tinted sets, keyed by ARGB int. */
  private var tinted: HashMap<Int, ScrollFieldColors>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): ScrollFieldColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

  /** Record a colour set the caller just built. */
  @Synchronized
  fun put(
    scheme: ColorScheme,
    tint: Int?,
    colors: ScrollFieldColors,
  ) {
    adopt(scheme)
    if (tint == null) {
      untinted = colors
      return
    }
    val entries = tinted ?: HashMap<Int, ScrollFieldColors>().also { tinted = it }
    if (entries.size >= MAX_TINTED_ENTRIES) {
      entries.clear()
    }
    entries[tint] = colors
  }

  /** Drop what a different scheme invalidates. Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

/** The drums' colours for [tint], served by [WheelColorsCache]. */
@Composable
internal fun nuiWheelColors(tint: Int?): ScrollFieldColors {
  val scheme = MaterialTheme.colorScheme
  WheelColorsCache.get(scheme, tint)?.let { cached -> return cached }
  val color = tint?.let { ComposeColor(it) }
  val built =
    if (color == null) {
      ScrollFieldDefaults.colors()
    } else {
      ScrollFieldDefaults.colors(selectedContentColor = color)
    }
  WheelColorsCache.put(scheme, tint, built)
  return built
}
