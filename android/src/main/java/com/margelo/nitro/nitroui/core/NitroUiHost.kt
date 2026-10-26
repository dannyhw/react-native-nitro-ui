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

/**
 * The state of a [NitroUiHostView]. A Host renders nothing of its own, so it has
 * nothing to store - the subclass exists because [NitroComposeHost] is written
 * around a model, and reusing that class is what makes a Host inherit the
 * detached-measure, owner-wiring and lifecycle rules every other nitro-ui view
 * follows (`docs/architecture/core.md` §2).
 */
internal class NitroUiHostModel : NitroUiModel() {
  override fun reset() {
    // Nothing to reset: a Host has no props, and its children list is not state
    // but a live read of its own child views.
  }
}

/**
 * The Android `<Host>`: one Compose composition shared by every nitro-ui control
 * placed directly inside it (H1 - `docs/components/host.md`).
 *
 * **Mechanism (Expo's shape, read from `@expo/ui`'s `HostView` +
 * `ExpoComposeView.Children`).** RN still mounts one Fabric node and one `View`
 * per child, and the child still owns its Hybrid Object, its model and its prop
 * plumbing. What changes is *who composes it*: a child that finds this view as its
 * parent stops measuring its own `AbstractComposeView` (so it never creates a
 * `Composition`, an owner `AndroidComposeView`, a `LayoutNode` tree or a native
 * view tree for what it draws) and is rendered here instead, once per child,
 * inside one `Column`. Expo does exactly this - its non-hosting children set
 * `visibility = GONE`, are never measured, and are invoked composable-by-composable
 * inside the host's own `setContent`.
 *
 * **Layout.** The Host's box is the only thing Yoga measures. Children stack in a
 * Compose `Column` - the same arrangement the `expo-ui-shared-host` bench arm
 * builds - so their RN frames are decorative: nothing reads them, and a control
 * placed next to an RN view inside a Host is positioned by Compose, not by Yoga.
 *
 * **Which of the Host's own styles reach the drawing.** `width` / `height` / `flex`
 * size the box, and `padding` insets it: [NitroUiHostViewManager] forwards
 * `setPadding`, so the `Column` starts inside the padding as in any other
 * container. `gap`, `flexDirection`, `alignItems`, `justifyContent`, `borderWidth`
 * and `pointerEvents` do not - Compose does the arranging (one `Column`, no gaps),
 * the Host draws no border, and hits go to Compose rather than RN's hit testing.
 * Yoga still honours each of them in the *box*, which is the trap: a `gap` buys
 * height and no space, and `flexDirection: row` buys a one-row-tall box around a
 * stack of rows. Say how tall the Host is, and stack it in a column (review S3).
 *
 * **The allowlist is native, not only JS.** [NitroComposeHost.isHostable] decides who
 * may be composed here, and only `SwitchHost` says yes. JS refuses what it can name
 * (`src/components/Host/HostChildren.ts`), but React flattens components out of the
 * native tree: a `Picker` behind a `memo` arrives as a direct child that JS saw as a
 * `<Row>`, and a nested `<Host>` is a child like any other. Both are refused here and
 * said out loud in a debuggable build (review M2).
 *
 * **Recomposition stays per child.** Each child renders under `key(child)`, so the
 * group that reads that child's model is its own scope: one Switch's prop write
 * recomposes that Switch, not the Host's whole content.
 */
