import { Pressable, StyleSheet, Text } from 'react-native';

import type { BenchListProps } from '../types';
import { buttonRowStyle, buttonTitle, onPress, range } from './shared';

/**
 * The Button control arm: RN core has no button widget, so the idiomatic core
 * equivalent is a `Pressable` wrapping a `Text` (docs/tasks/G2-button.md).
 *
 * The label is a real child `Text`, because that is what the other arms pay
 * too: SwiftUI draws the label of `Button(label:)` and Material 3 composes a
 * `Text` inside the button slot. Padding and background are the minimum that
 * makes it a button rather than tappable text - RN core owns no theme, so
 * anything richer would be this arm's decoration, not the control's.
 */
const styles = StyleSheet.create({
  background: {
    backgroundColor: '#6750A4',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  label: { color: '#FFFFFF' },
});

export function RnCoreButtonList({ n, value }: BenchListProps) {
  return (
    <>
      {range(n).map((index) => (
        <Pressable
          key={index}
          testID={`bench-rn-core-button-${String(index)}`}
          onPress={onPress}
          style={buttonRowStyle}
        >
          <Text style={[styles.background, styles.label]}>
            {buttonTitle(value)}
          </Text>
        </Pressable>
      ))}
    </>
  );
}
