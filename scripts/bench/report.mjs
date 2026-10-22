/**
 * Aggregate, print, compare and gate benchmark results.
 *
 *   node scripts/bench/report.mjs [results.json] [--compare <git-ref|file>]
 *                               [--check] [--update-baseline]
 *
 * Reading the output
 * -----------------
 * Every number is a **median of medians** over the whole run (all launches, all
 * measured iterations), with the MAD as the spread and the p95 shown for
 * latency. Smaller is better everywhere.
 *
 * Absolute numbers are informative but never gate a PR on their own: they move
 * with the OS build and whatever else the machine is doing. Two things gate:
 *
 * 1. `rn-core` is a control arm. If it moved more than 10% between the two runs
 *    being compared, the run is labelled "noisy, inconclusive" instead of
 *    failing - the machine changed, not the code.
 * 2. A `head/base` ratio over 1.20 whose bootstrap 95% CI excludes 1.05 fails.
 *
 * Committed baselines (`bench/baselines/<platform>-<device>.json`) are compared
 * as ratios *against `rn-core`* for the same reason.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTROL_DRIFT_THRESHOLD,
  IMPLEMENTATIONS,
  LATENCY_METRICS,
  RATIO_FAIL_THRESHOLD,
  SCHEMA_VERSION,
  cellsFrom,
  comparableMetrics,
  compareResults,
  gateFailures,
  controlDrift,
  formatBytes,
  formatMs,
  formatNs,
  formatRatio,
  isNumber,
  markdownTable,
  normaliseToControl,
  trimCells,
} from './lib.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
export const RESULTS_DIR = path.join(REPO_ROOT, 'bench', 'results');
export const BASELINES_DIR = path.join(REPO_ROOT, 'bench', 'baselines');

/**
 * `deviceKey` already carries the platform (`ios-iphone-air-sim`,
 * `android-api35-emu`), so the file is named after the device alone. A baseline
 * is only ever comparable to runs taken on the same device.
 */
export function baselinePath(deviceKey) {
  return path.join(BASELINES_DIR, `${deviceKey}.json`);
}

export function resultsPath(sha, platform) {
  return path.join(RESULTS_DIR, `${sha}-${platform}.json`);
}

const METRIC_LABELS = {
  jsCommitNs: 'JS commit',
  mountedNs: 'mounted',
  presentedNs: 'presented',
  jsNsPerUpdate: 'JS CPU/op',
  mainNsPerUpdate: 'UI CPU/op',
  bytesPerInstance: 'bytes/inst',
};

function formatMetric(metric, value) {
  if (metric === 'bytesPerInstance') {
    return formatBytes(value);
  }
  if (metric === 'profilerMsPerUpdate') {
    return formatMs(value);
  }
  return formatNs(value);
}

function cellSort(a, b) {
  const scenarioOrder = ['mount', 'update', 'memory', 'leak'];
  return (
    scenarioOrder.indexOf(a.scenario) - scenarioOrder.indexOf(b.scenario) ||
    a.n - b.n ||
    IMPLEMENTATIONS.indexOf(a.implementation) -
      IMPLEMENTATIONS.indexOf(b.implementation)
  );
}

/**
 * The main table: one row per (scenario, N, implementation), columns are the
 * metrics. Values are ratios to `rn-core` when `vsControl` is on, which is what
 * makes a table readable across machines.
 */
export function summaryTable(run, { vsControl = false } = {}) {
  const cells = cellsFrom(run);
  const source = vsControl ? normaliseToControl(cells) : cells;
  const rows = [];
  for (const cell of Object.values(source).sort(cellSort)) {
    if (cell.skipReason != null) {
      rows.push([
        `${cell.scenario} N=${String(cell.n)}`,
        cell.implementation,
        `skipped: ${cell.skipReason}`,
        '',
        '',
        '',
        '',
      ]);
      continue;
    }
    const metrics = comparableMetrics(cell);
    // In ratio mode every row is a ratio - including `rn-core`, which is
    // exactly 1.00x and is the reader's proof the normalisation is honest.
    const isRatio = vsControl;
    const asValue = (metric) => {
      if (!isNumber(metrics[metric])) {
        return 'n/a';
      }
      return isRatio
        ? formatRatio(metrics[metric])
        : formatMetric(metric, metrics[metric]);
    };
    rows.push([
      `${cell.scenario} N=${String(cell.n)}`,
      cell.implementation,
      asValue('presentedNs'),
      asValue('mountedNs'),
      asValue('jsCommitNs'),
      asValue('jsNsPerUpdate'),
      asValue('mainNsPerUpdate'),
      asValue('bytesPerInstance'),
    ]);
  }
  return markdownTable(
    [
      'Scenario',
      'Implementation',
      'presented',
      'mounted',
      'JS commit',
      'JS CPU/op',
      'UI CPU/op',
      'bytes/inst',
    ],
    rows
  );
}

