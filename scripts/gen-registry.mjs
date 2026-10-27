#!/usr/bin/env node
//
// gen-registry.mjs
//
// Writes the repo's per-component lists from the manifests in
// `src/components/<Name>/component.json`.
//
//   bun run registry          write them
//   bun run registry:check    fail if they are not what the manifests say
//   bun run regen             nitrogen + this
//
// `bun run check` runs the check where `nitrogen:check` sits: a generated list edited
// by hand, or a manifest changed without regenerating, fails the gate and names the
// file. The rules - the manifest schema, which lists are generated, which are
// cross-checked, and why - are in scripts/registry-core.mjs, which is pure so it can
// be unit-tested (scripts/__tests__/registry.test.js).
//
// This file is only the filesystem and the CLI: read the tree, hand it to the core,
// write or diff what comes back.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MANIFEST_BASENAME,
  manifestsFromEntries,
  planRegistry,
} from './registry-core.mjs';

const root = process.cwd();

/** repo-relative -> file contents, or null when the file does not exist. */
function read(path) {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return null;
  }
}

/** Every component directory that carries a manifest, in directory order. */
function manifestEntries() {
  const dir = 'src/components';
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((directory) => {
      const text = read(`${dir}/${directory}/${MANIFEST_BASENAME}`);
      return text == null ? [] : [{ directory, text }];
    });
}

/** The first line two versions of a file stop agreeing, for the drift message. */
function firstChange(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      return `line ${String(index + 1)}: ${JSON.stringify(a[index] ?? '<eof>')} -> ${JSON.stringify(b[index] ?? '<eof>')}`;
    }
  }
  return 'the files differ';
}

const mode = process.argv[2] ?? '--write';
if (mode !== '--write' && mode !== '--check') {
  console.error(
    `gen-registry: unknown argument ${JSON.stringify(mode)} (expected --write or --check)`
  );
  process.exit(2);
}

const entries = manifestEntries();
if (entries.length === 0) {
  console.error(`gen-registry: no src/components/*/${MANIFEST_BASENAME} found`);
  process.exit(1);
}

let manifests;
try {
  manifests = manifestsFromEntries(entries);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// One read per file, shared by the region pass and the cross-checks.
const cache = new Map();
const { files, problems, checked } = planRegistry(manifests, (path) => {
  if (!cache.has(path)) cache.set(path, read(path));
  return cache.get(path);
});

if (problems.length > 0) {
  console.error(
    `gen-registry: the manifests and the tree do not agree:\n${problems
      .map((problem) => `  - ${problem}`)
      .join('\n')}`
  );
  process.exit(1);
}

const drifted = Object.keys(files).sort();

if (mode === '--write') {
  for (const path of drifted) {
    writeFileSync(join(root, path), files[path]);
    console.log(`gen-registry: wrote ${path}`);
  }
  if (drifted.length === 0) {
    console.log(
      `gen-registry: up to date (${manifests.length} components, ${checked.length} generated files)`
    );
  }
  process.exit(0);
}

if (drifted.length > 0) {
  console.error(
    `registry:check: ${String(drifted.length)} generated file(s) do not match the manifests in src/components/*/${MANIFEST_BASENAME}:`
  );
  for (const path of drifted) {
    console.error(`  - ${path}`);
    console.error(`      ${firstChange(cache.get(path) ?? '', files[path])}`);
  }
  console.error(
    '\nRun `bun run registry` (or `bun run regen`) and commit the result.'
  );
  process.exit(1);
}

console.log(
  `registry:check: OK (${manifests.length} components, ${checked.length} generated files in step with the manifests)`
);
