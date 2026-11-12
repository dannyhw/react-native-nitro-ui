import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/**
 * The trailing accessory of a form row.
 *
 * `disclosure` is UIKit's `UICellAccessory.disclosureIndicator` and Material's
 * `chevron_right`; `checkmark` is `UICellAccessory.checkmark` and Material's `check`.
 * Neither is drawn from a typed-out path (D43): on Android both are Google's own Material
 * Symbols drawables, loaded through `NitroUiIcons`.
 */
export type NitroUiFormAccessory = 'none' | 'disclosure' | 'checkmark';

/**
 * Native props of the `NitroUiForm` Hybrid View.
 *
 * A `Form` is a grouped, scrolling form: sections of rows, with the platform's own grouped
 * chrome. On iOS it *is* a `UICollectionView` with
 * `UICollectionLayoutListConfiguration(appearance: .insetGrouped)` whose list cells hold the
 * React Native rows; on Android the rows stay where Yoga put them, inside React Native's own
 * scroll view, with Material 3 Expressive's segmented-list shapes drawn behind them
 * (docs/tasks/Q10-form-list-research.report.md Appendix C1, and D45).
 *
 * No member is optional (D7 / nitro#1184) except callbacks (D7b), and `Form.tsx` always
 * sends every prop. Setters store and mark dirty; `afterUpdate()` applies.
 *
 * No `style` or `testID` here, for the reason `ContextMenu.nitro.ts` gives: the wrapper *is*
 * the box React Native styles.
 */
export interface NitroUiFormProps extends HybridViewProps {
  /**
   * Keep the focused row visible while the keyboard is up. Neither platform does this on its
   * own for an input hosted inside a list cell (iOS: a collection view does not avoid the
   * keyboard; Android: React Native's scroll-to-focused-view only knows a scroll view's
   * *direct* children), so the Form owns it on both (D45 item 1).
   */
  keyboardAvoidance: boolean;
  /**
   * How far the list is scrolled, as of its last settle — the one number the Form's shadow
   * node turns into the correction every descendant needs.
   *
   * Why a shadow-node prop at all: `measure`/`measureInWindow` never ask a platform view
   * where something ended up. In 0.88 they reach
   * `react/renderer/dom/DOM.cpp`'s `computeRelativeLayoutMetrics`, which walks the *shadow*
   * tree and per ancestor adds its Yoga `frame.origin` plus that ancestor's
   * `getContentOriginOffset(true)` — exactly the hook React Native's own `ScrollViewShadowNode`
   * overrides (`ScrollViewShadowNode.cpp:67`). A row is laid out by Yoga at its position in
   * the list's *content* (each section stands at the y the list gave it, each row at its
   * offset within that section), so a Form node returning `-contentOffset` is what makes a
   * row — and everything inside it — measure where it is drawn (D45 items 3–4). Nothing is
   * needed horizontally: a row's own inset padding already puts it at the cell's content
   * edge.
   *
   * It is a *settle-time* answer. The list moves cells every scroll frame and JS cannot be
   * told about each one, so `measure` is right when the Form is at rest and lags by the
   * scroll distance while it moves — which is what `docs/components/form.md` says out loud.
   *
   * `null` means "not scrolled", which is also the state before the first settle. Android
   * ignores it: there the Form sits inside React Native's own `ScrollView`, whose shadow
   * node already carries the offset.
   */
  nuiContentOffsetY: number | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * The width a row may be: the list's width minus the section insets and the cell's own
   * margins — on iOS the box a cell actually draws a row in, which is narrower than the
   * list's idea of a cell. The wrapper writes it into every row's `style.width`, which is
   * what makes a row's Yoga height the height of its cell (the same round trip as
   * BottomSheet's `onContentBox`).
   */
  onContentBox?: (width: number) => void;
  /**
   * How far the list is scrolled, reported when it settles — the number that goes straight
   * back in as {@link NitroUiFormProps.nuiContentOffsetY}.
   *
   * One call per settle, for the whole Form: not one per row, which is what the S6 spike did
   * and what made a settle cost a re-render per visible row.
   */
  onContentOffset?: (y: number) => void;
  /**
   * Android only in effect: the `ime` window inset the app's window did not consume by
   * resizing, in dp, reported whenever it changes (`0` when the keyboard is down, or when the
   * window already shrank for it).
   *
   * The Form cannot add it to the scroll view's viewport — that view is React Native's, and
   * above the Form — so the wrapper reserves it at the end of the scroll content, which is
   * what lets the last row be scrolled clear of the keyboard at all (D45 item 1).
   */
  onImeInset?: (inset: number) => void;
}

