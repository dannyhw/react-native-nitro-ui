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
 *   `CACurrentMediaTime()` and `CADisplayLink.timestamp`).
 * - Android: `System.nanoTime()` (same base as Choreographer's `frameTimeNanos`
 *   and of `FrameMetrics` timestamps, which is why `elapsedRealtimeNanos()` is
 *   NOT used).
 *
 * Values are **absolute**, exactly like `NitroUiCore.now()` (docs/DECISIONS.md
 * D1), so a probe timestamp can be lined up against the library's own perf marks
 * in one trace. There is deliberately no process-load offset: `CLOCK_UPTIME_RAW`
 * only passes 2^53 ns after roughly 104 days of awake uptime, and at 1e15 the
 * ULP of a `double` is 0.125 ns, so nothing is quantised away.
 *
 * iOS is implemented in ObjC++ (`c++`) rather than Swift on purpose - see
 * docs/architecture/benchmarks.md "Why the probe is ObjC++ on iOS".
 */
export interface BenchProbe extends HybridObject<{
  ios: 'c++';
  android: 'kotlin';
}> {
  /** Monotonic clock in nanoseconds, same base as `NitroUiCore.now()` (D1). */
  now(): number;

  /**
   * Start capturing the next Fabric mounting transaction: when it was applied
   * natively, and the frame that presented it.
   *
   * Call this **before** triggering the change, then `awaitMount()` and
   * `awaitPresented()`. Both resolve from the native side, so no JS polling loop
   * sits inside a timed region - a `setTimeout(0)` poll burns JS CPU for as long
   * as the native mount takes, which made a slow mount look like slow JS.
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
   * Captured natively in the same turn as the mount (iOS: a one-shot
   * `CADisplayLink` armed inside the mount callback; Android: the activity
   * window's `OnFrameMetricsAvailableListener`, reporting intended vsync plus
   * total frame duration). It is a *frame stamp*, not a duration, and its
   * semantics are one frame apart between platforms - compare arms, not
   * platforms.
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
   * Resolves when the next frame is presented after this call.
   *
   * Pacing only ("let two frames pass between iterations"). The measured
   * `presented` number comes from {@link awaitPresented}, which is armed at the
   * mount instead of after a JS round trip.
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
   *
   * PSS includes the Hermes heap, so without a breakdown the Expo arms can read
   * below `rn-core` for reasons that have nothing to do with views.
   */
  javaHeapBytes(): number;

  /**
   * Ask the runtime to collect, then settle. No-op on iOS (no synchronous
   * Swift/ObjC collect, and ARC is not a heap to settle); the JS side also calls
   * `globalThis.gc?.()` so Hermes collects when the build exposes it.
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
