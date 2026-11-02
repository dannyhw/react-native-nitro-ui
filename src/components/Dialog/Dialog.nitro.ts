import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * One button of a dialog, as the native side sees it.
 *
 * The public `DialogAction` (`Dialog.tsx`) has optional `role` and `disabled`;
 * the wrapper fills both in, because every member of a struct that crosses the
 * bridge is required here (the same rule as `NitroUiMenuRow`): a row that a JS
 * spread produced must never make native ask "absent or false?".
 *
 * `role` is a `string` rather than a union because nitrogen has no string-literal
 * unions; the wrapper resolves anything unrecognised to `'default'` before it
 * sends, so native only ever sees `'default'`, `'cancel'` or `'destructive'`.
 */
export interface NitroUiDialogAction {
  /** What `onAction` reports. Unique across the dialog's actions, and stable. */
  id: string;
  /** The button's text. */
  title: string;
  /** `'default'`, `'cancel'` or `'destructive'`. At most one `'cancel'`. */
  role: string;
  /** Draw the button disabled. A disabled button reports nothing. */
  disabled: boolean;
}

/**
 * Native props of the `NitroUiDialog` Hybrid View - the one native view behind
 * both `AlertDialog` and `ConfirmationDialog` (DECISIONS D33).
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks (D7b):
 * Fabric sends `null` for a prop that JS removed and Nitro only treats
 * `undefined` as "unset", so an optional prop that goes away crashes. The JS
 * wrapper always sends every prop, using `null` for "not set".
 *
 * A dialog is **not self-sizing** (`sizing: null` in `component.json`): the
 * platform lays out the presented window, and the view React Native sees is a
 * `0 x 0` anchor. So there is no `NitroUiIntrinsicProps` here - no sizing key,
 * no sizing id, no `measureContent()`.
 *
 * Whether the dialog is up is a controlled value behind the event-count
 * handshake (`docs/architecture/core.md` §4), the same as a Switch's `value`:
 * `presented` is what React asked for, native owns what is on screen, and every
 * native open or close is reported with a fresh count that the wrapper echoes
 * back as `mostRecentEventCount`. That is what lets a dismissal the app refuses
 * present the dialog again (D33), and what lets an app that ignores
 * `onIsPresentedChange` still reopen the dialog by writing `true` again.
 *
 * Setters must not interpret one prop against another (Nitro does not order
 * props inside a batch - core.md §3), so everything is stored raw and the
 * presentation is reconciled once, in `afterUpdate()`.
 */
export interface NitroUiDialogProps extends HybridViewProps {
  /** `'alert'` or `'confirmation'`. Anything else behaves as `'alert'`. */
  variant: string;
  /** The JS copy of `isPresented`: what React asked for. */
  presented: boolean;
  /**
   * The last event count JS has fully processed (core.md §4). Native only
   * accepts a `presented` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /** The dialog's title. Also its accessibility name (no separate label). */
  title: string;
  /** The body text under the title, or `null` for none. */
  message: string | null;
  /**
   * `'automatic'`, `'visible'` or `'hidden'` - SwiftUI's `Visibility` for a
   * confirmation dialog's title. Ignored by the `alert` variant, which always
   * shows its title.
   */
  titleVisibility: string;
  /** The buttons, in the order the caller wrote them. At least one. */
  actions: NitroUiDialogAction[];
  /**
   * Whether an outside tap, the back gesture or a swipe closes the dialog.
   * An action tap always closes it.
   */
  dismissible: boolean;
  /** RN-processed (`processColor`) ARGB colour of the buttons, or `null`. */
  tintColor: number | null;
  /**
   * Forwarded so tests and a11y tools can find the dialog: the view keeps
   * React Native's `testID`, and the presented window gets `<testID>-dialog`.
   */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every native open or close, with native's event count (the
   * wrapper echoes it back as `mostRecentEventCount`).
   *
   * Not called for a change React asked for: writing `presented = false`
   * dismisses the dialog with no event, because that was not a native
   * interaction.
   *
   * Callback props are the exception to the no-optional rule (D7b): Nitro only
   * unwraps `{ f: fn }` for a prop whose type *is* a function. The wrapper
   * always sends one.
   */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /**
   * Called when the user taps an action, with its id - always *before* the
   * `onPresentedChange(false)` the tap also causes (D32's order).
   */
  onAction?: (id: string) => void;
}

export interface NitroUiDialogMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: what this dialog is showing, as one `;`-separated
   * line of `key=value` pairs, read from the controller iOS actually built and
   * from the Android model as composed. Safe from any thread: the answer is
   * snapshotted under a lock on the UI thread and read from here, so JS never
   * waits for the main thread.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
  /**
   * TEMPORARY, test-only: run the real handler of the action with this id, as
   * a tap on its button would (a presented window is out of the harness's
   * reach). A disabled or unknown action does nothing, as a tap would.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestPerformAction(id: string): void;
  /**
   * TEMPORARY, test-only: dismiss the dialog the way a user dismissal without
   * an action does (outside tap, back, swipe), through the same path - so it
   * emits `onPresentedChange(false)`, and does nothing while `dismissible` is
   * false.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestDismiss(): void;
}

/**
 * The Hybrid View React renders as `NitroUiDialog`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiDialog = HybridView<
  NitroUiDialogProps,
  NitroUiDialogMethods
>;
