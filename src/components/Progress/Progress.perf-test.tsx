import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Progress } from './Progress';

// The bump counter is drawn because Reassure's redundancy check compares
// rendered trees: a parent commit that changed nothing visible is flagged.
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
