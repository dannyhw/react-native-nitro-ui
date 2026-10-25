import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Picker } from '../components/Picker/Picker';

/**
 * Wrapper-level tests for the Picker (task G6).
 *
 * The same two things the on-device suite cannot read as `segmentedControl.test.tsx`
 * reads them: the *text* of `nuiSizingKey`, and the props the wrapper hands the
 * native view. The device suite owns geometry, the handshake and events.
 *
 * A Picker's key is a stricter contract than a SegmentedControl's, because a menu
 * button is as wide as the single title it shows: the selected label is part of
 * the key here and deliberately not there. Two configurations that share a key
 * share one cached size for the life of the process.
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

function keyOf(view: RenderResult, testId: string): string {
  return nativeProps(view, testId).nuiSizingKey as string;
}

describe('Picker · sizing key', () => {
  it('names the variant, the option count, the labels, the selection and the label', async () => {
    const view = await render(
      <Picker
        options={['One', 'Two']}
        selectedIndex={1}
        label="Size"
        testID="picker"
      />
    );
    expect(keyOf(view, 'picker')).toBe('menu|2|One|Two|sel:Two|lbl:Size');
  });

  it('puts the variant first, so a wheel never reads a menu size', async () => {
    // The two variants have different sizing *policies* (a menu is as wide as its
    // title, a wheel is as wide as its box), so sharing one cache entry would let
    // one policy's number answer for the other's.
    const menu = await render(
      <Picker options={['One', 'Two']} testID="menu" />
    );
    const wheel = await render(
      <Picker options={['One', 'Two']} variant="wheel" testID="wheel" />
    );
    expect(keyOf(menu, 'menu')).toBe('menu|2|One|Two|sel:One|lbl:');
    expect(keyOf(wheel, 'wheel')).toBe('wheel|2|One|Two|sel:One|lbl:');
  });

  it('moves when the selected title moves', async () => {
    // The opposite of SegmentedControl's rule on purpose: `['S','Medium']` shows a
    // two-character button at index 0 and a six-character one at index 1. A key
    // without the selection would cache the narrow button's width against the wide
    // one and keep it for the life of the process.
    const short = await render(
      <Picker options={['S', 'Medium']} selectedIndex={0} testID="short" />
    );
    const long = await render(
      <Picker options={['S', 'Medium']} selectedIndex={1} testID="long" />
    );
    expect(keyOf(short, 'short')).not.toBe(keyOf(long, 'long'));
  });

  it('uses the selected title, not an out-of-range index', async () => {
    // Clamped in JS and again natively, so the key has to name the title the
    // control is about to paint: `selectedIndex={9}` shows 'Two'.
    const clamped = await render(
      <Picker options={['One', 'Two']} selectedIndex={9} testID="clamped" />
    );
    const direct = await render(
      <Picker options={['One', 'Two']} selectedIndex={1} testID="direct" />
    );
    expect(keyOf(clamped, 'clamped')).toBe(keyOf(direct, 'direct'));
  });

  it('separates an empty list from a list with one empty label', async () => {
    // Both join to nothing after the count, so the count is what keeps them apart.
    const none = await render(<Picker options={[]} testID="none" />);
    const empty = await render(<Picker options={['']} testID="empty" />);
    expect(keyOf(none, 'none')).toBe('menu|0|sel:|lbl:');
    expect(keyOf(empty, 'empty')).toBe('menu|1||sel:|lbl:');
  });

  it('escapes a separator inside a label', async () => {
    // `['aa|bb', 'c']` and `['aa', 'bb|c']` would both join to `aa|bb|c`, and they
    // are not the same control: the widest title differs, so two sizes would share
    // one cache entry with one of them wrong forever.
    const first = await render(
      <Picker options={['aa|bb', 'c']} testID="first" />
    );
    const second = await render(
      <Picker options={['aa', 'bb|c']} testID="second" />
    );
    expect(keyOf(first, 'first')).toBe('menu|2|aa\\|bb|c|sel:aa\\|bb|lbl:');
    expect(keyOf(second, 'second')).toBe('menu|2|aa|bb\\|c|sel:aa|lbl:');
  });

  it('escapes a backslash too, so the escape cannot be forged', async () => {
    // Labels `a\` and `b` must not read back as the single label `a\|b`, which is
    // what a backslash that is not itself escaped would produce.
    const slash = await render(
      <Picker options={['a\\', 'b']} testID="slash" />
    );
    const forged = await render(<Picker options={['a\\|b']} testID="forged" />);
    expect(keyOf(slash, 'slash')).toBe('menu|2|a\\\\|b|sel:a\\\\|lbl:');
    expect(keyOf(forged, 'forged')).toBe('menu|1|a\\\\\\|b|sel:a\\\\\\|b|lbl:');
  });

  it('is the same when only the tint or the disabled flag moves', async () => {
    // Neither makes the control wider or taller, and putting them in the key would
    // fragment the cache per repaint (docs/architecture/sizing.md).
    const configured = await render(
      <Picker
        options={['One', 'Two']}
        disabled
        tintColor="#FF0000"
        testID="configured"
      />
    );
    const plain = await render(
      <Picker options={['One', 'Two']} testID="plain" />
    );
    expect(keyOf(configured, 'configured')).toBe(keyOf(plain, 'plain'));
  });
});

describe('Picker · selection', () => {
  it('clamps a controlled index into the options', async () => {
    const high = await render(
      <Picker
        options={['One', 'Two', 'Three']}
        selectedIndex={7}
        testID="high"
      />
    );
    const low = await render(
      <Picker
        options={['One', 'Two', 'Three']}
        selectedIndex={-3}
        testID="low"
      />
    );
    expect(nativeProps(high, 'high').selectedIndex).toBe(2);
    expect(nativeProps(low, 'low').selectedIndex).toBe(0);
  });

  it('clamps junk to the front', async () => {
    const junk = await render(
      <Picker
        options={['One', 'Two']}
        selectedIndex={Number.NaN}
        testID="junk"
      />
    );
    expect(nativeProps(junk, 'junk').selectedIndex).toBe(0);
  });

  it('clamps the uncontrolled seed and sends null as the controlled value', async () => {
    const seed = await render(
      <Picker options={['One', 'Two']} defaultSelectedIndex={9} testID="seed" />
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
    const view = await render(<Picker options={['One']} testID="all" />);
    expect(Object.keys(nativeProps(view, 'all')).sort()).toEqual(
      [
        'accessibilityLabel',
        'defaultSelectedIndex',
        'disabled',
        // Nitro's own prop: the generated component reads it to hand the Hybrid
        // Object back after mount, which is how `hybridRef` works at all.
        'hybridRef',
        'label',
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
        'variant',
      ].sort()
    );
  });
});

describe('Picker · variant', () => {
  it('normalises an unknown variant to the menu', async () => {
    // Native reads one of two strings; anything else must not reach it as a third
    // thing that falls through to whatever the platform defaults to.
    const odd = await render(
      <Picker options={['One']} variant={'popover' as 'menu'} testID="odd" />
    );
    expect(nativeProps(odd, 'odd').variant).toBe('menu');
  });

  it('asks for its own width as a menu and for the box width as a wheel', async () => {
    // `alignItems: stretch` (the default in a column) decides the width for a
    // stretched child, so a menu must opt out and a wheel must opt in: the wheel's
    // width *is* the box's width (sizing.md §6).
    const menu = await render(<Picker options={['One']} testID="m" />);
    const wheel = await render(
      <Picker options={['One']} variant="wheel" testID="w" />
    );
    expect(nativeProps(menu, 'm').style).toEqual([
      { alignSelf: 'flex-start' },
      undefined,
    ]);
    expect(nativeProps(wheel, 'w').style).toEqual([
      { alignSelf: 'stretch' },
      undefined,
    ]);
  });
});
