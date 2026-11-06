import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Menu, type MenuGroup } from '../components/Menu/Menu';

/**
 * Wrapper-level tests for the `action` field of the Menu's sizing key (E3).
 *
 * The key is the cache key: two Menus that build the same string share one cached size
 * for the life of the process (`docs/architecture/sizing.md`, DECISIONS D16). Menu's
 * key is Button's with one field added - `variant|size|action|systemImage|title` - and
 * the fifth exists because of one configuration: on Android a `primaryAction` changes
 * the *layout*, so the split trigger is wider than the plain button it replaces. Drop
 * that field and the two configurations collide into one cache entry, and every control
 * holding it ends up at whoever corrected it last.
 *
 * `Menu.harness.tsx` ("earns its own box") does catch that collision - measured, both
 * ways, in `docs/tasks/E3/mutations.json` - but it sees two boxes, never the key: it
 * poisons the keys *it* computes itself, so it can only report what a shared entry does
 * to a layout. Here the prop the wrapper passes to native is read directly, so the
 * field is the thing under test, including the quiet mutation where the field stays in
 * the key and can never say `action`. `buttonSizingKey.test.tsx` is the same shape for
 * the four fields the trigger shares with Button.
 */
const GROUP: MenuGroup = {
  actions: [{ id: 'now', title: 'Now' }],
};

beforeEach(() => {
  // `useSizingId` asks native for an instance id; the root mock keeps a registry of
  // fakes for exactly that.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

/**
 * The props the wrapper gave the native view with `testID`.
 *
 * Queries come off this test's `render` result, not RTL's `screen`: a collision test
 * mounts two Menus, and `screen` is per-file state.
 */
function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

const keyOf = (view: RenderResult, testId: string): string =>
  String(nativeProps(view, testId).nuiSizingKey);

describe('Menu - sizing key', () => {
  it("is Button's key with the action field after the scale", async () => {
    const view = await render(
      <Menu
        title="Publish"
        group={GROUP}
        variant="tonal"
        size="small"
        systemImage="square.and.arrow.down"
        testID="plain"
      />
    );
    expect(keyOf(view, 'plain')).toBe(
      'tonal|small|plain|square.and.arrow.down|Publish'
    );
  });

  it('tells a split trigger from the plain one it replaces', async () => {
    // The collision the field exists to prevent, on the fixture the device suite
    // measures: same variant, same scale, no icon, same title, and a `primaryAction`
    // on one of them. On Android these are two different boxes (124.95 x 48 against
    // 78.86 x 48, `docs/components/menu.md`), so the second to mount must not be laid
    // out from the first one's entry.
    const split = await render(
      <Menu
        title="Publish"
        group={GROUP}
        primaryAction={() => {}}
        testID="split"
      />
    );
    const plain = await render(
      <Menu title="Publish" group={GROUP} testID="plain" />
    );
    expect(keyOf(split, 'split')).toBe('filled|medium|action||Publish');
    expect(keyOf(plain, 'plain')).toBe('filled|medium|plain||Publish');
    expect(keyOf(split, 'split')).not.toBe(keyOf(plain, 'plain'));
  });

  it('takes the field back when the action is taken away', async () => {
    // Both directions, because a key that only ever says `action` collides just as
    // hard: a Menu that loses its `primaryAction` is the plain trigger again and must
    // go back to the plain trigger's entry.
    const withAction = await render(
      <Menu
        title="Publish"
        group={GROUP}
        primaryAction={() => {}}
        testID="toggle"
      />
    );
    expect(keyOf(withAction, 'toggle')).toBe('filled|medium|action||Publish');
    expect(nativeProps(withAction, 'toggle').hasPrimaryAction).toBe(true);

    const without = await render(
      <Menu
        title="Publish"
        group={GROUP}
        primaryAction={undefined}
        testID="toggle"
      />
    );
    expect(keyOf(without, 'toggle')).toBe('filled|medium|plain||Publish');
    expect(nativeProps(without, 'toggle').hasPrimaryAction).toBe(false);
  });
});
