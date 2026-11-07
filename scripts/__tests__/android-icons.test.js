/**
 * Are the Android icons the library draws itself Google's own, unchanged (D43 item 1)?
 *
 * SearchField 0.7.0 shipped a hand-typed copy of Material's search path with a mistake
 * in it, and it drew a key instead of a magnifier. Nothing could have noticed: a path
 * written out in Kotlin looks like any other path. So every glyph now comes from
 * Google's Material Symbols Android drawables, written byte for byte by
 * `scripts/icons/fetch-material-symbols.mjs`, and this file holds the two rules that
 * keep it that way:
 *
 *   1. `android/src/main` builds no glyph by hand: no `ImageVector.Builder`, no path
 *      builder or path parser, no path commands, and no vector drawable or `pathData`
 *      outside the files the script wrote.
 *   2. Every `nitroui_*.xml` drawable, and the Apache 2.0 text beside them, matches the
 *      SHA-256 the script recorded, and the script recorded nothing that is not shipped.
 *      A hand edit to one coordinate fails here.
 *
 * Both run at `check` time, offline. `--verify` on the script is the online half: it
 * downloads the files again and compares them with what is committed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const root = process.cwd();
const ANDROID_MAIN = 'android/src/main';
const DRAWABLE_DIR = `${ANDROID_MAIN}/res/drawable`;
const LOCK_FILE = 'scripts/icons/material-symbols.lock.json';

const lock = JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), 'utf8'));
const locked = new Map(lock.files.map((entry) => [entry.path, entry]));

/** Every file under `dir`, repo-relative, depth first. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...walk(relative));
    } else {
      out.push(relative);
    }
  }
  return out;
}

/**
 * What a hand-built glyph looks like in Kotlin or Java.
 *
 * The builder (`ImageVector.Builder`, `materialIcon`/`materialPath` from
 * material-icons-core, `PathBuilder`, `addPathNodes`), the parsers that turn a typed
 * `pathData` string into one (`PathParser`, `PathParser.createPathFromPathData`), and
 * the path commands a builder block is written in. A `Canvas`/`DrawScope` drawing of
 * something that is not an icon would trip the last pattern too, and that is the
 * point: it is the same hand-typed geometry, and it should be a deliberate exemption.
 */
const HAND_BUILT = [
  [/ImageVector\.Builder\b/, 'ImageVector.Builder'],
  [/\bmaterialIcon\s*\(/, 'materialIcon('],
  [/\bmaterialPath\s*\(/, 'materialPath('],
  [/\bPathBuilder\b/, 'PathBuilder'],
  [/\baddPathNodes\s*\(/, 'addPathNodes('],
  [/\bPathParser\b/, 'PathParser'],
  [
    /import\s+androidx\.compose\.ui\.graphics\.vector\.path\b/,
    'the ImageVector.Builder path { } extension',
  ],
  [
    /\b(?:moveTo|lineTo|curveTo|quadTo|arcTo|reflectiveCurveTo|horizontalLineTo|verticalLineTo)(?:Relative)?\s*\(/,
    'a path command',
  ],
];

/** Problems with `android/src/main`'s sources, one line each. */
function handBuiltGlyphs(files, readFile) {
  const problems = [];
  for (const file of files) {
    if (/\.(kt|java)$/.test(file)) {
      const lines = readFile(file).split('\n');
      lines.forEach((line, index) => {
        for (const [pattern, what] of HAND_BUILT) {
          if (pattern.test(line)) {
            problems.push(`${file}:${index + 1}: ${what}`);
          }
        }
      });
    } else if (/\.xml$/.test(file) && !locked.has(file)) {
      const text = readFile(file);
      if (/<vector\b|android:pathData|<path\b/.test(text)) {
        problems.push(
          `${file}: a vector drawable that fetch-material-symbols.mjs did not write`
        );
      }
    }
  }
  return problems;
}

const readRepoFile = (relative) =>
  fs.readFileSync(path.join(root, relative), 'utf8');

describe('Android icons (D43)', () => {
  it('builds no glyph by hand anywhere in android/src/main', () => {
    const files = walk(ANDROID_MAIN);
    // A walk that found no Kotlin would pass vacuously.
    expect(files.filter((file) => file.endsWith('.kt')).length).toBeGreaterThan(
      10
    );
    expect(handBuiltGlyphs(files, readRepoFile)).toEqual([]);
  });

  it('catches a hand-built glyph and a hand-typed drawable', () => {
    // The rule's own red case, kept beside it so a pattern that stops matching fails
    // here rather than passing every later source tree.
    const sources = {
      'android/src/main/java/A.kt':
        'private val G = ImageVector.Builder(name = "g").path { moveTo(1f, 2f) }.build()',
      'android/src/main/res/drawable/nitroui_typed.xml':
        '<vector><path android:pathData="M0,0L1,1Z"/></vector>',
    };
    expect(
      handBuiltGlyphs(Object.keys(sources), (file) => sources[file])
    ).toEqual([
      'android/src/main/java/A.kt:1: ImageVector.Builder',
      'android/src/main/java/A.kt:1: a path command',
      'android/src/main/res/drawable/nitroui_typed.xml: a vector drawable that fetch-material-symbols.mjs did not write',
    ]);
  });

  it('ships every drawable unchanged from Google, as the fetch script recorded it', () => {
    const drawables = fs
      .readdirSync(path.join(root, DRAWABLE_DIR))
      .map((name) => `${DRAWABLE_DIR}/${name}`);
    expect(drawables.length).toBeGreaterThan(0);
    const problems = [];
    for (const file of drawables) {
      if (!/\/nitroui_[a-z0-9_]+\.xml$/.test(file)) {
        problems.push(`${file}: not a nitroui_*.xml resource`);
      } else if (!locked.has(file)) {
        problems.push(
          `${file}: not in ${LOCK_FILE}; add it to the script's ICONS and run it`
        );
      }
    }
    for (const entry of lock.files) {
      const absolute = path.join(root, entry.path);
      if (!fs.existsSync(absolute)) {
        problems.push(`${entry.path}: recorded but missing`);
        continue;
      }
      const digest = createHash('sha256')
        .update(fs.readFileSync(absolute))
        .digest('hex');
      if (digest !== entry.sha256) {
        problems.push(
          `${entry.path}: sha256 ${digest}, recorded ${entry.sha256} - edited by hand? ` +
            'Rerun scripts/icons/fetch-material-symbols.mjs'
        );
      }
      if (
        !entry.url.startsWith(
          `https://raw.githubusercontent.com/google/material-design-icons/${lock.commit}/`
        )
      ) {
        problems.push(
          `${entry.path}: ${entry.url} is not Google's repository at the pinned commit`
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('ships the drawables and their licence in the package', () => {
    const manifest = readRepoFile('etc/package-files.txt').split('\n');
    const missing = [...lock.files.map((entry) => entry.path), 'NOTICE'].filter(
      (file) => !manifest.includes(file)
    );
    expect(missing).toEqual([]);
    expect(readRepoFile('NOTICE')).toContain('Material Symbols');
  });
});
