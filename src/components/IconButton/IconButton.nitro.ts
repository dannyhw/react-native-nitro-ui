import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * Native props of the `NitroUiIconButton` Hybrid View.
 *
 * An IconButton is a Button with no label and a Switch's value, so it takes one
 * thing from each (Q9 Appendix C4):
 *
 * - `onPress` is Button's: a gesture, not a value JS can reject;
 * - `checked` / `defaultChecked` / `mostRecentEventCount` / `onCheckedChange` are
 *   Switch's and Chip's event-count handshake (core-architecture §4) — present,
 *   and the control is a toggle instead of a press.
 *
 * Both sets are always sent, whichever form is showing: no member is optional
 * (DECISIONS D7 / nitro#1184) except the callbacks (D7b), and the wrapper
 * (`IconButton.tsx`) always sends every prop. A form change at runtime therefore
 * never makes a prop disappear between two commits.
 *
 * All props are applied in one batch between `beforeUpdate()` and
 * `afterUpdate()`; setters only store + mark dirty.
 */
export interface NitroUiIconButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /**
   * The control's only name: an IconButton has no text, so this is what a screen
   * reader reads (`docs/components/icon-button.md`). The wrapper requires it in
   * the type and warns in development when it is empty.
   */
  accessibilityLabel: string;
  /**
   * SF Symbol name, or `null`. iOS only: Android has no SF Symbols and takes the
   * drawable in `androidIcon` instead, so each platform draws its own glyph and a
   * caller names both on one control.
   *
   * It joins `nuiSizingKey`: symbols differ in width, so on iOS the glyph *is*
   * part of the control's width.
   */
  systemImage: string | null;
  /**
   * Android glyph, already resolved by the wrapper to one string: a resource
   * name, a `res:` name the bundler derived from an asset path, or a `url:` the
   * dev server serves (`src/iconSource.ts`, DECISIONS D43). Android only.
   *
   * It joins `nuiSizingKey` alongside `systemImage`, so the two platforms read
   * one key. Its *size* comes from the size ladder and never from the file, which
   * is why the box is right before the bytes arrive.
   */
  androidIcon: string | null;
  /**
   * `'standard' | 'filled' | 'tonal' | 'outlined'`, resolved by the wrapper:
   * Material's own names for the four icon-button components.
   * `docs/components/icon-button.md` has the iOS mapping.
   */
  variant: string;
  /** One of `'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'`, resolved. */
  size: string;
  /**
   * `'narrow' | 'uniform' | 'wide'`, resolved. **Android only** — Material's
   * three width options for a rung. iOS has no counterpart and ignores it, so it
   * is in `nuiSizingKey` on both platforms and *acts* on one (documented).
   */
  width: string;
  /** `'round'` (the default) or `'square'`; the same vocabulary as `Button.shape`. */
  shape: string;
  /** Disable interaction (and show the disabled style). No event fires. */
  disabled: boolean;
  /**
   * RN-processed (`processColor`) ARGB colour, or `null` for the platform
   * default: SwiftUI `.tint()` / the variant's container or content colour.
   */
  tintColor: number | null;
  /**
   * Controlled selection of the toggle form, or `null` for a press button or an
   * uncontrolled toggle — native then keeps the displayed value, seeded by
   * `defaultChecked`. Ignored by the press form.
   */
  checked: boolean | null;
  /** Initial selection of an uncontrolled toggle; ignored while `checked` is set. */
  defaultChecked: boolean | null;
  /**
   * The last event count JS has fully processed (core-architecture §4). Native
   * only accepts a `checked` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /** Forwarded to the native view so tests and a11y tools can find it. */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * The press form's tap — and nothing on the toggle form, which reports
   * `onCheckedChange` instead. Optional for the reason
   * `NitroUiSwitchProps.onValueChange` spells out (D7b), and always sent: a stable
   * no-op when the caller passed none, so a recycled view cannot keep the previous
   * mount's handler.
   */
  onPress?: () => void;
  /**
   * The toggle form's change: the selection native now displays, plus native's
   * event count (echoed back as `mostRecentEventCount`). Optional (D7b), always
   * sent.
   */
  onCheckedChange?: (checked: boolean, eventCount: number) => void;
}

