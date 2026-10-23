#include <jni.h>
#include "NitroUiSizingJni.hpp"
#include "nitrouiOnLoad.hpp"
#include "core/NitroUiPerf.hpp"

#include <fbjni/fbjni.h>

using namespace margelo::nitro::nitroui;

namespace {

  // `NitroUiPerf.nMark(int, int)` in
  // android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiPerf.kt.
  // Registered explicitly (rather than by name mangling) so the symbol survives
  // minification and a package rename.
  void nativeMark(JNIEnv* env, jclass, jint instanceId, jint kind) {
    NitroUiPerf::mark(static_cast<int32_t>(instanceId), static_cast<int32_t>(kind));
  }

  const JNINativeMethod perfMethods[] = {
    {"nMark", "(II)V", reinterpret_cast<void*>(&nativeMark)},
  };

  bool registerPerfNatives(JNIEnv* env) {
    jclass clazz = env->FindClass("com/margelo/nitro/nitroui/core/NitroUiPerf");
    if (clazz == nullptr) {
      // Absent (e.g. stripped from this build type) - never leave a pending
      // exception behind, it would surface at an unrelated JNI boundary.
      env->ExceptionClear();
      return false;
    }
    const jint result = env->RegisterNatives(clazz, perfMethods, 1);
    env->DeleteLocalRef(clazz);
    if (result != JNI_OK) {
      env->ExceptionClear();
      return false;
    }
    return true;
  }

} // namespace

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [&]() {
    margelo::nitro::nitroui::registerAllNatives();
    JNIEnv* env = facebook::jni::Environment::current();
    if (env == nullptr) {
      return;
    }
    // Perf marks are opt-in diagnostics; losing them must not break startup.
    // Kotlin's `NitroUiPerf.mark` throws UnsatisfiedLinkError if it is ever
    // reached, which only happens for a view that set `nuiPerfId`.
    registerPerfNatives(env);
    // Same for sizing. If the engine symbols are missing, the Kotlin
    // `NitroUiSizing` catches the resulting `UnsatisfiedLinkError` and turns
    // every call into a no-op, so views are laid out with their declared
    // fallback size instead of crashing at startup — without that catch a missing
    // engine would take down the first hosted view, not degrade the layout.
    registerSizingNatives(env);
  });
}
