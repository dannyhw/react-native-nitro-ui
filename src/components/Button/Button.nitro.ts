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
export interface NitroUiButtonProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** Also the default accessibility label. */
  title: string;
  /** 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'. */
  variant: string;
  /** 'small' | 'medium' | 'large'. */
  size: string;
  /** 'round' | 'square'. iOS has no square button: it uses an 8pt radius. */
  shape: string;
  disabled: boolean;
  /** A `processColor` ARGB int, or `null` for the platform default. */
  tintColor: number | null;
  /** Leading SF Symbol name. iOS only. */
  systemImage: string | null;
  /** Leading drawable, by Android resource name. Android only. */
  androidIcon: string | null;
  testID: string | null;
  /** `null` uses `title`. */
  accessibilityLabel: string | null;
  /** Instance id for perf marks; `null` disables them for this view. */
  nuiPerfId: number | null;
  onPress?: () => void;
}

export interface NitroUiButtonMethods extends HybridViewMethods {
  /** Reads a size cached on the UI thread; safe to call from the JS thread. */
  measureContent(): NitroUiButtonSize;

  /**
   * Test-only: samples the drawn pixels for `color` on the UI thread and
   * stores the answer for `nuiTestPixelReport()`. iOS has nothing to sample.
   * @internal
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * Test-only: the last probe's result, empty before the first probe. Android:
   * `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`. iOS: `n=<probes> no pixels`.
   * @internal
   */
  nuiTestPixelReport(): string;
}

/** In platform units (iOS points, Android dp). @internal */
export interface NitroUiButtonSize {
  width: number;
  height: number;
}

/** @internal */
export type NitroUiButton = HybridView<
  NitroUiButtonProps,
  NitroUiButtonMethods
>;
