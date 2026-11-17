import { StyleSheet } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import type { ComponentName } from '../types';

/**
 * One row height per component. Every implementation of a component gets the
 * same box, tall enough for its tallest control on either platform.
 */
const ROW_HEIGHTS: Record<
  Exclude<
    ComponentName,
    'button' | 'segmented-control' | 'date-picker' | 'picker' | 'menu' | 'form'
  >,
  number
> = {
  'switch': 34,
  // Above SwiftUI's 31 pt and Material 3's 40 dp.
  'slider': 44,
  // The circular variants are the tall ones: 32 pt in SwiftUI, 40 dp in
  // Material 3.
  'progress': 44,
  'text-field': 44,
  // Material 3's minimum interactive size, larger than the 40 dp container.
  'icon-button': 48,
  // Material 3's 40 dp containers sit in a 48 dp minimum interactive box.
  'button-group': 48,
  // Two 48 dp touch targets on Android, ~28 pt on iOS.
  'stepper': 48,
  // Material 3's one-line list item is 56 dp; UIKit's cell is 52 pt.
  'list-item': 56,
};

/**
 * The box every `form` arm gives its one container. For a Form `n` counts the
 * rows inside one list, so there is one box to size, and a fixed height would
 * clip the larger batches.
 */
const formStyle = { width: '100%' as const, flex: 1 as const };

/**
 * The box the `expo-ui-host-per-control` arm gives each of its one-row hosts.
 * A host has no intrinsic size and collapses without one; 56 is the tall row
 * on either platform.
 */
export const FORM_ROW_HOST_STYLE: { width: '100%'; height: number } = {
  width: '100%',
  height: 56,
};

/** The trailing value's box, for the arms whose rows are React Native views. */
export const FORM_VALUE_STYLE = {
  flex: 1,
  textAlign: 'right',
} as const;

/**
 * The kinds of row a `form` arm cycles through, in order. Mixed, because a list
 * of identical labels would miss the control-hosting cell that is most of what
 * a Form costs.
 *
 * - `label`: a title alone;
 * - `detail`: a title with a trailing value, whose text the flip changes length;
 * - `switch`: a title with a control at its trailing edge;
 * - `press`: a row that answers to a press anywhere on it.
 */
export type FormRowKind = 'label' | 'detail' | 'switch' | 'press';

const FORM_ROW_KINDS: readonly FormRowKind[] = [
  'label',
  'detail',
  'switch',
  'press',
];

/** The kind of this arm's `index`th row - the same sequence on every arm. */
export function formRowKind(index: number): FormRowKind {
  const kind = FORM_ROW_KINDS[index % FORM_ROW_KINDS.length];
  return kind ?? 'label';
}

/**
 * The title every arm paints on its `index`th row, constant across the flip.
 * Numbered so the batch is distinct rows and no arm gains from deduplication.
 */
export function formRowLabel(index: number): string {
  return `Row ${String(index + 1)}`;
}

/**
 * The trailing value a `detail` row shows, flipped by `update.form`. Two
 * lengths, so the flip moves the row's measured box and not only its paint.
 */
export function formRowValue(value: boolean): string {
  return value ? 'Every day' : 'Once';
}

/**
 * Whether this arm's `index`th switch row is on, flipped by `update.form`.
 * Staggered by index, so half the switches are on at any time.
 */
export function formSwitchValue(index: number, value: boolean): boolean {
  return (index + (value ? 1 : 0)) % 2 === 0;
}

/** Stable no-op `onPress` for the batch's `press` rows. */
export function onRowPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * Whether a component's size comes from its props. Such a component gets no
 * box to fit into: a fixed height or a stretched width would silence the
 * re-measure its `update` cell prices.
 */
function isSizedByContent(
  component: ComponentName
): component is
  | 'button'
  | 'segmented-control'
  | 'date-picker'
  | 'picker'
  | 'menu' {
  return (
    component === 'button' ||
    component === 'segmented-control' ||
    component === 'date-picker' ||
    component === 'picker' ||
    component === 'menu'
  );
}

