import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * Native props of the `NitroUiSwitch` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184): Fabric sends `null` for a
 * prop that JS removed, and Nitro 0.37 only treats `undefined` as "unset", so
 * an optional prop that goes away crashes. The JS wrapper (`Switch.tsx`) always
 * sends every prop, using `null` for "not set".
 *
 * All props are applied in one batch between `beforeUpdate()` and
 * `afterUpdate()`; setters only store + mark dirty.
 */
export interface NitroUiSwitchProps extends HybridViewProps {
  /**
   * Controlled selected state, or `null` for an uncontrolled Switch - in which
   * case native keeps the displayed value and `defaultValue` seeded it.
   */
  value: boolean | null;
  /** Initial value of an uncontrolled Switch; ignored while `value` is set. */
  defaultValue: boolean | null;
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only accepts a `value` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /** Disable interaction (and show the disabled style). */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB color for the "on" accent, or `null` for
   * the platform default: SwiftUI `.tint()` / Compose checked track color.
   */
  tintColor: number | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Accessibility label of the control itself. */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every user interaction with the value native now displays, plus
   * native's event count (the JS wrapper echoes it back as
   * `mostRecentEventCount`).
   *
   * Callback props are the one exception to the no-optional rule above, and
   * `| null` is not an alternative: RN cannot send a function as a prop, so
   * Nitro sends `{ f: fn }` and only unwraps `f` for props whose type *is* a
   * function (`IsFunctionProp`). A `fn | null` union becomes a
   * `std::variant<std::function, NullType>`, which is not a function type, so
   * the wrapper never gets unwrapped and converting the prop throws at mount.
   * Optional (`?`) generates `std::optional<std::function>`, which does unwrap.
   * The JS wrapper therefore always sends a callback (see `useControlled`) and
   * `undefined` instead of `null` when there is none.
   */
  onValueChange?: (value: boolean, eventCount: number) => void;
}

export interface NitroUiSwitchMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.2 rejects a
   * synchronous measure that needs the UI thread).
   */
  measureContent(): NitroUiSize;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * The value a native host reports as the *content* size of what it hosts (a
 * SwiftUI `Toggle`, a Compose `Switch`, ...), independent of the size Yoga gave
 * the Fabric node. T11 (the intrinsic-size ShadowNode) is the primary consumer;
 * until then it is only reachable through a Hybrid View's `measureContent()`.
 */
export interface NitroUiSize {
  width: number;
  height: number;
}

/** The Hybrid View behind the `Switch` wrapper. */
export type NitroUiSwitch = HybridView<
  NitroUiSwitchProps,
  NitroUiSwitchMethods
>;
