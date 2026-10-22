#!/usr/bin/env node
//
// nitrogen-check.mjs
//
// Drift gate: regenerate the Nitro codegen into a temp directory (plus the
// ViewProps patch) and compare it with the committed `nitrogen/generated`.
// Fails if someone edited generated files by hand or forgot to run
// `bun run nitrogen` after touching a `*.nitro.ts` spec.
//
// Also asserts every generated Hybrid View Props constructor restores RN's base
// ViewProps (our patch or upstream's), see scripts/patch-nitrogen.mjs.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

import { PATCH_MARKER, patchGeneratedViews } from './patch-nitrogen.mjs';

const root = resolve(import.meta.dirname, '..');
const committed = join(root, 'nitrogen');
const UPSTREAM_CALL = 'RawPropsCompat::initializeDynamicProps';
const KEEP_DOTFILES = new Set(['.gitattributes']);

function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listFiles(join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Files of `dir` that git tracks, relative to `dir`. Falls back to a working
 * tree listing (dotfiles except `KEEP_DOTFILES` ignored) outside a checkout,
 * such as an unpacked npm tarball.
 * @param {string} dir
 * @returns {string[]}
 */
function listTrackedFiles(dir) {
  const prefix = relative(root, dir);
  const tracked = spawnSync('git', ['ls-files', '--', prefix || '.'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (tracked.status === 0 && tracked.stdout.trim() !== '') {
    const head = `${prefix}/`;
    return tracked.stdout
      .split('\n')
      .filter((line) => line.startsWith(head))
      .map((line) => line.slice(head.length));
  }
  return listFiles(dir).filter(
    (file) =>
      !basename(file).startsWith('.') || KEEP_DOTFILES.has(basename(file))
  );
}

const workDir = mkdtempSync(join(tmpdir(), 'nitrogen-check-'));
const generated = join(workDir, 'nitrogen');
let failed = false;

try {
  // Same base path as `bun run nitrogen`: only this package's `src/` holds
  // library specs, so a spec that belongs to another nitro module in the repo
  // (T02's bench app) can never show up in the library's codegen.
  const nitrogenArgs = [
    'nitrogen',
    join(root, 'src'),
    '--out',
    join(generated, 'generated'),
    '--config',
    join(root, 'nitro.json'),
    '--log-level',
    'error',
  ];
  const codegen = spawnSync('bunx', nitrogenArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (codegen.status !== 0) {
    console.error('nitrogen-check: nitrogen failed.');
    process.exit(1);
  }

  // Apply the same post-processing the real `bun run nitrogen` applies.
  const { results } = patchGeneratedViews(workDir);
  if (process.exitCode === 1) {
    console.error(
      'nitrogen-check: the ViewProps patch could not be applied to fresh codegen.'
    );
    process.exit(1);
  }
  for (const { file, status } of results) {
    console.log(`nitrogen-check: ${status} ${file}`);
  }

  // 1) Base ViewProps must be restored in every generated view.
  const viewsDir = join(generated, 'generated/shared/c++/views');
  for (const file of listFiles(viewsDir).filter((f) =>
    f.endsWith('Component.cpp')
  )) {
    const source = readFileSync(join(viewsDir, file), 'utf8');
    if (!source.includes(PATCH_MARKER) && !source.includes(UPSTREAM_CALL)) {
      console.error(
        `nitrogen-check: ${file} does not restore RN base ViewProps (margelo/nitro#1656).`
      );
      failed = true;
    }
  }

  // 2) Fresh codegen must equal the committed codegen. The committed side is
  // read from the index (not the working tree) so a stray .DS_Store in a
  // generated folder cannot report false drift.
  const before = listTrackedFiles(committed);
  const after = listFiles(generated);
  const missing = before.filter((f) => !after.includes(f));
  const extra = after.filter((f) => !before.includes(f));
  const changed = before.filter(
    (f) =>
      after.includes(f) &&
      !readFileSync(join(committed, f)).equals(readFileSync(join(generated, f)))
  );

  for (const f of missing) {
    console.error(
      `nitrogen-check: ${relative(root, join(committed, f))} is stale (codegen no longer emits it).`
    );
  }
  for (const f of extra) {
    console.error(
      `nitrogen-check: ${relative(root, join(generated, f))} is not committed (run \`bun run nitrogen\`).`
    );
  }
  for (const f of changed) {
    console.error(
      `nitrogen-check: ${relative(root, join(committed, f))} differs from codegen (run \`bun run nitrogen\`).`
    );
  }
  failed =
    failed || missing.length > 0 || extra.length > 0 || changed.length > 0;

  if (failed) {
    console.error(
      `\nnitrogen-check: ${missing.length + extra.length + changed.length} drift issue(s).`
    );
    process.exit(1);
  }
  console.log(
    `nitrogen-check: no drift (${after.length} generated files match, ${results.length} view(s) patched).`
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
