/**
 * Aggregates, prints and gates existing benchmark results. Reads results files
 * and never touches a device.
 *
 *   node scripts/bench/report.mjs [results.json] [--compare <git-ref|results-file>]
 *
 * Every headline number is a median of per-launch medians with the MAD of
 * those launch medians beside it; `p95` is over the pooled iterations. Smaller
 * is better everywhere.
 *
 * What gates (implemented once in `gate()`):
 *
 * 1. Every metric is first turned into a launch-paired ratio to `rn-core`:
 *    launch N's arm median over launch N's control median, so machine drift
 *    cancels.
 * 2. A comparison gates `head(x/rn-core) / base(x/rn-core)`, where base is
 *    another run measured on this machine.
 * 3. A ratio over 1.20 fails only when its bootstrap 95% CI excludes 1.05 and
 *    the within-run spread of that (scenario, N, metric) is quiet.
 * 4. Only `nitro-ui` arms are gated. `rn-core` is the control and `expo-ui-*`
 *    are reference arms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION, newestResultsName } from './lib.mjs';
import { comparisonSections, renderMarkdown } from './render.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
export const RESULTS_DIR = path.join(REPO_ROOT, 'bench', 'results');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Resolves `--compare <ref|file>` to a results file. A bare ref resolves to the
 * newest clean results file of that sha; a dirty run (named `-dirty-`) matches
 * only when nothing clean exists.
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

export function writeReportFiles({ run, markdown, fileName }) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const json = path.join(RESULTS_DIR, fileName);
  fs.writeFileSync(json, `${JSON.stringify(run, null, 2)}\n`);
  const md = json.replace(/\.json$/, '.md');
  fs.writeFileSync(md, markdown);
  return { json, md };
}

/**
 * Saves the raw records a device produced next to the results, so a bug in the
 * aggregation does not cost the measurement. `bench/results/` is gitignored.
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
      'usage: node scripts/bench/report.mjs <results.json> [--compare <ref|file>]\n'
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
      label: target.label,
    });
    process.stdout.write(`\n${section.markdown}\n`);
    exitCode = Math.max(exitCode, section.exitCode);
  }
  process.exit(exitCode);
}
