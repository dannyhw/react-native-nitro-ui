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
import { flattenGroup, type MenuGroup } from '../components/Menu/MenuRows';

/*
 * Wrapper-level tests for `androidIcon` on menu rows and chips (G21).
 *
 * The device harness proves a glyph reaches the screen; these prove what the wrapper
 * hands native to ask for it, which no pixel can show:
 *
 *  - every row carries the field, always (`null` included). A row that omits a prop is
 *    the nitro#1184 crash, and a row is a *struct member*, so one row forgetting it
 *    takes down the whole array;
 *  - the asset id never crosses the bridge. An id is per-bundle, so a row that sent one
 *    would name a different file in the next build, and a list of twenty would send
 *    twenty ids where it should send twenty strings;
 *  - the warning names the control. `Menu` and `ContextMenu` share this code and both
 *    apps' lists use both, so "Menu's androidIcon" pointing at a context menu sends
 *    someone to the wrong component's docs;
 *  - the Chip's size configuration holds the resolved string, not the asset id
 *    (`buttonSizingKey.test.tsx` makes that argument for the Button; the Chip is the
 *    same cache with a different field order).
 */

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

/**
 * Run [body] with a dev-server-backed bundle, so an asset resolves to a `url:` string.
 *
 * The dev answer is the one a harness device sees; `iconSource.test.ts` covers the
 * release answer for the same resolver, so this file only needs one of the two.
 */
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

/** Run [body] with `console.warn` captured, and return the lines it wrote. */
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

/** [[capturedWarnings]] for a body that renders, which is asynchronous here. */
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
    // The nitro#1184 rule, per row: a struct array with one member missing is a crash,
    // not an omitted prop. `flattenGroup` is the only writer of that array.
    const group: MenuGroup = {
      actions: [
        { id: 'share', title: 'Share', androidIcon: 'share' },
        { id: 'move', title: 'Move To', androidIcon: 'folder', items: [] },
      ],
      sections: [
        { id: 'more', title: 'More', items: [{ id: 'copy', title: 'Copy' }] },
      ],
    };
    const rows = flattenGroup(group);
    // the action, the submenu parent, the section header, the row inside the section
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(Object.prototype.hasOwnProperty.call(row, 'androidIcon')).toBe(
        true
      );
      // The one thing a struct array may not do is omit a member (nitro#1184), so the
      // claim is "never `undefined`" - `null` is the answer for "no icon", and iOS's
      // getter needs the field either way.
      expect(row.androidIcon === undefined).toBe(false);
    }
    expect(rows.map((row) => row.androidIcon)).toEqual([
      'share',
      // A submenu parent's name travels too: iOS draws it on the parent row, and
      // Android resolves only the rows it has a slot for. Which platform wants the
      // string is not this function's decision.
      'folder',
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
      // The id is per-bundle - it is Metro's registry index, renumbered by the next
      // build - so a string built from it would name a different file after a rebuild.
      // Registering the same file again mints a second id for one name and hash: if the
      // id were in the string, the two would disagree.
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
    // A name is normalised (case is not a resource-table distinction) rather than sent
    // as typed, so `"Share"` and `"share"` are one lookup, not two.
    expect(rows[0]?.androidIcon).toBe('share');
    // A name with a space can never be a resource name. It still crosses as the string
    // the caller wrote - native answers `0` for it and draws nothing - because the
    // wrapper's job is to say so, not to invent a different prop.
    expect(rows[1]?.androidIcon).toBe(normalizeAndroidIconName('Share Icon'));
    // ...and it is a name the resource table could never hold, which is why the wrapper
    // also says so (the next test).
  });

  it('names the control that asked when a row name cannot work', async () => {
    // The same resolver runs for both menus, so the warning has to know which one it is
    // in: a line that says "Menu's androidIcon" about a context menu sends the reader to
    // the wrong component's docs.
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
    // `useMenuRows` keeps one array per described menu, keyed by a signature of every
    // field it sends - so the icon has to be in that signature. A menu that changes only
    // an icon and answers with the cached array is a popup that redraws the previous
    // glyph, and nothing else in the tree notices: the rows prop is identical, so no
    // prop diff, no new layout, no test that reads a box can see it.
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
    // The key is `variant|selected|systemImage|androidIcon|label`: an icon widens a
    // chip on whichever platform draws it, so a chip with a glyph must not inherit the
    // cached width of a chip without one.
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
      // A `.png` is not an icon on either path, so native is told nothing - and the key
      // has to agree with what native is told, or a control is measured for a glyph it
      // will never draw.
      expect(keyOf(withPhoto, 'c')).toBe(keyOf(withNone, 'd'));
      expect(keyShare).not.toBe(keyOf(withNone, 'd'));
    });
  });

  it('escapes the icon field so a name cannot forge a configuration', async () => {
    // `a|b` is not a resource name, but it is a string that reaches the key. Unescaped,
    // it would read as two fields and collide with a different chip.
    const forged = await render(
      <Chip label="x" systemImage="a" androidIcon="b|c" testID="forged" />
    );
    const real = await render(
      <Chip label="x" variant="assist" systemImage="a" testID="real" />
    );
    const key = keyOf(forged, 'forged');
    expect(key).not.toBe(keyOf(real, 'real'));
    // The separator inside the name comes out escaped, which is what keeps it one field
    // - splitting the key naively on `|` finding an unescaped separator is the failure.
    expect(key).toContain('b\\|c');
  });
});
