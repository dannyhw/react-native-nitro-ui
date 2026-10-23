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

      // Sizing diagnostics (docs/architecture/sizing.md). The engine is C++-only
      // state, so these are thin translations - which is also why they live on the
      // core object instead of getting their own HybridObject: one seam between
      // JS and the engine is easier to keep honest than two.
      NitroUiSizingStats sizingStats() override;
      // One process-global counter lives in the engine, so an id is unique across
      // components, JS runtimes and reloads (review S4).
      double nextSizingId() override;
      void seedSizingSize(const std::string& componentName, const std::string& sizingKey, double width,
                          double height) override;
      void invalidateSizingEnvironment() override;
      double prewarmSizing(const std::vector<std::string>& componentNames) override;
      void setSizingTraceEnabled(bool enabled) override;
      std::vector<NitroUiSizingTraceEvent> drainSizingTrace() override;
  };

} // namespace margelo::nitro::nitroui
