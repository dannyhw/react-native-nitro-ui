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
 *   everything inside it is Compose's. A control that is *not* a direct child (one
 *   inside an RN `View` inside the Host) is not hosted either - it renders as the
 *   standalone control it looks like.
 * - **No RN scrolling, clipping or transforming of the children.** A
 *   `ScrollView` around a Host moves the Host's whole rectangle; RN cannot scroll
 *   the content inside it, clip part of it (`removeClippedSubviews`) or transform
 *   one child. A list that virtualises has to add and remove whole children, and
 *   the Host recomposes its block when the set changes.
 * - **No `Modal`**, or anything else that owns a window.
 * - **No per-child size** - see the sizing rule below.
 *
 * ## Sizing (D24)
 *
 * A hosted control has no RN box. It never measures - its own measure is declined
 * while a Host composes it - so it reports nothing to the sizing engine, gets no
 * cache entry, and is never corrected. `style` on a hosted control does not place
 * it: the Host stacks its children in a Compose `Column`, in mount order, and
 * their Yoga frames are decorative.
 *
 * The **Host's** box is RN's, and it comes from its `style` alone - a `height`, or
 * `flex: 1`, or being stretched by its parent. It does not measure its content,
 * because its children contribute nothing to Yoga: a Host with no height gets none,
 * and its content is not visible. Inside a Host, cross-axis sizing like
 * `alignSelf: 'stretch'` or `width: '100%'` on a child does not resize what Compose
 * draws - it is a Yoga decision about a box Yoga is not placing.
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
   * It is a consequence of D24 rather than a bug - the Host measures no content,
   * because a hosted control reports no size - but it is a consequence that looks
   * like a bug: an empty rectangle where the controls should be, on one platform,
   * with the same JSX working on the other. RN lays a plain `View` out at its
   * children's height; this says out loud that a Host does not.
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
          'visible. A Host takes its box from its own style (a `height`, or ' +
          '`flex: 1`, or a parent that stretches it) and never from its content: a ' +
          'hosted control reports no size (D24, docs/architecture/sizing.md §10), so ' +
          'unlike a plain <View> it will not grow to fit.'
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
