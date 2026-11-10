package com.margelo.nitro.nitroui.core

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView

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
 */
@Composable
internal fun Modifier.nuiOwnVerticalDrags(enabled: Boolean = true): Modifier {
  if (!enabled) return this
  val view = LocalView.current
  return pointerInput(view) {
    awaitEachGesture {
      // The `Initial` pass, and `requireUnconsumed = false`: this only listens, so the
      // pager underneath still receives the whole stream. What it does between listening
      // is the one thing the pager cannot do for itself.
      awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
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
        view.parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
  }
}
