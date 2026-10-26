import { useRef, type ReactNode } from 'react';
import {
  Platform,
  View,
  type LayoutChangeEvent,
  type ViewProps,
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
 * composition rather than fifty. Measured (T16, `quick`, `speed-profile`, N=200):
 * **0.87x** `expo-ui-shared-host` on mount memory and **0.80x** on mount UI CPU
 * per op, against 2.75x and 1.50x without a Host. What it pays with is the JS
 * thread - a hosted control is still an RN node *plus* a child of somebody else's
 * composition: **1.10x** the shared host on mount JS CPU per op. Opt-in for that
 * reason, not a default.
 *
 * Only `Switch` is hosted today; anything else as a direct child throws in
 * development rather than rendering half a screen. Hosting another control means
 * adding one row to the table in `HostChildren.ts` (and a bench arm for it).
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
 * - **No per-child size** - see the sizing rule below.
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
 * A hosted control **never measures**. While a Host composes it, its own measure
 * is declined, so it reports nothing to the sizing engine: no cache entry, no
 * correction, and D17's first-frame rule does not apply - there is no measurement
 * that could arrive late.
 *
 * Its RN box still exists, and it is still the engine's answer for that
 * configuration (a measured size, or the declared fallback): the shadow node does
 * not know who draws the control. It is decorative - nothing reads it to place
 * pixels. The Host places its children itself, in a Compose `Column`, in mount
 * order, at the Host's own width. So `alignSelf: 'stretch'`, `width: '100%'` or a
 * `height` on a hosted control moves the frame RN computes, not what Compose draws.
 *
 * The Host measures nothing either. Its box is Yoga's: its own `style`, plus its
 * children's decorative boxes. Give it a `height` or `flex: 1` and that is the box;
 * give it neither and its height is the sum of its children's sizing-engine sizes -
 * a row of Compose controls only for as long as those declared sizes match what
 * Compose draws. Dense lists should therefore say how tall they are: when the two
 * disagree, Compose clips to the smaller box. A Host that ends up 0 tall (a
 * `height: 0`, or a parent that gave it none) says so once in development.
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
  assertHostChildren(children);
  const warnedAboutHeight = useRef(false);
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
    if (!__DEV__ || warnedAboutHeight.current) {
      return;
    }
    const { width, height } = event.nativeEvent.layout;
    if (height === 0 && width > 0 && children != null) {
      warnedAboutHeight.current = true;
      console.warn(
        'react-native-nitro-ui: a <Host> measured 0 tall, so nothing inside it is ' +
          'visible. A Host measures nothing: its box is its own `style` plus the ' +
          'boxes RN computes for its children, and nothing inside it can grow it ' +
          'back. Give it a `height` or `flex: 1`, or take the height away from ' +
          'whatever parent is refusing it (D24, docs/architecture/sizing.md). '
      );
    }
  };

  if (Platform.OS !== 'android') {
    // iOS passthrough, deliberately: the iOS Host is a spike (T17), and until it
    // clears D23's bar an app that writes `<Host>` must not get a different tree on
    // the other platform than it tested. The children render exactly as they do
    // outside a Host, in a plain `View`; `HostChildren.ts` is why the *rule* is the
    // same even while the mechanism is not.
    return (
      <View {...props} onLayout={onLayout} testID={props.testID}>
        {children}
      </View>
    );
  }
  return (
    <NativeNitroUiHost {...props} onLayout={onLayout}>
      {children}
    </NativeNitroUiHost>
  );
}
