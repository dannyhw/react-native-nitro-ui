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
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useStableCallback } from '../../core/useStableCallback';
import type { NitroCallbackProp } from '../../core/useStableCallback';
import type { NitroUiFormAccessory } from './Form.nitro';
import type {
  NitroUiFormMethods,
  NitroUiFormRowMethods,
  NitroUiFormSectionMethods,
} from './Form.nitro';
import {
  NativeNitroUiForm,
  NativeNitroUiFormRow,
  NativeNitroUiFormSection,
} from './NativeFormViews';

/**
 * `Form`, `Section` and `Form.Row` - **the S6 spike prototype**.
 *
 * The API Q10 Appendix C1 drew, built to answer Appendix E's seven questions. Not a
 * shipped component: no manifest, no export from the entry point, no README row. The
 * shape of this file is part of the answer, because three of the spike's findings are
 * JS-side:
 *
 * 1. **Native sets a row's box.** iOS lays a row out at the cell content width the Form
 *    reports (`onContentBox`), pinned to the section's origin with `position: absolute`
 *    - so the row's Yoga height *is* the cell's height and Fabric writes the same frame
 *    into the holding view and into the cell. That is C1's "a container that cancels the
 *    row's Yoga origin", without the container. Android lays rows out statically,
 *    because there they stay where they are.
 * 2. **A Section's header and footer are drawn natively but reserved by Yoga**, through
 *    `onMetrics` - a second layout pass a shipped Form has to hide.
 * 3. **Android needs a scroller.** `Form` *is* the scroller on iOS (a `UICollectionView`);
 *    the prototype wraps it in a `ScrollView` on Android.
 *
 * Rows reach native as React Native children of the section, so they are ordinary Fabric
 * views: a nitro-ui `Switch`, a `Pressable` or a `Text` go in unchanged.
 */

const IOS = Platform.OS === 'ios';

/** The M3 page colour behind segmented rows (`surfaceContainerLow`), until native owns it. */
const FORM_BACKGROUND_ANDROID = '#ECE6F0';

/** What a `Form` publishes to the rows below it. */
interface FormLayout {
  /** The cell content width the platform reported; `0` until it has. */
  contentWidth: number;
  /** The space between two segmented shapes (Android; 0 on iOS). */
  gap: number;
}

const EMPTY_LAYOUT: FormLayout = { contentWidth: 0, gap: 2 };

const FormLayoutContext = createContext<FormLayout>(EMPTY_LAYOUT);

function onPressNotProvided(): void {
  // The caller asked for nothing.
}

// MARK: - Form

/** Props of {@link Form}. */
export interface FormProps extends ViewProps {
  children?: ReactNode;
  /** Keep a focused row visible while the keyboard is up. Default `true`. */
  keyboardAvoidance?: boolean | undefined;
  /**
   * The row width the platform reported, for the example and the harness to show.
   * @internal Spike only.
   */
  onContentWidth?: ((width: number) => void) | undefined;
  /** The Hybrid View handle, as every control's `hybridRef` gives it. @internal Test seam. */
  hybridRef?: ((view: NitroUiFormMethods) => void) | undefined;
}

/**
 * A grouped, scrolling form: `UICollectionView` `.insetGrouped` on iOS, an M3
 * `surfaceContainerLow` column of segmented rows on Android.
 */
function FormRoot({
  children,
  style,
  keyboardAvoidance = true,
  onContentWidth,
  hybridRef,
  ...rest
}: FormProps) {
  const hybridRefCallback = useStableCallback(hybridRef);
  const [contentWidth, setContentWidth] = useState(0);
  const reportWidth = useStableCallback((width: number): void => {
    setContentWidth((previous) => (previous === width ? previous : width));
    if (onContentWidth != null) onContentWidth(width);
  }) as NitroCallbackProp<(width: number) => void>;
  const layout = useMemo<FormLayout>(
    () => ({ contentWidth, gap: EMPTY_LAYOUT.gap }),
    [contentWidth]
  );
  const value = (
    <FormLayoutContext.Provider value={layout}>
      {children}
    </FormLayoutContext.Provider>
  );
  const native = (
    <NativeNitroUiForm
      {...rest}
      style={IOS ? style : styles.androidBox}
      keyboardAvoidance={keyboardAvoidance}
      nuiPerfId={null}
      onContentBox={reportWidth}
      hybridRef={hybridRefCallback ?? undefined}
    >
      {value}
    </NativeNitroUiForm>
  );
  if (IOS) return native;
  return (
    <ScrollView
      style={[{ backgroundColor: FORM_BACKGROUND_ANDROID }, style]}
      keyboardShouldPersistTaps="handled"
    >
      {native}
    </ScrollView>
  );
}

// MARK: - Section

/** Props of {@link Section}. */
export interface SectionProps extends ViewProps {
  children?: ReactNode;
  /** The header above the rows, as text. An RN header node is a later call (C1). */
  title?: string | null | undefined;
  /** The footer below the rows. */
  footer?: string | null | undefined;
  /** The Hybrid View handle. @internal Test seam. */
  hybridRef?: ((view: NitroUiFormSectionMethods) => void) | undefined;
}

/**
 * A run of rows with a header and a footer. Every direct child is one row: a `Form.Row`
 * as it stands, anything else wrapped in one.
 */
