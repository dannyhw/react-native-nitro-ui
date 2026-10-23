import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Slider } from './Slider';

/**
 * The render contract of the `Slider` wrapper, measured by Reassure inside
 * `bun run check` (docs/architecture/benchmarks.md, "Render counts").
 *
 * Same two directions as `Switch.perf-test.tsx`, with one addition that is
 * specific to a continuous control:
 * - **flip** changes `value`, so the Slider must re-render - a wrapper that
 *   stopped passing state down would freeze here;
 * - **bump** renders the parent without touching the Slider's inputs, so the
 *   wrapper must not churn. The bumped counter is drawn (rather than kept in
 *   state alone) because Reassure's redundancy check compares whole rendered
 *   trees: a parent commit that changed nothing visible would itself be
 *   flagged as a redundant update, which is true of the harness, not of the
 *   wrapper;
 * - the Slider passes three always-installed callbacks (`onValueChange` through
 *   `useControlled`, plus the `onSlidingStart`/`onSlidingComplete` stand-ins).
 *   The flip harness renders the app's own `onValueChange` inline, so the
 *   wrapper's stability - not the caller's discipline - is what keeps a bump
 *   cheap here.
 *
 * The count is the number of commits the root Profiler sees, and it is the
 * baseline: an extra commit (a mount effect's `setState`, a churned prop) moves
 * it. What a *drag* costs - one coalesced event per frame, no per-sample JS
 * entry - is a device question and lives in the bench plus
 * `example/__tests__/Slider.harness.tsx`.
 */
function Harness() {
  const [value, setValue] = useState(0);
  const [bumps, setBumps] = useState(0);
  return (
    <>
      <Pressable
        testID="flip"
        onPress={() => setValue((current) => 1 - current)}
      >
        <Text>flip</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <Slider value={value} onValueChange={setValue} />
    </>
  );
}

// A self-sizing wrapper asks native for its sizing id (`useSizingId`), so
// rendering one needs a core to exist. It is asked exactly once per mounted
// instance - the hook keeps the answer in a ref, so no render is spent on it -
// which is why this mock cannot move the count the baseline records.
beforeAll(() => {
  let issued = 0;
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => {
      issued += 1;
      return issued;
    },
  });
});

test('Slider: mount, 3 value changes, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      for (let index = 0; index < 3; index += 1) {
        await fireEvent.press(screen.getByTestId('flip'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
    },
  });
});
