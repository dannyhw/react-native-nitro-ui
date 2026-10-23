import type { ComponentType } from 'react';

/**
 * Every implementation the registry can measure.
 *
 * The Switch arms keep their original bare names; a Button arm is the same name
 * with a `-button` suffix, because the name *is* the launch-plan token and the
 * results-cell key (bench/src/implementations/index.ts "The component
 * dimension"). Each suffix set has its own `rn-core` control.
 */
export type ImplementationName =
  | 'rn-core'
  | 'expo-ui-host-per-control'
  | 'expo-ui-shared-host'
  | 'nitro-ui'
  | 'rn-core-button'
  | 'expo-ui-host-per-control-button'
  | 'expo-ui-shared-host-button'
  | 'nitro-ui-button';

export type ScenarioName = 'mount' | 'update' | 'memory' | 'leak';

/**
 * A control set the harness can mount, update and unmount.
 *
 * `List` must render exactly `n` controls and must be safe to re-render with a
 * new `n` without remounting the wrapper (that is what makes `mount` measure
 * mounting `n` controls rather than remounting a subtree).
 */
export interface BenchImplementation {
  name: ImplementationName;
  /**
   * `false` means the component is not exported by the library yet, so the
   * runner skips it and says why instead of reporting a number nobody asked for.
   */
  available: boolean;
  skipReason: string | null;
  List: ComponentType<BenchListProps>;
  /**
   * Turn on this runtime's *own* native perf marks, for a diagnostic run
   * (`bun bench --perf-marks`). Only `nitro-ui` has any: the library records
   * `propsApplied` / `firstFrame` per view when the view passes `nuiPerfId` and
   * `nitroUiCore.setPerfEnabled(true)` was called.
   *
   * Recording is a mutex-guarded ring write per mark and the drain is JS work,
   * so these exist for `--perf-marks` launches only - a measured run must not
   * call them, or the arm would pay for instrumentation no other arm pays.
   */
  enablePerfMarks: (() => void) | null;
  /**
   * Take every mark recorded since the last call (oldest first), in the probe's
   * nanosecond base (D1), or `null` when this runtime has no marks to give.
   */
  drainPerfMarks: (() => BenchPerfMark[] | null) | null;
}

export interface BenchListProps {
  /** Number of controls to render. `0` renders nothing. */
  n: number;
  /** The controlled value flipped by the `update` scenario. */
  value: boolean;
  /**
   * Whether this launch wants native perf marks (`--perf-marks`). Only the
   * `nitro-ui` arm reads it: it tags instances with `nuiPerfId` so the library
   * records marks for them. `false` keeps the arm byte-identical in cost to the
   * reference arms.
   */
  perfMarks: boolean;
}

/**
 * One native perf mark from the runtime under test, already converted to the
 * probe's nanosecond base so it lines up with `t0` (D1).
 */
export interface BenchPerfMark {
  /** The library's instance id (`nuiPerfId`). */
  instanceId: number;
  /** `'propsApplied'` (props landed on the UI thread) or `'firstFrame'`. */
  kind: string;
  /** Absolute timestamp, same base as `probe.now()`. */
  timeNs: number;
}

export interface BenchPlan {
  scenario: ScenarioName;
  implementation: ImplementationName;
  n: number;
  /**
   * `true` when the launch argument asked for native perf marks
   * (`scenario:implementation:N:marks`). Diagnostic only: it is not part of a
   * results cell key.
   */
  perfMarks: boolean;
}

/** One line of the NDJSON a launch writes. */
export type BenchRecord =
  | {
      kind: 'meta';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      warmup: number;
      measured: number;
      /** Platform/os summary, so a results file is self-describing. */
      platform: string;
      probeClock: 'CLOCK_UPTIME_RAW' | 'System.nanoTime';
    }
  | {
      kind: 'iter';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      index: number;
      warmup: boolean;
      /** null when the native signal never arrived. */
      jsCommitNs: number | null;
      mountedNs: number | null;
      presentedNs: number | null;
    }
  | {
      kind: 'cpu';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      /**
       * Which part of the iteration the bracket covered. `mount` is the commit
       * plus the native mount only; `unmount` is the teardown that follows it.
       * They used to share one bracket, so "UI CPU/op" was really the cost of a
       * mount+teardown cycle (T02 review S5).
       */
      phase: 'mount' | 'unmount';
      iterations: number;
      /** CPU (not wall-clock) ns over the measured batch, divided later by `iterations`. */
      jsCpuNs: number | null;
      mainCpuNs: number | null;
    }
  | {
      /**
       * Written last, so a reader can tell a complete file from a partial one.
       */
      kind: 'end';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      recordCount: number;
    }
  | {
      /**
       * The runtime's own native perf marks for one measured iteration, drained
       * between iterations (outside every CPU bracket) so the drain cannot
       * inflate a CPU metric. Emitted only by `--perf-marks` launches, reported
       * and never gated: this explains a `UI CPU/op` number, it is not a verdict.
       */
      kind: 'perf';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      index: number;
      /** `propsApplied` marks (props landed on the UI thread) seen meanwhile. */
      propsApplied: number;
      /** `firstFrame` marks (the hosted content drew) seen meanwhile. */
      firstFrame: number;
      /** Distinct instance ids that reported anything. Expect `n`. */
      instances: number;
      /** Latest `propsApplied` after the iteration's `t0`; null when none. */
      propsAppliedNs: number | null;
      /** Latest `firstFrame` after the iteration's `t0`; null when none. */
      firstFrameNs: number | null;
      /** `firstFrame` minus `propsApplied` for the last instance to report. */
      drawLatencyNs: number | null;
    }
  | {
      kind: 'skip';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      reason: string;
    }
  | {
      kind: 'mem';
      scenario: ScenarioName;
      implementation: ImplementationName;
      n: number;
      launch: number;
      /** `empty` | `full` | `leak0` ... `leakN` */
      phase: string;
      footprintBytes: number | null;
      /**
       * Whether a JS garbage collector was reachable before this sample.
       * Footprint includes the Hermes heap, so a sample without a collect is a
       * sample of whatever the GC happened to leave behind.
       */
      heapCollected: boolean;
      /** Android only: allocated native heap, or null. */
      nativeHeapBytes: number | null;
      /** Android only: used Java heap, or null. */
      javaHeapBytes: number | null;
    };
