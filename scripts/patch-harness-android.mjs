#!/usr/bin/env node
/**
 * Regenerates `patches/@react-native-harness%2Fplatform-android@1.6.0.patch`
 * from the blocks in `scripts/emulator-launch.mjs`.
 *
 *   node scripts/patch-harness-android.mjs           # rewrite the patch
 *   node scripts/patch-harness-android.mjs --check    # fail if it is stale
 *
 * It reverses the patch on disk out of the installed file to recover upstream's
 * text, replaces the known upstream fragments with what
 * `scripts/emulator-launch.mjs` renders, and diffs the pair. Run `bun install`
 * afterwards so `node_modules` matches the new patch.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  harnessLaunchBlock,
  harnessAccelBlock,
  harnessAccelCallerLines,
} from './emulator-launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const PACKAGE = '@react-native-harness/platform-android';
const TARGET = 'dist/emulator-startup.js';
const PATCH_FILE = path.join(
  repoRoot,
  'patches',
  '@react-native-harness%2Fplatform-android@1.6.0.patch'
);

/** The three upstream fragments this patch replaces, verbatim. */
const UPSTREAM = {
  launchArgs: `    return [\`@\${name}\`, ...modeArgs, ...COMMON_EMULATOR_ARGS];\n`,
  accelParser: `/**
 * Parses the output of \`emulator -accel-check\` to determine whether
 * hardware acceleration (KVM on Linux, HVF on macOS) is usable. The
 * emulator prints a message containing "is installed and usable" when
 * acceleration is available.
 */
export const isAccelerationUsable = (accelCheckOutput) => {
    return accelCheckOutput.includes('is installed and usable');
};
`,
  accelCallerDeclare: `export const warnIfEmulatorAccelerationUnavailable = async () => {
    let combinedOutput;
`,
  accelCallerCatch: `            combinedOutput = \`\${error.stdout}\\n\${error.stderr}\`;
        }
`,
  accelCallerCall: `    if (!isAccelerationUsable(combinedOutput)) {
`,
};

/** The replacement for each fragment, built from the rendered blocks. */
function replacements() {
  const launchLines = harnessAccelCallerLines();
  return [
    ['launch args', UPSTREAM.launchArgs, `${harnessLaunchBlock()}\n`],
    ['accel parser', UPSTREAM.accelParser, `${harnessAccelBlock()}\n`],
    [
      'accel call: declaration',
      UPSTREAM.accelCallerDeclare,
      `${UPSTREAM.accelCallerDeclare}    ${launchLines[0]}\n`,
    ],
    [
      'accel call: exit status',
      UPSTREAM.accelCallerCatch,
      `            combinedOutput = \`\${error.stdout}\\n\${error.stderr}\`;\n            ${launchLines[1]}\n        }\n`,
    ],
    [
      'accel call: condition',
      UPSTREAM.accelCallerCall,
      `    if (!${launchLines[2]}) {\n`,
    ],
  ];
}

function git(args, options = {}) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

/** git's blob hash, which is what a patch header records. */
function blobHash(content) {
  const result = git(['hash-object', '--stdin'], { input: content });
  const hash = String(result.stdout).trim();
  if (result.status !== 0 || hash === '')
    throw new Error(`git hash-object failed: ${result.stderr}`);
  return hash;
}

/**
 * The pristine module: the installed file with the applied patch reversed. The
 * applied patch is not always the one on disk (regenerating is when they
 * differ), so the file on disk is tried first, then the committed one.
 *
 * @param {{installedPath: string, candidates: Array<{label: string, text: string}>}} options
 * @returns {string} pristine text
 */
function pristineFrom({ installedPath, candidates }) {
  const installed = fs.readFileSync(installedPath, 'utf8');
  const problems = [];
  for (const candidate of candidates) {
    if (candidate.text === '') continue;
    const attempt = reverse({ installed, patchText: candidate.text });
    if (attempt.pristine != null) return attempt.pristine;
    problems.push(`${candidate.label}: ${attempt.problem}`);
  }
  throw new Error(
    `cannot recover the pristine ${PACKAGE}/${TARGET} to diff against:\n` +
      problems.map((problem) => `  - ${problem}`).join('\n') +
      '\n  the installed package is not any patch this repo knows about. Run' +
      ' `rm -rf node_modules && bun install` and try again.'
  );
}

