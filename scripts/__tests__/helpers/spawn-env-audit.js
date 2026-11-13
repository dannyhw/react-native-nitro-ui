/**
 * The audit behind the "no test child inherits this shell's lease" guard.
 *
 * `test-env-scrub.test.js` asks two questions of every suite that spawns a CLI: does the child
 * still see the pair this shell sourced, and does it still see *this repo's* state directory
 * (`NITRO_UI_HOME`, the lease store and the build-slot file)? Answering them needs the tree, not
 * an assertion written against a remembered list, so the two reads live here:
 *
 *   - `deviceAwareScripts()` — which scripts under `scripts/` do something different depending on
 *     a device-identity variable;
 *   - `childEnvSites()` — which spawn calls in a suite hand the child an environment of their own,
 *     and whether one of them copies `process.env` in.
 *
 * Why the derived question rather than a list: X32 and X33 both paid for a *suite nobody had
 * thought about* (`bench-baseline-merge.test.js` runs a real `bench/run.mjs`), and both recorded
 * the workaround "unsource your lease before running `check`" — a suite that only passes in a
 * shell a task does not have. A hand-maintained list of device-aware scripts is the same mistake
 * one level up: it is right the day it is written and silently wrong the day a script starts
 * reading `ANDROID_SERIAL`.
 *
 * Why `NITRO_UI_HOME` is one of the identities: a child that inherits it reads somebody else's
 * `leases.json`, and a device gate told which lease it holds by that file stops trusting the
 * environment in front of it. `lease.test.js` and its siblings set it per test for exactly that
 * reason, so both the scrubber and this audit name it.
 *
 * @file Not a jest module: no fixtures, no assertions. `helpers/free-lsof-stub.js` is the same
 *       shape, and `test-env-scrub.test.js` is the only consumer.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The environment variables that *identify a device* (or the lease holding one).
 *
 * A hand-written list, deliberately: it is short, it is the set `lease.mjs` prints, and
 * `test-env-scrub.test.js` compares it against the renderer that produces those names, so it
 * cannot quietly lose one. A script under `scripts/` that reads one of these is device aware.
 *
 * `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`ANDROID_AVD_HOME` are absent: they say where the SDK is, not
 * which device to touch, and every task on the box shares them.
 */
export const DEVICE_AWARE_ENV_NAMES = [
  'NITRO_UI_LEASE_ID',
  'NITRO_UI_LEASE_TASK',
  'NITRO_UI_LEASE_PLATFORM',
  'NITRO_UI_LEASE_PAIR',
  'NITRO_UI_LEASE_BOOT',
  'NITRO_UI_HOME',
  'NITRO_UI_TASK',
  'HARNESS_APP_PATH',
  'IOS_SIM',
  'IOS_SIM_UDID',
  'IOS_UDID',
  'IOS_VERSION',
  'IOS_DEVICE',
  'ANDROID_SERIAL',
  'ANDROID_AVD',
  'ANDROID_API_LEVEL',
  'ANDROID_ADB_SERVER_PORT',
  'AVD',
  'AVD_PROFILE',
  'EMULATOR_PORT',
  'EMULATOR_BIN',
  'METRO_PORT',
];

/**
 * A script counts as device aware if it names one of these or reaches for the helper that reads
 * them as a set (`requireLeaseDevice` refuses a run whose lease env is half-sourced;
 * `checkEmulatorEnv` refuses a serial and a port that disagree — the X32/X33 refusal).
 */
const DEVICE_AWARE_HELPER_RE =
  /\b(?:requireLeaseDevice|checkEmulatorEnv|leaseDeviceFromEnv)\b/u;

/**
 * Which scripts under `sourceDir` read a device identity out of the environment.
 *
 * @param {string} sourceDir usually `<repo>/scripts`
 * @returns {Map<string, {names: string[], source: string}>} script path -> what it reads
 */
export function deviceAwareScripts(sourceDir) {
  const found = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        // The suites are the thing under audit, and `node_modules` is not this repo's code.
        if (entry.name === '__tests__' || entry.name === 'node_modules')
          continue;
        walk(absolute);
        continue;
      }
      if (!/\.(?:mjs|js|sh)$/u.test(entry.name)) continue;
      let source;
      try {
        source = readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }
      const names = DEVICE_AWARE_ENV_NAMES.filter((name) =>
        new RegExp(
          `(?:process\\.env\\.|\\benv\\.|\\$\\{?\\b)${name}\\b`,
          'u'
        ).test(source)
      );
      if (names.length === 0 && !DEVICE_AWARE_HELPER_RE.test(source)) continue;
      found.set(absolute, { names, source });
    }
  };
  walk(sourceDir);
  return found;
}

/**
 * The balanced argument list of the spawn call whose line is `lineIndex`.
 *
 * Balanced on parentheses, which is all this needs: the only thing read afterwards is whether the
 * call's own text mentions `process.env` and `withoutLeaseEnv`, and both are inside one call's
 * parentheses however the file is wrapped. A template literal containing an unbalanced bracket
 * would throw the window off, so the scan reports the line it started from — a wrong window shows
 * up as an unreadable site, not as a silently skipped one.
 */
