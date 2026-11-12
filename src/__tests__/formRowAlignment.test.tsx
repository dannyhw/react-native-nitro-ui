import { beforeEach, describe, expect, it } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { ReactElement } from 'react';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Button } from '../components/Button/Button';
import { Checkbox } from '../components/Checkbox/Checkbox';
import { Chip } from '../components/Chip/Chip';
import { DatePicker } from '../components/DatePicker/DatePicker';
import { Form } from '../components/Form/Form';
import { IconButton } from '../components/IconButton/IconButton';
import { Menu, type MenuGroup } from '../components/Menu/Menu';
import { Picker } from '../components/Picker/Picker';
import { Progress } from '../components/Progress/Progress';
import { SegmentedControl } from '../components/SegmentedControl/SegmentedControl';
import { Stepper } from '../components/Stepper/Stepper';
import { Switch } from '../components/Switch/Switch';
import {
  InsideRowContext,
  useSelfSizingBaseStyle,
} from '../core/useSelfSizing';

/**
 * The cross-axis rule a self-sizing control carries, and who decides it (task X24 round 3).
 *
 * A control's `{ alignSelf: 'flex-start' }` is what stops a column's default
 * `alignItems: 'stretch'` from deciding its width — and it is also what made a control written
 * straight into a `Form.Row` sit on the row's top edge while its label centred, because a
 * child's `alignSelf` beats its parent's `alignItems`. The fix is one rule read from the row:
 * `center` inside a `Form.Row`, `flex-start` anywhere else, and no wrapper `View` (a wrapper
 * cost a fifth of the JS thread across a 50-row form — X24's report has the numbers).
 *
 * This file guards the two halves a device run cannot tell apart:
 *
 * - the rule follows the row: `Form.Row` provides it, and a `Form.Section` that is not a row
 *   does not;
 * - every self-sizing control actually *reads* it. Eleven controls carry the base style, and a
 *   control that kept a private copy of its own would look right in every screenshot this repo
 *   takes and still be ragged in an app. The table below is why.
 *
 * Geometry stays the device suite's, where a mis-centred control is actually seen:
 * `example/__tests__/Form.harness.tsx`'s `Form row content (X24)` case.
 */

/** What `render` gives back once it has settled (this RTL build renders asynchronously). */
type View = Awaited<ReturnType<typeof render>>;

const FLEX_START = { alignSelf: 'flex-start' };
const CENTER = { alignSelf: 'center' };

