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
