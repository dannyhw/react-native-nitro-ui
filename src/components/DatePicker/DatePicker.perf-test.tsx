import { beforeAll, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { nitroUiHybridObjects } from '../../../__mocks__/react-native-nitro-modules';
import { DatePicker } from './DatePicker';

/**
 * The render contract of the `DatePicker` wrapper, measured by Reassure inside
 * `bun run check` (docs/architecture/benchmarks.md, "Render counts").
 *
 * A controlled DatePicker is the Switch's shape, with one extra input the Switch
 * does not have: bounds. So the harness drives three things:
 * - **advance** moves `value` through three instants. The instant is what the
 *   wrapper computes its clamp from, so a wrapper that stopped passing it down
 *   would freeze the picker, and one that recomputed a prop into a new value per
 *   render would show up as an extra commit;
 * - **widen** moves `maximumDate` past the current value. A bound that is not
 *   clamped against is a bug this cannot catch, but a bound that is *derived*
 *   from the value (or memoised on the wrong key) is: the same instant would then
 *   reach native as a different `maximumMillis`, which is a props change native
 *   has to re-clamp for;
 * - **bump** renders the parent without touching any of the control's inputs, so
 *   the wrapper must not churn. The counter is drawn because Reassure's redundancy
 *   check compares whole rendered trees.
 *
 * The dates are built once from fixed instants (`DATES`), not per render: a
 * `new Date(...)` in the render body would be a new object each commit, which
 * would make this measure the harness rather than the wrapper. `millisOf` already
 * makes object identity irrelevant to what native receives, and the gate measures
 * commits, so keeping the objects stable is what makes an *unstable* wrapper
 * computation visible.
 *
 * A pick is deliberately not driven here: native owns the optimistic date and
 * reports through `onValueChange`, and Reassure cannot see a native gesture
 * (`docs/architecture/core.md` §4). The harness covers that
 * (`example/__tests__/DatePicker.harness.tsx`).
 */
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

// A self-sizing wrapper asks native for its sizing id (`useSizingId`), so
// rendering one needs a core to exist. It is asked exactly once per mounted
// instance - the hook keeps the answer in state, so no render is spent on it -
// which is why this cannot move the count the baseline records.
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
