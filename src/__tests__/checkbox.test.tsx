import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  Checkbox,
  type CheckboxIosStyle,
} from '../components/Checkbox/Checkbox';

/**
 * Wrapper-level tests for the Checkbox's props (task G15, review fix round 1).
 *
 * Both are things the device suite cannot see: it observes what the control
 * *measures* and *reports*, and an empty string that reaches native looks like a
 * label of zero width, not like a mistake. `label=""` and `accessibilityLabel=""`
 * are the case the review named — on iOS a non-nil name is applied with
 * `accessibilityLabel(_:)`, and an empty one silences the element rather than
 * naming it — and the sizing key is the case the device suite can never separate,
 * because two configurations that share a key share one cached size.
 */
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

/**
 * `iosStyle` (task G31, DECISIONS D47): the resolution, and what each platform puts
 * in its size configuration.
 *
 * Both halves are wrapper-only claims. The device suite sees one style per mounted
 * checkbox, so it cannot see the *default* (a spec that always receives the prop
 * receives `'circle'`, not nothing) nor the fallback for a name iOS has no glyph for
 * (native resolves it too, but only after JS has sent something, and a name that
 * reached native as `undefined` would read as the empty string there). The key half
 * is the one jest can decide for both platforms at once, which the device suite
 * cannot: `Platform.OS` is fixed for a run, and Android's key is only *interesting*
 * because it does not carry a field iOS's does.
 */
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
    // Always a string, never `undefined`: an optional Hybrid View prop is nitro#1184
    // territory, and a recycled view has to be able to be *given* the default back.
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
    // A caller who passes a name from a looser typed source (`string`) must get the
    // default rather than a control native cannot draw - Chip's `resolveVariant` rule.
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
    // iOS: three styles are three controls' boxes, so a key that left the field out
    // would hand a square checkbox the circle's cached size (D17). Android: Material
    // draws one checkbox whichever name iOS was asked for, so a key that *carried* it
    // would spend three cold configurations on a prop that changes nothing drawn.
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
      // The style is a field of its own, after the indeterminate flag and before the
      // label, and the label is still the last field.
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

  it('keys the third state where it is drawn, which is not the switch style', async () => {
    // `indeterminate` is in the key wherever a third glyph appears and out where it
    // does not - on Android always (TriStateCheckbox), on iOS only for the glyph
    // styles, whose dash D47 item 3 added. The `'switch'` control has two positions,
    // so asking it about `indeterminate` would file a second configuration for a box
    // that cannot look different.
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
      expect(nativeProps(glyph, 'i-glyph').nuiSizingKey).toBe('1|circle|K');
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
