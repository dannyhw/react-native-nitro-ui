import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { BenchListProps } from '../types';
import { buttonTitle, onValueChange, onPress, range, rowStyle } from './shared';

/**
 * The control arm: what RN core itself offers for each component.
 *
 * Every metric is reported relative to this, which is also how the runner
 * detects a noisy machine (if `rn-core` moves between runs, the run is
 * inconclusive).
 *
 * - `switch`: plain `react-native` `Switch`, i.e. the platform widget wrapped by
 *   RN core.
 * - `slider`: RN core has no slider - it left the framework in 0.80 - so the
 *   floor is a bare `View` in the same box. That is a *floor*, not a peer: it
 *   hosts no control, runs no gesture code and owns no value, so a slider arm's
 *   ratio against it says "what does any native slider cost over drawing
 *   nothing", and the `@expo/ui` arms are what answer "what does it cost over
 *   another native slider".
 * - `button`: RN core has no button widget either, so the idiomatic core
 *   equivalent is a `Pressable` wrapping a `Text`. The label is a real child
 *   `Text` because that is what the other arms pay too: SwiftUI draws the label
 *   of `Button(label:)` and Material 3 composes a `Text` inside the button slot.
 *   Padding and background are the minimum that makes it a button rather than
 *   tappable text - RN core owns no theme, so anything richer would be this
 *   arm's decoration, not the control's.
 */
export function RnCoreList({ n, value, component }: BenchListProps) {
  const style = rowStyle(component);
  if (component === 'button') {
    return (
      <>
        {range(n).map((index) => (
          <Pressable
            key={index}
            testID={`bench-rn-core-button-${String(index)}`}
            onPress={onPress}
            style={style}
          >
            <Text style={[buttonStyles.background, buttonStyles.label]}>
              {buttonTitle(value)}
            </Text>
          </Pressable>
        ))}
      </>
    );
  }
  if (component === 'slider') {
    return (
      <>
        {range(n).map((index) => (
          <View
            key={index}
            testID={`bench-rn-core-slider-${String(index)}`}
            style={style}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {range(n).map((index) => (
        <Switch
          key={index}
          testID={`bench-rn-core-${index}`}
          value={value}
          onValueChange={onValueChange}
          style={style}
        />
      ))}
    </>
  );
}

const buttonStyles = StyleSheet.create({
  background: {
    backgroundColor: '#6750A4',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  label: { color: '#FFFFFF' },
});
