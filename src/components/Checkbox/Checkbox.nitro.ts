import type {
  HybridView,
  HybridViewProps,
  HybridViewMethods,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiCheckboxProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** `null` while uncontrolled: native then keeps the displayed value. */
  checked: boolean | null;
  /** Ignored while `checked` is set. */
  defaultChecked: boolean | null;
  /** `checked` outranks it. The iOS 'switch' style reads it as off. */
  indeterminate: boolean | null;
  /** 'circle' | 'square' | 'switch'. Ignored on Android. */
  iosStyle: string;
  /** Native accepts a `checked` write once it has sent this many events. */
  mostRecentEventCount: number;
  label: string | null;
  disabled: boolean;
  /** A `processColor` ARGB int, or `null` for the platform default. */
  tintColor: number | null;
  testID: string | null;
  /** `null` uses `label`. */
  accessibilityLabel: string | null;
  /** Instance id for perf marks; `null` disables them for this view. */
  nuiPerfId: number | null;
  /** `eventCount` is native's; JS echoes it back as `mostRecentEventCount`. */
  onCheckedChange?: (checked: boolean, eventCount: number) => void;
}

export interface NitroUiCheckboxMethods extends HybridViewMethods {
  /** Reads a size cached on the UI thread; safe to call from the JS thread. */
  measureContent(): NitroUiCheckboxSize;

  /** Test-only: toggles the box through the path a tap takes. @internal */
  nuiTestToggle(): void;

  /**
   * Test-only: reads the accessibility node on the UI thread and stores the
   * answer for `nuiTestStateReport()`. iOS records `a11y=unavailable`.
   * @internal
   */
  nuiTestProbeAccessibility(): void;

  /**
   * Test-only: what the checkbox is showing, as one line -
   * `displayed=<0|1|mixed|none>;probes=<n>;merged=<0|1|none>;a11y=<...>
   * [;symbol=<SF Symbol|switch>][;labelBox=<off,room>];drops=<n>;recycles=<m>`.
   * `symbol` is iOS only, `labelBox` Android only. Android's `a11y` is
   * `role=<role>,checked=<bool|none>,toggle=<On|Off|Indeterminate|none>,disabled=<bool>,clickable=<bool>,label=<text>`.
   * `drops` and `recycles` count over the host object's life, not this mount's.
   * @internal
   */
  nuiTestStateReport(): string;
}

/** In platform units (iOS points, Android dp). @internal */
export interface NitroUiCheckboxSize {
  width: number;
  height: number;
}

/** @internal */
export type NitroUiCheckbox = HybridView<
  NitroUiCheckboxProps,
  NitroUiCheckboxMethods
>;