/** Per-cell detail with MAD/p95/sample counts, for the markdown report file. */
export function detailSections(run) {
  const cells = cellsFrom(run);
  const sections = [];
  for (const cell of Object.values(cells).sort(cellSort)) {
    const header = `### ${cell.scenario} N=${String(cell.n)} - ${cell.implementation}`;
    if (cell.skipReason != null) {
      sections.push(`${header}\n\nskipped: ${cell.skipReason}\n`);
      continue;
    }
    const rows = LATENCY_METRICS.map((metric) => {
      const stats = cell.metrics?.[metric] ?? {};
      return [
        metric,
        formatMetric(metric, stats.median),
        `+/- ${formatMetric(metric, stats.mad)}`,
        formatMetric(metric, stats.p95),
        String(stats.samples ?? 0),
      ];
    });
    rows.push([
      'JS CPU per op',
      formatMetric('jsNsPerUpdate', cell.cpu?.jsNsPerUpdate),
      `${String(cell.cpu?.launches ?? 0)} launch samples`,
      '',
      '',
    ]);
    rows.push([
      'UI CPU per op',
      formatMetric('mainNsPerUpdate', cell.cpu?.mainNsPerUpdate),
      `React.Profiler ${formatMs(cell.cpu?.profilerMsPerUpdate)}/op`,
      '',
      '',
    ]);
    if (isNumber(cell.memory?.bytesPerInstance)) {
      rows.push([
        'bytes / instance',
        formatBytes(cell.memory.bytesPerInstance),
        `${String(cell.memory.bytesPerInstanceLaunches)} launch samples`,
        '',
        '',
      ]);
    }
    if (isNumber(cell.memory?.leakSlopeBytesPerCycle)) {
      rows.push([
        'leak slope',
        `${formatBytes(cell.memory.leakSlopeBytesPerCycle)}/cycle`,
        cell.memory.leakMonotonic ? 'MONOTONIC (leak)' : 'not monotonic',
        '',
        '',
      ]);
    }
    sections.push(
      `${header}\n\n${markdownTable(
        ['Metric', 'median', 'MAD', 'p95', 'n'],
        rows
      )}\n`
    );
  }
  return sections.join('\n');
}

/** Human summary of run metadata, so a pasted table explains itself. */
export function runHeader(run) {
  const protocol = Object.values(cellsFrom(run))[0]?.protocol ?? {};
  return [
    `- platform: \`${run.platform}\` on \`${run.deviceName}\` (key \`${run.deviceKey}\`)`,
    `- commit: \`${run.sha}\`${run.dirty ? ' (dirty tree)' : ''}`,
    `- plan: \`${run.plan}\`, ${String(run.launches ?? '?')} launches per cell, ${String(protocol.warmup ?? '?')} warmup + ${String(protocol.measured ?? '?')} measured iterations`,
    `- clock: \`${run.clock ?? 'unknown'}\``,
    `- generated: ${run.createdAt}`,
  ].join('\n');
}

/**
 * Head-vs-base verdict: ratios, control drift and the gate.
 *
 * `--check` passes the baseline through the same code with everything divided
 * by `rn-core`, so both modes share one gate implementation.
 */
export function verdict({ base, head, normalised = false }) {
  const baseCells = cellsFrom(base);
  const headCells = cellsFrom(head);
  const rows = compareResults(baseCells, headCells);
  const drift = controlDrift(baseCells, headCells);
  const failures = gateFailures(rows);
  return {
    rows,
    drift,
    failures,
    noisy: drift.length > 0,
    conclusiveFailure: failures.some((failure) => failure.conclusive),
    normalised,
  };
}

export function verdictTable(result) {
  const rows = [];
  // In `--check` mode base and head are already ratios to `rn-core`, not
  // measurements, so they must not go through the duration/byte formatters.
  const show = result.normalised
    ? (_metric, value) => formatRatio(value)
    : (metric, value) => formatMetric(metric, value);
  for (const row of result.rows) {
    if (row.status === 'missing-base') {
      rows.push([row.key, '-', '-', 'not measured in base', '', '']);
      continue;
    }
    if (row.status === 'skipped-both') {
      rows.push([row.key, '-', '-', 'skipped in both runs', '', '']);
      continue;
    }
    for (const [metric, value] of Object.entries(row.perMetric)) {
      rows.push([
        row.key,
        METRIC_LABELS[metric] ?? metric,
        show(metric, value.base),
        show(metric, value.head),
        formatRatio(value.ratio),
        value.ratio > RATIO_FAIL_THRESHOLD ? 'over threshold' : '',
      ]);
    }
  }
  return markdownTable(
    result.normalised
      ? [
          'Cell',
          'Metric',
          'baseline x rn-core',
          'head x rn-core',
          'head/base',
          'note',
        ]
      : ['Cell', 'Metric', 'base', 'head', 'head/base', 'note'],
    rows
  );
}

