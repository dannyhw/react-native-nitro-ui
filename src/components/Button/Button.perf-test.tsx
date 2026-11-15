import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Button } from './Button';

// The bump counter is drawn because Reassure's redundancy check compares rendered
// trees: a parent commit that changed nothing visible would itself be flagged.
const TITLES = ['Save', 'Saving…', 'Saved'] as const;

function Harness() {
  const [titleIndex, setTitleIndex] = useState(0);
  const [bumps, setBumps] = useState(0);
  const title = TITLES[titleIndex % TITLES.length]!;
  return (
    <>
      <Pressable
        testID="retitle"
        onPress={() => setTitleIndex((current) => current + 1)}
      >
        <Text>retitle</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <Button title={title} onPress={() => {}} />
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

test('Button: mount, 3 title changes, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      for (let index = 0; index < 3; index += 1) {
        await fireEvent.press(screen.getByTestId('retitle'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
    },
  });
});
