import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  IconButton,
  resetIconButtonWarningsForTests,
} from '../components/IconButton/IconButton';

/**
 * Wrapper-level tests for IconButton (task G23).
 *
 * These are the facts the device suite cannot see, because they are about *which
 * props leave JS*: the two forms of the control are not two components, they are
 * two readings of `checked`/`defaultChecked`, and a wrapper that sends a toggle's
 * props for a press button composes a toggle on both platforms — which no on-device
 * test can tell from a control the caller asked to be a toggle. The size
 * configuration is the other one: two configurations that share a key share one
 * cached box, and a platform that ignores a field (iOS ignores `width`) is exactly
 * where a key would otherwise be trimmed.
 */
beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
  resetIconButtonWarningsForTests();
});

function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

describe('IconButton · the two forms', () => {
  it('sends no toggle props at all for a press button', async () => {
    const view = await render(
      <IconButton
        accessibilityLabel="Search"
        systemImage="magnifyingglass"
        onPress={() => {}}
        testID="press"
      />
    );
    const props = nativeProps(view, 'press');
    // Both null is what tells native to compose a Button rather than a Toggle.
    // `defaultChecked` used to be defaulted to `false` in the destructuring, which
    // made every IconButton a toggle.
    expect(props.checked).toBeNull();
    expect(props.defaultChecked).toBeNull();
  });

  it('seeds an uncontrolled toggle with defaultChecked', async () => {
    const view = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        defaultChecked
        testID="seeded"
      />
    );
    const props = nativeProps(view, 'seeded');
    expect(props.defaultChecked).toBe(true);
    // Uncontrolled: JS has no value to write, and native must not be told to.
    expect(props.checked).toBeNull();
  });

  it('treats a bare onCheckedChange as an uncontrolled toggle', async () => {
    const view = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        onCheckedChange={() => {}}
        testID="uncontrolled"
      />
    );
    const props = nativeProps(view, 'uncontrolled');
    expect(props.defaultChecked).toBe(false);
    expect(props.checked).toBeNull();
  });

  it('sends the caller value for a controlled toggle', async () => {
    const view = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        checked
        onCheckedChange={() => {}}
        testID="controlled"
      />
    );
    expect(nativeProps(view, 'controlled').checked).toBe(true);
  });

  it('sends every callback in both forms, so a recycled view cannot keep a handler', async () => {
    const press = await render(
      <IconButton accessibilityLabel="Search" testID="cb-press" />
    );
    const toggle = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        checked={false}
        testID="cb-toggle"
      />
    );
    for (const [view, id] of [
      [press, 'cb-press'],
      [toggle, 'cb-toggle'],
    ] as const) {
      const props = nativeProps(view, id);
      // Nitro's callback prop, not a bare function - and the point is that it is
      // *sent*: an absent callback prop is what D7b forbids between two commits.
      expect(props.onPress).toBeDefined();
      expect(props.onPress).not.toBeNull();
      expect(props.onCheckedChange).toBeDefined();
      expect(props.onCheckedChange).not.toBeNull();
    }
  });
});

