import {
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useStableCallback } from '../../core/useStableCallback';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiFormAccessory as FormAccessory } from './Form.nitro';
import {
  NativeNitroUiForm,
  NativeNitroUiFormRow,
  NativeNitroUiFormSection,
} from './NativeFormViews';

const IOS = Platform.OS === 'ios';

/**
 * The trailing accessory of a form row, as an app names it.
 *
 * `disclosure` is UIKit's `UICellAccessory.disclosureIndicator` and Material Symbols'
 * `chevron_right`; `checkmark` is `UICellAccessory.checkmark` and `check`. Neither is
 * drawn from a typed-out path (D43).
 *
 * The public name of `NitroUiFormAccessory` in `Form.nitro.ts`, which the native side
 * answers to — the same three strings, one definition, exported under the name the
 * entry point publishes so api-extractor does not ask for the internal one.
 */
export type { FormAccessory };

/**
 * The room an Android accessory takes at a row's trailing edge: the section draws the glyph
 * there (`FormListMetrics` in `HybridNitroUiFormSection.kt`, whose comment says this file
 * reserves the room), and a row's content is React Native's, so only this file can move it
 * out of the way. Values mirror that object plus an 8 dp gap, the Material spacing between
 * content and an accessory; `androidRow` already carries the 16 dp edge padding, so what a
 * row adds is the glyph and the gap.
 */
const ANDROID_ACCESSORY_RESERVE = 24 + 8;

/**
 * `Form`, `Form.Section` and `Form.Row` — grouped settings-style lists whose rows are
 * ordinary React Native views (D45, Q10 Appendix C1).
 *
 * What the platform draws is the *grouping*: on iOS a `UICollectionView` in `.insetGrouped`
 * appearance whose list cells hold the rows; on Android the Material 3 Expressive
 * segmented-list shapes behind rows that stay exactly where Yoga put them. What React
 * Native lays out is the *row*: any view can be a row, with no wrapper, and a nitro-ui
 * control in a row is the same standalone control it is anywhere else.
 *
 * Three things every reader of this file needs:
 *
 * 1. **iOS lays rows out at the width a cell gives them**, which is narrower than the
 *    list's idea of a cell, so the Form reports it (`onContentBox`) and each row's
 *    `style.width` follows. A row's Yoga height is then the height of its content; the cell
 *    adds its own chrome, which is the `gap` of item 2.
 * 2. **A section reserves what the platform draws around its rows** — the header and footer
 *    bands, because those are drawn natively while the rows between them are laid out by
 *    Yoga, and the space between adjacent rows (`onMetrics`, spent as each row's
 *    `marginVertical`). On iOS the section also takes the vertical position the list gave it
 *    (`onPlacement`), so a row's Yoga origin *is* the position its cell is drawn at. That is
 *    what lets the Form's shadow node correct `measure` with one number — the scroll offset
 *    (D45 item 3) — and it is only true because all three numbers come from the platform.
 * 3. **Android has no platform `Form`**, so the scroller is React Native's own `ScrollView`
 *    and the rows sit in it in place. Everything else about Android — the shapes, the header
 *    band, the pressed state — is the Section's one Compose layer.
 */

/** What a `Form` publishes to the sections below it. */
interface FormLayout {
  /** The row width the platform reported; `0` until it has. */
  contentWidth: number;
}

const EMPTY_LAYOUT: FormLayout = { contentWidth: 0 };

const FormLayoutContext = createContext<FormLayout>(EMPTY_LAYOUT);

/**
 * Whether the nearest wrapper above is already a `Form.Row`.
 *
 * Only {@link RowRoot} sets it, for its own children. It exists so a Row written inside a Row
 * says so instead of drawing a cell inside a cell: on iOS the inner row's content ends up in
 * the outer cell and the inner row never reaches a cell of its own; on Android it gets a row
 * rect inside a row rect.
 */
const InsideRowContext = createContext(false);

