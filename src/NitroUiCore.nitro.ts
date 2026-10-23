import type { HybridObject } from 'react-native-nitro-modules';

/**
 * One perf mark recorded by a native host (see `docs/architecture/core.md`).
 */
export interface NitroUiPerfEvent {
  /** The view's `nuiPerfId`, or `-1` when the view did not set one. */
  instanceId: number;
  /** `'propsApplied'` or `'firstFrame'`. */
  kind: string;
  /** Timestamp in the same time base as `now()`. */
  time: number;
}

/**
 * The internal core object of `react-native-nitro-ui`.
 *
 * Implemented once in C++ (`cpp/HybridNitroUiCore.cpp`) so both platforms read
 * the same monotonic clock, and it is not `std::chrono::steady_clock` - on Apple
 * that is `CLOCK_MONOTONIC_RAW`, which keeps counting through sleep and so drifts
 * away from the display clock. `cpp/core/NitroUiClock.hpp` reads
 * `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` on Apple (the base of
 * `CACurrentMediaTime()`, `CADisplayLink` and `systemUptime`) and
 * `clock_gettime(CLOCK_MONOTONIC)` on Android (the base of `System.nanoTime()`
 * and Choreographer frame times), which is also the base every perf mark uses.
 *
 * Not part of the public API surface beyond what `src/index.ts` re-exports.
 */
export interface NitroUiCore extends HybridObject<{
  ios: 'c++';
  android: 'c++';
}> {
  /**
   * Monotonic clock in milliseconds with nanosecond resolution.
   * Only deltas are meaningful; the absolute origin is platform-defined.
   */
  now(): number;

  /**
   * Turn native perf marks on/off (off by default). While it is off, a host only
   * pays one relaxed atomic load per mark.
   */
  setPerfEnabled(enabled: boolean): void;

  /**
   * Take every mark recorded since the last call (oldest first) and clear the
   * buffer. Marks are stored in a fixed-size ring, so a long run without a drain
   * drops the oldest events instead of growing.
   */
  drainPerf(): NitroUiPerfEvent[];
}
