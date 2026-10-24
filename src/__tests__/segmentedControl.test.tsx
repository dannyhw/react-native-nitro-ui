import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { SegmentedControl } from '../components/SegmentedControl/SegmentedControl';

/**
 * Wrapper-level tests for the SegmentedControl (task G4).
 *
 * These cover the two things the on-device suite cannot read: the *text* of
 * `nuiSizingKey` (the sizing engine keys its cache by it, and a harness only sees
 * the sizes that come out of it) and the props the wrapper hands the native view.
 * The device suite owns geometry, the handshake and events.
 *
 * A sizing key is a contract with a cache, so it is asserted as a string:
 * the option count, then the labels, each escaped so that a label cannot forge a
 * separator. Two option lists that share a key share one cached size for the life
 * of the process - the R3 bug class DECISIONS D16 assigns to this component.
 */
beforeEach(() => {
  // `useSizingId` asks native for an instance id; the root mock keeps a registry
  // of fakes for exactly that.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

/**
 * The props the wrapper gave the native view with `testID`.
 *
 * Queries come off this test's `render` result, not RTL's `screen`: several tests
 * mount two controls, and `screen` is per-file state.
 */
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
    // Both join to nothing, so without the leading count these two share a key -
    // and `[]` is no segments wide while `['']` is one empty segment.
    const none = await render(<SegmentedControl options={[]} testID="none" />);
    const empty = await render(
      <SegmentedControl options={['']} testID="empty" />
    );
    expect(nativeProps(none, 'none').nuiSizingKey).toBe('0|');
    expect(nativeProps(empty, 'empty').nuiSizingKey).toBe('1|');
  });

  it('escapes a separator inside a label', async () => {
    // `['aa|bb', 'c']` and `['aa', 'bb|c']` would both join to `aa|bb|c`. They are
    // not the same control: iOS gives every segment the width of the widest label,
    // so 5+1 and 2+4 differ - two sizes, one cache entry, one of them wrong for
    // the life of the process.
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
    // Labels `a\` and `b` must not read back as the single label `a\|b`, which is
    // what a backslash that is not itself escaped would produce.
    const slash = await render(
      <SegmentedControl options={['a\\', 'b']} testID="slash" />
    );
    const forged = await render(
      <SegmentedControl options={['a\\|b']} testID="forged" />
    );
    expect(nativeProps(slash, 'slash').nuiSizingKey).toBe('2|a\\\\|b');
    //  + an escaped backslash + an escaped pipe + : four characters in, six
    // out, and no way to read it back as the two-label list above.
    expect(nativeProps(forged, 'forged').nuiSizingKey).toBe('1|a\\\\\\|b');
  });

  it('does not move when the selection, tint or disabled flag moves', async () => {
    // None of those makes the control wider or taller, and putting them in the key
    // would fragment the cache per selection (docs/architecture/sizing.md).
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
    // `null`, not `undefined`: that is what tells native to keep its own
    // selection, and an absent prop would not be a `Variant_NullType_Double` (D7).
    expect(nativeProps(seed, 'seed').selectedIndex).toBeNull();
  });

  it('sends every prop, always', async () => {
    // D7: native props are never optional, so the native side never has to guess
    // what an absent one meant. A key missing here is a prop the wrapper stopped
    // sending, which native would then keep at its previous value.
    const view = await render(
      <SegmentedControl options={['One']} testID="all" />
    );
    expect(Object.keys(nativeProps(view, 'all')).sort()).toEqual(
      [
        'accessibilityLabel',
        'defaultSelectedIndex',
        'disabled',
        // Nitro's own prop: the generated component reads it to hand the Hybrid
        // Object back after mount, which is how  works at all.
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