/** What a Row inside a Row is told, once per process — a 50-row list should not log 50 lines. */
const NESTED_ROW_WARNING =
  'nitro-ui: a `Form.Row` was rendered inside another `Form.Row`. v1 supports `Form.Row` ' +
  'only as a direct child of a `Form` or a `Form.Section`: the outer row is the cell, and a ' +
  'row inside it never reaches a cell of its own. Move the inner row out of the outer one.';

/** Set the first time {@link NESTED_ROW_WARNING} is logged. */
let warnedNestedRow = false;

function onPressNotProvided(): void {
  // The caller asked for nothing.
}

// MARK: - Form

/** Props of {@link Form}. */
export interface FormProps extends ViewProps {
  children?: ReactNode;
  /**
   * Keep the focused row visible while the keyboard is up. Default `true`.
   *
   * Neither platform does this by itself for an input hosted inside a row, so the Form owns
   * it: iOS grows the list's bottom inset and scrolls the row in; Android reserves the IME
   * inset in the scroll content and asks its scroll ancestor to make the focused row
   * visible (D45 item 1).
   */
  keyboardAvoidance?: boolean | undefined;
  /**
   * The Hybrid View handle, as every control's `hybridRef` gives it.
   *
   * @internal Not app API (DECISIONS D14). The shape is `NitroUiFormHandle` in
   * `NativeFormViews.ts`, written inline (as `TextField.tsx` does) so api-extractor does
   * not demand that an internal native type be exported.
   */
  hybridRef?:
    | ((view: {
        readonly keyboardAvoidance: boolean;
        readonly nuiContentOffsetY: number | null;
        nuiTestFormReport(): string;
        nuiTestScrollTo(y: number): void;
        nuiTestCommand(command: string): void;
      }) => void)
    | undefined;
}

/**
 * A grouped, scrolling form: `UICollectionView` `.insetGrouped` on iOS, Material 3's grouped
 * page colour behind in-place rows on Android.
 */
function FormRoot({
  children,
  style,
  keyboardAvoidance = true,
  hybridRef,
  ...rest
}: FormProps) {
  const hybridRefCallback = useStableCallback(hybridRef);
  const [contentWidth, setContentWidth] = useState(0);
  const reportContentWidth = useStableCallback((width: number): void => {
    setContentWidth((previous) => (previous === width ? previous : width));
  }) as NitroCallbackProp<(width: number) => void>;
  // How far the list is scrolled, as of its last settle. Held on the Form alone and sent as
  // one prop: `children` is the app's own element tree, so React re-renders nothing below
  // here, and the shadow node is the only consumer (see `nuiContentOffsetY`).
  const [contentOffsetY, setContentOffsetY] = useState(0);
  const reportContentOffset = useStableCallback((y: number): void => {
    setContentOffsetY((previous) =>
      Math.abs(previous - y) < 0.25 ? previous : y
    );
  }) as NitroCallbackProp<(y: number) => void>;
  // Android only: the IME inset the app's window did not consume by resizing. The scroll
  // content grows by it, so the last row can be scrolled above the keyboard at all.
  const [imeInset, setImeInset] = useState(0);
  const reportImeInset = useStableCallback((inset: number): void => {
    setImeInset((previous) =>
      Math.abs(previous - inset) < 0.5 ? previous : Math.max(0, inset)
    );
  }) as NitroCallbackProp<(inset: number) => void>;

  const layout = useMemo<FormLayout>(() => ({ contentWidth }), [contentWidth]);
  const body = (
    // A `Form` rendered inside a `Form.Row` (a sheet, say) is a new list, not a row inside the
    // outer row's cell, so the "is the nearest wrapper above me a row?" answer resets here.
    // Without the `false`, the flag set by an ancestor row leaks into every row of that inner
    // Form, and each of them is reported as nested inside a row it is not a row of.
    <InsideRowContext.Provider value={false}>
      <FormLayoutContext.Provider value={layout}>
        {children}
      </FormLayoutContext.Provider>
    </InsideRowContext.Provider>
  );

  const native = (
    <NativeNitroUiForm
      {...rest}
      style={IOS ? [styles.iosBox, style] : styles.androidBox}
      keyboardAvoidance={keyboardAvoidance}
      nuiContentOffsetY={contentOffsetY}
      nuiPerfId={null}
      onContentBox={reportContentWidth}
      onContentOffset={reportContentOffset}
      onImeInset={reportImeInset}
      hybridRef={hybridRefCallback ?? undefined}
    >
      {body}
    </NativeNitroUiForm>
  );

  if (IOS) return native;
  return (
    <ScrollView
      style={style}
      // `flexGrow` so a short form still fills the viewport and paints it with the grouped
      // page colour, which belongs to the Form's own view (read from the M3 scheme, not a
      // hex constant) rather than to a colour this file would have to invent.
      contentContainerStyle={
        imeInset > 0 ? [styles.fill, { paddingBottom: imeInset }] : styles.fill
      }
      // A tap outside a focused field should reach the control under it, not merely dismiss
      // the keyboard (React Native's own `handled` mode).
      keyboardShouldPersistTaps="handled"
    >
      {native}
    </ScrollView>
  );
}

