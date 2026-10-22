package com.margelo.nitro.nitroui.core

import android.app.Activity
import android.content.Context
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.AbstractComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.ViewCompositionStrategy.DisposeOnLifecycleDestroyed
import androidx.compose.ui.unit.Constraints
import android.view.ViewTreeObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner

/** An immutable size in dp, safe to publish across threads with a `@Volatile`. */
data class NitroUiDpSize(val width: Double, val height: Double)

/**
 * The one place in this library that hosts Compose. Every component's Hybrid View
 * owns exactly one of these, created with it and never replaced
 * (`docs/research/core-architecture.md` §3).
 *
 * [AbstractComposeView] rather than a `FrameLayout` around a `ComposeView`: no
 * wrapper view, direct access to the view lifecycle, and [Content] is fixed for
 * the lifetime of the instance - there is no `setContent` per props update, which
 * is the perf contract's main rule.
 *
 * Lifetime:
 * - prop setters write snapshot state on the model and call [markDirty];
 * - [commit] runs once per `updateState` and sends one apply notification;
 * - [prepareForRecycle] resets the model but keeps the composition;
 * - [drop] disposes the composition, and is also called before a recycle by
 *   Nitro's generated manager, so it must stay cheap.
 */
abstract class NitroComposeHost<M : NitroUiModel>(
  context: Context,
  /** `reactContext.currentActivity`, for the owners RN may not have set. */
  private val activity: Activity?,
  /** The component's state. Never replaced. */
  protected val model: M,
) : AbstractComposeView(context) {

  /** `nuiPerfId` of the owning view, or [NitroUiPerf.NO_INSTANCE]. */
  var perfInstanceId: Int = NitroUiPerf.NO_INSTANCE

  /**
   * Set by components that want [contentSize] maintained (T11's sizing, plus
   * `measureContent()`). Costs nothing beyond the measurement Compose already does.
   */
  var wantsContentSize: Boolean = false

  /**
   * Last measured content size in dp, or `null` if never measured. The generated
   * measure pass fills it in; `measureContent()` reads it from any thread. An
   * immutable value behind a `@Volatile` is what makes that legal (§1.4).
   */
  @Volatile var contentSize: NitroUiDpSize? = null
    private set

  private var isDirty = true
  private var hasCommitted = false
  private var hasMarkedFirstFrame = false

  /**
   * What to dispose the composition with. An `Activity` in an RN app is a
   * `ComponentActivity`, so it is a `LifecycleOwner`; if it somehow is not, the
   * default strategy stays and only the composition's lifetime is affected.
   */
  private val owner: LifecycleOwner? = activity as? LifecycleOwner

  init {
    // The default strategy disposes on detach, which is wrong in RN: screen
    // transitions, `removeClippedSubviews` and the recycling pool all detach
    // views, and each detach would throw the composition away.
    owner?.let { setViewCompositionStrategy(DisposeOnLifecycleDestroyed(it)) }
  }

  /** The component's composable. Called from [Content], never replaced. */
  @Composable
  protected abstract fun Component(model: M)

  @Composable
  final override fun Content() {
    NitroUiTheme {
      NitroUiMeasuredRoot(
        record = wantsContentSize,
        onMeasured = ::recordMeasuredSize,
      ) {
        Component(model)
      }
    }
  }

  // MARK: - Updating

  /** Called by prop setters: record that something rendered changed. */
  fun markDirty() {
    isDirty = true
  }

  /**
   * Apply the batch. Called once, from the generated `updateState`.
   *
   * Snapshot writes are already visible; sending the apply notification here is
   * what makes them land in this UI-thread turn instead of the next global apply.
   */
  fun commit() {
    if (!isDirty) {
      return
    }
    isDirty = false
    Snapshot.sendApplyNotifications()
    NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_PROPS_APPLIED)
  }

  /** Reset for reuse. Keeps the composition and its owners. */
  fun prepareForRecycle() {
    model.reset()
    isDirty = true
    contentSize = null
    // A recycled mount still paints its first frame for itself.
    hasMarkedFirstFrame = false
  }

  /**
   * Release the composition on a real unmount. Unlike iOS, Android's manager only
   * calls this from `onDropViewInstance`, never before a recycle, so disposing is
   * safe here - and needed, or the composition leaks until the activity dies.
   */
  fun drop() {
    disposeComposition()
    contentSize = null
  }

  // MARK: - View lifecycle

  override fun onAttachedToWindow() {
    // Compose reads the owners during `super.onAttachedToWindow()`, so fill any
    // gap first. Usually `ReactActivity`/react-native-screens already set them;
    // the gap is RN `Modal`'s dialog window. Unlike Expo we do not override a
    // lifecycle that is already correct (it may be a fragment's).
    if (findViewTreeLifecycleOwner() == null) {
      owner?.let { setViewTreeLifecycleOwner(it) }
    }
    super.onAttachedToWindow()
    watchForFirstFrame()
  }

  /**
   * Mark the first frame this mount draws. `onLayout` is final on
   * [AbstractComposeView], and the pre-draw callback is the closest thing to a
   * frame boundary anyway; the listener removes itself after firing once.
   */
  private fun watchForFirstFrame() {
    if (hasMarkedFirstFrame) {
      return
    }
    val observer = viewTreeObserver
    if (!observer.isAlive) {
      return
    }
    observer.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          val current = viewTreeObserver
          if (current.isAlive) {
            current.removeOnPreDrawListener(this)
          }
          if (!hasMarkedFirstFrame) {
            hasMarkedFirstFrame = true
            NitroUiPerf.mark(perfInstanceId, NitroUiPerf.KIND_FIRST_FRAME)
          }
          return true
        }
      }
    )
  }

  // MARK: - Measuring

  private fun recordMeasuredSize(widthPx: Int, heightPx: Int) {
    if (!wantsContentSize) {
      return
    }
    val density = resources.displayMetrics.density
    if (density <= 0f) {
      return
    }
    contentSize = NitroUiDpSize(widthPx.toDouble() / density, heightPx.toDouble() / density)
  }
}

