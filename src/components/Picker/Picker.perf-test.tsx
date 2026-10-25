import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Picker } from './Picker';

/**
 * The render contract of the `Picker` wrapper, measured by Reassure inside
 * `bun run check` (docs/architecture/benchmarks.md, "Render counts").
 *
 * A controlled `selectedIndex`, so the contract is SegmentedControl's and
 * Switch's rather than Button's:
 * - **advance** moves the selection through three of four options. The index and
 *   the `options` array are the wrapper's only rendered inputs, so a wrapper that
 *   stopped passing the index down would freeze the control, and one that derived
 *   a fresh object per render would show up as a redundant commit;
 * - **bump** renders the parent without touching the control's inputs, so the
 *   wrapper must not churn. The counter is drawn, because Reassure's redundancy
 *   check compares whole rendered trees.
 *
 * Opening the menu is deliberately not driven here: it is a native gesture into a
 * control the platform presents, and Reassure cannot see it
 * (`docs/architecture/core.md` §4). What it *can* see is that a re-render with an
 * unchanged selection and an unchanged `options` array costs nothing - which is the
 * claim a `Picker` in a list row most often needs.
 */
const OPTIONS = ['One', 'Two', 'Three', 'Four'] as const;

function Harness() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [bumps, setBumps] = useState(0);
  return (
    <>
      <Pressable
        testID="advance"
        onPress={() => setSelectedIndex((current) => (current + 1) % 4)}
      >
        <Text>advance</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <Picker
        options={[...OPTIONS]}
        selectedIndex={selectedIndex}
        onChange={() => {}}
      />
    </>
  );
}

// A self-sizing wrapper asks native for its sizing id (`useSizingId`), so
// rendering one needs a core to exist. It is asked exactly once per mounted
// instance - the hook keeps the answer in a ref - so this cannot move the count.
beforeAll(() => {
  let issued = 0;
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => {
      issued += 1;
      return issued;
    },
  });
});

test('Picker: mount, 3 selection changes, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      for (let index = 0; index < 3; index += 1) {
        await fireEvent.press(screen.getByTestId('advance'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
    },
  });
});
