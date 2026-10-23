import {
  Button,
  Column,
  Host,
  Slider,
  Switch,
  Text,
} from '@expo/ui/jetpack-compose';

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
 * `@expo/ui` worst case for the library: one Compose hosting view per control
 * (one `AndroidComposeView` each). Expo UI always needs a `Host`, so both Expo
 * arms are required for a fair comparison
 * (docs/research/setup-decisions.md SS6).
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
        component === 'button' ? (
          // `matchContents` lets the host take the button's fitting size, which
          // is how a consumer ships a sized-to-content control here. It is part
          // of what this arm costs per control and is measured as such - and it
          // stays out of the switch/slider arms, which are published numbers.
          <Host key={index} matchContents style={style}>
            <BenchButton value={value} />
          </Host>
        ) : (
          <Host key={index} style={style}>
            {component === 'slider' ? (
              <BenchSlider value={value} />
            ) : (
              <Switch value={value} onCheckedChange={onValueChange} />
            )}
          </Host>
        )
      )}
    </>
  );
}

/**
 * Material 3's filled `Button`, whose slot content is a `Text` - the same label
 * cost SwiftUI's `Button(label:)` and RN core's `Pressable` + `Text` pay.
 *
 * The default palette is left alone: `seedColor` would change what the arm draws,
 * and the comparison is each control's platform default. There is no `testID` to
 * pass either - the Compose `Button` props carry none, as in the Switch arm.
 */
function BenchButton({ value }: { value: boolean }) {
  return (
    <Button onClick={onPress}>
      <Text>{buttonTitle(value)}</Text>
    </Button>
  );
}

/**
 * A bare Material 3 `Slider`, no tick marks and no label slots.
 *
 * `steps={0}` is continuous, matching the continuous default of the control
 * under test: a stepped slider draws tick marks neither of the other arms has
 * (T02 review B3).
 */
function BenchSlider({ value }: { value: boolean }) {
  return (
    <Slider
      value={sliderValue(value)}
      min={0}
      max={1}
      steps={0}
      onValueChange={onSliderChange}
    />
  );
}

/**
 * `@expo/ui` best case: N composables inside a single `Host`, i.e. one Compose
 * tree and one recomposition scope for the whole batch.
 */
export function ExpoUiSharedHostList({ n, value, component }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  return (
    <Host style={stackStyle(n, component)}>
      <Column>
        {range(n).map((index) =>
          component === 'button' ? (
            <BenchButton key={index} value={value} />
          ) : component === 'slider' ? (
            <BenchSlider key={index} value={value} />
          ) : (
            <Switch key={index} value={value} onCheckedChange={onValueChange} />
          )
        )}
      </Column>
    </Host>
  );
}
