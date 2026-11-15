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

type View = Awaited<ReturnType<typeof render>>;

const FLEX_START = { alignSelf: 'flex-start' };
const CENTER = { alignSelf: 'center' };

beforeEach(() => {
  // Several of these controls ask the native core for a sizing id.
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

/** The style array the wrapper handed the native view with `testID`. */
function styleOf(view: View, testId: string): readonly unknown[] | undefined {
  return (view.getByTestId(testId).props as { style?: readonly unknown[] })
    .style;
}

/**
 * Merges a style array as React Native does: later entries win.
 * `StyleSheet.flatten` does not accept an array typed `unknown[]`.
 */
function merged(style: readonly unknown[]): Record<string, unknown> {
  return Object.assign(
    {},
    ...(style.filter((entry) => entry != null) as Record<string, unknown>[])
  );
}

/**
 * Renders {@link useSelfSizingBaseStyle} from a component of its own: the hook
 * reads the context of the component that calls it, so a probe written inline
 * beside `Form.Row` would read the context from above the row.
 */
function Probe({ testId }: { testId: string }): ReactElement {
  return <Text testID={testId} style={useSelfSizingBaseStyle()} />;
}

/** The style {@link Probe} resolved, as a plain object. */
function probeStyle(view: View, testId: string): unknown {
  const style = (view.getByTestId(testId).props as { style?: unknown }).style;
  return style == null ? style : merged([style]);
}

const GROUP: MenuGroup = { actions: [{ id: 'now', title: 'Now' }] };

// `Progress` is circular and `Picker` is the menu variant because those are their
// self-sizing configurations: a linear bar and a wheel fill the box's width.
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
    // A `Form.Section` wraps every bare child in a row.
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

    // With no row above it, the probe keeps `flex-start`.
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
    // Later entries win, so the caller's style overrides the base style.
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
