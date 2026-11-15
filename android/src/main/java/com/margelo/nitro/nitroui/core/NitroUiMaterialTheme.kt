package com.margelo.nitro.nitroui.core

import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.mutableStateOf
import java.util.concurrent.atomic.AtomicInteger

/**
 * The process-wide choice between Material 3 Expressive (the default) and baseline Material 3.
 * Snapshot state, so a change recomposes every theme root already on screen; it may be
 * written from any thread.
 */
object NitroUiMaterialTheme {
  private val expressiveState = mutableStateOf(true)

  /** `true` for Material 3 Expressive (the default), `false` for the baseline theme. */
  var expressive: Boolean
    get() = expressiveState.value
    set(value) {
      if (expressiveState.value != value) {
        expressiveState.value = value
      }
    }

  /** Process totals of theme roots composed, by the motion scheme their content saw. */
  private val expressiveRoots = AtomicInteger(0)
  private val baselineRoots = AtomicInteger(0)
  private val otherRoots = AtomicInteger(0)

  /** Content subtrees created under a theme root; switching the theme must not add to it. */
  private val contentCreated = AtomicInteger(0)

  internal fun noteContentCreated(): Int = contentCreated.incrementAndGet()

  internal fun noteComposed(motionScheme: MotionScheme) {
    when {
      motionScheme === MotionScheme.expressive() -> expressiveRoots.incrementAndGet()
      motionScheme === MotionScheme.standard() -> baselineRoots.incrementAndGet()
      else -> otherRoots.incrementAndGet()
    }
  }

  fun report(): String =
    "setting=${if (expressive) "expressive" else "baseline"}" +
      ";expressive=${expressiveRoots.get()}" +
      ";baseline=${baselineRoots.get()}" +
      ";other=${otherRoots.get()}" +
      ";created=${contentCreated.get()}"
}
