#!/usr/bin/env node
/**
 * The library's own Android icons, copied unchanged from Google's Material Symbols.
 *
 *   node scripts/icons/fetch-material-symbols.mjs            # download, write, record hashes
 *   node scripts/icons/fetch-material-symbols.mjs --verify   # download, compare, write nothing
 *
 * D43 item 1: no glyph path is typed by hand. Every icon the library draws itself is
 * one of Google's official Material Symbols Android vector drawables (Apache 2.0),
 * fetched from Google's own repository at a pinned commit and written byte for byte,
 * so the only thing a reviewer has to trust is the URL. The Apache 2.0 text comes from
 * the same commit.
 *
 * The output is committed and nothing downloads at build time. `material-symbols.lock.json`
 * records each file's source URL and SHA-256, and `scripts/__tests__/android-icons.test.js`
 * fails `check` when a shipped file no longer matches its hash - so a hand edit to a
 * coordinate cannot pass - or when a drawable appears that this list did not write.
 *
 * Adding an icon: add a row to `ICONS`, run this script, and use the resource through
 * `nitroUiIcon` (`android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiIcons.kt`).
 * The variant is Material Symbols Outlined, weight 400, fill 0, grade 0, 24 px (the
 * `<name>_24px.xml` file), unless the Material component the icon belongs to uses
 * another one; say so in the row's `why`.
 *
 * The download is treated as data: this script writes the bytes and runs nothing.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '../..');

/** Google's Material Symbols repository, pinned so a rerun writes the same bytes. */
const REPO = 'google/material-design-icons';
const COMMIT = '10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7';

/** Where the library's resources live; the `nitroui_` prefix keeps them out of an app's way. */
const DRAWABLE_DIR = 'android/src/main/res/drawable';

/** The Apache 2.0 text the icons are distributed under, from the same commit. */
const LICENSE_FILE = 'licenses/material-symbols/LICENSE';

/** The committed record of what was written. */
const LOCK_FILE = 'scripts/icons/material-symbols.lock.json';

/**
 * Every icon the library draws itself.
 *
 * `symbol` is the Material Symbols name, `style` the font family directory, and `file`
 * the variant: `<symbol>_24px.xml` is weight 400, fill 0, grade 0 at 24 px.
 */
const ICONS = [
  {
    resource: 'nitroui_search',
    symbol: 'search',
    style: 'materialsymbolsoutlined',
    file: 'search_24px.xml',
    why: "SearchField's leading glyph (the M3 search bar's leading icon)",
  },
  {
    resource: 'nitroui_close',
    symbol: 'close',
    style: 'materialsymbolsoutlined',
    file: 'close_24px.xml',
    why: "SearchField's clear button (the M3 search bar's trailing icon)",
  },
  {
    resource: 'nitroui_check',
    symbol: 'check',
    style: 'materialsymbolsoutlined',
    file: 'check_24px.xml',
    why: "the leading check of a selected filter Chip, a checked Menu row and Picker's selected row",
  },
  {
    resource: 'nitroui_keyboard_arrow_down',
    symbol: 'keyboard_arrow_down',
    style: 'materialsymbolsoutlined',
    file: 'keyboard_arrow_down_24px.xml',
    why: "the split button's trailing chevron (the icon Material's split button uses)",
  },
];

const rawUrl = (repoPath) =>
  `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${repoPath}`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Every file this script owns: `[repoPath, outPath]`. */
function targets() {
  return [
    ...ICONS.map((icon) => ({
      url: rawUrl(`symbols/android/${icon.symbol}/${icon.style}/${icon.file}`),
      out: `${DRAWABLE_DIR}/${icon.resource}.xml`,
      icon,
    })),
    { url: rawUrl('LICENSE'), out: LICENSE_FILE, icon: null },
  ];
}

async function download(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const verify = process.argv.includes('--verify');
  const files = [];
  const problems = [];
  for (const target of targets()) {
    const bytes = await download(target.url);
    if (target.icon != null && !bytes.toString('utf8').includes('<vector')) {
      throw new Error(`${target.url}: not an Android vector drawable`);
    }
    const absolute = path.join(root, target.out);
    if (verify) {
      const onDisk = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
      if (onDisk == null || !onDisk.equals(bytes)) {
        problems.push(`${target.out} differs from ${target.url}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    files.push({
      path: target.out,
      url: target.url,
      sha256: sha256(bytes),
      ...(target.icon == null
        ? {}
        : {
            symbol: target.icon.symbol,
            style: target.icon.style,
            why: target.icon.why,
          }),
    });
  }
  if (verify) {
    if (problems.length > 0) {
      console.error(`fetch-material-symbols: ${problems.join('\n')}`);
      process.exit(1);
    }
    console.log(
      `fetch-material-symbols: ${targets().length} files match ${REPO}@${COMMIT}`
    );
    return;
  }
  const lock = {
    note: 'Written by scripts/icons/fetch-material-symbols.mjs; do not edit by hand.',
    source: `https://github.com/${REPO}`,
    commit: COMMIT,
    license: 'Apache-2.0',
    files,
  };
  fs.writeFileSync(
    path.join(root, LOCK_FILE),
    `${JSON.stringify(lock, null, 2)}\n`
  );
  console.log(
    `fetch-material-symbols: wrote ${files.length} files from ${REPO}@${COMMIT}`
  );
}

main().catch((error) => {
  console.error(`fetch-material-symbols: ${error.message}`);
  process.exit(1);
});
