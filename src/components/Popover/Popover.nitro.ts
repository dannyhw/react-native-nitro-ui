import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * Native props of the `NitroUiPopover` Hybrid View (G22, DECISIONS D44).
 *
 * The view's one child is the **content box**: the JS wrapper makes this view as wide
 * as `maxWidth` with `alignItems: 'flex-start'`, so Yoga lays that one child out at the
 * content's own width (at most the cap) and its own height, and native reads that
 * child's frame as the popover's size. There is no measuring on the native side and no
 * presented-container shadow node - S5 measured that shape on both platforms, and it is
 * what makes the first frame the final size (D44).
 *
 * The view itself is not the anchor: the wrapper's box is, because that is what hugs the
 * app's `anchor` element. So each platform points at this view's parent, and this view's
 * own box is never on screen - iOS hides it and moves it into the popover, Android moves
 * it into the popup.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks (D7b): the
 * wrapper always sends every prop, with `null` for "not set".
 *
 * Whether the popover is up is a controlled value behind the event-count handshake
 * (`docs/architecture/core.md` §4), exactly as a tooltip's and a sheet's are, and a
 * close the app refuses is presented again (D33).
 *
 * Setters must not interpret one prop against another (Nitro does not order props
 * inside a batch - core.md §3), so everything is stored raw and the presentation is
 * reconciled once, in `afterUpdate()`.
 */
export interface NitroUiPopoverProps extends HybridViewProps {
  /** The JS copy of `isPresented`: what React asked for. */
  presented: boolean;
  /**
   * The last event count JS has fully processed (core.md §4). Native only accepts a
   * `presented` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /**
   * The widest the content may be, in points: the smaller of the app's `maxWidth` and
   * the window's width less 32, which the wrapper works out. The content box is laid
   * out at this width, so it is also the widest the popover can be.
   */
  maxWidth: number;
  /**
   * Forwarded so tests and a11y tools can find the popover: the presented content gets
   * `<testID>-popover`.
   */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every native open or close, with native's event count (the wrapper echoes
   * it back as `mostRecentEventCount`). Not called for a change React asked for.
   *
   * Callback props are the exception to the no-optional rule (D7b). The wrapper always
   * sends one.
   */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /**
   * Nothing is up any more, so the content the wrapper mounted for the popover can go -
   * BottomSheet's rule, which D44 item 2 gives Popover as well. `ended` is true when a
   * presentation really ended (the popover was up and is gone, whoever closed it) and
   * false when React withdrew a popover that was not up.
   *
   * Sent once per presentation that ends, and once more for a `presented = false` that
   * finds nothing on screen after React had asked for the popover, so the wrapper's
   * unmount never depends on the order JS runs this and the parent's own re-render in.
   */
  onDismissed?: (ended: boolean) => void;
}

export interface NitroUiPopoverMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: what this popover is showing, as one `;`-separated line of
   * `key=value` pairs, read from what each platform actually built (the popover
   * controller on iOS, the composed popup on Android), and snapshotted on the UI thread
   * so JS never waits for the main thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
  /**
   * TEMPORARY, test-only: close the popover the way a tap outside does, through the same
   * path, so it emits `onPresentedChange(false)`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestDismiss(): void;
}

/**
 * The Hybrid View React renders as `NitroUiPopover`.
 *
 * @internal Not semver surface (DECISIONS D14): exported for this repo's example,
 * harness and bench apps, and for the typed `hybridRef` handle.
 */
export type NitroUiPopover = HybridView<
  NitroUiPopoverProps,
  NitroUiPopoverMethods
>;
