import { Fragment, type ReactNode, isValidElement } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Platform,
  Button as RNButton,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Switch as RNSwitch,
  Text,
  TextInput,
  TouchableHighlight,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import { Button } from '../Button/Button';
import { DatePicker } from '../DatePicker/DatePicker';
import { Picker } from '../Picker/Picker';
import { Progress } from '../Progress/Progress';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl';
import { Slider } from '../Slider/Slider';
import { Switch } from '../Switch/Switch';
import { Menu } from '../Menu/Menu';

/**
 * The controls a Host can compose, keyed by the component itself.
 *
 * Keyed by identity, not by name: `<Switch>` from this library is what a Host
 * composes, and a component called `Switch` that is not ours (RN's own, or an
 * app's) hands the composition a view it has never seen. A `Map` so the name in
 * the error comes from the same table as the permission - hosting one more
 * control means adding one row here, and nothing else decides.
 *
 * Eight rows: `Switch` from H1, `Slider`, `Progress`, `Button` from H2a,
 * `SegmentedControl`, `Picker`, `DatePicker` from H2b and `Menu` from G7a/G7b - each
 * with a bench arm and a device suite behind it (T16's condition 1 - "one arm per
 * component before it is claimed"). A row here is one half of the rule; the other is
 * the `isHostable` override on the control's own Android host, and the two are the same
 * decision seen from the two sides that have to agree.
 *
 * The H2b three are the ones a `<Host>` was said not to be able to hold, because two of
 * them (`Picker`, `DatePicker`) present a popup or a dialog: a window of its own. The answer H2b
 * measured is that a Compose popup or dialog opened from inside the Host's
 * composition is *that composition's* window - which is what closes it when the Host
 * goes away, and what anchors it to the box the Host drew
 * (`docs/components/host.md`, "Popups and dialogs"). A control is refused only if
 * hosting it is shown to be broken, and none of these is: `Menu`'s list is a third
 * such window, gated the same way for a hosted trigger (`example/__tests__/Menu.harness.tsx`).
 */
export const HOSTABLE_CONTROLS = new Map<unknown, string>([
  [Button, 'Button'],
  [DatePicker, 'DatePicker'],
  [Picker, 'Picker'],
  [Progress, 'Progress'],
  [SegmentedControl, 'SegmentedControl'],
  [Slider, 'Slider'],
  [Switch, 'Switch'],
  [Menu, 'Menu'],
]);

/**
 * This library's controls that a Host refuses, by the same identity rule.
 *
 * It names them rather than leaving them to fall through because of what an
 * unhostable nitro-ui child does on Android: the Host skips it and it draws nothing.
 * `src/__tests__/host.test.tsx` walks `src/components` and fails if a control is
 * added without a row in one of the two tables, so this list cannot quietly fall
 * behind the library.
 *
 * **Empty since H2b**: every control the library ships is hosted, so there is
 * nothing left to refuse here for being what it is. The table and the check that
 * reads it stay, because they are the row the *next* control goes on - a
 * TextField, anything added before it has been measured inside a Host starts here,
 * refused, until a round measures it. `host.test.tsx` proves the sentence still
 * works by putting a stand-in in this table, because nothing in the library does any
 * more.
 */
export const UNHOSTABLE_CONTROLS = new Map<unknown, string>([]);

/**
 * The RN views an app reaches for, so that "no RN views in a Host" is checked
 * rather than hoped.
 *
 * A direct RN child is what the spike found to be silently wrong: the Host skips
 * it, and no composition is asked to draw it. RN hands JS a `forwardRef` object
 * for these, not the native name, so the only honest check is identity against the
 * components themselves - `displayName` would also reject an app's own `View`, and
 * would miss RN's own `Switch` being passed for ours. Not exhaustive by nature
 * (`Animated.*`, and any third-party native view); what JS cannot see, the native
 * Host says out loud in dev when it is handed a child it cannot compose.
 * `ImageBackground` and `SafeAreaView` are left to the native check on purpose:
 * reading either export makes React Native log a deprecation warning, and this
 * table is built when the module loads, i.e. in every app that imports `Host`.
 */
