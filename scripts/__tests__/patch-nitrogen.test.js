// Gate for scripts/patch-nitrogen.mjs (margelo/nitro#1656 workaround).
// The fixtures under ./fixtures are real nitrogen 0.37.1 output, so a nitrogen
// upgrade that changes the generated Props constructor shape fails here loudly.
import { beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const script = join(repoRoot, 'scripts/patch-nitrogen.mjs');
const fixtures = join(repoRoot, 'scripts/__tests__/fixtures');
const VIEWS = 'nitrogen/generated/shared/c++/views';

function runPatch(root) {
  return spawnSync(process.execPath, [script, root], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
}

function withFixture(name, fn) {
  const workDir = mkdtempSync(join(tmpdir(), 'patch-nitrogen-'));
  try {
    cpSync(join(fixtures, name), workDir, { recursive: true });
    return fn(workDir);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

describe('patch-nitrogen', () => {
  beforeAll(() => {
    if (!existsSync(script)) {
      throw new Error(
        `Run jest from the repository root (looked in ${repoRoot}).`
      );
    }
  });

  it('adds the compat call to nitrogen output', () => {
    withFixture('basic', (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('patched HybridNitroUiComponent.cpp');

      const patched = readFileSync(
        join(root, VIEWS, 'HybridNitroUiComponent.cpp'),
        'utf8'
      );
      expect(patched).toContain('#include "NitroUiPropsCompat.hpp"');
      expect(patched).toContain(
        '::nitroui::compat::initializeDynamicProps(*this, sourceProps, rawProps, filterObjectKeys);'
      );
      // The generated filterObjectKeys function must survive untouched.
      expect(patched).toContain('bool HybridNitroUiProps::filterObjectKeys');
      const calls = patched.match(
        /::nitroui::compat::initializeDynamicProps\(/g
      );
      expect(calls).toHaveLength(1);
    });
  });

  it('is idempotent', () => {
    withFixture('basic', (root) => {
      expect(runPatch(root).status).toBe(0);
      const once = readFileSync(
        join(root, VIEWS, 'HybridNitroUiComponent.cpp'),
        'utf8'
      );

      const second = runPatch(root);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain(
        'already-patched HybridNitroUiComponent.cpp'
      );
      const twice = readFileSync(
        join(root, VIEWS, 'HybridNitroUiComponent.cpp'),
        'utf8'
      );
      expect(twice).toBe(once);
    });
  });

  it("leaves upstream's own fix alone", () => {
    withFixture('upstream', (root) => {
      const file = join(root, VIEWS, 'HybridUpstreamFixedComponent.cpp');
      const before = readFileSync(file, 'utf8');
      const result = runPatch(root);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'upstream HybridUpstreamFixedComponent.cpp'
      );
      expect(readFileSync(file, 'utf8')).toBe(before);
    });
  });

  it('fails loudly when nitrogen changed its output shape', () => {
    withFixture('changed-shape', (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('pattern not found');
      // Nothing may be written in that case.
      const file = readFileSync(
        join(root, VIEWS, 'HybridFutureShapeComponent.cpp'),
        'utf8'
      );
      expect(file).not.toContain('NitroUiPropsCompat');
    });
  });

  // Regression: the CLI used to compare `import.meta.url` with a raw
  // `file://` + argv[1] string, which never matches once the checkout path
  // needs URL percent-encoding - so both the patch and its hard-fail vanished.
  it.each([
    ['a space', 't01 review space'],
    ['a hash', 't01#review'],
    ['a percent sign', 't01%review'],
    ['non-ASCII characters', 't01-prüfung'],
  ])('works from a checkout path containing %s', (_label, dirName) => {
    const base = mkdtempSync(join(tmpdir(), `${dirName}-`));
    try {
      const scriptCopy = join(base, 'patch-nitrogen.mjs');
      copyFileSync(script, scriptCopy);

      const okRoot = join(base, 'ok');
      cpSync(join(fixtures, 'basic'), okRoot, { recursive: true });
      const patched = spawnSync(process.execPath, [scriptCopy, okRoot], {
        encoding: 'utf8',
        cwd: repoRoot,
      });
      expect(patched.status).toBe(0);
      expect(patched.stdout).toContain('patched HybridNitroUiComponent.cpp');

      const badRoot = join(base, 'changed-shape');
      cpSync(join(fixtures, 'changed-shape'), badRoot, { recursive: true });
      const failed = spawnSync(process.execPath, [scriptCopy, badRoot], {
        encoding: 'utf8',
        cwd: repoRoot,
      });
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain('pattern not found');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('is a no-op when there are no Hybrid Views', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'patch-nitrogen-'));
    try {
      mkdirSync(join(workDir, 'nitrogen/generated/shared/c++'), {
        recursive: true,
      });
      const result = runPatch(workDir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('nothing to do');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
