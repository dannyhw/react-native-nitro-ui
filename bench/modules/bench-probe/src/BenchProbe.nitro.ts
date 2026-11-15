import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Which thread to sample CPU time on: Hermes' thread or the platform UI thread.
 *
 * A string union, not an `enum`: this spec's iOS side is C++, and nitrogen's
 * C++ enums must be numeric.
 */
export type BenchThread = 'main' | 'js';

/**
 * Black-box timing probe for the benchmark app.
 *
 * Every timestamp is nanoseconds on one monotonic clock base, so timestamps
 * taken in JS, in native mount callbacks and in frame callbacks subtract
 * directly:
 *
 * - iOS: `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)`, the base of
 *   `CACurrentMediaTime()` and `CADisplayLink.timestamp`.
 * - Android: `System.nanoTime()`, the base of Choreographer's `frameTimeNanos`
 *   and of `FrameMetrics` timestamps; `elapsedRealtimeNanos()` is another base.
 *
 * Values are absolute, like `NitroUiCore.now()`, so a probe timestamp lines up
 * against the library's own perf marks in one trace.
 */
export interface BenchProbe extends HybridObject<{
  ios: 'c++';
  android: 'kotlin';
}> {
  /** Monotonic clock in nanoseconds, same base as `NitroUiCore.now()`. */
  now(): number;

  /**
   * Start capturing the next Fabric mounting transaction: when it was applied
   * natively, and the frame that presented it.
   *
   * Call this before triggering the change, then `awaitMount()` and
   * `awaitPresented()`. Both resolve from the native side: a JS polling loop
   * inside a timed region burns JS CPU for as long as the native mount takes.
   */
  armMountObserver(): void;

  /**
   * Timestamp of the most recent mount observed since `armMountObserver()`, or
   * `-1` when nothing has been observed. Debugging aid; prefer
   * {@link awaitMount}.
   */
  readonly lastMountNs: number;

  /**
   * Timestamp of the frame that presented that transaction, or `-1`.
   *
   * A frame stamp, not a duration. iOS takes it from a one-shot `CADisplayLink`
   * armed in the mount callback, Android from the window's frame metrics
   * (intended vsync plus total frame duration), so the two platforms are one
   * frame apart: compare arms, not platforms.
   */
  readonly lastPresentedNs: number;

  /**
   * Resolves with the mount timestamp of the armed transaction, `-1` on
   * timeout. Resolves immediately when the mount already happened.
   */
  awaitMount(timeoutMs: number): Promise<number>;

  /**
   * Resolves with the presenting frame timestamp of the armed transaction, `-1`
   * on timeout. Resolves immediately when the frame already passed.
   */
  awaitPresented(timeoutMs: number): Promise<number>;

  /**
   * Resolves when the next frame is presented after this call. For pacing
   * only: the measured `presented` number comes from {@link awaitPresented}.
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
   * Allocated native heap in bytes (`Debug.getNativeHeapAllocatedSize()`), `-1`
   * on iOS - `phys_footprint` already accounts for it there.
   */
  nativeHeapBytes(): number;

  /**
   * Used Java heap in bytes (`totalMemory - freeMemory`), `-1` on iOS.
   */
  javaHeapBytes(): number;

  /**
   * Ask the runtime to collect, then settle. No-op on iOS, which has no
   * synchronous collect.
   */
  gc(): void;

  /**
   * The plan string this process was launched with, or `""`: the value after
   * a `-benchPlan` launch argument on iOS, the `benchPlan` extra of the
   * launching Intent on Android.
   */
  launchPlan(): string;

  /**
   * Overwrite the run's NDJSON results file and return its path.
   *
   * iOS writes into the app container's `Documents/`. Android writes into the
   * app's external files dir, because `adb exec-out run-as` only works for
   * debuggable builds and the bench app is a release build.
   */
  writeNdjson(contents: string): string;

  /** Start an os_signpost / Perfetto async section for white-box diagnosis. */
  begin(name: string, id: number): void;

  /** End the section started by `begin(name, id)`. */
  end(name: string, id: number): void;
}
