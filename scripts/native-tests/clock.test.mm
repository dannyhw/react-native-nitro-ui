//
//  clock.test.mm
//
//  Host-side unit test for the shared clock and perf ring (DECISIONS D1).
//  Run by `bun run test:native` (scripts/native-tests.sh) on the dev machine /
//  CI's macOS runner - it compiles the shipping headers directly, so it tests
//  the same code the app does.
//
//  The point of this test is the bug T10's review found: `steady_clock` on Apple
//  is `CLOCK_MONOTONIC_RAW`, which keeps counting during sleep, so marks built on
//  it are tens of thousands of seconds away from `CADisplayLink` timestamps.
//  The checks below are the ones that fail if someone goes back to it.
//

#include "core/NitroUiClock.hpp"
#include "core/NitroUiPerf.hpp"

#import <Foundation/Foundation.h>
#import <QuartzCore/CABase.h>  // CACurrentMediaTime()

#include <cstdio>
#include <string>

#if defined(__APPLE__)
#include <time.h>
#endif

using margelo::nitro::nitroui::NitroUiClock;
using margelo::nitro::nitroui::NitroUiPerf;

namespace {

  int failures = 0;

  void check(bool condition, const std::string& what) {
    if (condition) {
      std::printf("  ok    %s\n", what.c_str());
    } else {
      std::printf("  FAIL  %s\n", what.c_str());
      failures += 1;
    }
  }

  void checkNear(int64_t actual, int64_t expected, int64_t toleranceNs, const std::string& what) {
    const int64_t delta = actual > expected ? actual - expected : expected - actual;
    const std::string label = what + " (off by " + std::to_string(delta / 1000) + " us)";
    check(delta <= toleranceNs, label);
  }

} // namespace

int main() {
  std::printf("NitroUiClock\n");

  const int64_t ours = NitroUiClock::nowNs();
  const double caCurrent = CACurrentMediaTime();  // the base CADisplayLink uses
  checkNear(ours, static_cast<int64_t>(caCurrent * 1e9), 5000000,
            "nowNs() matches CACurrentMediaTime() (CADisplayLink base)");
  checkNear(ours, static_cast<int64_t>(NSProcessInfo.processInfo.systemUptime * 1e9), 5000000,
            "nowNs() matches NSProcessInfo.systemUptime");

#if defined(__APPLE__)
  checkNear(ours, static_cast<int64_t>(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)), 1000000,
            "nowNs() is CLOCK_UPTIME_RAW");
  const int64_t raw = static_cast<int64_t>(clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW));
  check(ours <= raw, "nowNs() is not CLOCK_MONOTONIC_RAW (= steady_clock on Apple)");
  std::printf("        sleep gap vs CLOCK_MONOTONIC_RAW: %.1f h\n",
              static_cast<double>(raw - ours) / 3.6e12);
#else
  timespec monotonic{};
  clock_gettime(CLOCK_MONOTONIC, &monotonic);
  checkNear(ours, static_cast<int64_t>(monotonic.tv_sec) * 1000000000LL + monotonic.tv_nsec, 1000000,
            "nowNs() is CLOCK_MONOTONIC");
#endif

  const int64_t before = NitroUiClock::nowNs();
  const int64_t after = NitroUiClock::nowNs();
  check(after >= before, "nowNs() is monotonic");
  check(NitroUiClock::nowMs() * 1e6 <= NitroUiClock::nowNs() + 1, "nowMs() is the same base");

  std::printf("NitroUiPerf\n");

  NitroUiPerf::setEnabled(false);
  NitroUiPerf::markAt(1, NitroUiPerf::KIND_PROPS_APPLIED, 10);
  check(NitroUiPerf::drain().empty(), "a disabled ring records nothing");

  NitroUiPerf::setEnabled(true);
  NitroUiPerf::markAt(3, NitroUiPerf::KIND_PROPS_APPLIED, 100);
  NitroUiPerf::markAt(4, NitroUiPerf::KIND_FIRST_FRAME, 200);
  NitroUiPerf::markAt(3, NitroUiPerf::KIND_FIRST_FRAME, 300);
  const auto marks = NitroUiPerf::drain();
  check(marks.size() == 3, "drain() returns every mark");
  check(!marks.empty() && marks[0].instanceId == 3 && marks[0].timeNs == 100,
        "drain() is oldest first");
  check(!marks.empty() && marks.back().instanceId == 3 && marks.back().kind == NitroUiPerf::KIND_FIRST_FRAME,
        "marks keep instanceId and kind");
  check(NitroUiPerf::drain().empty(), "drain() clears the ring");

  const int64_t marked = NitroUiClock::nowNs();
  NitroUiPerf::mark(5, NitroUiPerf::KIND_PROPS_APPLIED);
  const auto timed = NitroUiPerf::drain();
  check(!timed.empty() && timed[0].timeNs >= marked && timed[0].timeNs <= NitroUiClock::nowNs(),
        "mark() timestamps with the same clock as nowNs()");

  for (size_t i = 0; i < NitroUiPerf::CAPACITY + 500; i += 1) {
    NitroUiPerf::markAt(static_cast<int32_t>(i), NitroUiPerf::KIND_PROPS_APPLIED,
                        static_cast<int64_t>(i));
  }
  const auto wrapped = NitroUiPerf::drain();
  check(wrapped.size() == NitroUiPerf::CAPACITY, "the ring keeps at most CAPACITY marks");
  check(!wrapped.empty() && wrapped.front().timeNs == 500 && wrapped.back().timeNs == static_cast<int64_t>(NitroUiPerf::CAPACITY + 499),
        "a wrapped ring drops the oldest and stays ordered");
  NitroUiPerf::setEnabled(false);

  if (failures > 0) {
    std::printf("FAILED: %d check(s)\n", failures);
    return 1;
  }
  std::printf("clock.test: all checks passed\n");
  return 0;
}
