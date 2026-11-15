#!/usr/bin/env node
/**
 * Prints the shared-table region of `example/__tests__/Conformance.harness.tsx`, which mirrors
 * the tables in `scripts/conformance-core.mjs` because the harness bundle cannot import them.
 *
 * Usage: with no argument it prints the region; `--write` replaces it in the file.
 * Exits 1 when the file has no region or the new region fails its own check.
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

// The JSON must come from `JSON.stringify` alone: the checker compares it by parsing and
// re-stringifying. The emitted `prettier-ignore` stops Prettier unquoting the keys, which
// would leave the region invalid JSON.
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
