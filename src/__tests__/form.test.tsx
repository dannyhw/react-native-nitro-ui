import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Form } from '../components/Form/Form';

/**
 * The React half of `Form` (task G24): which row is the same row from one render to the next.
 *
 * `wrapRows` flattens the app's children into one array of rows, which makes this file the
 * thing that decides each row's key — and a key that moves is a remount: the row's
 * `TextField` loses its text, focus and caret, and on iOS the row leaves its cell and comes
 * back as a new Fabric view. The device suite cannot see this at all, because on a device the
 * app's own children are static; it only ever happens when an app's state changes.
 *
 * So the tests are about identity, read as mount counts and as React's own duplicate-key
 * warning — not about the tree, which looks identical either way.
 */

beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

/** Counts how many times the element below has been freshly mounted. */
let mounts = 0;

/** One mount is one `useState` initialiser; a re-render does not run it again. */
function Mounted({ label }: { label: string }) {
  useState((): number => {
    mounts += 1;
    return mounts;
  });
  return <Text testID="mounted">{label}</Text>;
}

/** The same section, with or without a node above the row that has state in it. */
function BannerForm({ banner }: { banner: boolean }) {
  return (
    <Form>
      <Form.Section title="Connectivity">
        {banner ? <Text>One row above</Text> : null}
        <Form.Row>
          <Mounted label="row below the banner" />
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

/** Two lists whose items were keyed by two unrelated components, side by side. */
function TwoArrays() {
  return (
    <Form>
      <Form.Section>
        {[<Text key="a">first a</Text>, <Text key="b">first b</Text>]}
        {[<Text key="a">second a</Text>, <Text key="b">second b</Text>]}
      </Form.Section>
    </Form>
  );
}

const duplicateKeyWarning = /unique "key" prop|same key/i;

/** Calls to `console.error` that complain about keys. */
function keyWarnings(
  error: jest.SpiedFunction<typeof console.error>
): unknown[][] {
  return error.mock.calls.filter((call) =>
    duplicateKeyWarning.test(String(call[0]))
  );
}

describe('Form rows keep their identity when the app re-renders', () => {
  let error: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    mounts = 0;
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('does not remount a row when a node above it appears or goes', async () => {
    const view = await render(<BannerForm banner={true} />);
    expect(mounts).toBe(1);

    await view.rerender(<BannerForm banner={false} />);

    // The banner holds a slot whether or not it renders anything, so the row below it is
    // still the row at slot 1. Counting only the rows emitted — what this used to do —
    // re-keys it, and this is what that costs: a row built from scratch, with its field's
    // text, focus and caret gone.
    expect(mounts).toBe(1);

    await act(async () => {
      expect(view.getByTestId('mounted')).toBeTruthy();
    });
    expect(keyWarnings(error)).toEqual([]);
  });

  it('gives two lists with the same item keys a scope each', async () => {
    const view = await render(<TwoArrays />);

    // React's own complaint is the evidence: a flattened list without a per-scope prefix
    // hands it two children called "a".
    expect(keyWarnings(error)).toEqual([]);
    await act(async () => {
      expect(view.getAllByText(/^second /)).toHaveLength(2);
    });
  });
});

describe('Form.Row as a direct child only', () => {
  /**
   * Runs first in this block, and not by accident: the warning below is once per process, so a
   * case that asks for silence only means something while the flag is still unset.
   */
  it('does not call the rows of a Form inside a row nested', async () => {
    // A `Form` rendered inside a `Form.Row` - a sheet with its own list - is a new list, not a
    // second row inside the outer row's cell. The outer row's "you are inside a row" flag must
    // not reach through the inner Form and brand its rows as nested.
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await render(
        <Form>
          <Form.Section>
            <Form.Row onPress={() => undefined}>
              <Form>
                <Form.Section title="Inner">
                  <Form.Row>
                    <Text>inner form row</Text>
                  </Form.Row>
                </Form.Section>
              </Form>
            </Form.Row>
          </Form.Section>
        </Form>
      );
      const warned = error.mock.calls.some((call) =>
        /`Form.Row` was rendered inside another `Form.Row`/.test(
          String(call[0])
        )
      );
      expect(warned).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  it('says so when a row is rendered inside a row', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await render(
        <Form>
          <Form.Section>
            <Form.Row onPress={() => undefined}>
              <Form.Row>
                <Text>inner</Text>
              </Form.Row>
            </Form.Row>
          </Form.Section>
        </Form>
      );
      const warned = error.mock.calls.some((call) =>
        /`Form.Row` was rendered inside another `Form.Row`/.test(
          String(call[0])
        )
      );
      expect(warned).toBe(true);
    } finally {
      error.mockRestore();
    }
  });
});

describe('an unstyled Form still takes the space its parent offers', () => {
  /** The style React Native is asked to lay the Form's own view out with. */
  async function formStyle(children: ReactNode): Promise<unknown> {
    const view = await render(<Form testID="the-form">{children}</Form>);
    const host = view.getByTestId('the-form') as unknown as {
      props: Record<string, unknown>;
    };
    return host.props.style;
  }

  it('grows and shrinks on iOS, where its sections are absolutely positioned', async () => {
    const style = await formStyle(
      <Form.Section title="Connectivity">
        <Form.Row>
          <Text>one</Text>
        </Form.Row>
      </Form.Section>
    );
    // Every iOS section is `position: 'absolute'`, so an unstyled Form has nothing in flow
    // and is 0 pt tall: the README example draws nothing at all.
    expect(flatten(style)).toMatchObject({ flexGrow: 1, flexShrink: 1 });
  });
});

/** `StyleSheet.flatten` without importing it for one call. */
function flatten(style: unknown): Record<string, unknown> {
  const parts = Array.isArray(style) ? style.flat(4) : [style];
  return Object.assign(
    {},
    ...parts.filter((part) => part != null && typeof part === 'object')
  );
}
