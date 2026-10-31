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
 *
 * Both flags that read or write a baseline work the same way here as in a live run:
 * the file is `bench/baselines/<machine.hostname>/<deviceKey>.json`, keyed by the
 * label the run itself recorded, and there is no fallback to another machine's file
 * (`scripts/bench/baseline.mjs`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  foundingDependencies,
  openBaselineForMerge,
  mintBaselineFileFor,
  openBaselineForCheck,
} from './baseline.mjs';
import { formatCommittedJsonFile } from './format.mjs';
import { tryExec } from './machine.mjs';

import {
  SCHEMA_VERSION,
  baselineBlockers,
  baselineNoise,
  baselineTable,
  buildBaseline,
  isCompatibleBaseline,
  mergeBaselineProblems,
  mergeComponentBaseline,
  newestResultsName,
  skippedCellNotes,
} from './lib.mjs';
import { comparisonSections, renderMarkdown } from './render.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
export const RESULTS_DIR = path.join(REPO_ROOT, 'bench', 'results');
export const BASELINES_DIR = path.join(REPO_ROOT, 'bench', 'baselines');

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

/**
 * Baseline write, with the D9 guards. Returns the block reasons, if any.
 *
 * Two shapes, and the difference is the whole of X14:
 *
 * - **full mint** (no `component`): `buildBaseline(run)` replaces the file. This
 *   is what makes a *filtered* full mint dangerous - it would write one
 *   component's cells and delete every other row, which reads to `--check` as
 *   "not measured in base" - so `narrowingProblem()` refuses a narrowed schedule
 *   for it, before the run.
 * - **merge** (`component`, plus the `existing` file the caller already checked it
 *   against): only that component's cells are written and everything else is
 *   carried through from the file unchanged, with one `components` entry added.
 *
 * `baselineBlockers()` guards both. `--force` overrides those per-run judgements
 * (load, cleanliness, plan, completeness) and nothing else: the comparability and
 * already-has-cells refusals come from `mergeBaselineProblems()`, which the caller
 * runs whether or not `--force` was passed.
 */
export function writeBaseline(
  file,
  run,
  {
    force = false,
    component = null,
    existing = null,
    componentsBase = null,
    dependencies = null,
    comparabilityNotes = [],
  } = {}
) {
  const blockers = force ? [] : baselineBlockers(run);
  if (blockers.length > 0) {
    return { written: false, blockers, baseline: null, skippedCellNotes: [] };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const built = buildBaseline(run);
  let merged = null;
  if (component != null) {
    if (existing == null) {
      throw new Error(
        `writeBaseline: merging --component ${String(
          component
        )} needs the file it merges into, and none was given`
      );
    }
    merged = mergeComponentBaseline({
      baseline: existing,
      run,
      component,
      built,
      componentsBase,
      dependencies,
      comparabilityNotes,
    });
  }
  const baseline = merged?.baseline ?? built;
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  // The baseline is a committed file, and `bun run format` checks committed
  // files - so the mint formats what it wrote instead of leaving a formatting
  // diff for whoever commits it (A1b follow-up).
  // From the repo root, so bunx finds this repo's prettier rather than the
  // bench app's (see scripts/bench/format.mjs).
  const { note } = formatCommittedJsonFile(file, { cwd: REPO_ROOT });
  return {
    written: true,
    blockers: [],
    file,
    baseline,
    formatted: note == null,
    note,
    merged,
    changedCells: merged?.changedCells ?? null,
    skippedCellNotes: skippedCellNotes(baseline, {
      display: path.relative(REPO_ROOT, file),
    }),
  };
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
      'usage: node scripts/bench/report.mjs <results.json> [--compare <ref|file>] [--check]\n' +
        '                                 [--update-baseline [--component <name>]] [--force]\n'
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
  // Read-only git, for recovering the app versions a pre-X14 baseline's founding
  // commit pinned (X14). Same shape `run.mjs` passes, and the same failure rule:
  // an unreadable revision comes back null and the merge refuses rather than
  // matching a version invented from the working tree.
  const gitShow = (args) => tryExec('git', args);

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
    const component = flag('--component');
    const mint = mintBaselineFileFor({ baselinesDir: BASELINES_DIR, run });
    if (mint.refusal != null) {
      process.stderr.write(`\n${mint.refusal}\n`);
      exitCode = Math.max(exitCode, 2);
    } else if (component != null) {
      // The merge path (X14): the results file holds one component's cells and the
      // committed file holds the rest. Everything the guards need is asked of the
      // file here, so a re-report of an old results file cannot append a cell that
      // does not belong in this machine's table.
      const opened = openBaselineForMerge({
        baselinesDir: BASELINES_DIR,
        run,
        component,
        isCompatibleBaseline,
        readJson,
        display: (file) => path.relative(REPO_ROOT, file),
        resolved: (baseline) =>
          foundingDependencies({ baseline, git: gitShow }),
        mergeProblems: (input) => mergeBaselineProblems(input),
      });
      if (opened.refusal != null) {
        process.stderr.write(`\n${opened.refusal.message}\n`);
        exitCode = Math.max(exitCode, 2);
      } else if (opened.problems.length > 0) {
        process.stderr.write(
          `\n--update-baseline --component ${String(
            component
          )} refused: this run's numbers cannot live in ${String(opened.display)}\n${opened.problems
            .map((reason) => `  - ${reason}`)
            .join('\n')}\n`
        );
        exitCode = Math.max(exitCode, 2);
      } else {
        const outcome = writeBaseline(opened.file, run, {
          force: argv.includes('--force'),
          component,
          existing: opened.baseline,
          componentsBase: opened.seeded,
          // The founding run's versions as recovered from its own commit, which is
          // what the file's top-level `dependencies` may claim; the merged
          // component's entry takes the measuring run's versions from `run`.
          dependencies: opened.foundingDependencies,
          comparabilityNotes: opened.unverified,
        });
        if (outcome.written) {
          process.stdout.write(
            `\nMerged baseline ${path.relative(REPO_ROOT, opened.file)}: ${String(
              outcome.merged.addedCells
            )} \`${String(component)}\` cell(s)\n` +
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
    } else {
      const outcome = writeBaseline(mint.file, run, {
        force: argv.includes('--force'),
      });
      if (outcome.written) {
        process.stdout.write(
          `\nWrote baseline ${path.relative(REPO_ROOT, mint.file)}\n` +
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
  }

  if (argv.includes('--check')) {
    const opened = openBaselineForCheck({
      baselinesDir: BASELINES_DIR,
      run,
      display: (file) => path.relative(REPO_ROOT, file),
      readJson,
      isCompatibleBaseline,
    });
    if (opened.refusal != null) {
      process.stderr.write(`\n${opened.refusal.message}\n`);
      // A missing baseline has always been a 1 here and a 2 in `run.mjs`; the new
      // refusals are a 2 on both, because the run could not be judged at all.
      exitCode =
        opened.refusal.kind === 'missing'
          ? Math.max(exitCode, 1)
          : Math.max(exitCode, 2);
    } else {
      const section = comparisonSections({
        run,
        base: { cells: {} },
        mode: 'check',
        label: opened.display,
        baseTable: baselineTable(opened.baseline),
        baseNoise: baselineNoise(opened.baseline),
      });
      process.stdout.write(`\n${section.markdown}\n`);
      exitCode = Math.max(exitCode, section.exitCode);
    }
  }
  process.exit(exitCode);
}
