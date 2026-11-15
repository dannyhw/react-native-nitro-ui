import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AssetRegistry, NativeModules } from 'react-native';
import { render, type RenderResult } from '@testing-library/react-native';

import { nitroUiHybridObjects } from '../../__mocks__/react-native-nitro-modules';
import {
  normalizeAndroidIconName,
  resetAndroidIconNameWarningsForTests,
} from '../iconName';
import { resetAndroidIconSourceForTests } from '../iconSource';
import { Chip } from '../components/Chip/Chip';
import { ContextMenu } from '../components/ContextMenu/ContextMenu';
import { Menu } from '../components/Menu/Menu';
import {
  flattenGroup,
  type MenuGroup,
  type MenuSubmenu,
} from '../components/Menu/MenuRows';

/** Register an asset the way Metro's transformer does, and return its id. */
function registerIcon(name: string, type: string): number {
  return AssetRegistry.registerAsset({
    fileSystemLocation: '/app/src/assets/icons',
    httpServerLocation: '/src/assets/icons',
    width: undefined,
    height: undefined,
    scales: [1],
    hash: `hash-of-${name}`,
    name,
    type,
  });
}

/** Run `body` with a dev-server-backed bundle, so an asset resolves to a `url:` string. */
function withDevServer(body: () => Promise<void>): Promise<void> {
  const sourceCode = NativeModules as { SourceCode?: unknown };
  const previous = sourceCode.SourceCode;
  sourceCode.SourceCode = {
    getConstants: () => ({
      scriptURL: 'http://10.0.2.2:8081/index.bundle?platform=android',
    }),
  };
  resetAndroidIconSourceForTests();
  return body().finally(() => {
    sourceCode.SourceCode = previous;
    resetAndroidIconSourceForTests();
  });
}

function nativeProps(
  view: RenderResult,
  testId: string
): Record<string, unknown> {
  return view.getByTestId(testId).props as unknown as Record<string, unknown>;
}

/** Run `body` with `console.warn` captured, and return the lines it wrote. */
function capturedWarnings(body: () => void): string[] {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    body();
  } finally {
    // Read before restoring: `mockRestore` clears the recorded calls with the spy.
  }
  const lines = warn.mock.calls.map((call) => String(call[0]));
  warn.mockRestore();
  return lines;
}

/** `capturedWarnings` for an asynchronous body. */
async function capturedWarningsAsync(
  body: () => Promise<void>
): Promise<string[]> {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await body();
  } finally {
    // nothing
  }
  const lines = warn.mock.calls.map((call) => String(call[0]));
  warn.mockRestore();
  return lines;
}

beforeEach(() => {
  nitroUiHybridObjects.NitroUiCore = () => ({ nextSizingId: () => 1 });
  resetAndroidIconNameWarningsForTests();
});

