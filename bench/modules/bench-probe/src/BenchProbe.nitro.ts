import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Which thread to sample CPU time on.
 *
 * The JS thread is Hermes' thread on both platforms; `main` is the platform UI
 * thread (UIKit main thread / Android main thread, which runs Choreographer).
 * A string union (not an `enum`) because this spec's iOS side is C++ and
 * nitrogen C++ enums must be numeric.
 */
export type BenchThread = 'main' | 'js';

/**
 * Black-box timing probe for the benchmark app.
 *
 * Every timestamp is nanoseconds on ONE monotonic clock base, so that
 * timestamps taken in JS, in native mount callbacks and in frame callbacks are
 * directly subtractable:
 *
 * - iOS: `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` (same base as
 *   `CACurrentMediaTime()`, so a `CADisplayLink.targetTimestamp` converts by
 *   `* 1e9`).
 * - Android: `System.nanoTime()` (same base as Choreographer's
 *   `frameTimeNanos`, which is why `elapsedRealtimeNanos()` is NOT used).
 *
 * This mirrors `NitroUiCore.now()`'s base (docs/DECISIONS.md D1); the core
 * reports milliseconds, this probe reports nanoseconds.
 *
 * iOS is implemented in ObjC++ (`c++`) rather than Swift on purpose - see
 * docs/architecture/benchmarks.md "Why the probe is ObjC++ on iOS".
 */
export interface BenchProbe extends HybridObject<{
  ios: 'c++';
  android: 'kotlin';
}> {
  /** Monotonic clock in nanoseconds. Only deltas are meaningful. */
  now(): number;

  /**
   * Start listening for the next Fabric mount of the app's root tag.
   * Call before triggering the mount, then read `lastMountNs` after it.
   */
  armMountObserver(): void;

  /**
   * Timestamp of the most recent mount observed since `armMountObserver()`,
   * or `-1` when nothing has been observed yet.
   */
  readonly lastMountNs: number;

  /**
   * Resolves with the `targetTimestamp`/`frameTimeNanos` of the next frame
   * that is presented *after* this call, in the same clock base as `now()`.
   */
  nextFrameNs(): Promise<number>;

  /** CPU time (not wall clock) consumed by one thread, in nanoseconds. */
  threadCpuNs(thread: BenchThread): number;

  /**
   * Physical memory attributed to the process in bytes
   * (`phys_footprint` on iOS, `Total PSS` on Android).
   * Slow on Android - call it outside timed regions.
   */
  footprintBytes(): number;

  /**
   * Ask the runtime to collect, then settle. No-op on iOS (there is no
   * synchronous Swift/ObjC collect and ARC is not a heap to settle).
   */
  gc(): void;

  /**
   * The plan string this process was launched with, or `""`.
   *
   * iOS reads `NSProcessInfo.processInfo.arguments` for a `-benchPlan <value>`
   * pair; Android reads the `benchPlan` extra of the launching Intent. Both are
   * how the runner drives an unattended release build with no Metro involved.
   */
  launchPlan(): string;

  /**
   * Overwrite the run's NDJSON results file and return its path.
   *
   * iOS writes into the app container's `Documents/` (pulled with
   * `xcrun simctl get_app_container`). Android writes into the app's *external*
   * files dir, because `adb exec-out run-as` only works for debuggable builds
   * and the bench app is a release build.
   */
  writeNdjson(contents: string): string;

  /** Start an os_signpost / Perfetto async section for white-box diagnosis. */
  begin(name: string, id: number): void;

  /** End the section started by `begin(name, id)`. */
  end(name: string, id: number): void;
}
