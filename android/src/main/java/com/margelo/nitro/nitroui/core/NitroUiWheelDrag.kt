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
import kotlin.math.abs
import kotlin.math.max

/**
 * Keeps a vertical drag that starts on this node. React Native's scroll container intercepts
 * a vertical drag at touch slop, before Compose sees it, so the ancestors are asked on the
 * down not to intercept; a drag that leaves sideways first hands the gesture back to them.
 * [touching] is true while a finger is down, the cancelled case included.
 */
@Composable
internal fun Modifier.nuiOwnVerticalDrags(
  enabled: Boolean = true,
  touching: MutableState<Boolean>? = null,
): Modifier {
  if (!enabled) {
    // The prop can turn off while a finger is down; clear the flag so the wheel is not left
    // believing it is touched. `SideEffect` because this runs during composition.
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
      // The `Initial` pass with `requireUnconsumed = false` only listens: the pager underneath
      // still receives the whole stream.
      val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
      val slop = viewConfiguration.touchSlop
      touching?.value = true
      view.parent?.requestDisallowInterceptTouchEvent(true)
      var handedSideways = false
      try {
        var rolling = true
        while (rolling) {
          val event = awaitPointerEvent(PointerEventPass.Initial)
          if (!handedSideways) {
            val change =
              event.changes.firstOrNull { pointerChange ->
                pointerChange.pressed
              }
            if (change != null) {
              val sideways = abs(change.position.x - down.position.x)
              val along = abs(change.position.y - down.position.y)
              if (max(sideways, along) >= slop && sideways > along) {
                handedSideways = true
                view.parent?.requestDisallowInterceptTouchEvent(false)
              }
            }
          }
          rolling = event.changes.any { change -> change.pressed }
        }
      } finally {
        // Also on cancellation, so the ancestors are never left unable to intercept.
        touching?.value = false
        view.parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
  }
}

/**
 * Calls [onRest] once each time [active] falls after having been true. A wheel names a new
 * row every time it crosses one, so the value is read only when the gesture and its snap
 * animation have ended. A wheel composed at rest reports nothing.
 */
@Composable
internal fun nuiReportAtWheelRest(
  active: State<Boolean>,
  onRest: () -> Unit,
) {
  val report by rememberUpdatedState(onRest)
  LaunchedEffect(active) {
    var gestured = false
    // `snapshotFlow` rather than a read in composition, which would recompose the whole wheel
    // on every change of the flag.
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

/** The same inset Material's own scroll-field item uses. */
private val WheelRowHorizontalPadding: Dp = 8.dp

/**
 * One wheel row. The type and colour animation are copied from `ScrollFieldDefaults.Item`,
 * which can only render numbers; this draws any string, with an ellipsis.
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
 * One `ScrollFieldColors` per (colour scheme, tint) rather than one per recomposition. The
 * tint replaces only `selectedContentColor`, the row the wheel is stopped on.
 */
private object WheelColorsCache {
  /** The tinted sets are cleared when they reach this many. */
  private const val MAX_TINTED_ENTRIES = 24

  private var scheme: ColorScheme? = null

  private var untinted: ScrollFieldColors? = null

  private var tinted: HashMap<Int, ScrollFieldColors>? = null

  @Synchronized
  fun get(
    scheme: ColorScheme,
    tint: Int?,
  ): ScrollFieldColors? {
    adopt(scheme)
    return if (tint == null) untinted else tinted?.get(tint)
  }

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

  /** Called with the lock held. */
  private fun adopt(scheme: ColorScheme) {
    if (this.scheme === scheme) {
      return
    }
    this.scheme = scheme
    untinted = null
    tinted?.clear()
  }
}

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
