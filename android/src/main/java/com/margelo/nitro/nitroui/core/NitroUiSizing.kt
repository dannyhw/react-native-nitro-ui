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

  private external fun nFlush(): Boolean

  private external fun nReport(instanceId: Long, width: Double, height: Double, policy: Int)

  private external fun nSetFallback(componentName: String, width: Double, height: Double, policy: Int)

  private external fun nInvalidateEnvironment()

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
   * Apply queued size corrections as one batch of Fabric state updates.
   * Returns `true` when at least one size changed, i.e. the frame about to be
   * drawn is stale and the caller should skip drawing it.
   */
  fun flush(): Boolean {
    if (unavailable) {
      return false
    }
    return try {
      nFlush()
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
