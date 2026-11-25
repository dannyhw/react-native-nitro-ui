import { NitroModules } from 'react-native-nitro-modules';

import { materialThemeReport } from './MaterialTheme';

import type {
  NitroUiCore,
  NitroUiPerfEvent,
  NitroUiSizingStats,
  NitroUiSizingTraceEvent,
} from './NitroUiCore.nitro';

let core: NitroUiCore | null = null;

/**
 * The native core object. Created on first use: importing the package must not
 * touch native code, because the app may not be up yet and unit tests have no
 * native runtime.
 */
function getCore(): NitroUiCore {
  if (core == null) {
    core = NitroModules.createHybridObject<NitroUiCore>('NitroUiCore');
  }
  return core;
}

/**
 * The core native object for the library's own development checks: the same
 * object `nitroUiCore` wraps, without the app-facing surface.
 *
 * @internal Not app API — exported for this repo's own modules and tests.
 */
export function nitroUiNativeCore(): NitroUiCore {
  return getCore();
}

/**
 * The shared native core: a clock, performance marks and sizing diagnostics.
 *
 * `now()` is a monotonic clock in milliseconds on the same time base as the
 * display's frame times (`CLOCK_UPTIME_RAW` on Apple, `CLOCK_MONOTONIC` on
 * Android). The perf-mark methods record native `propsApplied` / `firstFrame`
 * events; they are off until `setPerfEnabled(true)` and are meant for benchmarks.
 *
 * The sizing methods are for tests and diagnostics: `sizingStats()` counts
 * corrections and flush times, `setSizingTraceEnabled` / `drainSizingTrace` log
 * every size a control was laid out with, and `invalidateSizingEnvironment` /
 * `seedSizingSize` force a cold or warm cache. To pre-warm sizes at startup, call
 * `prewarm`.
 *
 * `materialThemeReport()` is the Android theme's state for tests: the setting
 * `setMaterialTheme` chose and how many theme roots composed under each Material
 * motion scheme (`'setting=expressive;expressive=3;baseline=0;other=0'`), or `''`
 * on iOS.
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
  materialThemeReport(): string;
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
  materialThemeReport(): string {
    return materialThemeReport();
  },
};

/**
 * Pre-warm the size of each named component, so its first mount is laid out at
 * the library's declared size instead of being corrected after it measures.
 *
 * Call it once, early - after the imports, before the first screen renders - for
 * the components the first screen uses. Names are native component names such as
 * `'NitroUiSwitch'`. The declared size is only a first guess: a control whose
 * real size differs is still corrected, so a wrong guess cannot leave a layout
 * wrong.
 *
 * Returns how many components were seeded. An unknown name costs nothing and
 * counts as zero.
 */
export function prewarm(componentNames: readonly string[]): number {
  return nitroUiCore.prewarmSizing(componentNames);
}
