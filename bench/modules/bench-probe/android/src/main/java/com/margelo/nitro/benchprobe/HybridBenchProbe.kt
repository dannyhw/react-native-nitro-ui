@file:OptIn(UnstableReactNativeAPI::class)

package com.margelo.nitro.benchprobe

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.Trace
import android.util.Log
import android.view.Choreographer
import android.view.FrameMetrics
import android.view.Window
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
 * Clock: absolute `System.nanoTime()` - the same base Choreographer reports
 * `frameTimeNanos` on, so "presented" and "mounted" land on one scale, and the
 * same base `NitroUiCore.now()` uses (docs/DECISIONS.md D1). There is no
 * process-load origin: `nanoTime()` starts near zero, so absolute values are
 * far inside the exact-integer range of a `double`, and an offset made probe
 * stamps incomparable with the library's own perf marks.
 * `elapsedRealtimeNanos()` is deliberately NOT used - it disagrees with frame
 * times (docs/research/setup-decisions.md SS6).
 */
class HybridBenchProbe : HybridBenchProbeSpec() {
  private companion object {
    const val TAG = "NITRO_BENCH"
    const val LOG_PREFIX = "NITRO_BENCH "

    /** `/proc/self/task/<tid>/stat` times are in USER_HZ ticks; Linux uses 100 Hz. */
    const val TICKS_PER_SECOND = 100.0
    const val NS_PER_TICK = 1_000_000_000.0 / TICKS_PER_SECOND

    /**
     * How long the **pacing** frame wait (`nextFrameNs`) waits before giving up and
     * reporting "now". Pacing only; a slow frame here costs nothing but a slightly
     * short gap between iterations.
     */
    const val FRAME_TIMEOUT_MS = 2_000L

    /**
     * The ceiling on waiting for the *measured* presenting frame, in milliseconds.
     *
     * A backstop for a window that never draws, **not** the wait the runner asked for:
     * that is the `timeoutMs` of `awaitPresented`, which resolves the same capture
     * first through the same once-guard. A backstop that wins the race *becomes* the
     * timeout - the recorded reason would blame a wait the run never asked for - so the
     * plan parser caps a requested timeout strictly below this number
     * (`BENCH_DEFAULT_TIMEOUTS.android` in `bench/src/plan.ts`).
     *
     * 2 s, unchanged from before A4 (review M1, the orchestrator's call): the longer
     * wait A4 measured is scoped to iOS, because on Android the cells that lose
     * presenting samples never draw a frame at all and a longer ceiling only hid that.
     * iOS's ceiling is 90 s there (`kBenchPresentationCeilingSeconds`), which is why the
     * two platforms' caps differ too.
     */
    const val PRESENTATION_CEILING_MS = 2_000L
  }

  /**
   * One armed mounting transaction: when Fabric applied it, and the frame that
   * presented it.
   *
   * `didMountItems` and the frame-metrics callback both run on the main thread,
   * while `armMountObserver`/`awaitMount`/`awaitPresented` are called from the JS
   * thread - hence the monitor. Promises are resolved outside the monitor and
   * exactly once through a `settled` flag, so nothing can re-enter JS while
   * holding it.
   */
  private class Capture {
    val lock = Any()
    var mountNs = -1L
    var presentedNs = -1L
    var mountSettled = false
    var presentedSettled = false
    var mountPromise: Promise<Double>? = null
    var presentedPromise: Promise<Double>? = null
    /** Non-null while a frame-metrics listener or timeout is pending. */
    var window: Window? = null
    var listener: Window.OnFrameMetricsAvailableListener? = null
  }

  @Volatile
  private var capture: Capture? = null

  @Volatile
  private var lastMountNsValue: Double = -1.0

  @Volatile
  private var lastPresentedNsValue: Double = -1.0

  @Volatile
  private var mountListenerInstalled = false

  @Volatile
  private var mountHookFailed = false

  @Volatile
  private var jsTid = -1

  private val mainHandler = Handler(Looper.getMainLooper())

  private val mountListener = object : UIManagerListener {
    override fun willDispatchViewUpdates(uiManager: UIManager) = Unit

    override fun willMountItems(uiManager: UIManager) = Unit

    override fun didMountItems(uiManager: UIManager) = onDidMountItems()

    override fun didDispatchMountItems(uiManager: UIManager) = Unit

    override fun didScheduleMountItems(uiManager: UIManager) = Unit
  }

  // ------------------------------------------------------------------ clock ---

  override fun now(): Double = System.nanoTime().toDouble()

  // ------------------------------------------------------------------ mount ---

