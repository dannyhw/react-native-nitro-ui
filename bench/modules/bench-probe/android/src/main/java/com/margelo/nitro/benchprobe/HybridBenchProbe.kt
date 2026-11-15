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
 * The clock is absolute `System.nanoTime()`: Choreographer reports `frameTimeNanos` on
 * that base and so does the library's own perf clock. `elapsedRealtimeNanos()` disagrees
 * with frame times.
 */
class HybridBenchProbe : HybridBenchProbeSpec() {
  private companion object {
    const val TAG = "NITRO_BENCH"
    const val LOG_PREFIX = "NITRO_BENCH "

    /** `/proc/self/task/<tid>/stat` times are in USER_HZ ticks; Linux uses 100 Hz. */
    const val TICKS_PER_SECOND = 100.0
    const val NS_PER_TICK = 1_000_000_000.0 / TICKS_PER_SECOND

    /** How long the pacing wait in `nextFrameNs` waits for a frame before reporting "now". */
    const val FRAME_TIMEOUT_MS = 2_000L

    /**
     * A backstop for a window that never draws, not the wait the runner asked for. The
     * plan parser caps a requested timeout below this value
     * (`BENCH_DEFAULT_TIMEOUTS.android.presentationCeilingMs` in `bench/src/plan.ts`,
     * which must match), so the backstop never answers in the requested timeout's place.
     */
    const val PRESENTATION_CEILING_MS = 2_000L
  }

  /**
   * One armed mounting transaction: when Fabric applied it, and the frame that
   * presented it.
   *
   * Written on the main thread and awaited from the JS thread, hence the lock.
   * Promises are resolved outside the lock, exactly once.
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
      // Nothing will ever settle this capture: answer -1 at once instead of making
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
          // Timed out: -1 is this transaction's answer.
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
   * The window's frame metrics give the instant a drawn frame finished. Without a
   * window, a Choreographer callback gives the next vsync instead, which is the
   * start of a frame and so about one frame earlier.
   */
  private fun armFrameCapture(target: Capture, mountNs: Long) {
    val activity: Activity? = BenchProbeContextHolder.context?.currentActivity
    val window = activity?.window
    if (window != null) {
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
    }, PRESENTATION_CEILING_MS)
  }

  /**
   * When a completed frame finished (`INTENDED_VSYNC + TOTAL_DURATION`, on the
   * `System.nanoTime()` base), or null when the frame cannot have drawn the mount at
   * [mountNs].
   *
   * A frame qualifies when its animation phase ended at or after the mount. Its
   * intended vsync alone is the wrong test: Fabric mounts inside a Choreographer
   * frame callback and that same frame draws the new views, so the presenting
   * frame's intended vsync is already earlier than the mount stamp.
   */
  private fun frameMetricsEndNs(frameMetrics: FrameMetrics, mountNs: Long): Long? {
    return try {
      // A timestamp metric that was not recorded reads as 0, which is rejected below.
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

  /** Pacing only. The measured "presented" stamp comes from the capture armed at the mount. */
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
        // Sync probe calls run on the JS thread, so the first sample pins its tid.
        // On that thread the kernel's per-thread clock answers without a /proc parse.
        if (jsTid == -1) jsTid = current
        if (current == jsTid) Debug.threadCpuTimeNanos().toDouble()
        else readProcThreadCpuNs(jsTid)
      }
    }

  /**
   * CPU time of one task in ns, or -1.
   *
   * `/proc/self/task/<tid>/schedstat` field 0 is run time in nanoseconds; the
   * other fields are not CPU time. The `/stat` fallback counts in 10 ms ticks,
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
   * Read from `/proc/self/smaps_rollup` because `ActivityManager.getProcessMemoryInfo`
   * returns a cached snapshot: two calls in the same second give the same number, so
   * a before/after delta would be 0. It is the fallback only when the file is unreadable.
   */
  override fun footprintBytes(): Double {
    readSmapsRollupPssKb()?.let { return it * 1024.0 }

    val context: Context = BenchProbeContextHolder.context ?: return -1.0
    val activityManager =
      context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return -1.0
    // Slow (tens of ms): callers must keep it out of timed regions.
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
   * Allocated bytes in the native heap. Reported beside PSS because PSS also
   * counts the Hermes and ART heaps, which vary for reasons unrelated to views.
   */
  override fun nativeHeapBytes(): Double = Debug.getNativeHeapAllocatedSize().toDouble()

  /** Bytes in use on the Java heap. */
  override fun javaHeapBytes(): Double {
    val runtime = Runtime.getRuntime()
    return (runtime.totalMemory() - runtime.freeMemory()).toDouble()
  }

  override fun gc() {
    Runtime.getRuntime().gc()
    // Let the collector finish before the caller samples footprint. Hermes is
    // collected separately, from JS.
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