// MARK: - Section

/** Props of {@link Form.Section}. */
export interface FormSectionProps extends ViewProps {
  children?: ReactNode;
  /** The header above the rows, as text. A React Native header node is later (C1). */
  title?: string | null | undefined;
  /** The footer below the rows, as text. */
  footer?: string | null | undefined;
  /**
   * The Hybrid View handle.
   *
   * @internal Not app API (D14). The shape of `NitroUiFormSectionHandle`, inline.
   */
  hybridRef?:
    | ((view: {
        readonly title: string | null;
        readonly footer: string | null;
        nuiTestSectionReport(): string;
      }) => void)
    | undefined;
}

/** What a section has to reserve, as the platform measured it. */
interface SectionMetrics {
  headerHeight: number;
  footerHeight: number;
  inset: number;
  gap: number;
}

const NO_METRICS: SectionMetrics = {
  headerHeight: 0,
  footerHeight: 0,
  inset: 0,
  gap: 0,
};

/**
 * A run of rows with a header and a footer.
 *
 * Every direct child is one row: a bare child gets wrapped in a `Form.Row` here, so an app
 * never has to write the wrapper to get the grouping.
 */
function SectionRoot({
  children,
  title = null,
  footer = null,
  style,
  hybridRef,
  ...rest
}: FormSectionProps) {
  const { contentWidth } = useContext(FormLayoutContext);
  const hybridRefCallback = useStableCallback(hybridRef);
  const [metrics, setMetrics] = useState<SectionMetrics>(NO_METRICS);
  const reportMetrics = useStableCallback(
    (
      headerHeight: number,
      footerHeight: number,
      inset: number,
      gap: number
    ): void => {
      setMetrics((previous) =>
        previous.headerHeight === headerHeight &&
        previous.footerHeight === footerHeight &&
        previous.inset === inset &&
        previous.gap === gap
          ? previous
          : { headerHeight, footerHeight, inset, gap }
      );
    }
  ) as NitroCallbackProp<
    (
      headerHeight: number,
      footerHeight: number,
      inset: number,
      gap: number
    ) => void
  >;
  // iOS: where the list put this section, in the list's own content coordinates. With the
  // section standing there, each row's Yoga origin is its position in that content, and the
  // Form's single scroll-offset correction is enough to make `measure` right (D45 item 3).
  // Android reports 0 and flows normally inside the scroll view.
  const [top, setTop] = useState(0);
  // Not clamped at 0: this is a measured content coordinate, and a section one chrome above
  // where the list starts is a section whose rows are still drawn where they are drawn. A
  // `0` here would be a position the platform never reported, which is the difference
  // between a `measure` that agrees with the pixels and one that is a few points out.
  const reportTop = useStableCallback((y: number): void => {
    setTop((previous) => (Math.abs(previous - y) < 0.25 ? previous : y));
  }) as NitroCallbackProp<(y: number) => void>;

  return (
    <NativeNitroUiFormSection
      {...rest}
      style={[IOS ? styles.iosSection : styles.androidSection, { top }, style]}
      title={title}
      footer={footer}
      nuiPerfId={null}
      onMetrics={reportMetrics}
      onPlacement={reportTop}
      hybridRef={hybridRefCallback ?? undefined}
    >
      <View
        style={[
          styles.band,
          {
            // The header and footer are drawn by the platform in these bands, and a row must
            // never paint over them: the reservation is what keeps the two apart, so the
            // harness compares the band with the text it holds instead of trusting it.
            paddingTop: metrics.headerHeight,
            paddingBottom: metrics.footerHeight,
            paddingHorizontal: metrics.inset,
          },
        ]}
      >
        {wrapRows(children, contentWidth, metrics.gap)}
      </View>
    </NativeNitroUiFormSection>
  );
}

