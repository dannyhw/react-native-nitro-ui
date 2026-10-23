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
  writeFileSync,
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

describe('patch-nitrogen: intrinsic sizing', () => {
  const HPP = `${VIEWS}/HybridNitroUiSwitchComponent.hpp`;
  const MM = 'nitrogen/generated/ios/c++/views/HybridNitroUiSwitchComponent.mm';
  const KT =
    'nitrogen/generated/android/kotlin/com/margelo/nitro/nitroui/views/HybridNitroUiSwitchManager.kt';
  const SIZED = [HPP, MM, KT];
  // Kept in sync with SIZING_MARKER in scripts/patch-nitrogen.mjs. It is what a
  // successful patch leaves behind, so its absence proves a refused patch wrote
  // nothing.
  const MARKER = '// nitro-ui: intrinsic sizing';

  it('repoints the state, shadow node and component descriptor aliases', () => {
    withFixture('sizing', (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(0);
      const patched = readFileSync(join(root, HPP), 'utf8');
      expect(patched).toContain('#include "NitroUiIntrinsic.hpp"');
      expect(patched).toContain(
        'using HybridNitroUiSwitchState = ::margelo::nitro::nitroui::IntrinsicViewState<HybridNitroUiSwitchProps>;'
      );
      expect(patched).toContain(
        '::margelo::nitro::nitroui::IntrinsicShadowNode<'
      );
      expect(patched).toContain(
        '::margelo::nitro::nitroui::IntrinsicComponentDescriptor<HybridNitroUiSwitchShadowNode>'
      );
      // The aliases are what the rest of the generated code uses, so the names
      // themselves must survive.
      for (const alias of [
        'HybridNitroUiSwitchState',
        'HybridNitroUiSwitchShadowNode',
        'HybridNitroUiSwitchComponentDescriptor',
      ]) {
        expect(patched).toContain(`using ${alias} =`);
      }
      // ...and the old targets must be gone, or the swap did not happen.
      expect(patched).not.toContain('nitro::ViewPropsHolderState<');
      expect(patched).not.toContain('nitro::ViewComponentDescriptor<');
      expect(patched).not.toContain('react::ConcreteViewShadowNode<');
    });
  });

  it('teaches the generated iOS component view about Fabric state', () => {
    withFixture('sizing', (root) => {
      runPatch(root);
      const patched = readFileSync(join(root, MM), 'utf8');
      expect(patched).toContain('- (void)updateState:');
      expect(patched).toContain('NitroUiSizingEngine::shared().bind(');
      expect(patched).toContain(
        'HybridNitroUiSwitchComponentName, sizingState)'
      );
      expect(patched).toContain('[super updateState:state oldState:oldState];');
      // Must be inside the @implementation, not after the file's last @end.
      expect(
        patched.lastIndexOf('updateState:state oldState:oldState]')
      ).toBeLessThan(
        patched.indexOf('@end', patched.indexOf('@implementation'))
      );
    });
  });

  it('binds the generated Android manager to the sizing engine', () => {
    withFixture('sizing', (root) => {
      runPatch(root);
      const patched = readFileSync(join(root, KT), 'utf8');
      expect(patched).toContain(
        'import com.margelo.nitro.nitroui.core.NitroUiSizing'
      );
      expect(patched).toContain('NitroUiSizing.bind(getName(), newState)');
      // Binding before the props are applied would be useless; it must be after
      // the generated state updater.
      expect(patched.indexOf('NitroUiSizing.bind(')).toBeGreaterThan(
        patched.indexOf('StateUpdater.updateViewProps(')
      );
    });
  });

  it('is idempotent on all three files', () => {
    withFixture('sizing', (root) => {
      expect(runPatch(root).status).toBe(0);
      const once = SIZED.map((f) => readFileSync(join(root, f), 'utf8'));
      const second = runPatch(root);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain(
        `already-patched ${HPP.split('/').pop()}`
      );
      SIZED.forEach((f, i) =>
        expect(readFileSync(join(root, f), 'utf8')).toBe(once[i])
      );
    });
  });

  it('fails when nitrogen stops using the shadow node template', () => {
    withFixture('sizing-changed-shape', (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'HybridNitroUiSwitchShadowNode alias not found'
      );
      expect(readFileSync(join(root, HPP), 'utf8')).not.toContain(
        'NitroUiIntrinsic'
      );
    });
  });

  it('refuses to add updateState: when nitrogen already generates it', () => {
    // A future nitrogen that generates the hook itself must not end up with two
    // `updateState:oldState:` implementations in one @implementation: Objective-C++
    // takes that, and which one wins is a link-order detail. Failing loudly is the
    // only safe answer, because the wrong outcome is sizing silently not binding.
    withFixture('sizing', (root) => {
      const path = join(root, MM);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          '@end',
          [
            '- (void)updateState:(const facebook::react::State::Shared &)state',
            '           oldState:(const facebook::react::State::Shared &)oldState {',
            '  [super updateState:state oldState:oldState];',
            '}',
            '@end',
          ].join('\n')
        )
      );
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('already defines updateState:oldState:');
      expect(readFileSync(path, 'utf8')).not.toContain(
        'NitroUiSizingEngine::shared().bind('
      );
    });
  });

  it('refuses to bind twice when the Kotlin hook is already generated', () => {
    withFixture('sizing', (root) => {
      const path = join(root, KT);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          'HybridNitroUiSwitchStateUpdater.updateViewProps(hybridView, newState, oldState)',
          [
            'NitroUiSizing.bind(getName(), newState)',
            'HybridNitroUiSwitchStateUpdater.updateViewProps(hybridView, newState, oldState)',
          ].join('\n')
        )
      );
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('already calls NitroUiSizing.bind()');
      expect(readFileSync(path, 'utf8')).not.toContain(MARKER);
    });
  });

  it('fails when the config lists a view that is not generated', () => {
    withFixture('sizing-missing-view', (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('is the view generated?');
    });
  });

  it('fails on a policy it does not know', () => {
    withFixture('sizing', (root) => {
      writeFileSync(
        join(root, 'nitro-ui.sizing.json'),
        JSON.stringify({ HybridNitroUiSwitch: 'heightForWidth' })
      );
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('heightForWidth');
      expect(readFileSync(join(root, HPP), 'utf8')).not.toContain(
        'NitroUiIntrinsic'
      );
    });
  });

  it('leaves sized-looking views alone without the config', () => {
    withFixture('sizing', (root) => {
      rmSync(join(root, 'nitro-ui.sizing.json'));
      const before = SIZED.map((f) => readFileSync(join(root, f), 'utf8'));
      expect(runPatch(root).status).toBe(0);
      SIZED.forEach((f, i) =>
        expect(readFileSync(join(root, f), 'utf8')).toBe(before[i])
      );
    });
  });
});
