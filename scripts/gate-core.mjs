/**
 * The pure half of the gate ledger (`scripts/gate.mjs` is the half that spawns
 * processes and reads git).
 *
 * Why (docs/tasks/PROCESS-review-2026-10-26.md §3 and §4 rank 4): gates were
 * re-run because a *commit* happened, not because the *code* moved. 104 of 337
 * branch commits were docs-only, and every one of them invalidated every green
 * result, so "re-ran the gates on the final tree" appears in 11 reports. The
 * ledger fixes that by keying a result to the code tree the gate actually ran
 * on - `app.stamp`'s digest (scripts/app-stamp-core.mjs), which already excludes
 * `docs/`, Markdown and build output. A docs commit leaves that digest alone, so
 * a green gate stays green, and the report's gate table is generated from the
 * same lines instead of typed by hand.
 *
 * The re-run rules this encodes are the ones the process review asked for:
 *
 *   - review (an implementation or fix round): `check` plus the harness suites of
 *     the platforms the code diff touches;
 *   - merge: the full set once on the final code tree - `check`, full harness on
 *     both, real-input on both;
 *   - benches are never required here at all (they belong to the bench host, D15
 *     and the second-machine plan).
 *
 * No `import.meta` here, so `scripts/__tests__/gate.test.js` can import it (same
 * reason `scripts/app-stamp-core.mjs` and `scripts/lease-core.mjs` exist).
 */

import { isCodeFile } from './app-stamp-core.mjs';

/** Where a machine's ledgers live. Gitignored: the committed copy is exported. */
export const LEDGER_DIR = '.gates';

/** The shape of the JSON lines this version writes (see `ledgerLineFromRun`). */
export const LEDGER_VERSION = 1;

/** Every device gate in the ledger, in the order a report wants to read them. */
export const MERGE_GATES = [
  'check',
  'harness:ios',
  'harness:android',
  'real-input:ios',
  'real-input:android',
];

/**
 * Gates `need` may ever ask for. Kept as data rather than derived from
 * `MERGE_GATES` so a single-suite harness run is visibly not the full harness:
 * `harness:android:ColdSizing` is a real gate name, and it satisfies nothing.
 */
export const REQUIRED_ELIGIBLE_PREFIXES = [
  'check',
  'harness:',
  'real-input:',
  'smoke:',
];

/**
 * What a stage asks for.
 *
 * - `review`: what a round must show before it can be reviewed. `check` always,
 *   plus one harness gate per platform the round's code diff touches.
 * - `merge`: the whole set, once, on the final code tree.
 *
 * Neither ever contains a bench (`bench` goes to the bench host), and neither
 * contains `harness:cold`/`smoke:*`, which are extra evidence rather than a bar.
 */
export function requiredGatesFor({ stage, touchedPlatforms = [] }) {
  if (stage === 'merge') return [...MERGE_GATES];
  if (stage !== 'review') {
    throw new Error(
      `unknown stage ${String(stage)}: need understands review and merge`
    );
  }
  const gates = ['check'];
  for (const platform of ['ios', 'android']) {
    if (touchedPlatforms.includes(platform)) gates.push(`harness:${platform}`);
  }
  return gates;
}

/**
 * Which platforms a code diff touches, derived from paths (the brief's rule):
 * `android/` is Android, `ios/` is iOS, `cpp/`/`src/`/`nitrogen/` are both.
 *
 * Anything else that is *code* counts as both. That is a deliberate deviation
 * from "derive from paths": `example/`, `patches/` and `package.json` are not in
 * the brief's list, and a ledger that quietly required nothing when a change
 * touched the harness patch or the app's `Main.tsx` would be a machine-shaped
 * false claim - the exact failure class this task exists to remove. Unknown is
 * therefore expensive rather than cheap, and `need` says so in its note.
 *
 * Docs and bench paths are not code (`isCodeFile`), which is what keeps a report
 * commit from asking for a device run.
 *
 * @param {string[]} paths repo-relative paths
 * @returns {{platforms: ('ios'|'android')[], unmapped: string[]}}
 */