describe('IconButton · the size configuration', () => {
  it('keys the default configuration by every field', async () => {
    const view = await render(
      <IconButton accessibilityLabel="Search" testID="key-default" />
    );
    expect(nativeProps(view, 'key-default').nuiSizingKey).toBe(
      'standard|medium|uniform||'
    );
  });

  it('keys the Android-only width option on both platforms', async () => {
    const uniform = await render(
      <IconButton accessibilityLabel="Search" testID="key-uniform" />
    );
    const wide = await render(
      <IconButton accessibilityLabel="Search" width="wide" testID="key-wide" />
    );
    // iOS ignores `width`, and a key trimmed to what iOS acts on would hand a wide
    // Android box to the next narrow control of every other configuration.
    expect(nativeProps(wide, 'key-wide').nuiSizingKey).toBe(
      'standard|medium|wide||'
    );
    expect(nativeProps(wide, 'key-wide').nuiSizingKey).not.toBe(
      nativeProps(uniform, 'key-uniform').nuiSizingKey
    );
  });

  it('keys the glyph on both platforms, and the rung', async () => {
    const one = await render(
      <IconButton
        accessibilityLabel="Search"
        systemImage="magnifyingglass"
        testID="key-glyph"
      />
    );
    const other = await render(
      <IconButton
        accessibilityLabel="Search"
        systemImage="star"
        testID="key-star"
      />
    );
    const androidIcon = await render(
      <IconButton
        accessibilityLabel="Search"
        androidIcon="star"
        testID="key-drawable"
      />
    );
    const rung = await render(
      <IconButton
        accessibilityLabel="Search"
        size="xxlarge"
        testID="key-rung"
      />
    );
    const variant = await render(
      <IconButton
        accessibilityLabel="Search"
        variant="filled"
        testID="key-variant"
      />
    );
    expect(nativeProps(other, 'key-star').nuiSizingKey).not.toBe(
      nativeProps(one, 'key-glyph').nuiSizingKey
    );
    expect(nativeProps(androidIcon, 'key-drawable').nuiSizingKey).toBe(
      'standard|medium|uniform||star'
    );
    expect(nativeProps(rung, 'key-rung').nuiSizingKey).toContain('|xxlarge|');
    expect(nativeProps(variant, 'key-variant').nuiSizingKey).toContain(
      'filled|medium'
    );
  });

  it('does not re-key for a state that only repaints', async () => {
    const off = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        checked={false}
        onCheckedChange={() => {}}
        testID="key-off"
      />
    );
    const on = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        checked
        onCheckedChange={() => {}}
        testID="key-on"
      />
    );
    const disabled = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        checked={false}
        disabled
        testID="key-disabled"
      />
    );
    const square = await render(
      <IconButton
        accessibilityLabel="Bookmark"
        shape="square"
        testID="key-square"
      />
    );
    const base = nativeProps(off, 'key-off').nuiSizingKey;
    expect(nativeProps(on, 'key-on').nuiSizingKey).toBe(base);
    expect(nativeProps(disabled, 'key-disabled').nuiSizingKey).toBe(base);
    expect(nativeProps(square, 'key-square').nuiSizingKey).toBe(base);
  });

  it('escapes a glyph name that contains the field separator', async () => {
    const forged = await render(
      <IconButton
        accessibilityLabel="Search"
        systemImage="a|filled|large"
        testID="key-forged"
      />
    );
    // A symbol name is free-form text. Unescaped, it would make two different
    // configurations read as one (Button's rule, and its escape).
    expect(nativeProps(forged, 'key-forged').nuiSizingKey).toBe(
      'standard|medium|uniform|a\\|filled\\|large|'
    );
  });
});

describe('IconButton · resolved values', () => {
  it('resolves anything unrecognised to the default', async () => {
    const view = await render(
      <IconButton
        accessibilityLabel="Search"
        variant={'sparkly' as 'filled'}
        size={'gigantic' as 'large'}
        width={'thick' as 'wide'}
        shape={null}
        testID="resolved"
      />
    );
    const props = nativeProps(view, 'resolved');
    expect(props.variant).toBe('standard');
    expect(props.size).toBe('medium');
    expect(props.width).toBe('uniform');
    expect(props.shape).toBe('round');
  });

  it('sends null rather than undefined for the optional props', async () => {
    const view = await render(
      <IconButton accessibilityLabel="Search" testID="nulls" />
    );
    const props = nativeProps(view, 'nulls');
    expect(props.systemImage).toBeNull();
    expect(props.androidIcon).toBeNull();
    expect(props.tintColor).toBeNull();
    expect(props.testID).toBe('nulls');
  });
});

describe('IconButton · the name it must have', () => {
  it('warns once in development about an empty accessibilityLabel', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(<IconButton accessibilityLabel="" testID="silent-one" />);
      await render(<IconButton accessibilityLabel="" testID="silent-two" />);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/accessibilityLabel/);
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing when the control is named', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(<IconButton accessibilityLabel="Search" testID="named" />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
