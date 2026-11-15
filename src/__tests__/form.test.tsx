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

beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
});

let mounts = 0;

/** One mount is one `useState` initialiser; a re-render does not run it again. */
function Mounted({ label }: { label: string }) {
  useState((): number => {
    mounts += 1;
    return mounts;
  });
  return <Text testID="mounted">{label}</Text>;
}

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

    expect(mounts).toBe(1);

    await act(async () => {
      expect(view.getByTestId('mounted')).toBeTruthy();
    });
    expect(keyWarnings(error)).toEqual([]);
  });

  it('gives two lists with the same item keys a scope each', async () => {
    const view = await render(<TwoArrays />);

    expect(keyWarnings(error)).toEqual([]);
    await act(async () => {
      expect(view.getAllByText(/^second /)).toHaveLength(2);
    });
  });
});

describe('Form.Row as a direct child only', () => {
  // Must run first in this block: the warning is once per process, so silence
  // only means something before it has fired.
  it('does not call the rows of a Form inside a row nested', async () => {
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
