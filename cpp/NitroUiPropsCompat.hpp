#pragma once
// Workaround for margelo/nitro#1656 until react-native-nitro-modules >= 0.37.2 is the floor.
// Mirrors upstream RawPropsCompat::initializeDynamicProps (margelo/nitro#1749): from React
// Native 0.87 on, Android always takes the dynamic-props path, so the call is unconditional.
#include <react/renderer/core/Props.h>
#include <react/renderer/core/RawProps.h>
#ifdef ANDROID
#include <cxxreact/ReactNativeVersion.h>
static_assert(REACT_NATIVE_VERSION_MAJOR > 0 || REACT_NATIVE_VERSION_MINOR >= 88,
              "react-native-nitro-ui needs React Native 0.88 or newer");
#endif

namespace nitroui::compat {
inline void initializeDynamicProps([[maybe_unused]] facebook::react::Props& props,
                                   [[maybe_unused]] const facebook::react::Props& sourceProps,
                                   [[maybe_unused]] const facebook::react::RawProps& rawProps,
                                   [[maybe_unused]] bool (*filterObjectKeys)(const std::string&)) {
#if defined(ANDROID) && defined(RN_SERIALIZABLE_STATE)
  props.initializeDynamicProps(sourceProps, rawProps, filterObjectKeys);
#endif
}
} // namespace nitroui::compat
