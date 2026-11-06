import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Button } from '../components/Button/Button';

/**
 * Wrapper-level tests for the Button's `nuiSizingKey` (task G10, closing G2's
 * review item "the sizing key joins free-form fields with `|`, so two field
 * splits can collide").
 *
 * The key is the cache key: two Buttons that build the same string share one
 * cached size for the life of the process (`docs/architecture/sizing.md`,
 * "Building `nuiSizingKey`", and DECISIONS D16). `systemImage` and `title` are
 * free-form, so they are escaped the way Menu's trigger, Picker's options and
 * SegmentedControl's labels already are. The device suite cannot see this at
 * all: it only ever observes the sizes that come out of the cache, and a
 * collision looks exactly like a correct measurement of the other control.
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
 * Queries come off this test's `render` result, not RTL's `screen`: a collision
 * test mounts two controls, and `screen` is per-file state.
 */
function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

const keyOf = (view: RenderResult, testId: string): string =>
  String(nativeProps(view, testId).nuiSizingKey);

describe('Button · sizing key', () => {
  it('is the variant, the scale, both icon fields and the title', async () => {
    const view = await render(
      <Button
        title="Save"
        systemImage="square.and.arrow.down"
        variant="tonal"
        size="small"
        onPress={undefined}
        testID="plain"
      />
    );
    // The empty field between the two icon names is `androidIcon`, which a Button
    // on iOS never fills: an omitted icon and an empty one are one configuration,
    // so both render as an empty field rather than being dropped - dropping a
    // field would shift every one after it and make the count ambiguous.
    expect(keyOf(view, 'plain')).toBe(
      'tonal|small|square.and.arrow.down||Save'
    );
  });

  it('separates a pipe in the icon from a pipe in the title', async () => {
    // The collision G2's review named, spelled out: unescaped, both of these
    // join to `filled|medium|x|a|b`, so the second Button is laid out at the
    // first one's width for the rest of the process. They are different
    // controls - an icon plus a one-character label is not a one-character icon
    // plus a two-character label.
    const iconCarriesIt = await render(
      <Button title="b" systemImage="x|a" onPress={undefined} testID="icon" />
    );
    const titleCarriesIt = await render(
      <Button title="a|b" systemImage="x" onPress={undefined} testID="title" />
    );
    expect(keyOf(iconCarriesIt, 'icon')).toBe('filled|medium|x\\|a||b');
    expect(keyOf(titleCarriesIt, 'title')).toBe('filled|medium|x||a\\|b');
    expect(keyOf(iconCarriesIt, 'icon')).not.toBe(
      keyOf(titleCarriesIt, 'title')
    );
  });

  it('escapes a backslash too, so the escape cannot be forged', async () => {
    // The other half of the rule: a backslash that is not itself escaped lets a
    // title reach into the icon's field. Unescaped, an icon `a\` with title
    // `b|c` and an icon `a\|b` with title `c` both join to `a\|b|c` - the
    // escape-then-join only separates them if the backslash is doubled first.
    // (Written as expressions: a JSX attribute string takes its backslashes
    // literally, so `"a\\""` there is two characters, not one.)
    const backslashInIcon = await render(
      <Button
        title={'b|c'}
        systemImage={'a\\'}
        onPress={undefined}
        testID="first"
      />
    );
    const forgedIcon = await render(
      <Button
        title={'c'}
        systemImage={'a\\|b'}
        onPress={undefined}
        testID="second"
      />
    );
    expect(keyOf(backslashInIcon, 'first')).toBe(
      'filled|medium|a\\\\||b\\|c'
    );
    expect(keyOf(backslashInIcon, 'first')).not.toBe(
      keyOf(forgedIcon, 'second')
    );
  });

  it('tells no icon from an empty one and no title from an empty one', async () => {
    // The count-of-fields half of the same rule: `undefined` and `''` both reach
    // native as "no image", so they must build one key rather than two that
    // fragment the cache over a difference no control can show.
    const none = await render(
      <Button title="Save" onPress={undefined} testID="none" />
    );
    const empty = await render(
      <Button title="Save" systemImage="" onPress={undefined} testID="empty" />
    );
    expect(keyOf(none, 'none')).toBe(keyOf(empty, 'empty'));
  });
});
