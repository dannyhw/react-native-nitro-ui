import { Children, useRef, type ReactNode } from 'react';
import {
  Platform,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { assertHostChildren } from './HostChildren';
import { NativeNitroUiHost } from './NativeNitroUiHost';

/**
 * Props of {@link Host}: the layout props of any view, and its children.
 */
export interface HostProps extends ViewProps {
  children?: ReactNode;
}

/**
 * Renders its nitro-ui children into one shared native composition on Android,
 * which lowers mount memory and UI-thread time at some JS-thread cost. On iOS
 * it is a plain `View`.
 *
 * - Every direct child must be a nitro-ui control that a Host supports; a
 *   component that renders one counts. Anything else - an RN view, text, a
 *   `Modal`, another `<Host>` - throws in development.
 * - The children are drawn as one column, in order, at the Host's width, and
 *   clipped to its box. A style on a child moves its React Native frame, not
 *   what is drawn.
 * - Of the Host's own styles, `width`, `height`, `flex`, `padding` and
 *   `alignSelf` apply, and `borderWidth` insets like `padding` without drawing
 *   a border. `gap`, `alignItems`, `alignContent`, `justifyContent`, a
 *   non-column `flexDirection` and `pointerEvents` do not reach the drawing;
 *   development builds warn about them.
 * - Give the Host a `height` or `flex: 1`. Without one its height is the sum of
 *   its children's sizes, and content taller than the box is clipped.
 *
 * @example
 * ```tsx
 * <Host style={styles.list}>
 *   <Switch value={on} onValueChange={setOn} />
 *   <Switch value={other} onValueChange={setOther} />
 * </Host>
 * ```
 */
export function Host({ children, ...props }: HostProps) {
  assertHostChildren(children, Host);
  const warnedAboutHeight = useRef(false);
  const warnedAboutStyle = useRef(false);
  // Warns once when the Host ends up 0 tall. Only `onLayout` knows the box:
  // `style` says what was asked for, not what Yoga decided.
  const onLayout = (event: LayoutChangeEvent) => {
    props.onLayout?.(event);
    if (warnedAboutHeight.current) {
      return;
    }
    const { width, height } = event.nativeEvent.layout;
    // `Children.toArray`, not `children != null`: `{show && <Switch />}` and an
    // empty `map` are non-null and legitimately draw nothing.
    if (height === 0 && width > 0 && Children.toArray(children).length > 0) {
      warnedAboutHeight.current = true;
      console.warn(
        'react-native-nitro-ui: a <Host> measured 0 tall, so nothing inside it is ' +
          'visible. A Host measures nothing: its box is its own `style` plus the ' +
          'boxes RN computes for its children, and nothing inside it can grow it ' +
          'back. Give it a `height` or `flex: 1`, or take the height away from ' +
          'whatever parent is refusing it (D24, docs/architecture/sizing.md).'
      );
    }
  };

  // Dev-only: a layout handler sends a layout event to JS on every relayout, so
  // a release build wires only the caller's own.
  const layoutHandler = __DEV__ ? onLayout : props.onLayout;

  if (__DEV__) {
    warnAboutInertStyles(props.style, props.pointerEvents, warnedAboutStyle);
  }

  if (Platform.OS !== 'android') {
    // iOS has no shared composition to host into.
    return (
      <View {...props} onLayout={layoutHandler} testID={props.testID}>
        {children}
      </View>
    );
  }
  return (
    <NativeNitroUiHost {...props} onLayout={layoutHandler}>
      {children}
    </NativeNitroUiHost>
  );
}

/**
 * Styles that size the Host's box in Yoga but do not reach what Compose draws.
 * `alignSelf` and `borderWidth` are left out on purpose: the first moves the
 * box and the drawing with it, the second insets the drawing like `padding`.
 */
const INERT_HOST_STYLES: readonly (keyof ViewStyle)[] = [
  'gap',
  'rowGap',
  'columnGap',
  'alignItems',
  'alignContent',
  'justifyContent',
];

/**
 * Warns once per Host. It sees only plain style objects: a `StyleSheet.create`
 * id is a number to JS.
 */
function warnAboutInertStyles(
  style: StyleProp<ViewStyle> | undefined,
  pointerEvents: ViewProps['pointerEvents'],
  warned: { current: boolean }
): void {
  if (warned.current) {
    return;
  }
  const flat = flattenStyleForWarning(style);
  if (flat == null) {
    return;
  }
  const inert = INERT_HOST_STYLES.filter((key) => flat[key] != null);
  const laysSideways =
    flat.flexDirection != null && flat.flexDirection !== 'column';
  if (pointerEvents == null && inert.length === 0 && !laysSideways) {
    return;
  }
  warned.current = true;
  const named = [
    ...inert.map((key) => `\`${key}\``),
    ...(laysSideways ? ['`flexDirection` (only a column is drawn)'] : []),
    ...(pointerEvents != null ? ['`pointerEvents`'] : []),
  ];
  console.warn(
    'react-native-nitro-ui: a <Host> was given ' +
      `${named.join(', ')}, which sizes its box but does not reach what it draws - ` +
      'Compose arranges the children (one column, no gaps), and touches go to Compose ' +
      "rather than RN's hit testing. Lay the rows out with `padding` (or a " +
      "`borderWidth`, which insets the same way) and the children's own heights, and " +
      'space them inside each row (docs/components/host.md).'
  );
}

/**
 * The style as a plain object, or `null` when JS cannot see into it.
 * `StyleSheet.flatten` would resolve registered ids, but is too costly to run
 * on every render for a warning.
 */
function flattenStyleForWarning(
  style: StyleProp<ViewStyle> | undefined
): ViewStyle | null {
  if (style == null) {
    return null;
  }
  if (Array.isArray(style)) {
    const merged: ViewStyle = {};
    for (const entry of style) {
      const nested = flattenStyleForWarning(
        entry as StyleProp<ViewStyle> | undefined
      );
      if (nested != null) {
        Object.assign(merged, nested);
      }
    }
    return merged;
  }
  return typeof style === 'object' ? (style as ViewStyle) : null;
}
