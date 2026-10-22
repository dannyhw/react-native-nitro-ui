// The library's codegen must only ever come from `src/`. A private spec that
// belongs to another nitro module in this repo (T02's bench probe lives in
// `bench/`) may never be generated into this package or autolinked from it.
import { beforeAll, describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

describe('nitrogen scan scope', () => {
  beforeAll(() => {
    if (!existsSync(join(root, 'nitro.json'))) {
      throw new Error(`Run jest from the repository root (looked in ${root}).`);
    }
  });

  it('generates from src/ in both the generator and the drift check', () => {
    const pkg = readJson('package.json');
    expect(pkg.scripts.nitrogen).toMatch(/^nitrogen src\b/);
    const check = readFileSync(
      join(root, 'scripts/nitrogen-check.mjs'),
      'utf8'
    );
    expect(check).toMatch(/join\(root,\s*'src'\)/);
  });

  it('ignores every other spec directory in the repo', () => {
    const { ignorePaths } = readJson('nitro.json');
    for (const path of [
      'node_modules',
      'example',
      'bench',
      'lib',
      'dist',
      'docs',
      'scripts',
    ]) {
      expect(ignorePaths).toContain(path);
    }
  });
});
