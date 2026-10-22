package com.margelo.nitro.nitroui.core

/**
 * Kotlin door into the C++ perf ring (`cpp/core/NitroUiPerf.hpp`), which is also
 * where `nitroUiCore.drainPerf()` reads from. Registered manually with
 * `RegisterNatives` in `android/src/main/cpp/cpp-adapter.cpp`.
 *
 * The kinds must stay in sync with `NitroUiPerf::KIND_*` (the source of truth).
 */
object NitroUiPerf {
  /** `nuiPerfId` of a view that never set one. */
  const val NO_INSTANCE: Int = -1

  /** Props from React were applied to the model and committed. */
  const val KIND_PROPS_APPLIED: Int = 0

  /** The hosted content drew its first frame. */
  const val KIND_FIRST_FRAME: Int = 1

  /** One JNI call per mark site; callers gate on [NO_INSTANCE] first. */
  @JvmStatic private external fun nMark(instanceId: Int, kind: Int)

  /** Record a mark, or do nothing for a view without a perf id. */
  fun mark(instanceId: Int, kind: Int) {
    if (instanceId == NO_INSTANCE) {
      return
    }
    nMark(instanceId, kind)
  }
}
