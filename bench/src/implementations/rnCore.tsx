import { Switch, View } from 'react-native';

import type { BenchListProps } from '../types';
import { onValueChange, range, rowStyle } from './shared';

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
 */
export function RnCoreList({ n, value, component }: BenchListProps) {
  const style = rowStyle(component);
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
