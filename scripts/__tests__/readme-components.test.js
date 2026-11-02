/**
 * Does `README.md` show *every* component, with both platform screenshots?
 *
 * The first eight components each got an iOS/Android pair (`docs/images/
 * components/*.png`, PR #11). `AlertDialog` and `ConfirmationDialog` shipped
 * with a README section and no pictures, and nothing noticed, so the next
 * component would have done the same. The convention (CONTRIBUTING's "README
 * screenshots") therefore becomes a rule here, at `check` time, with no new
 * dependencies.
 *
 * For every component exported as a value from `src/index.ts` out of
 * `./components/*` it requires:
 *
 *   - a row in the README's Components table;
 *   - its name in the README's import block;
 *   - `<img src="docs/images/components/<kebab>-{ios,android}.png" ...>` in the
 *     README, rendered at the width the Usage tables use, with alt text;
 *   - that file on disk, a PNG of the documented width (804 px for iOS, 720 for
 *     Android), read from the IHDR chunk rather than from the filename.
 *
 * Two things keep the check honest: it fails when it finds nothing to compare
 * (an export regex that stopped matching would pass every later assertion
 * vacuously), and problems are collected and reported together, each naming the
 * component and what is missing, so one run lists a whole README round's work.
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/** The directory the README's pictures live in. */
const IMAGE_DIR = 'docs/images/components';

/**
 * Components with no screenshots, and why.
 *
 * `Host` is a container with no look of its own: on iOS it is a plain `View`
 * (D23), on Android one shared Compose composition for its children. A
 * screenshot of it is a screenshot of a control that already has its own pair.
 */
const SCREENSHOT_EXEMPTIONS = {
  Host: 'a container with no look of its own (iOS: a plain View; Android: one shared composition)',
};

/** The documented screenshot width(s), by file-name platform suffix. */
const WIDTHS = {
  // 804 px is two thirds of a 3x iPhone screenshot. 803 is accepted because the
  // first committed pair (`button-ios.png`) is 803 wide, one pixel short.
  ios: [804, 803],
  android: [720],
};

/** The width the README's Usage tables render every screenshot at. */
const README_IMG_WIDTH = '300';

/** The value exports from `./components/*` in `src/index.ts`, in source order. */
function exportedComponents(indexSource) {
  const names = new Set();
  const blocks = indexSource.matchAll(
    /export\s*\{([^}]*)\}\s*from\s*'\.\/components\/[^']+'/gs
  );
  for (const block of blocks) {
    for (const entry of block[1].split(',')) {
      const name = entry.trim();
      // `type SwitchProps` is a type export: a component is something you can
      // render, which is what needs a picture.
      if (name === '' || name.startsWith('type ') || name === 'type') continue;
      names.add(name);
    }
  }
  return [...names];
}

/** `SegmentedControl` -> `segmented-control`, the kebab id in a file name. */
function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * The component names with a row in the README's Components table.
 *
 * Scoped to that section on purpose: the Performance table has rows that start
 * the same way (`| \`Switch\` | 1.00× |`), and reading the whole file would let a
 * component disappear from the list of what the library ships as long as it is
 * still benched.
 */
function componentTableNames(readme) {
  const heading = /^## Components$/m.exec(readme);
  if (heading == null) return new Set();
  const rest = readme.slice(heading.index + heading[0].length);
  const next = /^## /m.exec(rest);
  const section = next == null ? rest : rest.slice(0, next.index);
  return new Set(
    [...section.matchAll(/^\|\s*`([A-Z]\w*)`\s*\|/gm)].map((match) => match[1])
  );
}

/**
 * The names inside the README's `import { ... } from 'react-native-nitro-ui'`
 * block. Only the specifier list is read, so a component mentioned in prose
 * does not count as imported.
 */
function importedNames(readme) {
  const names = new Set();
  for (const block of readme.matchAll(/```ts\n([\s\S]*?)```/g)) {
    const code = block[1];
    if (!code.includes("from 'react-native-nitro-ui'")) continue;
    for (const braces of code.matchAll(/import\s*\{([^}]*)\}/g)) {
      for (const entry of braces[1].split(',')) {
        const name = entry
          .replace(/^type\s+/, '')
          .trim()
          .split(/\s+as\s+/)[0];
        if (name !== '') names.add(name);
      }
    }
  }
  return names;
}