internal class NitroUiHostView(
  context: Context,
  activity: Activity?,
) : NitroComposeHost<NitroUiHostModel>(context, activity, NitroUiHostModel()) {

  /**
   * Bumped whenever the set of hosted children changes, read by [HostedChildren].
   *
   * The child list itself is not snapshot state - it *is* the view tree, which is
   * the one thing Compose cannot observe - so this counter is what makes an add or
   * a remove observable.
   */
  private val hostedVersion: MutableIntState = mutableIntStateOf(0)

  // Declared after [hostedVersion]: init blocks and property initializers run in
  // declaration order, and the listener writes that state.
  init {
    // Observe the child set. `ViewGroup` has no overridable `onChildViewAdded` - it
    // is not in the public SDK - so the seam is the hierarchy listener, which every
    // mutation path funnels through: `addView` in all its overloads and
    // `addViewInLayout` report from `addViewInner`, and the `removeView*` variants
    // report from `removeViewsInternal`. Overriding the `addView` overloads by hand
    // instead would mean guessing which set Fabric calls, and a wrong guess mounts a
    // blank control rather than failing loudly.
    //
    // RN touches this slot exactly once and only to clear it
    // (`BaseViewManager.onDropViewInstance`, verified in RN's source), so nothing of
    // RN's is displaced; there is no getter, so a listener from elsewhere could not
    // be chained even if one could exist. A Host's children are nitro-ui controls
    // mounted by Fabric, which is the case this is written for.
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
   * Say out loud, in a debuggable build, that this child will not be drawn.
   *
   * [HostedChildren] composes the children a Host is allowed to compose (see
   * [NitroComposeHost.isHostable]) and skips the rest, so a skipped child is
   * invisible on Android. The JS check (`src/components/Host/HostChildren.ts`)
   * catches the shapes it can name, but React flattens components out of the native
   * tree: what an app's own child component returns is a direct child of this view
   * whatever JS thought of it, and this is the only place that can see the answer -
   * including a `Picker` behind a `memo`, which JS saw as a component and this side
   * sees as a control that is not on the allowlist (review M2). Expo's `HostView`
   * reports the same case for the same reason.
   *
   * A report rather than a throw: by here the tree is already being mounted on the UI
   * thread, and a library that crashes an app from inside `addView` to report a
   * mistake it could equally have printed has chosen the worse of two dev-time
   * outcomes. It is also not only logcat (review S5): a JS developer watches Metro
   * and LogBox, so the same sentence goes to JS as a device event, which
   * `src/components/Host/HostChildren.ts` turns into a `console.error`.
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
      // Dev-only, async, and one string: `emitDeviceEvent` enqueues onto the JS
      // queue rather than waiting for it, so this cannot stall the mount that
      // reported it.
      reactContext.emitDeviceEvent(
        HOST_UNHOSTABLE_CHILD_EVENT,
        WritableNativeMap().apply {
          putString("message", message)
          putString("childClass", child.javaClass.simpleName)
        },
      )
    }
  }

  /** Whether the app this view lives in is debuggable, i.e. worth warning into. */
  private val isDebuggableBuild: Boolean =
    context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  /**
   * The child set moved. Recompose the hosted block.
   *
   * Reached from the hierarchy listener, i.e. on the UI thread outside any
   * composition - the same position [commit] is called from, so the apply
   * notification is sent the same way: a write to global snapshot state is only
   * noticed once it is applied, and nothing else in this turn applies it. Expo
   * reaches the same effect with `recomposeScope.invalidate()`; a version keeps
   * the invalidation inside the snapshot system this library already drives.
   */
  private fun hostedChildrenChanged() {
    hostedVersion.intValue = hostedVersion.intValue + 1
    Snapshot.sendApplyNotifications()
  }

  /**
   * The platform's own answer to "can a reader receive events right now?".
   *
   * Declared here because the guard below needs it, and this view is the one that
   * announces for every hosted control.
   */
  private val systemAccessibility =
    context.getSystemService(AccessibilityManager::class.java)

  /**
   * Hand an accessibility event to the platform only when it can accept one.
   *
   * This is the Slider's guard (`HybridNitroUiSlider.kt`), and a Host needs it for the
   * same reason *on behalf of* everything it composes: an announcement leaves the
   * Host's own `AndroidComposeView`, so the platform asks **this** view, not the
   * control. A hosted Slider or Progress publishes `ProgressBarRangeInfo`, and Compose
   * announces a semantics change up the parent chain - which with no reader connected
   * answers `IllegalStateException: Accessibility off. Did you forget to check that?`
   * and takes the app down (measured with a hosted Slider's screen-reader step in the
   * harness). Refusing is the outcome the platform was reaching anyway, and it is
   * inert while a reader is connected, because then the check passes and [super] runs.
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

  /**
   * Children start at the Host's top-leading edge rather than centred in its box.
   *
   * [NitroComposeHost.centersContent] centres a control inside the box the sizing
   * engine gave *it*, which is right for one control and wrong for a container: a Host
   * is usually wider than the `Column` it draws, and measured on a device a Host 60
   * tall holding three switches (144 of content) placed that column at -42, so the
   * *second* row was the one under a finger at the top of the box. Top-leading is what
   * RN means by a container, what Expo's Host does, and what makes an over-tall list
   * clip at the bottom - the far half of its content - rather than at the top.
   */
  override val centersContent: Boolean
    get() = false

  @Composable
  override fun Component(model: NitroUiHostModel) {
    Column { HostedChildren() }
  }

  /**
   * One composable group per hosted control, in the order RN mounted them.
   *
   * Children are read from the view tree rather than a list we maintain: the view
   * tree is what RN actually mutates, and a second copy of it could only drift. Two
   * kinds of child are skipped. One is a child this Host is not built to compose - an
   * RN view, a control that is not on the allowlist, or another `<Host>` - which
   * [reportUncomposableChild] says out loud in a debuggable build. The other is a
   * child RN itself hid (`display: none`), which has to leave the drawing as well as
   * the layout: otherwise a hidden row keeps drawing while a content-sized Host
   * shrinks by a row and clips what it still shows (review S2).
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

  /**
   * Whether this child is a control this Host composes, ignoring RN's hiding.
   *
   * The question the hierarchy listener asks: a child that is not on the allowlist
   * is a mistake whether or not it is hidden, and hiding is not a reason to stay
   * quiet about one.
   */
  private fun isHostableChild(child: View): Boolean =
    child is NitroComposeHost<*> && child.isHostable

  /**
   * A hosted child's `display` changed: recompose the hosted block.
   *
   * Called by [NitroComposeHost.setVisibility] for a child of this view. RN's answer
   * to `display: none` is the one prop a hosted child can change without going
   * through its own model, so it is the one thing that has to reach the Host directly
   * rather than through the control's recomposition.
   */
  internal fun hostedChildVisibilityChanged() {
    hostedChildrenChanged()
  }

  private companion object {
    private const val HOST_LOG_TAG = "NitroUiHost"

    /**
     * The device event a debuggable build emits for a child it will not compose, so
     * the report reaches Metro and LogBox and not only logcat (review S5). JS turns
     * it into a `console.error` in `src/components/Host/HostChildren.ts`.
     */
    internal const val HOST_UNHOSTABLE_CHILD_EVENT = "NitroUiHostUnhostableChild"
  }
}