/**
 * One row per direct child, keeping the app's own keys.
 *
 * Walked rather than mapped, because a row has to be one row whatever the app wrapped it in:
 * an array, a `Fragment` from a `map`, or the `Form.Row` the app wrote for `onPress`. A
 * `Fragment` child would otherwise become one row holding several children, and a key the
 * app set would be lost by `Children.map` over a fragment.
 *
 * The keys are the ones React itself would build, and that is the whole point: this function
 * flattens the app's tree into one array, so it becomes the thing deciding which row is the
 * same row from one render to the next.
 *
 * - **a slot, not a counter.** An unkeyed child's key is its position in its own list,
 *   *including* the slots taken by `null` and `false`. Counting only the rows emitted — which
 *   is what this did — means `{showBanner && <Text/>}` above a list re-keys every row below it
 *   when the banner appears, and React remounts them: a `TextField` in row four loses its
 *   text, its focus and its caret because row one changed.
 * - **scoped by nesting.** React gives a nested array or a `Fragment` its own key scope, so
 *   two `{items.map(...)}`s whose items share keys do not collide. A flattened list without
 *   that prefix hands React two children with one key, which is a dev warning and a row that
 *   may be reconciled against the wrong one.
 *
 * So a row's key is the path to it: slot indices and `$key` parts joined by `/`, exactly the
 * shape React's own traversal builds, with the same `$` mark on a key the app wrote.
 */
function wrapRows(
  children: ReactNode,
  contentWidth: number,
  gap: number
): ReactNode {
  const out: ReactNode[] = [];
  /** The path of one child: its slot in this scope, with the app's key marked `$`. */
  const slot = (path: string, index: number, key: string | null): string => {
    // `/` is this function's nesting separator, so a key that contains one is escaped:
    // React escapes the separators it uses (`:` and `=`) for exactly this reason.
    const own = key != null ? `$${escapeKey(key)}` : `${String(index)}`;
    return path === '' ? own : `${path}/${own}`;
  };
  const visitOne = (node: ReactNode, path: string, index: number): void => {
    // Slot first, then the skip: a `false` from `{flag && <Row/>}` still holds its slot,
    // which is the only reason the rows below it keep their keys.
    const here = slot(path, index, isValidElement(node) ? node.key : null);
    if (node == null || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      visitChildren(node, here);
      return;
    }
    if (!isValidElement(node)) {
      // A bare string or number is a row of text, the same rule RN's lists use. Its slot is
      // its identity, and React agrees: an unkeyed child is its index.
      out.push(
        <RowRoot key={here} width={contentWidth} gap={gap}>
          {node}
        </RowRoot>
      );
      return;
    }
    if (node.type === Fragment) {
      // Expanded, but into *its* scope: the fragment's slot is the prefix its children's keys
      // hang off, so two fragments whose children share keys stay apart.
      visitChildren((node.props as { children?: ReactNode }).children, here);
      return;
    }
    if (node.type === RowRoot) {
      // The app's own `Form.Row`: the same props, plus the box this platform needs.
      out.push(
        <RowRoot
          key={here}
          width={contentWidth}
          gap={gap}
          {...(node.props as RowProps)}
        />
      );
      return;
    }
    out.push(
      <RowRoot key={here} width={contentWidth} gap={gap}>
        {node}
      </RowRoot>
    );
  };
  const visitChildren = (node: ReactNode, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visitOne(child, path, index));
      return;
    }
    // One child is slot 0 of its own scope. It has no index of its own from React's point of
    // view, and the path it inherits from its parent is what keeps it out of the way of a
    // sibling two levels up with the same key.
    visitOne(node, path, 0);
  };
  visitChildren(children, '');
  return out;
}

