import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

import type { NitroUiMenuRow } from '../../components/Menu/Menu.nitro';

/**
 * S3 spike only (DECISIONS D36): a minimal ContextMenu, never merged.
 *
 * A `View` whose React Native children stay in place and which opens a menu of
 * Menu's flattened rows on a long press: `UIContextMenuInteraction` on the
 * generated component view on iOS, a Material 3 `DropdownMenu` anchored at the
 * press point on Android (Q6 Appendices B and C).
 *
 * Every prop is `T | null` or required, the callbacks are the D7b exception.
 * `onTrace` is the spike's witness: one line per native event with the native
 * clock, so the order of a pick and the open latency can be read from JS.
 */
export interface NitroUiContextMenuProtoProps extends HybridViewProps {
  rows: NitroUiMenuRow[];
  title: string | null;
  disabled: boolean;
  /**
   * Spike knob for the red proof: `false` skips the cancel of React Native's
   * touches at open (iOS: the surface handler toggle; Android:
   * `notifyNativeGestureStarted`).
   */
  cancelTouches: boolean;
  onSelect?: (id: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onTrace?: (line: string) => void;
}

export interface NitroUiContextMenuProtoMethods extends HybridViewMethods {
  /**
   * One line: the box, the children's frames as the platform placed them, the
   * open flag, the last press point and the last menu rect, plus counters.
   */
  nuiTestReport(): string;
  /**
   * Android: `performAccessibilityAction(ACTION_LONG_CLICK)` on the wrapper, the
   * action TalkBack's double-tap-and-hold sends. iOS: no-op.
   */
  nuiTestA11yLongClick(): void;
  /**
   * Q8: hold a synthesized touch at a fraction of this view's box for `ms`.
   * iOS: HarnessUI's private `UITouch` path, held. Android: `MotionEvent`s
   * dispatched through the root view with real timing.
   */
  nuiTestSynthHold(fx: number, fy: number, ms: number): void;
}

export type NitroUiContextMenuProto = HybridView<
  NitroUiContextMenuProtoProps,
  NitroUiContextMenuProtoMethods
>;
