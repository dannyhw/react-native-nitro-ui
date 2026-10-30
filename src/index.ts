/**
 * The public surface of `react-native-nitro-ui`.
 *
 * Deliberately small (DECISIONS D14): components and the shared clock. *Not*
 * public are the Hybrid Views behind them, their settable props, and the core
 * hooks a wrapper is built from - all of those are package-internal, so
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

// An opt-in shared native composition (H1): a container whose nitro-ui children render
// into one Compose composition instead of one each. Android only - on iOS `Host` is the
// documented passthrough `View`, permanently (D23 and its T17 outcome). Eight controls
// are hosted now - Switch since 0.1.0, Slider/Progress/Button since 0.2.0,
// SegmentedControl/Picker/DatePicker since 0.3.0 and Menu since 0.4.0 - because
// `HostChildren.ts` has a row for each. Hosting another one still means a row there, a
// native `isHostable` override, and a bench arm for it.
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
  Picker,
  type PickerChange,
  type PickerProps,
  type PickerVariant,
} from './components/Picker/Picker';

export {
  Progress,
  type ProgressProps,
  type ProgressVariant,
} from './components/Progress/Progress';

export {
  DatePicker,
  type DatePickerMode,
  type DatePickerProps,
  type DatePickerVariant,
} from './components/DatePicker/DatePicker';

// A button that opens a list of actions (G7a). Its trigger is a Button's label and
// its items are data, not children. `primaryAction` is iOS-only, `onOpen`/`onClose`
// fire on Android only (iOS never fires either), and a pick reports `onSelect` before
// it reports `onClose` - DECISIONS D32. `docs/components/menu.md` says which prop is
// which platform's, as Picker's `wheel` and Button's `systemImage` do.
export {
  Menu,
  type MenuAction,
  type MenuGroup,
  type MenuProps,
  type MenuSection,
  type MenuSubmenu,
} from './components/Menu/Menu';
