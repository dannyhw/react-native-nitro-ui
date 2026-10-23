import { Button, Host, VStack } from '@expo/ui/swift-ui';
import { buttonStyle } from '@expo/ui/swift-ui/modifiers';

import type { BenchListProps } from '../types';
import {
  buttonRowStyle,
  buttonTitle,
  onPress,
  range,
  sharedHostStyle,
} from './shared';

/**
 * Module-level so the modifier array keeps one identity across renders, instead
 * of handing the host a fresh prop on every flip (as in `expoUi.ios.tsx`).
 *
 * `.borderedProminent` is what a plain SwiftUI `Button` already is, so this only
 * pins the style against a future default change: the arm must keep measuring
 * the same control G2 measured.
 */
const BORDERED_PROMINENT = [buttonStyle('borderedProminent')];

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
 * `@expo/ui` worst case for the library: one SwiftUI hosting view per control.
 * Expo UI always needs a `Host`, so both Expo arms are required for a fair
 * comparison (docs/research/setup-decisions.md SS6).
 *
 * `matchContents` is what lets the host take the button's fitting size, which is
 * how a consumer ships a sized-to-content control here; it is also part of what
 * this arm costs per control and is measured as such.
 */
export function ExpoUiButtonHostPerControlList({ n, value }: BenchListProps) {
  return (
    <>
      {range(n).map((index) => (
        <Host key={index} matchContents style={buttonRowStyle}>
          <BenchButton index={index} value={value} />
        </Host>
      ))}
    </>
  );
}

/**
 * `@expo/ui` best case: N buttons inside a single `Host`, i.e. one SwiftUI view
 * tree and one hosting controller for the whole batch.
 */
export function ExpoUiButtonSharedHostList({ n, value }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  return (
    <Host matchContents style={sharedHostStyle}>
      <VStack spacing={0}>
        {range(n).map((index) => (
          <BenchButton key={index} index={index} value={value} />
        ))}
      </VStack>
    </Host>
  );
}
