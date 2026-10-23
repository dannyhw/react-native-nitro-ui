#!/usr/bin/env node
//
// patch-nitrogen.mjs
//
// Nitro 0.37.1 drops RN's base ViewProps on Android for Hybrid Views
// (backgroundColor, opacity, transform, testID, accessibility, ...) because the
// generated Props constructor never calls `Props::initializeDynamicProps`.
// Upstream fixed this in margelo/nitro#1749, but only in nightlies
// (react-native-nitro-modules >= 0.37.2-nightly), so codegen output that relies
// on it cannot build for users on 0.37.1. Instead we post-process nitrogen's
// output and ship the helper ourselves in cpp/NitroUiPropsCompat.hpp.
//
// Rules:
// - idempotent: run it twice, nothing changes;
// - skips files that already contain upstream's call;
// - hard-fails (exit 1) if a generated *Component.cpp has neither the upstream
//   call nor our anchor, so a nitrogen upgrade can never silently drop the fix;
// - no-op when there are no Hybrid Views (the views folder is missing/empty).
// - a view listed in the sizing config that nitrogen does not generate fails
//   too, so a renamed spec cannot silently lose its sizing.
//
// Second patch: intrinsic sizing (T11). Nitrogen hardcodes a view's shadow node,
// state and component descriptor, and all three have to change for a hosted
// control to report its real size to Yoga (`nitro::ViewComponentDescriptor` and
// `nitro::ViewPropsHolderState` are both `final`). For every view listed in
// `nitro-ui.sizing.json` we repoint the three generated aliases at our own types,
// add an `updateState:oldState:` hook to the generated iOS `.mm`, and one bind
// line to the generated Android manager. The aliases are what the rest of the
// generated code refers to, so nothing else has to change. See
// docs/architecture/sizing.md.
//
// Called by `bun run nitrogen`, which bob's `custom` target also runs, so
// `prepare`/`npm pack` always ship patched code.

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATCH_MARKER = '// nitro-ui: initializeDynamicProps';

const INCLUDE_ANCHOR = '#include <NitroModules/ReactProp.hpp>';
const COMPAT_INCLUDE = '#include "NitroUiPropsCompat.hpp"';
/** `) { }` closing the Props ctor, followed by `filterObjectKeys`. */
const EMPTY_CTOR = /\) \{ \}(\r?\n\r?\n[ ]{2}bool \w+::filterObjectKeys)/;
const UPSTREAM_CALL = 'RawPropsCompat::initializeDynamicProps';

/**
 * @param {string} source contents of a nitrogen-generated `*Component.cpp`
 * @param {string} fileName only used for error messages
 * @returns {{ code: string, status: 'patched' | 'already-patched' | 'upstream' | 'error', error?: string }}
 */
export function patchComponentSource(source, fileName = 'Component.cpp') {
  if (source.includes(UPSTREAM_CALL)) {
    return { code: source, status: 'upstream' };
  }
  if (source.includes(PATCH_MARKER)) {
    // Still assert the call is there, in case someone hand-edits half of it.
    return source.includes('::nitroui::compat::initializeDynamicProps(')
      ? { code: source, status: 'already-patched' }
      : {
          code: source,
          status: 'error',
          error: `${fileName}: marker found but the call is missing`,
        };
  }
  if (!EMPTY_CTOR.test(source)) {
    return {
      code: source,
      status: 'error',
      error: `${fileName}: Props constructor pattern not found - nitrogen changed its output shape, update patch-nitrogen.mjs (margelo/nitro#1656).`,
    };
  }
  if (!source.includes(INCLUDE_ANCHOR)) {
    return {
      code: source,
      status: 'error',
      error: `${fileName}: "${INCLUDE_ANCHOR}" not found - cannot add the compat include.`,
    };
  }

  let code = source;
  if (!code.includes(COMPAT_INCLUDE)) {
    code = code.replace(INCLUDE_ANCHOR, `${INCLUDE_ANCHOR}\n${COMPAT_INCLUDE}`);
  }
  code = code.replace(
    EMPTY_CTOR,
    `) {\n    ${PATCH_MARKER}\n    ::nitroui::compat::initializeDynamicProps(*this, sourceProps, rawProps, filterObjectKeys);\n  }$1`
  );
  return { code, status: 'patched' };
}

