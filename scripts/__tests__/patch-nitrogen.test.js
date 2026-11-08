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

/**
 * A list the script configures itself, read out of its own source.
 *
 * Importing would be nicer, but a suite that hardcodes these lists goes red for the wrong
 * reason the day one grows: the fixture tree stops being the tree the step is being asked
 * about. Reading them keeps every tree below a whole one.
 *
 * @param {string} name e.g. `CONTENT_CHILDREN_VIEWS`
 * @returns {string[]}
 */
function configuredViews(name) {
  const list = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(
    readFileSync(script, 'utf8')
  );
  return [...(list?.[1] ?? '').matchAll(/'(Hybrid\w+)'/g)].map((m) => m[1]);
}

const contentChildrenViews = () => configuredViews('CONTENT_CHILDREN_VIEWS');
const scrollShadowViews = () => configuredViews('SCROLL_SHADOW_VIEWS');

const viewsDirOf = (className) =>
  `nitrogen/generated/ios/c++/views/${className}Component.mm`;

/** A generated iOS component view, cut down to what the patch reads. */
const generated = (className = 'HybridNitroUiBottomSheet') =>
  [
    `@implementation ${className}Component {`,
    '}',
    '- (void) updateView {',
    '  [self setContentView:view];',
    '}',
    '@end',
    '',
  ].join('\n');

/**
 * A generated shared `*Component.hpp`, cut down to what the shadow-node step reads: the
 * aliases it matches on, and the include anchor it inserts beside.
 */
const generatedHeader = (className) =>
  [
    '#pragma once',
    '',
    '#include <NitroModules/ReactProp.hpp>',
    '#include <NitroModules/ViewComponentDescriptor.hpp>',
    '#include <NitroModules/ViewPropsHolderState.hpp>',
    '',
    `  extern const char ${className}ComponentName[];`,
    '',
    `  class ${className}Props final: public react::ViewProps {`,
    '  };',
    '',
    `  using ${className}State = nitro::ViewPropsHolderState<${className}Props>;`,
    '',
    `  using ${className}ShadowNode = react::ConcreteViewShadowNode<${className}ComponentName,`,
    `                                                                    ${className}Props /* custom props */,`,
    '                                                                    react::ViewEventEmitter /* default */,',
    `                                                                    ${className}State /* custom state */>;`,
    '',
    `  using ${className}ComponentDescriptor = nitro::ViewComponentDescriptor<${className}ShadowNode>;`,
    '',
  ].join('\n');

/**
 * A scratch tree that declares and generates every view the content-children step is
 * configured for, overriding the BottomSheet's `.mm` with `mm`.
 *
 * The step reads its own list, so a tree that declares one listed view has to declare and
 * generate all of them — refusing a missing one is the guard tested below, and a tree that
 * is a fragment of the real tree would be red for the wrong reason every time the list grows.
 */
