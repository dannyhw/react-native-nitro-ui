import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { SegmentedControl } from '../components/SegmentedControl/SegmentedControl';

beforeEach(() => {
  // `useSizingId` asks the native core for an instance id.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

describe('SegmentedControl · sizing key', () => {
  it('is the option count and the labels', async () => {
    const view = await render(
      <SegmentedControl options={['One', 'Two']} testID="seg" />
    );
    expect(nativeProps(view, 'seg').nuiSizingKey).toBe('2|One|Two');
  });

  it('separates an empty list from a list with one empty label', async () => {
    const none = await render(<SegmentedControl options={[]} testID="none" />);
    const empty = await render(
      <SegmentedControl options={['']} testID="empty" />
    );
    expect(nativeProps(none, 'none').nuiSizingKey).toBe('0|');
    expect(nativeProps(empty, 'empty').nuiSizingKey).toBe('1|');
  });

  it('escapes a separator inside a label', async () => {
    const first = await render(
      <SegmentedControl options={['aa|bb', 'c']} testID="first" />
    );
    const second = await render(
      <SegmentedControl options={['aa', 'bb|c']} testID="second" />
    );
    expect(nativeProps(first, 'first').nuiSizingKey).toBe('2|aa\\|bb|c');
    expect(nativeProps(second, 'second').nuiSizingKey).toBe('2|aa|bb\\|c');
  });

  it('escapes a backslash too, so the escape cannot be forged', async () => {
    const slash = await render(
      <SegmentedControl options={['a\\', 'b']} testID="slash" />
    );
    const forged = await render(
      <SegmentedControl options={['a\\|b']} testID="forged" />
    );
    expect(nativeProps(slash, 'slash').nuiSizingKey).toBe('2|a\\\\|b');
    expect(nativeProps(forged, 'forged').nuiSizingKey).toBe('1|a\\\\\\|b');
  });

  it('does not move when the selection, tint or disabled flag moves', async () => {
    const configured = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={2}
        disabled
        tintColor="#FF0000"
        testID="configured"
      />
    );
    const plain = await render(
      <SegmentedControl options={['One', 'Two', 'Three']} testID="plain" />
    );
    expect(nativeProps(configured, 'configured').nuiSizingKey).toBe(
      nativeProps(plain, 'plain').nuiSizingKey
    );
  });
});

describe('SegmentedControl · selection', () => {
  it('clamps a controlled index into the options', async () => {
    const high = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={7}
        testID="high"
      />
    );
    const low = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={-3}
        testID="low"
      />
    );
    expect(nativeProps(high, 'high').selectedIndex).toBe(2);
    expect(nativeProps(low, 'low').selectedIndex).toBe(0);
  });

  it('clamps the uncontrolled seed and sends null as the controlled value', async () => {
    const seed = await render(
      <SegmentedControl
        options={['One', 'Two']}
        defaultSelectedIndex={9}
        testID="seed"
      />
    );
    expect(nativeProps(seed, 'seed').defaultSelectedIndex).toBe(1);
    expect(nativeProps(seed, 'seed').selectedIndex).toBeNull();
  });

  it('sends every prop, always', async () => {
    const view = await render(
      <SegmentedControl options={['One']} testID="all" />
    );
    expect(Object.keys(nativeProps(view, 'all')).sort()).toEqual(
      [
        'accessibilityLabel',
        'defaultSelectedIndex',
        'disabled',
        // Nitro's own prop: how the native object is handed back after mount.
        'hybridRef',
        'mostRecentEventCount',
        'nuiPerfId',
        'nuiSizingId',
        'nuiSizingKey',
        'onValueChange',
        'options',
        'selectedIndex',
        'style',
        'testID',
        'tintColor',
      ].sort()
    );
  });
});
