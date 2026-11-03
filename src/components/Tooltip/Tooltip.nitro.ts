import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * One button of a tooltip, as the native side sees it. The public
 * `TooltipAction` (`Tooltip.tsx`) has the same two members, both required.
 */
export interface NitroUiTooltipAction {
  /** What `onAction` reports. Unique across the tooltip's actions, and stable. */
  id: string;
  /** The button's text. */
  title: string;
}

/**
 * Native props of the `NitroUiTooltip` Hybrid View.
 *
 * The view has **no children** (Q7 Appendix C1): the JS wrapper is a plain React
 * Native `View` around the anchor, and this view fills it absolutely, behind the
 * anchor, taking no touches. Its box *is* the anchor - iOS presents the popover from
 * it (`sourceView`), Android composes Material 3's `TooltipBox` around an empty box
 * that fills it. So the tooltip is **not self-sizing** (`sizing: null` in
 * `component.json`): no `NitroUiIntrinsicProps`, no sizing key, no `measureContent()`.
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks (D7b): the
 * JS wrapper always sends every prop, using `null` for "not set".
 *
 * Whether the tooltip is up is a controlled value behind the event-count handshake
 * (`docs/architecture/core.md` §4), exactly as a dialog's is: `presented` is what
 * React asked for, native owns what is on screen, and every native close is reported
 * with a fresh count that the wrapper echoes back as `mostRecentEventCount`. That is
 * what lets a dismissal the app refuses present the tooltip again (D33).
 *
 * Setters must not interpret one prop against another (Nitro does not order props
 * inside a batch - core.md §3), so everything is stored raw and the presentation is
 * reconciled once, in `afterUpdate()`.
 */
export interface NitroUiTooltipProps extends HybridViewProps {
  /** The JS copy of `isPresented`: what React asked for. */
  presented: boolean;
  /**
   * The last event count JS has fully processed (core.md §4). Native only accepts a
   * `presented` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /** The tooltip's text. Also what a screen reader announces. */
  message: string;
  /** The title above the message, or `null` for none. */
  title: string | null;
  /**
   * The buttons, in the order the caller wrote them. At most two; none for a tip
   * that only an outside tap (or the app) closes. With a title or an action Android
   * draws Material's rich tooltip, otherwise its plain one.
   */
  actions: NitroUiTooltipAction[];
  /** `'auto'`, `'above'` or `'below'`. Anything else behaves as `'auto'`. */
  placement: string;
  /**
   * Forwarded so tests and a11y tools can find the tooltip: the presented content
   * gets `<testID>-tooltip`.
   */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every native close, with native's event count (the wrapper echoes it
   * back as `mostRecentEventCount`): a tap outside, Back (an actionable Android
   * tooltip), the anchor leaving its window, or an action. A move of the anchor is
   * not a close: the tooltip follows it.
   *
   * Not called for a change React asked for: writing `presented = false` closes the
   * tooltip with no event.
   */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /**
   * Called when the user taps an action, with its id - always *before* the
   * `onPresentedChange(false)` the tap also causes (D32's order).
   */
  onAction?: (id: string) => void;
}

export interface NitroUiTooltipMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: what this tooltip is showing, as one `;`-separated line of
   * `key=value` pairs, read from what each platform actually built (the popover
   * controller on iOS, the composed tooltip on Android). Safe from any thread: the
   * answer is snapshotted on the UI thread and read under a lock here, so JS never
   * waits for the main thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
  /**
   * TEMPORARY, test-only: run the real handler of the action with this id, as a tap
   * on its button would. An unknown action does nothing.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPerformAction(id: string): void;
  /**
   * TEMPORARY, test-only: dismiss the tooltip the way a tap outside does, through
   * the same path, so it emits `onPresentedChange(false)`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestDismiss(): void;
}

/**
 * The Hybrid View React renders as `NitroUiTooltip`.
 *
 * @internal Not semver surface (DECISIONS D14): exported for this repo's example,
 * harness and bench apps, and for the typed `hybridRef` handle.
 */
export type NitroUiTooltip = HybridView<
  NitroUiTooltipProps,
  NitroUiTooltipMethods
>;
