import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The view's one child is the content box: Yoga lays it out at the content's
 * own size, at most `maxWidth` wide, and native reads that child's frame as
 * the popover's size. The anchor is this view's parent, not the view itself.
 *
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiPopoverProps extends HybridViewProps {
  /** What React asked for (the wrapper's `isPresented`). */
  presented: boolean;
  /** Native ignores a `presented` sent with a count behind its own. */
  mostRecentEventCount: number;
  /**
   * In points. The wrapper sends the smaller of the app's `maxWidth` and the
   * window's width less 32.
   */
  maxWidth: number;
  /** The presented content gets `<testID>-popover`. */
  testID: string | null;
  nuiPerfId: number | null;
  /** Called for every native open or close, never for one React asked for. */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /**
   * Nothing is on screen any more, so the wrapper can unmount the content.
   * `ended` is true when a popover that was up has gone, false when React
   * withdrew one that was not up.
   */
  onDismissed?: (ended: boolean) => void;
}

export interface NitroUiPopoverMethods extends HybridViewMethods {
  /** @internal Test-only: one line of `;`-separated `key=value` pairs. */
  nuiTestStateReport(): string;
  /** @internal Test-only: closes the popover the way a tap outside does. */
  nuiTestDismiss(): void;
}

/** @internal Exported for this repo's apps and tests; not semver surface. */
export type NitroUiPopover = HybridView<
  NitroUiPopoverProps,
  NitroUiPopoverMethods
>;
