//
//  HybridNitroUiCore.hpp
//  react-native-nitro-ui
//
//  Implementation of the `NitroUiCore` HybridObject (spec: src/NitroUiCore.nitro.ts).
//

#pragma once

#if __has_include(<NitroModules/HybridObject.hpp>)
#include <NitroModules/HybridObject.hpp>
#else
#error NitroModules cannot be found! Are you sure you installed NitroModules properly?
#endif

#include "HybridNitroUiCoreSpec.hpp"

namespace margelo::nitro::nitroui {

  /**
   * Cross-platform core object. `now()` is implemented in C++ so that both
   * platforms share one monotonic time base: `std::chrono::steady_clock` is
   * `CLOCK_UPTIME_RAW` on Apple (same base as `CACurrentMediaTime()`) and
   * `CLOCK_MONOTONIC` on Android (same base as `System.nanoTime()`).
   */
  class HybridNitroUiCore: public HybridNitroUiCoreSpec {
    public:
      // Used by Nitro's autolinking (`createHybridObject('NitroUiCore')`).
      HybridNitroUiCore(): HybridObject(TAG) { }

      double now() override;
  };

} // namespace margelo::nitro::nitroui
