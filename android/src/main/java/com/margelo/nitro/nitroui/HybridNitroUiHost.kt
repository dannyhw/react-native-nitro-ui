package com.margelo.nitro.nitroui

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext

/*
 * The Host component's Android half (T17 spike). Like every other Hybrid View here
 * it lives in package `com.margelo.nitro.nitroui`, because that is the package the
 * generated `HybridNitroUiHostStateUpdater` imports with a wildcard.
 */

/**
 * A documented no-op.
 *
 * `<Host>` is iOS-native in this spike (T17): `Host.tsx` renders a plain `View` on
 * Android, so nothing here is ever instantiated. It is not registered in
 * [NitroUiPackage] either - the generated [com.margelo.nitro.nitroui.views.HybridNitroUiHostManager]
 * would happily create it, and a Host that composes nothing would render an empty
 * box, which is worse than not offering one.
 *
 * It exists because nitrogen requires a native implementation on both platforms for
 * a Hybrid View and compiles the manager it generates, so the Android half of the
 * spec has to be satisfiable - the mirror image of the no-op
 * `docs/tasks/T16-host-spike.report.md` left in `ios/components/Host`. The Android
 * Host itself is on branch `task/T16-host-spike` (`NitroUiHostView`), and the JS API
 * is identical on both.
 */
class HybridNitroUiHost(
  reactContext: ThemedReactContext,
) : HybridNitroUiHostSpec() {
  /** A plain container: no composition, no sizing, no children of its own. */
  override val view: View = View(reactContext)
}