/**
 * The library's Material theme: dynamic colour on Android 12+, the default M3
 * schemes below, both following the system dark mode.
 *
 * A Hybrid View is its own composition, so it cannot inherit the app's theme;
 * this is the closest equivalent to what the surrounding app sees.
 */
@Composable
fun NitroUiTheme(content: @Composable () -> Unit) {
  val dark = isSystemInDarkTheme()
  val context = LocalContext.current
  val colorScheme =
    when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)

      dark -> darkColorScheme()
      else -> lightColorScheme()
    }
  MaterialTheme(colorScheme = colorScheme, content = content)
}

/**
 * Records the intrinsic size during Compose's own measure pass and centres the
 * control in the box RN gave it.
 *
 * RN measures the view EXACTLY to the Yoga size and Compose measures inside that,
 * so the intrinsic size is known before the first draw with no extra measure call
 * (§3). Material's `minimumInteractiveComponentSize` (a 48 dp touch target) is
 * part of that size by design.
 */
@Composable
internal fun NitroUiMeasuredRoot(
  record: Boolean,
  onMeasured: (Int, Int) -> Unit,
  content: @Composable () -> Unit,
) {
  Layout(content) { measurables, constraints ->
    val child =
      measurables.firstOrNull()?.measure(
        Constraints(
          maxWidth = constraints.maxWidth,
          maxHeight = constraints.maxHeight,
        )
      )
    val measuredWidth = child?.width ?: 0
    val measuredHeight = child?.height ?: 0
    if (record) {
      onMeasured(measuredWidth, measuredHeight)
    }
    val width = if (constraints.hasBoundedWidth) constraints.maxWidth else measuredWidth
    val height = if (constraints.hasBoundedHeight) constraints.maxHeight else measuredHeight
    layout(width, height) {
      child?.placeRelative((width - measuredWidth) / 2, (height - measuredHeight) / 2)
    }
  }
}
