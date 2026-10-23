//
//  NitroUiSizingJni.cpp
//
//  The Android half of intrinsic sizing (docs/architecture/sizing.md).
//
//  Two directions:
//   - `nBind`: the generated manager hands us the view's `StateWrapper`, which we
//     unwrap the way the generated state updater does (and the way
//     @lodev09/react-native-true-sheet does) to reach the Fabric `State` a
//     measured size can be pushed into.
//   - `nReport` / `nFlush`: the Compose host reports what it measured, and the
//     `OnPreDrawListener` applies the batch before the frame is drawn.
//

#include "NitroUiSizingJni.hpp"

#include "NitroUiIntrinsic.hpp"
#include "NitroUiSizingEngine.hpp"
#include "core/NitroUiSizing.hpp"

#include <NitroModules/JStateWrapper.hpp>
#include <fbjni/fbjni.h>
#include <react/fabric/StateWrapperImpl.h>

#include <iterator>
#include <string>

using namespace facebook;

namespace margelo::nitro::nitroui {

  namespace {

    /**
     * The `State` behind a Kotlin `StateWrapper`, or `nullptr` if there is none.
     *
     * A `StateWrapper` is an interface object whose implementation is
     * `StateWrapperImpl`; the generated state updater does the same downcast.
     */
    NitroUiStateRef stateFromWrapper(jni::alias_ref<JStateWrapper::javaobject> stateWrapper) {
      if (stateWrapper.get() == nullptr) {
        return nullptr;
      }
      jobject raw = stateWrapper.get();
      if (!stateWrapper->isInstanceOf(react::StateWrapperImpl::javaClassStatic())) [[unlikely]] {
        // Not Fabric's implementation - nothing to push into.
        return nullptr;
      }
      auto impl = jni::alias_ref<react::StateWrapperImpl::javaobject>{static_cast<react::StateWrapperImpl::javaobject>(raw)};
      return eraseFabricState(impl->cthis()->getState());
    }

    std::string toUtf8(JNIEnv* env, jstring value) {
      if (value == nullptr) {
        return {};
      }
      const char* chars = env->GetStringUTFChars(value, nullptr);
      if (chars == nullptr) {
        // An out-of-memory or interrupted call: report it, and carry on with an
        // empty name rather than a pending exception at the next JNI boundary.
        return {};
      }
      std::string result(chars);
      env->ReleaseStringUTFChars(value, chars);
      return result;
    }

    void nativeBind(JNIEnv* env, jclass, jstring componentName, JStateWrapper::javaobject stateWrapper) {
      const std::string name = toUtf8(env, componentName);
      if (name.empty()) {
        return;
      }
      NitroUiSizingEngine::shared().bind(name.c_str(), stateFromWrapper(jni::alias_ref<JStateWrapper::javaobject>{stateWrapper}));
    }

    jboolean nativeFlush(JNIEnv* /*env*/, jclass) {
      return NitroUiSizing::flush() ? JNI_TRUE : JNI_FALSE;
    }

    void nativeReport(JNIEnv* /*env*/, jclass, jlong instanceId, jdouble width, jdouble height, jint policy) {
      NitroUiSizing::report(static_cast<int64_t>(instanceId), static_cast<double>(width), static_cast<double>(height),
                            static_cast<int32_t>(policy));
    }

    void nativeSetFallback(JNIEnv* env, jclass, jstring componentName, jdouble width, jdouble height, jint policy) {
      const std::string name = toUtf8(env, componentName);
      if (name.empty()) {
        return;
      }
      NitroUiSizing::setFallback(name.c_str(), static_cast<double>(width), static_cast<double>(height), static_cast<int32_t>(policy));
    }

    void nativeInvalidateEnvironment(JNIEnv* /*env*/, jclass) {
      NitroUiSizing::invalidateEnvironment();
    }

    void nativeRecordDrawnSize(JNIEnv* /*env*/, jclass, jlong instanceId, jdouble width, jdouble height) {
      NitroUiSizing::recordDrawnSize(static_cast<int64_t>(instanceId), static_cast<double>(width), static_cast<double>(height));
    }

    jboolean nativeHasPendingReports(JNIEnv* /*env*/, jclass) {
      return NitroUiSizingEngine::shared().hasPendingReports() ? JNI_TRUE : JNI_FALSE;
    }

    jlong nativeCachedSizeCount(JNIEnv* /*env*/, jclass) {
      return static_cast<jlong>(NitroUiSizing::cachedSizeCount());
    }

    const JNINativeMethod sizingMethods[] = {
      {"nBind", "(Ljava/lang/String;Lcom/facebook/react/uimanager/StateWrapper;)V", reinterpret_cast<void*>(&nativeBind)},
      {"nFlush", "()Z", reinterpret_cast<void*>(&nativeFlush)},
      {"nReport", "(JDDI)V", reinterpret_cast<void*>(&nativeReport)},
      {"nSetFallback", "(Ljava/lang/String;DDI)V", reinterpret_cast<void*>(&nativeSetFallback)},
      {"nInvalidateEnvironment", "()V", reinterpret_cast<void*>(&nativeInvalidateEnvironment)},
      {"nCachedSizeCount", "()J", reinterpret_cast<void*>(&nativeCachedSizeCount)},
      {"nRecordDrawnSize", "(JDD)V", reinterpret_cast<void*>(&nativeRecordDrawnSize)},
      {"nHasPendingReports", "()Z", reinterpret_cast<void*>(&nativeHasPendingReports)},
    };

  } // namespace

  bool registerSizingNatives(JNIEnv* env) {
    jclass clazz = env->FindClass("com/margelo/nitro/nitroui/core/NitroUiSizing");
    if (clazz == nullptr) {
      // Absent (e.g. stripped from this build type) - never leave a pending
      // exception behind, it would surface at an unrelated JNI boundary.
      env->ExceptionClear();
      return false;
    }
    const jint result = env->RegisterNatives(clazz, sizingMethods, static_cast<jint>(std::size(sizingMethods)));
    env->DeleteLocalRef(clazz);
    if (result != JNI_OK) {
      env->ExceptionClear();
      return false;
    }
    return true;
  }

} // namespace margelo::nitro::nitroui
