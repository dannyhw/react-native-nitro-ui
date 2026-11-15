#!/usr/bin/env node
/**
 * Per-suite timing for a harness run: a harness plugin that writes each finished
 * test file's duration to a hand-off file, which `gate.mjs` reads once the run
 * has exited. `example/rn-harness.config.mjs` registers it only when
 * `HARNESS_SUITE_TIMING` names a file.
 *
 * No `import.meta`: Jest imports this under its CommonJS transform.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What `example/rn-harness.config.mjs` reads to decide whether to register the plugin. */
export const SUITE_TIMING_ENV = 'HARNESS_SUITE_TIMING';

/**
 * The gate the hand-off belongs to, as its caller spelled it. Optional: the name
 * can be recovered from the file name, but only approximately, because the log
 * name folds every character outside `[\w.-]` to `+`.
 */
export const SUITE_TIMING_GATE_ENV = 'HARNESS_SUITE_TIMING_GATE';

/** The shape of the hand-off file, so a stale one is detectable rather than misreadable. */
export const SUITE_TIMING_VERSION = 1;

/**
 * The hand-off file for a run: `<log>.suites.json`, beside the run's log in the
 * gate log store, so retention sweeps it with the log.
 */
export function suiteTimingPath(absoluteLogFile) {
  const file = String(absoluteLogFile ?? '').trim();
  return file === '' ? null : `${file}.suites.json`;
}

/** The suffix `gate.mjs` appends to a run's log to name its timings, in both directions. */
export const SUITE_TIMING_SUFFIX = '.suites.json';

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
 * One `test-file:finished` context -> one row. `name` is relative to the runner's
 * project root where possible. `testBodyMs` sums the per-test durations the
 * runtime reports, so the rest of a file's duration is the app restart and
 * bridge handshake around its tests.
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
 * The leaf tests of a `TestSuiteResult`, which is a tree: `{ name, tests, suites }`
 * with nested `describe` blocks as children.
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
 * Writes the record. Called after every suite, so the file is readable on a run
 * that later dies.
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
 * The gap between the run's wall clock and the sum of its files: time spent
 * outside any suite, such as booting the device and bundling.
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
 * The table the ledger and the report print: slowest first. `duration - testBody`
 * is the restart and handshake time a file paid.
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
 * The plugin itself. A plugin is `{ name, hooks, createState? }` and the harness
 * validates it structurally, so it is built without importing `definePlugin` and
 * this module loads on a machine with no harness install.
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
 * Builds the plugin when the environment asked for it, otherwise returns null.
 * The gate name comes from `SUITE_TIMING_GATE_ENV` when set, and is otherwise
 * reconstructed from the hand-off file's name.
 */
export function suiteTimingPluginFromEnv(
  env = process.env,
  { startedAt = Date.now() } = {}
) {
  const options = suiteTimingFromEnv(env);
  if (options == null) return null;
  const fromEnv = String(env[SUITE_TIMING_GATE_ENV] ?? '').trim();
  return createSuiteTimingPlugin({
    ...options,
    gate: fromEnv !== '' ? fromEnv : gateFromTimingFile(options.file),
    startedAt,
    log: (message) => console.log(message),
  });
}

/**
 * The gate a hand-off file belongs to, read back from its name. Both
 * `<safeGate>-<iso>.log.suites.json` and the older `<safeGate>-<ms>-<pid>.json`
 * are recognised. The result is approximate for a gate argument that contained
 * a character the safe spelling folds into `+`.
 */
export function gateFromTimingFile(file) {
  const base = String(file ?? '')
    .split('/')
    .pop();
  if (base == null) return null;
  const current = /^(.*)-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.log$/.exec(
    base.endsWith(SUITE_TIMING_SUFFIX)
      ? base.slice(0, -SUITE_TIMING_SUFFIX.length)
      : ''
  );
  if (current?.[1] != null) return current[1].replaceAll('+', ':');
  const legacy = /^(.*)-\d+-\d+\.json$/.exec(base);
  return legacy?.[1] != null ? legacy[1].replaceAll('+', ':') : null;
}
