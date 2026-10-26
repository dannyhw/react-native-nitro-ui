/**
 * Aggregate, print, compare and gate benchmark results.
 *
 *   node scripts/bench/report.mjs [results.json] [--compare <git-ref|file>]
 *                               [--check] [--update-baseline] [--force]
 *
 * Reading the output
 * -----------------
 * Every headline number is a **median of per-launch medians** with the MAD of
 * those launch medians beside it, which is the unit the protocol varies (a fresh
 * process per launch, launches interleaved ABBA across implementations). `p95`
 * is over the pooled iterations, because a tail only shows up there.
 * Smaller is better everywhere.
 *
 * What gates (docs/DECISIONS.md D9, implemented once in `gate()`):
 *
 * 1. Every metric is first turned into a **launch-paired ratio to `rn-core`**:
 *    launch N's arm median over launch N's control median, so machine drift
 *    cancels instead of being measured and excused.
 * 2. `--compare <ref>` gates `head(x/rn-core) / base(x/rn-core)`; `--check`
 *    compares the same ratios with a committed ratio-only baseline.
 * 3. A ratio over 1.20 fails only when its bootstrap 95% CI excludes 1.05 *and*
 *    the within-run spread of that (scenario, N, metric) is quiet. Noise is
 *    judged per cell and metric inside the run - never by absolute drift against
 *    a baseline, which used to make the gate unable to fire.
 * 4. Only `nitro-ui` arms are gated. `rn-core` is the control and `expo-ui-*`
 *    are reference arms: they inform review, they do not fail a nitro-ui PR.
 *
 * This file is the single implementation of the gate: `run.mjs` calls
 * `comparisonSections()` with the same arguments it prints, so the standalone
 * reporter cannot drift from the runner again.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatCommittedJsonFile } from './format.mjs';

import {
  SCHEMA_VERSION,
  baselineBlockers,
  baselineNoise,
  baselineTable,
  buildBaseline,
  isCompatibleBaseline,
  newestResultsName,
} from './lib.mjs';
import { comparisonSections, renderMarkdown } from './render.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
export const RESULTS_DIR = path.join(REPO_ROOT, 'bench', 'results');
export const BASELINES_DIR = path.join(REPO_ROOT, 'bench', 'baselines');

/**
 * `deviceKey` already carries the platform and the OS runtime (D9:
 * `ios27-sim-iphoneair`, `android35-emu-pixel9`), so the file is named after the
 * device key alone. A baseline is only comparable to runs on that device.
 */
