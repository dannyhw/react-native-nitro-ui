import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import { Menu, type MenuGroup } from '../components/Menu/Menu';

const GROUP: MenuGroup = {
  actions: [{ id: 'now', title: 'Now' }],
};

beforeEach(() => {
  // `useSizingId` asks the native core for an instance id.
  nitroUiHybridObjects.NitroUiCore = () => ({
    nextSizingId: () => 1,
  });
});

// Queries come off each test's own `render` result, not RTL's `screen`: some
// tests mount two Menus.
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
    // On Android a `primaryAction` makes a split trigger, which is wider than the
    // plain button, so the two must not share a cached size.
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
    expect(nativeProps(view, 'icon').androidIcon).toBe('share');
  });

  it('sends null when there is no glyph, and never an unset prop', async () => {
    // Always sent, with `null` for "no icon": a prop that disappears between
    // commits crashes (nitro#1184).
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
