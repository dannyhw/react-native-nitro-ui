import {
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useMemo,
  useState,
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
import type { NitroUiFormHandle } from './NativeFormViews';
import type { NitroUiFormSectionHandle } from './NativeFormViews';
import type { NitroUiFormRowHandle } from './NativeFormViews';
import type { NitroUiFormAccessory } from './Form.nitro';
import {
  NativeNitroUiForm,
  NativeNitroUiFormRow,
  NativeNitroUiFormSection,
} from './NativeFormViews';

const IOS = Platform.OS === 'ios';

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
 *    `style.width` follows. A row's Yoga height is then the height of its cell.
 * 2. **A section reserves the space its header and footer take**, because those are drawn
 *    natively while the rows between them are laid out by Yoga (`onMetrics`); on iOS the
 *    section also takes the vertical position the list gave it (`onPlacement`), so a row's
 *    Yoga origin *is* its position in the list's content. That is what lets the Form's
 *    shadow node correct `measure` with one number — the scroll offset (D45 item 3).
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
  /** The Hybrid View handle, as every control's `hybridRef` gives it. @internal Test seam. */
  hybridRef?: ((view: NitroUiFormHandle) => void) | undefined;
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
    <FormLayoutContext.Provider value={layout}>
      {children}
    </FormLayoutContext.Provider>
  );

  const native = (
    <NativeNitroUiForm
      {...rest}
      style={IOS ? style : styles.androidBox}
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
        imeInset > 0
          ? { flexGrow: 1, paddingBottom: imeInset }
          : { flexGrow: 1 }
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
  /** The Hybrid View handle. @internal Test seam. */
  hybridRef?: ((view: NitroUiFormSectionHandle) => void) | undefined;
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
  const reportTop = useStableCallback((y: number): void => {
    setTop((previous) =>
      Math.abs(previous - y) < 0.25 ? previous : Math.max(0, y)
    );
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
        style={{
          // The header and footer are drawn by the platform in these bands, and a row must
          // never paint over them: the reservation is what keeps the two apart, so the
          // harness compares the band with the text it holds instead of trusting it.
          paddingTop: metrics.headerHeight,
          paddingBottom: metrics.footerHeight,
          paddingHorizontal: metrics.inset,
          flexDirection: 'column',
        }}
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
 */
function wrapRows(
  children: ReactNode,
  contentWidth: number,
  gap: number
): ReactNode {
  const out: ReactNode[] = [];
  let anonymous = 0;
  const visit = (node: ReactNode): void => {
    if (node == null || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isValidElement(node)) {
      // A bare string or number is a row of text, the same rule RN's lists use. It has no
      // key of its own, so the position is its identity here.
      out.push(
        <RowRoot key={`row-${anonymous++}`} width={contentWidth} gap={gap}>
          {node}
        </RowRoot>
      );
      return;
    }
    if (node.type === Fragment) {
      visit((node.props as { children?: ReactNode }).children);
      return;
    }
    if (node.type === RowRoot) {
      // The app's own `Form.Row`: the same props, plus the box this platform needs.
      out.push(
        <RowRoot
          key={node.key ?? `row-${anonymous++}`}
          width={contentWidth}
          gap={gap}
          {...(node.props as RowProps)}
        />
      );
      return;
    }
    out.push(
      <RowRoot
        key={node.key ?? `row-${anonymous++}`}
        width={contentWidth}
        gap={gap}
      >
        {node}
      </RowRoot>
    );
  };
  visit(children);
  return out;
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
  accessory?: NitroUiFormAccessory | undefined;
  /** Selected state. Default `false`. */
  selected?: boolean | undefined;
  /** The Hybrid View handle. @internal Test seam. */
  hybridRef?: ((view: NitroUiFormRowHandle) => void) | undefined;
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
  // iOS: the row is drawn by its cell, at the width the cell gives it — that width has to be
  // the row's own, or the row's Yoga height would not be the cell's height either. Android:
  // rows sit in a segmented list, so each takes half the gap above and below it.
  const box: ViewStyle = IOS
    ? width > 0
      ? { width }
      : { width: '100%' }
    : { marginVertical: gap / 2 };
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
      {children}
    </NativeNitroUiFormRow>
  );
}

const styles = StyleSheet.create({
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
    // iOS: absolutely positioned at the y the list gave this section, so the rows inside it
    // are laid out at the same offsets the cells are drawn at. The box takes no part in the
    // list's scrolling — the list scrolls, and this is what it reads.
    position: 'absolute',
    left: 0,
    width: '100%',
  },
});

/** The public shape: `Form`, with `Form.Section` and `Form.Row` on it (C1). */
export const Form = Object.assign(FormRoot, {
  Row: RowRoot,
  Section: SectionRoot,
});
