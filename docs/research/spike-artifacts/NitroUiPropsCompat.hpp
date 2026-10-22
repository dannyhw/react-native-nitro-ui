#pragma once
// Workaround for margelo/nitro#1656 until react-native-nitro-modules >= 0.37.2 is the floor.
// Mirrors upstream RawPropsCompat::initializeDynamicProps (margelo/nitro#1749).
#include <react/renderer/core/Props.h>
#include <react/renderer/core/RawProps.h>
#ifdef ANDROID
#include <cxxreact/ReactNativeVersion.h>
#if REACT_NATIVE_VERSION_MAJOR == 0 && REACT_NATIVE_VERSION_MINOR >= 84 && REACT_NATIVE_VERSION_MINOR < 87
#include <react/featureflags/ReactNativeFeatureFlags.h>
#endif
#endif

namespace nitroui::compat {
inline void initializeDynamicProps([[maybe_unused]] facebook::react::Props& props,
                                   [[maybe_unused]] const facebook::react::Props& sourceProps,
                                   [[maybe_unused]] const facebook::react::RawProps& rawProps,
                                   [[maybe_unused]] bool (*filterObjectKeys)(const std::string&)) {
#if defined(ANDROID) && defined(RN_SERIALIZABLE_STATE)
#if REACT_NATIVE_VERSION_MAJOR > 0 || REACT_NATIVE_VERSION_MINOR >= 87
  props.initializeDynamicProps(sourceProps, rawProps, filterObjectKeys);
#elif REACT_NATIVE_VERSION_MINOR >= 84
  if (facebook::react::ReactNativeFeatureFlags::enableExclusivePropsUpdateAndroid()) {
    props.initializeDynamicProps(sourceProps, rawProps, filterObjectKeys);
  }
#endif
#endif
}
} // namespace nitroui::compat
