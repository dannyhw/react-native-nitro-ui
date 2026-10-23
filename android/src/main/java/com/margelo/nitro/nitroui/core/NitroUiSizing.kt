package com.margelo.nitro.nitroui.core

import com.facebook.react.uimanager.StateWrapper

/**
 * Kotlin door into the C++ intrinsic-sizing engine (`cpp/NitroUiSizingEngine.hpp`),
 * the Android half of `docs/architecture/sizing.md`. Registered manually with
 * `RegisterNatives` in `android/src/main/cpp/cpp-adapter.cpp`.
 *
 * Nothing here throws: a view that cannot report a size must still lay out,
 * with its fallback. If the natives are missing from this build, the external
 * declarations below would throw `UnsatisfiedLinkError` when reached, so every
 * entry point is guarded by [isAvailable].
 */
object NitroUiSizing {
  /** `nuiSizingId` of a view that never set one (sizing off for that view). */
  const val NO_INSTANCE: Long = 0L

  /** The control's intrinsic size is its size: Switch, Button, SegmentedControl. */
  const val POLICY_INTRINSIC: Int = 0

  /** Width comes from the Yoga box when finite, height stays intrinsic. */
  const val POLICY_FILL_WIDTH: Int = 1

  private external fun nBind(componentName: String, stateWrapper: StateWrapper?)

  private external fun nFlush(immediateBudget: Int): Boolean

  private external fun nReport(instanceId: Long, width: Double, height: Double, policy: Int)

  private external fun nSetFallback(componentName: String, width: Double, height: Double, policy: Int)

  private external fun nInvalidateEnvironment()

  private external fun nInvalidateEnvironmentIfChanged(signature: String)

  private external fun nForget(instanceId: Long)

  private external fun nCachedSizeCount(): Long

  private external fun nRecordDrawnSize(instanceId: Long, width: Double, height: Double)

  private external fun nHasPendingReports(): Boolean

  /** Whether [registerNatives] found the class in this build. */
  @Volatile
  private var unavailable: Boolean = false

  /**
   * Hand a view's Fabric `StateWrapper` to the engine so measured sizes can be
   * pushed back into the shadow tree. Called from the generated view managers.
   */
  fun bind(componentName: String, stateWrapper: StateWrapper?) {
    if (unavailable) {
      return
    }
    try {
      nBind(componentName, stateWrapper)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /**
   * How many of a flush's corrections this platform pays for synchronously.
   *
   * One, on Android: a synchronous correction is a Fabric commit run inside the
   * `OnPreDrawListener` that called `flush`, and that listener is about to return
   * `false` and cancel the frame the commit would have drawn. One is what D17 asks
   * for there. It is not known to be enough for a whole batch: the synchronous
   * push clones one family, so the siblings ride a commit that only carries the
   * first instance's answer. What T12 measured is that a 100-instance cold batch
   * drew `stale=0` at budget 1 on one device - a measurement, not a guarantee, and
   * the harness logs the count rather than gating on it. A second synchronous push
   * in the same flush buys nothing measured: on a cold batch of 200, debug build,
   * the first batch in a process cost 38.80 ms with two pushes and 36.76 ms with
   * one, and the median of three rounds 18.88 ms against 12.84 ms (-32%; at 500
   * rows, 42.51 against 26.77, -37%). iOS keeps two, because its flush runs at the
   * end of a turn whose commit has not happened yet, so the pushes ride along with
   * it (8.5 ms for the same batch).
   */
  private const val IMMEDIATE_BUDGET_PER_FLUSH = 1

  /**
   * Apply queued size corrections as one batch of Fabric state updates.
   * Returns `true` when at least one size changed, i.e. the frame about to be
   * drawn is stale and the caller should skip drawing it.
   */
  fun flush(): Boolean {
    if (unavailable) {
      return false
    }
    return try {
      nFlush(IMMEDIATE_BUDGET_PER_FLUSH)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
      false
    }
  }

  /** Whether this view takes part in sizing (`nuiSizingId` was provided). */
  fun isSized(instanceId: Long): Boolean = instanceId != NO_INSTANCE

  /** Report the size Compose measured for this instance, in dp. */
  fun report(instanceId: Long, width: Double, height: Double, policy: Int) {
    if (unavailable || instanceId == NO_INSTANCE) {
      return
    }
    try {
      nReport(instanceId, width, height, policy)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /** Declare a component's cache-miss size, in dp. Call once, early. */
  fun setFallback(componentName: String, width: Double, height: Double, policy: Int) {
    if (unavailable) {
      return
    }
    try {
      nSetFallback(componentName, width, height, policy)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /**
   * The instance is finished (its host is dropping or recycling the view), so the
   * engine can drop its ledger and registry entries (review S3).
   */
  fun forget(instanceId: Long) {
    if (unavailable || instanceId == NO_INSTANCE) {
      return
    }
    try {
      nForget(instanceId)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /**
   * `invalidateEnvironment`, but only if `signature` differs from the last one
   * seen. Called from a per-view `onConfigurationChanged`, which fires once per
   * mounted view for one user action - the signature is what makes a rotation cost
   * nothing and a font-scale change cost one epoch (review S2).
   */
  fun invalidateEnvironmentIfChanged(signature: String) {
    if (unavailable) {
      return
    }
    try {
      nInvalidateEnvironmentIfChanged(signature)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /**
   * Font scale, locale or density changed: drop every cached size so controls
   * measure again at the new environment's size.
   */
  fun invalidateEnvironment() {
    if (unavailable) {
      return
    }
    try {
      nInvalidateEnvironment()
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /**
   * Whether size corrections are waiting for the next flush. A host uses this to
   * tell "this frame drew" from "this frame is about to be skipped because a
   * measured size has not reached Yoga yet" (see [recordDrawnSize]).
   */
  fun hasPendingReports(): Boolean {
    if (unavailable) {
      return false
    }
    return try {
      nHasPendingReports()
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
      false
    }
  }

  /**
   * Record the box this instance was drawn at, in dp, on its first frame.
   *
   * Sizing never reads it: it feeds the trace that lets an on-device test tell
   * "corrected before the frame was drawn" from "corrected one frame late".
   */
  fun recordDrawnSize(instanceId: Long, width: Double, height: Double) {
    if (unavailable || instanceId == NO_INSTANCE) {
      return
    }
    try {
      nRecordDrawnSize(instanceId, width, height)
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
    }
  }

  /** Number of cached sizes. For diagnostics and tests. */
  fun cachedSizeCount(): Long {
    if (unavailable) {
      return -1L
    }
    return try {
      nCachedSizeCount()
    } catch (_: UnsatisfiedLinkError) {
      unavailable = true
      -1L
    }
  }
}
