//
//  HybridBenchProbe.hpp
//  nitro-bench-probe
//
//  iOS implementation of the `BenchProbe` HybridObject (spec:
//  src/BenchProbe.nitro.ts).
//
//  This is deliberately ObjC++ rather than Swift: it needs Mach/task APIs and
//  a guarded Objective-C runtime hook, both of which are direct C calls here.
//  See docs/architecture/benchmarks.md ("Why the probe is ObjC++ on iOS").
//

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
   * All returned timestamps are nanoseconds relative to process load, on
   * `CLOCK_UPTIME_RAW`. Relative (instead of absolute) because an absolute
   * `CLOCK_UPTIME_RAW` value is ~1e17 ns on a long-running machine, which is
   * past the exact-integer range of a `double` and would quantise every
   * measurement to ~16 ns.
   */
  class HybridBenchProbe: public HybridBenchProbeSpec {
    public:
      // Used by Nitro's autolinking (`createHybridObject('BenchProbe')`).
      HybridBenchProbe(): HybridObject(TAG) { }

      double getLastMountNs() override;

      double now() override;
      void armMountObserver() override;
      std::shared_ptr<Promise<double>> nextFrameNs() override;
      double threadCpuNs(BenchThread thread) override;
      double footprintBytes() override;
      void gc() override;
      std::string launchPlan() override;
      std::string writeNdjson(const std::string& contents) override;
      void begin(const std::string& name, double id) override;
      void end(const std::string& name, double id) override;
  };

} // namespace margelo::nitro::benchprobe
