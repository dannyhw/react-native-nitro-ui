import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const root = process.cwd();
const ANDROID_MAIN = 'android/src/main';
const DRAWABLE_DIR = `${ANDROID_MAIN}/res/drawable`;
const LOCK_FILE = 'scripts/icons/material-symbols.lock.json';

/** Every folder the example app keeps icon fixtures in, and what counts as one. */
const EXAMPLE_ICON_DIRS = [
  'example/src/assets/icons',
  'example/android/app/src/main/res/drawable',
  'example/android/app/src/main/res/drawable-nodpi',
];
const EXAMPLE_FIXTURE_PATTERN = /\.(xml|png)$/;

/**
 * The example app's fixtures that are not Google's files, each with the reason.
 * Every other icon file in those folders must come from the fetch script.
 */
const EXAMPLE_FIXTURES = {
  'example/src/assets/icons/not-a-vector.xml':
    "well-formed XML that is no drawable at all - the reader's negative case (NitroUiVectorDrawableTest.kt)",
  'example/android/app/src/main/res/drawable/nitroui_test_wide.xml':
    "a 32 x 12 dp rectangle: Material ships only 24 x 24 canvases, and the point of this file is that the artwork's own box is not the slot's. A rectangle, not a glyph",
  'example/android/app/src/main/res/drawable/nitroui_test_slab.xml':
    "a square that fills its canvas: not a glyph, the fixture that makes a pixel probe measure a slot's *area* (G21) - 20 dp in a menu row, 18 dp in a chip",
  'example/src/assets/icons/slab_24px.xml':
    'the same slab through Metro, so the dev-server road is measured with the same file the drawable road is (G21)',
  'example/android/app/src/main/res/drawable/nitroui_test_shape.xml':
    'a <shape> with no intrinsic size: the "resolves but cannot be an icon" branch',
  'example/android/app/src/main/res/drawable-nodpi/nitroui_test_raster.png':
    'a raster on purpose, so the branch that draws a drawable which is not a vector stays proven (G19 fix round 2 item 3)',
  'example/android/app/src/main/res/drawable/rn_edit_text_material.xml':
    "React Native's own EditText background from the app template - not an icon, and nitro-ui never loads it",
};

const lock = JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), 'utf8'));
const locked = new Map(lock.files.map((entry) => [entry.path, entry]));
/** The example app's fixtures, checked the same way. */
const exampleFiles = new Map(
  (lock.exampleFiles ?? []).map((entry) => [entry.path, entry])
);

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
 * What a hand-built glyph looks like in Kotlin or Java: the vector builders, the
 * `pathData` parsers and the path commands a glyph is written in.
 */
