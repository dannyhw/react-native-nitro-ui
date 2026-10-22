//
//  HybridNitroUiCore.cpp
//  react-native-nitro-ui
//

#include "HybridNitroUiCore.hpp"

#include <chrono>

namespace margelo::nitro::nitroui {

  double HybridNitroUiCore::now() {
    const auto sinceEpoch = std::chrono::steady_clock::now().time_since_epoch();
    // Nanosecond precision, reported in milliseconds (docs: src/NitroUiCore.nitro.ts).
    return std::chrono::duration<double, std::milli>(sinceEpoch).count();
  }

} // namespace margelo::nitro::nitroui
