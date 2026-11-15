#include <jni.h>
#include "NitroUiSizingJni.hpp"
#include "nitrouiOnLoad.hpp"
#include "core/NitroUiPerf.hpp"

#include <fbjni/fbjni.h>

using namespace margelo::nitro::nitroui;

namespace {

  // Registered explicitly rather than by JNI name mangling, so the symbol survives
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
      // A pending exception would surface at an unrelated JNI boundary.
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
    // Perf marks are optional diagnostics: failing to register them must not break startup.
    registerPerfNatives(env);
    // Sizing too: without the engine, Kotlin's `NitroUiSizing` turns every call into a no-op.
    registerSizingNatives(env);
  });
}