  override fun armMountObserver() {
    installMountListenerIfNeeded()
    val fresh = Capture()
    if (mountHookFailed) {
      // Nothing will ever call this capture: answer -1 at once instead of making
      // every iteration wait out its timeout.
      fresh.mountNs = -1L
      fresh.presentedNs = -1L
      fresh.mountSettled = true
      fresh.presentedSettled = true
    }
    lastMountNsValue = -1.0
    lastPresentedNsValue = -1.0
    // Published after the listener exists, so a mount during installation
    // cannot be attributed to the wrong sample.
    capture = fresh
  }

  override val lastMountNs: Double
    get() = lastMountNsValue

  override val lastPresentedNs: Double
    get() = lastPresentedNsValue

  override fun awaitMount(timeoutMs: Double): Promise<Double> = awaitStamp(mount = true, timeoutMs)

  override fun awaitPresented(timeoutMs: Double): Promise<Double> =
    awaitStamp(mount = false, timeoutMs)

  private fun awaitStamp(mount: Boolean, timeoutMs: Double): Promise<Double> {
    val promise = Promise<Double>()
    val target = capture
    if (target == null || mountHookFailed) {
      promise.resolve(-1.0)
      return promise
    }
    // Pair rather than locals: Kotlin will not let a captured `val` be assigned
    // from inside the synchronized lambda.
    val answered =
      synchronized(target.lock) {
        if (if (mount) target.mountSettled else target.presentedSettled) {
          true to (if (mount) target.mountNs else target.presentedNs).toDouble()
        } else {
          if (mount) {
            target.mountPromise = promise
          } else {
            target.presentedPromise = promise
          }
          false to -1.0
        }
      }
    if (answered.first) {
      promise.resolve(answered.second)
      return promise
    }
    mainHandler.postDelayed({
      val giveUp: Boolean
      synchronized(target.lock) {
        val have = if (mount) target.mountSettled else target.presentedSettled
        if (have) {
          giveUp = false
        } else {
          // Timeout: -1 is this transaction's answer, and it is a real one.
          if (mount) target.mountSettled = true else target.presentedSettled = true
          giveUp = true
        }
      }
      if (giveUp) {
        if (mount) resolveMount(target) else resolvePresented(target)
      }
    }, timeoutMs.toLong().coerceAtLeast(1L))
    return promise
  }

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

  /** Runs on the UI thread, inside the mounting transaction. */
  private fun onDidMountItems() {
    val target = capture ?: return
    val mountNs = System.nanoTime()
    val first = synchronized(target.lock) {
      if (target.mountSettled) {
        false
      } else {
        target.mountSettled = true
        target.mountNs = mountNs
        true
      }
    }
    if (!first) return
    lastMountNsValue = mountNs.toDouble()
    resolveMount(target)
    armFrameCapture(target, mountNs)
  }

  // ----------------------------------------------------------------- frames ---

  /**
   * Capture the frame that presents the transaction mounted at [mountNs].
   *
   * Primary source is the window's `OnFrameMetricsAvailableListener`, which
   * reports `INTENDED_VSYNC_TIMESTAMP + TOTAL_DURATION` for frames the window
   * actually drew - i.e. when that frame finished, without a JS round trip in
   * between. Frames whose vsync predates the mount cannot have presented it, so
   * they are ignored. When there is no window (or no API level), a Choreographer
   * callback is used instead; that is the vsync *before* the frame is drawn, so
   * it is a frame earlier - the two are not interchangeable, and the report
   * labels the number a frame stamp.
   *
   * Round-4 correction (docs/tasks/T02-bench.review.md S3): the naive filter
   * "reject a frame whose intended vsync predates the mount" rejects **the
   * presenting frame itself**. Fabric dispatches mount items from
   * `DispatchUIFrameCallback.doFrameGuarded`, a Choreographer frame callback,
   * and the views it invalidates are traversed and drawn in that same `doFrame`
   * - whose intended vsync is by construction earlier than the `nanoTime()`
   * stamp taken inside it. The old condition therefore recorded the first frame
   * drawn *after* presentation, which only exists when something invalidates
   * again within the capture's ceiling: every `update` cell had it (a thumb
   * animation) and a static `mount` screen mostly did not. Acceptance now asks
   * the real question - did this frame's animation phase run no earlier than
   * the mount? - in [frameMetricsEndNs].
   */
  private fun armFrameCapture(target: Capture, mountNs: Long) {
    val activity: Activity? = BenchProbeContextHolder.context?.currentActivity
    val window = activity?.window
    if (window != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val listener =
        object : Window.OnFrameMetricsAvailableListener {
          override fun onFrameMetricsAvailable(
            callbackWindow: Window,
            frameMetrics: FrameMetrics,
            dropCountSinceLastInvocation: Int,
          ) {
            val endNs = frameMetricsEndNs(frameMetrics, mountNs) ?: return
            val first = synchronized(target.lock) {
              if (target.presentedSettled) {
                false
              } else {
                target.presentedSettled = true
                target.presentedNs = endNs
                true
              }
            }
            if (first) {
              lastPresentedNsValue = endNs.toDouble()
              stopFrameCapture(target)
              resolvePresented(target)
            }
          }
        }
      target.window = window
      target.listener = listener
      try {
        window.addOnFrameMetricsAvailableListener(listener, mainHandler)
      } catch (error: Exception) {
        Log.w(TAG, LOG_PREFIX + "frame metrics listener failed: $error")
        target.window = null
        target.listener = null
      }
    }
    if (target.listener == null) {
      // Choreographer fallback: the next vsync after the mount.
      mainHandler.post {
        Choreographer.getInstance().postFrameCallback { frameTimeNanos ->
          val first = synchronized(target.lock) {
            if (target.presentedSettled) {
              false
            } else {
              target.presentedSettled = true
              target.presentedNs = frameTimeNanos
              true
            }
          }
          if (first) {
            lastPresentedNsValue = frameTimeNanos.toDouble()
            resolvePresented(target)
          }
        }
      }
    }
    mainHandler.postDelayed({
      val giveUp = synchronized(target.lock) {
        if (target.presentedSettled) {
          false
        } else {
          target.presentedSettled = true
          true
        }
      }
      stopFrameCapture(target)
      if (giveUp) {
        resolvePresented(target)
      }
      // The ceiling, not FRAME_TIMEOUT_MS: this is the measured capture, and a
      // backstop that wins the race against `awaitPresented(timeoutMs)` would
      // replace the timeout the runner asked for with this one.
    }, PRESENTATION_CEILING_MS)
  }

