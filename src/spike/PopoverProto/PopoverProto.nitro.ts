import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * S5 spike only (never merged): a popover whose content is React Native, Q7
 * Appendix F. Tooltip's anchor (the wrapper hugs it) plus BottomSheet's content
 * machinery (the children are this view's, and are moved into the popover).
 *
 * Every prop is always sent (D7, nitro#1184); callbacks are the D7b exception.
 */
export interface NitroUiPopoverProtoProps extends HybridViewProps {
  /** The JS copy of `isPresented`. */
  presented: boolean;
  /** The last native event count JS has processed (core.md §4). */
  mostRecentEventCount: number;
  /** The widest the content may be, in points/dp: the content box's own cap. */
  maxWidth: number;
  /**
   * Spike knob for the Q1 red proof: when false, iOS sets `preferredContentSize`
   * only after the popover is up, and Android composes the popup before the
   * content has a size.
   */
  sizeBeforePresent: boolean;
  testID: string | null;
  /** Called on every native close, with native's event count. */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /** Nothing is up any more: the wrapper may unmount the content. */
  onDismissed?: (ended: boolean) => void;
}

export interface NitroUiPopoverProtoMethods extends HybridViewMethods {
  /** Test-only: one `;`-separated `key=value` line of what is on screen. */
  nuiTestStateReport(): string;
  /** Test-only: close it the way a tap outside does (emits the close). */
  nuiTestDismiss(): void;
}

export type NitroUiPopoverProto = HybridView<
  NitroUiPopoverProtoProps,
  NitroUiPopoverProtoMethods
>;
