/**
 * Markdown + verdict rendering for benchmark results. Pure: no filesystem, no
 * `import.meta`, so `gate()` and the tables around it are unit-testable in jest
 * (scripts/__tests__/bench-gate.test.js), which transpiles .mjs to CommonJS.
 *
 * This is the single implementation of the gate presentation: `run.mjs` and
 * `scripts/bench/report.mjs` both call `comparisonSections()` with the same
 * arguments they print, so the standalone reporter cannot drift from the runner
 * (review S11). What the numbers mean is documented in report.mjs's header and
 * docs/architecture/benchmarks.md.
 */

import {
  cellsFrom,
  comparableMetrics,
  componentOf,
  CONTROL_NOTE_THRESHOLD,
  controlMovement,
  formatBytes,
  formatNs,
  formatRatio,
  formatSpread,
  gate,
  IMPLEMENTATIONS,
  incompleteMetrics,
  isNumber,
  LATENCY_METRICS,
  markdownTable,
  MAX_MISSING_SAMPLE_RATIO,
  NOISE_REL_SPREAD,
  noiseTable,
  RATIO_FAIL_THRESHOLD,
  ratioTable,
  scenarioActionOf,
} from './lib.mjs';

const METRIC_LABELS = {
  jsCommitNs: 'JS commit',
  mountedNs: 'mounted',
  presentedNs: 'presented',
  jsNsPerOp: 'JS CPU/op',
  mainNsPerOp: 'UI CPU/op',
  unmountMainNsPerOp: 'UI CPU/unmount',
  bytesPerInstance: 'bytes/inst',
  leakSlopeBytesPerCycle: 'leak slope',
};

function formatMetric(metric, value) {
  if (metric === 'bytesPerInstance' || metric === 'leakSlopeBytesPerCycle') {
    return formatBytes(value);
  }
  return formatNs(value);
}

/** Mark counts are plain integers (or a small per-instance ratio), not nanoseconds. */
function formatNumber(value, digits = 0) {
  return isNumber(value) ? value.toFixed(digits) : 'n/a';
}

/**
 * Cells group by what the launch does, then by which control it mounted, then
 * by size. A scenario cell carries its component (`mount.slider`), so sorting on
 * the whole string would put `mount.slider` next to `mount` only by luck and
 * every later component wherever the alphabet puts it.
 */
function cellSort(a, b) {
  const scenarioOrder = ['mount', 'update', 'memory', 'leak'];
  const actionOrder = (scenario) => {
    const index = scenarioOrder.indexOf(scenarioActionOf(scenario));
    // An action the reporter has never seen goes last, not first.
    return index === -1 ? scenarioOrder.length : index;
  };
  return (
    actionOrder(a.scenario) - actionOrder(b.scenario) ||
    componentOf(a.scenario).localeCompare(componentOf(b.scenario)) ||
    a.n - b.n ||
    IMPLEMENTATIONS.indexOf(a.implementation) -
      IMPLEMENTATIONS.indexOf(b.implementation)
  );
}

/**
 * The main table: one row per (scenario, N, implementation), columns are the
 * metrics. With `vsControl` every value is the launch-paired ratio to `rn-core`
 * - including `rn-core` itself, which is exactly 1.00x and is the reader's proof
 * the normalisation is honest. That is also the only form a baseline stores.
 */
