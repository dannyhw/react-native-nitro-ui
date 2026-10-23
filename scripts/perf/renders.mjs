/**
 * Hard gate on JS wrapper renders, backed by Reassure. It runs inside
 * `bun run check` (T02 review S13), so a wrapper regression fails every task's
 * own gate command.
 *
 *   bun run check                              includes this gate
 *   bun run perf:renders                       measure + compare to the baseline
 *   bun run perf:renders -- --update-baseline  record current counts as baseline
 *   bun run perf:renders -- --root src         widen/narrow where tests live
 *
 * Reassure measures **JS renders only** - nothing native (docs/research/
 * setup-decisions.md SS6: "Reassure measures nothing native"). Its job is to
 * catch wrapper regressions: a component that stopped being memoised, a context
 * that now re-renders a subtree, a `useEffect` that causes an extra commit. So
 * the gate is exact equality on render counts, not a tolerance.
 *
 * Four things have to hold, per measured test (docs/tasks/T02-bench.review.md
 * "Re-render gate" - counts alone are not enough):
 *
 * 1. the count equals the baseline's;
 * 2. every one of the ~10 runs produced the **same** count - a median would hide
 *    a wrapper that renders nondeterministically (review NIT);
 * 3. `issues.initialUpdateCount === 0` - no synchronous `setState` in a mount
 *    effect, i.e. no render that the first render could have produced itself;
 * 4. `issues.redundantUpdates` is empty - no commit whose rendered output was
 *    identical to the previous one (prop churn, a missing memo).
 *
 * For 3 and 4 to mean anything, the test must **drive** the component through a
 * `scenario`, not just mount it: a bare mount measures one render and there is
 * nothing redundant to find. See docs/architecture/benchmarks.md ("Re-render
 * contract") for the harness pattern - flip the control a few times *and* render
 * an unrelated parent a few times, so "re-renders when told, and only then"
 * becomes the assertion.
 *
 * With no `*.perf-test.tsx` present the script passes loudly: the gate is wired
 * but there is nothing to measure yet (true until the first component lands).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const BASELINE_FILE = path.join(
  REPO_ROOT,
  'bench',
  'baselines',
  'renders.json'
);
const CURRENT_FILE = path.join(REPO_ROOT, '.reassure', 'current.perf');
const DEFAULT_ROOTS = ['src'];
const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  'lib',
  'dist',
  'android',
  'ios',
  'cpp',
]);

/** The file name convention Reassure itself looks for (`*.(perf|perf-test).*`). */
const SUFFIXES = ['.perf-test.ts', '.perf-test.tsx'];

function findPerfTests(roots) {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  for (const root of roots) {
    walk(path.join(REPO_ROOT, root));
  }
  return found.sort();
}

/** Reassure writes one JSON object per measured test. */
function readCurrentMeasurements() {
  if (!fs.existsSync(CURRENT_FILE)) {
    throw new Error(
      `Reassure finished without writing ${path.relative(REPO_ROOT, CURRENT_FILE)}.`
    );
  }
  /** @type {Map<string, {count: number|null, samples: number[], unstableCounts: number[]|null, initialUpdateCount: number|null, redundantUpdates: number[]|null}>} */
  const measurements = new Map();
  for (const line of fs
    .readFileSync(CURRENT_FILE, 'utf8')
    .split('\n')
    .filter((entry) => entry.trim().length > 0)) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // Reassure writes a header line with metadata first.
      continue;
    }
    if (record.type !== 'render' || record.name == null) {
      continue;
    }
    const samples = Array.isArray(record.counts)
      ? record.counts.filter((entry) => typeof entry === 'number')
      : [];
    // `median(counts)` used to be the gate value, which read the same whether a
    // wrapper rendered 4 times every run or 4/5/4/9/4/... A wrapper whose render
    // count is not reproducible is exactly the bug this gate exists to catch, so
    // the spread is an outcome, not noise to average away.
    const unique = [...new Set(samples)].sort((a, b) => a - b);
    const value = unique.length === 1 ? (unique[0] ?? null) : null;
    if (samples.length === 0 && typeof record.meanCount !== 'number') {
      throw new Error(
        `Cannot read a render count from ${path.relative(REPO_ROOT, CURRENT_FILE)} for "${String(record.name)}" (expected Reassure's \`counts\` or \`meanCount\`).`
      );
    }
    const issues = record.issues ?? {};
    measurements.set(record.name, {
      // `meanCount` is only a fallback for builds that do not write `counts`;
      // with no per-run samples the spread simply cannot be judged.
      count: value ?? record.meanCount,
      samples,
      unstableCounts: unique.length > 1 ? unique : null,
      initialUpdateCount:
        typeof issues.initialUpdateCount === 'number'
          ? issues.initialUpdateCount
          : null,
      redundantUpdates: Array.isArray(issues.redundantUpdates)
        ? issues.redundantUpdates
        : null,
    });
  }
  return measurements;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return parsed?.tests ?? parsed;
}

