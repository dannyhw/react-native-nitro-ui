import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

export interface NitroUiDialogAction {
  /** What `onAction` reports. Unique across the dialog's actions, and stable. */
  id: string;
  title: string;
  /** 'default' | 'cancel' | 'destructive'. At most one 'cancel'. */
  role: string;
  disabled: boolean;
}

/**
 * No prop is optional: Fabric sends `null` for a removed prop, which crashes
 * an optional one (nitro#1184). Callbacks are the exception: Nitro only
 * accepts a callback prop typed as a function, never `fn | null`.
 */
export interface NitroUiDialogProps extends HybridViewProps {
  /** 'alert' | 'confirmation'. Anything else behaves as 'alert'. */
  variant: string;
  presented: boolean;
  /** Native accepts a `presented` write once it has sent this many events. */
  mostRecentEventCount: number;
  /** Also the dialog's accessibility name. */
  title: string;
  message: string | null;
  /** 'automatic' | 'visible' | 'hidden'. Ignored by the 'alert' variant. */
  titleVisibility: string;
  /** In the order the caller wrote them. At least one. */
  actions: NitroUiDialogAction[];
  /** Whether an outside tap, back or a swipe closes it. An action always. */
  dismissible: boolean;
  /** A `processColor` ARGB int for the buttons, or `null`. */
  tintColor: number | null;
  /** The presented window gets `<testID>-dialog`. */
  testID: string | null;
  /** Instance id for perf marks; `null` disables them for this view. */
  nuiPerfId: number | null;
  /** Called on a native open or close, never for a change React asked for. */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /** Called before the `onPresentedChange(false)` the same tap causes. */
  onAction?: (id: string) => void;
}

export interface NitroUiDialogMethods extends HybridViewMethods {
  /**
   * Test-only: what the dialog is showing, as one `;`-separated line of
   * `key=value` pairs. Reads a snapshot; safe to call from any thread.
   * @internal
   */
  nuiTestStateReport(): string;
  /** Test-only: runs the action's handler, as a tap would. @internal */
  nuiTestPerformAction(id: string): void;
  /** Test-only: dismisses as an outside tap, back or swipe would. @internal */
  nuiTestDismiss(): void;
}

/** @internal */
export type NitroUiDialog = HybridView<
  NitroUiDialogProps,
  NitroUiDialogMethods
>;
