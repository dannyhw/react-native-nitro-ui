@file:OptIn(UnstableReactNativeAPI::class)

package com.margelo.nitro.benchprobe

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.Trace
import android.util.Log
import android.view.Choreographer
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.fabric.FabricUIManager
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import com.margelo.nitro.core.Promise
import java.io.File
import java.io.RandomAccessFile

/**
 * Android implementation of the `BenchProbe` HybridObject.
 *
 * Clock: `System.nanoTime()`, offset by a process-load origin. `nanoTime()` is
 * the same base Choreographer reports `frameTimeNanos` on, which is what makes
 * "presented" latency comparable with "mounted" and with JS timestamps.
 * `elapsedRealtimeNanos()` is deliberately NOT used - it disagrees with frame
 * times (docs/research/setup-decisions.md SS6, docs/DECISIONS.md D1).
 */
class HybridBenchProbe : HybridBenchProbeSpec() {
  private companion object {
    const val TAG = "NITRO_BENCH"

    /** Captured at class load; every reported timestamp is relative to it. */
    val originNs: Long = System.nanoTime()

    /** `/proc/self/task/<tid>/stat` times are in USER_HZ ticks; Linux uses 100 Hz. */
    const val TICKS_PER_SECOND = 100.0
    const val NS_PER_TICK = 1_000_000_000.0 / TICKS_PER_SECOND

    const val LOG_PREFIX = "NITRO_BENCH "
  }

  @Volatile
  private var lastMountNsValue: Double = -1.0

  @Volatile
  private var armed = false

  @Volatile
  private var mountListenerInstalled = false

  @Volatile
  private var jsTid = -1

  private val mainHandler = Handler(Looper.getMainLooper())

  private val mountListener = object : UIManagerListener {
    override fun willDispatchViewUpdates(uiManager: UIManager) = Unit

    override fun willMountItems(uiManager: UIManager) = Unit

    override fun didMountItems(uiManager: UIManager) {
      if (armed) {
        armed = false
        lastMountNsValue = (System.nanoTime() - originNs).toDouble()
      }
    }

    override fun didDispatchMountItems(uiManager: UIManager) = Unit

    override fun didScheduleMountItems(uiManager: UIManager) = Unit
  }

  // ------------------------------------------------------------------ clock ---

  override fun now(): Double = (System.nanoTime() - originNs).toDouble()

  // ------------------------------------------------------------------ mount ---

  override fun armMountObserver() {
    lastMountNsValue = -1.0
    installMountListenerIfNeeded()
    // Arm only after the listener exists, so a mount during installation
    // cannot be attributed to the wrong sample.
    armed = true
  }

  override val lastMountNs: Double
    get() = lastMountNsValue

  private fun installMountListenerIfNeeded() {
    if (mountListenerInstalled) return
    val context: ReactContext? = BenchProbeContextHolder.context
    if (context == null) {
      Log.w(TAG, LOG_PREFIX + "mount hook unavailable: no ReactContext yet")
      return
    }
    val uiManager = UIManagerHelper.getUIManager(context, UIManagerType.FABRIC)
    if (uiManager !is FabricUIManager) {
      Log.w(TAG, LOG_PREFIX + "mount hook unavailable: no FabricUIManager (got $uiManager)")
      return
    }
    uiManager.addUIManagerEventListener(mountListener)
    mountListenerInstalled = true
  }

  // ------------------------------------------------------------------ frames ---

  override fun nextFrameNs(): Promise<Double> {
    val promise = Promise<Double>()
    // Choreographer.getInstance() requires a Looper, and probe calls arrive on
    // the JS thread, so hop to the main thread first.
    mainHandler.post {
      Choreographer.getInstance().postFrameCallback { frameTimeNanos ->
        promise.resolve((frameTimeNanos - originNs).toDouble())
      }
    }
    return promise
  }

  // --------------------------------------------------------------- CPU time ---

  override fun threadCpuNs(thread: BenchThread): Double =
    when (thread) {
      BenchThread.MAIN -> readProcThreadCpuNs(Process.myPid())
      // Sync probe calls run on the calling (JS/Hermes) thread, so the first
      // sample pins its tid for later reads from other threads.
      BenchThread.JS -> {
        if (jsTid == -1) jsTid = Process.myTid()
        readProcThreadCpuNs(jsTid)
      }
    }

