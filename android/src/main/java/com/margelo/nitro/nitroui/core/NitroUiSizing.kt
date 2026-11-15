package com.margelo.nitro.nitroui.core

import com.facebook.react.uimanager.StateWrapper

/**
 * Kotlin entry to the C++ sizing engine. Nothing here throws: if the natives are missing
 * from the build, calls become no-ops and views lay out at their fallback size.
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

  @Volatile
  private var unavailable: Boolean = false

  /** Gives the engine a view's Fabric state, so measured sizes can reach the shadow tree. */
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

  // How many corrections a flush commits synchronously. One on Android: the commit runs
  // inside the pre-draw listener, which then cancels the frame, so more only add cost.
  private const val IMMEDIATE_BUDGET_PER_FLUSH = 1

  /**
   * Applies queued size corrections as one batch. Returns true when a size changed, meaning
   * the frame about to be drawn is stale and should be skipped.
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
   * Invalidates only when [signature] differs from the last one seen. Every mounted view
   * calls this for one configuration change.
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

  /** Drops every cached size, for a font scale, locale or density change. */
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

  /** Records the box an instance first drew at, in dp. Only on-device tests read it. */
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
