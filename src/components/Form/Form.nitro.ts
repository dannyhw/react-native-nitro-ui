import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The trailing accessory of a form row: `UICellAccessory` on iOS, a trailing Material
 * 3 icon on Android.
 */
export type NitroUiFormAccessory = 'none' | 'disclosure' | 'checkmark';

/**
 * Native props of the `NitroUiForm` Hybrid View - **the S6 spike prototype**.
 *
 * A Form is the scroll container of a grouped form: sections of rows, with the
 * platform's own grouped chrome. On iOS it is a `UICollectionView` with
 * `UICollectionLayoutListConfiguration(appearance: .insetGrouped)` whose
 * `UICollectionViewListCell`s hold the React Native rows; on Android the rows stay
 * where Yoga put them and Material 3 Expressive's segmented-list shapes are drawn
 * behind them (`docs/tasks/Q10-form-list-research.report.md` Appendix C1).
 *
 * A prototype, not a component (S6): no manifest, no export from `src/index.ts`, and
 * its API is an argument for G-Form rather than a promise. The Hybrid View rules still
 * apply - no optional member except callbacks (D7/D7b), every prop always sent, a
 * setter stores and `afterUpdate()` applies.
 *
 * No `style` or `testID` here, for the reason `ContextMenu.nitro.ts` gives: the wrapper
 * *is* the box React Native styles.
 */
export interface NitroUiFormProps extends HybridViewProps {
  /**
   * Keep the focused row visible while the keyboard is up. UIKit's collection view does
   * not avoid the keyboard, so the Form grows its bottom inset and scrolls the focused
   * row in. Android's `ScrollView` and `windowSoftInputMode` already do this, so the
   * work is iOS-only behind one shared name.
   */
  keyboardAvoidance: boolean;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * The width a row may be: the list's width, minus the section inset and the cell's
   * own margins. The wrapper writes it into every row's `style.width`, which is what
   * makes a row's Yoga height the height of its cell. The same round trip as
   * BottomSheet's `onContentBox`, and the reason it exists (Appendix C1's sizing).
   */
  onContentBox?: (width: number) => void;
}

export interface NitroUiFormMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: one line describing this Form as the platform sees it,
   * `key=value` pairs separated by `;` (`Form.harness.tsx` parses it).
   *
   * - `sections`, `rows`: what registered with this Form;
   * - `items`, `inCells`, `orphans` (iOS): the collection view's item count, the rows
   *   inside a cell right now, and the rows in neither a cell nor their section's
   *   holding view - an orphan is a row Fabric cannot find again;
   * - `live`: rows alive right now, read from a weak table - the leak witness;
   * - `reparents`, `reclaims` (iOS): moves into a cell, and back out;
   * - `width`: the last reported content width;
   * - `heights`: the first item heights, comma-joined (iOS: the layout's; Android: the
   *   rows' own Yoga heights);
   * - `taps`: row `onPress` calls delivered; `keyboard`: the bottom inset avoidance added;
   * - `shapes`, `pressed` (Android): shapes drawn, and rows pressed.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestFormReport(): string;

  /**
   * TEMPORARY, test-only: scroll the form to an absolute offset, so a scroll-through
   * cycle does not depend on a gesture reaching a view UIKit owns.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestScrollTo(y: number): void;

  /**
   * TEMPORARY, test-only, and iOS-only in effect: drive the SwiftUI `Form` used to answer
   * question 2 of Q10 Appendix E. Android has no platform `Form` to compare with, so every
   * command there is a no-op and the report keeps `kind=prototype`.
   *
   * - `show-reference` puts a SwiftUI `Form` with the same three sections into this Form's
   *   box, over the prototype's list;
   * - `hide-reference` takes it away;
   * - while it is up, `nuiTestFormReport()` describes *that* list, under the same field
   *   names, so the two are compared like for like rather than measured twice differently.
   *
   * The geometry fields are `kind`, `listW`, `x`, `w`, `h0..h2`, `radius`, `sep`,
   * `headerX`, `headerY`, `headerH`, `footerH`.
   *
   * @internal Not app API (DECISIONS D14), and a spike seam rather than a feature.
   */
  nuiTestCommand(command: string): void;
}

/**
 * Native props of the `NitroUiFormSection` Hybrid View - **the S6 spike prototype**.
 *
 * A Section is a run of rows with a header and a footer. On iOS it is a model: its
 * React Native children become that section's items and UIKit draws the header and
 * footer. On Android it keeps its children in place and owns the Compose layer that
 * draws the segmented shapes behind them.
 */
export interface NitroUiFormSectionProps extends HybridViewProps {
  /** The header, or `null`: `UIListContentConfiguration.groupedHeader()` / M3 typography. */
  title: string | null;
  /** The footer, or `null`: the same in `groupedFooter()` style. */
  footer: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * The four numbers only native knows, reported on change and written by the wrapper
   * into the rows' container: `headerHeight` and `footerHeight` (the space the
   * natively-drawn header and footer text take, which Yoga must still reserve),
   * `inset` (a row's horizontal inset from the section's edge) and `gap` (the space
   * between two segmented shapes; 0 on iOS, where the list's layout supplies it).
   */
  onMetrics?: (
    headerHeight: number,
    footerHeight: number,
    inset: number,
    gap: number
  ) => void;
}

export interface NitroUiFormSectionMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: `key=value` report - `rows`, `index` (this section's position
   * in the Form), `title`, `footer`, and on Android `gap`, `inset` and the row rects the
   * shape layer was given.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestSectionReport(): string;
}

/**
 * Native props of the `NitroUiFormRow` Hybrid View - **the S6 spike prototype**.
 *
 * A Row is one cell. Its React Native children stay where Yoga put them (`sizing:
 * null`), and the platform draws the cell's chrome around them: on iOS the row's
 * component view is what moves into the `UICollectionViewListCell`; on Android the row
 * watches its own touches and feeds a press to its section's shape layer.
 */
export interface NitroUiFormRowProps extends HybridViewProps {
  /** The trailing accessory. `'none'` adds nothing. */
  accessory: NitroUiFormAccessory;
  /** Selected state: the cell's selected background on iOS, `secondaryContainer` on Android. */
  selected: boolean;
  /** Whether this row has an `onPress`: the cell's selection, highlight and a11y role. */
  pressable: boolean;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /** Called when the row is tapped, through the platform's own cell selection. */
  onPress?: () => void;
}

export interface NitroUiFormRowMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: `key=value` report - `where` (iOS: `cell` or `holding`),
   * `frame` (the row's box in its current superview), `h` (the height the last Fabric
   * layout gave it), `presses`, `taps`.
   *
   * @internal Not app API (DECISIONS D14).
   */
  nuiTestRowReport(): string;
}

/** The Hybrid View React renders as `NitroUiForm`. @internal Not semver surface (D14). */
export type NitroUiForm = HybridView<NitroUiFormProps, NitroUiFormMethods>;

/** The Hybrid View React renders as `NitroUiFormSection`. @internal Not semver surface (D14). */
export type NitroUiFormSection = HybridView<
  NitroUiFormSectionProps,
  NitroUiFormSectionMethods
>;

/** The Hybrid View React renders as `NitroUiFormRow`. @internal Not semver surface (D14). */
export type NitroUiFormRow = HybridView<
  NitroUiFormRowProps,
  NitroUiFormRowMethods
>;
