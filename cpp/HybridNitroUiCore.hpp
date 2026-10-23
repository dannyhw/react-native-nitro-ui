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

#include <string>
#include <vector>

namespace margelo::nitro::nitroui {

  /**
   * Cross-platform core object. `now()` is implemented in C++ so that both
   * platforms share one monotonic time base (DECISIONS D1):
   * `CLOCK_UPTIME_RAW` on Apple (the base of `CACurrentMediaTime()`,
   * `CADisplayLink` and `NSProcessInfo.systemUptime`) and `CLOCK_MONOTONIC` on
   * Android (the base of `System.nanoTime()` and `Choreographer` frame times).
   * See `cpp/core/NitroUiClock.hpp` for why this is not `steady_clock`.
   */
  class HybridNitroUiCore: public HybridNitroUiCoreSpec {
    public:
      // Used by Nitro's autolinking (`createHybridObject('NitroUiCore')`).
      HybridNitroUiCore(): HybridObject(TAG) { }

      double now() override;
      void setPerfEnabled(bool enabled) override;
      std::vector<NitroUiPerfEvent> drainPerf() override;
  };

} // namespace margelo::nitro::nitroui
