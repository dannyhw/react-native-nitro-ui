/**
 * The example tab bar's touch-target rule (X19), its iOS log parser, and the tab list it
 * reads from `example/src/App.tsx`.
 *
 * The rule's fixtures do not coincide with the right answer: the "old bar" fixture is the
 * size the 15-tab shared row actually measured on the lease's Pixel 9 (G16's `tab-picker`,
 * 61 x 74 px at 2.625x = 23.2 x 28.2 dp), and the edge cases sit either side of the
 * one-pixel slack rather than on the minimum itself.
 *
 * @file
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import {
  TAB_TARGET_MIN,
  checkTabTargets,
  exampleTabs,
  parseIosTabTargets,
} from '../real-input/tab-targets.mjs';
import {
  MANIFEST_BASENAME,
  manifestsFromEntries,
  regionsFor,
  renderedTabs,
  replaceRegion,
} from '../registry-core.mjs';

const repoRoot = resolve(process.cwd());
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const APP = 'example/src/App.tsx';

/** @param {Array<[string, number, number, boolean?]>} rows id, width, height, reached */
const measuredOf = (rows) =>
  new Map(
    rows.map(([id, width, height, reached = true]) => [
      id,
      { width, height, reached },
    ])
  );

const ANDROID_PX = 1 / 2.625;

describe('exampleTabs', () => {
  it('reads every tab App.tsx renders, in bar order, plus the hand-written Host tab', () => {
    const text = read(APP);
    const tabs = exampleTabs(text);
    const ids = tabs.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { tab } of renderedTabs(text)) expect(ids).toContain(tab);
    expect(ids).toContain('host');
    expect(ids[0]).toBe('switch');
    for (const tab of tabs) expect(tab.label).not.toBe('');
  });

  it('answers nothing for a file with no TABS array, so the rule can say so', () => {
    expect(exampleTabs('const OTHER = [];')).toEqual([]);
    expect(exampleTabs(null)).toEqual([]);
  });

  it('picks up tabs the registry adds, so the next components need no edit here', () => {
    // SearchField and Tooltip were the next two components (X19 brief). Their tabs are
    // written into App.tsx by the same region `bun run regen` rewrites; the rule has to
    // see them from that output alone. A component that has landed since (Tooltip, G18)
    // is read from its own manifest rather than invented a second time, which the
    // registry would refuse as a duplicate.
    const dirs = readdirSync(join(repoRoot, 'src/components'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const entries = dirs
      .map((directory) => {
        try {
          return {
            directory,
            text: read(`src/components/${directory}/${MANIFEST_BASENAME}`),
          };
        } catch {
          return null;
        }
      })
      .filter((entry) => entry != null);
    const chip = JSON.parse(read(`src/components/Chip/${MANIFEST_BASENAME}`));
    const fresh = (name, tab, label) => {
      const manifest = {
        ...chip,
        name,
        hybridView: `NitroUi${name}`,
        implementation: `HybridNitroUi${name}`,
        id: tab,
        exampleTab: tab,
        exampleLabel: label,
      };
      delete manifest.exports;
      return { directory: name, text: JSON.stringify(manifest) };
    };
    const invented = [
      fresh('SearchField', 'searchfield', 'Search'),
      fresh('Tooltip', 'tooltip', 'Tooltip'),
    ].filter((entry) => !dirs.includes(entry.directory));
    const manifests = manifestsFromEntries([...entries, ...invented]);
    const region = regionsFor(manifests).find(
      (spec) => spec.path === APP && spec.describe === 'TABS'
    );
    const written = replaceRegion(read(APP), region);
    expect(written.problems).toEqual([]);
    const tabs = exampleTabs(written.content);
    expect(tabs).toEqual(
      expect.arrayContaining([
        { id: 'searchfield', label: 'Search' },
        { id: 'tooltip', label: 'Tooltip' },
      ])
    );
    // And the hand-written Host entry after the region is still read.
    expect(tabs.at(-1)?.id).toBe('host');
  });
});

describe('the tab bar App.tsx draws', () => {
  it('sizes its tabs from the same minimums the rule holds them to', () => {
    const text = read(APP);
    const select =
      /const TAB_MIN = Platform\.select\(\{ android: (\d+), default: (\d+) \}\);/.exec(
        text
      );
    expect(select).not.toBeNull();
    expect({ android: Number(select?.[1]), ios: Number(select?.[2]) }).toEqual(
      TAB_TARGET_MIN
    );
    expect(text).toMatch(/minWidth: TAB_MIN,\n\s+minHeight: TAB_MIN,/);
  });

  it('scrolls sideways instead of sharing one row between every tab', () => {
    const text = read(APP);
    expect(text).toMatch(/<ScrollView\n\s+horizontal\n/);
    // `flex: 1` on a tab is the shared row that shrank every tab with each component.
    const tabStyle = /\n {2}tab: \{([^}]*)\}/.exec(text)?.[1] ?? '';
    expect(tabStyle).not.toMatch(/flex: 1/);
  });
});

