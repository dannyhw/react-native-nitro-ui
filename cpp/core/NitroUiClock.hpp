// The library's one monotonic time base: the clock behind CADisplayLink timestamps on Apple and
// Choreographer frame times on Android, so marks compare directly with frame times.

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
      // Not `std::chrono::steady_clock`: on Apple that keeps counting while the device sleeps, so
      // it drifts from the display-link clock by the total sleep time.
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

      static inline double nowMs() {
        return static_cast<double>(nowNs()) / 1000000.0;
      }

      NitroUiClock() = delete;
  };

} // namespace margelo::nitro::nitroui