const UNHOSTABLE_RN_VIEWS = new Map<unknown, string>([
  [ActivityIndicator, 'ActivityIndicator'],
  [FlatList, 'FlatList'],
  [Image, 'Image'],
  [KeyboardAvoidingView, 'KeyboardAvoidingView'],
  [Modal, 'Modal'],
  [Pressable, 'Pressable'],
  [RefreshControl, 'RefreshControl'],
  [RNButton, 'Button'],
  [RNSwitch, 'Switch'],
  [ScrollView, 'ScrollView'],
  [SectionList, 'SectionList'],
  [Text, 'Text'],
  [TextInput, 'TextInput'],
  [TouchableHighlight, 'TouchableHighlight'],
  [TouchableOpacity, 'TouchableOpacity'],
  [TouchableWithoutFeedback, 'TouchableWithoutFeedback'],
  [View, 'View'],
]);

/** The names in {@link HOSTABLE_CONTROLS}, for the error and the docs. */
export const HOSTABLE_NAMES: readonly string[] = [
  ...HOSTABLE_CONTROLS.values(),
];

/**
 * The event a debuggable Android build emits for a child it will not compose.
 *
 * The other half of it is `HOST_UNHOSTABLE_CHILD_EVENT` in
 * `android/.../core/NitroUiHost.kt`; the name is the wire format between the two, so
 * it is written twice on purpose, in the two places a person editing either can see
 * the other.
 */
const UNHOSTABLE_CHILD_EVENT = 'NitroUiHostUnhostableChild';

let listeningForUnhostableChildren = false;

/**
 * Turn the native Host's report into a JS error, in development.
 *
 * The native side *sees* what React flattened JS could not (a `Picker` behind a
 * `memo`, an RN view behind a `<Row>`, another `<Host>`) and used to say so in logcat
 * only - which no app author reads (review S5). A device event reaches Metro and
 * LogBox, where a dev-time problem actually lives. It cannot throw: the tree is
 * already mounting on the UI thread, and a library that crashes an app from inside
 * `addView` has chosen the worse of two dev-time outcomes.
 */
function listenForUnhostableChildren(): void {
  if (listeningForUnhostableChildren || Platform.OS !== 'android') {
    return;
  }
  listeningForUnhostableChildren = true;
  DeviceEventEmitter.addListener(
    UNHOSTABLE_CHILD_EVENT,
    (report: { message?: string } | undefined) => {
      console.error(
        report?.message ??
          'react-native-nitro-ui: a <Host> was handed a child it cannot compose, and ' +
            'it will not be drawn on Android (docs/components/host.md).'
      );
    }
  );
}

/**
 * Fail loudly, in dev, when a Host holds something it cannot compose.
 *
 * @param hostComponent the `Host` component itself, passed by the component so a
 *   nested `<Host>` can be recognised without `HostChildren.ts` importing `Host.tsx`
 *   (which would be a cycle, and a `Map` built against a component that has not been
 *   defined yet). Nesting is refused rather than composed: the inner Host would become
 *   a child of the outer one's `Column`, where it measures nothing, draws a nested
 *   composition, and answers to no box (review M2).
 *
 * **Why a check at all.** A Host composes its direct nitro-ui children and skips
 * everything else, so an RN view inside one draws nothing on Android: the only
 * thing that could have drawn it is the composition it was never invited into.
 * That is silently wrong, and JS is the only place that can name the child - the
 * native Host sees a `View`, never a `<ScrollView>`.
 *
 * **Why it throws on iOS too**, where `<Host>` is a passthrough and a plain RN
 * child would render fine. Not to be correct there, but to be *one* contract: a
 * Host's children are its content, not RN's, on both platforms (D23), and an app
 * must not learn that on the platform it did not test.
 *
 * **What it walks:** arrays and fragments, because neither exists in the native
 * tree - a child under one *is* a direct child of the Host.
 *
 * **What it cannot see, and does not pretend to:** another component. React
 * flattens components out of the native tree, so whatever a child component
 * renders *becomes* a direct child of the Host - a `<Row>` that returns a
 * `<Switch>` is hosted, and nothing here could have told the two shapes apart.
 * That is the same limit the native direct-parent rule has, so an unknown
 * component passes and the view it returns decides; the native Host reports a child
 * it cannot compose in dev. What is refused is what JS can *prove*: a text node, a
 * host component, one of RN's own views, or one of our controls that is not hosted
 * yet.
 */
