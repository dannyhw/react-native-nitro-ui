// Gate for scripts/patch-nitrogen.mjs (margelo/nitro#1656 workaround).
// The fixtures under ./fixtures are real nitrogen 0.37.1 output, so a nitrogen
// upgrade that changes the generated Props constructor shape fails here loudly.
import { beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
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
