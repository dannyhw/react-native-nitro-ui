import { NitroModules } from 'react-native-nitro-modules';

import type { NitroUiCore, NitroUiPerfEvent } from './NitroUiCore.nitro';

let core: NitroUiCore | null = null;

/**
 * The native core object, created on first use.
 *
 * Lazily created on purpose: importing `react-native-nitro-ui` must not touch
 * native code before the app is up (and unit tests must be able to import the
 * package without a native runtime).
 */
function getCore(): NitroUiCore {
  if (core == null) {
    core = NitroModules.createHybridObject<NitroUiCore>('NitroUiCore');
  }
  return core;
}

/**
 * Access to the shared native core runtime.
 *
 * `now()` is the clock every measurement in this repo uses (DECISIONS D1:
 * `CLOCK_UPTIME_RAW` on Apple, `CLOCK_MONOTONIC` on Android - the same time base
 * as Choreographer frame times). The perf-mark methods feed the native hosts'
 * `propsApplied` / `firstFrame` events, which are off until `setPerfEnabled` and
 * are meant for benchmarks (T02 measures black box with `BenchProbe`).
 */
export const nitroUiCore: {
  now(): number;
  setPerfEnabled(enabled: boolean): void;
  drainPerf(): NitroUiPerfEvent[];
} = {
  now(): number {
    return getCore().now();
  },
  setPerfEnabled(enabled: boolean): void {
    getCore().setPerfEnabled(enabled);
  },
  drainPerf(): NitroUiPerfEvent[] {
    return getCore().drainPerf();
  },
};
