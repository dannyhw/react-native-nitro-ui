import { NitroModules } from 'react-native-nitro-modules';

import type {
  NitroUiCore,
  NitroUiPerfEvent,
  NitroUiSizingStats,
  NitroUiSizingTraceEvent,
} from './NitroUiCore.nitro';

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
 *
 * The sizing methods are the seam `docs/architecture/sizing.md` describes for
 * tests and diagnostics: `sizingStats()` counts corrections and flush times,
 * `setSizingTraceEnabled`/`drainSizingTrace` log every size a node was laid out
 * with, `invalidateSizingEnvironment`/`seedSizingSize` force a cold or warm
 * cache, and `prewarmSizing` adopts a component's declared size as this
 * environment's cached answer. None of them is app API except pre-warming, which
 * an app may want at startup: that is `prewarm`, exported on its own.
 */
export const nitroUiCore: {
  now(): number;
  setPerfEnabled(enabled: boolean): void;
  drainPerf(): NitroUiPerfEvent[];
  sizingStats(): NitroUiSizingStats;
  nextSizingId(): number;
  seedSizingSize(
    componentName: string,
    sizingKey: string,
    width: number,
    height: number
  ): void;
  invalidateSizingEnvironment(): void;
  prewarmSizing(componentNames: readonly string[]): number;
  setSizingTraceEnabled(enabled: boolean): void;
  drainSizingTrace(): NitroUiSizingTraceEvent[];
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
  sizingStats(): NitroUiSizingStats {
    return getCore().sizingStats();
  },
  nextSizingId(): number {
    return getCore().nextSizingId();
  },
  seedSizingSize(
    componentName: string,
    sizingKey: string,
    width: number,
    height: number
  ): void {
    getCore().seedSizingSize(componentName, sizingKey, width, height);
  },
  invalidateSizingEnvironment(): void {
    getCore().invalidateSizingEnvironment();
  },
  prewarmSizing(componentNames: readonly string[]): number {
    // `readonly` for the caller's convenience; Nitro wants a plain array.
    return getCore().prewarmSizing([...componentNames]);
  },
  setSizingTraceEnabled(enabled: boolean): void {
    getCore().setSizingTraceEnabled(enabled);
  },
  drainSizingTrace(): NitroUiSizingTraceEvent[] {
    return getCore().drainSizingTrace();
  },
};

/**
 * Adopt each named component's declared size as this environment's cached size,
 * so its first mount is laid out at that size and - when the size is right -
 * costs no correction.
 *
 * Call it once, early - after the imports, before the first screen renders - for
 * the components the first screen uses. It is a guess with the library's own
 * declared number behind it (`docs/architecture/sizing.md`), not a measurement,
 * and the engine treats it as such: the entry is provisional, so the first
 * control that really measures that configuration replaces it and any instance
 * laid out at the wrong size is corrected. A wrong guess therefore costs at most
 * the correction a cold mount would have paid anyway - it cannot leave a layout
 * wrong for the rest of the session.
 *
 * Returns how many components were seeded. A name the library does not know
 * costs nothing and counts as zero, which is what makes it safe to list a
 * component this version of the library does not have.
 */
export function prewarm(componentNames: readonly string[]): number {
  return nitroUiCore.prewarmSizing(componentNames);
}
