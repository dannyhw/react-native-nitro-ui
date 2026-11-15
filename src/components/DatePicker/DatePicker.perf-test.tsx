import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { DatePicker } from './DatePicker';

// The dates are built once, so every render passes the same objects.
// The bump counter is drawn because Reassure's redundancy check compares
// rendered trees: a parent commit that changed nothing visible is flagged.
const DATES = [
  new Date(Date.UTC(2026, 2, 14, 10, 0)),
  new Date(Date.UTC(2026, 4, 2, 8, 30)),
  new Date(Date.UTC(2026, 8, 27, 19, 15)),
];

function Harness() {
  const [index, setIndex] = useState(0);
  const [wide, setWide] = useState(false);
  const [bumps, setBumps] = useState(0);
  return (
    <>
      <Pressable
        testID="advance"
        onPress={() => setIndex((current) => (current + 1) % DATES.length)}
      >
        <Text>advance</Text>
      </Pressable>
      <Pressable testID="widen" onPress={() => setWide((current) => !current)}>
        <Text>widen</Text>
      </Pressable>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <DatePicker
        value={DATES[index]}
        onChange={() => {}}
        maximumDate={wide ? undefined : DATES[DATES.length - 1]}
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

test('DatePicker: mount, 3 value changes, 2 bound changes, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      for (let index = 0; index < 3; index += 1) {
        await fireEvent.press(screen.getByTestId('advance'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('widen'));
      }
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
    },
  });
});
