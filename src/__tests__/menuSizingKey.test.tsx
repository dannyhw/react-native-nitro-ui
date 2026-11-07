import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Menu, type MenuGroup } from '../components/Menu/Menu';

/**
 * Wrapper-level tests for the `action` field of the Menu's sizing key (E3).
 *
 * The key is the cache key: two Menus that build the same string share one cached size
 * for the life of the process (`docs/architecture/sizing.md`, DECISIONS D16). Menu's
 * key is Button's with one field added - `variant|size|action|systemImage|androidIcon|
 * title` - and the `action` field exists because of one configuration: on Android a
 * `primaryAction` changes
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
      'tonal|small|plain|square.and.arrow.down||Publish'
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
    expect(keyOf(split, 'split')).toBe('filled|medium|action|||Publish');
    expect(keyOf(plain, 'plain')).toBe('filled|medium|plain|||Publish');
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
    expect(keyOf(withAction, 'toggle')).toBe('filled|medium|action|||Publish');
    expect(nativeProps(withAction, 'toggle').hasPrimaryAction).toBe(true);

    const without = await render(
      <Menu
        title="Publish"
        group={GROUP}
        primaryAction={undefined}
        testID="toggle"
      />
    );
    expect(keyOf(without, 'toggle')).toBe('filled|medium|plain|||Publish');
    expect(nativeProps(without, 'toggle').hasPrimaryAction).toBe(false);
  });
});

/**
 * `androidIcon` on the trigger (G19 fix round 2, item 4).
 *
 * Two things had to happen for a Menu to take a glyph, and they are different kinds
 * of mistake: the prop has to reach native, and the cached size has to know about it.
 * A glyph makes a trigger wider - that is what `Button`'s own key field is for, and
 * `docs/components/menu.md` promises a Menu's box is a Button's box - so a Menu that
 * sent the icon but left it out of the key would lay two different controls out from
 * one entry, whoever corrected it last winning.
 */
describe('Menu - androidIcon', () => {
  it("is Button's key with the icon in the place Button puts it", async () => {
    const view = await render(
      <Menu
        title="Publish"
        group={GROUP}
        variant="tonal"
        size="small"
        systemImage="square.and.arrow.down"
        androidIcon="share"
        testID="icon"
      />
    );
    expect(keyOf(view, 'icon')).toBe(
      'tonal|small|plain|square.and.arrow.down|share|Publish'
    );
    // The wire form, not the caller's: what native is given is what the key holds, so
    // the two cannot end up describing different controls.
    expect(nativeProps(view, 'icon').androidIcon).toBe('share');
  });

  it('sends null when there is no glyph, and never an unset prop', async () => {
    // D7b / nitro#1184: a prop that disappears between commits is the crash, so the
    // wrapper always sends the prop, with `null` for "nothing asked for".
    const view = await render(
      <Menu title="Publish" group={GROUP} testID="plain" />
    );
    expect(nativeProps(view, 'plain').androidIcon).toBeNull();
    expect('androidIcon' in nativeProps(view, 'plain')).toBe(true);
    expect(keyOf(view, 'plain')).toBe('filled|medium|plain|||Publish');
  });

  it('separates a glyph from the no-glyph trigger it replaces', async () => {
    const withIcon = await render(
      <Menu
        title="Publish"
        group={GROUP}
        androidIcon="share"
        testID="with-icon"
      />
    );
    const without = await render(
      <Menu title="Publish" group={GROUP} testID="without" />
    );
    expect(keyOf(withIcon, 'with-icon')).not.toBe(keyOf(without, 'without'));
  });

  it("tells two glyphs apart, or one drawable gets the other's box", async () => {
    const share = await render(
      <Menu title="Publish" group={GROUP} androidIcon="share" testID="share" />
    );
    const star = await render(
      <Menu title="Publish" group={GROUP} androidIcon="star" testID="star" />
    );
    expect(keyOf(share, 'share')).not.toBe(keyOf(star, 'star'));
  });
});

/**
 * The top two rungs, which Menu did not have (item 4 again).
 *
 * `ButtonSize` grew to five rungs and `MenuProps.size` is that same type, so
 * `<Menu size="xlarge">` compiled, met the wrapper's own three-entry list, and was
 * quietly rewritten to `medium`: a 48 dp box answering to a name whose box is 96 dp.
 * `Menu.harness.tsx` ("the top of the ladder") measures the box; this catches the
 * rewrite where the rewrite happens.
 */
describe('Menu - the top of the ladder', () => {
  it.each(['xlarge', 'xxlarge'] as const)(
    'sends %s to native rather than falling back to medium',
    async (rung) => {
      const view = await render(
        <Menu title="Publish" group={GROUP} size={rung} testID="rung" />
      );
      expect(nativeProps(view, 'rung').size).toBe(rung);
      expect(keyOf(view, 'rung')).toBe(`filled|${rung}|plain|||Publish`);
    }
  );

  it('keeps the three rungs it already had', async () => {
    const view = await render(
      <Menu title="Publish" group={GROUP} size="small" testID="small" />
    );
    expect(nativeProps(view, 'small').size).toBe('small');
  });

  it('still falls back to medium for a rung that is not on the ladder', async () => {
    // The list is a guard against a value that arrives with no types at all, and it
    // has to keep working for whatever the caller actually passed.
    const view = await render(
      <Menu
        title="Publish"
        group={GROUP}
        size={'gigantic' as 'medium'}
        testID="junk"
      />
    );
    expect(nativeProps(view, 'junk').size).toBe('medium');
  });
});