function SectionRoot({
  children,
  title = null,
  footer = null,
  style,
  hybridRef,
  ...rest
}: SectionProps) {
  const hybridRefCallback = useStableCallback(hybridRef);
  const [metrics, setMetrics] = useState({
    header: 0,
    footer: 0,
    inset: 0,
    gap: EMPTY_LAYOUT.gap,
  });
  const reportMetrics = useStableCallback(
    (
      header: number,
      footerHeight: number,
      inset: number,
      gap: number
    ): void => {
      setMetrics((previous) =>
        previous.header === header &&
        previous.footer === footerHeight &&
        previous.inset === inset &&
        previous.gap === gap
          ? previous
          : { header, footer: footerHeight, inset, gap }
      );
    }
  ) as NitroCallbackProp<
    (header: number, footer: number, inset: number, gap: number) => void
  >;

  const { contentWidth } = useContext(FormLayoutContext);
  const layout = useMemo<FormLayout>(
    () => ({ contentWidth, gap: metrics.gap }),
    [contentWidth, metrics.gap]
  );
  const rows = useMemo(
    () => wrapRows(children, contentWidth, metrics.gap),
    [children, contentWidth, metrics.gap]
  );

  return (
    <NativeNitroUiFormSection
      {...rest}
      style={[
        IOS ? styles.iosSection : styles.androidSection,
        IOS
          ? null
          : {
              paddingTop: metrics.header,
              paddingBottom: metrics.footer,
              paddingHorizontal: metrics.inset,
            },
        style,
      ]}
      title={title}
      footer={footer}
      nuiPerfId={null}
      onMetrics={reportMetrics}
      hybridRef={hybridRefCallback ?? undefined}
    >
      <FormLayoutContext.Provider value={layout}>
        {rows}
      </FormLayoutContext.Provider>
    </NativeNitroUiFormSection>
  );
}

/**
 * Wrap every child that is not already a `Form.Row` in one, so a bare child is a row
 * (C1). Keys carry over, which is what makes a keyed insert in the middle a *move* of one
 * item rather than a rebuild of the section.
 *
 * The row host component stays a *direct* child of the section: a wrapper `View` here
 * would become the section's child, and the platform would never hear the row mount.
 */
function wrapRows(
  children: ReactNode,
  contentWidth: number,
  gap: number
): ReactNode[] {
  const out: ReactNode[] = [];
  let anonymous = 0;
  const visit = (node: ReactNode): void => {
    if (node == null || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isValidElement(node)) {
      // A bare string or number is a row of text, the same rule RN's lists use.
      // A bare string has no key of its own; the position is its identity here.
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
      // The app's own `Form.Row`: same props, plus the box this platform needs.
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
  /** Tapping the row: the cell's highlight and selection on iOS, the ripple and shape morph on Android. */
  onPress?: (() => void) | undefined;
  /** The trailing accessory. Default `'none'`. */
  accessory?: NitroUiFormAccessory | undefined;
  /** Selected state. Default `false`. */
  selected?: boolean | undefined;
  /** The Hybrid View handle. @internal Test seam. */
  hybridRef?: ((view: NitroUiFormRowMethods) => void) | undefined;
}

/**
 * One row of a form: the cell-level behaviour (`onPress`, `accessory`, `selected`)
 * around React Native content. A row is not self-sizing (`sizing: null`): Yoga sizes it,
 * and the cell takes that height.
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
  /** The cell content width, set by {@link wrapRows} - not app API. */
  width?: number;
  /** The segmented gap, set by {@link wrapRows} - not app API. */
  gap?: number;
}) {
  const press = useStableCallback(
    onPress ?? onPressNotProvided
  ) as NitroCallbackProp<() => void>;
  const hybridRefCallback = useStableCallback(hybridRef);
  // iOS: where the Form says this row's cell came to rest, in the Form's own space
  // (`onFrameMoved`). Null until the list settles the first time, when 0 is right: the
  // first rows are at the top of the Form. Android never sets it - rows there stay where
  // Yoga put them, which is the whole difference between the platforms.
  const [cellOrigin, setCellOrigin] = useState<{ x: number; y: number } | null>(
    null
  );
  const reportCellFrame = useStableCallback((x: number, y: number): void => {
    setCellOrigin((previous) =>
      previous != null && previous.x === x && previous.y === y
        ? previous
        : { x, y }
    );
  }) as NitroCallbackProp<(x: number, y: number) => void>;
  // On iOS the row is drawn by its cell, and `NitroUiFormRowHostView` keeps the view at the
  // origin UIKit gave it no matter what Yoga says - so this origin is *only* the shadow
  // tree's copy of where the row is, which is what `measure`/`measureInWindow` return.
  // Writing it is the difference between a row measuring as itself and as the Form (S6 Q4).
  const box: ViewStyle = IOS
    ? {
        position: 'absolute',
        top: cellOrigin?.y ?? 0,
        left: cellOrigin?.x ?? 0,
        width: width > 0 ? width : undefined,
      }
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
      onFrameMoved={reportCellFrame}
      hybridRef={hybridRefCallback ?? undefined}
    >
      {children}
    </NativeNitroUiFormRow>
  );
}

const styles = StyleSheet.create({
  iosSection: {
    // A Section is a model on iOS: its children are laid out here and shown in cells, so
    // the box itself takes no part in the list's scrolling.
    width: '100%',
    height: 0,
  },
  iosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  androidSection: {
    flexDirection: 'column',
  },
  androidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  androidBox: {
    backgroundColor: FORM_BACKGROUND_ANDROID,
  },
});

/**
 * The prototype's public shape: `Form`, `Section`, `Form.Row`.
 */
export const Form = Object.assign(FormRoot, {
  Row: RowRoot,
  Section: SectionRoot,
});
export { RowRoot as FormRow, SectionRoot as Section };
