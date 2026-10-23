import {
  Column,
  Host,
  LoadingIndicator,
  Slider,
  Switch,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { useEffect } from 'react';

import type { BenchListProps } from '../types';
import {
  onSliderChange,
  onValueChange,
  progressValue,
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
      {range(n).map((index) => (
        <Host key={index} style={style}>
          {component === 'slider' ? (
            <BenchSlider value={value} />
          ) : component === 'progress' ? (
            <BenchProgress value={value} />
          ) : (
            <Switch value={value} onCheckedChange={onValueChange} />
          )}
        </Host>
      ))}
    </>
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
 * The closest thing `@expo/ui` has to a progress bar: its `LoadingIndicator`
 * (Material 3's expressive `LoadingIndicator`), which is *indeterminate by
 * default* and becomes determinate only when handed a `progress` **observable**.
 *
 * That is a different shape of update from every other arm's, and it is the Expo
 * UI way of doing progress, so the arm renders what the library offers rather
 * than something it is not:
 *
 * - one observable per control (`useNativeState` is a hook, so this has to be a
 *   component per indicator - which is also what the host-per-control arm needs);
 * - the runner's flipped bit reaches Compose through a **write to the state**,
 *   not through a native prop diff: React re-renders the child, the effect writes
 *   `state.value`, and Expo schedules that write to the UI thread.
 *
 * So on `update.progress` this arm measures "React render inside the host + one
 * shared-object write" while `nitro-ui` measures "one prop commit over Nitro".
 * Both are what their runtime costs; neither arm is shaped to look cheap.
 *
 * What this arm is *not*: M3's `LinearProgressIndicator`/`CircularProgressIndicator`
 * are not exposed by `@expo/ui`, so this is the equivalent **API surface** for a
 * progress value, not the same drawable as the other two arms. The table says so.
 */
function BenchProgress({ value }: { value: boolean }) {
  const progress = useNativeState<number | null>(progressValue(value));
  useEffect(() => {
    progress.value = progressValue(value);
  }, [progress, value]);
  return <LoadingIndicator progress={progress} />;
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
          component === 'slider' ? (
            <BenchSlider key={index} value={value} />
          ) : component === 'progress' ? (
            <BenchProgress key={index} value={value} />
          ) : (
            <Switch key={index} value={value} onCheckedChange={onValueChange} />
          )
        )}
      </Column>
    </Host>
  );
}
