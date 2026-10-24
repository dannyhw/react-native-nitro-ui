package com.margelo.nitro.nitroui.core

import android.app.Activity
import android.content.Context
import android.view.View
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
 * placed directly inside it (T16 spike - `docs/tasks/T16-host-spike.md`).
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
          hostedChildrenChanged()
        }

        override fun onChildViewRemoved(parent: View, child: View) {
          hostedChildrenChanged()
        }
      },
    )
  }

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

  @Composable
  override fun Component(model: NitroUiHostModel) {
    Column { HostedChildren() }
  }

  /**
   * One composable group per hosted control, in the order RN mounted them.
   *
   * Children are read from the view tree rather than a list we maintain: the view
   * tree is what RN actually mutates, and a second copy of it could only drift.
   * Non-nitro-ui children (an RN `View` in the middle of a Host) are skipped - they
   * are not Compose content, and they are the reason a Host may not hold arbitrary
   * RN views (see the report).
   */
  @Composable
  private fun HostedChildren() {
    // Reading the version is what subscribes this group to child add/remove.
    hostedVersion.intValue
    for (index in 0 until childCount) {
      val child = getChildAt(index)
      if (child is NitroComposeHost<*>) {
        key(child) { child.HostedContent() }
      }
    }
  }
}
