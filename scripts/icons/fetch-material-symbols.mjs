#!/usr/bin/env node
/**
 * Copies the library's Android icons, unchanged, from Google's Material Symbols repository
 * at a pinned commit, and records each file's source URL and SHA-256 in the lock file.
 *
 *   node scripts/icons/fetch-material-symbols.mjs            # download, write, record hashes
 *   node scripts/icons/fetch-material-symbols.mjs --verify   # download, compare, write nothing
 *
 * To add an icon, add a row to `ICONS` and run this script. The default variant is Outlined,
 * weight 400, fill 0, grade 0, 24 px (`<name>_24px.xml`).
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

const LOCK_FILE = 'scripts/icons/material-symbols.lock.json';

/**
 * The same upstream files fetched for the example app's test fixtures, recorded under the
 * lock's `exampleFiles` because they do not ship in the package.
 *
 * `star_24px.xml` and `nitroui_test_star.xml` are the same file twice on purpose: one is
 * bundled by Metro and the other compiled into the APK, so a test can compare the two paths.
 */
const EXAMPLE_ICONS = [
  {
    out: 'example/src/assets/icons/star_24px.xml',
    symbol: 'star',
    style: 'materialsymbolsoutlined',
    file: 'star_24px.xml',
    why: 'the Metro asset the Button and Menu harnesses require, and the file docs/components/button.md shows an app requiring',
  },
  {
    out: 'example/src/assets/icons/share_24px.xml',
    symbol: 'share',
    style: 'materialsymbolsoutlined',
    file: 'share_24px.xml',
    why: 'a second upstream file, whose path fills the same 960-unit viewport differently from star: two icons in one row prove an icon slot comes from the size ladder and not from the artwork',
  },
  {
    out: 'example/src/assets/icons/close_24px.xml',
    symbol: 'close',
    style: 'materialsymbolsoutlined',
    file: 'close_24px.xml',
    why: 'a 2 dp diagonal stroke, which is what shows up a glyph drawn at the wrong size: the sharpness case in example/__tests__/Button.harness.tsx measures it. Loaded by no other test, so its file arrives cold',
  },
  {
    out: 'example/android/app/src/main/res/drawable/nitroui_test_close.xml',
    symbol: 'close',
    style: 'materialsymbolsoutlined',
    file: 'close_24px.xml',
    why: 'the same 2 dp glyph as a compiled drawable, so the release form and the development form of one glyph can be probed against each other at the same size',
  },
  {
    out: 'example/android/app/src/main/res/drawable/nitroui_test_star.xml',
    symbol: 'star',
    style: 'materialsymbolsoutlined',
    file: 'star_24px.xml',
    why: "the resource-name form: the star above, compiled into the example APK, so a test can measure the release build's artwork against the development one",
  },
  {
    out: 'example/src/assets/icons/notifications_24px.xml',
    symbol: 'notifications',
    style: 'materialsymbolsoutlined',
    file: 'notifications_24px.xml',
    why: 'the bell the ListItem stories and the README sample draw: the Android twin of the SF Symbol `bell`, so one row shows one glyph on both platforms (G30 round 1)',
  },
  {
    out: 'example/android/app/src/main/res/drawable/nitroui_test_notifications.xml',
    symbol: 'notifications',
    style: 'materialsymbolsoutlined',
    file: 'notifications_24px.xml',
    why: 'the same bell as a compiled drawable, which is the form the ListItem story names — stories are photographed for docs/images/',
  },
  {
    out: 'example/src/assets/icons/person_24px.xml',
    symbol: 'person',
    style: 'materialsymbolsoutlined',
    file: 'person_24px.xml',
    why: "the person the README's `list-item-in-form` sample draws: the Android twin of `person.crop.circle`, which that example had on iOS alone",
  },
  {
    out: 'example/src/assets/icons/archive_24px.xml',
    symbol: 'archive',
    style: 'materialsymbolsoutlined',
    file: 'archive_24px.xml',
    why: "the box the README's disabled `ListItem` draws: the Android twin of `tray.and.arrow.down`, the other half-drawn glyph in that sample",
  },
  {
    out: 'example/android/app/src/main/res/drawable/nitroui_test_lock.xml',
    symbol: 'lock',
    style: 'materialsymbolsoutlined',
    file: 'lock_24px.xml',
    why: "the lock the ListItem story's disabled row draws: the Android twin of the SF Symbol `lock`, which that row had on iOS alone",
  },
];

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
    resource: 'nitroui_chevron_right',
    symbol: 'chevron_right',
    style: 'materialsymbolsoutlined',
    file: 'chevron_right_24px.xml',
    why: "a Form.Row's `disclosure` accessory (the Android twin of UIKit's `UICellAccessory.disclosureIndicator`)",
  },
  {
    resource: 'nitroui_keyboard_arrow_down',
    symbol: 'keyboard_arrow_down',
    style: 'materialsymbolsoutlined',
    file: 'keyboard_arrow_down_24px.xml',
    why: "the split button's trailing chevron (the icon Material's split button uses)",
  },
  {
    resource: 'nitroui_remove',
    symbol: 'remove',
    style: 'materialsymbolsoutlined',
    file: 'remove_24px.xml',
    why: "the minus half of a Stepper (Material Symbols' `remove`; Android has no stepper control)",
  },
  {
    resource: 'nitroui_add',
    symbol: 'add',
    style: 'materialsymbolsoutlined',
    file: 'add_24px.xml',
    why: "the plus half of a Stepper (Material Symbols' `add`; Android has no stepper control)",
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
      example: false,
    })),
    ...EXAMPLE_ICONS.map((icon) => ({
      url: rawUrl(`symbols/android/${icon.symbol}/${icon.style}/${icon.file}`),
      out: icon.out,
      icon,
      example: true,
    })),
    {
      url: rawUrl('LICENSE'),
      out: LICENSE_FILE,
      icon: null,
      example: false,
    },
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
  const exampleFiles = [];
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
    (target.example ? exampleFiles : files).push({
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
    exampleFiles,
  };
  fs.writeFileSync(
    path.join(root, LOCK_FILE),
    `${JSON.stringify(lock, null, 2)}\n`
  );
  console.log(
    `fetch-material-symbols: wrote ${files.length} library files and ` +
      `${exampleFiles.length} example fixtures from ${REPO}@${COMMIT}`
  );
}

main().catch((error) => {
  console.error(`fetch-material-symbols: ${error.message}`);
  process.exit(1);
});