const HAND_BUILT = [
  [/ImageVector\.Builder\b/, 'ImageVector.Builder'],
  [/\bmaterialIcon\s*\(/, 'materialIcon('],
  [/\bmaterialPath\b/, 'materialPath'],
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
  [/\bPathNode\./, 'PathNode'],
  [
    /\brelative(?:Move|Line|Cubic|Quadratic(?:Bezier)?)To\s*\(/,
    'a relative path command',
  ],
  [/\b(?:cubicTo|quadraticTo|quadraticBezierTo)\s*\(/, 'a curve command'],
  [/\br(?:Move|Line|Cubic|Quad)To\s*\(/, 'an android.graphics.Path command'],
  [/"\s*[Mm]\s*-?\d*\.?\d+[\s,]*-?\d*\.?\d+/, 'a typed pathData string'],
];

/**
 * The one file allowed to turn glyph geometry into an `ImageVector`: the reader for a
 * vector drawable an app supplied. Only `PathParser` and `ImageVector.Builder` are
 * exempt there; typed path commands and inline `pathData` stay illegal.
 */
const APP_ICON_PARSER =
  'android/src/main/java/com/margelo/nitro/nitroui/NitroUiVectorDrawable.kt';
const APP_ICON_PARSER_ALLOWED = new Set(['ImageVector.Builder', 'PathParser']);

function handBuiltGlyphs(files, readFile) {
  const problems = [];
  for (const file of files) {
    if (/\.(kt|java)$/.test(file)) {
      const lines = readFile(file).split('\n');
      lines.forEach((line, index) => {
        for (const [pattern, what] of HAND_BUILT) {
          if (!pattern.test(line)) {
            continue;
          }
          if (file === APP_ICON_PARSER && APP_ICON_PARSER_ALLOWED.has(what)) {
            continue;
          }
          problems.push(`${file}:${index + 1}: ${what}`);
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
    const sources = {
      'android/src/main/java/A.kt':
        'private val G = ImageVector.Builder(name = "g").path { moveTo(1f, 2f) }.build()',
      // One line per other way to type a glyph out.
      'android/src/main/java/B.kt': [
        'val p = Path(pathData = listOf(PathNode.MoveTo(1f, 2f)))',
        'path.relativeMoveTo(1f, 2f)',
        'path.relativeLineTo(1f, 2f)',
        'path.cubicTo(1f, 2f, 3f, 4f, 5f, 6f)',
        'path.quadraticTo(1f, 2f, 3f, 4f)',
        'path.rMoveTo(1f, 2f)',
        'path.rLineTo(1f, 2f)',
        'val icon = materialIcon(name = "g") { materialPath { } }',
      ].join('\n'),
      'android/src/main/res/drawable/nitroui_typed.xml':
        '<vector><path android:pathData="M0,0L1,1Z"/></vector>',
      // The exempt file: parsing geometry it was handed is allowed (lines 1-2),
      // authoring geometry is still reported (lines 3-4).
      [APP_ICON_PARSER]: [
        'val v = ImageVector.Builder(name = "x")',
        'val p = PathParser.createPathFromPathData(bytes)',
        'builder.moveTo(1f, 2f)',
        'val g = PathParser().parsePathString("M0,0L24,24Z")',
      ].join('\n'),
    };
    expect(
      handBuiltGlyphs(Object.keys(sources), (file) => sources[file])
    ).toEqual([
      'android/src/main/java/A.kt:1: ImageVector.Builder',
      'android/src/main/java/A.kt:1: a path command',
      'android/src/main/java/B.kt:1: PathNode',
      'android/src/main/java/B.kt:2: a relative path command',
      'android/src/main/java/B.kt:3: a relative path command',
      'android/src/main/java/B.kt:4: a curve command',
      'android/src/main/java/B.kt:5: a curve command',
      'android/src/main/java/B.kt:6: an android.graphics.Path command',
      'android/src/main/java/B.kt:7: an android.graphics.Path command',
      'android/src/main/java/B.kt:8: materialIcon(',
      'android/src/main/java/B.kt:8: materialPath',
      'android/src/main/res/drawable/nitroui_typed.xml: a vector drawable that fetch-material-symbols.mjs did not write',
      `${APP_ICON_PARSER}:3: a path command`,
      `${APP_ICON_PARSER}:4: a typed pathData string`,
    ]);
  });

  it('exempts the app-file parser only while it is one', () => {
    const text = readRepoFile(APP_ICON_PARSER);
    expect(text).toContain('PathParser');
    expect(text).toContain('ImageVector.Builder');
    expect(text).toContain('object NitroUiVectorDrawableReader');
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

  it('proves where every icon the example app renders came from', () => {
    const problems = [];
    for (const entry of exampleFiles.values()) {
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
    for (const dir of EXAMPLE_ICON_DIRS) {
      for (const name of fs.readdirSync(path.join(root, dir))) {
        if (!EXAMPLE_FIXTURE_PATTERN.test(name)) {
          continue;
        }
        const relative = `${dir}/${name}`;
        if (exampleFiles.has(relative) || relative in EXAMPLE_FIXTURES) {
          continue;
        }
        problems.push(
          `${relative}: neither fetched from Material Symbols by ` +
            `fetch-material-symbols.mjs nor declared in EXAMPLE_FIXTURES with the ` +
            `reason it cannot be upstream`
        );
      }
    }
    for (const [relative, reason] of Object.entries(EXAMPLE_FIXTURES)) {
      if (!fs.existsSync(path.join(root, relative))) {
        problems.push(
          `${relative}: declared in EXAMPLE_FIXTURES but not on disk`
        );
      }
      if (exampleFiles.has(relative)) {
        problems.push(
          `${relative}: both fetched and declared - drop the declaration (${reason})`
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
