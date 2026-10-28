#!/usr/bin/env node
/**
 * Per-suite timing for a harness run (X11).
 *
 * Why: the ledger said `harness:android` took 455 s for 214 tests, and that is the whole
 * granularity available - so "Android costs three times iOS" could not be turned into "these five
 * files cost 200 s between them". A wall-clock total is not actionable; a per-file list is.
 *
 * The mechanism is the harness's own plugin API: `test-file:finished` hands over the file, its
 * duration, its status and its test results, which is exactly the row wanted and needs no log
 * parsing (the console prints no per-file durations at all). Registration happens in
 * `example/rn-harness.config.mjs` and only when `HARNESS_SUITE_TIMING` names a file, so an
 * uninvolved harness run stays exactly as it was.
 *
 * The file, not the ledger, is the hand-off: the harness process is the one that knows the numbers,
 * and the gate wrapper reads the file once the child has exited. It is written incrementally - each
 * finished file rewrites it - because the run that would have told you where the time went is
 * sometimes the run that times out or crashes.
 *
 * No `import.meta`: `scripts/__tests__/harness-suite-timing.test.js` imports this under Jest's
 * CommonJS transform, the same reason `scripts/lease-core.mjs` avoids it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What `example/rn-harness.config.mjs` reads to decide whether to register the plugin. */
export const SUITE_TIMING_ENV = 'HARNESS_SUITE_TIMING';

/** The shape of the hand-off file, so a stale one is detectable rather than misreadable. */
export const SUITE_TIMING_VERSION = 1;

/** `scripts/gate-core.mjs`'s `LEDGER_DIR`, spelled here so this module stays dependency-free. */
const LEDGER_SUBDIR = '.gates';

/**
 * Where a run's timings land, beside the ledger that will cite them. The pid is in the name
 * because two harness runs can be alive on one machine and this file records one of them; the
 * wrapper owns the name and hands it over through `HARNESS_SUITE_TIMING`, so the config never has
 * to guess a project root.
 */
export function suiteTimingPath({
  repoRoot,
  gate,
  pid = process.pid,
  startedAt = Date.now(),
}) {
  const safe = String(gate ?? 'harness').replaceAll(/[^\w.-]+/g, '+');
  return join(
    repoRoot,
    LEDGER_SUBDIR,
    'suite-timing',
    `${safe}-${startedAt}-${pid}.json`
  );
}

/** Turns an env value into the plugin's options, or null when timing was not asked for. */
export function suiteTimingFromEnv(env = process.env) {
  const file = env[SUITE_TIMING_ENV];
  return typeof file === 'string' && file.trim() !== ''
    ? { file: file.trim() }
    : null;
}

/** The record as it is written. `suites` is what the report reads; `total` is context for it. */
export function newSuiteTimingRecord({ gate, platform = null, startedAt }) {
  return {
    version: SUITE_TIMING_VERSION,
    gate: gate ?? null,
    platform: platform ?? null,
    startedAt,
    finishedAt: null,
    durationMs: null,
    status: null,
    /** Files the run was told to run; `unaccountedMs` is derived from it and `suites`. */
    fileCount: null,
    suites: [],
  };
}

/**
 * One `test-file:finished` context -> one row.
 *
 * `name` is the path relative to the runner's project root where possible: the absolute path is
 * the same string 45 times over with a different tail, and the tail is the only thing a reader
 * compares. `testBodyMs` sums the durations the *runtime* reports per test, which is what lets a
 * 40 s file be classified: a file whose tests add up to 35 s is slow tests, one whose tests add up
 * to 4 s is the app restart and bridge handshake around them. That difference is the question the
 * brief asks, and only the two numbers side by side can answer it.
 */
