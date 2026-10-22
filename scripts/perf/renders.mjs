/**
 * Hard gate on JS wrapper render counts, backed by Reassure.
 *
 *   bun run perf:renders                     measure + compare to the baseline
 *   bun run perf:renders -- --update-baseline  record current counts as baseline
 *   bun run perf:renders -- --root src        widen/narrow where tests live
 *
 * Reassure measures **JS renders only** - nothing native (docs/research/
 * setup-decisions.md SS6: "Reassure measures nothing native"). Its job is to
 * catch wrapper regressions: a component that stopped being memoised, a context
 * that now re-renders a subtree, a `useEffect` that causes an extra commit. So
 * the gate is exact equality on render counts, not a tolerance.
 *
 * A component opts in by adding `src/<Component>.perf-test.tsx`:
 *
 *   import { measureRenders } from 'reassure';
 *   import { Switch } from './Switch';
 *
 *   it('Switch renders once per mount', () => {
 *     measureRenders(<Switch value />);
 *   });
 *
 * `runs: 10` is Reassure's default and what the research doc picked, so the
 * tests do not set it. These files do not match Jest's default `testMatch`, so
 * `bun test` ignores them and only this script runs them.
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
  const counts = new Map();
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
    // Reassure reports per-run render counts as `counts` plus `meanCount`.
    // The median of the runs is what the gate compares: it is a whole number,
    // and one flaky run that rendered an extra time out of ten does not move
    // it. A real wrapper regression moves it every run.
    const samples = Array.isArray(record.counts)
      ? record.counts.filter((entry) => typeof entry === 'number')
      : [];
    const value =
      samples.length > 0
        ? samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]
        : record.meanCount;
    if (typeof value !== 'number') {
      throw new Error(
        `Cannot read a render count from ${path.relative(REPO_ROOT, CURRENT_FILE)} for "${String(record.name)}" (expected Reassure's \`counts\` or \`meanCount\`).`
      );
    }
    counts.set(record.name, value);
  }
  return counts;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return parsed?.tests ?? parsed;
}

function writeBaseline(counts) {
  const sorted = Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        $comment:
          'JS render counts recorded by `bun run perf:renders -- --update-baseline`. The gate is exact equality: re-run with --update-baseline and review the diff when a wrapper legitimately changes how often it renders.',
        tests: sorted,
      },
      null,
      2
    )}\n`
  );
}

function table(rows) {
  const header = ['Test', 'Baseline', 'Current', 'Status'];
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

  if (update) {
    writeBaseline(current);
    process.stdout.write(
      `\nRecorded ${current.size} render count(s) in ${path.relative(REPO_ROOT, BASELINE_FILE)}:\n\n`
    );
    process.stdout.write(
      `${table(
        [...current.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => [name, '-', value, 'recorded'])
      )}\n`
    );
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
  for (const [name, value] of [...current.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const expected = baseline[name];
    if (expected == null) {
      failed = true;
      rows.push([name, '-', value, 'NEW (no baseline)']);
    } else if (expected !== value) {
      failed = true;
      const delta = value - expected;
      rows.push([
        name,
        expected,
        value,
        `CHANGED (${delta > 0 ? '+' : ''}${String(delta)})`,
      ]);
    } else {
      rows.push([name, expected, value, 'ok']);
    }
  }
  for (const name of Object.keys(baseline).sort()) {
    if (!current.has(name)) {
      failed = true;
      rows.push([name, baseline[name], '-', 'REMOVED (stale baseline)']);
    }
  }

  process.stdout.write(`\n${table(rows)}\n`);
  if (failed) {
    throw new Error(
      'Render counts changed. If this is intended, run `bun run perf:renders -- --update-baseline` and review the baseline diff.'
    );
  }
  process.stdout.write(
    `\nPASS - ${String(current.size)} wrapper(s) render exactly as many times as the baseline says.\n`
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