// ---------------------------------------------------------------------------
// Intrinsic sizing (T11)
// ---------------------------------------------------------------------------

export const SIZING_MARKER = '// nitro-ui: intrinsic sizing';
export const SIZING_CONFIG_FILE = 'nitro-ui.sizing.json';

const SIZING_POLICIES = new Set(['intrinsic', 'fillWidth']);
const SIZING_INCLUDE = '#include "NitroUiIntrinsic.hpp"';
const SIZING_INCLUDE_ANCHOR =
  '#include <NitroModules/ViewComponentDescriptor.hpp>';
const NITROUI = '::margelo::nitro::nitroui';

/**
 * Parse `<root>/nitro-ui.sizing.json`: which Hybrid Views size themselves, and
 * how (`{ "HybridNitroUiSwitch": "intrinsic" }`). No file means no view is
 * sized, which is a valid state; a bad policy or bad JSON is a hard failure.
 *
 * @param {string} root repository root
 * @returns {{ views: Map<string, string>, error: string | null }}
 */
export function readSizingConfig(root = process.cwd()) {
  const path = join(root, SIZING_CONFIG_FILE);
  if (!existsSync(path)) {
    return { views: new Map(), error: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      views: new Map(),
      error: `${SIZING_CONFIG_FILE}: ${error.message}`,
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      views: new Map(),
      error: `${SIZING_CONFIG_FILE}: expected {"HybridSwitch": "intrinsic"}.`,
    };
  }
  for (const [name, policy] of Object.entries(parsed)) {
    if (!SIZING_POLICIES.has(policy)) {
      return {
        views: new Map(),
        error: `${SIZING_CONFIG_FILE}: ${name} has policy "${policy}", expected ${[
          ...SIZING_POLICIES,
        ].join(' or ')}.`,
      };
    }
  }
  return { views: new Map(Object.entries(parsed)), error: null };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Point the three generated aliases at our state, shadow node and component
 * descriptor. Their names are what the rest of the generated code uses, so
 * everything else - the iOS `.mm`, the Android JNI, the descriptor provider -
 * keeps working untouched. See docs/architecture/sizing.md.
 *
 * @param {string} source contents of a generated `*Component.hpp`
 * @param {string} className spec class name, e.g. `HybridNitroUiSwitch`
 * @param {string} policy `intrinsic` or `fillWidth`
 * @param {string} fileName only used for error messages
 * @returns {{ code: string, status: string, error?: string }}
 */
export function patchSizingHeader(
  source,
  className,
  policy,
  fileName = 'Component.hpp'
) {
  const expected = [
    `IntrinsicViewState<${className}Props>`,
    `IntrinsicShadowNode<${className}ComponentName`,
    `IntrinsicComponentDescriptor<${className}ShadowNode>`,
    SIZING_INCLUDE,
  ];
  if (source.includes(SIZING_MARKER)) {
    const missing = expected.filter((part) => !source.includes(part));
    return missing.length === 0
      ? { code: source, status: 'already-patched' }
      : {
          code: source,
          status: 'error',
          error: `${fileName}: marker found but ${missing.join(', ')} is missing.`,
        };
  }

  const C = escapeRegExp(className);
  // nitrogen writes one alias per statement; allow any whitespace inside so a
  // reformat cannot turn a hard failure into a silent skip.
  const stateRe = new RegExp(
    `^([ \\t]*)using\\s+${C}State\\s*=\\s*nitro::ViewPropsHolderState\\s*<\\s*${C}Props\\s*>\\s*;`,
    'm'
  );
  const shadowNodeRe = new RegExp(
    `^([ \\t]*)using\\s+${C}ShadowNode\\s*=\\s*react::ConcreteViewShadowNode\\s*<[^;]*>\\s*;`,
    'm'
  );
  const descriptorRe = new RegExp(
    `^([ \\t]*)using\\s+${C}ComponentDescriptor\\s*=\\s*nitro::ViewComponentDescriptor\\s*<\\s*${C}ShadowNode\\s*>\\s*;`,
    'm'
  );

  const shapeError = (what) => ({
    code: source,
    status: 'error',
    error: `${fileName}: ${what} not found - nitrogen changed its output shape, update patch-nitrogen.mjs (docs/upstream.md).`,
  });

  if (!stateRe.test(source)) return shapeError(`${className}State alias`);
  const shadowNodeMatch = source.match(shadowNodeRe);
  if (shadowNodeMatch == null) {
    return shapeError(`${className}ShadowNode alias`);
  }
  // Refuse to replace an alias we do not recognise: a missing piece here means
  // the shadow node we would build loses nitrogen's props or our state.
  for (const part of [
    `${className}ComponentName`,
    `${className}Props`,
    'ViewEventEmitter',
    `${className}State`,
  ]) {
    if (!shadowNodeMatch[0].includes(part)) {
      return shapeError(`${className}ShadowNode alias (no ${part})`);
    }
  }
  if (!descriptorRe.test(source)) {
    return shapeError(`${className}ComponentDescriptor alias`);
  }
  if (!source.includes(SIZING_INCLUDE_ANCHOR)) {
    return shapeError(`"${SIZING_INCLUDE_ANCHOR}"`);
  }

  let code = source.replace(
    stateRe,
    (_all, indent) =>
      `${indent}${SIZING_MARKER} (policy: ${policy}, see docs/architecture/sizing.md):\n` +
      `${indent}using ${className}State = ${NITROUI}::IntrinsicViewState<${className}Props>;`
  );
  code = code.replace(
    shadowNodeRe,
    (_all, indent) =>
      `${indent}using ${className}ShadowNode =\n` +
      `${indent}    ${NITROUI}::IntrinsicShadowNode<${className}ComponentName, ${className}Props>;`
  );
  code = code.replace(
    descriptorRe,
    (_all, indent) =>
      `${indent}using ${className}ComponentDescriptor = ${NITROUI}::IntrinsicComponentDescriptor<${className}ShadowNode>;`
  );
  code = code.replace(
    SIZING_INCLUDE_ANCHOR,
    `${SIZING_INCLUDE_ANCHOR}\n${SIZING_INCLUDE}`
  );
  return { code, status: 'patched' };
}

/**
 * Give the generated iOS component view an `updateState:oldState:` override.
 * Without it the Swift host never sees Fabric state, so nothing could push a
 * measured size back into the shadow tree. The generated `.hpp` already pulls
 * in `NitroUiIntrinsic.hpp`, so no include is needed here.
 *
 * @param {string} source contents of a generated iOS `*Component.mm`
 * @param {string} className
 * @param {string} fileName only used for error messages
 * @returns {{ code: string, status: string, error?: string }}
 */
export function patchSizingObjC(source, className, fileName = 'Component.mm') {
  if (source.includes(SIZING_MARKER)) {
    return source.includes('- (void)updateState:') &&
      source.includes('eraseFabricState(state)')
      ? { code: source, status: 'already-patched' }
      : {
          code: source,
          status: 'error',
          error: `${fileName}: marker found but the updateState: override is missing.`,
        };
  }
  if (!source.includes(`@implementation ${className}Component`)) {
    return {
      code: source,
      status: 'error',
      error: `${fileName}: "@implementation ${className}Component" not found - nitrogen changed its output shape, update patch-nitrogen.mjs.`,
    };
  }
  // Hard-fail rather than insert a second one: a nitrogen that starts generating
  // this override itself would otherwise get a duplicate method - which Objective-
  // C++ accepts and resolves to whichever implementation the linker picks, so the
  // sizing bind would silently stop happening.
  if (source.includes('- (void)updateState:')) {
    return {
      code: source,
      status: 'error',
      error: `${fileName}: already defines updateState:oldState: - nitrogen generates it now, so this patch must be dropped rather than duplicated.`,
    };
  }
  const end = source.lastIndexOf('@end');
  if (end === -1) {
    return {
      code: source,
      status: 'error',
      error: `${fileName}: no "@end" to insert the state hook before.`,
    };
  }

  const method = [
    `${SIZING_MARKER} (docs/architecture/sizing.md)`,
    '//',
    '// The hosted control can only be measured on the main thread, so its size has',
    '// to reach the shadow tree through Fabric state. Bind this instance here:',
    '// `updateState:oldState:` runs on mount and on every state change, including',
    '// the ones our own push causes - which is what keeps the binding alive.',
    '- (void)updateState:(const facebook::react::State::Shared &)state',
    '           oldState:(const facebook::react::State::Shared &)oldState {',
    `  const auto sizingState = ${NITROUI}::eraseFabricState(state);`,
    `  ${NITROUI}::NitroUiSizingEngine::shared().bind(`,
    `      ${className}ComponentName, sizingState);`,
    '  [super updateState:state oldState:oldState];',
    '}',
    '',
  ].join('\n');
  return {
    code: `${source.slice(0, end)}${method}${source.slice(end)}`,
    status: 'patched',
  };
}

/**
 * Hand the generated Android manager's `StateWrapper` to the sizing engine.
 * Mirrors the iOS `updateState:oldState:` hook; the JNI side unwraps the
 * `StateWrapperImpl` the way @lodev09/react-native-true-sheet does.
 *
 * @param {string} source contents of a generated `*Manager.kt`
 * @param {string} className
 * @param {string} fileName only used for error messages
 * @returns {{ code: string, status: string, error?: string }}
 */
export function patchSizingKotlin(source, className, fileName = 'Manager.kt') {
  const IMPORT = 'import com.margelo.nitro.nitroui.core.NitroUiSizing';
  const shapeError = (what) => ({
    code: source,
    status: 'error',
    error: `${fileName}: ${what} not found - nitrogen changed its output shape, update patch-nitrogen.mjs.`,
  });

  if (source.includes(SIZING_MARKER)) {
    return source.includes('NitroUiSizing.bind(getName(), newState)') &&
      source.includes(IMPORT)
      ? { code: source, status: 'already-patched' }
      : {
          code: source,
          status: 'error',
          error: `${fileName}: marker found but the bind call or import is missing.`,
        };
  }

  // Same rule as the iOS hook: a `bind` that is already there means nitrogen
  // generates one, and a second call would bind every state change twice.
  if (source.includes('NitroUiSizing.bind(')) {
    return {
      code: source,
      status: 'error',
      error: `${fileName}: already calls NitroUiSizing.bind() - nitrogen generates the hook now, so this patch must be dropped rather than duplicated.`,
    };
  }

  const anchorRe = new RegExp(
    `^([ \\t]*)${escapeRegExp(className)}StateUpdater\\.updateViewProps\\(hybridView, newState, oldState\\)[ \\t]*$`,
    'm'
  );
  const anchor = source.match(anchorRe);
  if (anchor == null) return shapeError('the generated updateViewProps() call');
  const importAnchor = 'import com.margelo.nitro.nitroui.*';
  if (!source.includes(importAnchor)) return shapeError(`"${importAnchor}"`);

  let code = source.replace(
    anchorRe,
    (_all, indent) =>
      `${_all}\n` +
      `${indent}${SIZING_MARKER} (docs/architecture/sizing.md): hand this\n` +
      `${indent}// instance's Fabric state to the sizing engine, so the size Compose\n` +
      `${indent}// measures can be pushed back into the shadow tree.\n` +
      `${indent}NitroUiSizing.bind(getName(), newState)`
  );
  code = code.replace(importAnchor, `${importAnchor}\n${IMPORT}`);
  return { code, status: 'patched' };
}

/**
 * First match for `fileName` below `dir`, depth first. Generated Kotlin lives
 * under a package folder that only `nitro.json` knows about.
 *
 * @param {string} dir
 * @param {string} fileName
 * @returns {string | null}
 */
function findGeneratedFile(dir, fileName) {
  if (!existsSync(dir)) {
    return null;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = findGeneratedFile(join(dir, entry.name), fileName);
      if (nested != null) {
        return nested;
      }
    } else if (entry.name === fileName) {
      return join(dir, entry.name);
    }
  }
  return null;
}

