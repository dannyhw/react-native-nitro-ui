import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Checkbox } from '../components/Checkbox/Checkbox';

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
