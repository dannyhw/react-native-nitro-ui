import type { HybridObject } from 'react-native-nitro-modules';

/**
 * The internal core object of `react-native-nitro-ui`.
 *
 * Implemented once in C++ (`cpp/HybridNitroUiCore.cpp`) so both platforms read
 * the same monotonic clock: `std::chrono::steady_clock` maps to
 * `CLOCK_UPTIME_RAW` on Apple (same time base as `CACurrentMediaTime()`) and to
 * `CLOCK_MONOTONIC` on Android (same time base as `System.nanoTime()`).
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
}