function withContentViewTree(mm, fn, { declare = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'patch-nitrogen-sheet-'));
  try {
    mkdirSync(join(root, 'nitrogen/generated/ios/c++/views'), {
      recursive: true,
    });
    mkdirSync(join(root, VIEWS), { recursive: true });
    writeFileSync(
      join(root, 'nitro.json'),
      JSON.stringify({
        autolinking: Object.fromEntries(
          (declare ? contentChildrenViews() : []).map((className) => [
            className.replace(/^Hybrid/, ''),
            {},
          ])
        ),
      })
    );
    // `mm == null` is the "nitrogen generated nothing" case the step has to fail on.
    if (mm != null) {
      for (const className of contentChildrenViews()) {
        writeFileSync(
          join(root, viewsDirOf(className)),
          className === 'HybridNitroUiBottomSheet' ? mm : generated(className)
        );
      }
      for (const className of scrollShadowViews()) {
        writeFileSync(
          join(root, VIEWS, `${className}Component.hpp`),
          generatedHeader(className)
        );
      }
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

describe('patch-nitrogen: content children (G14)', () => {
  const MM =
    'nitrogen/generated/ios/c++/views/HybridNitroUiBottomSheetComponent.mm';
  it('mounts the children into the content view, inside the @implementation', () => {
    withContentViewTree(generated(), (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(0);
      const code = readFileSync(join(root, MM), 'utf8');
      expect(code).toContain('- (void)mountChildComponentView:');
      expect(code).toContain(
        '[content insertSubview:childComponentView atIndex:index];'
      );
      expect(code).toContain('- (void)unmountChildComponentView:');
      expect(code).toContain('[childComponentView removeFromSuperview];');
      // A `Form` hands a row from its holding view into a list cell, so Fabric can unmount a
      // child that no longer lives in the content view; forwarding that to `super` would
      // detach the row from the cell that is drawing it.
      expect(code).not.toContain('childComponentView.superview != content');
      expect(code.indexOf('mountChildComponentView')).toBeLessThan(
        code.lastIndexOf('@end')
      );
    });
  });

  it('is idempotent', () => {
    withContentViewTree(generated(), (root) => {
      runPatch(root);
      const once = readFileSync(join(root, MM), 'utf8');
      const again = runPatch(root);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain(
        'already-patched HybridNitroUiBottomSheetComponent.mm'
      );
      expect(readFileSync(join(root, MM), 'utf8')).toBe(once);
    });
  });

  it('fails when the view is no longer the content view, or nitrogen generates the override', () => {
    withContentViewTree(
      generated().replace('[self setContentView:view];', ''),
      (root) => {
        const result = runPatch(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('setContentView');
      }
    );
    withContentViewTree(
      generated().replace(
        '@end',
        '- (void)mountChildComponentView:(UIView *)v index:(NSInteger)i {}\n@end'
      ),
      (root) => {
        const result = runPatch(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('dropped rather than duplicated');
      }
    );
  });

  it('fails for a listed view nitrogen did not generate, or that nitro.json does not declare', () => {
    withContentViewTree(null, (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'CONTENT_CHILDREN_VIEWS lists HybridNitroUiBottomSheet'
      );
      expect(result.stderr).toContain('is the view generated?');
    });
    withContentViewTree(
      generated(),
      (root) => {
        const result = runPatch(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          'CONTENT_CHILDREN_VIEWS lists HybridNitroUiBottomSheet, and nitro.json declares no NitroUiBottomSheet'
        );
      },
      { declare: false }
    );
  });

  it('asks nothing of a tree with no nitro.json, as the sizing step asks nothing without its config', () => {
    withContentViewTree(generated(), (root) => {
      rmSync(join(root, 'nitro.json'));
      const result = runPatch(root);
      expect(result.status).toBe(0);
      expect(readFileSync(join(root, MM), 'utf8')).not.toContain(
        '// nitro-ui: content children'
      );
    });
  });

  it('is applied to the BottomSheet the repo generates', () => {
    const mm = readFileSync(join(repoRoot, MM), 'utf8');
    expect(mm).toContain('// nitro-ui: content children');
    expect(mm).toContain(
      '[content insertSubview:childComponentView atIndex:index];'
    );
  });
});

describe('patch-nitrogen: scroll-corrected shadow node (G24)', () => {
  const HPP = `${VIEWS}/HybridNitroUiFormComponent.hpp`;

  /** A tree holding one whole copy of the Form's generated shared header. */
  function withFormTree(hpp, fn) {
    return withContentViewTree(generated(), (root) => {
      if (hpp != null) writeFileSync(join(root, HPP), hpp);
      return fn(root);
    });
  }

  it("repoints the shadow node and keeps nitrogen's state", () => {
    withFormTree(null, (root) => {
      const result = runPatch(root);
      expect(result.status).toBe(0);
      const code = readFileSync(join(root, HPP), 'utf8');
      expect(code).toContain(
        'using HybridNitroUiFormShadowNode =\n' +
          '      ::margelo::nitro::nitroui::ScrollShadowNode<' +
          'HybridNitroUiFormComponentName, HybridNitroUiFormProps, ' +
          'HybridNitroUiFormState>;'
      );
      expect(code).toContain('#include "NitroUiScrollShadow.hpp"');
      // The Form is not self-sizing: this node is built *on* the generated state, and the
      // descriptor keeps pointing at the alias. Losing either is a Form that cannot mount.
      expect(code).toContain(
        'using HybridNitroUiFormState = nitro::ViewPropsHolderState<HybridNitroUiFormProps>;'
      );
      expect(code).toContain(
        'using HybridNitroUiFormComponentDescriptor = nitro::ViewComponentDescriptor<HybridNitroUiFormShadowNode>;'
      );
      expect(code).not.toContain('react::ConcreteViewShadowNode<');
    });
  });

  it('is idempotent', () => {
    withFormTree(null, (root) => {
      expect(runPatch(root).status).toBe(0);
      const once = readFileSync(join(root, HPP), 'utf8');
      const again = runPatch(root);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain(
        'already-patched HybridNitroUiFormComponent.hpp'
      );
      expect(readFileSync(join(root, HPP), 'utf8')).toBe(once);
    });
  });

  it('fails when nitrogen stops generating the shape it matches', () => {
    // A shadow node that lost its props, its emitter or its state would still compile and be
    // quietly wrong, so an unrecognised alias is a hard failure rather than a skip.
    for (const [broken, message] of [
      [
        'react::CustomShadowNode<HybridNitroUiFormComponentName>;',
        'ShadowNode alias',
      ],
      [
        'using HybridNitroUiFormShadowNode = react::ConcreteViewShadowNode<' +
          'HybridNitroUiFormComponentName, HybridNitroUiFormProps, ' +
          'react::ViewEventEmitter>;',
        'no HybridNitroUiFormState',
      ],
    ]) {
      withFormTree(
        generatedHeader('HybridNitroUiForm').replace(
          [
            '  using HybridNitroUiFormShadowNode = react::ConcreteViewShadowNode' +
              '<HybridNitroUiFormComponentName,',
            '                                                                    ' +
              'HybridNitroUiFormProps /* custom props */,',
            '                                                                    ' +
              'react::ViewEventEmitter /* default */,',
            '                                                                    ' +
              'HybridNitroUiFormState /* custom state */>;',
          ].join('\n'),
          `  ${broken}`
        ),
        (root) => {
          const result = runPatch(root);
          expect(result.status).toBe(1);
          expect(result.stderr).toContain(message);
          expect(readFileSync(join(root, HPP), 'utf8')).not.toContain(
            'NitroUiScrollShadow'
          );
        }
      );
    }
  });

  it('refuses a sized view, whose state this node does not carry', () => {
    withFormTree(
      generatedHeader('HybridNitroUiForm').replace(
        'nitro::ViewPropsHolderState<HybridNitroUiFormProps>',
        '::margelo::nitro::nitroui::IntrinsicViewState<HybridNitroUiFormProps>'
      ),
      (root) => {
        const result = runPatch(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('expected to be unsized');
      }
    );
  });

  it('fails for a listed view nitrogen did not generate, or that nitro.json does not declare', () => {
    withContentViewTree(generated(), (root) => {
      rmSync(join(root, HPP));
      const result = runPatch(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'SCROLL_SHADOW_VIEWS lists HybridNitroUiForm'
      );
      expect(result.stderr).toContain('is the view generated?');
    });
    withContentViewTree(
      generated(),
      (root) => {
        const result = runPatch(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          'SCROLL_SHADOW_VIEWS lists HybridNitroUiForm, and nitro.json declares no NitroUiForm'
        );
      },
      { declare: false }
    );
  });

  it('asks nothing of a tree with no nitro.json', () => {
    withFormTree(null, (root) => {
      rmSync(join(root, 'nitro.json'));
      const result = runPatch(root);
      expect(result.status).toBe(0);
      expect(readFileSync(join(root, HPP), 'utf8')).not.toContain(
        'NitroUiScrollShadow'
      );
    });
  });

  it('is applied to the Form the repo generates', () => {
    const hpp = readFileSync(join(repoRoot, HPP), 'utf8');
    expect(hpp).toContain('// nitro-ui: scroll-corrected shadow node');
    expect(hpp).toContain(
      '::margelo::nitro::nitroui::ScrollShadowNode<HybridNitroUiFormComponentName'
    );
  });
});