export function summaryTable(run, { vsControl = false } = {}) {
  const cells = cellsFrom(run);
  const table = vsControl ? ratioTable(cells) : null;
  const rows = [];
  for (const cell of Object.values(cells).sort(cellSort)) {
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
    const absolute = comparableMetrics(cell);
    const ratios = table?.[cell.key]?.metrics ?? {};
    const asValue = (metric) => {
      if (vsControl) {
        return isNumber(ratios[metric]?.ratio)
          ? formatRatio(ratios[metric]?.ratio)
          : 'n/a';
      }
      return isNumber(absolute[metric])
        ? formatMetric(metric, absolute[metric])
        : 'n/a';
    };
    rows.push([
      `${cell.scenario} N=${String(cell.n)}`,
      cell.implementation,
      asValue('presentedNs'),
      asValue('mountedNs'),
      asValue('jsCommitNs'),
      asValue('jsNsPerOp'),
      asValue('mainNsPerOp'),
      asValue('bytesPerInstance'),
    ]);
  }
  return markdownTable(
    [
      'Cell',
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

/** Per-cell detail, including the sanity counters the latency numbers need. */
export function detailSections(run) {
  const cells = cellsFrom(run);
  const table = ratioTable(cells);
  const noise = noiseTable(table);
  const sections = [];
  for (const cell of Object.values(cells).sort(cellSort)) {
    const header = `### ${cell.scenario} N=${String(cell.n)} - ${cell.implementation}`;
    if (cell.skipReason != null) {
      sections.push(`${header}\n\nskipped: ${cell.skipReason}\n`);
      continue;
    }
    const rows = LATENCY_METRICS.map((metric) => {
      const stats = cell.metrics?.[metric] ?? {};
      const ratio = table[cell.key]?.metrics?.[metric];
      // Too few samples arrived to quote a number: `n/a` beats a median over
      // the iterations whose signal happened to show up (round 4).
      if (stats.reportable === false) {
        return [
          metric,
          'n/a',
          `of ${String(stats.expected ?? 0)} samples`,
          'n/a',
          String(stats.samples ?? 0),
          'n/a',
        ];
      }
      return [
        metric,
        formatMetric(metric, stats.median),
        `+/- ${formatMetric(metric, stats.mad)}`,
        formatMetric(metric, stats.p95),
        String(stats.samples ?? 0),
        isNumber(ratio?.ratio) ? formatRatio(ratio.ratio) : 'n/a',
      ];
    });
    rows.push([
      'JS CPU per op',
      formatMetric('jsNsPerOp', cell.cpu?.jsNsPerOp),
      `${String(cell.cpu?.launches ?? 0)} launch samples`,
      '',
      '',
      formatRatio(table[cell.key]?.metrics?.jsNsPerOp?.ratio),
    ]);
    rows.push([
      'UI CPU per op',
      formatMetric('mainNsPerOp', cell.cpu?.mainNsPerOp),
      `${String(cell.cpu?.launches ?? 0)} launch samples`,
      '',
      '',
      formatRatio(table[cell.key]?.metrics?.mainNsPerOp?.ratio),
    ]);
    if (isNumber(cell.cpu?.unmountMainNsPerOp)) {
      rows.push([
        'UI CPU per unmount',
        formatMetric('unmountMainNsPerOp', cell.cpu.unmountMainNsPerOp),
        `${String(cell.cpu.unmountLaunches ?? 0)} launch samples`,
        '',
        '',
        formatRatio(table[cell.key]?.metrics?.unmountMainNsPerOp?.ratio),
      ]);
    }
    if (isNumber(cell.memory?.bytesPerInstance)) {
      rows.push([
        'bytes / instance',
        formatBytes(cell.memory.bytesPerInstance),
        `${String(cell.memory.bytesPerInstanceLaunches)} launch samples`,
        '',
        '',
        formatRatio(table[cell.key]?.metrics?.bytesPerInstance?.ratio),
      ]);
    }
    for (const [label, value] of [
      ['native heap / inst', cell.memory?.nativeBytesPerInstance],
      ['java heap / inst', cell.memory?.javaBytesPerInstance],
    ]) {
      if (isNumber(value)) {
        rows.push([
          label,
          formatBytes(value),
          `${String(cell.memory.heapBreakdownLaunches ?? 0)} launch samples`,
          'reported only (not gated)',
          '',
          '',
        ]);
      }
    }
    if (isNumber(cell.memory?.leakSlopeBytesPerCycle)) {
      rows.push([
        'leak slope',
        `${formatBytes(cell.memory.leakSlopeBytesPerCycle)}/cycle`,
        cell.memory.leakMonotonic
          ? 'MONOTONIC (gated as a leak)'
          : 'not monotonic (not gated)',
        '',
        '',
        formatRatio(table[cell.key]?.metrics?.leakSlopeBytesPerCycle?.ratio),
      ]);
    }

    const detail = [
      `${header}\n\n${markdownTable(
        [
          'Metric',
          'median of launch medians',
          'MAD',
          'p95 (pooled)',
          'n',
          'x rn-core',
        ],
        rows
      )}\n`,
    ];

    const noisy = Object.entries(noise[cell.key]?.metrics ?? {})
      .filter(([, value]) => value.noisy)
      .map(([metric]) => metric);
    if (noisy.length > 0) {
      detail.push(
        `Within-run spread above ${String(
          Math.round(NOISE_REL_SPREAD * 100)
        )}% on: ${noisy
          .map(
            (metric) =>
              `${METRIC_LABELS[metric] ?? metric} (${formatSpread(
                noise[cell.key]?.metrics?.[metric]?.relSpread
              )})`
          )
          .join(
            ', '
          )}. Those metrics are reported but cannot carry a verdict.\n`
      );
    }
    const sanity = cell.sanity ?? {};
    const bad = Object.entries(sanity).filter(([, count]) => count > 0);
    detail.push(
      cell.mountSignal === false
        ? // The nulls here are the arm, not the rig: this cell's control has no
          // native transaction to timestamp, so the pair is absent by design and
          // the runner was told not to wait for it.
          `Signal sanity: this cell declares \`mountSignal: false\` - no mount or ` +
            `presentation transaction can exist for this arm, so its latency pair is ` +
            `n/a and ungated by design (${String(
              sanity.missingMount ?? 0
            )} iterations absent by construction, and none of them waited). ${
              bad.length > 1
                ? `Other samples out of order: ${bad.map(([name, count]) => `${name}=${String(count)}`).join(', ')}.`
                : ''
            }\n`
        : bad.length === 0
          ? `Signal sanity: no out-of-order samples (${String(
              cell.launches ?? 0
            )} launches x ${String(cell.protocol?.measured ?? 0)} iterations).\n`
          : `Signal sanity: ${bad
              .map(([name, count]) => `${name}=${String(count)}`)
              .join(', ')} - treat this cell's latency pair with care.\n`
    );
    const incomplete = incompleteMetrics(cell);
    if (incomplete.length > 0) {
      detail.push(
        `Not reportable (over ${String(
          Math.round(MAX_MISSING_SAMPLE_RATIO * 100)
        )}% of its samples missing, so it is n/a and ungated - a median here would describe only the iterations whose signal arrived): ${incomplete
          .map(
            (entry) =>
              `${METRIC_LABELS[entry.metric] ?? entry.metric} ${String(
                entry.samples ?? '?'
              )}${entry.expected == null ? '' : ` of ${String(entry.expected)}`}`
          )
          .join(', ')}.\n`
      );
    }
    if (cell.marks != null) {
      detail.push(
        `Native perf marks (${String(cell.marks.iterations)} measured iterations across ${String(
          cell.marks.launches
        )} launches):\n\n${markdownTable(
          [
            'propsApplied/op',
            'per instance',
            'firstFrame/op',
            'props landed',
            'drew',
            'props -> draw',
          ],
          [
            [
              formatNumber(cell.marks.propsApplied),
              formatNumber(cell.marks.propsAppliedPerInstance, 2),
              formatNumber(cell.marks.firstFrame),
              formatNs(cell.marks.propsAppliedNs),
              formatNs(cell.marks.firstFrameNs),
              formatNs(cell.marks.drawLatencyNs),
            ],
          ]
        )}\n\n> Instrumented: recording a mark is a UI-thread mutex write and the drain is JS\n> work, so this explains the numbers above instead of measuring them again. A\n> \`--perf-marks\` run can never mint a baseline.\n`
      );
    }
    if (cell.memory?.heapCollected === false) {
      detail.push(
        'Hermes `globalThis.gc()` is unavailable in this build, so footprint samples include uncollected JS heap.\n'
      );
    }
    sections.push(detail.join('\n'));
  }
  return sections.join('\n');
}

/** Human summary of run metadata, so a pasted table explains itself. */
export function runHeader(run) {
  const cells = cellsFrom(run);
  const protocol = Object.values(cells)[0]?.protocol ?? {};
  const machine = run.machine ?? {};
  const lines = [
    `- platform: \`${run.platform}\` on \`${run.deviceName}\` (key \`${run.deviceKey}\`)`,
    `- commit: \`${run.sha}\`${run.dirty ? ' (dirty tree)' : ''}`,
    `- plan: \`${run.plan}\`, ${String(run.launches ?? '?')} launches per cell, ${String(protocol.warmup ?? '?')} warmup + ${String(protocol.measured ?? '?')} measured iterations`,
    `- clock: \`${run.clock ?? 'unknown'}\` (absolute, per D1)`,
  ];
  if (run.perfMarks === true) {
    lines.push(
      '- native perf marks: **ON** - every iteration paid for instrumentation, so these numbers diagnose; they do not gate'
    );
  }
  if (run.art != null) {
    lines.push(
      `- ART: \`${String(run.art.status)}\` for \`${String(run.art.packageName)}\` (${String(run.art.attempts)} attempt(s))${
        run.art.status === 'speed-profile'
          ? ''
          : ' **(not compiled - this run measured the interpreter, and it cannot be compared with a `speed-profile` run)**'
      }`
    );
  } else if (run.platform === 'android') {
    lines.push(
      '- ART: **not recorded** - a run from before T12 left the app at `verify`, so its numbers belong to the interpreter regime'
    );
  }
  if (machine.cpuCount != null) {
    const cpu = machine.cpuModel != null ? ` (${machine.cpuModel})` : '';
    lines.push(
      `- machine: \`${machine.hostname}\`, ${String(machine.cpuCount)} cores${cpu}, load average ${machine.loadavg1?.toFixed(2)} / ${machine.loadavg5?.toFixed(2)}${machine.quiet === false ? ' **(busy)**' : ''}`
    );
  }
  if (machine.osVersion != null) {
    lines.push(
      `- OS: \`${machine.osPlatform}\` ${machine.osVersion}${machine.xcode != null ? `, Xcode \`${machine.xcode}\`` : ''}${machine.androidImage != null ? `, image \`${machine.androidImage}\`` : ''}`
    );
  }
  lines.push(`- generated: ${run.createdAt}`);
  return lines.join('\n');
}

/**
 * One comparison -> markdown + exit code, shared by `run.mjs` and the standalone
 * reporter (`mode` only changes the wording and whether absolute control
 * movement is worth printing).
 */
export function comparisonSections({
  run,
  base,
  mode,
  label,
  baseTable = null,
  baseNoise = null,
}) {
  const headTable = ratioTable(run);
  const headNoise = noiseTable(headTable);
  const resolvedBaseTable = baseTable ?? ratioTable(base);
  const resolvedBaseNoise = baseNoise ?? noiseTable(resolvedBaseTable);
  const result = gate({
    head: run,
    base,
    headTable,
    baseTable: resolvedBaseTable,
    headNoise,
    baseNoise: resolvedBaseNoise,
  });
  const movement =
    mode === 'compare' ? controlMovement(cellsFrom(base), cellsFrom(run)) : [];

  const sections = [
    `## ${mode === 'check' ? 'Check against' : 'head/base vs'} ${label}`,
    '',
    mode === 'check'
      ? 'Both columns are launch-paired ratios to `rn-core`, so an OS or machine change cannot move the verdict.'
      : 'Gated on `head(x/rn-core) / base(x/rn-core)`, so machine drift cancels.',
    '',
    gateTable(result, mode),
    '',
    gateSummary(result, mode),
  ];
  if (movement.length > 0) {
    sections.push(
      '',
      `Context only - the \`rn-core\` control itself moved more than ${String(
        Math.round(CONTROL_NOTE_THRESHOLD * 100)
      )}% between the two runs on ${String(movement.length)} metric(s): ${movement
        .map(
          (finding) =>
            `\`${finding.key}\` ${METRIC_LABELS[finding.metric] ?? finding.metric} ${formatRatio(finding.ratio)}`
        )
        .join(', ')}.`
    );
  }
  return {
    markdown: `${sections.join('\n')}\n`,
    result,
    exitCode: result.conclusiveFailure ? 1 : 0,
  };
}

function gateTable(result, mode) {
  const rows = [];
  for (const row of result.rows) {
    if (row.status === 'missing-base') {
      rows.push([row.key, '-', '-', '-', '-', 'not measured in base']);
      continue;
    }
    if (row.status === 'skipped-both' || row.status === 'skipped') {
      rows.push([row.key, '-', '-', '-', '-', 'skipped']);
      continue;
    }
    if (row.status === 'new-arm') {
      const ratios = Object.entries(row.armRatios ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(
          ([metric, ratio]) =>
            `${METRIC_LABELS[metric] ?? metric} ${formatRatio(ratio)}`
        );
      rows.push([
        row.key,
        '-',
        '-',
        '-',
        '-',
        `new arm - ${ratios.slice(0, 2).join(', ')} versus rn-core, nothing to regress against until the baseline is refreshed`,
      ]);
      continue;
    }
    for (const [metric, value] of Object.entries(row.perMetric)) {
      const notes = [];
      if (!value.gated) {
        notes.push(
          row.implementation === 'rn-core' ? 'control' : 'reference arm'
        );
      }
      if (value.noisy) {
        notes.push('noisy');
      }
      if (value.conclusive) {
        notes.push('FAIL');
      } else if (value.overThreshold && value.gated) {
        notes.push('over threshold, not conclusive');
      }
      rows.push([
        row.key,
        METRIC_LABELS[metric] ?? metric,
        formatRatio(value.base),
        formatRatio(value.head),
        formatRatio(value.ratio),
        notes.join(', ') ||
          (mode === 'check' ? 'within tolerance' : 'within tolerance'),
      ]);
    }
  }
  return markdownTable(
    [
      'Cell',
      'Metric',
      'base x rn-core',
      'head x rn-core',
      'head/base',
      'verdict',
    ],
    rows
  );
}

function gateSummary(result, mode) {
  const lines = [];
  const noisyCount = Object.values(result.headNoise).reduce(
    (total, cell) =>
      total + Object.values(cell.metrics).filter((value) => value.noisy).length,
    0
  );
  lines.push(
    noisyCount === 0
      ? `Every (scenario, N, metric) was quiet within the run (launch-paired ratio spread under ${String(
          Math.round(NOISE_REL_SPREAD * 100)
        )}% MAD), so every verdict below is conclusive.`
      : `${String(noisyCount)} metric(s) were noisy within the run (launch-paired ratio spread over ${String(
          Math.round(NOISE_REL_SPREAD * 100)
        )}% MAD); those cannot carry a verdict, the rest can.`
  );
  if (result.failures.length === 0) {
    lines.push(
      ``,
      `No gated metric exceeded the ${formatRatio(RATIO_FAIL_THRESHOLD)} threshold${
        mode === 'check' ? ' against the baseline' : ' versus base'
      }.`
    );
    return lines.join('\n');
  }
  lines.push(
    ``,
    `Metrics over the ${formatRatio(RATIO_FAIL_THRESHOLD)} threshold (only \`nitro-ui\` arms gate; a failure also needs a 95% CI that excludes 1.05 and a quiet run):`
  );
  for (const failure of result.failures) {
    const label = failure.conclusive
      ? 'FAIL'
      : failure.gated
        ? failure.noisy
          ? 'reported, not conclusive (noisy)'
          : 'reported, not conclusive (CI covers 1.05)'
        : 'reported (reference arm - never gates)';
    lines.push(
      `- ${label} \`${failure.key}\` ${METRIC_LABELS[failure.metric] ?? failure.metric}: ${formatRatio(failure.ratio)}${
        failure.ci == null
          ? ' (no CI: too few launch samples)'
          : failure.ci.hierarchical
            ? `, 95% CI ${formatRatio(failure.ci.low)}-${formatRatio(failure.ci.high)} (hierarchical bootstrap over ${String(failure.ci.launchSamples)} launches)`
            : `, 95% CI ${formatRatio(failure.ci.low)}-${formatRatio(failure.ci.high)} (launch bootstrap over ${String(failure.ci.launchSamples)} launches)`
      }`
    );
  }
  return lines.join('\n');
}

export function renderMarkdown(run) {
  return [
    `# Bench ${run.platform} - ${run.plan}`,
    '',
    runHeader(run),
    `- duration: ${String(Math.round(run.durationMs / 1000))}s`,
    run.problems.length === 0
      ? '- problems: none'
      : `- problems:\n${run.problems.map((problem) => `  - ${problem}`).join('\n')}`,
    '',
    '## Summary (absolute)',
    '',
    summaryTable(run),
    '',
    '## Summary (launch-paired ratio to rn-core)',
    '',
    summaryTable(run, { vsControl: true }),
    '',
    '> `presented` is a frame stamp, not a duration: the time from the start of',
    '> the JS commit until the frame that latched the transaction (iOS: the first',
    '> `CADisplayLink` tick after the mount; Android: intended vsync + total frame',
    '> duration). Both platforms differ by a frame, so compare arms, not platforms.',
    '',
    detailSections(run),
  ].join('\n');
}
