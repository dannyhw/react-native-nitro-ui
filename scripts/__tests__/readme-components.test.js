import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const IMAGE_DIR = 'docs/images/components';

const SCREENSHOT_EXEMPTIONS = {
  Host: 'a container with no look of its own (iOS: a plain View; Android: one shared composition)',
};

const WIDTHS = {
  // 804 px is two thirds of a 3x iPhone screenshot. 803 is accepted because
  // `button-ios.png` is one pixel short.
  ios: [804, 803],
  android: [720],
};

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
      // `type SwitchProps` is a type export, not a component.
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
 * The component names with a row in the README's Components table. Scoped to
 * that section: rows of the Performance table start the same way.
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
    // The floor is low on purpose: it catches a regex that stopped matching, not
    // the size of the list.
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