export interface NitroUiIconButtonMethods extends HybridViewMethods {
  /**
   * The size of the hosted control, as measured on the UI thread during the last
   * layout/commit. Never calls into SwiftUI/Compose: JS reads a cached value, so
   * this is safe to call from the JS thread (core-architecture §1.4).
   */
  measureContent(): NitroUiIconButtonSize;

  /**
   * TEMPORARY, test-only: press the control through the same path a tap takes —
   * the toggle's optimistic flip with a fresh event count, or the press form's
   * `onPress`. Refused while disabled, as a tap is.
   *
   * It exists for one platform's harness, for Chip's reason: a harness tap is a
   * `UITouch` with no HID event behind it, which SwiftUI's button gesture refuses
   * (`Button.harness.tsx` measured it). The real tap is `real-input:ios`'s job.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPress(): void;

  /**
   * TEMPORARY, test-only: read the control's accessibility node on the UI thread
   * and keep the answer for {@link nuiTestStateReport}. Returns at once, because a
   * Nitro method may not block for the UI thread.
   *
   * Android reads the merged Compose semantics node a reader is handed — which is
   * how "a toggle's checked state reads in the accessibility tree" is proved
   * there. iOS has nothing to read in-process (the hosting view answers
   * `accessibilityElements == []` to anything that is not an accessibility client,
   * as `HybridNitroUiSlider.swift` measured), so iOS records `a11y=unavailable`
   * and the state is read by the a11y sweep in `real-input:ios`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestProbeAccessibility(): void;

  /**
   * TEMPORARY, test-only: what the control is showing, as one line —
   * `displayed=<0|1|none>;probes=<n>;a11y=<...>`.
   *
   * `displayed` is written where the control is drawn, so it is a reading of the
   * hosted control rather than an echo of a prop (`hybridRef`'s `checked` answers
   * what React sent). `none` until the control has drawn, and for the press form,
   * which has no selection. `probes` counts the accessibility answers, so a test
   * can tell its own from the previous control's. Shape shared with Chip's report.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;

  /**
   * TEMPORARY, test-only: ask whether `color` (an ARGB `processColor` int) is
   * among the pixels this control is drawing. Answer stored for
   * {@link nuiTestPixelReport}.
   *
   * It exists because "the glyph is drawn, at this rung, in the control's content
   * colour" is a *drawing* contract no prop echo answers, and G19's Button probe is
   * the sampler for it (`NitroUiPixelProbe.kt`). Android is the platform with
   * something to probe: it draws `androidIcon`. **iOS answers `no pixels`**, having
   * no Android glyph to sample.
   *
   * @internal Not app API (DECISIONS D14). Deleted when the harness can read pixels.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * TEMPORARY, test-only: what the last {@link nuiTestPixelProbe} found, as one
   * line — the same shape Button and SegmentedControl answer with, so the harness
   * reads one format from any control.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPixelReport(): string;
}

/**
 * A size in platform units (iOS points / Android density-independent pixels).
 *
 * @internal Only reachable through a Hybrid View, which is not exposed publicly
 * (DECISIONS D14).
 *
 * Per-component on purpose, like `NitroUiButtonSize` and `NitroUiChipSize`:
 * nitrogen generates one struct per name.
 */
export interface NitroUiIconButtonSize {
  width: number;
  height: number;
}

/**
 * The Hybrid View React renders as `NitroUiIconButton`.
 *
 * @internal Hybrid Views and their settable props are not public (DECISIONS D14):
 * exported for this repo's example, harness, bench and smoke apps, and for the
 * typed `hybridRef` handle; not semver surface.
 */
export type NitroUiIconButton = HybridView<
  NitroUiIconButtonProps,
  NitroUiIconButtonMethods
>;
