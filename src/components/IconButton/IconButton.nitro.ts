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
export interface NitroUiIconButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** The control's only name: an IconButton has no text. */
  accessibilityLabel: string;
  /** SF Symbol name. iOS only. */
  systemImage: string | null;
  /** A drawable resource name, `res:<name>` or `url:<file>`. Android only. */
  androidIcon: string | null;
  /** 'standard' | 'filled' | 'tonal' | 'outlined'. */
  variant: string;
  /** 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'. */
  size: string;
  /** 'narrow' | 'uniform' | 'wide'. Android only; iOS ignores it. */
  width: string;
  /** 'round' | 'square'. */
  shape: string;
  disabled: boolean;
  /** A `processColor` ARGB int, or `null` for the platform default. */
  tintColor: number | null;
  /** `null` for a press button or an uncontrolled toggle. */
  checked: boolean | null;
  /** Ignored while `checked` is set. */
  defaultChecked: boolean | null;
  /** Native accepts a `checked` write once it has sent this many events. */
  mostRecentEventCount: number;
  testID: string | null;
  /** Instance id for perf marks; `null` disables them for this view. */
  nuiPerfId: number | null;
  /** The press form's tap. Never called on the toggle form. */
  onPress?: () => void;
  /** The toggle form's change. JS echoes `eventCount` back. */
  onCheckedChange?: (checked: boolean, eventCount: number) => void;
}

export interface NitroUiIconButtonMethods extends HybridViewMethods {
  /** Reads a size cached on the UI thread; safe to call from the JS thread. */
  measureContent(): NitroUiIconButtonSize;

  /** Test-only: presses the control through the path a tap takes. @internal */
  nuiTestPress(): void;

  /**
   * Test-only: reads the accessibility node on the UI thread and stores the
   * answer for `nuiTestStateReport()`. iOS records `a11y=unavailable`.
   * @internal
   */
  nuiTestProbeAccessibility(): void;

  /**
   * Test-only: what the control is showing, as one line -
   * `displayed=<0|1|none>;probes=<n>;a11y=<...>`. `displayed` is `none` until
   * the control has drawn, and always for the press form.
   * @internal
   */
  nuiTestStateReport(): string;

  /**
   * Test-only: samples the drawn pixels for `color` on the UI thread and
   * stores the answer for `nuiTestPixelReport()`. iOS has nothing to sample.
   * @internal
   */
  nuiTestPixelProbe(color: number): void;

  /** Test-only: the last probe's result, in Button's format. @internal */
  nuiTestPixelReport(): string;
}

/** In platform units (iOS points, Android dp). @internal */
export interface NitroUiIconButtonSize {
  width: number;
  height: number;
}

/** @internal */
export type NitroUiIconButton = HybridView<
  NitroUiIconButtonProps,
  NitroUiIconButtonMethods
>;