/**
 * Row style for a component that sizes itself: every arm hugs its content on
 * both axes. The resulting heights differ per platform.
 */
const fitRowStyle = { alignSelf: 'flex-start' as const };

/**
 * Style for a shared-host arm holding a batch of self-sizing controls.
 * `matchContents` sizes these hosts to their content, so they need no
 * `n`-derived height.
 */
const sharedHostStyle = { width: '100%' as const };

const styles = StyleSheet.create({
  row: { height: ROW_HEIGHTS.switch, width: '100%' },
  sliderRow: { height: ROW_HEIGHTS.slider, width: '100%' },
  progressRow: { height: ROW_HEIGHTS.progress, width: '100%' },
  textFieldRow: { height: ROW_HEIGHTS['text-field'], width: '100%' },
  buttonGroupRow: { height: ROW_HEIGHTS['button-group'], width: '100%' },
});

/**
 * The row style for one component. Always the same object per component: a
 * fresh one per render would be a prop update on every flip that no other arm
 * pays.
 */
export function rowStyle(component: ComponentName) {
  if (component === 'form') {
    return formStyle;
  }
  if (isSizedByContent(component)) {
    return fitRowStyle;
  }
  if (component === 'slider') {
    return styles.sliderRow;
  }
  if (component === 'text-field') {
    return styles.textFieldRow;
  }
  if (component === 'button-group') {
    return styles.buttonGroupRow;
  }
  return component === 'progress' ? styles.progressRow : styles.row;
}

/** One host tall enough for the whole batch, cached per component and `n`. */
const stackStyles = new Map<string, { height: number; width: '100%' }>();

export function stackStyle(
  n: number,
  component: ComponentName
): { height: number; width: '100%' } | typeof sharedHostStyle {
  if (component === 'form') {
    return formStyle;
  }
  if (isSizedByContent(component)) {
    // A height here would override the control's own measurement.
    return sharedHostStyle;
  }
  const key = `${component}:${String(n)}`;
  const cached = stackStyles.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const style = { height: ROW_HEIGHTS[component] * n, width: '100%' as const };
  stackStyles.set(key, style);
  return style;
}

/**
 * Stable no-op handler. JS flips `value`, so every implementation gets the same
 * referentially stable callback: an inline arrow would change identity on every
 * render and hand one implementation cheaper prop diffs than another.
 */
export function onValueChange(_value: boolean): void {
  // Intentionally empty: state is driven by the runner.
}

/** `onValueChange` for a control whose value is a number. */
export function onSliderChange(_value: number): void {
  // Intentionally empty: state is driven by the runner.
}

/** The boolean the runner flips, as the Slider value every arm renders. */
export function sliderValue(value: boolean): number {
  return value ? 0.75 : 0.25;
}

/**
 * The text every TextField arm shows, flipped by the `update.text-field` cell.
 * Two lengths, so a flip writes new text through each arm's controlled path.
 */
export function textFieldValue(value: boolean): string {
  return value ? 'Hello, world' : 'Hello';
}

/** `onChangeText` for the TextField arms: the runner owns the text. */
export function onTextChange(_text: string): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The label every Button arm draws, flipped by the `update.button` cell. The
 * two words differ in length so the flip changes the measured width.
 */
export function buttonTitle(value: boolean): string {
  return value ? 'Saved' : 'Save';
}

/** The two option lists the SegmentedControl arms alternate between. */
const SEGMENTED_SHORT: string[] = ['Day', 'Week', 'Month'];
const SEGMENTED_LONG: string[] = ['Daily', 'Weekly', 'Monthly'];

/**
 * The option list every SegmentedControl arm draws, flipped by the
 * `update.segmented-control` cell.
 *
 * The labels differ in length so the flip moves the measured width. The count
 * stays at three: adding a segment would make the cell partly a mount. Both
 * lists are module-level so no arm pays a change of array identity.
 */