  /**
   * End timestamp of a completed frame, or null when it cannot be attributed
   * to the mount at [mountNs].
   *
   * A frame is attributable when its animation phase ran no later than the
   * mount, i.e. the mount could have been the invalidation this frame drew:
   *
   *   INTENDED_VSYNC + UNKNOWN_DELAY_DURATION + INPUT_HANDLING_DURATION +
   *     ANIMATION_DURATION >= mountNs
   *
   * `INTENDED_VSYNC` alone is not the test (round 3's bug): Fabric mounts
   * inside a Choreographer frame callback (`DispatchUIFrameCallback.doFrame`,
   * animation phase), and that same frame traverses and draws the new views -
   * so by the time `didMountItems` stamps the mount, the presenting frame's
   * intended vsync is already in the past, and a filter on it rejects exactly
   * the frame being looked for. The three durations before the animation phase
   * place that phase on the timeline (all public since API 24; the API 24
   * original `UNKNOWN_DELAY` was renamed `UNKNOWN_DELAY_DURATION`), and a frame
   * whose animation phase ended *before* the mount drew something else. A
   * mount landing inside the same frame's layout/draw tail is attributed at
   * most one frame early - `presented` is a frame stamp anyway.
   *
   * The stamp that is reported stays `INTENDED_VSYNC + TOTAL_DURATION`: the
   * instant the frame finished, on the same `System.nanoTime()` base as
   * [mountNs] (D1). A frame whose total duration is not recorded is rejected.
   */
  private fun frameMetricsEndNs(frameMetrics: FrameMetrics, mountNs: Long): Long? {
    return try {
      // `getMetric` is the only public accessor (`getLong`/`getInt` are internal
      // in android.view.FrameMetrics). Timestamp metrics are System.nanoTime()
      // values and duration metrics are nanoseconds, so the sum is the instant
      // the frame finished - "on screen", comparable with `mountNs` on D1's
      // clock. Timestamp metrics that were not recorded read as 0, which makes
      // the acceptance test below fail closed.
      val intendedVsync = frameMetrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP)
      if (intendedVsync <= 0L) return null
      val animationPhaseEndsNs =
        intendedVsync +
          frameMetrics.getMetric(FrameMetrics.UNKNOWN_DELAY_DURATION) +
          frameMetrics.getMetric(FrameMetrics.INPUT_HANDLING_DURATION) +
          frameMetrics.getMetric(FrameMetrics.ANIMATION_DURATION)
      if (animationPhaseEndsNs < mountNs) return null
      val totalDuration = frameMetrics.getMetric(FrameMetrics.TOTAL_DURATION)
      if (totalDuration <= 0L) return null
      intendedVsync + totalDuration
    } catch (error: IllegalArgumentException) {
      // Metric not recorded for this frame.
      null
    } catch (error: Exception) {
      Log.w(TAG, LOG_PREFIX + "frame metrics read failed: $error")
      null
    }
  }

  private fun stopFrameCapture(target: Capture) {
    val window = target.window
    val listener = target.listener
    if (window != null && listener != null) {
      target.window = null
      target.listener = null
      mainHandler.post {
        try {
          window.removeOnFrameMetricsAvailableListener(listener)
        } catch (error: Exception) {
          Log.w(TAG, LOG_PREFIX + "removing frame metrics listener failed: $error")
        }
      }
    }
  }

  private fun resolveMount(target: Capture) {
    val promise =
      synchronized(target.lock) {
        val pending = target.mountPromise
        target.mountPromise = null
        pending
      }
    promise?.resolve((if (target.mountNs == -1L) -1.0 else target.mountNs.toDouble()))
  }

  private fun resolvePresented(target: Capture) {
    val promise =
      synchronized(target.lock) {
        val pending = target.presentedPromise
        target.presentedPromise = null
        pending
      }
    promise?.resolve((if (target.presentedNs == -1L) -1.0 else target.presentedNs.toDouble()))
  }

  /**
   * Resolves when the next frame is presented after this call.
   *
   * Pacing only. Measured "presented" comes from the capture armed at the mount.
   */
  override fun nextFrameNs(): Promise<Double> {
    val promise = Promise<Double>()
    var settled = false
    // Choreographer.getInstance() requires a Looper, and probe calls arrive on
    // the JS thread, so hop to the main thread first.
    mainHandler.post {
      Choreographer.getInstance().postFrameCallback { frameTimeNanos ->
        if (!settled) {
          settled = true
          promise.resolve(frameTimeNanos.toDouble())
        }
      }
    }
    mainHandler.postDelayed({
      if (!settled) {
        settled = true
        promise.resolve(System.nanoTime().toDouble())
      }
    }, FRAME_TIMEOUT_MS)
    return promise
  }

  // --------------------------------------------------------------- CPU time ---

  override fun threadCpuNs(thread: BenchThread): Double =
    when (thread) {
      // The main thread's tid equals the pid on Android.
      BenchThread.MAIN -> readProcThreadCpuNs(Process.myPid())
      BenchThread.JS -> {
        val current = Process.myTid()
        // Sync probe calls run on the calling (JS/Hermes) thread, so the first
        // sample pins its tid for later reads. While still on that thread, ask
        // the kernel directly: CLOCK_THREAD_CPUTIME_ID is per-thread and needs
        // no /proc parse.
        if (jsTid == -1) jsTid = current
        if (current == jsTid) Debug.threadCpuTimeNanos().toDouble()
        else readProcThreadCpuNs(jsTid)
      }
    }

  /**
   * CPU time of one task in ns, or -1.
   *
   * `/proc/self/task/<tid>/schedstat` field 0 is run time in **nanoseconds**
   * (field 1 is run-queue wait and field 2 the timeslice, neither of which is
   * CPU time and neither of which may be added in).
   * The older `/stat` fallback only counts in USER_HZ ticks (10 ms), which is
   * coarser than a single mount, so it is a last resort.
   */
  private fun readProcThreadCpuNs(tid: Int): Double {
    if (tid <= 0) return -1.0
    readSchedstatNs(tid)?.let { return it }
    return readStatTicksNs(tid)
  }

  private fun readSchedstatNs(tid: Int): Double? {
    val line =
      try {
        RandomAccessFile("/proc/self/task/$tid/schedstat", "r").use { it.readLine() }
      } catch (error: Exception) {
        null
      } ?: return null
    val fields = line.trim().split(' ')
    if (fields.isEmpty()) return null
    return fields[0].toDoubleOrNull()
  }

  private fun readStatTicksNs(tid: Int): Double {
    val line =
      try {
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

  /**
   * Allocated bytes in the native (scudo/jemalloc) heap.
   *
   * PSS includes the Hermes heap and the ART heap, so without a breakdown the
   * Expo arms can read below `rn-core` for reasons that have nothing to do with
   * views. -1 on iOS, where `phys_footprint` already attributes the heap.
   */
  override fun nativeHeapBytes(): Double = Debug.getNativeHeapAllocatedSize().toDouble()

  /** Bytes in use on the Java heap. See [nativeHeapBytes] for why. */
  override fun javaHeapBytes(): Double {
    val runtime = Runtime.getRuntime()
    return (runtime.totalMemory() - runtime.freeMemory()).toDouble()
  }

  override fun gc() {
    Runtime.getRuntime().gc()
    // Let the collector finish before the caller samples footprint. The extra
    // settle on top of this is done JS-side (metrics SS: "after GC and a 1 s
    // settle"), and Hermes is collected separately via globalThis.gc.
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