function callWindow(source, lineIndex) {
  const lines = source.split('\n');
  let depth = 0;
  let opened = false;
  for (let index = lineIndex; index < lines.length; index += 1) {
    const line = lines[index];
    for (const character of line) {
      if (character === '(') {
        depth += 1;
        opened = true;
      } else if (character === ')') depth -= 1;
    }
    if (opened && depth <= 0) {
      return lines.slice(lineIndex, index + 2).join('\n');
    }
  }
  return lines.slice(lineIndex, lineIndex + 40).join('\n');
}

/**
 * Which characters of a file are *data*: the inside of a string, a template literal, or a comment.
 *
 * Returned as one mask row per source row — same length, `D` where the character is data and the
 * character itself elsewhere — rather than as a rewritten copy of the source, because the audit
 * reads quoted script paths out of those strings (`'gate.mjs'` in a spawn call is the signal). Only
 * the *position of a `spawn(` token* is ever asked about here.
 *
 * A line-oriented scan, deliberately: a quoted string cannot cross a newline, so a quote inside a
 * regex literal or some other unusual token damages the one line it sits on instead of quietly
 * declaring the rest of the file data. Comments are marked for the same reason — the apostrophe in
 * An apostrophe in prose would otherwise open a string that never closes.
 *
 * @param {string} source
 * @returns {string[]} one row per line of `source`
 */
export function dataMask(source) {
  const rows = [];
  let row = '';
  let state = 'code';
  let index = 0;
  const put = (character, isData) => {
    row += isData ? 'D' : character;
  };
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '\n') {
      rows.push(row);
      row = '';
      // A quote dies at a newline; a comment and a template literal do not.
      if (state === 'single' || state === 'double' || state === 'line')
        state = 'code';
      index += 1;
      continue;
    }
    if (state === 'code') {
      if (character === '/' && (next === '/' || next === '*')) {
        state = next === '/' ? 'line' : 'block';
        put(' ', true);
        put(' ', true);
        index += 2;
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        state =
          character === "'"
            ? 'single'
            : character === '"'
              ? 'double'
              : 'template';
        // The quote itself stays code: it is what a reader of the mask sees of the string.
        put(character, false);
        index += 1;
        continue;
      }
      put(character, false);
      index += 1;
      continue;
    }
    if (state === 'line') {
      put(character, true);
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (character === '*' && next === '/') {
        state = 'code';
        put(' ', true);
        put(' ', true);
        index += 2;
        continue;
      }
      put(character, true);
      index += 1;
      continue;
    }
    if (character === '\\') {
      // An escape and what it escapes are one piece of the body.
      put(character, true);
      if (next != null && next !== '\n') {
        put(next, true);
        index += 1;
      }
      index += 1;
      continue;
    }
    const closer = state === 'single' ? "'" : state === 'double' ? '"' : '`';
    if (character === closer) {
      state = 'code';
      put(character, false);
      index += 1;
      continue;
    }
    put(character, true);
    index += 1;
  }
  rows.push(row);
  return rows;
}

/**
 * The spawn calls in one suite file, with the window of source each call spans.
 *
 * @param {string} source
 * @returns {Array<{line: number, window: string, targetText: string}>} `targetText` is the part
 *   before the `env:` property, which is where the command and script name live.
 */
