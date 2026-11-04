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

// The one app-level theme choice (D39): Android draws with Material 3 Expressive unless
// the app opts out to the baseline theme. No per-control prop - the setting is the
// process's, and every composition the library owns reads it at its root.
export { setMaterialTheme, type MaterialTheme } from './MaterialTheme';
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

// Two dialogs over one native view (G11, DECISIONS D33): UIKit's `UIAlertController`
// on iOS, Material 3's `AlertDialog` and `ModalBottomSheet` on Android. `isPresented`
// is controlled through the event-count handshake, an action reports `onAction` before
// `onIsPresentedChange(false)` (D32), and neither has a box (`sizing: null`).
export {
  AlertDialog,
  ConfirmationDialog,
  type AlertDialogProps,
  type ConfirmationDialogProps,
  type DialogAction,
  type DialogProps,
} from './components/Dialog/Dialog';

// A modal bottom sheet with React Native content (G14, DECISIONS D33/D35): UIKit's sheet
// presentation on iOS, Material 3's `ModalBottomSheet` on Android. `isPresented` is
// controlled through the event-count handshake, detents use SwiftUI's names, and the
// content is mounted only while the sheet is up.
export {
  BottomSheet,
  type BottomSheetDetent,
  type BottomSheetProps,
} from './components/BottomSheet/BottomSheet';
// A single- or multi-line text field (G13, DECISIONS D34): `UITextField` (a
// `UITextView` when `multiline`) on iOS, Compose `BasicTextField(TextFieldState)`
// on Android. The text is controlled through the event-count handshake, a `value`
// write is dropped while an IME composition is open, and `ref` gives `focus()` /
// `blur()`.
export {
  TextField,
  type TextFieldAutoCapitalize,
  type TextFieldHandle,
  type TextFieldKeyboardType,
  type TextFieldProps,
  type TextFieldReturnKeyType,
} from './components/TextField/TextField';
// A compact choice or action (G12): Material 3 `FilterChip` / `AssistChip` on
// Android, SwiftUI `Toggle(.button)` / a bordered capsule `Button` on iOS, which has
// no chip. A filter chip's `selected` is controlled through the event-count
// handshake; an assist chip is a press. `systemImage` is iOS-only, as Button's is.
export { Chip, type ChipProps, type ChipVariant } from './components/Chip/Chip';

// A checkbox (G15): Material 3 `Checkbox`, or `TriStateCheckbox` while
// `indeterminate`, on Android - and SwiftUI `Toggle(isOn:)` with the switch style on
// iOS, which has no checkbox (`CheckboxToggleStyle` is unavailable there), as Expo's
// universal Checkbox renders. `checked` is controlled through the event-count
// handshake; `indeterminate` is a display and is Android-only.
export { Checkbox, type CheckboxProps } from './components/Checkbox/Checkbox';
// A `View` that opens Menu's `group` on a long press (G16, DECISIONS D36/D37):
// `UIContextMenuInteraction` on iOS, a Material 3 `DropdownMenu` at the finger on
// Android. The children stay in place, a hold cancels their touch, and `onOpen`/
// `onClose` fire on both platforms - unlike Menu's, which are Android-only (D32).
export {
  ContextMenu,
  type ContextMenuProps,
} from './components/ContextMenu/ContextMenu';
