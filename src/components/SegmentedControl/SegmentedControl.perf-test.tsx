import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { SegmentedControl } from './SegmentedControl';

// The bump counter is drawn because Reassure's redundancy check compares
// rendered trees: a parent commit that changed nothing visible is flagged.
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
      <SegmentedControl
        options={[...OPTIONS]}
        selectedIndex={selectedIndex}
        onChange={() => {}}
      />
    </>
  );
}

// `useSizingId` asks the native core for an instance id.
beforeAll(() => {
  let issued = 0;
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => {
      issued += 1;
      return issued;
    },
  });
});

test('SegmentedControl: mount, 3 selection changes, 2 unrelated parent renders', async () => {
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
