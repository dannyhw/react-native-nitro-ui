import type { ComponentType } from 'react';

/** Every implementation the registry can measure. */
export type ImplementationName =
  'rn-core' | 'expo-ui-host-per-control' | 'expo-ui-shared-host' | 'nitro-ui';

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
}

export interface BenchListProps {
  /** Number of controls to render. `0` renders nothing. */
  n: number;
  /** The controlled value flipped by the `update` scenario. */
  value: boolean;
}

export interface BenchPlan {
  scenario: ScenarioName;
  implementation: ImplementationName;
  n: number;
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
