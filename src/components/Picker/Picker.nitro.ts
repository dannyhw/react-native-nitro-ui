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
export interface NitroUiPickerProps
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
  /**
   * `'menu' | 'wheel' | 'radio'`; anything else behaves as `'menu'`. Android
   * draws the menu control for `'wheel'`. `'radio'` is Android only: the
   * wrapper sends `'menu'` for it on iOS.
   */
  variant: string;
  /** Android's field label. iOS never draws it: there it is only the a11y name. */
  label: string | null;
  disabled: boolean;
  /** A `processColor` ARGB int, or `null` for the platform default. */
  tintColor: number | null;
  testID: string | null;
  accessibilityLabel: string | null;
  nuiPerfId: number | null;
  /**
   * Not called for a selection React made, nor when the selected item is
   * picked again.
   */
  onValueChange?: (index: number, eventCount: number) => void;
}

export interface NitroUiPickerMethods extends HybridViewMethods {
  /** Reads a cached size; safe to call from the JS thread. */
  measureContent(): NitroUiPickerSize;

  /** @internal Test-only: selects `index` the way a row press does. */
  nuiTestSelect(index: number): void;

  /**
   * @internal Test-only, Android: the popup and its anchor as one line,
   * `expanded=<0|1>;live=<n>;anchor=<l>,<t>,<r>,<b>;menu=<l>,<t>,<r>,<b>;rows=<n>;drawn=<tree|-1>`.
   * `live` counts the menus composed in the whole process; rects are screen
   * pixels, `-1` when not measured yet.
   */
  nuiTestMenuReport(): string;
}

/** @internal In platform units (iOS points, Android dp). */
export interface NitroUiPickerSize {
  width: number;
  height: number;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiPicker = HybridView<
  NitroUiPickerProps,
  NitroUiPickerMethods
>;
