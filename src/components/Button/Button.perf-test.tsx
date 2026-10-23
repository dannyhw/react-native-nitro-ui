import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { Button } from './Button';

/**
 * The render contract of the `Button` wrapper, measured by Reassure inside
 * `bun run check` (docs/architecture/benchmarks.md, "Render counts").
 *
 * A Button has no value to flip, so the two directions the contract has are
 * driven differently than the Switch's:
 * - **retitle** changes `title`, which is both what renders and one of the
 *   size-affecting props - a wrapper that stopped passing it down would freeze,
 *   and one that sent an extra prop per render would show up as a redundant
 *   commit;
 * - **bump** renders the parent without touching the Button's inputs, so the
 *   wrapper must not churn. The counter is drawn, because Reassure's redundancy
 *   check compares whole rendered trees - an invisible parent commit would be
 *   flagged and is impossible to tell apart from a wrapper problem.
 *
 * A press is deliberately not driven here: a Button owns nothing in JS, so
 * `onPress` costs the wrapper zero renders, and Reassure cannot see a native
 * gesture anyway (`docs/architecture/core.md` §12).
 */
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
