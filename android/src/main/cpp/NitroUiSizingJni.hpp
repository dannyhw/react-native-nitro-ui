// JNI entry from `NitroUiSizing.kt` into the C++ sizing engine.

#pragma once

#include <jni.h>

namespace margelo::nitro::nitroui {

  // Returns false if the class is not in this build, leaving no pending Java exception.
  bool registerSizingNatives(JNIEnv* env);

} // namespace margelo::nitro::nitroui