export function spawnCalls(source) {
  const lines = source.split('\n');
  const mask = dataMask(source);
  const calls = [];
  for (let index = 0; index < lines.length; index += 1) {
    const pattern = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(/gu;
    let called = null;
    for (
      let found = pattern.exec(lines[index]);
      found != null;
      found = pattern.exec(lines[index])
    ) {
      // Generated source is not a call site of this file. A suite that builds a CLI out of a
      // string (`gate-runner.test.js` writes a whole gate this way, comments and all) has one
      // environment for the script it generates: the spawn that *starts* it, which is on this
      // list and judged like any other. Reading the generated `spawn(` as a site of its own turns
      // the phrase "exactly as `gate.mjs` starts it" into a device-aware call, and a guard with
      // that in its output is a guard somebody widens away within a week.
      if ((mask[index] ?? '')[found.index] !== 'D') {
        called = found;
        break;
      }
    }
    if (called == null) continue;
    const window = callWindow(source, index);
    const envAt = window.search(/^\s*env\s*:/u);
    calls.push({
      line: index + 1,
      window,
      targetText: envAt === -1 ? window : window.slice(0, envAt),
    });
  }
  return calls;
}

/**
 * Does this call hand the child the environment of the process running the suite?
 *
 * Three shapes count: a spread of `process.env`, `env: process.env`, and a spread of a name that
 * is nothing but `process.env` (`const base = process.env` … `...base`). A call with no `env:`
 * property at all is *not* one of them: it inherits, and inheritance is the boot-time scrub's
 * business, not this site's.
 */
export function callSpreadsProcessEnv(callWindow) {
  return /(?:\.\.\.|\benv\s*:\s*)process\.env\b/u.test(callWindow);
}

/** Does this call scrub before it spreads? */
export function callScrubsLease(callWindow) {
  return /\b(?:withoutLeaseEnv|childEnv)\s*\(/u.test(callWindow);
}

/**
 * The identifiers a call's `env:` value is built from, when it is built from something.
 *
 * `env: env(extra)` (`lease-metro-port.test.js`) and `env: box.env` (`ci-workflows.test.js`) are
 * the two shapes in this repo: the environment is assembled once, in a helper, and passed to a
 * dozen spawn calls. Reading only the call would call those sites clean whether the helper scrubbed
 * or not, which is the hole the X32/X33 suites fell through — so the audit follows one level and
 * reads the definition.
 */
export function envValueIdentifiers(callWindow) {
  // Not anchored to one shape: `env:` opens its own line in most suites and sits inline in
  // `{ cwd, env: { … }, encoding }` in others (`ci-workflows.test.js`). A scan that missed the
  // inline form would report a hand-built allow-list environment as an inherited one, and a guard
  // that cries wolf once is a guard that gets widened away.
  const property =
    /(?:^|[{,(])\s*env\s*:\s*([A-Za-z_$][\w$]*(?:\.\w+)?)/mu.exec(callWindow);
  if (property == null) return [];
  const value = property[1];
  if (value === 'process') return [];
  return [value.includes('.') ? value.split('.')[0] : value];
}

/**
 * Does this call name an environment at all, in either spelling (`env:` or the `env,` shorthand)?
 *
 * A call that does not is not neutral: it hands the child the suite's own `process.env`, which is
 * the most inherited thing there is. The guard therefore asks this before it asks whether a site
 * spreads `process.env` — an omitted `env` is the leak with the spelling removed.
 */
export function callSetsEnv(callWindow) {
  return (
    /(?:^|[{,(])\s*env\s*:/mu.test(callWindow) ||
    /[{,(]\s*env\s*,/u.test(callWindow)
  );
}

/**
 * The text that defines `name` in this file, for as long as its body looks like it lasts.
 *
 * A textual look-up, not a scope resolution: a suite defines its env builder once, near the spawn
 * calls that use it, and 40 lines covers every one in this directory. A name with no definition
 * contributes nothing, and the site is then judged on its own window.
 */
export function definitionText(fileSource, name) {
  const lines = fileSource.split('\n');
  // Plain string matching, no dynamic `RegExp`: the transform this directory's tests run through
  // rewrites a constructed pattern into something the engine rejects (a `(` appears where the class
  // started), and a scan that throws reads as a broken suite rather than as a missed site.
  const opening = /^\s*[(=]/u;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/^\s+/, '');
    let rest = null;
    for (const keyword of [
      'const ',
      'let ',
      'var ',
      'function ',
      'async function ',
    ]) {
      if (
        line.startsWith(keyword) &&
        line.slice(keyword.length).startsWith(name)
      ) {
        rest = line.slice(keyword.length + name.length);
      }
    }
    if (rest == null && line.startsWith(name)) rest = line.slice(name.length);
    if (rest == null || !opening.test(rest)) continue;
    return lines.slice(index, index + 40).join('\n');
  }
  return '';
}

/**
 * Which device-aware script (if any) a spawn call runs, resolved through the file's own constants.
 *
 * Suites name their CLI once (`const CLI = join(REPO_ROOT, 'scripts', 'lease.mjs')`) and spawn
 * `CLI` from twenty places. Matching only literal paths would therefore report nothing; matching
 * the identifier once per *definition site* — where the text that defines it necessarily names the
 * script — covers every use without pretending to do control flow.
 *
 * @param {string} callWindow
 * @param {string} fileSource the whole suite file
 * @param {Map<string, {names: string[], source: string}>} aware from `deviceAwareScripts`
 * @returns {{script: string, names: string[]} | null}
 */
export function deviceAwareTarget(callWindow, fileSource, aware) {
  const basenames = new Map();
  for (const [script, info] of aware) basenames.set(script, info);
  // Literal path in the call itself.
  for (const [script, info] of basenames) {
    const base = script.split('/').pop();
    if (
      new RegExp(`['"\`]${base.replace(/[.]/g, '\\.')}['"\`]`, 'u').test(
        callWindow
      )
    ) {
      return { script, names: info.names };
    }
  }
  // An identifier defined as that path somewhere in the same file.
  for (const line of fileSource.split('\n')) {
    const declared = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/u.exec(
      line
    );
    if (declared == null) continue;
    const name = declared[1];
    if (!new RegExp(`\\b${name}\\b`, 'u').test(callWindow)) continue;
    for (const [script, info] of basenames) {
      const base = script.split('/').pop();
      if (
        new RegExp(`['"\`]${base.replace(/[.]/g, '\\.')}['"\`]`, 'u').test(line)
      ) {
        return { script, names: info.names };
      }
    }
  }
  return null;
}
