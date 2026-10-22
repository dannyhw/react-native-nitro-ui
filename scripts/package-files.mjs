#!/usr/bin/env node
//
// package-files.mjs
//
// Tarball contents gate. `etc/package-files.txt` is the committed, reviewable
// list of files that ship to npm; a publish that adds or drops a file has to
// change it deliberately (`bun run manifest:update`), which makes accidental
// codegen/native omissions visible in review.
//
// Requires the package to be built (`bun run prepare`), because `lib/` is part
// of the tarball. The tarball is listed with `--ignore-scripts` so this never
// rebuilds (and so build logs cannot get mixed into the JSON output).

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = join(root, 'etc/package-files.txt');
const update = process.argv.includes('--update');

const pack = spawnSync(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  }
);
if (pack.status !== 0) {
  console.error(`package-files: npm pack failed:\n${pack.stderr}`);
  process.exit(1);
}

// npm can prefix warnings on stderr/stdout; the JSON array is the last block
// that starts at column 0.
const lines = pack.stdout.split('\n');
const jsonStart = lines.findLastIndex((line) => line.startsWith('['));
let payload;
try {
  payload = JSON.parse(lines.slice(jsonStart).join('\n'));
} catch {
  console.error('package-files: could not parse `npm pack --dry-run --json`.');
  process.exit(1);
}
if (!Array.isArray(payload) || payload.length === 0) {
  console.error('package-files: unexpected `npm pack --dry-run --json` shape.');
  process.exit(1);
}
const actual = payload[0].files.map((f) => f.path).sort();

if (update) {
  writeFileSync(manifest, `${actual.join('\n')}\n`);
  console.log(`package-files: wrote ${actual.length} entries to ${manifest}`);
  process.exit(0);
}

let expected = [];
try {
  expected = readFileSync(manifest, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .sort();
} catch {
  console.error(
    `package-files: ${manifest} is missing. Run \`bun run manifest:update\`.`
  );
  process.exit(1);
}

const added = actual.filter((f) => !expected.includes(f));
const removed = expected.filter((f) => !actual.includes(f));
for (const f of added) {
  console.error(
    `package-files: +${f} would be published (not in the manifest).`
  );
}
for (const f of removed) {
  console.error(
    `package-files: -${f} is in the manifest but not in the tarball.`
  );
}
if (added.length > 0 || removed.length > 0) {
  console.error(
    `package-files: tarball differs from ${manifest} (${added.length} added, ${removed.length} removed). If intended, run \`bun run manifest:update\`.`
  );
  process.exit(1);
}
console.log(
  `package-files: tarball matches ${manifest} (${actual.length} files).`
);