export function baselinePath(deviceKey) {
  return path.join(BASELINES_DIR, `${deviceKey}.json`);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* ------------------------------- comparisons ------------------------------ */

/**
 * Resolve `--compare <ref|file>` to a results file. A bare ref resolves to the
 * newest *clean* results file of that sha (dirty runs are named `-dirty-` and
 * only match when nothing clean exists), so two runs of one commit can no
 * longer overwrite each other.
 */
export function resolveCompareTarget(value, platform) {
  if (fs.existsSync(value)) {
    return { file: value, label: path.basename(value, '.json') };
  }
  const names = fs.existsSync(RESULTS_DIR)
    ? fs.readdirSync(RESULTS_DIR).filter((name) => name.endsWith('.json'))
    : [];
  const newest = newestResultsName(names, value, platform);
  if (newest != null) {
    return {
      file: path.join(RESULTS_DIR, newest),
      label: newest.replace(/\.json$/, ''),
    };
  }
  throw new Error(
    `--compare ${value}: no such file, and no bench/results/${value}-${platform}-*.json. ` +
      `Run the bench once with that revision checked out (results files are named after their ` +
      `commit) and pass --compare again.`
  );
}

/** Baseline write, with the D9 guards. Returns the block reasons, if any. */
export function writeBaseline(file, run, { force = false } = {}) {
  const blockers = force ? [] : baselineBlockers(run);
  if (blockers.length > 0) {
    return { written: false, blockers };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(buildBaseline(run), null, 2)}\n`);
  // The baseline is a committed file, and `bun run format` checks committed
  // files - so the mint formats what it wrote instead of leaving a formatting
  // diff for whoever commits it (A1b follow-up).
  // From the repo root, so bunx finds this repo's prettier rather than the
  // bench app's (see scripts/bench/format.mjs).
  const { note } = formatCommittedJsonFile(file, { cwd: REPO_ROOT });
  return { written: true, blockers: [], file, formatted: note == null, note };
}

export function writeReportFiles({ run, markdown, fileName }) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const json = path.join(RESULTS_DIR, fileName);
  fs.writeFileSync(json, `${JSON.stringify(run, null, 2)}\n`);
  const md = json.replace(/\.json$/, '.md');
  fs.writeFileSync(md, markdown);
  return { json, md };
}

/**
 * The raw records a device produced, saved next to the results *before* anything
 * can throw. Re-aggregating is cheap and offline; a 10-minute device run is
 * not, so a bug in the maths must not cost the measurement. `bench/results/` is
 * gitignored.
 */
export function writeRawRecords({ fileName, records }) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, fileName.replace(/\.json$/, '.ndjson'));
  fs.writeFileSync(
    file,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  );
  return file;
}

if (
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 || index + 1 >= argv.length
      ? null
      : (argv[index + 1] ?? null);
  };
  const resultsFile = argv.find((entry) => !entry.startsWith('--'));
  if (resultsFile == null) {
    process.stderr.write(
      'usage: node scripts/bench/report.mjs <results.json> [--compare <ref|file>] [--check] [--update-baseline] [--force]\n'
    );
    process.exit(2);
  }
  if (!fs.existsSync(resultsFile)) {
    process.stderr.write(`No such results file: ${resultsFile}\n`);
    process.exit(2);
  }
  const run = readJson(resultsFile);
  if (run.schemaVersion !== SCHEMA_VERSION) {
    process.stderr.write(
      `${resultsFile} is schema v${String(run.schemaVersion)}; this reporter reads v${SCHEMA_VERSION}. Re-run the bench.\n`
    );
    process.exit(2);
  }

  process.stdout.write(`${renderMarkdown(run)}\n`);

  let exitCode = Array.isArray(run.problems) && run.problems.length > 0 ? 1 : 0;

  const compare = flag('--compare');
  if (compare != null) {
    let target;
    try {
      target = resolveCompareTarget(compare, run.platform);
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exit(2);
    }
    const section = comparisonSections({
      run,
      base: readJson(target.file),
      mode: 'compare',
      label: target.label,
    });
    process.stdout.write(`\n${section.markdown}\n`);
    exitCode = Math.max(exitCode, section.exitCode);
  }

  if (argv.includes('--update-baseline')) {
    const file = baselinePath(run.deviceKey);
    const outcome = writeBaseline(file, run, {
      force: argv.includes('--force'),
    });
    if (outcome.written) {
      process.stdout.write(
        `\nWrote baseline ${path.relative(REPO_ROOT, file)}\n` +
          (outcome.note == null ? '' : `  ${outcome.note}\n`)
      );
    } else {
      process.stderr.write(
        `\n--update-baseline refused (pass --force to override):\n${outcome.blockers
          .map((reason) => `  - ${reason}`)
          .join('\n')}\n`
      );
      exitCode = Math.max(exitCode, 2);
    }
  }

  if (argv.includes('--check')) {
    const file = baselinePath(run.deviceKey);
    if (!fs.existsSync(file)) {
      process.stderr.write(
        `\n--check: no baseline at ${path.relative(REPO_ROOT, file)}. Create it with --update-baseline.\n`
      );
      process.exit(1);
    }
    const baseline = readJson(file);
    if (!isCompatibleBaseline(baseline)) {
      process.stderr.write(
        `\n--check: ${path.relative(REPO_ROOT, file)} is not a v${SCHEMA_VERSION} ratio baseline (found v${String(baseline?.schemaVersion)}). Re-record it on a clean commit with --update-baseline.\n`
      );
      process.exit(2);
    }
    const section = comparisonSections({
      run,
      base: { cells: {} },
      mode: 'check',
      label: path.relative(REPO_ROOT, file),
      baseTable: baselineTable(baseline),
      baseNoise: baselineNoise(baseline),
    });
    process.stdout.write(`\n${section.markdown}\n`);
    exitCode = Math.max(exitCode, section.exitCode);
  }
  process.exit(exitCode);
}
