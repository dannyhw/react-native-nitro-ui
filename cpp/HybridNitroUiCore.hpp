// Implementation of the `NitroUiCore` HybridObject.

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
   * `now()` is implemented in C++ so that both platforms share one monotonic
   * time base: `CLOCK_UPTIME_RAW` on Apple (the base of `CACurrentMediaTime()`
   * and `CADisplayLink`) and `CLOCK_MONOTONIC` on Android (the base of
   * `System.nanoTime()` and `Choreographer` frame times).
   */
  class HybridNitroUiCore: public HybridNitroUiCoreSpec {
    public:
      // Used by Nitro's autolinking (`createHybridObject('NitroUiCore')`).
      HybridNitroUiCore(): HybridObject(TAG) { }

      double now() override;
      void setPerfEnabled(bool enabled) override;
      std::vector<NitroUiPerfEvent> drainPerf() override;

      NitroUiSizingStats sizingStats() override;
      // One process-global counter lives in the engine, so an id is unique across
      // components, JS runtimes and reloads.
      double nextSizingId() override;
      void seedSizingSize(const std::string& componentName, const std::string& sizingKey, double width,
                          double height) override;
      void invalidateSizingEnvironment() override;
      double prewarmSizing(const std::vector<std::string>& componentNames) override;
      void setSizingTraceEnabled(bool enabled) override;
      std::vector<NitroUiSizingTraceEvent> drainSizingTrace() override;

      /**
       * iOS asks UIKit on the main thread and settles later. A platform without
       * SF Symbols settles at once with nothing unresolved, so it looks nothing up.
       */
      std::shared_ptr<Promise<std::vector<std::string>>> unresolvedSystemImageNames(const std::vector<std::string>& names) override;
  };

} // namespace margelo::nitro::nitroui
