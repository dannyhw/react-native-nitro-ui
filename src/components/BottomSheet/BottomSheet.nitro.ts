import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * One detent of a sheet, flattened from the public `BottomSheetDetent` union:
 * nitrogen has no tagged unions and no string-literal unions.
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
 * Native props of the `NitroUiBottomSheet` Hybrid View.
 *
 * No prop is optional except the callbacks: a removed prop arrives as `null`,
 * which crashes an optional one (nitro#1184). The wrapper always sends every prop.
 *
 * This view is the content's box, not the sheet: native reports the size the
 * sheet gives its content (`onContentBox`), the wrapper writes it into `style`,
 * and the view is moved into the sheet while it is up.
 *
 * Nitro does not order props inside a batch, so setters store raw values and
 * the presentation is reconciled once, in `afterUpdate()`.
 */
export interface NitroUiBottomSheetProps extends HybridViewProps {
  /** The JS copy of `isPresented`: what React asked for. */
  presented: boolean;
  /**
   * The last event count JS has fully processed. Native accepts a `presented`
   * write only once it has seen this many of its own events.
   */
  mostRecentEventCount: number;
  /**
   * The detents, in the order the app wrote them, validated by the wrapper: at
   * least one, no repeats. `onDetentChange` reports an index into this list.
   */
  detents: NitroUiSheetDetent[];
  /** Whether a swipe down, a tap outside or the back gesture closes the sheet. */
  dismissible: boolean;
  showsGrabber: boolean;
  /** The sheet's top corner radius in points, or `null` for the platform's. */
  cornerRadius: number | null;
  /** RN-processed (`processColor`) ARGB colour of the sheet, or `null`. */
  containerColor: number | null;
  /**
   * The sheet's accessibility name, or `null`. Not `accessibilityLabel`, which
   * would name the content's box in the app's own tree rather than the sheet.
   */
  label: string | null;
  /** The presented sheet gets `<testID>-sheet`. */
  testID: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Called on every native open or close, with native's event count. Not called
   * for a change React asked for.
   *
   * Callbacks are the exception to the no-optional rule: Nitro only unwraps a
   * callback prop whose type is a plain function. The wrapper always sends one.
   */
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  /**
   * Called when the user drags the sheet to another detent, with its index in
   * `detents`. Never called for the detent the sheet opens at.
   */
  onDetentChange?: (index: number) => void;
  /**
   * Nothing is up any more, so the wrapper can unmount the sheet's content.
   * `ended` is true when a presentation really ended, and false when React
   * withdrew a sheet that was not up (never shown, or already gone).
   *
   * Sent once per presentation that ends, and also for a `presented = false`
   * that finds nothing on screen after React had asked for the sheet.
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
   * Test-only: what this sheet is showing, as one `;`-separated line of
   * `key=value` pairs. Reads a snapshot, so it never waits for the UI thread.
   *
   * @internal Not app API.
   */
  nuiTestStateReport(): string;
  /**
   * Test-only: dismiss the sheet the way a user does, so it emits
   * `onPresentedChange(false)` and does nothing while `dismissible` is false.
   *
   * @internal Not app API.
   */
  nuiTestDismiss(): void;
  /**
   * Test-only: move the sheet to the detent at `index` the way a drag does, so it
   * reports `onDetentChange(index)`.
   *
   * @internal Not app API.
   */
  nuiTestSelectDetent(index: number): void;
  /**
   * Test-only (iOS): have UIKit refuse this sheet's next present, the way it refuses
   * one that races a presentation which got there first. Nothing on Android, where
   * there is no presentation for UIKit to refuse.
   *
   * @internal Not app API.
   */
  nuiTestRefuseNextPresent(): void;
}

/**
 * The Hybrid View React renders as `NitroUiBottomSheet`.
 *
 * @internal Not public and not semver surface: exported for this repo's example,
 * tests and benchmarks, and for the typed `hybridRef` handle.
 */
export type NitroUiBottomSheet = HybridView<
  NitroUiBottomSheetProps,
  NitroUiBottomSheetMethods
>;
