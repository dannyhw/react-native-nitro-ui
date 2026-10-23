import { Host, Slider, Toggle, VStack } from '@expo/ui/swift-ui';
import { labelsHidden } from '@expo/ui/swift-ui/modifiers';

import type { BenchListProps } from '../types';
import {
  onSliderChange,
  onValueChange,
  range,
  rowStyle,
  sliderValue,
  stackStyle,
} from './shared';

/**
 * Module-level so the modifier array keeps one identity across renders, instead
 * of handing the host a fresh prop on every flip.
 */
const LABELS_HIDDEN = [labelsHidden()];

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
  return (
    <>
      {range(n).map((index) =>
        component === 'slider' ? (
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
