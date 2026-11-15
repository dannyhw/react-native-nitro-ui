import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiSegmentedControlProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  options: string[];
  /**
   * Index into `options`, or `null` while uncontrolled. Clamped in
   * `afterUpdate()`, because props in one batch arrive in no fixed order.
   */
  selectedIndex: number | null;
  defaultSelectedIndex: number;
  /** Native ignores a `selectedIndex` sent with a count behind its own. */
  mostRecentEventCount: number;
  disabled: boolean;
  /**
   * A `processColor` ARGB int, or `null` for the platform default. Android
   * only: a segmented SwiftUI `Picker` ignores `.tint()`.
   */
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  /**
   * Not called for a tap on the selected segment: Android suppresses it to
   * match SwiftUI's `Picker`.
   */
  onValueChange?: (index: number, eventCount: number) => void;
}

export interface NitroUiSegmentedControlMethods extends HybridViewMethods {
  /** Reads a cached size; safe to call from the JS thread. */
  measureContent(): NitroUiSegmentedControlSize;

  /**
   * @internal Test-only: looks for `color` (a `processColor` ARGB int) among
   * the pixels drawn. Returns at once; poll `nuiTestPixelReport`.
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * @internal Test-only: the last probe's answer, as `n=<count> size=<w>x<h>
   * want=#RRGGBB hits=<n> mean=#RRGGBB closest=#RRGGBB`, where `n` counts the
   * probes answered. Empty before the first probe; `no pixels` / `no image`
   * when nothing was drawn. The control is composited over mid grey first,
   * because the iOS 26 selection fill is translucent.
   */
  nuiTestPixelReport(): string;

  /**
   * @internal Test-only: the segment actually drawn, as `displayed=<index>`,
   * or `displayed=none` before the control has drawn.
   */
  nuiTestDisplayedIndex(): string;
}

/** @internal In platform units (iOS points, Android dp). */
export interface NitroUiSegmentedControlSize {
  width: number;
  height: number;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiSegmentedControl = HybridView<
  NitroUiSegmentedControlProps,
  NitroUiSegmentedControlMethods
>;