export function verdictSummary(result) {
  const lines = [];
  if (result.noisy) {
    lines.push(
      `**Noisy, inconclusive.** The \`rn-core\` control moved more than ${String(
        Math.round(CONTROL_DRIFT_THRESHOLD * 100)
      )}% between the two runs, so nothing in this run can be attributed to a code change:`
    );
    for (const finding of result.drift) {
      lines.push(
        `- \`${finding.key}\` ${METRIC_LABELS[finding.metric] ?? finding.metric}: ${formatRatio(
          finding.ratio
        )} (${formatMetric(finding.metric, finding.base)} -> ${formatMetric(
          finding.metric,
          finding.head
        )})`
      );
    }
  } else {
    lines.push(
      `\`rn-core\` control drift is within ${String(
        Math.round(CONTROL_DRIFT_THRESHOLD * 100)
      )}%, so this run is trustworthy.`
    );
  }
  if (result.failures.length === 0) {
    lines.push(
      `No metric exceeded the ${formatRatio(RATIO_FAIL_THRESHOLD)} head/base threshold.`
    );
  } else {
    lines.push('');
    lines.push(
      `Metrics over the ${formatRatio(RATIO_FAIL_THRESHOLD)} threshold (a failure needs a bootstrap CI that excludes 1.05):`
    );
    for (const failure of result.failures) {
      lines.push(
        `- ${failure.conclusive ? 'FAIL' : 'warn'} \`${failure.key}\` ${
          METRIC_LABELS[failure.metric] ?? failure.metric
        }: ${formatRatio(failure.ratio)}${
          failure.ci == null
            ? ' (no CI: too few launch samples)'
            : `, 95% CI ${formatRatio(failure.ci.low)}-${formatRatio(failure.ci.high)}`
        }`
      );
    }
  }
  return lines.join('\n');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveCompareTarget(value, platform) {
  if (fs.existsSync(value)) {
    return { file: value, label: path.basename(value, '.json') };
  }
  const inResults = path.join(RESULTS_DIR, `${value}-${platform}.json`);
  if (fs.existsSync(inResults)) {
    return { file: inResults, label: value };
  }
  throw new Error(
    `--compare ${value}: no such file, and no bench/results/${value}-${platform}.json. ` +
      `Run the bench once with that revision checked out (scripts/bench/run.mjs writes the ` +
      `results file named after its commit) and pass --compare again.`
  );
}

export function writeReportFiles({ run, markdown }) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const json = resultsPath(run.sha, run.platform);
  fs.writeFileSync(json, `${JSON.stringify(run, null, 2)}\n`);
  const md = json.replace(/\.json$/, '.md');
  fs.writeFileSync(md, markdown);
  return { json, md };
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
      'usage: node scripts/bench/report.mjs <results.json> [--compare <ref|file>] [--check] [--update-baseline]\n'
    );
    process.exit(2);
  }
  const run = readJson(resultsFile);
  const cells = cellsFrom(run);
  const sections = [
    `# Bench ${run.platform} ${run.plan}`,
    '',
    runHeader(run),
    '',
    '## Summary (absolute)',
    '',
    summaryTable(run),
    '',
    '## Summary (ratio to rn-core)',
    '',
    summaryTable(run, { vsControl: true }),
    '',
    detailSections(run),
  ];
  const markdown = `${sections.join('\n')}\n`;
  fs.writeFileSync(resultsFile.replace(/\.json$/, '.md'), markdown);
  process.stdout.write(`${markdown}\n`);

  let exitCode = 0;
  const base = flag('--compare');
  if (base != null) {
    const target = resolveCompareTarget(base, run.platform);
    const result = verdict({ base: readJson(target.file), head: run });
    process.stdout.write(
      `\n## head/base vs ${target.label}\n\n${verdictTable(result)}\n\n${verdictSummary(result)}\n`
    );
    if (result.conclusiveFailure) {
      exitCode = 1;
    }
  }
  if (argv.includes('--update-baseline')) {
    const file = baselinePath(run.deviceKey);
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          platform: run.platform,
          deviceKey: run.deviceKey,
          deviceName: run.deviceName,
          sha: run.sha,
          plan: run.plan,
          updatedAt: run.createdAt,
          cells: trimCells(cells),
        },
        null,
        2
      )}\n`
    );
    process.stdout.write(
      `\nWrote baseline ${path.relative(REPO_ROOT, file)}\n`
    );
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
    const result = verdict({
      base: { ...baseline, cells: normaliseToControl(cellsFrom(baseline)) },
      head: { ...run, cells: normaliseToControl(cells) },
      normalised: true,
    });
    // The control arm is 1.0 by construction after normalisation, so drift has
    // to be measured on the absolute numbers instead.
    result.drift = controlDrift(cellsFrom(baseline), cells).filter((finding) =>
      finding.key.includes(':rn-core:')
    );
    result.noisy = result.drift.length > 0;
    process.stdout.write(
      `\n## Check against baseline ${path.relative(REPO_ROOT, file)} (ratios to rn-core)\n\n${verdictTable(result)}\n\n${verdictSummary(result)}\n`
    );
    if (result.conclusiveFailure && !result.noisy) {
      exitCode = 1;
    }
  }
  process.exit(exitCode);
}
