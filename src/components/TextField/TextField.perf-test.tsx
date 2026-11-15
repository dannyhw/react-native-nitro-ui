import { beforeAll, test } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { TextField } from './TextField';

// The bump counter is drawn because Reassure's redundancy check compares
// rendered trees: a parent commit that changed nothing visible is flagged.
function Harness() {
  const [text, setText] = useState('');
  const [bumps, setBumps] = useState(0);
  return (
    <>
      <Pressable testID="bump" onPress={() => setBumps((count) => count + 1)}>
        <Text>{`bumped ${bumps}`}</Text>
      </Pressable>
      <TextField testID="field" value={text} onChangeText={setText} />
    </>
  );
}

beforeAll(() => {
  let issued = 0;
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => {
      issued += 1;
      return issued;
    },
  });
});

/** One keystroke as native reports it: the new text and native's event count. */
async function keystroke(text: string, eventCount: number) {
  const props = screen.getByTestId('field').props as unknown as {
    onValueChange: { f: (value: string, count: number) => void };
  };
  await act(async () => {
    props.onValueChange.f(text, eventCount);
  });
}

test('TextField: mount, 3 keystrokes, 2 unrelated parent renders', async () => {
  await measureRenders(<Harness />, {
    scenario: async () => {
      await keystroke('a', 1);
      await keystroke('ab', 2);
      await keystroke('abc', 3);
      for (let index = 0; index < 2; index += 1) {
        await fireEvent.press(screen.getByTestId('bump'));
      }
    },
  });
});
