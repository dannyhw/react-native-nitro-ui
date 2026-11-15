package com.margelo.nitro.nitroui.core

/** Marks into the C++ perf ring. The kinds must match `NitroUiPerf::KIND_*` in C++. */
object NitroUiPerf {
  /** `nuiPerfId` of a view that never set one. */
  const val NO_INSTANCE: Int = -1

  const val KIND_PROPS_APPLIED: Int = 0

  const val KIND_FIRST_FRAME: Int = 1

  /** `onDropView` ran: a real unmount, or the first step of recycling. */
  const val KIND_DROPPED: Int = 2

  /** `prepareForRecycle` ran. A dropped mark with no recycled mark after it is a real unmount. */
  const val KIND_RECYCLED: Int = 3

  @JvmStatic private external fun nMark(instanceId: Int, kind: Int)

  fun mark(instanceId: Int, kind: Int) {
    if (instanceId == NO_INSTANCE) {
      return
    }
    nMark(instanceId, kind)
  }
}
