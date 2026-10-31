package nitroui.example

import android.os.Debug
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ViewManager

/**
 * Test-only memory probe for the harness suite (task B1).
 *
 * Lives in the example app, not in the library: it is instrumentation for
 * `example/__tests__/MountChurn.harness.tsx`, and nothing a consumer can reach.
 * The question it answers - "is the Java heap still held after a full collect the
 * same size it was before mounting and unmounting N controls K times?" - needs a
 * number from inside the process, which JS has no way to ask for (Hermes reports
 * only its own heap).
 *
 * A legacy module on purpose: the example app has no codegen spec of its own, and
 * bridgeless reaches such modules through the interop layer. Every method is a
 * Promise, because bridgeless does not expose legacy synchronous methods to JS.
 */
@ReactModule(name = NitroUiProbeModule.MODULE_NAME)
class NitroUiProbeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  /**
   * Java heap in use, with the garbage collectors asked to run first.
   *
   * `Runtime.totalMemory() - freeMemory()` is what the process is *holding*: ART
   * keeps committed pages after a collect, so a leak shows as a floor that climbs
   * cycle over cycle while a churning app returns to the same floor. The dalvik
   * numbers are reported next to it because the runtime measures them rather than
   * deriving them, and a disagreement between the two is worth seeing in a failure
   * message.
   */
  @ReactMethod
  fun heapStats(forceGc: Boolean, promise: Promise) {
    try {
      if (forceGc) {
        // Two passes, each with finalisation run and a settle wait after it: ART
        // treats `System.gc()` as advisory, and one call can be coalesced into a
        // concurrent collection that has not finished by the time the heap is
        // read. Finalisers matter here too - `View` decrements its live-instance
        // counter from one.
        repeat(2) {
          System.gc()
          System.runFinalization()
          Thread.sleep(GC_SETTLE_MS)
        }
      }
      val runtime = Runtime.getRuntime()
      val info = Debug.MemoryInfo().also(Debug::getMemoryInfo)
      val stats =
        Arguments.createMap().apply {
          putDouble("usedBytes", (runtime.totalMemory() - runtime.freeMemory()).toDouble())
          putDouble("totalBytes", runtime.totalMemory().toDouble())
          putDouble("maxBytes", runtime.maxMemory().toDouble())
          putDouble("dalvikPrivateDirtyKb", info.dalvikPrivateDirty.toDouble())
          putDouble("dalvikPssKb", info.dalvikPss.toDouble())
        }
      promise.resolve(stats)
    } catch (error: Throwable) {
      promise.reject("heap-stats", error)
    }
  }

  /**
   * Whether RN's `enableViewRecycling` flag is on **as the process now sees it**.
   *
   * The one number that lets `example/__tests__/Recycling.harness.tsx` tell "recycling
   * works" from "recycling is switched off, so nothing ever reached
   * `prepareForRecycle`". The app installs its override at launch
   * (`NitroUiFeatureFlags`), and the flag accessor caches its first answer, so this is
   * the value every `ViewManager` was constructed under — read from the same door RN
   * itself reads, not from a copy of the intent.
   */
  @ReactMethod
  fun viewRecyclingEnabled(promise: Promise) {
    try {
      promise.resolve(ReactNativeFeatureFlags.enableViewRecycling())
    } catch (error: Throwable) {
      promise.reject("view-recycling-flag", error)
    }
  }

  private companion object {
    /** The name JS asks the module registry for. */
    const val MODULE_NAME = "NitroUiProbe"

    /** How long to let the collectors settle before reading the heap. */
    const val GC_SETTLE_MS = 250L
  }

  /**
   * Simulate B1 review N5's shape on a live hosted control, and report what the guard did:
   * `"<host class>|dropped|measuredWidth=<n>"`, or `"no-host"` when nothing hosted is on
   * screen.
   *
   * The shape is: a hosted control is dropped **while it is still attached**, and is then
   * measured. RN reaches it from `stopSurface`, which drops views before taking the root
   * out; the probe reaches it by calling the library's own teardown and then asking the
   * view to measure, which is what a layout pass would do. Nothing else is faked: the
   * composition really is disposed, the strategy really is un-armed, and the measure
   * really is the framework's `View.measure`.
   *
   * Why a probe rather than the app itself: the harness cannot unmount one control while
   * leaving its parent's layout pass running - the only dropped-and-still-attached view a
   * test can reach is one the app hands over deliberately. And the answer is read two
   * ways on purpose: `measuredWidth` here (`0` = the guard declined, anything else = it
   * composed for a dead mount), and the library's own process-wide ask count from JS. A
   * probe cannot see the count and the count cannot see the width, so both have to be
   * read or neither says anything.
   *
   * Runs on the UI thread and waits for it: `drop()` disposes a composition and
   * `measure()` would lay one out, both of which Compose requires be done there. That
   * blocks this bridge thread, never the JS thread - every method here is a Promise for
   * exactly that reason.
   */
  @ReactMethod
  fun simulatePostDropMeasure(promise: Promise) {
    // `reactApplicationContext.currentActivity`, not `getCurrentActivity()`: the module
    // base class deprecates its own accessor in favour of this one in RN 0.88.
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "the example app has no activity to walk")
      return
    }
    val decor = activity.window?.decorView
    if (decor == null) {
      promise.reject("NO_DECOR", "the activity has no decor view to walk")
      return
    }
    val done = java.util.concurrent.CountDownLatch(1)
    var answer = "no-host"
    activity.runOnUiThread {
      val host = findHost(decor)
      if (host != null) {
        // Whether it is still attached is the precondition of N5, so it is reported
        // rather than assumed: a host that had already been removed from its parent is
        // not the shape under test, and `measuredWidth=0` would then be an answer about
        // a detached view rather than about the guard.
        val attached = host.isAttachedToWindow
        host.drop()
        // Exactly one measure, and with a spec the host has never been given. Android
        // caches a view's measured result against the spec it last saw and returns the
        // cached number without calling `onMeasure`, so a spec the view has never had is
        // what guarantees the call reaches the guard. `requestLayout()` would also force
        // it, and deliberately is not used: it schedules a pass on a later frame, which
        // would have a dropped host measured again during some other test's window.
        //
        // One measure, not two, so the JS side can assert the counter moved by exactly
        // one: an ask-count that cannot be pinned to a known number of asks is a number,
        // not a measurement.
        val spec =
          android.view.View.MeasureSpec.makeMeasureSpec(2000, android.view.View.MeasureSpec.EXACTLY)
        host.measure(spec, spec)
        answer =
          "${host.javaClass.simpleName}|attached=$attached|dropped|" +
            "measuredWidth=${host.measuredWidth}"
      } else {
        // Not a bare "no-host": the shape is the diagnosis, and this is the harness's
        // only look at the app's real view tree. `views` proves the walk ran at all, and
        // `reactViews` says whose window the test content is in - if the activity here is
        // not the one hosting React, no amount of walking finds a host.
        answer =
          "no-host|activity=${activity.javaClass.simpleName}|" +
            "root=${decor.javaClass.simpleName}|views=${countViews(decor)}|" +
            "reactViews=${countNamed(decor, "React")}"
      }
      done.countDown()
    }
    done.await(5, java.util.concurrent.TimeUnit.SECONDS)
    promise.resolve(answer)
  }

  /** Depth-first count of every view under [view], including it. */
  private fun countViews(view: android.view.View): Int {
    var total = 1
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        total += countViews(view.getChildAt(index))
      }
    }
    return total
  }

  /** Depth-first count of views whose class name contains [needle]. */
  private fun countNamed(view: android.view.View, needle: String): Int {
    var total = if (view.javaClass.name.contains(needle)) 1 else 0
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        total += countNamed(view.getChildAt(index), needle)
      }
    }
    return total
  }

  /**
   * Depth-first search for the first hosted control in the app's view tree.
   *
   * Any control will do: the rule under test is `NitroComposeHost`'s, shared by all of
   * them, and the harness's own screen has a Switch on it.
   */
  private fun findHost(
    view: android.view.View
  ): com.margelo.nitro.nitroui.core.NitroComposeHost<*>? {
    if (view is com.margelo.nitro.nitroui.core.NitroComposeHost<*>) {
      return view
    }
    if (view is android.view.ViewGroup) {
      for (index in 0 until view.childCount) {
        findHost(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }
}

class NitroUiProbePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(NitroUiProbeModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
