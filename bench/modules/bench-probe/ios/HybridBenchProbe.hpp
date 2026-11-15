// iOS implementation of the `BenchProbe` HybridObject. ObjC++ rather than Swift:
// it needs Mach task APIs and an Objective-C runtime hook, both direct C calls.

#pragma once

#if __has_include(<NitroModules/HybridObject.hpp>)
#include <NitroModules/HybridObject.hpp>
#else
#error NitroModules cannot be found! Are you sure you installed NitroModules properly?
#endif

#include "HybridBenchProbeSpec.hpp"

#include <memory>
#include <string>

namespace margelo::nitro::benchprobe {

  /**
   * Timestamps are absolute nanoseconds on `CLOCK_UPTIME_RAW`, the same clock
   * base as `NitroUiCore.now()`, so a probe stamp and a library perf mark can
   * be lined up in one trace. A `double` holds them exactly: the clock only
   * passes 2^53 ns after ~104 days of awake uptime.
   */
  class HybridBenchProbe: public HybridBenchProbeSpec {
    public:
      // Used by Nitro's autolinking (`createHybridObject('BenchProbe')`).
      HybridBenchProbe(): HybridObject(TAG) { }

      double getLastMountNs() override;
      double getLastPresentedNs() override;

      double now() override;
      void armMountObserver() override;
      std::shared_ptr<Promise<double>> awaitMount(double timeoutMs) override;
      std::shared_ptr<Promise<double>> awaitPresented(double timeoutMs) override;
      std::shared_ptr<Promise<double>> nextFrameNs() override;
      double threadCpuNs(BenchThread thread) override;
      double footprintBytes() override;
      double nativeHeapBytes() override;
      double javaHeapBytes() override;
      void gc() override;
      std::string launchPlan() override;
      std::string writeNdjson(const std::string& contents) override;
      void begin(const std::string& name, double id) override;
      void end(const std::string& name, double id) override;
  };

} // namespace margelo::nitro::benchprobe
