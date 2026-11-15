import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  Checkbox,
  type CheckboxIosStyle,
} from '../components/Checkbox/Checkbox';

beforeEach(() => {
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

describe('Checkbox · props the wrapper sends', () => {
  it('sends no label when the label is empty, so iOS gets no empty name', async () => {
    const view = await render(
      <Checkbox label="" checked={false} testID="empty-label" />
    );
    const props = nativeProps(view, 'empty-label');
    expect(props.label).toBeNull();
    expect(props.accessibilityLabel).toBeNull();
  });

  it('sends no name when only the accessibility label is empty', async () => {
    const view = await render(
      <Checkbox accessibilityLabel="" checked={false} testID="empty-name" />
    );
    expect(nativeProps(view, 'empty-name').accessibilityLabel).toBeNull();
  });

  it('keys an empty label with the bare box', async () => {
    const empty = await render(
      <Checkbox label="" checked={false} testID="empty-key" />
    );
    const bare = await render(<Checkbox checked={false} testID="bare-key" />);
    const labelled = await render(
      <Checkbox label="Email me" checked={false} testID="labelled-key" />
    );
    expect(nativeProps(empty, 'empty-key').nuiSizingKey).toBe(
      nativeProps(bare, 'bare-key').nuiSizingKey
    );
    expect(nativeProps(labelled, 'labelled-key').nuiSizingKey).not.toBe(
      nativeProps(bare, 'bare-key').nuiSizingKey
    );
  });
});

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

describe('Checkbox · iosStyle (D47)', () => {
  it('sends the circle style when the caller names none', async () => {
    const view = await render(<Checkbox checked={false} testID="no-style" />);
    // Never `undefined`: a recycled view must be able to receive the default back.
    expect(nativeProps(view, 'no-style').iosStyle).toBe('circle');
  });

  it('forwards each style verbatim, including the switch', async () => {
    for (const iosStyle of ['circle', 'square', 'switch'] as const) {
      const testId = `style-${iosStyle}`;
      const view = await render(
        <Checkbox checked={false} iosStyle={iosStyle} testID={testId} />
      );
      expect(nativeProps(view, testId).iosStyle).toBe(iosStyle);
    }
  });

  it('resolves a name iOS has no glyph for to the circle', async () => {
    const view = await render(
      <Checkbox
        checked={false}
        iosStyle={'toggle' as CheckboxIosStyle}
        testID="unknown-style"
      />
    );
    expect(nativeProps(view, 'unknown-style').iosStyle).toBe('circle');
  });

  it('keys the iOS box by style and keeps the style out of Android’s key', async () => {
    // On iOS each style has its own box, so the style is part of the key. Android
    // draws one checkbox whatever the style, so its key leaves the style out.
    const keyFor = (view: RenderResult, testId: string): string =>
      String(nativeProps(view, testId).nuiSizingKey);
    await onOs('ios', async () => {
      const circle = await render(
        <Checkbox checked={false} label="K" testID="k-circle" />
      );
      const square = await render(
        <Checkbox
          checked={false}
          label="K"
          iosStyle="square"
          testID="k-square"
        />
      );
      const toggle = await render(
        <Checkbox
          checked={false}
          label="K"
          iosStyle="switch"
          testID="k-switch"
        />
      );
      const keys = [circle, square, toggle].map((view, index) =>
        keyFor(view, ['k-circle', 'k-square', 'k-switch'][index] as string)
      );
      expect(new Set(keys).size).toBe(3);
      // Field order: the indeterminate flag, the style, then the label.
      expect(keys[0]).toBe('0|circle|K');
      expect(keys[2]).toBe('0|switch|K');
    });
    await onOs('android', async () => {
      const circle = await render(
        <Checkbox checked={false} label="K" testID="a-circle" />
      );
      const square = await render(
        <Checkbox
          checked={false}
          label="K"
          iosStyle="square"
          testID="a-square"
        />
      );
      expect(keyFor(circle, 'a-circle')).toBe('0|K');
      expect(keyFor(square, 'a-square')).toBe(keyFor(circle, 'a-circle'));
    });
  });

  it('keys the third state on Android, and not at all on iOS', async () => {
    // `indeterminate` changes the box only on Android (`TriStateCheckbox`). On iOS
    // the dash glyph has the same box as the other glyphs, so the field stays `0`.
    await onOs('ios', async () => {
      const glyph = await render(
        <Checkbox checked={false} indeterminate label="K" testID="i-glyph" />
      );
      const toggle = await render(
        <Checkbox
          checked={false}
          indeterminate
          iosStyle="switch"
          label="K"
          testID="i-switch"
        />
      );
      expect(nativeProps(glyph, 'i-glyph').nuiSizingKey).toBe('0|circle|K');
      expect(nativeProps(toggle, 'i-switch').nuiSizingKey).toBe('0|switch|K');
    });
    await onOs('android', async () => {
      const box = await render(
        <Checkbox
          checked={false}
          indeterminate
          iosStyle="switch"
          label="K"
          testID="a-ind"
        />
      );
      expect(nativeProps(box, 'a-ind').nuiSizingKey).toBe('1|K');
    });
  });
});
