package com.margelo.nitro.nitroui.core

import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.mutableStateOf
import java.util.concurrent.atomic.AtomicInteger

/**
 * Which Material 3 theme every nitro-ui composition is drawn with: Material 3
 * Expressive by default (D39), or the baseline Material 3 theme when the app opts out
 * with `setMaterialTheme('baseline')`.
 *
 * One value for the process, because the choice is the app's and not a control's:
 * every Hybrid View is its own composition, and a `<Host>` is one more, so a theme
 * that lived in any one of them would reach none of the others. [NitroUiTheme] - the
 * root of each of those compositions - reads it, and nothing else does.
 *
 * It is snapshot state rather than a plain field so that a change reaches the
 * controls already on screen: each root that read it is invalidated and recomposes
 * with the other motion scheme, in whatever composition it lives in - recomposes, not
 * rebuilds (see [NitroUiTheme]). Written from the JS
 * thread (`HybridNitroUiMaterialTheme`), which is allowed - a write to the global
 * snapshot from any thread is what Compose's `GlobalSnapshotManager` schedules the
 * apply notification for - so the call never waits for the UI thread.
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

  /**
   * Theme roots composed so far, by the motion scheme Material handed their content.
   *
   * The harness's reading of what a control is really drawn with: the count is taken
   * *inside* the theme, from `MaterialTheme.motionScheme`, so a root that chose one
   * theme and gave its content the other's motion counts as what it gave. Process
   * totals that only grow (a test compares two reports); a root counts once per
   * composition of [NitroUiTheme], so once when it mounts and once more each time the
   * setting moves under it. Plain atomics, never observed, so counting costs a
   * control nothing it would notice.
   */
  private val expressiveRoots = AtomicInteger(0)
  private val baselineRoots = AtomicInteger(0)
  private val otherRoots = AtomicInteger(0)

  /**
   * Content subtrees created under a theme root: one per root when it mounts, and none
   * when the setting moves, because a switch must change values rather than rebuild what
   * is on screen (see [NitroUiTheme]). A switch that disposed the content would count
   * once more per root, which is the reading the harness holds at zero.
   */
  private val contentCreated = AtomicInteger(0)

  /** Called from a `remember` inside [NitroUiTheme]'s content: once per creation. */
  internal fun noteContentCreated(): Int = contentCreated.incrementAndGet()

  /** Called by [NitroUiTheme] with the motion scheme its content sees. */
  internal fun noteComposed(motionScheme: MotionScheme) {
    when {
      motionScheme === MotionScheme.expressive() -> expressiveRoots.incrementAndGet()
      motionScheme === MotionScheme.standard() -> baselineRoots.incrementAndGet()
      else -> otherRoots.incrementAndGet()
    }
  }

  /** `setting=<…>;expressive=<n>;baseline=<n>;other=<n>;created=<n>`. Any thread. */
  fun report(): String =
    "setting=${if (expressive) "expressive" else "baseline"}" +
      ";expressive=${expressiveRoots.get()}" +
      ";baseline=${baselineRoots.get()}" +
      ";other=${otherRoots.get()}" +
      ";created=${contentCreated.get()}"
}