/** One-line summary of Reassure's `issues` for a measured test. */
function issuesText(measurement) {
  const parts = [];
  if (measurement.initialUpdateCount != null) {
    parts.push(`mount+${String(measurement.initialUpdateCount)}`);
  }
  if (measurement.redundantUpdates != null) {
    parts.push(`redundant[${String(measurement.redundantUpdates.join(','))}]`);
  }
  return parts.join(' ') === '' ? 'n/a' : parts.join(' ');
}

function writeBaseline(counts) {
  const sorted = Object.fromEntries(
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, measurement]) => [name, measurement.count])
  );
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        $comment:
          'JS render counts recorded by `bun run perf:renders -- --update-baseline`. The gate is exact equality (every run must produce this count), plus Reassure `issues` checks: no render right after mount and no redundant commit. Re-run with --update-baseline and review the diff when a wrapper legitimately changes how often it renders.',
        tests: sorted,
      },
      null,
      2
    )}\n`
  );
}

function table(rows) {
  const header = ['Test', 'Baseline', 'Current', 'Issues', 'Status'];
  const widths = header.map((title, index) =>
    Math.max(
      title.length,
      ...rows.map((row) => String(row[index] ?? '').length)
    )
  );
  const line = (cells) =>
    `| ${cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join(' | ')} |`;
  return [
    line(header),
    `|${widths.map((width) => ' --- ').join('|')}|`,
    ...rows.map((cells) => line(cells)),
  ].join('\n');
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 || index + 1 >= argv.length
    ? null
    : (argv[index + 1] ?? null);
}

export async function main(argv) {
  const update = argv.includes('--update-baseline');
  const rootsArg = flag(argv, '--root');
  const roots = rootsArg != null ? [rootsArg] : DEFAULT_ROOTS;

  const tests = findPerfTests(roots);
  if (tests.length === 0) {
    process.stdout.write(
      [
        `perf:renders - no *.perf-test.tsx found under ${roots.map((root) => `${root}/`).join(', ')}.`,
        'PASS (nothing to measure). The gate is wired: a component adds',
        '`src/<Component>.perf-test.tsx` calling `measureRenders(<Component />)`',
        'and its render counts become a hard gate from that moment.',
        '',
      ].join('\n')
    );
    return;
  }

  process.stdout.write(
    `perf:renders - measuring ${tests.length} perf test(s)\n`
  );
  for (const test of tests) {
    process.stdout.write(`  ${test}\n`);
  }

  fs.rmSync(CURRENT_FILE, { force: true });
  // Jest matches `testMatch` against absolute paths, so a `./src/**` pattern
  // silently matches nothing. `<rootDir>` is the token Jest expands.
  const testMatch = roots.flatMap((root) =>
    SUFFIXES.map(
      (suffix) =>
        `<rootDir>/${String(root).replace(/^\.\//, '').replace(/\/+$/, '')}/**/*${suffix}`
    )
  );
  try {
    execFileSync(
      'bunx',
      ['reassure', 'measure', '--no-compare', '--testMatch', ...testMatch],
      { cwd: REPO_ROOT, stdio: 'inherit' }
    );
  } catch (error) {
    throw new Error(
      `Reassure failed (${String(error.message)}). Run \`bunx reassure measure\` to see the test output.`
    );
  }

  const current = readCurrentMeasurements();
  if (current.size === 0) {
    throw new Error(
      'Reassure measured 0 tests. Each perf test must call measureRenders() inside an it().'
    );
  }

  // A count that varies between runs cannot be a baseline, so refuse to mint one
  // from it rather than freezing whichever number the median happened to pick.
  const unstable = [...current.entries()].filter(
    ([, measurement]) => measurement.count === null
  );
  if (unstable.length > 0) {
    throw new Error(
      [
        `${String(unstable.length)} measured test(s) did not render the same number of times in every run:`,
        ...unstable.map(
          ([name, measurement]) =>
            `  - ${name}: saw ${String(measurement.unstableCounts?.join(', '))} across ${String(measurement.samples.length)} runs`
        ),
        'A wrapper must render deterministically; make the test drive a fixed',
        'sequence of actions (and check for a timer or an effect that fires late).',
      ].join('\n')
    );
  }

  const issueRows = [...current.entries()]
    .filter(
      ([, measurement]) =>
        (measurement.initialUpdateCount ?? 0) > 0 ||
        (measurement.redundantUpdates?.length ?? 0) > 0
    )
    .map(([name, measurement]) => [
      name,
      '-',
      measurement.count,
      issuesText(measurement),
      'redundant renders',
    ]);

  if (update) {
    writeBaseline(current);
    process.stdout.write(
      `\nRecorded ${String(current.size)} render count(s) in ${path.relative(REPO_ROOT, BASELINE_FILE)}:\n\n`
    );
    process.stdout.write(
      `${table(
        [...current.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, measurement]) => [
            name,
            '-',
            measurement.count,
            issuesText(measurement),
            'recorded',
          ])
      )}\n`
    );
    if (issueRows.length > 0) {
      process.stdout.write(
        '\nWARNING: the recorded baseline includes wrappers with redundant renders.\n'
      );
    }
    return;
  }

  const baseline = readBaseline();
  if (baseline == null) {
    throw new Error(
      `${tests.length > 1 ? 'Perf tests exist' : 'A perf test exists'} but ${path.relative(REPO_ROOT, BASELINE_FILE)} does not. Record one with \`bun run perf:renders -- --update-baseline\` and commit it.`
    );
  }

  const rows = [];
  let failed = false;
  for (const [name, measurement] of [...current.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const value = measurement.count;
    const expected = baseline[name];
    const status = [];
    if (expected == null) {
      status.push('NEW (no baseline)');
    } else if (expected !== value) {
      const delta = Number(value) - expected;
      status.push(`CHANGED (${delta > 0 ? '+' : ''}${String(delta)})`);
    }
    if ((measurement.initialUpdateCount ?? 0) > 0) {
      status.push(
        `${String(measurement.initialUpdateCount)} update render(s) right after mount`
      );
    }
    if ((measurement.redundantUpdates?.length ?? 0) > 0) {
      status.push(
        `${String(measurement.redundantUpdates?.length)} redundant render(s)`
      );
    }
    if (status.length > 0) {
      failed = true;
      rows.push([
        name,
        expected ?? '-',
        value,
        issuesText(measurement),
        status.join('; '),
      ]);
    } else {
      rows.push([name, expected, value, issuesText(measurement), 'ok']);
    }
  }
  for (const name of Object.keys(baseline).sort()) {
    if (!current.has(name)) {
      failed = true;
      rows.push([name, baseline[name], '-', '-', 'REMOVED (stale baseline)']);
    }
  }

  process.stdout.write(`\n${table(rows)}\n`);
  if (failed) {
    throw new Error(
      [
        'Render contract violated: counts moved away from the baseline, or a',
        'wrapper performed a render it should not have (an extra render after',
        'mount, or a commit whose output was unchanged).',
        'If a count change is intended, run',
        '`bun run perf:renders -- --update-baseline` and review the diff.',
      ].join('\n')
    );
  }
  process.stdout.write(
    `\nPASS - ${String(current.size)} wrapper(s) render exactly as many times as the baseline says, with no redundant renders.\n`
  );
}

if (
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`\nperf:renders - ${String(error.message)}\n`);
    process.exitCode = 1;
  });
}
