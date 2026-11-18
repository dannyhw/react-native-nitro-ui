import {
  createContext,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
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
import { InsideRowContext, useInsideRow } from '../../core/useSelfSizing';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiFormAccessory as FormAccessory } from './Form.nitro';
import {
  NativeNitroUiForm,
  NativeNitroUiFormRow,
  NativeNitroUiFormSection,
} from './NativeFormViews';

const IOS = Platform.OS === 'ios';

/**
 * The trailing accessory of a form row: `'none'`, `'disclosure'` or `'checkmark'`.
 *
 * `disclosure` is UIKit's disclosure indicator and Material Symbols' `chevron_right`;
 * `checkmark` is UIKit's checkmark and Material Symbols' `check`.
 */
export type { FormAccessory };

/**
 * The room an Android accessory takes at a row's trailing edge, where the section draws the
 * glyph: 24 dp, which must match `FormListMetrics` in `HybridNitroUiFormSection.kt`, plus an
 * 8 dp gap. `androidRow` already carries the 16 dp edge padding.
 */
const ANDROID_ACCESSORY_RESERVE = 24 + 8;

/**
 * How the layout works:
 *
 * - iOS: a `UICollectionView` list whose cells hold the rows. Each row takes the width its
 *   own cell reports (`Form.Row`'s `onContentBox`), starting from the Form's list-wide
 *   estimate, and each section takes the vertical position the list gave it (`onPlacement`),
 *   so a row's Yoga origin is where its cell is drawn.
 * - Both: a section reserves what the platform draws around its rows (`onMetrics`): the
 *   header and footer bands, and the gap between rows, spent as each row's `marginVertical`.
 * - Android: there is no platform form, so the scroller is React Native's `ScrollView` and
 *   the rows stay where Yoga put them. The section's Compose layer draws the shapes, the
 *   header band and the pressed state.
 */

/** What a `Form` publishes to the sections below it. */
interface FormLayout {
  /** The row width the platform reported; `0` until it has. */
  contentWidth: number;
}

const EMPTY_LAYOUT: FormLayout = { contentWidth: 0 };

const FormLayoutContext = createContext<FormLayout>(EMPTY_LAYOUT);

/**
 * Whether the nearest wrapper above is a `Form.Row`.
 *
 * @internal Exported for `ListItem`, which leaves insets, shape and highlight to the row's
 * cell when it is inside one.
 */
export function useInsideFormRow(): boolean {
  return useInsideRow();
}

/**
 * What an item inside a row hands up to it: the press it wants the cell to own, and whether
 * it is disabled. `null` outside a row. The cell draws the pressed state, and only for a row
 * it was told is pressable, so the item's handler travels up to the row.
 */
const RowItemPressContext = createContext<RowItemPressReporter | null>(null);

/** Reports the press an item wants its `Form.Row` to own. @internal */
export type RowItemPressReporter = (
  onPress: (() => void) | null,
  disabled: boolean
) => void;

/**
 * The reporter a `ListItem` hands its press to, or `null` outside a `Form.Row`.
 *
 * @internal
 */
export function useFormRowItemPressReporter(): RowItemPressReporter | null {
  return useContext(RowItemPressContext);
}

/** Logged once per process. The row's handler wins: the cell is the touch target. */
const BOTH_HANDLERS_WARNING =
  'nitro-ui: a `Form.Row` with an `onPress` has a `ListItem` inside it with an `onPress` ' +
  'too. The row is the cell and the cell is the touch target, so the row\u2019s handler is ' +
  'the one that fires and the item\u2019s is never called. Wire the press on one of the two.';

let warnedBothHandlers = false;

/** Logged once per process. */
const NESTED_ROW_WARNING =
  'nitro-ui: a `Form.Row` was rendered inside another `Form.Row`. v1 supports `Form.Row` ' +
  'only as a direct child of a `Form` or a `Form.Section`: the outer row is the cell, and a ' +
  'row inside it never reaches a cell of its own. Move the inner row out of the outer one.';

let warnedNestedRow = false;

function onPressNotProvided(): void {
  // The caller asked for nothing.
}

// MARK: - Form

