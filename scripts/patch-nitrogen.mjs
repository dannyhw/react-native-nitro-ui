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

/**
 * @param {string} root repository root (the directory that contains `nitrogen/`)
 * @returns {{ count: number, results: { file: string, status: string }[] }}
 */
export function patchGeneratedViews(root = process.cwd()) {
  const dir = join(root, 'nitrogen/generated/shared/c++/views');
  if (!existsSync(dir)) {
    // No Hybrid Views in this package yet - nothing to patch.
    return { count: 0, results: [] };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('Component.cpp'));
  const results = [];
  let failed = false;
  for (const file of files) {
    const path = join(dir, file);
    const { code, status, error } = patchComponentSource(
      readFileSync(path, 'utf8'),
      file
    );
    if (status === 'error') {
      console.error(`patch-nitrogen: ${error}`);
      failed = true;
      continue;
    }
    if (status === 'patched') {
      writeFileSync(path, code);
    }
    results.push({ file, status });
  }
  if (failed) {
    process.exitCode = 1;
  }
  return { count: files.length, results };
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
