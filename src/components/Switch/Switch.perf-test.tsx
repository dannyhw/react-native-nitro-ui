import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Switch } from './Switch';

// The bump counter is drawn because Reassure's redundancy check compares rendered
// trees: a parent commit that changed nothing visible would itself be flagged.
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

// A self-sizing wrapper asks the native core for its sizing id, so one must exist.
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
