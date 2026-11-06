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
  /**
   * The button's corner: `'round'` (the platform default) or `'square'`.
   *
   * Android passes Material 3's own shapes - `round` is the height's shape,
   * which morphs to the square one while pressed, `square` starts square and
   * morphs to the rounded one. iOS has no cornerless button, so `square` is
   * `.buttonBorderShape(.roundedRectangle(radius: 8))`, the nearest border
   * shape it has (`docs/components/button.md` has the mapping).
   *
   * It is not in `nuiSizingKey`: a corner repaints, it does not resize.
   */
  shape: string;
  /** Disable interaction (and show the disabled style). No `onPress` fires. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB color for the container, or `null` for
   * the platform default: SwiftUI `.tint()` / the variant's container colour.
   */
  tintColor: number | null;
  /**
   * Leading SF Symbol name, or `null`. iOS only: Android has no SF Symbols, and
   * the drawable lookup that would stand in for it is the separate `androidIcon`
   * prop below. Documented on `docs/components/button.md`.
   */
  systemImage: string | null;
  /**
   * Leading app drawable, named by its Android resource name, or `null`.
   *
   * Android only: iOS draws `systemImage` and ignores this, so a caller writes
   * both names on one Button and each platform takes its own
   * (`docs/components/button.md`, "Android icons"). Already normalised by the
   * wrapper, so the native side looks up exactly what it is given.
   *
   * It joins `nuiSizingKey`: a glyph before the label makes the control wider, so
   * two Buttons that differ only in this prop must not share a cached size.
   */
  androidIcon: string | null;
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

  /**
   * TEMPORARY, test-only: ask the platform whether `color` (an ARGB `processColor`
   * int) is among the pixels this control is drawing. Answer stored for
   * {@link nuiTestPixelReport}.
   *
   * It exists because `androidIcon`'s contract is a *drawing* contract. Every other
   * reading of the prop is an echo: the handle's `androidIcon` answers what React
   * sent, `measureContent()` answers that a slot was taken — and a glyph painted in
   * a hard-coded colour instead of the control's content colour would satisfy both
   * while being wrong on screen (Q9 Appendix C's tint rule, and G4 F1's lesson that
   * only drawn pixels know whether a colour arrived).
   *
   * Android is the platform with something to probe: it draws `androidIcon`. The
   * sampling needs the UI thread and a Nitro method may not block for it, so the
   * answer is stored and read back, the way SegmentedControl's pair and the Slider's
   * `nuiTestAccessibilityStep` pair work. **iOS answers `no pixels`** — it draws
   * `systemImage` and no `androidIcon` at all, so there is no glyph to sample and a
   * probe on iOS is a test that should not be running there.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * TEMPORARY, test-only: what the last {@link nuiTestPixelProbe} found, as one
   * line — `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>` on Android, `n=<probes> no pixels` on iOS. Empty before the
   * first probe.
   *
   * `n=` counts probes so a test can tell its own answer from the previous
   * control's, and `size=`/`hits=` are in the line because a probe that sampled
   * nothing and a probe that found nothing are different failures with the same
   * verdict. Shape shared with SegmentedControl's report, which the harness helper
   * that reads both asserts on.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPixelReport(): string;
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