export function suiteTimingRow(ctx, { projectRoot = null } = {}) {
  const tests = flattenTests(ctx?.result);
  const testBodyMs = tests.reduce(
    (total, t) => total + (Number.isFinite(t?.duration) ? t.duration : 0),
    0
  );
  const failed = tests.filter((t) => t?.status === 'failed').length;
  return {
    file: relativeName(ctx?.file, projectRoot),
    durationMs: Number.isFinite(ctx?.duration)
      ? Math.round(ctx.duration)
      : null,
    status: ctx?.status ?? null,
    tests: tests.length,
    failed,
    testBodyMs: Math.round(testBodyMs),
  };
}

/**
 * The leaf tests of a `TestSuiteResult`.
 *
 * The harness hands back a *tree* (`{ name, tests, suites }`, nested `describe` blocks as children),
 * and the first version of this read `result.testResults` - a field that does not exist - so every
 * suite came back with `tests: 0` and `testBodyMs: 0` and the whole restart/test-body split was
 * silently wrong. A real run caught it; the fixture below is shaped like the real thing now.
 *
 * @param {object | null | undefined} result
 * @returns {object[]}
 */
export function flattenTests(result) {
  if (result == null || typeof result !== 'object') return [];
  const own = Array.isArray(result.tests) ? result.tests : [];
  const children = Array.isArray(result.suites) ? result.suites : [];
  return [...own, ...children.flatMap(flattenTests)];
}

/** `…/example/__tests__/Switch.harness.tsx` -> `__tests__/Switch.harness.tsx`. */ export function relativeName(
  file,
  projectRoot
) {
  const text = String(file ?? '');
  const root = projectRoot ? String(projectRoot).replace(/\/+$/, '') : null;
  if (root != null && text.startsWith(`${root}/`))
    return text.slice(root.length + 1);
  const marker = '/example/';
  const at = text.lastIndexOf(marker);
  if (at !== -1) return text.slice(at + marker.length);
  return text.split('/').slice(-2).join('/');
}

/**
 * Writes the record. Incremental on purpose: the file is readable after the first suite finishes,
 * which is the difference between "the sizing suite is the problem" and a guess, on a run that then
 * dies.
 */
