import { Column, Host, Switch } from '@expo/ui/jetpack-compose';

import type { BenchListProps } from '../types';
import { onValueChange, range, rowStyle, stackStyle } from './shared';

/**
 * `@expo/ui` worst case for the library: one Compose hosting view per control
 * (one `AndroidComposeView` each). Expo UI always needs a `Host`, so both Expo
 * arms are required for a fair comparison
 * (docs/research/setup-decisions.md SS6).
 */
export function ExpoUiHostPerControlList({ n, value }: BenchListProps) {
  return (
    <>
      {range(n).map((index) => (
        <Host key={index} style={rowStyle}>
          <Switch value={value} onCheckedChange={onValueChange} />
        </Host>
      ))}
    </>
  );
}

/**
 * `@expo/ui` best case: N composables inside a single `Host`, i.e. one Compose
 * tree and one recomposition scope for the whole batch.
 */
export function ExpoUiSharedHostList({ n, value }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  return (
    <Host style={stackStyle(n)}>
      <Column>
        {range(n).map((index) => (
          <Switch key={index} value={value} onCheckedChange={onValueChange} />
        ))}
      </Column>
    </Host>
  );
}
