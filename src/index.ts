/**
 * The public surface of `react-native-nitro-ui` (v0.1).
 *
 * Deliberately small (DECISIONS D14): components and the shared clock. *Not*
 * public are the Hybrid Views behind them, their settable props, and the core
 * hooks a wrapper is built from - all of those are package-internal in v0.1, so
 * every prop flows through React (UI thread, batched) and an imperative surface
 * can arrive later without breaking anyone. `SwitchProps.hybridRef` stays typed
 * for this repo's own harness and benchmarks; it is marked `@internal` and is
 * read-only in practice.
 *
 * `prewarm` is the one sizing call that is app API: it adopts a component's
 * declared size as this environment's answer so its first mount needs no
 * correction. The rest of the sizing surface is `nitroUiCore`'s diagnostics.
 *
 * `NitroUiSizingStats` and `NitroUiSizingTraceEvent` are the shapes the sizing
 * diagnostics return (docs/architecture/sizing.md). They are exported because
 * `nitroUiCore`'s methods return them - the diagnostics themselves stay
 * diagnostics.
 */
export { nitroUiCore, prewarm } from './NitroUiCore';
export type {
  NitroUiCore,
  NitroUiPerfEvent,
  NitroUiSizingStats,
  NitroUiSizingTraceEvent,
} from './NitroUiCore.nitro';

export { Slider, type SliderProps } from './components/Slider/Slider';
export { Switch, type SwitchProps } from './components/Switch/Switch';

// T16 spike: an opt-in shared native composition on Android. Exported on the spike
// branch so the bench arm and the example screen can render it; whether it ships is
// the report's recommendation.
export { Host, type HostProps } from './components/Host/Host';

export {
  SegmentedControl,
  type SegmentedControlChange,
  type SegmentedControlProps,
} from './components/SegmentedControl/SegmentedControl';

export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button/Button';

export {
  Progress,
  type ProgressProps,
  type ProgressVariant,
} from './components/Progress/Progress';
