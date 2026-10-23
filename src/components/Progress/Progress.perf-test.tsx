import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Progress } from './Progress';

/**
 * The render contract of the `Progress` wrapper, measured by Reassure inside
 * `bun run check` (docs/architecture/benchmarks.md, "Render counts").
 *
 * The two directions Switch and Slider measure, with the one thing this
 * component adds:
 * - **flip** changes `value`, which is what a 60 Hz download callback does, so
 *   the wrapper must re-render - and must re-render *nothing else*, which is why
 *   there is no `useControlled` layer and no callback prop here at all;
 * - **bump** renders the parent without touching the Progress's inputs, so the
 *   wrapper must not churn. The bumped counter is drawn (rather than kept in
 *   state alone) because Reassure's redundancy check compares whole rendered
 *   trees: a parent commit that changed nothing visible would itself be flagged
 *   as a redundant update, which is true of the harness, not of the wrapper;
 * - **shape** switches `variant`, the only prop that is also the sizing key. It
 *   has to reach native (a different shape is a different box), so a wrapper that
 *   memoised the key on the first render would freeze here.
 *
 * The count is the number of commits the root Profiler sees, and it is the
 * baseline: an extra commit (a mount effect's `setState`, a churned prop) moves
 * it. What a commit *costs* on a device - no hosting recreation, no re-measure -
 * is the bench's `update.progress` scenario plus
 * `example/__tests__/Progress.harness.tsx`.
 */
function Harness() {
  const [value, setValue] = useState(0);
  const [bumps, setBumps] = useState(0);
  const [circular, setCircular] = useState(false);
  return (
    <>
      <Pressable
        testID="flip"
        onPress={() => setValue((current) => (current + 0.25) % 1)}
      >
        <Text>flip</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <Pressable testID="shape" onPress={() => setCircular((now) => !now)}>
        <Text>{circular ? 'circular' : 'linear'}</Text>
      </Pressable>
      <Progress
        variant={circular ? 'circular' : 'linear'}
        value={value}
        accessibilityLabel="Upload"
      />
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

test('Progress: mount, 3 value changes, 2 unrelated parent renders, 1 variant change', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      for (let index = 0; index < 3; index += 1) {
        await fireEvent.press(screen.getByTestId('flip'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
      await fireEvent.press(screen.getByTestId('shape'));
    },
  });
});
