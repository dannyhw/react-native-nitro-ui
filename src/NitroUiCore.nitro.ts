import type { HybridObject } from 'react-native-nitro-modules';

/** One performance mark recorded by a native view. */
export interface NitroUiPerfEvent {
  /** The view's `nuiPerfId`, or `-1` when the view did not set one. */
  instanceId: number;
  /** `'propsApplied'`, `'firstFrame'`, `'dropped'` or `'recycled'`. */
  kind: string;
  /** Timestamp in the same time base as `now()`. */
  time: number;
}

/**
 * Counters from the engine that sizes controls to their content. Diagnostics,
 * not a stable contract.
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
  /**
   * Reports that confirmed the size the instance was already laid out with, so
   * they needed nothing: the pre-warmed case, and the case where the environment
   * moved and this control's size did not.
   */
  reportsConfirmed: number;
  /** Fabric state updates issued: inside the per-turn budget, and batched. */
  correctionsImmediate: number;
  correctionsBatched: number;
  /** Flushes that ran at all. */
  flushes: number;
  /**
   * Flushes that changed a size. On Android this is also the number of frames
   * skipped as stale.
   */
  changedFlushes: number;
  /** Engine time of the last and worst flush, ms (excludes the re-layout). */
  lastFlushMs: number;
  maxFlushMs: number;
  /** Trace events dropped because the ring wrapped. */
  traceDropped: number;
  /**
   * Live engine bookkeeping: one entry per instance the engine knows about.
   * Mount/unmount churn must keep these flat - a scrolling list must not grow
   * the engine for the life of the process.
   */
  ledgerEntries: number;
  registryEntries: number;
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
 * The core native object of `react-native-nitro-ui`: the shared clock, the
 * performance marks and the sizing diagnostics.
 *
 * `now()` reads the clock each platform's display uses: `CLOCK_UPTIME_RAW` on
 * Apple (the base of `CACurrentMediaTime()` and `CADisplayLink`) and
 * `CLOCK_MONOTONIC` on Android (the base of `System.nanoTime()` and Choreographer
 * frame times). Every performance mark uses the same base.
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

  /** Turn native performance marks on or off. Off by default. */
  setPerfEnabled(enabled: boolean): void;

  /**
   * Take every mark recorded since the last call (oldest first) and clear the
   * buffer. Marks are stored in a fixed-size ring, so a long run without a drain
   * drops the oldest events instead of growing.
   */
  drainPerf(): NitroUiPerfEvent[];

  /** Sizing engine counters, taken as one snapshot. */
  sizingStats(): NitroUiSizingStats;

  /**
   * Next instance id for the sizing engine. One process-global counter, so ids
   * are unique across components, across JS runtimes in the process, and across
   * a JS reload - the engine keys its ledger by id alone, so a collision would
   * send a correction to the wrong view.
   */
  nextSizingId(): number;

  /**
   * Put a measured size in the cache for one configuration, as if a control had
   * measured it: the cold/warm seam for tests and for a pre-warm that knows a
   * size ahead of time. The entry is provisional: it is used as the first guess,
   * and the first control that really measures that configuration replaces it.
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
   * size is dropped and every mounted instance is asked to measure again. Native
   * calls this itself when it observes a change; this is for tests and for
   * changes native cannot observe.
   */
  invalidateSizingEnvironment(): void;

  /**
   * Adopt a component's declared size as this environment's cached answer for its
   * default configuration, so the first instance mounted after this is laid out
   * at the declared size and, if that size is right, costs no correction. Takes
   * the component's Fabric name (`'NitroUiSwitch'`). The entry is provisional: a
   * control whose real size differs corrects it like a cold mount would. Returns
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

  /**
   * Of the SF Symbol names given, the ones this device cannot draw.
   *
   * A development-time question the app cannot answer for itself: whether a name
   * draws depends on the iOS version of the running device, so a symbol that
   * exists on the simulator can be missing on an older phone. iOS only - other
   * platforms have no SF Symbols to look up and answer with an empty list. The
   * lookup happens off the calling thread; the returned promise settles when it
   * is done. An empty input resolves without any lookup.
   */
  unresolvedSystemImageNames(names: string[]): Promise<string[]>;
}
