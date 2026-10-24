package nitroui.example

import android.os.Debug
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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

  private companion object {
    /** The name JS asks the module registry for. */
    const val MODULE_NAME = "NitroUiProbe"

    /** How long to let the collectors settle before reading the heap. */
    const val GC_SETTLE_MS = 250L
  }
}

class NitroUiProbePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(NitroUiProbeModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