/**
 * Apply one patch function to a generated file, writing only real changes.
 *
 * @param {string} path
 * @param {(source: string, fileName: string) => {code: string, status: string, error?: string}} patch
 * @returns {{ status: string, error?: string }}
 */
function applyToFile(path, patch) {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const source = readFileSync(path, 'utf8');
  const { code, status, error } = patch(source, fileName);
  if (error != null) {
    return { status: 'error', error };
  }
  if (status === 'patched') {
    writeFileSync(path, code);
  }
  return { status };
}

/**
 * Apply every post-processing step to a freshly generated `nitrogen/` tree.
 *
 * @param {string} root repository root (the directory that contains `nitrogen/`)
 * @param {{ sizingConfigRoot?: string }} [options] where to read
 *   `nitro-ui.sizing.json` from; `nitrogen-check.mjs` generates into a temp
 *   directory but the config lives in the repository.
 * @returns {{ count: number, results: { file: string, status: string }[] }}
 */
export function patchGeneratedViews(root = process.cwd(), options = {}) {
  const results = [];
  let failed = false;
  let count = 0;

  const record = (file, patch) => {
    count += 1;
    if (patch.error != null) {
      console.error(`patch-nitrogen: ${patch.error}`);
      failed = true;
      return;
    }
    results.push({ file, status: patch.status });
  };

  // 1. Base ViewProps on Android (margelo/nitro#1656), every generated view.
  const viewsDir = join(root, 'nitrogen/generated/shared/c++/views');
  if (existsSync(viewsDir)) {
    for (const file of readdirSync(viewsDir).filter((f) =>
      f.endsWith('Component.cpp')
    )) {
      record(
        file,
        applyToFile(join(viewsDir, file), (source, name) =>
          patchComponentSource(source, name)
        )
      );
    }
  }

  // 2. Intrinsic sizing (T11), only for the configured views.
  const { views, error } = readSizingConfig(options.sizingConfigRoot ?? root);
  if (error != null) {
    console.error(`patch-nitrogen: ${error}`);
    failed = true;
  }
  for (const [className, policy] of views) {
    const targets = [
      [
        join(viewsDir, `${className}Component.hpp`),
        (source, name) => patchSizingHeader(source, className, policy, name),
      ],
      [
        join(
          root,
          'nitrogen/generated/ios/c++/views',
          `${className}Component.mm`
        ),
        (source, name) => patchSizingObjC(source, className, name),
      ],
      [
        findGeneratedFile(
          join(root, 'nitrogen/generated/android/kotlin'),
          `${className}Manager.kt`
        ),
        (source, name) => patchSizingKotlin(source, className, name),
      ],
    ];
    for (const [path, patch] of targets) {
      if (path == null || !existsSync(path)) {
        record(className, {
          status: 'error',
          error: `${SIZING_CONFIG_FILE} lists ${className}, but ${path} does not exist - is the view generated?`,
        });
        continue;
      }
      record(path.slice(path.lastIndexOf('/') + 1), applyToFile(path, patch));
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
  return { count, results };
}

/**
 * Is this file the process entry point? `import.meta.url === 'file://' +
 * process.argv[1]` is not good enough: it breaks for any path that needs URL
 * percent-encoding (a space, `#`, `%`, non-ASCII), which silently turned the
 * CLI into a no-op - including its hard-fail - from such a checkout.
 * `import.meta.main` (Node >= 24, Bun) is exact; the path comparison is the
 * fallback for older runtimes.
 * @returns {boolean}
 */
function invokedDirectly() {
  if (typeof import.meta.main === 'boolean') {
    return import.meta.main;
  }
  const entry = process.argv[1];
  if (entry == null) {
    return false;
  }
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(resolve(entry))
    );
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const root = process.argv[2] ?? process.cwd();
  const { count, results } = patchGeneratedViews(root);
  if (count === 0) {
    console.log('patch-nitrogen: no Hybrid Views generated, nothing to do.');
  } else {
    for (const { file, status } of results) {
      console.log(`patch-nitrogen: ${status} ${file}`);
    }
  }
}
