//
//  NitroUiSizingJni.hpp
//
//  JNI door from `NitroUiSizing.kt` into the C++ sizing engine. Registered with
//  `RegisterNatives` next to the perf marks, in `cpp-adapter.cpp`.
//

#pragma once

#include <jni.h>

namespace margelo::nitro::nitroui {

  /**
   * Register `NitroUiSizing`'s natives. Returns `false` if the class is not in
   * this build - the caller must not treat that as fatal, and never leaves a
   * pending Java exception behind.
   */
  bool registerSizingNatives(JNIEnv* env);

} // namespace margelo::nitro::nitroui
