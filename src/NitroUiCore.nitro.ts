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
 * Counters from the intrinsic-sizing engine (`docs/architecture/sizing.md`).
 *
 * They answer the questions a sizing change can only be judged on: did a mount
 * cost a correction, how many, and how long a flush took. `nitroUiCore` is not
 * app API, so this is diagnostics rather than a public contract.
 */
export interface NitroUiSizingStats {
  /** Configurations with a measured size. */
  cachedSizes: number;
  /** How many times the environment was invalidated (starts at 1). */
  environmentEpoch: number;
  /** `measureContent` answers given, i.e. layout passes of sized nodes. */
  measurements: number;
  /** Reports queued for correction, and reports dropped as already matching. */
  reportsQueued: number;
  reportsDropped: number;
  /** Fabric state updates issued: inside the per-turn budget, and batched. */
  correctionsImmediate: number;
  correctionsBatched: number;
  /** Flushes that changed a size = frames skipped as stale. */
  flushes: number;
  staleFramesSkipped: number;
  /** Engine time of the last and worst flush, ms (excludes the re-layout). */
  lastFlushMs: number;
  maxFlushMs: number;
  /** Trace events dropped because the ring wrapped. */
  traceDropped: number;
}

/**
 * One entry of the sizing trace - the per-frame layout log. Only size *changes*
 * are recorded, so a control costs a handful of events, not one per layout pass.
 */
export interface NitroUiSizingTraceEvent {
  /** The view's `nuiSizingId`. */
  instanceId: number;
  /**
   * `'laidOut'` (the engine told Yoga this size), `'corrected'` (a correction
   * was pushed for it) or `'drew'` (the platform drew this box).
   */
  stage: string;
  /** Platform units: iOS points, Android dp. */
  width: number;
  height: number;
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

  /**
   * Sizing engine counters, taken as one snapshot (see `NitroUiSizingStats`).
   */
  sizingStats(): NitroUiSizingStats;

  /**
   * Put a measured size in the cache for one configuration, as if a control had
   * measured it: the cold/warm seam for tests and for a pre-warm that knows a
   * size ahead of time. Also adopts it as the component's cache-miss size.
   * A non-positive size is ignored.
   */
  seedSizingSize(
    componentName: string,
    sizingKey: string,
    width: number,
    height: number
  ): void;

  /**
   * Declare the environment changed (text size, density, locale): every cached
   * size is dropped, so controls measure again. Native hosts call this
   * themselves - this is the seam for tests and for environments native cannot
   * observe.
   */
  invalidateSizingEnvironment(): void;

  /**
   * Adopt a component's declared size as this environment's cached answer for its
   * default configuration, so the first instance mounted after this costs no
   * correction. Takes the component's Fabric name (`'NitroUiSwitch'`). Returns
   * how many of the names were pre-warmable - a component that declared no size
   * (not loaded, or not self-sizing) is not, and that is not an error.
   */
  prewarmSizing(componentNames: string[]): number;

  /**
   * Arm/disarm the sizing trace (disarmed by default), and take what was traced
   * since - arming clears the buffer, so a test arms, renders, then drains.
   */
  setSizingTraceEnabled(enabled: boolean): void;

  /** Every traced size change since arming (oldest first). */
  drainSizingTrace(): NitroUiSizingTraceEvent[];
}
