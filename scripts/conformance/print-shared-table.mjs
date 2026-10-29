#!/usr/bin/env node
/**
 * Print the shared-table region for `example/__tests__/Conformance.harness.tsx`.
 *
 * The harness bundle cannot import a Node script, so the numbers the in-app rules assert
 * against are embedded in that file as text — and text that nobody checks is a copy, which
 * is how a suite ends up asserting against its own answer. `checkSharedTableMirror` is the
 * check (it runs in `scripts/__tests__/conformance.test.js`, so `bun run check` goes red on
 * drift); this is the printer, so the region is regenerated rather than hand-maintained.
 *
 * With no argument it prints; with `--write` it replaces the region in place, which is what
 * a fix round should run after changing a table.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  SHARED_TABLE_BEGIN,
  SHARED_TABLE_END,
  checkSharedTableMirror,
  repoRoot,
  sharedInAppTable,
} from '../conformance-core.mjs';

const TARGET = 'example/__tests__/Conformance.harness.tsx';

/**
 * The region as it should appear in the file: a JSDoc comment naming where the numbers come
 * from, then `const SHARED = <json>;`, then the end marker the checker looks for.
 *
 * The JSON is emitted by `JSON.stringify` and nothing else, because the checker compares it
 * by parsing and re-stringifying — so anything added here by hand is a divergence waiting to
 * happen.
 *
 * The `prettier-ignore` is load-bearing, not cosmetics. Prettier rewrites an object literal's
 * keys without their quotes, which turns the region into valid TypeScript and *invalid JSON* —
 * and a mirror that no longer parses is not a mirror, so `checkSharedTableMirror` would fail
 * the tree the formatter just wrote. Pinning the node is the only way to have a region that is
 * both valid TS and byte-exact JSON.
 */
function region() {
  return [
    '/**',
    ` * ${SHARED_TABLE_BEGIN}`,
    ' *',
    ' * Emitted by `sharedInAppTable()` in `scripts/conformance-core.mjs` and checked',
    ' * against it by `checkSharedTableMirror` on every `bun run check`, so a number',
    ' * changed here without being changed there fails `check` rather than passing a',
    ' * wrong assertion. The region is JSON — that is what makes it checkable as text —',
    ' * so no type annotation, comment or expression may go inside it, and the',
    ' * `prettier-ignore` below stays: the formatter quotes object keys, and quoted-out',
    ' * keys are no longer JSON. Regenerate the whole block with',
    ' * `node scripts/conformance/print-shared-table.mjs --write`.',
    ' */',
    '// prettier-ignore',
    `const SHARED = ${JSON.stringify(sharedInAppTable(), null, 2)};`,
    `/** ${SHARED_TABLE_END} */`,
  ].join('\n');
}

const root = repoRoot();
const path = join(root, TARGET);
const text = readFileSync(path, 'utf8');
const begin = text.indexOf(`/**\n * ${SHARED_TABLE_BEGIN}`);
const endMarker = `/** ${SHARED_TABLE_END} */`;
const end = text.indexOf(endMarker);
if (begin < 0 || end < 0) {
  console.error(
    `${TARGET}: no ${SHARED_TABLE_BEGIN} region found, so there is nothing to ` +
      'replace. Add the region by hand once, then regenerate it from here.'
  );
  process.exitCode = 1;
} else {
  const updated = `${text.slice(0, begin)}${region()}${text.slice(
    end + endMarker.length
  )}`;
  const problems = checkSharedTableMirror(updated);
  if (problems.length > 0) {
    // Write nothing that the checker would reject — a printer that produces a region its own
    // check calls wrong is worse than one that stops.
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else if (process.argv.includes('--write')) {
    if (updated !== text) {
      writeFileSync(path, updated);
      console.log(`${TARGET}: shared table rewritten`);
    } else {
      console.log(`${TARGET}: shared table already up to date`);
    }
  } else {
    console.log(region());
    console.error(
      `\n(up to date: ${String(updated === text)} — pass --write to apply)`
    );
  }
}

if (resolve(process.cwd()) !== root) {
  console.error(`(note: the repo root resolved to ${root})`);
}