/** A key the app wrote, made safe to embed in a path (`/` is the separator). */
function escapeKey(key: string): string {
  return key.replace(
    /[%/]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// MARK: - Row

/** Props of {@link Form.Row}. */
export interface RowProps extends ViewProps {
  children?: ReactNode;
  /**
   * Tapping the row: the cell's highlight, and one button element for a screen reader, on
   * iOS; the shape's pressed state and one merged node on Android. A row without it leaves
   * its content alone, so a `Switch` inside it keeps its own element.
   */
  onPress?: (() => void) | undefined;
  /** The trailing accessory. Default `'none'`. */
  accessory?: FormAccessory | undefined;
  /** Selected state. Default `false`. */
  selected?: boolean | undefined;
  /**
   * The Hybrid View handle.
   *
   * @internal Not app API (D14). The shape of `NitroUiFormRowHandle`, inline — hence
   * `FormAccessory` rather than the internal name it aliases.
   */
  hybridRef?:
    | ((view: {
        readonly accessory: FormAccessory;
        readonly selected: boolean;
        readonly pressable: boolean;
        nuiTestRowReport(): string;
        nuiTestA11yClick(): void;
      }) => void)
    | undefined;
}

/**
 * One row of a form: the cell-level behaviour (`onPress`, `accessory`, `selected`) around
 * React Native content.
 *
 * A row is not self-sizing (`sizing: null`): Yoga sizes it from its children and the cell
 * takes that height. `Form.Section` wraps every child in one, so an app only writes the
 * component when it wants `onPress` or an accessory.
 */
function RowRoot({
  children,
  onPress,
  accessory = 'none',
  selected = false,
  style,
  width = 0,
  gap = 0,
  hybridRef,
  ...rest
}: RowProps & {
  /** The row width the platform reported, set by {@link wrapRows} — not app API. */
  width?: number;
  /** The segmented gap, set by {@link wrapRows} — not app API. */
  gap?: number;
}) {
  const press = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  // The cross-axis rule the app asked the row for, if it asked for one. `styles.rowContent`
  // centres, and the wrapper below is what a row's own `style` is now applied to, so a row
  // written `alignItems: 'stretch'` — or a child with `alignSelf: 'stretch'` — would otherwise
  // stretch only the wrapper and leave the child its own text height. The rule travels into
  // the wrapper with it, so a row stops centring exactly when the app asked it not to: E7
  // measures a row's child against the row's own box, and fourteen of those measures came
  // back as 17 pt of text inside a 44 pt row the first time this wrapper shipped.
  const rowAlignItems = StyleSheet.flatten(style)?.alignItems;
  const insideRow = useContext(InsideRowContext);
  if (__DEV__ && insideRow && !warnedNestedRow) {
    warnedNestedRow = true;
    console.error(NESTED_ROW_WARNING);
  }
  // Every platform draws a row at exactly its Yoga box, so every platform has to be paid
  // for the space it leaves *between* rows: `gap` is that space as the platform measured it
  // (the Material segmented list's gap on Android, the list cell's 4 pt chrome above and
  // below a row on iOS), and half of it goes above and below each row. That is what makes
  // the rows' pitch the pitch they are drawn at, which is what a `measure` of a row has to
  // agree with — a Form that reported `0` here measured its 14th row 104 pt above its own
  // pixels (E7).
  //
  // iOS also takes the *width* the cell gives the row, or the row's Yoga height would not be
  // the cell's height either. Android gives up the trailing room a row's accessory is drawn
  // in, which the section - not the row - paints.
  const box: ViewStyle = {
    marginVertical: gap / 2,
    ...(IOS
      ? width > 0
        ? { width }
        : { width: '100%' }
      : accessory === 'none'
        ? null
        : { paddingRight: 16 + ANDROID_ACCESSORY_RESERVE }),
  };
  return (
    <NativeNitroUiFormRow
      {...rest}
      style={[IOS ? styles.iosRow : styles.androidRow, box, style]}
      accessory={accessory}
      selected={selected}
      pressable={onPress != null}
      nuiPerfId={null}
      onPress={press}
      hybridRef={hybridRefCallback ?? undefined}
    >
      {/*
       * One wrapper for the row's content, so that the row can hold its children level
       * without their co-operation.
       *
       * Every self-sizing control carries `{ alignSelf: 'flex-start' }` as its base style —
       * React Native's own `Switch` does the same, and it is load-bearing here, because a
       * stretched box decides an intrinsic control's size for it and the measurement is then
       * never asked. A child's `alignSelf` beats its parent's `alignItems`, so in a row taller
       * than its content (every row is: the minimum height below) the control in
       * `<Form.Row><Text style={{flex: 1}} /><Switch /></Form.Row>` took the row's top edge
       * while its label centred. The wrapper has no minimum height, so it hugs its content and
       * the row centres *it*; inside it the same `alignItems: 'center'` has no leftover room to
       * be overruled in, and `flex: 1` here is what hands the content the row's whole content
       * width, insets included.
       */}
      <View
        style={
          rowAlignItems == null
            ? styles.rowContent
            : [styles.rowContent, { alignItems: rowAlignItems }]
        }
      >
        <InsideRowContext.Provider value={true}>
          {children}
        </InsideRowContext.Provider>
      </View>
    </NativeNitroUiFormRow>
  );
}

const styles = StyleSheet.create({
  // iOS only: what an *unstyled* `<Form>` gets. Every iOS section is `position: 'absolute'`
  // (see `iosSection`), so the Form's own view has no in-flow content to be measured against
  // and an unstyled Form is 0 pt tall — which is a Form that draws nothing in a README
  // example. `flexGrow` takes the space the parent offers and `flexShrink` keeps a Form
  // taller than its parent from pushing past it; Android gets both from the `ScrollView` this
  // file wraps the native view in.
  iosBox: {
    flexGrow: 1,
    flexShrink: 1,
  },
  // Both platforms put the rows in this box, whose paddings are the bands the platform
  // draws the header and footer into.
  band: {
    flexDirection: 'column',
  },
  fill: {
    // A short form still fills the viewport, so the grouped page colour reaches the bottom.
    flexGrow: 1,
  },
  androidBox: {
    flexDirection: 'column',
  },
  androidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  // The row's content, in the box described at {@link RowRoot}: full content width, level
  // children, and no minimum height of its own — the row's `minHeight` stays the row's.
  rowContent: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
  },
  androidSection: {
    flexDirection: 'column',
  },
  iosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  iosSection: {
    // iOS: absolutely positioned at the y the list gave this section, so the rows inside it
    // are laid out at the same offsets the cells are drawn at. The box takes no part in the
    // list's scrolling — the list scrolls, and this is what it reads.
    position: 'absolute',
    left: 0,
    width: '100%',
  },
});

/**
 * `Form`, with `Form.Section` and `Form.Row` on it (C1).
 *
 * Named because the entry point exports the value: a `const` written as
 * `Object.assign(FormRoot, …)` would otherwise put three unexported functions in the API
 * report, and a grouped list is one component with two sub-components, not three exports.
 */
export interface FormComponent {
  (props: FormProps): JSX.Element;
  /** The group: a header, the rows, a footer. */
  Section(props: FormSectionProps): JSX.Element;
  /** One row: the cell-level behaviour around React Native content. */
  Row(props: RowProps): JSX.Element;
}

/** The public shape: `Form`, with `Form.Section` and `Form.Row` on it (C1). */
export const Form: FormComponent = Object.assign(FormRoot, {
  Row: RowRoot,
  Section: SectionRoot,
});