export interface NitroUiFormMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: one line describing this Form as the platform sees it, `key=value`
   * pairs separated by `;` (`example/__tests__/Form.harness.tsx` parses it).
   *
   * - `sections`, `rows`: what registered with this Form;
   * - `items`, `inCells`, `orphans` (iOS): the collection view's item count, the rows inside
   *   a cell right now, and the rows in neither a cell nor their section's holding view — an
   *   orphan is a row Fabric cannot find again;
   * - `live`: rows alive right now, read from a weak table — the leak witness;
   * - `reparents`, `reclaims` (iOS): moves into a cell, and back out;
   * - `recycles`: how many times *this view* has been prepared for reuse — the witness that the
   *   Form reading the field is the one a previous Form finished with, which is the only way a
   *   claim about what a recycle leaves behind can be aimed at something;
   * - `inCells` against the fourth number of `screen=` (iOS): the rows in a cell against the
   *   items the list is drawing. Equal exactly when nothing on screen is a blank row — a row can
   *   be alive, counted and in its section's model while the cell drawing its item holds nothing;
   * - `width`: the last reported content width; `box`/`boxReports`: the width a cell really
   *   draws a row at against the width it reported — the witness that a cell knows its Form,
   *   whose absence laid every row out 64 pt too wide and stopped UIKit hit-testing it;
   * - `offset`: where the list's content actually is, and `origin`: the last offset a settle
   *   published to React — the two disagree while a publish is in flight or was never heard,
   *   which is the difference between "the list is at 300" and "the shadow tree was told 300";
   *   `received`: the offset React sent back, so the number the shadow node is correcting by;
   *   `listY`/`insetTop` (iOS): the two constants a section's placement is built from — how far
   *   the list sits inside the Form's box, and the list's own top inset;
   * - `heights`: the first item heights, comma-joined (iOS: the layout's; Android: the rows'
   *   own Yoga heights);
   * - `taps`: row `onPress` calls delivered; `keyboard`: the bottom inset avoidance added;
   *   `ime`: the IME inset reported; `insetBottom`/`adjBottom`: the inset the list is carrying
   *   against the one every keyboard decision is measured against (`adjBottom` is what the
   *   content is padded by, safe area included);
   * - `offsetPublishes`: how many offsets have actually reached React. One per settle is the
   *   contract, so a number climbing by one per frame says a scroll is being reported frame by
   *   frame; `selfSizing` (iOS): whether the list still notices a row's height constraint on its
   *   own — `0` means the `rowResized` fallback is the only thing that can grow a row;
   * - `shapes`, `pressed` (Android): shapes drawn, and rows pressed.
   *
   * @internal Not app API (D14).
   */
  nuiTestFormReport(): string;

  /**
   * TEMPORARY, test-only: scroll the form to an absolute offset, so a scroll-through cycle
   * does not depend on a gesture reaching a view UIKit owns, and so a harness can ask for a
   * settle without a finger.
   *
   * @internal Not app API (D14).
   */
  nuiTestScrollTo(y: number): void;

  /**
   * TEMPORARY, test-only, and iOS-only in effect: drive the SwiftUI `Form` the fidelity table
   * compares this component against. Android has no platform `Form` to compare with, so every
   * command there is a no-op and its report keeps `kind=prototype`.
   *
   * - `show-reference` puts a SwiftUI `Form` with the same three sections into this Form's
   *   box, over the list;
   * - `hide-reference` takes it away;
   * - `scroll-no-report` moves the list 60 pt without reporting it, the shape of every settle
   *   callback that used to be missing;
   * - `scroll-animated` moves it 60 pt with `animated: true`, which is the keyboard path's shape
   *   and the one that publishes a frame at a time if nothing guards it;
   * - `self-sizing-off` takes `selfSizingInvalidation` away from the list, which is how iOS 15
   *   behaves permanently and what lets the `rowResized` fallback be tested on a modern OS;
   * - while it is up, `nuiTestFormReport()` describes *that* list under the same field names,
   *   so the two are compared like for like rather than measured twice differently.
   *
   * The geometry fields are `kind`, `listW`, `x`, `w`, `h0..h2`, `radius`, `sep`, `headerX`,
   * `headerY`, `headerH`, `footerH`.
   *
   * @internal Not app API (D14), and a measurement seam rather than a feature.
   */
  nuiTestCommand(command: string): void;
}

