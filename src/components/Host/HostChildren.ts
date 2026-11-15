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
import { AlertDialog, ConfirmationDialog } from '../Dialog/Dialog';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { TextField } from '../TextField/TextField';
import { Chip } from '../Chip/Chip';
import { Tooltip } from '../Tooltip/Tooltip';
import { Checkbox } from '../Checkbox/Checkbox';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { SearchField } from '../SearchField/SearchField';
import { IconButton } from '../IconButton/IconButton';
import { Popover } from '../Popover/Popover';
import { Form } from '../Form/Form';
import { ButtonGroup } from '../ButtonGroup/ButtonGroup';
import { Stepper } from '../Stepper/Stepper';
import { ListItem } from '../ListItem/ListItem';

/**
 * The controls a Host can compose. Keyed by the component itself, not by name:
 * a component called `Switch` from another package is a view the Host cannot
 * compose. Each row needs a matching `isHostable` override on the control's
 * Android host.
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
  [AlertDialog, 'AlertDialog'],
  [ConfirmationDialog, 'ConfirmationDialog'],
]);

/**
 * This library's controls that a Host refuses. They are named because an
 * unhostable child is skipped on Android and draws nothing. Some are refused by
 * design: their content or anchor is React Native views, which a Host cannot
 * hold. The others have not been measured inside a shared composition.
 */
export const UNHOSTABLE_CONTROLS = new Map<unknown, string>([
  [TextField, 'TextField'],
  [Chip, 'Chip'],
  [Checkbox, 'Checkbox'],
  [SearchField, 'SearchField'],
  [IconButton, 'IconButton'],
  [BottomSheet, 'BottomSheet'],
  [ContextMenu, 'ContextMenu'],
  [Tooltip, 'Tooltip'],
  [Popover, 'Popover'],
  [Form, 'Form'],
  [ButtonGroup, 'ButtonGroup'],
  [Stepper, 'Stepper'],
  [ListItem, 'ListItem'],
]);

/**
 * The React Native views a Host refuses, matched by identity: `displayName`
 * would also reject an app's own `View`. Not exhaustive; in development the
 * native Host reports any other child it cannot compose. `ImageBackground` and
 * `SafeAreaView` are left out because reading either export logs a deprecation
 * warning, and this table is built at module load.
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

/** The names in {@link HOSTABLE_CONTROLS}, for the error message. */
export const HOSTABLE_NAMES: readonly string[] = [
  ...HOSTABLE_CONTROLS.values(),
];

/**
 * The event a debuggable Android build emits for a child it will not compose.
 * The name must match `HOST_UNHOSTABLE_CHILD_EVENT` in `NitroUiHost.kt`.
 */
const UNHOSTABLE_CHILD_EVENT = 'NitroUiHostUnhostableChild';

let listeningForUnhostableChildren = false;

/**
 * Logs the native Host's report as a JS error, in development. Native sees
 * children JS cannot (a control behind a `memo`, an RN view behind a wrapper
 * component). It logs rather than throws because the tree is already mounting.
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
 * Throws, in development, when a Host holds something it cannot compose. An
 * unsupported child draws nothing on Android, and only JS can name it. The check
 * runs on iOS too, where a Host is a passthrough, so both platforms accept the
 * same children.
 *
 * It walks arrays and fragments, which do not exist in the native tree. It
 * cannot see through a component, so an unknown component passes and the native
 * Host judges what it renders.
 *
 * @param hostComponent the `Host` component, passed in so a nested `<Host>` can
 *   be refused without this module importing `Host.tsx`, which would be a cycle.
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
 *   JSX.
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
    // `{label && <Switch/>}` gives the string `''` when `label` is empty, and
    // React draws nothing for it.
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
        ? // Names the package: an app may import both Switches.
          `react-native's <${UNHOSTABLE_RN_VIEWS.get(children.type)}>`
        : // A string tag is a host component, and none of those is a nitro-ui
          // control. This catches a raw tag and a third-party native component.
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