describe('menu rows - androidIcon on the wire', () => {
  it('sends the field on every row, including the ones that have no icon', async () => {
    // A struct array with a member missing from one row crashes (nitro#1184).
    const group: MenuGroup = {
      actions: [
        { id: 'share', title: 'Share', androidIcon: 'share' },
        {
          id: 'move',
          title: 'Move To',
          items: [],
          // A cast or plain JS can still put an icon on a submenu, whose row has
          // no leading slot on either platform. `flattenGroup` must answer `null`.
          ...({ androidIcon: 'folder' } as Record<string, unknown>),
        },
      ],
      sections: [
        { id: 'more', title: 'More', items: [{ id: 'copy', title: 'Copy' }] },
      ],
    };
    // The type refuses the field too: the directive below only compiles because
    // `MenuSubmenu` has no `androidIcon`.
    const forced: MenuSubmenu = {
      id: 'x',
      title: 'X',
      items: [],
      // @ts-expect-error MenuSubmenu has no androidIcon, on purpose.
      androidIcon: 'folder',
    };
    // The object still carries the field at runtime.
    expect('androidIcon' in forced).toBe(true);

    const rows = flattenGroup(group);
    // the action, the submenu parent, the section header, the row inside the section
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(Object.prototype.hasOwnProperty.call(row, 'androidIcon')).toBe(
        true
      );
      // Never `undefined`: `null` is the answer for "no icon".
      expect(row.androidIcon === undefined).toBe(false);
    }
    expect(rows.map((row) => row.androidIcon)).toEqual([
      'share',
      // A submenu's own row has no leading slot on either platform, so the name
      // it was given is dropped.
      null,
      // A section header has no icon on either platform, so it is sent none.
      null,
      null,
    ]);
  });

  it('resolves an asset to the dev-server string and never sends the id', async () => {
    const share = registerIcon('share_24px', 'xml');
    await withDevServer(async () => {
      const rows = flattenGroup({
        actions: [{ id: 'share', title: 'Share', androidIcon: share }],
      });
      const sent = rows[0]?.androidIcon ?? '';
      expect(sent.startsWith('url:http')).toBe(true);
      expect(sent).toContain('/src/assets/icons/share_24px');
      // Asset ids are renumbered by every build. Registering the same file again
      // mints a second id, and both ids must resolve to one string.
      const again = registerIcon('share_24px', 'xml');
      expect(again).not.toBe(share);
      const twice = flattenGroup({
        actions: [{ id: 'share', title: 'Share', androidIcon: again }],
      })[0]?.androidIcon;
      expect(twice).toBe(sent);
    });
  });

  it('normalises a typed name and refuses to draw one that cannot be a resource', async () => {
    const rows = flattenGroup({
      actions: [
        { id: 'a', title: 'A', androidIcon: 'Share' },
        { id: 'b', title: 'B', androidIcon: 'Share Icon' },
      ],
    });
    // A name is normalised, so `"Share"` and `"share"` are one lookup.
    expect(rows[0]?.androidIcon).toBe('share');
    // A name with a space can never be a resource name. It is still sent, and
    // native draws nothing for it.
    expect(rows[1]?.androidIcon).toBe(normalizeAndroidIconName('Share Icon'));
  });

  it('names the control that asked when a row name cannot work', async () => {
    // Menu and ContextMenu share the resolver, so the warning must name the one
    // that asked.
    const lines = capturedWarnings(() => {
      flattenGroup({
        actions: [{ id: 'a', title: 'A', androidIcon: 'Share Icon' }],
      });
      flattenGroup(
        { actions: [{ id: 'b', title: 'B', androidIcon: 'Move To' }] },
        'ContextMenu'
      );
    });
    expect(
      lines.some((line) => line.includes("nitro-ui: Menu's androidIcon"))
    ).toBe(true);
    expect(
      lines.some((line) => line.includes("nitro-ui: ContextMenu's androidIcon"))
    ).toBe(true);
  });

  it('hands native a new array when only a row icon changed', async () => {
    // `useMenuRows` caches one array per menu, keyed by a signature of every
    // field it sends, so the icon has to be part of that signature.
    const view = await render(
      <Menu
        title="Actions"
        group={{ actions: [{ id: 'a', title: 'A', androidIcon: 'share' }] }}
        testID="m"
        onSelect={undefined}
      />
    );
    const rowsOf = () =>
      nativeProps(view, 'm').rows as Array<Record<string, unknown>>;
    expect(rowsOf()[0]?.androidIcon).toBe('share');
    await view.rerender(
      <Menu
        title="Actions"
        group={{ actions: [{ id: 'a', title: 'A', androidIcon: 'star' }] }}
        testID="m"
        onSelect={undefined}
      />
    );
    expect(rowsOf()[0]?.androidIcon).toBe('star');
  });

  it('reaches the native view through Menu, and through ContextMenu named as itself', async () => {
    const group: MenuGroup = {
      actions: [{ id: 'share', title: 'Share', androidIcon: 'Share Icon' }],
    };
    let menuRows: Array<Record<string, unknown>> = [];
    let contextRows: Array<Record<string, unknown>> = [];
    const lines = await capturedWarningsAsync(async () => {
      const menu = await render(
        <Menu
          title="Actions"
          group={group}
          testID="menu"
          onSelect={undefined}
        />
      );
      const context = await render(
        <ContextMenu group={group} testID="ctx">
          <></>
        </ContextMenu>
      );
      menuRows = nativeProps(menu, 'menu').rows as Array<
        Record<string, unknown>
      >;
      contextRows = nativeProps(context, 'ctx').rows as Array<
        Record<string, unknown>
      >;
    });
    const bad = normalizeAndroidIconName('Share Icon');
    expect(menuRows[0]?.androidIcon).toBe(bad);
    expect(contextRows[0]?.androidIcon).toBe(bad);
    // The prefix is spelled out because "ContextMenu's androidIcon" contains
    // "Menu's androidIcon": a substring test that ignores that counts one line twice.
    expect(
      lines.filter((line) => line.includes("nitro-ui: Menu's androidIcon"))
    ).toHaveLength(1);
    expect(
      lines.filter((line) =>
        line.includes("nitro-ui: ContextMenu's androidIcon")
      )
    ).toHaveLength(1);
  });
});

describe('Chip - androidIcon', () => {
  const keyOf = (view: RenderResult, testId: string): string =>
    String(nativeProps(view, testId).nuiSizingKey);

  it('is always sent, and joins the size configuration as the resolved string', async () => {
    const view = await render(
      <Chip label="Filter" variant="assist" androidIcon="Share" testID="chip" />
    );
    const props = nativeProps(view, 'chip');
    expect(props.androidIcon).toBe('share');
    // The key is `variant|selected|systemImage|androidIcon|label`.
    expect(keyOf(view, 'chip')).toBe('assist|0||share|Filter');
  });

  it('tells no icon from an icon that cannot be one, and two icons apart', async () => {
    const share = registerIcon('share_24px', 'xml');
    const star = registerIcon('star_24px', 'xml');
    const photo = registerIcon('photo', 'png');
    await withDevServer(async () => {
      const withShare = await render(
        <Chip label="F" androidIcon={share} testID="a" />
      );
      const withStar = await render(
        <Chip label="F" androidIcon={star} testID="b" />
      );
      const withPhoto = await render(
        <Chip label="F" androidIcon={photo} testID="c" />
      );
      const withNone = await render(<Chip label="F" testID="d" />);
      const keyShare = keyOf(withShare, 'a');
      expect(keyShare).toContain('/src/assets/icons/share_24px');
      expect(keyShare).not.toBe(keyOf(withStar, 'b'));
      // A `.png` is not an icon, so native is sent none and the key must equal
      // the no-icon key.
      expect(keyOf(withPhoto, 'c')).toBe(keyOf(withNone, 'd'));
      expect(keyShare).not.toBe(keyOf(withNone, 'd'));
    });
  });

  it('escapes the icon field so a name cannot forge a configuration', async () => {
    // Unescaped, `b|c` would read as two fields and collide with another chip.
    const forged = await render(
      <Chip label="x" systemImage="a" androidIcon="b|c" testID="forged" />
    );
    const real = await render(
      <Chip label="x" variant="assist" systemImage="a" testID="real" />
    );
    const key = keyOf(forged, 'forged');
    expect(key).not.toBe(keyOf(real, 'real'));
    expect(key).toContain('b\\|c');
  });
});