export function platformsTouchedByPaths(paths) {
  const platforms = new Set();
  const unmapped = [];
  for (const raw of paths) {
    const file = String(raw).replace(/^\.\//, '');
    if (!isCodeFile(file)) continue;
    if (file === 'NitroUi.podspec' || file.startsWith('ios/')) {
      platforms.add('ios');
    } else if (
      file.startsWith('android/') ||
      file.startsWith('example/android/')
    ) {
      platforms.add('android');
    } else if (
      file.startsWith('cpp/') ||
      file.startsWith('src/') ||
      file.startsWith('nitrogen/')
    ) {
      platforms.add('ios');
      platforms.add('android');
    } else {
      unmapped.push(file);
      platforms.add('ios');
      platforms.add('android');
    }
  }
  return {
    platforms: ['ios', 'android'].filter((p) => platforms.has(p)),
    unmapped,
  };
}

/**
 * One run of one gate, as it is written to the ledger.
 *
 * `tree` is the code tree the command ran against (`currentCodeTree()`), which is
 * the key every decision below reads. `head` is recorded beside it and never
 * gates anything, for the reason given in `codeTreeDigest`: a docs commit must
 * not invalidate a device run.
 *
 * @returns {object} a JSON-ready line
 */
export function ledgerLineFromRun({
  gate,
  command,
  tree,
  head,
  branch,
  platform = null,
  device = null,
  lease = null,
  load = null,
  durationMs,
  result,
  counts = null,
  logPath = null,
  startedAt,
  exitCode = null,
}) {
  return {
    v: LEDGER_VERSION,
    ts: new Date(startedAt).toISOString(),
    gate,
    command,
    tree,
    head: head ?? null,
    branch: branch ?? null,
    platform,
    device,
    lease,
    load,
    durationMs: Math.round(durationMs),
    result,
    counts,
    logPath,
    exitCode,
  };
}

/**
 * Ledger text -> entries. Blank lines are skipped and an unparseable line is
 * kept as a `{ corrupt: true }` marker: a half-written line from an interrupted
 * run must show up in `status` rather than vanish, because the honest reading of
 * a ledger nobody can parse is "missing".
 *
 * @param {string} text
 * @returns {object[]} in append order
 */
export function parseLedger(text) {
  const entries = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed != null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        entries.push(parsed);
      } else {
        entries.push({ corrupt: true, raw: trimmed });
      }
    } catch {
      entries.push({ corrupt: true, raw: trimmed });
    }
  }
  return entries;
}

/**
 * The last line written for each gate name. Append order decides, not the
 * timestamp: two runs in the same second on a machine whose clock moved are
 * exactly when a timestamp tie would pick the wrong winner.
 *
 * @param {object[]} entries
 * @returns {Record<string, object>}
 */
export function latestByGate(entries) {
  const latest = {};
  for (const entry of entries) {
    if (typeof entry?.gate !== 'string') continue;
    latest[entry.gate] = entry;
  }
  return latest;
}

/**
 * Green / red / stale / missing for one gate on one code tree.
 *
 * `stale` is the state the process review was about: a gate that passed on a
 * *different* code tree. It is not red - nothing failed - but it is not evidence
 * either, and `need` reports it as missing with the tree it came from so nobody
 * reads it as a re-run they did not do.
 *
 * @param {object | undefined} entry the latest line for that gate
 * @param {string} codeTree the tree being asked about
 * @returns {{state: string, entry: object | null}}
 */
export function gateStateFor(entry, codeTree) {
  if (entry == null) return { state: 'missing', entry: null };
  if (entry.result === 'pass' && entry.tree === codeTree)
    return { state: 'green', entry };
  if (entry.result === 'pass') return { state: 'stale', entry };
  return { state: 'red', entry };
}

/**
 * Every gate worth a row: the merge set (so a missing gate is visible as a
 * missing gate) plus anything this branch has ever recorded (so a suite run
 * shows up). Ordered, merge set first.
 *
 * @param {object[]} entries
 * @returns {string[]}
 */
export function gatesSeen(entries, required = MERGE_GATES) {
  const seen = new Set(required);
  for (const entry of entries) {
    if (typeof entry?.gate === 'string') seen.add(entry.gate);
  }
  const requiredSet = new Set(required);
  return [...seen].sort((a, b) => {
    const aRank = requiredSet.has(a) ? required.indexOf(a) : required.length;
    const bRank = requiredSet.has(b) ? required.indexOf(b) : required.length;
    return aRank - bRank || a.localeCompare(b);
  });
}

/**
 * What `gate.mjs status` prints and `gate.mjs table` renders: one row per gate.
 *
 * @param {object} options
 * @param {object[]} options.entries
 * @param {string} options.codeTree
 * @param {string[]} [options.required]
 * @returns {object[]} rows with `gate`, `state`, `entry`
 */