  /** utime + stime of one task, in ns. -1 when unreadable. */
  private fun readProcThreadCpuNs(tid: Int): Double {
    if (tid <= 0) return -1.0
    val line = try {
      RandomAccessFile("/proc/self/task/$tid/stat", "r").use { it.readLine() }
    } catch (error: Exception) {
      Log.w(TAG, LOG_PREFIX + "cannot read cpu for tid $tid: $error")
      return -1.0
    }
    // Field 2 is the comm in parentheses and may contain spaces, so parse
    // everything after the last ')'. Fields then start at 3 (state), making
    // utime index 11 and stime index 13.
    val closingParen = line.lastIndexOf(')')
    if (closingParen < 0) return -1.0
    val fields = line.substring(closingParen + 1).trim().split(' ')
    if (fields.size < 14) return -1.0
    val utime = fields[11].toDoubleOrNull() ?: return -1.0
    val stime = fields[13].toDoubleOrNull() ?: return -1.0
    return (utime + stime) * NS_PER_TICK
  }

  // ----------------------------------------------------------------- memory ---

  /**
   * Proportional Set Size of this process, in bytes.
   *
   * `/proc/self/smaps_rollup` is read directly because
   * `ActivityManager.getProcessMemoryInfo` (and the `Debug.getMemoryInfo`
   * wrapper around it) return a cached snapshot - two calls in the same second
   * give the same number, so the empty-vs-full footprint delta the memory
   * scenario needs would be exactly 0. Reading the kernel's own accounting is
   * accurate and cheap (~1 ms). Falls back to the cached ActivityManager path
   * only if the kernel file is unreadable.
   */
  override fun footprintBytes(): Double {
    readSmapsRollupPssKb()?.let { return it * 1024.0 }

    val context: Context = BenchProbeContextHolder.context ?: return -1.0
    val activityManager =
      context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return -1.0
    // Slow (tens of ms) and cached - callers must keep it out of timed regions.
    val infos = try {
      activityManager.getProcessMemoryInfo(intArrayOf(Process.myPid()))
    } catch (error: Exception) {
      Log.w(TAG, LOG_PREFIX + "getProcessMemoryInfo failed: $error")
      return -1.0
    }
    val info = infos.firstOrNull() ?: return -1.0
    return info.totalPss.toDouble() * 1024.0
  }

  /** PSS in kB from `/proc/self/smaps_rollup`, or null if unavailable. */
  private fun readSmapsRollupPssKb(): Double? {
    return try {
      File("/proc/self/smaps_rollup").useLines { lines ->
        lines.firstOrNull { it.startsWith("Pss:") }
          ?.split(' ')
          ?.lastOrNull { it.isNotEmpty() && it != "kB" }
          ?.toDoubleOrNull()
      }
    } catch (error: Exception) {
      Log.w(TAG, LOG_PREFIX + "cannot read smaps_rollup: $error")
      null
    }
  }

  override fun gc() {
    Runtime.getRuntime().gc()
    // Let the collector finish before the caller samples footprint. The extra
    // settle on top of this is done JS-side (metrics SS: "after GC and a 1 s settle").
    try {
      Thread.sleep(60)
    } catch (interrupted: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  // ------------------------------------------------------------- launch plan ---

  override fun launchPlan(): String =
    BenchProbeContextHolder.context?.currentActivity?.intent?.getStringExtra("benchPlan") ?: ""

  override fun writeNdjson(contents: String): String {
    val context: Context =
      BenchProbeContextHolder.context ?: error("BenchProbe: no ReactContext to resolve a write dir")
    // External files dir: readable through `adb shell cat` on a release build,
    // which `run-as` is not (run-as requires a debuggable app).
    val directory = context.getExternalFilesDir(null) ?: context.filesDir
    val file = File(directory, "bench.ndjson")
    file.writeText(contents)
    return file.absolutePath
  }

  // --------------------------------------------------------------- tracing ---

  override fun begin(name: String, id: Double) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    Trace.beginAsyncSection(truncateTraceName(name), id.toInt())
  }

  override fun end(name: String, id: Double) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    Trace.endAsyncSection(truncateTraceName(name), id.toInt())
  }

  private fun truncateTraceName(name: String): String =
    if (name.length <= 63) name else name.substring(0, 63)
}
