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
 *      builder or path parser, no path commands - the `ImageVector` builder's, Compose
 *      `PathNode`s and `Path` calls, and `android.graphics.Path`'s - and no vector
 *      drawable or `pathData` outside the files the script wrote.
 *   2. Every `nitroui_*.xml` drawable, and the Apache 2.0 text beside them, matches the
 *      SHA-256 the script recorded, and the script recorded nothing that is not shipped.
 *      A hand edit to one coordinate fails here.
 *   3. The example app's icon fixtures are provenance-checked the same way (G19 round
 *      2), so the file a harness loads and a screenshot is taken of is Google's glyph
 *      rather than somebody's copy of one. What is *not* upstream has to be declared,
 *      with a reason, in `EXAMPLE_FIXTURES` below.
 *
 * One file is exempt from rule 1 and says why: `NitroUiVectorDrawable.kt`, the reader
 * for a vector drawable an *app* supplied (D43 item 2). See APP_ICON_PARSER.
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

/** Every folder the example app keeps icon fixtures in, and what counts as one. */
const EXAMPLE_ICON_DIRS = [
  'example/src/assets/icons',
  'example/android/app/src/main/res/drawable',
  'example/android/app/src/main/res/drawable-nodpi',
];
const EXAMPLE_FIXTURE_PATTERN = /\.(xml|png)$/;

/**
 * The example app's fixtures that are **not** Google's files, because they are not
 * glyphs: each exists to be something a Material Symbol cannot be. Declared here with
 * the reason, so the provenance case can demand that every other icon file in those
 * folders came from the fetch script (G19 round 2).
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
/** The example app's fixtures, provenance-checked the same way (G19 round 2). */
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
 * What a hand-built glyph looks like in Kotlin or Java.
 *
 * The builder (`ImageVector.Builder`, `materialIcon`/`materialPath` from
 * material-icons-core, `PathBuilder`, `addPathNodes`), the parsers that turn a typed
 * `pathData` string into one (`PathParser`, `PathParser.createPathFromPathData`), and
 * the path commands a glyph is written in: the `ImageVector` builder's, Compose's
 * `PathNode`s and `Path` calls (`relativeLineTo`, `cubicTo`, …) and
 * `android.graphics.Path`'s (`rLineTo`, …). A `Canvas`/`DrawScope` drawing of
 * something that is not an icon would trip the last pattern too, and that is the
 * point: it is the same hand-typed geometry, and it should be a deliberate exemption.
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

/** Problems with `android/src/main`'s sources, one line each. */
/**
 * The one file allowed to turn glyph geometry into an `ImageVector`: the reader for a
 * vector drawable an **app** supplied.
 *
 * D43 item 2 has nitro-ui load the `.xml` a developer `require`d from Metro, because
 * React Native refuses to serve an Android `.xml` asset itself
 * (`assetSupportsNetworkLoads`). Reading somebody else's drawable means parsing their
 * `pathData`, which is `PathParser`'s job, and assembling the result, which is
 * `ImageVector.Builder`'s. Both names look like a hand-built glyph to the patterns
 * above, and this file is the opposite of one: it holds no path of ours, only bytes
 * handed to it at run time. `docs/components/button.md`, "Android icons", is the
 * feature that needs it.
 *
 * The exemption is two patterns in one path, not a file-level pass. Typed path
 * commands, `PathNode`s and inline `pathData` strings stay illegal *here* too: a glyph
 * authored into the parser is the bug this test exists to catch, and the case below
 * asserts exactly that — for the strings as well, because the list above matches a
 * quoted `M\u2026` pair of numbers, so "a typed path stays illegal" is a pattern and not
 * a sentence. The case after it asserts the exemption cannot outlive its reason: if the
 * file stops being a parser, this list has to shrink.
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
    // The rule's own red case, kept beside it so a pattern that stops matching fails
    // here rather than passing every later source tree.
    const sources = {
      'android/src/main/java/A.kt':
        'private val G = ImageVector.Builder(name = "g").path { moveTo(1f, 2f) }.build()',
      // One line per other way to type a glyph out (FIX4 review): Compose's path
      // nodes, its `Path` calls, `android.graphics.Path`, and material-icons-core's
      // builder block.
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
      // The exempt file, on its own terms: parsing geometry it was handed is silence
      // (lines 1-2), and authoring geometry is still reported — the path command on
      // line 3, and the glyph written as a string on line 4, which is the same bug with
      // its clothes on: `PathParser` is exempt, a path nobody was handed is not. That is
      // what makes the exemption two patterns wide rather than a file-level pass.
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
    // The exemption above is a claim about a file, and claims go stale. If the parser
    // stops using PathParser, the exemption is shielding nothing and should be gone
    // rather than inherited by whatever that file becomes.
    const text = readRepoFile(APP_ICON_PARSER);
    expect(text).toContain('PathParser');
    expect(text).toContain('ImageVector.Builder');
    // And the file the exemption names is the one that ships the reader, not a file
    // that merely sounds like it.
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
    // G19's harnesses load these files and its screenshots are taken of them, so an
    // edit to one coordinate changes what a test asserts and what a reader of
    // docs/images sees — the same risk rule 2 covers for the library's own glyphs, one
    // directory over. Upstream files are hash-checked; anything else has to be
    // declared below with the reason it cannot be upstream.
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
    // And every line of that list has to still be true: a fixture that became an
    // upstream file, or stopped existing, would keep its exemption for nothing.
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
