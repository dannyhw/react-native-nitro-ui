import {
  Button,
  DatePicker,
  Form,
  Host,
  HStack,
  LabeledContent,
  Menu,
  Picker,
  ProgressView,
  Section,
  Slider,
  Stepper,
  Text,
  TextField,
  Toggle,
  VStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  labelStyle,
  labelsHidden,
  menuIndicator,
  menuStyle,
  pickerStyle,
  progressViewStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import { ListItem } from '@expo/ui';

import { useEffect } from 'react';

import type { BenchListProps } from '../types';
import {
  onPickerChange,
  SEGMENTED_SELECTION,
  buttonGroupItems,
  buttonTitle,
  dateValue,
  FORM_ROW_HOST_STYLE,
  formRowKind,
  formRowLabel,
  formRowValue,
  formSwitchValue,
  ICON_BUTTON_LABEL,
  iconButtonGlyph,
  listItemValue,
  LIST_ITEM_TITLE,
  onListItemPress,
  menuItems,
  menuTitle,
  onDateChange,
  onButtonGroupPress,
  onIconButtonPress,
  onPress,
  onMenuSelect,
  onRowPress,
  onSegmentChange,
  onSliderChange,
  onValueChange,
  progressValue,
  range,
  rowStyle,
  pickerOptions,
  pickerSelection,
  segmentedOptions,
  sliderValue,
  stepperValue,
  STEPPER_LABEL,
  onStepperChange,
  stackStyle,
  onTextChange,
  textFieldValue,
} from './shared';

/**
 * Module-level so each modifier array keeps one identity across renders, instead
 * of handing the host a fresh prop on every flip.
 */
const LABELS_HIDDEN = [labelsHidden()];

/**
 * `.labelStyle(.iconOnly)`: the label keeps its text for the screen reader and
 * SwiftUI draws only the symbol. `@expo/ui` has no `IconButton` on iOS, so this
 * is its equivalent.
 */
const ICON_ONLY = [labelStyle('iconOnly')];

/**
 * `.borderedProminent` is what a plain SwiftUI `Button` already is, so this only
 * pins the style against a future default change: the arm must keep measuring the
 * same control.
 */
const BORDERED_PROMINENT = [buttonStyle('borderedProminent')];

/** `.bordered`, the look nitro-ui's `ButtonGroup` gives its `standard` items. */
const BORDERED = [buttonStyle('bordered')];

/**
 * `.linear` is spelled explicitly rather than left to `automatic`, so the arm
 * does not depend on the container it sits in to be the control under test.
 */
const LINEAR_STYLE = [progressViewStyle('linear')];

/**
 * `.segmented` is the same native control nitro-ui hosts. `labelsHidden()`
 * because a labelled `Picker` lays out a label `Text` that no other arm draws.
 */
const SEGMENTED_MODIFIERS = [pickerStyle('segmented'), labelsHidden()];

/**
 * The `tag` a segmented option needs, one array per position, built once so the
 * `modifiers` prop keeps its identity across renders. Three, because every
 * arm's option list has three labels.
 */
const TAG_MODIFIERS = [[tag(0)], [tag(1)], [tag(2)]];

/**
 * `.menu`, the platform control nitro-ui's `variant: 'menu'` hosts.
 * `labelsHidden()` for the same reason as `SEGMENTED_MODIFIERS`.
 */
const MENU_MODIFIERS = [pickerStyle('menu'), labelsHidden()];

/**
 * The trigger shape nitro-ui's iOS Menu asks SwiftUI for. Without these,
 * `@expo/ui`'s `Menu` renders SwiftUI's default menu look, a label with a
 * chevron and no button chrome, and the arm would measure a different box from
 * the control under test.
 */
const MENU_TRIGGER_MODIFIERS = [
  menuStyle('button'),
  menuIndicator('hidden'),
  buttonStyle('borderedProminent'),
];

function tagModifiers(segment: number) {
  const modifiers = TAG_MODIFIERS[segment];
  if (modifiers == null) {
    throw new Error(
      `bench: the Expo UI segmented arm supports ${String(TAG_MODIFIERS.length)} ` +
        `options; option ${String(segment)} has no tag to carry its selection.`
    );
  }
  return modifiers;
}

/**
 * No `label`, plus `labelsHidden()`: a labelled SwiftUI `Toggle` lays out and
 * renders a `Text` per control, which neither RN's `Switch` nor nitro-ui's
 * does. `testID` keeps per-control identity without drawing anything.
 */
function BenchToggle({ index, value }: { index: number; value: boolean }) {
  return (
    <Toggle
      testID={`bench-expo-${String(index)}`}
      isOn={value}
      onIsOnChange={onValueChange}
      modifiers={LABELS_HIDDEN}
    />
  );
}

/**
 * A SwiftUI `Button` whose label is a plain string.
 */
function BenchButton({ index, value }: { index: number; value: boolean }) {
  return (
    <Button
      testID={`bench-expo-button-${String(index)}`}
      label={buttonTitle(value)}
      onPress={onPress}
      modifiers={BORDERED_PROMINENT}
    />
  );
}

/**
 * A `Button` whose label is a symbol and nothing else. `label` stays set even
 * though it is not drawn: it is the control's accessible name, which every
 * other arm passes too. The default `.borderless` button style is kept, which
 * is nitro-ui's `standard` variant.
 */
function BenchIconButton({ index, value }: { index: number; value: boolean }) {
  return (
    <Button
      testID={`bench-expo-icon-button-${String(index)}`}
      label={ICON_BUTTON_LABEL}
      systemImage={iconButtonGlyph(value).systemImage}
      onPress={onIconButtonPress}
      modifiers={ICON_ONLY}
    />
  );
}

/**
 * `@expo/ui`'s SwiftUI `Stepper`. `labelsHidden()` because SwiftUI's `Stepper`
 * requires a label and the control under test shows none. `min`/`max` match
 * every other arm's range.
 */
function BenchStepper({ index, value }: { index: number; value: boolean }) {
  return (
    <Stepper
      testID={`bench-expo-stepper-${String(index)}`}
      label={STEPPER_LABEL}
      value={stepperValue(value)}
      min={0}
      max={10}
      step={1}
      onValueChange={onStepperChange}
      modifiers={LABELS_HIDDEN}
    />
  );
}

/**
 * The row nitro-ui's `ButtonGroup` draws at its defaults, rebuilt from `@expo/ui`'s
 * primitives: an `HStack` of three bordered `Button`s at the same 8 pt gap.
 *
 * Not `ControlGroup`: that is SwiftUI's connected track, which collapses a
 * `Button`'s chrome and drops trailing labels, so it would be a different control
 * from the one under test.
 */
function BenchButtonGroup({ index, value }: { index: number; value: boolean }) {
  return (
    <HStack spacing={8} testID={`bench-expo-button-group-${String(index)}`}>
      {buttonGroupItems(value).map((item) => (
        <Button
          key={item.id}
          label={item.title}
          onPress={onButtonGroupPress}
          modifiers={BORDERED}
        />
      ))}
    </HStack>
  );
}

/**
 * `@expo/ui`'s universal `ListItem`, which on iOS is a SwiftUI `Button` with a
 * headline and a trailing slot. Not `LabeledContent`, because the row under test
 * presses and a labeled content row has no press of its own.
 */
function BenchListItem({ index, value }: { index: number; value: boolean }) {
  return (
    <ListItem
      testID={`bench-expo-list-item-${String(index)}`}
      onPress={onListItemPress}
      trailing={<Text>{listItemValue(value)}</Text>}
    >
      <Text>{LIST_ITEM_TITLE}</Text>
    </ListItem>
  );
}

function BenchSlider({ index, value }: { index: number; value: boolean }) {
  return (
    <Slider
      testID={`bench-expo-slider-${String(index)}`}
      value={sliderValue(value)}
      min={0}
      max={1}
      onValueChange={onSliderChange}
    />
  );
}

/**
 * `@expo/ui`'s SwiftUI `TextField`, with its text in an observable - the one way
 * Expo takes a value - written when the runner flips, so `update.text-field` is a
 * text write here as it is for the other arms.
 */
function BenchTextField({ index, value }: { index: number; value: boolean }) {
  const text = useNativeState<string>(textFieldValue(value));
  useEffect(() => {
    text.value = textFieldValue(value);
  }, [text, value]);
  return (
    <TextField
      testID={`bench-expo-text-field-${String(index)}`}
      text={text}
      onTextChange={onTextChange}
    />
  );
}

/**
 * A SwiftUI `ProgressView` with no label: `children` would render as a `Text`
 * next to the bar, which no other arm draws.
 */
function BenchProgress({ index, value }: { index: number; value: boolean }) {
  return (
    <ProgressView
      testID={`bench-expo-progress-${String(index)}`}
      value={progressValue(value)}
      modifiers={LINEAR_STYLE}
    />
  );
}

/**
 * A segmented `Picker` whose options are the same three labels every other arm
 * draws, with the same one selected.
 */
function BenchSegmented({ index, value }: { index: number; value: boolean }) {
  return (
    <Picker
      testID={`bench-expo-segmented-${String(index)}`}
      selection={SEGMENTED_SELECTION}
      onSelectionChange={onSegmentChange}
      modifiers={SEGMENTED_MODIFIERS}
    >
      {segmentedOptions(value).map((label, segment) => (
        <Text key={label} modifiers={tagModifiers(segment)}>
          {label}
        </Text>
      ))}
    </Picker>
  );
}

/**
 * A compact SwiftUI `DatePicker` showing the same instant every other arm shows.
 *
 * The default style (a field plus the calendar popover), which is the same
 * presentation nitro-ui's `compact` variant has, so both arms can be laid out by
 * their own content. `displayedComponents` stays at its `['date']` default: a
 * `datetime` arm would compare a two-column control against a one-column one.
 */
function BenchDatePicker({ index, value }: { index: number; value: boolean }) {
  return (
    <DatePicker
      testID={`bench-expo-date-${String(index)}`}
      selection={dateValue(value)}
      onDateChange={onDateChange}
    />
  );
}

/**
 * A menu `Picker` whose options are the same three labels every other arm draws,
 * with the same one selected - so the flip paints the same new title and the box
 * has to follow it, as it does for every other arm.
 */
function BenchMenuPicker({ index, value }: { index: number; value: boolean }) {
  return (
    <Picker
      testID={`bench-expo-picker-${String(index)}`}
      selection={pickerSelection(value)}
      onSelectionChange={onPickerChange}
      modifiers={MENU_MODIFIERS}
    >
      {pickerOptions().map((label, option) => (
        <Text key={label} modifiers={tagModifiers(option)}>
          {label}
        </Text>
      ))}
    </Picker>
  );
}

/**
 * A SwiftUI `Menu` whose trigger label and rows are the ones every other arm
 * mounts. The popup is never opened during a cell, so what this costs is the
 * mounted trigger plus the row content SwiftUI builds for the menu.
 */
function BenchMenu({ index, value }: { index: number; value: boolean }) {
  return (
    <Menu
      testID={`bench-expo-menu-${String(index)}`}
      label={menuTitle(value)}
      modifiers={MENU_TRIGGER_MODIFIERS}
    >
      {menuItems().map((label) => (
        <Button key={label} label={label} onPress={onMenuSelect} />
      ))}
    </Menu>
  );
}

/**
 * One row of the batch's Form, in SwiftUI's own row vocabulary: `LabeledContent`
 * is a title with a trailing value, a labelled `Toggle` is a title with a
 * control, and a `Button` is the row that answers to a press.
 *
 * The `Toggle` keeps its label, unlike `BenchToggle`: in a row the label is the
 * row's title, which every arm draws.
 */
function BenchFormRow({ index, value }: { index: number; value: boolean }) {
  const kind = formRowKind(index);
  const label = formRowLabel(index);
  if (kind === 'detail') {
    return (
      <LabeledContent label={label}>
        <Text>{formRowValue(value)}</Text>
      </LabeledContent>
    );
  }
  if (kind === 'switch') {
    return (
      <Toggle
        testID={`bench-expo-form-toggle-${String(index)}`}
        isOn={formSwitchValue(index, value)}
        onIsOnChange={onValueChange}
        label={label}
      />
    );
  }
  if (kind === 'press') {
    return <Button label={label} onPress={onRowPress} />;
  }
  return <Text>{label}</Text>;
}

/**
 * `@expo/ui` worst case: one SwiftUI hosting view per control. Expo UI always
 * needs a `Host`, so a fair comparison measures both this and the shared host.
 */
export function ExpoUiHostPerControlList({
  n,
  value,
  component,
}: BenchListProps) {
  const style = rowStyle(component);
  if (component === 'form') {
    // One hosting view, and one Form, per row. Each host needs a box
    // (`FORM_ROW_HOST_STYLE`) because a host has no intrinsic size.
    return (
      <>
        {range(n).map((index) => (
          <Host key={index} style={FORM_ROW_HOST_STYLE}>
            <Form>
              <BenchFormRow index={index} value={value} />
            </Form>
          </Host>
        ))}
      </>
    );
  }
  // `matchContents` lets a host take its content's fitting size, which is how a
  // consumer ships a sized-to-content control.
  return (
    <>
      {range(n).map((index) =>
        component === 'button' ? (
          <Host key={index} matchContents style={style}>
            <BenchButton index={index} value={value} />
          </Host>
        ) : component === 'segmented-control' ? (
          <Host key={index} matchContents style={style}>
            <BenchSegmented index={index} value={value} />
          </Host>
        ) : component === 'date-picker' ? (
          <Host key={index} matchContents style={style}>
            <BenchDatePicker index={index} value={value} />
          </Host>
        ) : component === 'picker' ? (
          <Host key={index} matchContents style={style}>
            <BenchMenuPicker index={index} value={value} />
          </Host>
        ) : component === 'menu' ? (
          <Host key={index} matchContents style={style}>
            <BenchMenu index={index} value={value} />
          </Host>
        ) : component === 'slider' ? (
          <Host key={index} style={style}>
            <BenchSlider index={index} value={value} />
          </Host>
        ) : component === 'stepper' ? (
          <Host key={index} style={style}>
            <BenchStepper index={index} value={value} />
          </Host>
        ) : component === 'icon-button' ? (
          <Host key={index} style={style}>
            <BenchIconButton index={index} value={value} />
          </Host>
        ) : component === 'text-field' ? (
          <Host key={index} style={style}>
            <BenchTextField index={index} value={value} />
          </Host>
        ) : component === 'progress' ? (
          <Host key={index} style={style}>
            <BenchProgress index={index} value={value} />
          </Host>
        ) : component === 'button-group' ? (
          <Host key={index} style={style}>
            <BenchButtonGroup index={index} value={value} />
          </Host>
        ) : component === 'list-item' ? (
          <Host key={index} style={style}>
            <BenchListItem index={index} value={value} />
          </Host>
        ) : (
          <Host key={index} style={style}>
            <BenchToggle index={index} value={value} />
          </Host>
        )
      )}
    </>
  );
}

/**
 * `@expo/ui` best case: N controls inside a single `Host`, which is one SwiftUI
 * view tree and one hosting controller for the whole batch.
 */
export function ExpoUiSharedHostList({ n, value, component }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  if (component === 'form') {
    // The peer for nitro-ui's one grouped Form: one hosting view, one SwiftUI
    // `Form`, one `Section`, `n` rows.
    return (
      <Host style={stackStyle(n, component)}>
        <Form>
          <Section title="Settings">
            {range(n).map((index) => (
              <BenchFormRow key={index} index={index} value={value} />
            ))}
          </Section>
        </Form>
      </Host>
    );
  }
  if (
    component === 'button' ||
    component === 'segmented-control' ||
    component === 'date-picker' ||
    component === 'picker' ||
    component === 'menu'
  ) {
    // `matchContents` for the batch's host too, as in the per-control arm.
    return (
      <Host matchContents style={stackStyle(n, component)}>
        <VStack spacing={0}>
          {range(n).map((index) =>
            component === 'button' ? (
              <BenchButton key={index} index={index} value={value} />
            ) : component === 'date-picker' ? (
              <BenchDatePicker key={index} index={index} value={value} />
            ) : component === 'picker' ? (
              <BenchMenuPicker key={index} index={index} value={value} />
            ) : component === 'menu' ? (
              <BenchMenu key={index} index={index} value={value} />
            ) : (
              <BenchSegmented key={index} index={index} value={value} />
            )
          )}
        </VStack>
      </Host>
    );
  }
  return (
    <Host style={stackStyle(n, component)}>
      <VStack spacing={0}>
        {range(n).map((index) =>
          component === 'slider' ? (
            <BenchSlider key={index} index={index} value={value} />
          ) : component === 'stepper' ? (
            <BenchStepper key={index} index={index} value={value} />
          ) : component === 'icon-button' ? (
            <BenchIconButton key={index} index={index} value={value} />
          ) : component === 'text-field' ? (
            <BenchTextField key={index} index={index} value={value} />
          ) : component === 'progress' ? (
            <BenchProgress key={index} index={index} value={value} />
          ) : component === 'button-group' ? (
            <BenchButtonGroup key={index} index={index} value={value} />
          ) : component === 'list-item' ? (
            <BenchListItem key={index} index={index} value={value} />
          ) : (
            <BenchToggle key={index} index={index} value={value} />
          )
        )}
      </VStack>
    </Host>
  );
}
