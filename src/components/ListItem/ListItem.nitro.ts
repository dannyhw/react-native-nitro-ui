import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiIntrinsicProps } from '../../core/NitroUiIntrinsicProps';
import type { NitroUiSize } from '../Switch/Switch.nitro';

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiListItemProps
  extends HybridViewProps, NitroUiIntrinsicProps {
  /** One line, tail-truncated. */
  title: string | null;
  /** One line, tail-truncated. */
  subtitle: string | null;
  /** Trailing text on the title's line. One line, tail-truncated. */
  value: string | null;
  /** Leading SF Symbol name. iOS only; an unknown name draws no glyph. */
  systemImage: string | null;
  /** A drawable resource name, `res:<name>` or `url:<file>`. Android only. */
  androidIcon: string | null;
  /** 'none' | 'disclosure' (a trailing chevron). */
  accessory: string;
  /** Whether the caller passed an `onPress`: the callback is always sent. */
  pressable: boolean;
  /** Inside a `Form.Row`, which supplies the insets and background itself. */
  insideRow: boolean;
  disabled: boolean;
  testID: string | null;
  /** `null` lets native read title, subtitle and value in platform order. */
  accessibilityLabel: string | null;
  /** Instance id for perf marks; `null` disables them for this view. */
  nuiPerfId: number | null;
  onPress?: () => void;
}

export interface NitroUiListItemMethods extends HybridViewMethods {
  /** Reads a size cached on the UI thread; safe to call from the JS thread. */
  measureContent(): NitroUiSize;

  /** Test-only: presses the item through the path a tap takes. @internal */
  nuiTestPress(): void;

  /**
   * Test-only: reads the accessibility node on the UI thread and stores the
   * answer for `nuiTestStateReport()`.
   * @internal
   */
  nuiTestProbeAccessibility(): void;

  /**
   * Test-only: what the item is showing, as one line -
   * `displayed=<title>|<subtitle>|<value>|<accessory>;presses=<n>;probes=<n>;a11y=<…>;iconTint=<#RRGGBB|->`.
   * `displayed` is `none` until the row has drawn. `presses` counts accepted
   * presses only. `a11y` is `role=…,disabled=…,label=…`, plus `clickable=…`
   * on Android. `iconTint` is always `-` on iOS.
   * @internal
   */
  nuiTestStateReport(): string;

  /**
   * Test-only: where the row put its content, as one line -
   * `insets=<leading>,<trailing>;shape=<0|1>;box=<w>x<h>`. `insets` are the
   * horizontal paddings the item itself applied. `shape` is whether the item's
   * own highlight painted for the last press.
   * @internal
   */
  nuiTestLayoutReport(): string;

  /**
   * Test-only: samples the drawn pixels for `color` on the UI thread and
   * stores the answer for `nuiTestPixelReport()`.
   * @internal
   */
  nuiTestPixelProbe(color: number): void;

  /**
   * Test-only: the last probe's result, empty before the first probe -
   * `n=<probes> size=<w>x<h> want=#<RRGGBB> hits=<n> mean=#<RRGGBB>
   * closest=#<RRGGBB>`, or `n=<probes> no pixels` with no glyph to sample.
   * @internal
   */
  nuiTestPixelReport(): string;

  /**
   * Test-only: `drops=<n> recycles=<m>`, counted over the host object's life
   * rather than this mount's.
   * @internal
   */
  nuiTestLifetimeReport(): string;
}

/** @internal */
export type NitroUiListItem = HybridView<
  NitroUiListItemProps,
  NitroUiListItemMethods
>;