export function segmentedOptions(value: boolean): string[] {
  return value ? SEGMENTED_LONG : SEGMENTED_SHORT;
}

/**
 * The index every SegmentedControl arm has selected. Constant, so the flip is
 * one content change and not also a selection change.
 */
export const SEGMENTED_SELECTION = 1;

/** Stable no-op press handler for the Button arms. */
export function onPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * One glyph, spelled the three ways the arms name it. All three point at the
 * same drawing so no arm gets a cheaper picture than another.
 */
export interface IconButtonGlyph {
  /**
   * The raster the `rn-core` floor loads, and the Expo `Icon`'s source on
   * Android. A PNG because RN's `Image` draws no vector drawable on iOS and
   * refuses an Android `.xml` asset from the dev server.
   */
  source: number;
  /** The SF Symbol both iOS arms name. */
  systemImage: SFSymbol;
  /** The Android glyph nitro-ui resolves: an `.xml` asset's `require`. */
  androidIcon: number;
}

/**
 * The two glyphs every IconButton arm draws, flipped by the
 * `update.icon-button` cell. A glyph swap is the one update every arm can be
 * charged for: the floor has no `checked` to flip and `@expo/ui` has no toggle
 * icon button.
 *
 * The vectors carry a `-vector` suffix because Android names a drawable after
 * the require path without its extension: `circle.png` and `circle.xml` would
 * be one resource name, and aapt fails with "Duplicate resources".
 */
const ICON_BUTTON_GLYPHS: readonly IconButtonGlyph[] = [
  {
    source: require('../../assets/circle.png'),
    systemImage: 'circle.fill',
    androidIcon: require('../../assets/circle-vector.xml'),
  },
  {
    source: require('../../assets/square.png'),
    systemImage: 'square.fill',
    androidIcon: require('../../assets/square-vector.xml'),
  },
];

/** The glyph an IconButton arm should be drawing for this half of the flip. */
export function iconButtonGlyph(value: boolean): IconButtonGlyph {
  return ICON_BUTTON_GLYPHS[value ? 1 : 0] as IconButtonGlyph;
}

/** The accessible name every IconButton arm gives its control. */
export const ICON_BUTTON_LABEL = 'Toggle layout';

/** Stable no-op `onPress` for the IconButton arms. */
export function onIconButtonPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/** One item of the row every ButtonGroup arm mounts. */
export interface BenchButtonGroupItem {
  id: string;
  title: string;
}

/** One of the two rows, spelled as items. */
function benchButtonGroupRow(
  titles: readonly string[]
): BenchButtonGroupItem[] {
  return titles.map((title, index) => ({
    id: `item-${String(index)}`,
    title,
  }));
}

/**
 * The two item lists the ButtonGroup arms alternate between, built once so the
 * `items` prop keeps its identity. The second row is wider, so the flip
 * relayouts the row.
 */
const BUTTON_GROUP_ITEMS: readonly [
  BenchButtonGroupItem[],
  BenchButtonGroupItem[],
] = [
  benchButtonGroupRow(['Copy', 'Paste', 'Share']),
  benchButtonGroupRow(['Duplicate', 'Move', 'Archive']),
];

/** The items a ButtonGroup arm should draw for this half of the flip. */
export function buttonGroupItems(value: boolean): BenchButtonGroupItem[] {
  return BUTTON_GROUP_ITEMS[value ? 1 : 0];
}

/** The same row, spelled as the labels an arm with no ButtonGroup draws. */
export function buttonGroupTitles(value: boolean): readonly string[] {
  return buttonGroupItems(value).map((item) => item.title);
}

/** Stable no-op `onPress` for the ButtonGroup arms. */
export function onButtonGroupPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The value every Stepper arm shows, flipped by the `update.stepper` cell: two
 * whole numbers inside `0...10`, which every arm can express.
 */
