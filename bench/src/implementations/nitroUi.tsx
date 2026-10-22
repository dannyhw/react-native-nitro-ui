import { View } from 'react-native';

import type { BenchListProps } from '../types';
import { range, rowStyle } from './shared';
// `onValueChange` from './shared' is used once the real control is wired up.

/**
 * =====================================================================================
 *  THE ONE-FILE CHANGE - wiring up `nitro-ui`'s real component (T10 owns the component)
 * =====================================================================================
 *
 * This file is the only place that knows how to talk to `react-native-nitro-ui`.
 * The runner already lists `nitro-ui` in `./index.ts`, so when the first real
 * component lands you make exactly one edit here and nothing else:
 *
 *   1. Replace the import block below the marker with:
 *
 *        import { Switch } from 'react-native-nitro-ui';
 *
 *   2. Replace the body of `NitroUiList` with the real control, and pass every
 *      prop (never `undefined` - nitro#1184):
 *
 *        export function NitroUiList({ n, value }: BenchListProps) {
 *          return (
 *            <>
 *              {range(n).map((index) => (
 *                <Switch
 *                  key={index}
 *                  testID={`bench-nitro-ui-${index}`}
 *                  value={value}
 *                  onValueChange={onValueChange}
 *                  style={{ height: ROW_HEIGHT }}
 *                />
 *              ))}
 *            </>
 *          );
 *        }
 *
 *   3. Flip the two constants:
 *
 *        export const NITRO_UI_AVAILABLE = true;
 *        export const NITRO_UI_SKIP_REASON: string | null = null;
 *
 * Then run the quick plan on both platforms and paste the table into your
 * component's report (docs/architecture/benchmarks.md has the checklist).
 *
 * Until then this renders a plain `View` floor and `available: false`, so the
 * runner reports "skipped" rather than silently benchmarking a stub as if it
 * were the library.
 * =====================================================================================
 */
export const NITRO_UI_AVAILABLE = false;

export const NITRO_UI_SKIP_REASON: string | null =
  'react-native-nitro-ui does not export a Switch yet (lands with T10); ' +
  'bench/src/implementations/nitroUi.tsx is the one-file change';

/** Placeholder "floor": the cheapest possible native leaf per instance. */
export function NitroUiList({ n }: BenchListProps) {
  if (n === 0) {
    return null;
  }
  return (
    <>
      {range(n).map((index) => (
        <View
          key={index}
          testID={`bench-nitro-ui-floor-${index}`}
          style={rowStyle}
        />
      ))}
    </>
  );
}
