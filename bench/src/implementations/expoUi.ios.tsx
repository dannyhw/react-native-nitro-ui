import { Host, Toggle, VStack } from '@expo/ui/swift-ui';

import type { BenchListProps } from '../types';
import { onValueChange, range, rowStyle, stackStyle } from './shared';

/**
 * `@expo/ui` worst case for the library: one SwiftUI hosting view per control.
 * Expo UI always needs a `Host`, so both Expo arms are required for a fair
 * comparison (docs/research/setup-decisions.md SS6).
 */
export function ExpoUiHostPerControlList({ n, value }: BenchListProps) {
  return (
    <>
      {range(n).map((index) => (
        <Host key={index} style={rowStyle}>
          <Toggle
            label={`bench-expo-per-host-${index}`}
            isOn={value}
            onIsOnChange={onValueChange}
          />
        </Host>
      ))}
    </>
  );
}

/**
 * `@expo/ui` best case: N controls inside a single `Host`, which is one SwiftUI
 * view tree and one hosting controller for the whole batch.
 */
export function ExpoUiSharedHostList({ n, value }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  return (
    <Host style={stackStyle(n)}>
      <VStack spacing={0}>
        {range(n).map((index) => (
          <Toggle
            key={index}
            label={`bench-expo-shared-${index}`}
            isOn={value}
            onIsOnChange={onValueChange}
          />
        ))}
      </VStack>
    </Host>
  );
}
