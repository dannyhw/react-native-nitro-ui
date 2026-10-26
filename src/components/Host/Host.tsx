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
 * Props of {@link Host}.
 *
 * A Host is a container: it takes layout props like any other view and nothing
 * else - no `count`, no `renderItem`, no per-child options. Those would make it a
 * second list component, and this is a container.
 */
export interface HostProps extends ViewProps {
  children?: ReactNode;
}

/**
 * Renders its nitro-ui children into one shared native composition (Android).
 *
 * Every control outside a Host brings its own Compose runtime with it: one
 * `Composition`, one owner view and one native view tree per control, which is
 * exactly what Android mount memory and mount UI-thread time pay for. A Host gives
 * all of its direct children **one** composition instead, so 50 Switches cost one
 * composition rather than fifty. Measured on the shipping container (H1, `quick`,
 * `speed-profile`): **0.86x** `expo-ui-shared-host` on mount memory (44.5 KiB per
 * Switch against its 51.9 KiB) and **0.87x** on mount UI CPU per op, against 2.75x and
 * 1.39x without a Host. What it pays with is the JS thread - a hosted control is still
 * an RN node *plus* a child of somebody else's composition: **1.18x** the shared host
 * on mount JS CPU per op. Opt-in for that reason, not a default.
 *
 * Only `Switch` is hosted today, and the rule is held on both sides of the bridge.
 * A direct child that JS can prove is not one (a text node, an RN view, one of our
 * other controls, another `<Host>`) throws in development rather than rendering half
 * a screen. React flattens components away, so JS cannot see through a `memo`: what
 * arrives as an unknown child is decided by the native allowlist
 * (`NitroComposeHost.isHostable`), which says yes only to `Switch` and - in a
 * debuggable build - reports what it refused to JavaScript as a `console.error`, not
 * only to logcat. Hosting another control means a row in `HostChildren.ts`, an
 * `isHostable` override, and a bench arm for it.
 *
 * ## What a Host cannot contain
 *
 * Each of these is a property of who owns the pixels, not a bug to fix later:
 *
 * - **Anything that is not a hosted control.** No RN views (`View`, `Text`,
 *   `ScrollView`, `Image`), no third-party native views, no plain text, and no
 *   nitro-ui control that is not `Switch`. A direct child is composed by
 *   the Host or drawn by nobody, so an unsupported one throws in dev (see
 *   `HostChildren.ts`) instead of rendering invisibly on Android and normally on
 *   iOS.
 * - **No interleaving.** RN cannot lay a hosted control next to an RN view, or put
 *   an RN view between two hosted ones: RN hands the Host one rectangle and
 *   everything inside it is Compose's.
 * - **No RN scrolling, clipping or transforming of the children.** A
 *   `ScrollView` around a Host moves the Host's whole rectangle; RN cannot scroll
 *   the content inside it, clip part of it (`removeClippedSubviews`) or transform
 *   one child. A list that virtualises has to add and remove whole children, and
 *   the Host recomposes its block when the set changes.
 * - **No `Modal`**, or anything else that owns a window.
 * - **No nesting.** A `<Host>` cannot hold another `<Host>`: the inner one would be a
 *   row of the outer one's column, measuring nothing, drawing a composition of its
 *   own and answering to no box. Put Hosts side by side, each with its own height.
 * - **No per-child size** - see the sizing rule below.
 * - **Only some of its own styles reach the drawing.** `width`, `height`, `flex` and
 *   `padding` do; `gap`, `flexDirection`, `alignItems`, `justifyContent`,
 *   `borderWidth` and `pointerEvents` do not, because Compose arranges the rows and
 *   Compose takes the touches - while Yoga still honours each of them in the *box*.
 *   Dev builds warn once per instance about each of them.
 *
 * Components are transparent here, in both directions. React flattens them out of
 * the native tree, so a wrapper that renders a `Switch` *is* a direct child of the
 * Host and is hosted - wrapping a control in your own component does not opt it
 * out. The flip side is the rule rather than a gap: a `Switch` inside an RN `View`
 * inside a Host is not hosted, because that `View` is the direct child, and a
 * `View` is what the check above refuses.
 *
 * ## Sizing (D24)
 *
 * A hosted control never measures **its content**, and so never reports: while a
 * Host composes it, its own measure is declined and it builds no composition, so
 * the sizing engine gains no cache entry, no correction, and nothing for D17's
 * first-frame rule to govern.
 *
 * What does not stop is Yoga asking. The engine still answers a measure call per
 * hosted child - the same count as the same children unhosted - from the cached
 * size or the declared fallback, never from Compose. The frame that produces is
 * real (it is what the Host's own height is made of) and decorative (no pixel is
 * placed by it; on Android the view behind it declines to measure and is laid out at
 * `0 x 0`, which is what anything reading real view bounds sees). So `alignSelf: 'stretch'`, `width: '100%'`
 * or a `height` on a hosted control moves the frame RN computes, not what Compose
 * draws, and does not space the rows.
 *
 * The Host places its children itself: one Compose `Column`, in mount order, at
 * the Host's own width, from the top-leading edge of its box, clipped to the box.
 *
 * The Host measures nothing either. Its box is Yoga's: its own `style`, plus its
 * children's decorative boxes. Give it a `height` or `flex: 1` and that is the box;
 * give it neither and its height is the sum of its children's sizing-engine sizes -
 * a row of Compose controls only for as long as those declared sizes match what
 * Compose draws. Dense lists should therefore say how tall they are: when the two
 * disagree, Compose clips to the Host's box, so an over-tall list loses its bottom
 * rows rather than its top. A Host that ends up 0 tall (a `height: 0`, or a parent
 * that gave it none) says so once in development.
 *
 * @see docs/components/host.md for the same rule with the harness cases that hold
 * it, and docs/architecture/sizing.md §10 (D24) for where it sits in the sizing
 * story.
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
  /**
   * Dev-only: a Host that was given no height has nothing to draw into.
   *
   * It is D24 rather than a bug - a Host measures nothing, and a hosted control
   * reports no size - but it is a consequence that looks like one: an empty
   * rectangle where the controls should be, on Android, with the same JSX drawing
   * fine through the iOS passthrough. This says out loud what the box came from.
   *
   * `onLayout` is the only place the box is knowable: `style` says what was asked
   * for, not what Yoga decided (`flex: 1`, or a parent with no height of its own,
   * gets there too). Once per instance - a re-layout per frame would be a new
   * warning per frame about the same mistake.
   */
  const onLayout = (event: LayoutChangeEvent) => {
    props.onLayout?.(event);
    if (warnedAboutHeight.current) {
      return;
    }
    const { width, height } = event.nativeEvent.layout;
    // `Children.toArray` rather than `children != null`: `{show && <Switch/>}` with
    // `show = false`, and `items.map(...)` returning `[]`, are both non-null and both
    // perfectly correct ways to have nothing to draw - and warning about them teaches
    // a person to ignore the warning that matters.
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

  // Dev-only by construction (S4). Attaching a layout handler costs a layout event to
  // JS on every relayout of every Host in a release build, and JS is the one axis a
  // Host already loses on; in release the caller's handler is wired as if this
  // component were not here, which is what its absence in the props table promises.
  const layoutHandler = __DEV__ ? onLayout : props.onLayout;

  if (__DEV__) {
    warnAboutInertStyles(props.style, props.pointerEvents, warnedAboutStyle);
  }

  if (Platform.OS !== 'android') {
    // iOS passthrough, and permanent (D23's outcome, measured by T17): an iOS Host
    // was built and measured, and it lost D23's rule - memory lower, mount UI CPU
    // 1.40x on Switch and unmount UI CPU 6.27x - so H3 is not built and this `View`
    // is what `<Host>` means there. Not a placeholder for a later port: an app that
    // writes `<Host>` gets the same *rule* on both platforms and the mechanism only
    // on one, which is the trade D23 decided to ship.
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
 * The Host's own styles that reach the drawing, and the ones that do not (review S3).
 *
 * A Host sizes its box in Yoga and arranges its children in Compose, and only some of
 * `ViewStyle` survives the trip. `padding` does: the view manager forwards it, so the
 * column starts inside it. What does not is listed here, because Yoga *does* honour
 * each of them when it computes the Host's height - the props buy a box and no
 * arrangement, which is the shape of a layout bug nobody debugs.
 */
const INERT_HOST_STYLES: readonly (keyof ViewStyle)[] = [
  'gap',
  'rowGap',
  'columnGap',
  'alignItems',
  'alignContent',
  'alignSelf',
  'justifyContent',
  'borderWidth',
];

/**
 * Say once per Host instance that some of its `style` will not be drawn.
 *
 * Dev-only, and it can only see plain style objects: a `StyleSheet.create` id is a
 * number to JS, and resolving it would mean reading the stylesheet registry for a
 * warning. That is why `host.md` lists the same set rather than relying on this.
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
      'Compose arranges the children (one column, no gaps), the Host draws no border, ' +
      "and touches go to Compose rather than RN's hit testing. Lay the rows out with " +
      "`padding` and the children's own heights, and space them inside each row " +
      '(docs/components/host.md).'
  );
}

/**
 * The style as a plain object, or `null` when JS cannot see into it.
 *
 * `StyleSheet.flatten` would resolve registered ids, but it also runs for every Host
 * render to serve a dev warning; this reads only what is already an object, which is
 * the common shape for the props this warns about.
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