export function summarizeGates({ entries, codeTree, required = MERGE_GATES }) {
  const latest = latestByGate(entries);
  return gatesSeen(entries, required).map((gate) => ({
    gate,
    ...gateStateFor(latest[gate], codeTree),
  }));
}

/**
 * What `need` decides.
 *
 * @param {object} options
 * @param {object[]} options.entries ledger lines
 * @param {string} options.codeTree the code tree being asked about
 * @param {'review'|'merge'} options.stage
 * @param {('ios'|'android')[]} [options.touchedPlatforms]
 * @param {string[]} [options.unmappedPaths] code paths outside the known prefixes
 * @param {boolean} [options.diffUnknown] when the diff could not be read
 * @returns {{ok: boolean, stage: string, required: object[], missing: string[],
 *   notes: string[]}}
 */
export function decideNeed({
  entries,
  codeTree,
  stage,
  touchedPlatforms = [],
  unmappedPaths = [],
  diffUnknown = false,
}) {
  const requiredGates = requiredGatesFor({ stage, touchedPlatforms });
  const latest = latestByGate(entries);
  const required = requiredGates.map((gate) => ({
    gate,
    ...gateStateFor(latest[gate], codeTree),
  }));
  const missing = required
    .filter((row) => row.state !== 'green')
    .map((row) => row.gate);

  const notes = [];
  if (stage === 'review' && touchedPlatforms.length === 0) {
    notes.push(
      'the code diff touches no platform-specific code, so no device gate is ' +
        'asked for beyond check (a docs-only commit never invalidates a gate)'
    );
  }
  if (unmappedPaths.length > 0) {
    notes.push(
      `treated as both platforms (outside the known prefixes): ${unmappedPaths
        .slice(0, 6)
        .join(', ')}${unmappedPaths.length > 6 ? ', …' : ''}`
    );
  }
  if (diffUnknown) {
    notes.push(
      'the diff could not be read against the base ref, so both platforms were ' +
        'assumed - pass --base <ref> to name it'
    );
  }
  return { ok: missing.length === 0, stage, required, missing, notes };
}

/** `1234 ms` -> `1.2 s`, `95300` -> `1 m 35 s`. Compact enough for a table cell. */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${String(minutes)} m ${String(seconds).padStart(2, '0')} s`;
}

/**
 * The counts column. `162 tests / 11 suites` reads the way the reports already
 * say it; a failing run shows the failures first, because that is the number
 * that matters in a red row.
 */
export function formatCounts(counts) {
  if (counts == null || typeof counts !== 'object') return '—';
  const tests = counts.tests ?? null;
  const suites = counts.suites ?? null;
  const parts = [];
  if (tests != null) {
    const total = tests.total ?? (tests.passed ?? 0) + (tests.failed ?? 0);
    parts.push(
      tests.failed > 0
        ? `${String(tests.failed)} failed of ${String(total)} tests`
        : `${String(total)} tests`
    );
  }
  if (suites != null) {
    const total = suites.total ?? (suites.passed ?? 0) + (suites.failed ?? 0);
    parts.push(`${String(total)} suites`);
  }
  if (parts.length === 0) return '—';
  return tests == null && suites != null
    ? `${parts[0]} / —`
    : parts.join(' / ');
}

/** `load` in a row: start / median / max, which is what a reader judges by. */
export function formatLoad(load) {
  if (load == null || typeof load !== 'object') return '—';
  const at = (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? value.toFixed(1)
      : '—';
  return `start ${at(load.start)} / med ${at(load.median)} / max ${at(load.max)}`;
}

const STATE_LABELS = {
  green: '**PASS**',
  red: '**FAIL**',
  stale: 'stale',
  missing: 'missing',
};

/**
 * The Markdown gate table for a report.
 *
 * It is generated so the report cannot claim a gate the ledger has no line for,
 * and a row whose tree is not the current one says `stale` instead of `PASS` -
 * the review item "report claims to correct" was mostly this, written by hand.
 *
 * @param {object} options
 * @param {object[]} options.entries
 * @param {string} options.codeTree
 * @param {string[]} [options.required]
 * @param {(entry: object) => string} [options.evidence] how to cite a run
 * @returns {string}
 */
export function renderGateTable({
  entries,
  codeTree,
  required = MERGE_GATES,
  evidence = null,
}) {
  const rows = summarizeGates({ entries, codeTree, required });
  const header =
    '| Gate | Result | Counts | Code tree | Duration | Load |' +
    '\n| --- | --- | --- | --- | --- | --- |';
  const body = rows.map((row) => {
    const entry = row.entry;
    const tree =
      entry?.tree == null
        ? '—'
        : row.state === 'stale'
          ? `${String(entry.tree).slice(0, 12)} (not this tree)`
          : `\`${String(entry.tree).slice(0, 12)}\``;
    const evidenceText =
      evidence != null && entry != null ? ` ${evidence(entry)}` : '';
    return (
      `| \`${row.gate}\` | ${STATE_LABELS[row.state] ?? row.state} | ` +
      `${formatCounts(entry?.counts)} | ${tree} | ` +
      `${entry == null ? '—' : formatDuration(entry.durationMs)} | ` +
      `${entry == null ? '—' : formatLoad(entry.load)}${evidenceText} |`
    );
  });
  return [header, ...body].join('\n');
}

