import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/** The trailing accessory of a form row: a disclosure chevron or a checkmark. */
export type NitroUiFormAccessory = 'none' | 'disclosure' | 'checkmark';

/**
 * Native props of the `NitroUiForm` Hybrid View: a grouped, scrolling list of sections. On iOS
 * it is an inset-grouped `UICollectionView` whose cells hold the React Native rows; on Android
 * the rows stay inside React Native's own scroll view with Material shapes drawn behind them.
 */
export interface NitroUiFormProps extends HybridViewProps {
  /** Keep the focused row visible while the keyboard is up. */
  keyboardAvoidance: boolean;
  /**
   * How far the list is scrolled as of its last settle; `null` means not scrolled. The Form's
   * shadow node subtracts it, so `measure` on a row answers where the row is drawn. Android
   * ignores it: React Native's own `ScrollView` already carries the offset.
   */
  nuiContentOffsetY: number | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * The width a plain row's cell gives its content, reported once per list width. A row with a
   * trailing accessory is narrower and follows {@link NitroUiFormRowProps.onContentBox}.
   */
  onContentBox?: (width: number) => void;
  /** How far the list is scrolled, reported once per settle for the whole Form. */
  onContentOffset?: (y: number) => void;
  /**
   * Android only: the keyboard inset the window did not absorb by resizing, in dp, reported on
   * change (`0` when the keyboard is down). The wrapper reserves it at the end of the content.
   */
  onImeInset?: (inset: number) => void;
}

export interface NitroUiFormMethods extends HybridViewMethods {
  /**
   * Test-only: one line describing this Form as the platform sees it, as `key=value` pairs
   * separated by `;`.
   *
   * @internal
   */
  nuiTestFormReport(): string;

  /**
   * Test-only: scroll the form to an absolute offset without a gesture.
   *
   * @internal
   */
  nuiTestScrollTo(y: number): void;

  /**
   * Test-only, and a no-op on Android: `scroll-no-report` moves the list 60 pt without
   * reporting it, `scroll-animated` moves it 60 pt animated, and `self-sizing-off` turns off
   * the list's self-sizing invalidation.
   *
   * @internal
   */
  nuiTestCommand(command: string): void;
}

/**
 * Native props of the `NitroUiFormSection` Hybrid View (`Form.Section`): a run of rows with a
 * header and a footer. On iOS its children become the section's list items and UIKit draws the
 * header and footer; on Android it draws the row shapes and the header text behind its children.
 */
export interface NitroUiFormSectionProps extends HybridViewProps {
  /** The header text, or `null` for none. */
  title: string | null;
  /** The footer text, or `null` for none. */
  footer: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * Reported on change: the heights of the natively drawn header and footer (Yoga must still
   * reserve that space), a row's inset from the section's edge, and the gap between two row
   * shapes (0 on iOS).
   */
  onMetrics?: (
    headerHeight: number,
    footerHeight: number,
    inset: number,
    gap: number
  ) => void;
  /**
   * iOS only: the top of this section in the list's content coordinates (`0` on Android). The
   * wrapper positions the section there, so each row's Yoga origin matches its cell.
   */
  onPlacement?: (top: number) => void;
}

export interface NitroUiFormSectionMethods extends HybridViewMethods {
  /**
   * Test-only: a `key=value` report of this section's rows and its header and footer sizes.
   *
   * @internal
   */
  nuiTestSectionReport(): string;
}

/**
 * Native props of the `NitroUiFormRow` Hybrid View (`Form.Row`): one cell. Its children stay
 * where Yoga put them, and the platform draws the cell's chrome around them.
 */
export interface NitroUiFormRowProps extends HybridViewProps {
  /** The trailing accessory. `'none'` adds nothing. */
  accessory: NitroUiFormAccessory;
  /** Selected state: the cell's selected background on iOS, `secondaryContainer` on Android. */
  selected: boolean;
  /** Whether this row has an `onPress`: the cell's highlight, and its single a11y element. */
  pressable: boolean;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /** Called when the row is tapped. */
  onPress?: () => void;
  /**
   * iOS only: the width this row's cell gives its content, which the row's `style.width`
   * follows. It is per row because a cell with a trailing accessory is narrower, and a row laid
   * out wider than its cell draws content where UIKit's hit-test never looks.
   */
  onContentBox?: (width: number) => void;
}

export interface NitroUiFormRowMethods extends HybridViewMethods {
  /**
   * Test-only: a `key=value` report of where the row is and how it was last laid out.
   *
   * @internal
   */
  nuiTestRowReport(): string;
  /**
   * Test-only, Android only: perform `ACTION_CLICK` on the row's own view, the way TalkBack's
   * double-tap does.
   *
   * @internal
   */
  nuiTestA11yClick(): void;
}

/** The Hybrid View React renders as `NitroUiForm`. @internal */
export type NitroUiForm = HybridView<NitroUiFormProps, NitroUiFormMethods>;

/** The Hybrid View React renders as `NitroUiFormSection`. @internal */
export type NitroUiFormSection = HybridView<
  NitroUiFormSectionProps,
  NitroUiFormSectionMethods
>;

/** The Hybrid View React renders as `NitroUiFormRow`. @internal */
export type NitroUiFormRow = HybridView<
  NitroUiFormRowProps,
  NitroUiFormRowMethods
>;
