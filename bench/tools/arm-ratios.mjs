#!/usr/bin/env node
/**
 * Launch-paired ratios of one arm against *every* other arm in a results file.
 *
 *   node bench/tools/arm-ratios.mjs bench/results/<run>.json [more.json ...]
 *   node bench/tools/arm-ratios.mjs --arm=nitro-ui-host bench/results/<run>.json
 *
 * `bun bench` gates on launch-paired ratios to `rn-core` only (D9). The D15
 * target is a ratio to `expo-ui-shared-host`, and a ratio to `rn-core` cannot be
 * divided into it after the fact: what makes a paired ratio worth anything is
 * that arm launch L and control launch L ran next to each other in the same
 * ABBA pass (D9); two medians divided in a report do not have that property.
 * So this asks the bench's own pairing function for it, per control arm.
 *
 * Absolute medians are printed too - the column a before/after table needs,
 * because a ratio's *sign* is stable across runs while its size moves with the
 * machine (T12 phase 1: mount presented 1.47x in one run, 1.88x in another).
 */
import { readFileSync } from 'node:fs';

import {
  LATENCY_METRICS,
  cellsFrom,
  comparableMetrics,
  median,
  pairedLaunchRatios,
} from '../../scripts/bench/lib.mjs';

/**
 * The control arm to express ratios *from* (default `nitro-ui`).
 *
 * `--arm` exists for T16: the D15 question is a ratio to `expo-ui-shared-host`, and
 * asking it of the spike's `nitro-ui-host` arm needs the same launch-paired pairing
 * this tool already does - not two medians divided in prose.
 */
const ARM =
  process.argv
    .find((arg) => arg.startsWith('--arm='))
    ?.slice('--arm='.length) ?? 'nitro-ui';
const FILES = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
/** `mainNsPerOp` is the UI-thread column D15 names; the rest complete the picture. */
const METRICS = [
  ...LATENCY_METRICS,
  'jsNsPerOp',
  'mainNsPerOp',
  'unmountMainNsPerOp',
  'bytesPerInstance',
];

function formatMetric(metric, value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (metric === 'bytesPerInstance') return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1e6).toFixed(2)} ms`;
}

function formatRatio(ratio, spread) {
  if (!Number.isFinite(ratio)) return 'n/a';
  const noise = Number.isFinite(spread)
    ? ` (${(spread * 100).toFixed(0)}%)`
    : '';
  return `${ratio.toFixed(2)}x${noise}`;
}

for (const file of FILES) {
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const cells = cellsFrom(run);
  const load = run.machine?.loadavg1;
  console.log(
    `\n## ${file}\n\nsha ${run.sha}${run.dirty === true ? '-dirty' : ''}, ` +
      `plan ${run.plan}, ${run.launches} launches, device ${run.deviceKey}, ` +
      `load ${Number.isFinite(load) ? load.toFixed(2) : 'n/a'} over ${String(
        run.machine?.cpuCount ?? 0
      )} cores, quiet ${run.machine?.quiet === true ? 'yes' : 'NO'}`
  );
  const armCells = Object.values(cells).filter(
    (cell) => cell.implementation === ARM && cell.skipReason == null
  );
  for (const cell of armCells) {
    const armMetrics = comparableMetrics(cell);
    const others = Object.values(cells).filter(
      (other) =>
        other.scenario === cell.scenario &&
        other.n === cell.n &&
        other.implementation !== ARM &&
        other.skipReason == null
    );
    if (others.length === 0) continue;
    console.log(
      `\n### ${cell.scenario} N=${String(cell.n)} - ${ARM}\n` +
        `\n| Metric | ${ARM} | ${others
          .map((other) => `vs ${other.implementation}`)
          .join(' | ')} |` +
        `\n| --- | --- | ${others.map(() => '---').join(' | ')} |`
    );
    for (const metric of METRICS) {
      const armValue = armMetrics[metric];
      const row = [formatMetric(metric, armValue)];
      for (const other of others) {
        const controlMetrics = comparableMetrics(other);
        if (armValue == null || !(metric in controlMetrics)) {
          row.push('n/a');
          continue;
        }
        const { launchRatios } = pairedLaunchRatios(cell, other, metric);
        const ratio = median(launchRatios);
        const spread =
          Number.isFinite(ratio) && launchRatios.length > 1
            ? (median(launchRatios.map((value) => Math.abs(value - ratio))) ??
                Number.NaN) / ratio
            : Number.NaN;
        row.push(formatRatio(ratio, spread));
      }
      console.log(`| ${metric} | ${row.join(' | ')} |`);
    }
  }
}