/**
 * Summarise the load samples a gate took, in the shape the brief asks for.
 *
 * Deliberately not `summarizeLoadSamples()` from the bench lib: that one exists
 * to decide whether a run may mint a baseline and needs a ceiling and a p90. A
 * gate row only has to say how loaded the machine was while it ran, which is
 * three numbers - and D21 means a *gate* is not load-refused the way a baseline
 * is, so importing that judgement here would be wrong.
 *
 * @param {{start: number | null, samples: number[]}} options
 * @returns {{start: number | null, median: number | null, max: number | null, count: number}}
 */
export function summarizeLoad({ start = null, samples = [] }) {
  const values = samples.filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return { start, median: null, max: null, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    start,
    median: Math.round(median * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
    count: values.length,
  };
}

/**
 * The jest-style summary a gate printed, from its log.
 *
 * `bun run check` and the harness both end with `Test Suites: …` / `Tests: …`,
 * so a report can say 162/11 without anyone retyping it. For a gate that prints
 * several summaries (`check` runs jest, then perf, then more), the *last* one
 * wins - it is the one the command exited on, and the log path beside it is how
 * a reader checks the rest.
 *
 * @param {string} text
 * @returns {{suites: object | null, tests: object | null} | null}
 */
export function parseTestCounts(text) {
  const last = {};
  const pattern = /^(Test Suites|Tests):\s+(.+)$/gm;
  let match;
  while ((match = pattern.exec(String(text ?? ''))) != null) {
    const key = match[1] === 'Tests' ? 'tests' : 'suites';
    const counts = {};
    for (const segment of match[2].split(',')) {
      const item = /^\s*(\d+)\s+(passed|failed|skipped|pending|total)\b/.exec(
        segment
      );
      if (item != null) counts[item[2]] = Number(item[1]);
    }
    if (Object.keys(counts).length > 0) last[key] = counts;
  }
  if (last.suites == null && last.tests == null) return null;
  return { suites: last.suites ?? null, tests: last.tests ?? null };
}

/**
 * `task/X2-gate-ledger` -> `task/X2-gate-ledger.jsonl`.
 *
 * Nested rather than flattened with a separator: any character chosen to replace
 * `/` collides, because several ref characters map onto one safe one (`task/a`
 * and `task+a` are both legal refs, and so are `task?a` and `task*b`). A
 * directory per branch namespace is the shape that cannot collide, and git refs
 * are already path-safe - `git check-ref-format` forbids `..`, a leading or
 * trailing `/`, `//`, whitespace and every other shell-significant character, so
 * nothing has to be escaped. The guard below is for a caller that passes a branch
 * string that did not come from git.
 */
export function ledgerFileName(branch) {
  const cleaned = String(branch ?? '').trim();
  const name = cleaned === '' || cleaned === 'HEAD' ? 'detached' : cleaned;
  if (
    name.split('/').includes('..') ||
    name.startsWith('/') ||
    name.includes('\0')
  ) {
    throw new Error(
      `not a branch name for a ledger: ${JSON.stringify(branch)} - a git ref has ` +
        'no "..", no leading "/" and no NUL, and a ledger path must not escape .gates/'
    );
  }
  return `${name}.jsonl`;
}

/** @returns {string} repo-relative, so it can be printed and gitignored */
export function ledgerRelativePath(branch) {
  return `${LEDGER_DIR}/${ledgerFileName(branch)}`;
}

/**
 * Which device a gate ran on, read from the lease environment (X1).
 *
 * The ledger records the *lease id* and the serial, not a device name, so the
 * committed evidence stays free of this machine's identifiers (D25) and still
 * answers "which device proved this".
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {'ios'|'android'|null} platform
 */
export function deviceFromEnv(env, platform = null) {
  const lease = env?.NITRO_UI_LEASE_ID ?? null;
  const effective =
    platform ?? (env?.ANDROID_SERIAL != null ? 'android' : null);
  if (effective === 'android') {
    return {
      platform: 'android',
      device: env?.ANDROID_SERIAL ?? env?.ANDROID_AVD ?? null,
      lease,
    };
  }
  if (effective === 'ios') {
    return {
      platform: 'ios',
      device: env?.IOS_SIM_UDID ?? env?.IOS_SIM ?? null,
      lease,
    };
  }
  return { platform: platform ?? null, device: null, lease };
}

/**
 * Gate name -> the command to run, and where.
 *
 * These are the same commands `package.json` runs, spelled out because
 * `bun run <script>` mangles arguments that follow it and a gate name has to
 * survive an append of extra args (a single harness suite). The harness entry is
 * `scripts/harness.mjs` from `example/`, exactly as `bun --cwd example
 * harness:ios` expands to, so the Node guard and the printed command still apply.
 *
 * @param {string} name e.g. `check`, `harness:android`, `harness:android:ColdSizing`
 * @param {string[]} [extraArgs] what came after `--`
 * @returns {{argv: string[], cwd: 'repo'|'example', platform: 'ios'|'android'|null,
 *   bench: boolean}}
 */
export function resolveGate(name, extraArgs = []) {
  const args = [...extraArgs];
  if (name === 'check') {
    return {
      argv: ['bun', 'run', 'check'],
      cwd: 'repo',
      platform: null,
      bench: false,
    };
  }
  if (name.startsWith('harness:')) {
    const [, platform, ...suite] = name.split(':');
    if (platform !== 'ios' && platform !== 'android') {
      throw new Error(
        `gate ${name}: harness needs a platform - harness:ios or harness:android ` +
          '(append a suite with harness:android:MySuite or -- MySuite)'
      );
    }
    const suites = [...suite, ...args];
    return {
      argv: [
        'node',
        'scripts/harness.mjs',
        '--harnessRunner',
        platform,
        ...suites,
      ],
      cwd: 'example',
      platform,
      bench: false,
    };
  }
  if (name.startsWith('real-input:')) {
    const platform = name.slice('real-input:'.length);
    if (platform === '' || platform.includes(':')) {
      throw new Error(`gate real-input:${platform}: needs ios or android`);
    }
    return {
      argv: ['node', `scripts/real-input/${platform}.mjs`, ...args],
      cwd: 'repo',
      platform,
      bench: false,
    };
  }
  if (name.startsWith('smoke:')) {
    const kind = name.slice('smoke:'.length);
    if (['pack', 'expo', 'rn-cli'].includes(kind) === false) {
      throw new Error(
        `gate ${name}: smoke is one of pack, expo, rn-cli (from package.json)`
      );
    }
    return {
      argv: ['bash', `scripts/smoke/${kind}.sh`, ...args],
      cwd: 'repo',
      platform: null,
      bench: false,
    };
  }
  if (name === 'bench' || name.startsWith('bench:')) {
    const extra = name === 'bench' ? [] : [name.slice('bench:'.length)];
    return {
      argv: ['node', 'scripts/bench/run.mjs', ...extra, ...args],
      cwd: 'repo',
      platform: null,
      bench: true,
    };
  }
  throw new Error(
    `unknown gate ${name}: use check, harness:<platform>[:suite], ` +
      'real-input:<platform>, smoke:<pack|expo|rn-cli> or bench'
  );
}

/**
 * The line `need` prints for a row that is not satisfied - the part that makes
 * this usable instead of just a list of names.
 */
export function explainNeedRow(row, codeTree) {
  if (row.state === 'green') return `${row.gate} — green`;
  if (row.state === 'red') {
    return `${row.gate} — red (exit ${String(row.entry?.exitCode ?? '?')} on tree ${String(row.entry?.tree ?? '?').slice(0, 12)}, ${row.entry?.logPath ?? 'no log'})`;
  }
  if (row.state === 'stale') {
    return `${row.gate} — passed on tree ${String(row.entry?.tree ?? '?').slice(0, 12)} at ${String(row.entry?.head ?? 'unknown HEAD').slice(0, 7)}, which is not this code tree (${String(codeTree).slice(0, 12)}): re-run it`;
  }
  return `${row.gate} — never run on this tree`;
}