beforeEach(() => {
  // Half of these controls mint a sizing id, and the fake core has to answer for all of them.
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

/** The style array the wrapper handed the native view with `testID`. */
function styleOf(view: View, testId: string): readonly unknown[] | undefined {
  return (view.getByTestId(testId).props as { style?: readonly unknown[] })
    .style;
}

/**
 * What React Native makes of a style array: later entries win.
 *
 * Hand-rolled rather than `StyleSheet.flatten`, whose parameter type is RN's animated-style
 * union and so rejects an array read back out of a prop as `unknown[]`.
 */
function merged(style: readonly unknown[]): Record<string, unknown> {
  return Object.assign(
    {},
    ...(style.filter((entry) => entry != null) as Record<string, unknown>[])
  );
}

/**
 * Reads {@link useSelfSizingBaseStyle} out loud, through a view whose props jest can see.
 *
 * Its own component on purpose: the hook answers for the component that *calls* it, so a probe
 * written inline in the component that renders `Form.Row` would read the context from above the
 * row and report `flex-start` whatever the row provides.
 */
function Probe({ testId }: { testId: string }): ReactElement {
  return <Text testID={testId} style={useSelfSizingBaseStyle()} />;
}

/** The style {@link Probe} resolved, as a plain object. */
function probeStyle(view: View, testId: string): unknown {
  const style = (view.getByTestId(testId).props as { style?: unknown }).style;
  return style == null ? style : merged([style]);
}

/**
 * Every control that carries the base style, with what it needs to render.
 *
 * `Progress` asks for the circular shape and `Picker` for the menu variant because those are
 * the self-sizing configurations of two controls that also have a fill-width one: a linear bar
 * and a wheel *want* the box's width and must not be centred either.
 */
const GROUP: MenuGroup = { actions: [{ id: 'now', title: 'Now' }] };

const CONTROLS: [string, (testId: string) => ReactElement][] = [
  ['Button', (testId) => <Button title="Save" testID={testId} />],
  [
    'IconButton',
    (testId) => <IconButton accessibilityLabel="Add" testID={testId} />,
  ],
  ['Switch', (testId) => <Switch value testID={testId} />],
  ['Checkbox', (testId) => <Checkbox checked testID={testId} />],
  ['Stepper', (testId) => <Stepper value={1} testID={testId} />],
  ['Chip', (testId) => <Chip label="New" testID={testId} />],
  [
    'SegmentedControl',
    (testId) => <SegmentedControl options={['One', 'Two']} testID={testId} />,
  ],
  ['Picker', (testId) => <Picker options={['One', 'Two']} testID={testId} />],
  ['Menu', (testId) => <Menu title="Publish" group={GROUP} testID={testId} />],
  ['DatePicker', (testId) => <DatePicker testID={testId} />],
  ['Progress', (testId) => <Progress variant="circular" testID={testId} />],
];

describe('useSelfSizingBaseStyle', () => {
  it('is flex-start outside a row and center inside one', async () => {
    const outside = await render(<Probe testId="probe" />);
    expect(probeStyle(outside, 'probe')).toEqual(FLEX_START);
    await act(async () => {
      outside.unmount();
    });

    const inside = await render(
      <InsideRowContext.Provider value={true}>
        <Probe testId="probe" />
      </InsideRowContext.Provider>
    );
    expect(probeStyle(inside, 'probe')).toEqual(CENTER);
  });

  it('is one object, so a control style array keeps its identity across renders', async () => {
    const seen: unknown[] = [];
    function Collect(): ReactElement {
      seen.push(useSelfSizingBaseStyle());
      return <Text>once</Text>;
    }
    const view = await render(<Collect />);
    await act(async () => {
      view.rerender(<Collect />);
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[1]).toBe(seen[0]);
  });
});

describe('Form.Row', () => {
  /** The probe written as a row's child, or as a bare `Form.Section` child. */
  function RowForm({ explicitRow }: { explicitRow: boolean }): ReactElement {
    return (
      <Form>
        <Form.Section title="Connectivity">
          {explicitRow ? (
            <Form.Row>
              <Probe testId="inRow" />
            </Form.Row>
          ) : (
            <Probe testId="inSection" />
          )}
        </Form.Section>
      </Form>
    );
  }

  it('centres its children — and a Section wraps a bare child in such a row', async () => {
    // A `Form.Section` wraps every child in a row, so an app that never writes `Form.Row`
    // gets the same rule; the ragged pair was never limited to the explicit spelling.
    const explicit = await render(<RowForm explicitRow />);
    expect(probeStyle(explicit, 'inRow')).toEqual(CENTER);
    await act(async () => {
      explicit.unmount();
    });

    const implicit = await render(<RowForm explicitRow={false} />);
    expect(probeStyle(implicit, 'inSection')).toEqual(CENTER);
    await act(async () => {
      implicit.unmount();
    });

    // …and the rule is the row's, not the Form's: the same probe with no row above it at all
    // still carries the guard a column's `alignItems: stretch` needs.
    const outside = await render(<Probe testId="outside" />);
    expect(probeStyle(outside, 'outside')).toEqual(FLEX_START);
  });

  it('is a base style, so the app style written on the control still wins', async () => {
    const view = await render(
      <InsideRowContext.Provider value={true}>
        <Switch value testID="s" style={{ alignSelf: 'flex-end' }} />
      </InsideRowContext.Provider>
    );
    const style = styleOf(view, 's') as [unknown, unknown];
    expect(style[0]).toEqual(CENTER);
    expect(style[1]).toEqual({ alignSelf: 'flex-end' });
    // And that is what React Native makes of the array: the caller's rule, not ours — which
    // is also how a non-nitro-ui control in the same row keeps the `alignSelf` it carries.
    expect(merged(style)).toMatchObject({ alignSelf: 'flex-end' });
  });
});

describe.each(CONTROLS)('%s', (_name, make) => {
  it('reads the rule from its row: flex-start on its own, center in a Form.Row', async () => {
    const alone = await render(make('alone'));
    // First in the array, so the app's own style stays the override.
    expect(styleOf(alone, 'alone')?.[0]).toEqual(FLEX_START);
    await act(async () => {
      alone.unmount();
    });

    const inRow = await render(
      <Form>
        <Form.Section title="Connectivity">
          <Form.Row>{make('inRow')}</Form.Row>
        </Form.Section>
      </Form>
    );
    expect(styleOf(inRow, 'inRow')?.[0]).toEqual(CENTER);
  });
});