export function assertHostChildren(
  children: ReactNode,
  hostComponent?: unknown
): void {
  if (!__DEV__) {
    return;
  }
  listenForUnhostableChildren();
  visit(children, '', hostComponent);
}

/**
 * @param position where the child sits, for the error: `2`, or `1/0` under a
 *   fragment. Positions count per list, which is what a person can find in the
 *   JSX; a flattened index would name nothing.
 */
function visit(
  children: ReactNode,
  position: string,
  hostComponent: unknown
): void {
  if (
    children == null ||
    children === '' ||
    typeof children === 'boolean' ||
    // An empty string is how `{label && <Switch/>}` arrives when `label` is `''`,
    // and React draws nothing for it - `View` does not complain about that shape
    // either, so neither may a Host.
    (typeof children === 'string' && children.length === 0)
  ) {
    return;
  }
  if (Array.isArray(children)) {
    children.forEach((child, index) => {
      visit(child, join(position, index), hostComponent);
    });
    return;
  }
  if (!isValidElement(children)) {
    throw new Error(childError(describeText(children), position));
  }
  if (HOSTABLE_CONTROLS.has(children.type)) {
    return;
  }
  if (hostComponent != null && children.type === hostComponent) {
    throw new Error(nestedHostError(position));
  }
  if (children.type === Fragment) {
    visit(
      (children.props as { children?: ReactNode }).children,
      position,
      hostComponent
    );
    return;
  }
  const unhostable =
    (UNHOSTABLE_CONTROLS.get(children.type) ?? null) !== null
      ? `react-native-nitro-ui's <${UNHOSTABLE_CONTROLS.get(children.type)}>`
      : (UNHOSTABLE_RN_VIEWS.get(children.type) ?? null) !== null
        ? // "react-native's `<Switch>`" rather than a bare `<Switch>`: the message
          // must survive an app that imports both Switches and wrote the wrong one.
          `react-native's <${UNHOSTABLE_RN_VIEWS.get(children.type)}>`
        : // A string tag is a host component whatever it is called, and none of them
          // is a nitro-ui control. RN's own are in the table above by identity; this
          // catches a raw tag and a third-party native component.
          typeof children.type === 'string'
          ? `<${String(children.type)}>`
          : null;
  if (unhostable != null) {
    throw new Error(childError(unhostable, position));
  }
}

function join(position: string, index: number): string {
  return position === '' ? String(index) : `${position}/${index}`;
}

function describeText(child: ReactNode): string {
  const text = String(child);
  return `the text "${text.length > 20 ? `${text.slice(0, 20)}…` : text}"`;
}

function nestedHostError(position: string): string {
  return (
    'react-native-nitro-ui: a <Host> cannot hold another <Host>. Child ' +
    `${position || '0'} of this <Host> is a <Host>, which the outer one would ` +
    'compose as a child of its own column - it would measure nothing, draw a nested ' +
    'composition, and answer to no box of its own. Put the two Hosts side by side ' +
    'instead, each with its own height (docs/components/host.md).'
  );
}

function childError(child: string, position: string): string {
  return (
    'react-native-nitro-ui: a <Host> composes its direct children into one native ' +
    `composition, and renders only ${HOSTABLE_NAMES.join(', ')}. Child ${position || '0'} ` +
    `of this <Host> is ${child}, which it would skip on Android and lay out as a ` +
    'plain view on iOS. Move it outside the <Host>, or replace it with a control it ' +
    `renders (${HOSTABLE_NAMES.join(', ')}).`
  );
}
