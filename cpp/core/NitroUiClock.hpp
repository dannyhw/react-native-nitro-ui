//
//  NitroUiClock.hpp
//  react-native-nitro-ui
//
//  The library's single monotonic time base (docs/DECISIONS.md D1), shared by
//  `nitroUiCore.now()`, the perf marks, and the frame clocks of both platforms:
//
//  - Apple: `CLOCK_UPTIME_RAW` - the base of `CACurrentMediaTime()`,
//    `CADisplayLink.timestamp` / `.targetTimestamp` and
//    `NSProcessInfo.systemUptime`.
//  - Android: `CLOCK_MONOTONIC` - the base of `System.nanoTime()`,
//    `Choreographer` frame times and `uptimeMillis`.
//
//  `std::chrono::steady_clock` is deliberately NOT used: on Apple it is
//  `CLOCK_MONOTONIC_RAW`, which keeps counting while the device sleeps, so it
//  drifts away from the display-link base by the total sleep time (tens of
//  thousands of seconds on a laptop or a phone that has been through the
//  overnight). A benchmark comparing our marks with frame timestamps would then
//  measure the machine's sleep history, not a latency.
//

#pragma once

#include <cstdint>

#if defined(__APPLE__)
#include <time.h>
#else
#include <ctime>
#endif

namespace margelo::nitro::nitroui {

  class NitroUiClock final {
    public:
      /// Nanoseconds in the D1 base (DECISIONS D1). Never wall time, never
      /// affected by the user changing the clock.
      static inline int64_t nowNs() {
#if defined(__APPLE__)
        return static_cast<int64_t>(clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
#else
        struct timespec now{};
        clock_gettime(CLOCK_MONOTONIC, &now);
        return static_cast<int64_t>(now.tv_sec) * 1000000000LL +
               static_cast<int64_t>(now.tv_nsec);
#endif
      }

      /// Milliseconds in the same base, as handed to JS.
      static inline double nowMs() {
        return static_cast<double>(nowNs()) / 1000000.0;
      }

      NitroUiClock() = delete;
  };

} // namespace margelo::nitro::nitroui
