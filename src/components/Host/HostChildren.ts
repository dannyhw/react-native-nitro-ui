import { Fragment, type ReactNode, isValidElement } from 'react';
import {
  ActivityIndicator,
  Button as RNButton,
  FlatList,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
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

/**
 * The controls a Host can compose, keyed by the component itself.
 *
 * Keyed by identity, not by name: `<Switch>` from this library is what a Host
 * composes, and a component called `Switch` that is not ours (RN's own, or an
 * app's) hands the composition a view it has never seen. A `Map` so the name in
 * the error comes from the same table as the permission - hosting one more
 * control means adding one row here, and nothing else decides.
 *
 * One row today: H1 ships the Host for Switch, which is T16's condition 1 ("one
 * arm per component before it is claimed"). The rest are refused rather than
 * rendered into a composition that was never measured for them.
 */
const HOSTABLE_CONTROLS = new Map<unknown, string>([[Switch, 'Switch']]);

/**
 * This library's other controls, by the same identity rule.
 *
 * They are named rather than left to fall through because of what an unhostable
 * nitro-ui child does on Android: the Host skips it and it draws nothing.
 * `src/__tests__/host.test.tsx` walks `src/components` and fails if a control is
 * added without a row in one of the two tables, so this list cannot quietly fall
 * behind the library.
 */
const UNHOSTABLE_CONTROLS = new Map<unknown, string>([
  [Button, 'Button'],
  [DatePicker, 'DatePicker'],
  [Picker, 'Picker'],
  [Progress, 'Progress'],
  [SegmentedControl, 'SegmentedControl'],
  [Slider, 'Slider'],
]);

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
 */
const UNHOSTABLE_RN_VIEWS = new Map<unknown, string>([
  [ActivityIndicator, 'ActivityIndicator'],
  [FlatList, 'FlatList'],
  [Image, 'Image'],
  [ImageBackground, 'ImageBackground'],
  [KeyboardAvoidingView, 'KeyboardAvoidingView'],
  [Modal, 'Modal'],
  [Pressable, 'Pressable'],
  [RefreshControl, 'RefreshControl'],
  [RNButton, 'Button'],
  [RNSwitch, 'Switch'],
  [SafeAreaView, 'SafeAreaView'],
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
 * Fail loudly, in dev, when a Host holds something it cannot compose.
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
export function assertHostChildren(children: ReactNode): void {
  if (!__DEV__) {
    return;
  }
  visit(children, '');
}

/**
 * @param position where the child sits, for the error: `2`, or `1/0` under a
 *   fragment. Positions count per list, which is what a person can find in the
 *   JSX; a flattened index would name nothing.
 */
function visit(children: ReactNode, position: string): void {
  if (children == null || typeof children === 'boolean') {
    return;
  }
  if (Array.isArray(children)) {
    children.forEach((child, index) => {
      visit(child, join(position, index));
    });
    return;
  }
  if (!isValidElement(children)) {
    throw new Error(childError(describeText(children), position));
  }
  if (HOSTABLE_CONTROLS.has(children.type)) {
    return;
  }
  if (children.type === Fragment) {
    visit((children.props as { children?: ReactNode }).children, position);
    return;
  }
  const unhostable =
    UNHOSTABLE_CONTROLS.get(children.type) ??
    UNHOSTABLE_RN_VIEWS.get(children.type) ??
    // A string tag is a host component whatever it is called, and none of them is
    // a nitro-ui control. RN's own are in the table above by identity; this catches
    // a raw tag and a third-party native component.
    (typeof children.type === 'string' ? String(children.type) : null);
  if (unhostable != null) {
    throw new Error(childError(`<${unhostable}>`, position));
  }
}

function join(position: string, index: number): string {
  return position === '' ? String(index) : `${position}/${index}`;
}

function describeText(child: ReactNode): string {
  const text = String(child);
  return `the text "${text.length > 20 ? `${text.slice(0, 20)}…` : text}"`;
}

function childError(child: string, position: string): string {
  return (
    'react-native-nitro-ui: a <Host> composes its direct children into one native ' +
    `composition, and renders only ${HOSTABLE_NAMES.join(', ')}. Child ${position || '0'} ` +
    `of this <Host> is ${child}, which it would skip on Android and lay out as a ` +
    'plain view on iOS. Move it outside the <Host>, or replace it with a control ' +
    `it renders (${HOSTABLE_NAMES.join(', ')}).`
  );
}