/** @returns {{pristine: string | null, problem: string | null}} */
function reverse({ installed, patchText }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-patch-'));
  try {
    // `git apply` wants the a/ b/ layout the patch was written against.
    const work = path.join(dir, 'work');
    fs.mkdirSync(path.join(work, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(work, TARGET), installed);
    const patchPath = path.join(dir, 'candidate.patch');
    fs.writeFileSync(patchPath, patchText);
    const reversed = git(['apply', '-R', '--whitespace=nowarn', patchPath], {
      cwd: work,
    });
    if (reversed.status !== 0) {
      return {
        pristine: null,
        problem: `does not apply in reverse (${String(reversed.stderr).trim().split('\n')[0] ?? 'no detail'})`,
      };
    }
    const pristine = fs.readFileSync(path.join(work, TARGET), 'utf8');
    if (pristine.includes('nitro-ui')) {
      return {
        pristine: null,
        problem: 'reversing it left nitro-ui text behind',
      };
    }
    return { pristine, problem: null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The patch as git last saw it, or '' when there is no such commit. */
function committedPatchText() {
  const relative = path.relative(repoRoot, PATCH_FILE);
  const result = git(['show', `HEAD:${relative}`], { cwd: repoRoot });
  return result.status === 0 ? String(result.stdout) : '';
}

/**
 * The patch text for the current blocks.
 *
 * @param {string} pristine
 * @returns {string}
 */
export function renderPatch(pristine) {
  let patched = pristine;
  for (const [what, before, after] of replacements()) {
    if (!patched.includes(before)) {
      throw new Error(
        `${PACKAGE}/${TARGET} no longer contains the upstream "${what}" block. ` +
          'Upstream changed this file: update scripts/patch-harness-android.mjs ' +
          'and scripts/emulator-launch.mjs together, from a clean install.'
      );
    }
    patched = patched.replace(before, after);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-patch-diff-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), pristine);
    fs.writeFileSync(path.join(dir, 'b.js'), patched);
    const diff = git(['diff', '--no-index', '-U3', '--', 'a.js', 'b.js'], {
      cwd: dir,
    });
    // `git diff --no-index` exits 1 when the files differ, which is the normal
    // answer here; 0 means the patch would be empty, which is a bug, not success.
    if (diff.status === 0)
      throw new Error('the rendered patch is empty - nothing was replaced');
    if (diff.status !== 1)
      throw new Error(
        `git diff failed (${String(diff.status)}): ${diff.stderr}`
      );
    const hunks = diff.stdout.split('\n').slice(4).join('\n');
    return [
      `diff --git a/${TARGET} b/${TARGET}`,
      `index ${blobHash(pristine)}..${blobHash(patched)} 100644`,
      `--- a/${TARGET}`,
      `+++ b/${TARGET}`,
      hunks.replace(/\n+$/, '\n'),
    ].join('\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Trailing whitespace and the final newline are not what anyone edits on purpose. */
function normalize(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trimEnd();
}

function main(argv) {
  const check = argv.includes('--check');
  const nodeModules = path.join(repoRoot, 'node_modules');
  const installedPath = path.join(nodeModules, PACKAGE, TARGET);
  if (!fs.existsSync(installedPath)) {
    // No install to recover upstream's text from. The drift test still checks
    // the patch text, so staying quiet here hides nothing.
    process.stdout.write(
      `patch-harness-android: ${PACKAGE} is not installed, so nothing to ` +
        `${check ? 'check' : 'regenerate'} (run \`bun install\`).\n`
    );
    return 0;
  }
  const patchText = fs.existsSync(PATCH_FILE)
    ? fs.readFileSync(PATCH_FILE, 'utf8')
    : '';
  if (patchText === '') {
    throw new Error(
      `no patch at ${path.relative(repoRoot, PATCH_FILE)} to recover upstream's ` +
        'text from. Restore it from git, or apply the blocks by hand once and ' +
        're-run this script.'
    );
  }
  const expected = renderPatch(
    pristineFrom({
      installedPath,
      candidates: [
        { label: 'the patch on disk', text: patchText },
        { label: 'the patch at HEAD', text: committedPatchText() },
      ],
    })
  );
  if (check) {
    if (normalize(patchText) === normalize(expected)) {
      process.stdout.write(
        `patch-harness-android: ${path.relative(repoRoot, PATCH_FILE)} matches ` +
          'scripts/emulator-launch.mjs\n'
      );
      return 0;
    }
    process.stderr.write(
      `patch-harness-android: ${path.relative(repoRoot, PATCH_FILE)} is not what ` +
        'scripts/emulator-launch.mjs renders.\n' +
        '  fix: node scripts/patch-harness-android.mjs && bun install\n'
    );
    return 1;
  }
  fs.writeFileSync(PATCH_FILE, expected);
  process.stdout.write(
    `patch-harness-android: wrote ${path.relative(repoRoot, PATCH_FILE)}\n` +
      '  run `bun install` so node_modules matches it\n'
  );
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`patch-harness-android: ${String(error.message)}\n`);
  process.exit(1);
}