/** Props of {@link Form}. */
export interface FormProps extends ViewProps {
  children?: ReactNode;
  /**
   * Keeps the focused row visible while the keyboard is up. Default `true`.
   *
   * iOS grows the list's bottom inset and scrolls the row into view; Android pads the scroll
   * content by the keyboard's height and scrolls the focused row into view.
   */
  keyboardAvoidance?: boolean | undefined;
  /**
   * The native view's handle.
   *
   * @internal
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
  // How far the list is scrolled, as of its last settle. The native view corrects `measure`
  // with it.
  const [contentOffsetY, setContentOffsetY] = useState(0);
  const reportContentOffset = useStableCallback((y: number): void => {
    setContentOffsetY((previous) =>
      Math.abs(previous - y) < 0.25 ? previous : y
    );
  }) as NitroCallbackProp<(y: number) => void>;
  // Android only: the IME inset the app's window did not consume by resizing. With keyboard
  // avoidance on, the scroll content grows by it, so the last row can be scrolled above the
  // keyboard at all.
  const [imeInset, setImeInset] = useState(0);
  const reportImeInset = useStableCallback((inset: number): void => {
    setImeInset((previous) =>
      Math.abs(previous - inset) < 0.5 ? previous : Math.max(0, inset)
    );
  }) as NitroCallbackProp<(inset: number) => void>;

  const layout = useMemo<FormLayout>(() => ({ contentWidth }), [contentWidth]);
  const body = (
    // A `Form` inside a `Form.Row` (a sheet, say) is a new list, so the "inside a row" flag
    // resets here.
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
      // `flexGrow` so a short form still fills the viewport with the grouped page colour.
      contentContainerStyle={
        keyboardAvoidance && imeInset > 0
          ? [styles.fill, { paddingBottom: imeInset }]
          : styles.fill
      }
      // A tap outside a focused field should reach the control under it, not merely dismiss
      // the keyboard.
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
  /** The header above the rows, as text. */
  title?: string | null | undefined;
  /** The footer below the rows, as text. */
  footer?: string | null | undefined;
  /**
   * The native view's handle.
   *
   * @internal
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
  // iOS: where the list put this section, in the list's content coordinates, so each row's
  // Yoga origin is where its cell is drawn. Android reports 0 and flows normally inside the
  // scroll view.
  const [top, setTop] = useState(0);
  // Not clamped at 0: a measured content coordinate can be negative, and `measure` has to
  // agree with where the rows are drawn.
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
            // The platform draws the header and footer in these bands, so no row may be laid
            // out over them.
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
 * One row per direct child, flattening arrays and `Fragment`s and keeping the app's keys.
 *
 * A row's key is the path to it, as React itself would build it: slot indices and `$key`
 * parts joined by `/`. An unkeyed child's slot counts the `null` and `false` siblings before
 * it, so a conditional sibling does not re-key (and remount) the rows below it. Each array or
 * `Fragment` is its own key scope, so equal keys in two lists do not collide.
 */
function wrapRows(
  children: ReactNode,
  contentWidth: number,
  gap: number
): ReactNode {
  const out: ReactNode[] = [];
  /** The path of one child: its slot in this scope, with the app's key marked `$`. */
  const slot = (path: string, index: number, key: string | null): string => {
    // `/` is the nesting separator, so a key that contains one is escaped.
    const own = key != null ? `$${escapeKey(key)}` : `${String(index)}`;
    return path === '' ? own : `${path}/${own}`;
  };
  const visitOne = (node: ReactNode, path: string, index: number): void => {
    // Slot first, then the skip: a `false` from `{flag && <Row/>}` still holds its slot.
    const here = slot(path, index, isValidElement(node) ? node.key : null);
    if (node == null || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      visitChildren(node, here);
      return;
    }
    if (!isValidElement(node)) {
      // A bare string or number is a row of text; its slot is its identity.
      out.push(
        <RowRoot key={here} width={contentWidth} gap={gap}>
          {node}
        </RowRoot>
      );
      return;
    }
    if (node.type === Fragment) {
      // Expanded into its own scope: the fragment's slot prefixes its children's keys.
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
    // One child is slot 0 of its own scope.
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
   * Called when the row is tapped. A row with `onPress` highlights when pressed and is one
   * button for a screen reader; a row without it leaves its content alone, so a `Switch`
   * inside it keeps its own accessibility element.
   */
  onPress?: (() => void) | undefined;
  /** The trailing accessory. Default `'none'`. */
  accessory?: FormAccessory | undefined;
  /** Selected state. Default `false`. */
  selected?: boolean | undefined;
  /**
   * The native view's handle.
   *
   * @internal
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
 * React Native content. Yoga sizes it from its children and the cell takes that height.
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
  // What the item inside this row reported. A ref plus a bump, not state carrying a function:
  // the report arrives from the child's effect.
  const reported = useRef<{ onPress: (() => void) | null; disabled: boolean }>({
    onPress: null,
    disabled: false,
  });
  const [, repaintRow] = useReducer((n: number) => n + 1, 0);
  const reportItemPress = useCallback<RowItemPressReporter>(
    (next, disabled) => {
      const current = reported.current;
      if (current.onPress === next && current.disabled === disabled) {
        return;
      }
      reported.current = { onPress: next, disabled };
      repaintRow();
    },
    []
  );
  // The row's own handler wins. An item's handler is used only when the row has none, and a
  // disabled item contributes nothing: the row stops being pressable and stops highlighting.
  const reportedItem = reported.current;
  if (
    __DEV__ &&
    onPress != null &&
    reportedItem.onPress != null &&
    !warnedBothHandlers
  ) {
    warnedBothHandlers = true;
    console.error(BOTH_HANDLERS_WARNING);
  }
  const fromItem = reportedItem.disabled ? null : reportedItem.onPress;
  const effectiveOnPress = onPress ?? fromItem;
  const press = useStableCallback(
    effectiveOnPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  // The box this row's own cell gives it (iOS). It can be narrower than the Form's list-wide
  // width: a cell drawing a trailing accessory shrinks its margins for that row, and a row
  // laid out wider than its box draws content where UIKit's hit-test never looks.
  //
  // The report is stamped with the `width` it arrived under: after a rotation or resize it
  // describes a layout that no longer exists, and an off-screen row is not laid out again
  // until it is scrolled back.
  const [ownBox, setOwnBox] = useState({ width: 0, under: 0 });
  const reportOwnBox = useStableCallback((next: number): void => {
    setOwnBox((previous) =>
      Math.abs(previous.width - next) < 0.25 && previous.under === width
        ? previous
        : { width: next, under: width }
    );
  }) as NitroCallbackProp<(width: number) => void>;
  // The row's own box is trusted while it still describes the current list width. When it
  // does not, the row takes the narrower of the two: wider draws content past the row's
  // bounds.
  let laid = width;
  if (ownBox.width > 0) {
    laid =
      ownBox.under === width || width <= 0
        ? ownBox.width
        : Math.min(ownBox.width, width);
  }
  const insideRow = useInsideRow();
  if (__DEV__ && insideRow && !warnedNestedRow) {
    warnedNestedRow = true;
    console.error(NESTED_ROW_WARNING);
  }
  // `gap` is the space the platform leaves between rows, as it measured it. Half goes above
  // and below each row, so the rows' Yoga positions match where they are drawn. iOS also
  // takes the width this row's cell gives it; Android gives up the trailing room the section
  // draws a row's accessory in.
  const box: ViewStyle = {
    marginVertical: gap / 2,
    ...(IOS
      ? laid > 0
        ? { width: laid }
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
      pressable={effectiveOnPress != null}
      nuiPerfId={null}
      onPress={press}
      onContentBox={reportOwnBox}
      hybridRef={hybridRefCallback ?? undefined}
    >
      <InsideRowContext.Provider value={true}>
        <RowItemPressContext.Provider value={reportItemPress}>
          {children}
        </RowItemPressContext.Provider>
      </InsideRowContext.Provider>
    </NativeNitroUiFormRow>
  );
}

const styles = StyleSheet.create({
  // iOS only. Every iOS section is `position: 'absolute'`, so an unstyled Form has no in-flow
  // content and would be 0 pt tall. Android gets both from the `ScrollView` around the native
  // view.
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
  androidSection: {
    flexDirection: 'column',
  },
  iosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  iosSection: {
    // Absolutely positioned at the y the list gave this section, so the rows inside it are
    // laid out at the offsets their cells are drawn at.
    position: 'absolute',
    left: 0,
    width: '100%',
  },
});

/** The type of `Form`: the component itself, with `Form.Section` and `Form.Row` on it. */
export interface FormComponent {
  (props: FormProps): JSX.Element;
  /** The group: a header, the rows, a footer. */
  Section(props: FormSectionProps): JSX.Element;
  /** One row: the cell-level behaviour around React Native content. */
  Row(props: RowProps): JSX.Element;
}

/**
 * A grouped, settings-style list whose rows are ordinary React Native views: an inset-grouped
 * list on iOS, Material 3 grouped rows on Android. Use `Form.Section` for a group with a
 * header and a footer, and `Form.Row` for a row with `onPress` or an accessory.
 */
export const Form: FormComponent = Object.assign(FormRoot, {
  Row: RowRoot,
  Section: SectionRoot,
});
