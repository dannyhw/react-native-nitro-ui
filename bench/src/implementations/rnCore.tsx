import { Switch } from 'react-native';

import type { BenchListProps } from '../types';
import { onValueChange, range, rowStyle } from './shared';

/**
 * The control arm: plain `react-native` `Switch`, i.e. the platform widget
 * wrapped by RN core. Every metric is reported relative to this, which is also
 * how the runner detects a noisy machine (if `rn-core` moves between runs, the
 * run is inconclusive).
 */
export function RnCoreList({ n, value }: BenchListProps) {
  return (
    <>
      {range(n).map((index) => (
        <Switch
          key={index}
          testID={`bench-rn-core-${index}`}
          value={value}
          onValueChange={onValueChange}
          style={rowStyle}
        />
      ))}
    </>
  );
}
