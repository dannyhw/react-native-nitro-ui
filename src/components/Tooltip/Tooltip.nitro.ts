import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

export interface NitroUiTooltipAction {
  /** What `onAction` reports. Unique across the tooltip's actions. */
  id: string;
  title: string;
}

/**
 * The view has no children and is not self-sizing: the wrapper's `View` holds
 * the anchor and this view fills it, so its box is the anchor the tooltip is
 * presented from.
 *
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiTooltipProps extends HybridViewProps {
  /** What React asked for (the wrapper's `isPresented`). */
  presented: boolean;
  /** Native ignores a `presented` sent with a count behind its own. */
  mostRecentEventCount: number;
  /** Also what a screen reader announces. */
  message: string;
  title: string | null;
  /**
   * At most two. With a title or an action Android draws Material's rich
   * tooltip, otherwise its plain one.
   */
  actions: NitroUiTooltipAction[];
  /** `'auto' | 'above' | 'below'`; anything else behaves as `'auto'`. */
  placement: string;
  /** The presented content gets `<testID>-tooltip`. */
  testID: string | null;
  nuiPerfId: number | null;
  /**
   * Called for every native close: a tap outside, Back (an Android tooltip
   * with actions), the anchor leaving its window, or an action. Never for a
   * change React asked for.
   */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /** Fires before the `onPresentedChange(false)` the same tap causes. */
  onAction?: (id: string) => void;
}

export interface NitroUiTooltipMethods extends HybridViewMethods {
  /** @internal Test-only: one line of `;`-separated `key=value` pairs. */
  nuiTestStateReport(): string;
  /** @internal Test-only: runs the action with this id, as a tap would. */
  nuiTestPerformAction(id: string): void;
  /** @internal Test-only: dismisses the tooltip the way a tap outside does. */
  nuiTestDismiss(): void;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiTooltip = HybridView<
  NitroUiTooltipProps,
  NitroUiTooltipMethods
>;
