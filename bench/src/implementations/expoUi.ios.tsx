import { Button, Host, Slider, Toggle, VStack } from '@expo/ui/swift-ui';
import { buttonStyle, labelsHidden } from '@expo/ui/swift-ui/modifiers';

import type { BenchListProps } from '../types';
import {
  buttonTitle,
  onPress,
  onSliderChange,
  onValueChange,
  range,
  rowStyle,
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
        ) : component === 'slider' ? (
          <Host key={index} style={style}>
            <BenchSlider index={index} value={value} />
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
  if (component === 'button') {
    // `matchContents` for the batch's host too, for the same reason as the
    // per-control arm; the switch/slider hosts stay exactly as published.
    return (
      <Host matchContents style={stackStyle(n, component)}>
        <VStack spacing={0}>
          {range(n).map((index) => (
            <BenchButton key={index} index={index} value={value} />
          ))}
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
          ) : (
            <BenchToggle key={index} index={index} value={value} />
          )
        )}
      </VStack>
    </Host>
  );
}