export function writeSuiteTiming(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function readSuiteTiming(file) {
  if (!file) return null;
  let text = null;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (
      parsed?.version !== SUITE_TIMING_VERSION ||
      !Array.isArray(parsed.suites)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The gap between the run's wall clock and the sum of its files.
 *
 * Naming it matters: a run whose suites add up to 200 s but took 455 s spends 255 s outside any
 * suite - booting the device, building, bundling - and that is a different fix from a slow test.
 */
export function suiteTimingTotals(record) {
  const suites = record?.suites ?? [];
  const suiteMs = suites.reduce(
    (t, s) => t + (Number.isFinite(s.durationMs) ? s.durationMs : 0),
    0
  );
  const durationMs = Number.isFinite(record?.durationMs)
    ? record.durationMs
    : null;
  return {
    suiteMs: Math.round(suiteMs),
    testBodyMs: Math.round(
      suites.reduce(
        (t, s) => t + (Number.isFinite(s.testBodyMs) ? s.testBodyMs : 0),
        0
      )
    ),
    overheadMs: durationMs == null ? null : Math.round(durationMs - suiteMs),
    files: suites.length,
    failedFiles: suites.filter((s) => s.status === 'failed').length,
  };
}

/**
 * The table the ledger and the report print: slowest first, with the split that says *why*.
 * `overheadShare` is per row too - `duration - testBody` is the restart/handshake time that file
 * paid, which is the thing `resetEnvironmentBetweenTestFiles: 'runtime'` buys back if it is ever
 * removed.
 */
export function formatSuiteTimings(record, { limit = 10 } = {}) {
  const suites = [...(record?.suites ?? [])].sort(
    (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)
  );
  if (suites.length === 0) return '';
  const totals = suiteTimingTotals(record);
  const rows = suites.slice(0, limit).map((s) => {
    const overhead =
      Number.isFinite(s.durationMs) && Number.isFinite(s.testBodyMs)
        ? Math.round(s.durationMs - s.testBodyMs)
        : null;
    const flag = s.failed > 0 ? ` ${s.failed} failed` : '';
    return (
      `| \`${s.file}\` | ${formatSeconds(s.durationMs)} | ${formatSeconds(s.testBodyMs)} | ` +
      `${formatSeconds(overhead)} | ${s.tests ?? 0}${flag} |`
    );
  });
  return [
    `Suite timings (${record.gate ?? 'harness'}, ${formatSeconds(record.durationMs)} total, ` +
      `${totals.files} file(s), ${formatSeconds(totals.suiteMs)} in files, ` +
      `${formatSeconds(totals.overheadMs)} outside any file${
        totals.failedFiles > 0 ? `, ${totals.failedFiles} file(s) failed` : ''
      })`,
    '| Suite | File | Test bodies | Restart + handshake | Tests |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    suites.length > limit
      ? `| … ${suites.length - limit} more | | | | |`
      : null,
  ]
    .filter((x) => x != null)
    .join('\n');
}

function formatSeconds(ms) {
  if (!Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The plugin itself.
 *
 * A plugin is `{ name, hooks, createState? }` and the harness validates it structurally
 * (`isHarnessPlugin` in `@react-native-harness/plugins`), so it is built here without importing
 * `definePlugin` - which is an identity function - and this module stays loadable by a unit test
 * on a machine with no harness install.
 */
export function createSuiteTimingPlugin({
  file,
  gate = null,
  platform = null,
  startedAt = Date.now(),
  log = () => {},
}) {
  let record = newSuiteTimingRecord({ gate, platform, startedAt });

  const persist = () => {
    try {
      writeSuiteTiming(file, record);
    } catch (error) {
      // A timing hand-off that cannot be written must never take a harness run with it.
      log(
        `suite-timing: could not write ${file}: ${String(error?.message ?? error)}`
      );
    }
  };

  return {
    name: 'nitro-ui-suite-timing',
    hooks: {
      run: {
        started: (ctx) => {
          record = {
            ...record,
            gate: record.gate ?? ctx?.runner?.name ?? null,
            platform: record.platform ?? ctx?.platform?.platformId ?? null,
            fileCount: Array.isArray(ctx?.testFiles)
              ? ctx.testFiles.length
              : null,
          };
          persist();
        },
        finished: (ctx) => {
          record = {
            ...record,
            finishedAt: Date.now(),
            durationMs: Number.isFinite(ctx?.duration)
              ? Math.round(ctx.duration)
              : null,
            status: ctx?.status ?? null,
          };
          persist();
        },
      },
      testFile: {
        finished: (ctx) => {
          const row = suiteTimingRow(ctx, {
            projectRoot: ctx?.projectRoot ?? null,
          });
          const at = record.suites.findIndex((s) => s.file === row.file);
          if (at === -1) record.suites.push(row);
          else record.suites[at] = row;
          persist();
        },
      },
    },
  };
}

/**
 * The env-facing helper the harness config calls: build the plugin when the environment asked for
 * it, otherwise return null so the config's `plugins` array stays empty.
 *
 * The gate name is taken from the hand-off file's name (`harness+android-<ts>-<pid>.json`, see
 * `suiteTimingPath`), because the plugin would otherwise report the *runner* name and the two are
 * the same string only by luck - and a ledger row that cannot say which gate produced a timing is
 * the kind of evidence a report then has to explain.
 */
export function suiteTimingPluginFromEnv(
  env = process.env,
  { startedAt = Date.now() } = {}
) {
  const options = suiteTimingFromEnv(env);
  if (options == null) return null;
  return createSuiteTimingPlugin({
    ...options,
    gate: gateFromTimingFile(options.file),
    startedAt,
    log: (message) => console.log(message),
  });
}

/** `…/harness+android-1730000000000-4242.json` -> `harness:android`. */
export function gateFromTimingFile(file) {
  const base = String(file ?? '')
    .split('/')
    .pop();
  const match = /^(.*)-\d+-\d+\.json$/.exec(base ?? '');
  return match?.[1] != null ? match[1].replaceAll('+', ':') : null;
}
