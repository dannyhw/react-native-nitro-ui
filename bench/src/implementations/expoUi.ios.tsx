import {
  Button,
  Host,
  Picker,
  ProgressView,
  Slider,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  labelsHidden,
  pickerStyle,
  progressViewStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import type { BenchListProps } from '../types';
import {
  onPickerChange,
  SEGMENTED_SELECTION,
  buttonTitle,
  onPress,
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
  stackStyle,
} from './shared';

/**
 * Module-level so each modifier array keeps one identity across renders, instead
 * of handing the host a fresh prop on every flip.
 */
const LABELS_HIDDEN = [labelsHidden()];

/**
 * `.borderedProminent` is what a plain SwiftUI `Button` already is, so this only
 * pins the style against a future default change: the arm must keep measuring the
 * same control.
 */
const BORDERED_PROMINENT = [buttonStyle('borderedProminent')];

/**
 * Module-level for the same reason as `LABELS_HIDDEN`.
 *
 * `.linear` is spelled explicitly rather than left to `automatic`: outside a
 * `Form`/`List` a SwiftUI `ProgressView` with a value is linear anyway, and the
 * arm must not depend on the container it happens to sit in to be the control
 * under test - nitro-ui's arm asks its toolkit the same explicit question.
 */
const LINEAR_STYLE = [progressViewStyle('linear')];

/**
 * `.segmented`, which is the same native control nitro-ui hosts, reached through
 * Expo's bridge instead of through Nitro - the point of the comparison.
 * `labelsHidden()` for the reason `BenchToggle` has: a labelled `Picker` lays out
 * and renders a label `Text` that neither the floor nor the control under test
 * has, and inflating this arm's mount, CPU and memory in the one comparison this
 * project publishes is what T02 review B3 is about.
 */
const SEGMENTED_MODIFIERS = [pickerStyle('segmented'), labelsHidden()];

/**
 * The `tag` a segmented option needs, one array per position, built once.
 *
 * A fresh `[tag(n)]` per render would hand the host a `modifiers` prop whose
 * identity changed on every flip (T02 review NIT). The count is fixed at three
 * because every arm's option list has three labels; `tagModifiers` says so out
 * loud rather than passing `undefined` to a control if that ever changes.
 */
const TAG_MODIFIERS = [[tag(0)], [tag(1)], [tag(2)]];

/**
 * `.menu`, the pull-up list - the platform control nitro-ui's `variant: 'menu'`
 * hosts, reached through Expo's bridge. `labelsHidden()` for the reason
 * `BenchSegmented` has: a labelled SwiftUI `Picker` lays out a label `Text` that
 * neither the floor nor the control under test draws, and inflating this arm is
 * what T02 review B3 is about.
 */
const MENU_MODIFIERS = [pickerStyle('menu'), labelsHidden()];

/**
 * @param {number} segment
 */
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
 * No `label`, plus `labelsHidden()`.
 *
 * A labelled SwiftUI `Toggle` lays out and renders a `Text` per control, which
 * neither RN's `Switch` nor nitro-ui's does (T10's SwiftUI toggle applies
 * `.labelsHidden()`). Labelling the Expo arm would inflate its mount, UI CPU and
 * memory numbers in exactly the comparison this project publishes
 * (T02 review B3). `testID` keeps per-control identity without drawing anything.
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
 * A SwiftUI `Slider` with no label of any kind.
 *
 * The same reason `BenchToggle` hides its labels: `minimumValueLabel` /
 * `maximumValueLabel` draw real `Text` views that RN's floor and nitro-ui's
 * control do not have, and labelling this arm would inflate its mount, UI CPU
 * and memory numbers in exactly the comparison this project publishes
 * (T02 review B3).
 */
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
 * A SwiftUI `ProgressView` with no label.
 *
 * `children` is a label that renders as `Text` next to the bar - the same reason
 * `BenchToggle` hides its label and `BenchSlider` has none: labelling this arm
 * would inflate its mount, UI CPU and memory numbers in the comparison this
 * project publishes (T02 review B3).
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
 * `@expo/ui` worst case for the library: one SwiftUI hosting view per control.
 * Expo UI always needs a `Host`, so both Expo arms are required for a fair
 * comparison (docs/research/setup-decisions.md SS6).
 */
export function ExpoUiHostPerControlList({
  n,
  value,
  component,
}: BenchListProps) {
  const style = rowStyle(component);
  // `matchContents` is what lets a host take the button's fitting size, which is
  // how a consumer ships a sized-to-content control here; it is also part of what
  // this arm costs per control and is measured as such.
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
        ) : component === 'picker' ? (
          <Host key={index} matchContents style={style}>
            <BenchMenuPicker index={index} value={value} />
          </Host>
        ) : component === 'slider' ? (
          <Host key={index} style={style}>
            <BenchSlider index={index} value={value} />
          </Host>
        ) : component === 'progress' ? (
          <Host key={index} style={style}>
            <BenchProgress index={index} value={value} />
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
  if (
    component === 'button' ||
    component === 'segmented-control' ||
    component === 'picker'
  ) {
    // `matchContents` for the batch's host too, for the same reason as the
    // per-control arm; the switch/slider hosts stay exactly as published.
    return (
      <Host matchContents style={stackStyle(n, component)}>
        <VStack spacing={0}>
          {range(n).map((index) =>
            component === 'button' ? (
              <BenchButton key={index} index={index} value={value} />
            ) : component === 'picker' ? (
              <BenchMenuPicker key={index} index={index} value={value} />
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
          ) : component === 'progress' ? (
            <BenchProgress key={index} index={index} value={value} />
          ) : (
            <BenchToggle key={index} index={index} value={value} />
          )
        )}
      </VStack>
    </Host>
  );
}
