import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

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
export interface NitroUiSwitchProps
  extends HybridViewProps, NitroUiIntrinsicProps {
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
   * TEMPORARY, test-only: the control's width in platform units, so a harness can
   * make a self-sizing control genuinely change size through a prop and prove that
   * a `nuiSizingKey` change re-measures (review S1). The
   * Switch has no size-affecting public prop, and per DECISIONS D16 the real
   * test belongs to the G2 Button; this is the seam until that lands. Not a
   * feature: no wrapper prop exposes it, and it is deleted with the G2 test.
   */
  nuiTestWidth: number | null;
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

  /**
   * TEMPORARY, test-only (task H2a, follow-up N4 from H1's re-review): the guards this
   * view has armed **for a composition of its own**, as one line — `strategy` for the
   * Compose composition strategy (the activity `LifecycleRegistry` observer), `preDraw`
   * for its first-frame pre-draw listener.
   *
   * The line is `ever|live:<live>`. The first half is what this mount has armed **at any
   * point** — it does not describe the current instant, and both flags reset when the view
   * is recycled. The `live` half is what is installed right now, which is how a test sees a
   * control that armed the guards while unhosted and then handed them back on moving into a
   * `<Host>`.
   *
   * A control a `<Host>` composes answers `|live:` — nothing armed and nothing installed,
   * because it builds no composition and the Host arms its own. The same control outside a
   * Host answers `strategy,preDraw|live:strategy` once its first frame has been marked
   * (the pre-draw listener takes itself off when it marks). Android-only meaning: iOS has
   * no composition strategy and no pre-draw listener, so it answers `|live:` for every
   * Switch and the test that reads this is gated to Android.
   */
  nuiTestArmedGuards(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
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

/**
 * The Hybrid View behind the `Switch` wrapper.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiSwitch = HybridView<
  NitroUiSwitchProps,
  NitroUiSwitchMethods
>;