export function stepperValue(value: boolean): number {
  return value ? 7 : 3;
}

/** The name every Stepper arm gives its control; constant across the flip. */
export const STEPPER_LABEL = 'Quantity';

/** Stable no-op `onValueChange` for the Stepper arms. */
export function onStepperChange(_value: number): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The title every `list-item` arm draws: a one-line row with a trailing value
 * is the shape every arm can build from the same two pieces of text. Constant
 * across the flip.
 */
export const LIST_ITEM_TITLE = 'Ringtone';

/**
 * The trailing value every `list-item` arm draws, flipped by the
 * `update.list-item` cell. The row keeps its box, so the cell prices a text
 * commit.
 */
export function listItemValue(value: boolean): string {
  return value ? 'Normal' : 'Off';
}

/** Stable no-op `onPress` for the ListItem arms. */
export function onListItemPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The boolean the runner flips, as a Progress value. The same two numbers as
 * `sliderValue`, kept apart so changing one control's flip leaves the other's.
 */
export function progressValue(value: boolean): number {
  return value ? 0.75 : 0.25;
}

/**
 * Stable no-op `onChange` for the SegmentedControl arms. Without parameters, so
 * it satisfies each runtime's change-event signature.
 */
export function onSegmentChange(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The two instants every DatePicker arm shows, built once so no arm pays a new
 * `Date` identity per flip. Same month, year and clock time: the flip changes
 * the displayed day without moving the calendar's page or year header.
 */
const DATES = [
  new Date(2026, 10, 4, 9, 0),
  new Date(2026, 10, 14, 9, 0),
] as const;

/** The instant every DatePicker arm selects, flipped by `update.date-picker`. */
export function dateValue(value: boolean): Date {
  return DATES[value ? 1 : 0];
}

/**
 * The same instant as text, for the `rn-core` floor, which has no date picker.
 * One formatter for the module: building one per render would price ICU setup.
 */
const DATE_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

export function dateLabel(value: boolean): string {
  return DATE_LABEL_FORMAT.format(dateValue(value));
}

/**
 * Stable no-op date handler. Without parameters, so it satisfies each runtime's
 * change-event signature.
 */
export function onDateChange(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The option list every Picker arm draws, constant across the flip: a Picker's
 * width follows the title it paints, so moving the selection already moves the
 * width.
 */
const PICKER_OPTIONS: string[] = [
  'Day',
  'Month',
  'A considerably longer choice',
];

/** The options every Picker arm mounts. */
export function pickerOptions(): string[] {
  return PICKER_OPTIONS;
}

/**
 * The selected index each arm paints, flipped by the `update.picker` cell: the
 * shortest title against the longest, so the control re-measures.
 */
export function pickerSelection(value: boolean): number {
  return value ? PICKER_OPTIONS.length - 1 : 0;
}

/** Stable no-op `onChange` for the Picker arms. */
export function onPickerChange(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The trigger label every Menu arm draws, flipped by the `update.menu` cell. A
 * Menu's box is its trigger's, sized like a Button's label, so the two titles
 * differ in length.
 */
export function menuTitle(value: boolean): string {
  return value ? 'More actions' : 'More';
}

/**
 * The item list every Menu arm mounts, constant across the flip and built once
 * so its identity never changes. Plain rows only: nitro-ui flattens submenus
 * and sections in JS, which would price JS work in a native ratio.
 */
const MENU_ITEMS: string[] = ['Rename', 'Duplicate', 'Move to a longer folder'];

/** The rows every Menu arm mounts. */
export function menuItems(): string[] {
  return MENU_ITEMS;
}

/** Stable no-op `onSelect` for the Menu arms. The bench never opens a popup. */
export function onMenuSelect(): void {
  // Intentionally empty: state is driven by the runner.
}

export function range(n: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < n; index++) {
    out.push(index);
  }
  return out;
}