/**
 * The `<img>` tag in the README pointing at `file`, or `null` - the whole tag,
 * so its `width` and `alt` can be read off the same match.
 */
function imgTagFor(readme, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<img[^>]*src="${escaped}"[^>]*>`, 'i').exec(readme);
  return match ? match[0] : null;
}

/**
 * The size a PNG declares in its IHDR chunk, or a `problem` string when it is
 * not a readable PNG.
 *
 * Read from the chunk rather than a tool: the rule is about the bytes that
 * shipped, IHDR is fixed-offset, and that leaves the test dependency-free.
 */
function pngSize(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(24);
    if (fs.readSync(handle, header, 0, 24) < 24) {
      return { problem: 'is shorter than a PNG header (24 bytes)' };
    }
    if (header.toString('binary', 0, 4) !== '\u0089PNG') {
      return { problem: 'is not a PNG (bad signature)' };
    }
    if (header.toString('ascii', 12, 16) !== 'IHDR') {
      return { problem: 'is not a PNG (its first chunk is not IHDR)' };
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(handle);
  }
}

describe('the README shows every component with both screenshots', () => {
  const readme = read('README.md');
  const components = exportedComponents(read('src/index.ts'));

  it('finds both sides of the comparison, so it cannot pass by finding nothing', () => {
    // Eight controls plus two dialogs plus Host as of G11. The floor is low on
    // purpose: it catches a regex that stopped matching, not the size of the list.
    expect(components.length).toBeGreaterThanOrEqual(8);
    expect(componentTableNames(readme).size).toBeGreaterThanOrEqual(8);
    expect(importedNames(readme).size).toBeGreaterThanOrEqual(8);
  });

  it('exempts only components it really exports, each with a reason', () => {
    const problems = Object.entries(SCREENSHOT_EXEMPTIONS).flatMap(
      ([name, reason]) => {
        const found = [];
        if (reason == null || reason.trim() === '') {
          found.push(`${name}: exempt with no reason next to it`);
        }
        if (!components.includes(name)) {
          found.push(
            `${name}: exempt from screenshots but not exported from src/index.ts`
          );
        }
        return found;
      }
    );
    expect(problems).toEqual([]);
  });

  it('has a Components row, an import line and an img for every screenshot', () => {
    const rows = componentTableNames(readme);
    const imported = importedNames(readme);
    const problems = [];

    for (const name of components) {
      if (!rows.has(name)) {
        problems.push(`${name}: no row in the README's Components table`);
      }
      if (!imported.has(name)) {
        problems.push(`${name}: not named in the README's import block`);
      }
      if (name in SCREENSHOT_EXEMPTIONS) continue;

      for (const platform of Object.keys(WIDTHS)) {
        const file = `${IMAGE_DIR}/${kebab(name)}-${platform}.png`;
        const tag = imgTagFor(readme, file);
        if (tag == null) {
          problems.push(
            `${name}: the README has no <img src="${file}"> for ${platform}`
          );
          continue;
        }
        if (!tag.includes(`width="${README_IMG_WIDTH}"`)) {
          problems.push(
            `${name}: <img src="${file}"> is not rendered at width="${README_IMG_WIDTH}"`
          );
        }
        if (!/alt="[^"]{10,}"/.test(tag)) {
          problems.push(
            `${name}: <img src="${file}"> has no alt text saying what is shown`
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('ships each screenshot as a PNG of the documented width', () => {
    const problems = [];

    for (const name of components) {
      if (name in SCREENSHOT_EXEMPTIONS) continue;
      for (const [platform, widths] of Object.entries(WIDTHS)) {
        const relative = `${IMAGE_DIR}/${kebab(name)}-${platform}.png`;
        if (!fs.existsSync(path.join(root, relative))) {
          problems.push(`${name}: ${relative} does not exist`);
          continue;
        }
        const { width, problem } = pngSize(path.join(root, relative));
        if (problem != null) {
          problems.push(`${name}: ${relative} ${problem}`);
        } else if (!widths.includes(width)) {
          problems.push(
            `${name}: ${relative} is ${width} px wide, and the convention ` +
              `says ${widths.join(' or ')} for ${platform}`
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
