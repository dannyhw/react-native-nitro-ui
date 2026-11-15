import { beforeEach, describe, expect, it } from '@jest/globals';
import { Platform } from 'react-native';
import { act, render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Picker } from '../components/Picker/Picker';

// One counter for the file: `nitroUiCore` caches its native object on first
// use, so only the first factory is ever called. Never assert an absolute id.
let mockIds = 0;
function nextMockId(): number {
  return ++mockIds;
}

beforeEach(() => {
  // A fresh id per call, like the real core: a remounted view gets a new one.
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: nextMockId });
});

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
    const short = await render(
      <Picker options={['S', 'Medium']} selectedIndex={0} testID="short" />
    );
    const long = await render(
      <Picker options={['S', 'Medium']} selectedIndex={1} testID="long" />
    );
    expect(keyOf(short, 'short')).not.toBe(keyOf(long, 'long'));
  });

  it('uses the selected title, not an out-of-range index', async () => {
    const clamped = await render(
      <Picker options={['One', 'Two']} selectedIndex={9} testID="clamped" />
    );
    const direct = await render(
      <Picker options={['One', 'Two']} selectedIndex={1} testID="direct" />
    );
    expect(keyOf(clamped, 'clamped')).toBe(keyOf(direct, 'direct'));
  });

  it('separates an empty list from a list with one empty label', async () => {
    const none = await render(<Picker options={[]} testID="none" />);
    const empty = await render(<Picker options={['']} testID="empty" />);
    expect(keyOf(none, 'none')).toBe('menu|0|sel:|lbl:');
    expect(keyOf(empty, 'empty')).toBe('menu|1||sel:|lbl:');
  });

  it('escapes a separator inside a label', async () => {
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
    const slash = await render(
      <Picker options={['a\\', 'b']} testID="slash" />
    );
    const forged = await render(<Picker options={['a\\|b']} testID="forged" />);
    expect(keyOf(slash, 'slash')).toBe('menu|2|a\\\\|b|sel:a\\\\|lbl:');
    expect(keyOf(forged, 'forged')).toBe('menu|1|a\\\\\\|b|sel:a\\\\\\|b|lbl:');
  });

  it('is the same when only the tint or the disabled flag moves', async () => {
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
    expect(nativeProps(seed, 'seed').selectedIndex).toBeNull();
  });

  it('sends every prop, always', async () => {
    const view = await render(<Picker options={['One']} testID="all" />);
    expect(Object.keys(nativeProps(view, 'all')).sort()).toEqual(
      [
        'accessibilityLabel',
        'defaultSelectedIndex',
        'disabled',
        // Nitro's own prop: how the native object is handed back after mount.
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

describe('Picker · uncontrolled key', () => {
  it('names the picked title, and only the picked title of the current mount', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    const view = await render(<Picker options={OPTIONS} testID="rt" />);
    const reportedByNative = (
      nativeProps(view, 'rt').onValueChange as {
        f: (index: number, eventCount: number) => void;
      }
    ).f;

    await act(async () => {
      reportedByNative(2, 1);
    });
    expect(keyOf(view, 'rt')).toBe('menu|3|One|Two|Three|sel:Three|lbl:');

    const firstId = nativeProps(view, 'rt').nuiSizingId;

    await view.rerender(
      <Picker options={OPTIONS} variant="wheel" testID="rt" />
    );
    expect(keyOf(view, 'rt')).toBe('wheel|3|One|Two|Three|sel:One|lbl:');

    await view.rerender(<Picker options={OPTIONS} testID="rt" />);
    expect(nativeProps(view, 'rt').nuiSizingId).not.toBe(firstId);
    expect(keyOf(view, 'rt')).toBe('menu|3|One|Two|Three|sel:One|lbl:');
  });
});

describe('Picker · variant', () => {
  it('normalises an unknown variant to the menu', async () => {
    const odd = await render(
      <Picker options={['One']} variant={'popover' as 'menu'} testID="odd" />
    );
    expect(nativeProps(odd, 'odd').variant).toBe('menu');
  });

  it('asks for its own width as a menu and for the box width as a wheel', async () => {
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

  /** Runs `body` with `Platform.OS` reporting `os`. */
  async function onOs<T>(
    os: 'ios' | 'android',
    body: () => Promise<T>
  ): Promise<T> {
    const previous = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
    try {
      return await body();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: previous,
      });
    }
  }

  it('is a radio group on Android and the menu on iOS', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    await onOs('android', async () => {
      const group = await render(
        <Picker options={OPTIONS} variant="radio" testID="r-a" />
      );
      expect(nativeProps(group, 'r-a').variant).toBe('radio');
      expect(keyOf(group, 'r-a')).toBe('radio|3|One|Two|Three');
      expect(nativeProps(group, 'r-a').style).toEqual([
        { alignSelf: 'flex-start' },
        undefined,
      ]);
    });
    await onOs('ios', async () => {
      const group = await render(
        <Picker options={OPTIONS} variant="radio" testID="r-i" />
      );
      expect(nativeProps(group, 'r-i').variant).toBe('menu');
      expect(keyOf(group, 'r-i')).toBe('menu|3|One|Two|Three|sel:One|lbl:');
    });
  });

  it('keeps a radio selection out of the key and a menu selection in it', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    await onOs('android', async () => {
      const group = await render(
        <Picker
          options={OPTIONS}
          variant="radio"
          selectedIndex={0}
          testID="k"
        />
      );
      const before = keyOf(group, 'k');
      await group.rerender(
        <Picker
          options={OPTIONS}
          variant="radio"
          selectedIndex={2}
          testID="k"
        />
      );
      expect(keyOf(group, 'k')).toBe(before);
      expect(keyOf(group, 'k')).toBe('radio|3|One|Two|Three');

      const menu = await render(
        <Picker options={OPTIONS} selectedIndex={0} testID="km" />
      );
      await menu.rerender(
        <Picker options={OPTIONS} selectedIndex={2} testID="km" />
      );
      expect(keyOf(menu, 'km')).toBe('menu|3|One|Two|Three|sel:Three|lbl:');
    });
  });

  it('keeps the accessibility label out of the radio key and in the menu key', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    await onOs('android', async () => {
      const group = await render(
        <Picker options={OPTIONS} variant="radio" label="First" testID="l-a" />
      );
      const before = keyOf(group, 'l-a');
      await group.rerender(
        <Picker
          options={OPTIONS}
          variant="radio"
          label="Renamed"
          testID="l-a"
        />
      );
      expect(keyOf(group, 'l-a')).toBe(before);
      expect(keyOf(group, 'l-a')).toBe('radio|3|One|Two|Three');
      expect(nativeProps(group, 'l-a').label).toBe('Renamed');

      const menu = await render(
        <Picker options={OPTIONS} label="First" testID="l-m" />
      );
      await menu.rerender(
        <Picker options={OPTIONS} label="Renamed" testID="l-m" />
      );
      expect(keyOf(menu, 'l-m')).toBe(
        'menu|3|One|Two|Three|sel:One|lbl:Renamed'
      );
    });
  });

  it('treats an iOS variant change between menu and radio as no change at all', async () => {
    await onOs('ios', async () => {
      const OPTIONS = ['One', 'Two'];
      const menu = await render(
        <Picker options={OPTIONS} variant="menu" testID="same" />
      );
      const menuId = nativeProps(menu, 'same').nuiSizingId;
      await menu.rerender(
        <Picker options={OPTIONS} variant="radio" testID="same" />
      );
      expect(nativeProps(menu, 'same').nuiSizingId).toBe(menuId);
      expect(nativeProps(menu, 'same').variant).toBe('menu');
    });
  });
});
