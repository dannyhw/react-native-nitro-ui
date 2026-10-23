import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiButton` Hybrid View.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks
 * (D7b): Fabric sends `null` for a prop that JS removed and Nitro 0.37 only
 * treats `undefined` as "unset", so an optional prop that goes away crashes.
 * The JS wrapper (`Button.tsx`) always sends every prop.
 *
 * A Button has **no** controlled value, so it has no event-count handshake:
 * `onPress` reports a gesture, not a state change JS can reject
 * (`docs/architecture/core.md` §12 for the shape this deliberately avoids).
 *
 * All props are applied in one batch between `beforeUpdate()` and
 * `afterUpdate()`; setters only store + mark dirty.
 */
export interface NitroUiButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The button's text. Size-affecting: it is part of `nuiSizingKey`, and it is
   * also the default accessibility label.
   */
  title: string;
  /**
   * One of `'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'`, resolved to
   * one of those five by the wrapper. See `docs/components/button.md` for what
   * each maps to per platform.
   */
  variant: string;
  /**
   * One of `'small' | 'medium' | 'large'`, resolved by the wrapper. iOS
   * `.controlSize` / Android content padding + label typography.
   */
  size: string;
  /** Disable interaction (and show the disabled style). No `onPress` fires. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB color for the container, or `null` for
   * the platform default: SwiftUI `.tint()` / the variant's container colour.
   */
  tintColor: number | null;
  /**
   * Leading SF Symbol name, or `null`. Ignored on Android in v0.1 — documented
   * on `docs/components/button.md`.
   */
  systemImage: string | null;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /**
   * Accessibility label of the control itself, or `null` to use `title`.
   */
  accessibilityLabel: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called once per tap. Callback props are the exception to the no-optional
   * rule (D7b): Nitro only unwraps `{ f: fn }` for a prop whose type *is* a
   * function, so this must never become `fn | null`. The wrapper always sends
   * one — a stable no-op when the caller passed nothing — so removing a handler
   * cannot leave the previous one behind.
   */
  onPress?: () => void;
}

export interface NitroUiButtonMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   */
  measureContent(): NitroUiButtonSize;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which v0.1 does not expose
 * publicly (DECISIONS D14).
 *
 * The shape is per-component on purpose, like `NitroUiSwitchSize` and
 * `NitroUiSliderSize`: nitrogen generates one struct per name, and a shared
 * type in one component's spec file would make every other component import
 * that component's spec.
 */
export interface NitroUiButtonSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiButton`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiButton = HybridView<
  NitroUiButtonProps,
  NitroUiButtonMethods
>;
