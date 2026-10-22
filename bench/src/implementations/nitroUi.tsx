import type { ComponentType } from 'react';
import { View, type ColorValue, type ViewProps } from 'react-native';

import * as NitroUi from 'react-native-nitro-ui';

import type { BenchListProps } from '../types';
import { onValueChange, range, rowStyle } from './shared';

/**
 * =====================================================================================
 *  THE ONE-FILE CHANGE - the `nitro-ui` arm (T10 owns the component)
 * =====================================================================================
 *
 * This is the only file in the harness that knows how to talk to
 * `react-native-nitro-ui`. It resolves the library's `Switch` **at runtime**, so
 * the arm lights up by itself the moment the library exports one and the bench
 * app typechecks before that happens (T02 review B2). TypeScript reaches the
 * library through `paths` in bench/tsconfig.json (`react-native-nitro-ui` ->
 * `../src/index.ts`), which is the TS mirror of Metro's `extraNodeModules`.
 *
 * Two things to know:
 *
 * 1. Once T10 lands, replace the lookup below with a named import to get
 *    compile-time prop checking:
 *
 *        import { Switch } from 'react-native-nitro-ui';
 *
 *    - the props passed in `NitroUiList` are then checked against the real
 *    component, and nothing else in the file has to change.
 *
 * 2. To typecheck this arm against a component that is not merged yet, point
 *    `paths` at that branch's source for one run, e.g.
 *
 *        git archive task/T10-core-switch src | tar -x -C /tmp/nitro-ui-t10
 *
 *    then `"paths": { "react-native-nitro-ui": ["/tmp/nitro-ui-t10/src/index.ts"] }`
 *    and `bun run bench:typecheck`.
 * =====================================================================================
 */

/**
 * The props the bench passes, in the shape T10's `Switch` declares them (D7: no
 * optional Hybrid props on the native side, and the JS wrapper keeps every prop
 * optional so the bench can pass only what it needs).
 */
interface BenchSwitchProps extends ViewProps {
  value?: boolean | undefined;
  onValueChange?: ((value: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  tintColor?: ColorValue | undefined;
  testID?: string | undefined;
}

type BenchSwitchComponent = ComponentType<BenchSwitchProps>;

const library = NitroUi as unknown as Record<string, unknown>;
const Switch = library.Switch as BenchSwitchComponent | undefined;

/**
 * `false` means the library does not export a `Switch` yet, so the runner skips
 * the arm and says why instead of benchmarking a stand-in as if it were the
 * library.
 */
export const NITRO_UI_AVAILABLE = Switch !== undefined;

export const NITRO_UI_SKIP_REASON: string | null = NITRO_UI_AVAILABLE
  ? null
  : 'react-native-nitro-ui does not export a Switch yet (lands with T10); ' +
    'bench/src/implementations/nitroUi.tsx resolves it as soon as it exists';

/**
 * The cheapest possible native leaf per instance, used only while the library has
 * no component. The runner never renders this arm when it is unavailable - it
 * emits a `skip` record - so this is a floor for the JSX contract, not a stub
 * that could silently be measured.
 */
function Floor({ n }: { n: number }) {
  if (n === 0) {
    return null;
  }
  return (
    <>
      {range(n).map((index) => (
        <View
          key={index}
          testID={`bench-nitro-ui-floor-${String(index)}`}
          style={rowStyle}
        />
      ))}
    </>
  );
}

/**
 * `n` real nitro-ui switches.
 *
 * Every prop the other arms get is passed here too: the shared `rowStyle` object
 * (same identity, same area), the stable no-op `onValueChange`, and a `testID`.
 * `tintColor` and `disabled` are deliberately *not* passed - the comparison is
 * against each control's platform default, and tinting only this arm would make
 * the arms draw different things.
 */
export function NitroUiList({ n, value }: BenchListProps) {
  if (Switch === undefined) {
    return <Floor n={n} />;
  }
  if (n === 0) {
    return null;
  }
  return (
    <>
      {range(n).map((index) => (
        <Switch
          key={index}
          testID={`bench-nitro-ui-${String(index)}`}
          value={value}
          onValueChange={onValueChange}
          style={rowStyle}
        />
      ))}
    </>
  );
}
