package com.margelo.nitro.nitroui.core

import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.View
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableNativeMap
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.snapshots.Snapshot

/** A Host has no state; the model exists because [NitroComposeHost] is written around one. */
internal class NitroUiHostModel : NitroUiModel() {
  override fun reset() {
    // A Host has no props, and its children are read live from the view tree.
  }
}

/**
 * The Android `<Host>`: one Compose composition shared by the nitro-ui controls placed
 * directly inside it. A hosted child never composes itself; it is rendered here, in one
 * `Column`, so its React Native frame is not what positions it.
 */
internal class NitroUiHostView(
  context: Context,
  activity: Activity?,
) : NitroComposeHost<NitroUiHostModel>(context, activity, NitroUiHostModel()) {

  /** Bumped when the child set changes: Compose cannot observe the view tree. */
  private val hostedVersion: MutableIntState = mutableIntStateOf(0)

  // Declared after [hostedVersion]: init blocks and property initializers run in
  // declaration order, and the listener writes that state.
  init {
    // `ViewGroup` has no overridable child-added hook, so observe through the hierarchy
    // listener, which every add and remove path reports to. React Native only ever clears it.
    setOnHierarchyChangeListener(
      object : OnHierarchyChangeListener {
        override fun onChildViewAdded(parent: View, child: View) {
          if (!isHostableChild(child)) {
            reportUncomposableChild(child)
          }
          hostedChildrenChanged()
        }

        override fun onChildViewRemoved(parent: View, child: View) {
          hostedChildrenChanged()
        }
      },
    )
  }

  /**
   * Warns, in a debuggable build, that this child will not be drawn. React flattens components
   * out of the native tree, so only this side sees what a child really is. Also sent to JS as
   * a device event, because a JS developer watches Metro rather than logcat.
   */
  internal fun reportUncomposableChild(child: View) {
    if (!isDebuggableBuild) {
      return
    }
    val what =
      if (child is NitroComposeHost<*>) {
        if (child is NitroUiHostView) {
          "another <Host>"
        } else {
          "a ${child.javaClass.simpleName.removeSuffix("Host")} (a nitro-ui control this " +
            "Host is not built to compose)"
        }
      } else {
        "a ${child.javaClass.simpleName} (not a nitro-ui control)"
      }
    val message =
      "A <Host> cannot compose $what: it will not be drawn on Android. A Host holds " +
        "the controls it is built for directly, and a child component is only hosted " +
        "if what it renders is one of those (docs/components/host.md)."
    Log.w(HOST_LOG_TAG, message)
    (context as? ReactContext)?.let { reactContext ->
      // `emitDeviceEvent` enqueues onto the JS queue, so it cannot stall this mount.
      reactContext.emitDeviceEvent(
        HOST_UNHOSTABLE_CHILD_EVENT,
        WritableNativeMap().apply {
          putString("message", message)
          putString("childClass", child.javaClass.simpleName)
        },
      )
    }
  }

  private val isDebuggableBuild: Boolean =
    context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  /**
   * Runs on the UI thread outside any composition, where a write to global snapshot state is
   * only noticed once apply notifications are sent.
   */
  private fun hostedChildrenChanged() {
    hostedVersion.intValue = hostedVersion.intValue + 1
    Snapshot.sendApplyNotifications()
  }

  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  /**
   * Compose announces a hosted control's semantics changes through this view, and the platform
   * throws `IllegalStateException: Accessibility off` when no accessibility service is enabled.
   */
  override fun requestSendAccessibilityEvent(
    child: View,
    event: AccessibilityEvent,
  ): Boolean {
    if (systemAccessibility?.isEnabled != true) {
      return false
    }
    return super.requestSendAccessibilityEvent(child, event)
  }

  /** Top-leading, not centred: a Host is usually larger than the `Column` it draws. */
  override val centersContent: Boolean
    get() = false

  @Composable
  override fun Component(model: NitroUiHostModel) {
    Column { HostedChildren() }
  }

  /**
   * One group per hosted control, read from the view tree in mount order. Skips children this
   * Host cannot compose and children React Native hid (`display: none`), which must stop
   * drawing as well as leave the layout.
   */
  @Composable
  private fun HostedChildren() {
    // Reading the version is what subscribes this group to child add/remove.
    hostedVersion.intValue
    for (index in 0 until childCount) {
      val child = getChildAt(index)
      if (child is NitroComposeHost<*> && child.isHostable && !child.isHiddenByReact) {
        key(child) { child.HostedContent() }
      }
    }
  }

  /** Ignores hiding: a child that cannot be hosted is a mistake whether or not it is hidden. */
  private fun isHostableChild(child: View): Boolean =
    child is NitroComposeHost<*> && child.isHostable

  /** `display: none` is the one change a hosted child makes without going through its model. */
  internal fun hostedChildVisibilityChanged() {
    hostedChildrenChanged()
  }

  private companion object {
    private const val HOST_LOG_TAG = "NitroUiHost"

    /** Carries the uncomposable-child warning to JS, which logs it as a `console.error`. */
    internal const val HOST_UNHOSTABLE_CHILD_EVENT = "NitroUiHostUnhostableChild"
  }
}