describe('checkTabTargets', () => {
  const tabs = [
    { id: 'switch', label: 'Switch' },
    { id: 'picker', label: 'Picker' },
    { id: 'host', label: 'Host' },
  ];

  it('fails every tab of the old shared row (23 x 28 dp on a Pixel 9)', () => {
    const verdicts = checkTabTargets({
      platform: 'android',
      tabs,
      measured: measuredOf(tabs.map((tab) => [tab.id, 61 / 2.625, 74 / 2.625])),
      pixel: ANDROID_PX,
    });
    expect(verdicts.map((v) => v.ok)).toEqual([false, false, false]);
    expect(verdicts[1].line).toMatch(
      /tab "Picker" \(tab-picker\) is 23\.2 × 28\.2 dp — too narrow and too short for the 48 dp minimum/
    );
  });

  it('passes tabs at or above the minimum, and one device pixel under it', () => {
    const verdicts = checkTabTargets({
      platform: 'android',
      tabs,
      // 125 px at 2.625x is 47.6 dp: one pixel of rounding, not a smaller tab.
      measured: measuredOf([
        ['switch', 71.2, 48],
        ['picker', 125 / 2.625, 125 / 2.625],
        ['host', 60, 52],
      ]),
      pixel: ANDROID_PX,
    });
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });

  it('fails a tab two pixels short in one direction, and says which', () => {
    const [verdict] = checkTabTargets({
      platform: 'android',
      tabs: tabs.slice(0, 1),
      measured: measuredOf([['switch', 80, 124 / 2.625]]),
      pixel: ANDROID_PX,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toMatch(/too short for the 48 dp/);
    expect(verdict.line).not.toMatch(/narrow/);
  });

  it('holds iOS to 44 pt, not 48', () => {
    const verdicts = checkTabTargets({
      platform: 'ios',
      tabs: tabs.slice(0, 2),
      measured: measuredOf([
        ['switch', 66, 44],
        ['picker', 66, 43.5],
      ]),
      pixel: 1 / 3,
    });
    expect(verdicts.map((v) => v.ok)).toEqual([true, false]);
    expect(verdicts[1].line).toMatch(/too short for the 44 pt minimum/);
    expect(TAB_TARGET_MIN).toEqual({ android: 48, ios: 44 });
  });

  it('fails a tab that was never measured, or never scrolled wholly on screen', () => {
    const verdicts = checkTabTargets({
      platform: 'android',
      tabs,
      measured: measuredOf([
        ['switch', 80, 48],
        ['picker', 30, 48, false],
      ]),
      pixel: ANDROID_PX,
    });
    expect(verdicts.map((v) => v.ok)).toEqual([true, false, false]);
    expect(verdicts[1].line).toMatch(
      /could not be brought wholly inside the window/
    );
    expect(verdicts[2].line).toMatch(
      /tab "Host" \(tab-host\) was never measured/
    );
  });

  it('fails a drawn tab the app does not list, and an app with no tabs at all', () => {
    const extra = checkTabTargets({
      platform: 'ios',
      tabs: tabs.slice(0, 1),
      measured: measuredOf([
        ['switch', 80, 44],
        ['tooltip', 80, 44],
      ]),
      pixel: 1 / 3,
    });
    expect(extra.map((v) => [v.id, v.ok])).toEqual([
      ['switch', true],
      ['tooltip', false],
    ]);
    const none = checkTabTargets({
      platform: 'ios',
      tabs: [],
      measured: new Map(),
      pixel: 1 / 3,
    });
    expect(none).toHaveLength(1);
    expect(none[0].ok).toBe(false);
  });
});

describe('parseIosTabTargets', () => {
  it('reads the lines the Swift pass prints, last line per tab winning', () => {
    const log = [
      "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputTabTargets]' started.",
      'real-input tab-target id=tab-switch | frame=4.0,62.0,71.3,44.0 | reached=true',
      't =    12.00s Tap',
      'real-input tab-target id=tab-host | frame=402.0,62.0,60.0,44.0 | reached=false',
      'real-input tab-target id=tab-host | frame=338.0,62.0,60.0,44.0 | reached=true',
      'real-input tab-target id=tab-picker | frame=-12.5,62.0,24.3,28.0 | reached=true',
    ].join('\n');
    expect(parseIosTabTargets(log)).toEqual(
      new Map([
        ['switch', { width: 71.3, height: 44, reached: true }],
        ['host', { width: 60, height: 44, reached: true }],
        ['picker', { width: 24.3, height: 28, reached: true }],
      ])
    );
  });

  it('matches the format RealInputTests.swift prints', () => {
    const swift = read(
      'example/ios/NitroUiExampleUITests/RealInputTests.swift'
    );
    expect(swift).toContain('func testRealInputTabTargets()');
    expect(swift).toContain('"real-input tab-target id=\\(id) | frame="');
    expect(swift).toContain('format: "%.1f,%.1f,%.1f,%.1f"');
    expect(swift).toContain('" | reached=\\(reached)"');
  });
});
