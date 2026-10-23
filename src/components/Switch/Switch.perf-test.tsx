import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Switch } from './Switch';

/**
 * The render contract of the `Switch` wrapper, measured by Reassure inside
 * `bun run check` (docs/architecture/benchmarks.md, "Render counts").
 *
 * The harness drives the two directions the contract has:
 * - **flip** changes `value`, so the Switch must re-render - a wrapper that
 *   stopped passing state down would freeze here;
 * - **bump** renders the parent without touching the Switch's inputs, so the
 *   wrapper must not churn. The bumped counter is drawn (rather than kept in
 *   state alone) because Reassure's redundancy check compares whole rendered
 *   trees: a parent commit that changed nothing visible would itself be
 *   flagged as a redundant update, which is true of the harness, not of the
 *   wrapper.
 *
 * The count is the number of commits the root Profiler sees, and it is the
 * baseline: an extra commit (a mount effect's `setState`, a churned prop) moves
 * it. The host-level half of the contract - no host render on a parent bump,
 * stable callback identity - is a component-counter Jest test, owned by the
 * component task (T10).
 */
function Harness() {
  const [value, setValue] = useState(false);
  const [bumps, setBumps] = useState(0);
  return (
    <>
      <Pressable testID="flip" onPress={() => setValue((current) => !current)}>
        <Text>flip</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <Switch value={value} onValueChange={setValue} />
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

test('Switch: mount, 3 flips, 2 unrelated parent renders', async () => {
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