/**
 * Native props of the `NitroUiFormSection` Hybrid View (`Form.Section`).
 *
 * A Section is a run of rows with a header and a footer. On iOS it is a model: its React
 * Native children become that section's items and UIKit draws the header and footer. On
 * Android it keeps its children in place and owns the one Compose layer that draws the
 * segmented shapes and the header text behind them (D45 item 2).
 */
export interface NitroUiFormSectionProps extends HybridViewProps {
  /** The header, or `null`: `UIListContentConfiguration.groupedHeader()` / M3 typography. */
  title: string | null;
  /** The footer, or `null`: the same in `groupedFooter()` style. */
  footer: string | null;
  /** Benchmark instance id for perf marks; `null` disables marks for this view. */
  nuiPerfId: number | null;
  /**
   * The four numbers only native knows, reported on change and written by the wrapper into
   * the row container: `headerHeight` and `footerHeight` (the space the natively-drawn header
   * and footer text take, which Yoga must still reserve — the platform draws them, Yoga
   * positions the rows between them), `inset` (a row's inset from the section's edge) and
   * `gap` (the space between two segmented shapes; 0 on iOS, whose list layout has none).
   */
  onMetrics?: (
    headerHeight: number,
    footerHeight: number,
    inset: number,
    gap: number
  ) => void;
  /**
   * iOS only in effect: where the list put the top of this section, in the list's own content
   * coordinates (`0` on Android, where the section flows inside the scroll view).
   *
   * The wrapper positions the section there, which is what makes each row's Yoga origin the
   * position of its cell in the content — and therefore what makes the Form's single
   * `-contentOffset` correction enough to fix `measure` for every row at once.
   */
  onPlacement?: (top: number) => void;
}

export interface NitroUiFormSectionMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: `key=value` report — `rows`, `index` (this section's position in
   * the Form), `title`, `footer`, `headerBand`/`headerText`/`footerBand` (the space Yoga
   * reserves against what the text needed: the band has to be at least the text plus its
   * leading, which is the assertion that keeps a row from painting over a header), and on
   * Android `gap`, `inset` and the row rects the shape layer was given.
   *
   * @internal Not app API (D14).
   */
  nuiTestSectionReport(): string;
}

/**
 * Native props of the `NitroUiFormRow` Hybrid View (`Form.Row`).
 *
 * A Row is one cell. Its React Native children stay where Yoga put them (`sizing: null`), and
 * the platform draws the cell's chrome around them: on iOS the row's component view is what
 * moves into the list cell; on Android the row watches its own touches and feeds a press to
 * its section's shape layer without taking a touch from anything inside it.
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
  /** Called when the row is tapped, through the platform's own cell highlight. */
  onPress?: () => void;
  /**
   * The width *this row's* cell gives its content, reported whenever the cell lays the row
   * out — the number this row's `style.width` follows.
   *
   * It is per row because the box is per row: a cell that draws a trailing accessory shrinks
   * its own content margins for it, so an accessory row on the same screen is 22 pt narrower
   * than its plain neighbours. The Form's {@link NitroUiFormProps.onContentBox} is one number
   * for the whole list, which can only be right for one of the two — and being too wide is
   * not a cosmetic error, because a row laid out wider than its own box draws content past
   * its bounds, where UIKit's hit-test never looks (X29).
   *
   * iOS only in effect: Android has no cells, so every row there is laid out at the width the
   * list gives it and the row reserves its accessory's room with padding instead.
   */
  onContentBox?: (width: number) => void;
}

export interface NitroUiFormRowMethods extends HybridViewMethods {
  /**
   * TEMPORARY, test-only: `key=value` report — `where` (iOS: `cell` or `holding`), `frame`
   * (the row's box in its current superview), `box` (the width the cell gives the row), `h`
   * (the height the last Fabric layout gave it), `laid` (the width the row's React content was
   * last laid out at, which is only ever `frame`'s width or less), `presses`, `taps`, and
   * `yoga` (the row's own Yoga origin, which is what `measure` starts from).
   *
   * @internal Not app API (D14).
   */
  nuiTestRowReport(): string;
  /**
   * TEMPORARY, test-only: perform `ACTION_CLICK` on the row's own view, the way TalkBack's
   * double-tap does — the accessibility path to `onPress`, not a touch.
   *
   * Android only, because that is where the promise has a second half to test: the row is
   * `clickable`, so the framework offers the action, and a `ReactViewGroup` has no click
   * listener for it to reach. iOS activation is answered by UIKit's synthesised centre tap on
   * the cell, which no method can invoke from here — see `docs/tasks/FOLLOWUPS.md`.
   *
   * @internal Not app API (D14).
   */
  nuiTestA11yClick(): void;
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
