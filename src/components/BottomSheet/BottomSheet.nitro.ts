import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * One detent of a sheet, as the native side sees it.
 *
 * The public `BottomSheetDetent` (`BottomSheet.tsx`) is a union of strings and
 * objects; the wrapper flattens every member into this one struct, because
 * nitrogen has no tagged unions and every member of a struct that crosses the
 * bridge is required (the rule `NitroUiDialogAction` follows).
 *
 * `kind` is a `string` rather than a union because nitrogen has no string-literal
 * unions; the wrapper never sends anything but `'fit'`, `'medium'`, `'large'`,
 * `'height'` or `'fraction'`.
 */
export interface NitroUiSheetDetent {
  /** `'fit'`, `'medium'`, `'large'`, `'height'` or `'fraction'`. */
  kind: string;
  /**
   * The points (`'height'`) or the share of the largest height a sheet can have
   * (`'fraction'`, in `(0, 1]`). `0` for the other kinds.
   */
  value: number;
}

/**
 * Native props of the `NitroUiBottomSheet` Hybrid View (G14, DECISIONS D33/D35).
 *
 * No member is optional (DECISIONS D7 / nitro#1184) except the callbacks (D7b):
 * the wrapper always sends every prop, with `null` for "not set".
 *
 * A sheet is **not self-sizing** (`sizing: null` in `component.json`): the
 * platform lays out the presented window. The view React Native lays out is the
 * *content's* box: native reports the size the sheet gives its content
 * (`onContentBox`), the wrapper writes it into the node's `style`, and Yoga lays
 * the React Native children out at the sheet's width. The children are mounted
 * into this view, and this view is moved into the sheet while it is up.
 *
 * Whether the sheet is up is a controlled value behind the event-count
 * handshake (`docs/architecture/core.md` §4), exactly as a dialog's is.
 *
 * Setters must not interpret one prop against another (Nitro does not order
 * props inside a batch - core.md §3), so everything is stored raw and the
 * presentation is reconciled once, in `afterUpdate()`.
 */
export interface NitroUiBottomSheetProps extends HybridViewProps {
  /** The JS copy of `isPresented`: what React asked for. */
  presented: boolean;
  /**
   * The last event count JS has fully processed (core.md §4). Native only
   * accepts a `presented` write once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /**
   * The detents, in the order the app wrote them, validated by the wrapper: at
   * least one, no repeats. `onDetentChange` reports an index into this list.
   */
  detents: NitroUiSheetDetent[];
  /** Whether a swipe down, a tap outside or the back gesture closes the sheet. */
  dismissible: boolean;
  /** Whether the platform's grabber (iOS) or drag handle (Android) is drawn. */
  showsGrabber: boolean;
  /** The sheet's top corner radius in points, or `null` for the platform's. */
  cornerRadius: number | null;
  /** RN-processed (`processColor`) ARGB colour of the sheet, or `null`. */
  containerColor: number | null;
  /**
   * The sheet's accessibility name (Q5 C7), or `null`. Not RN's
   * `accessibilityLabel`: that one would name the content's box in the app's
   * own tree, which is not where the sheet is.
   */
  label: string | null;
  /**
   * Forwarded so tests and a11y tools can find the sheet: the presented sheet
   * gets `<testID>-sheet`.
   */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every native open or close, with native's event count (the
   * wrapper echoes it back as `mostRecentEventCount`). Not called for a change
   * React asked for.
   *
   * Callback props are the exception to the no-optional rule (D7b). The wrapper
   * always sends one.
   */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /**
   * Called when the user drags the sheet to another detent, with its index in
   * `detents`. Never called for the detent the sheet opens at.
   */
  onDetentChange?: (index: number) => void;
  /**
   * Nothing is up any more, so the content the wrapper mounted for the sheet can
   * go. `ended` is true when a presentation really ended - the sheet was up and is
   * gone, whoever closed it - and false when React withdrew a sheet that was not
   * up (never shown yet, or already gone while React still said `true`).
   *
   * Sent once per presentation that ends, and once more for a `presented = false`
   * that finds nothing on screen after React had asked for the sheet, so the
   * wrapper's unmount never depends on the order JS runs this and the parent's own
   * re-render in: a wrapper that still says `presented` simply mounts the content
   * again in the same render.
   */
  onDismissed?: (ended: boolean) => void;
  /**
   * The box the sheet gives its content, in points: the width always, and for a
   * sheet without `fit` the height. Called when it changes.
   */
  onContentBox?: (width: number, height: number) => void;
}

export interface NitroUiBottomSheetMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: what this sheet is showing, as one `;`-separated line
   * of `key=value` pairs, snapshotted on the UI thread and read from here without
   * waiting for it (JS never blocks on main).
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestStateReport(): string;
  /**
   * TEMPORARY, test-only: dismiss the sheet the way a user does (a swipe, a tap
   * outside, back), through the same path - so it emits
   * `onPresentedChange(false)`, and does nothing while `dismissible` is false.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestDismiss(): void;
  /**
   * TEMPORARY, test-only: move the sheet to the detent at `index` the way a drag
   * does, through the platform's own delegate path, so it reports
   * `onDetentChange(index)`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestSelectDetent(index: number): void;
}

/**
 * The Hybrid View React renders as `NitroUiBottomSheet`.
 *
 * @internal v0.1 does not expose Hybrid Views or their settable props publicly
 * (DECISIONS D14): it is exported for this repo's example, harness, bench and
 * smoke apps, and for the typed `hybridRef` handle, and is not semver surface.
 */
export type NitroUiBottomSheet = HybridView<
  NitroUiBottomSheetProps,
  NitroUiBottomSheetMethods
>;
