/**
 * The pure half of the gate ledger: the rules `scripts/gate.mjs` applies, with no
 * process spawning, no git and no `import.meta`, so jest can import it.
 */

import { codeTreeDigest, contentHash, isCodeFile } from './app-stamp-core.mjs';
import { ACQUIRE_HINT, emulatorSerial, leaseIsLive } from './lease-core.mjs';

/** Where a machine's ledgers live. Gitignored: a ledger is local evidence. */
export const LEDGER_DIR = '.gates';

/** The name of the gate log store inside a clone's git common directory. */
export const LOG_STORE_BASENAME = 'nitro-ui-gates';

/**
 * The shape of the JSON lines this version writes (see `ledgerLineFromRun`).
 * Older lines are still read: with no `trees` they compare on the full digest, and
 * with no `treeAfter` they are taken at their word.
 */
export const LEDGER_VERSION = 6;

/** The platforms a device gate can be keyed to. */
export const PLATFORMS = ['ios', 'android'];

/** Every device gate in the ledger, in the order a report wants to read them. */
export const MERGE_GATES = [
  'check',
  'harness:ios',
  'harness:android',
  'real-input:ios',
  'real-input:android',
];

/**
 * Paths that run the checks rather than change what ships.
 *
 * An explicit allow-list, not `scripts/` wholesale: a device run imports much of
 * `scripts/` (the harness config, the runners, the build scripts), so a script not
 * listed here stays unmapped and counts as both platforms.
 *
 * A tooling path belongs to no platform, so it is in neither per-platform digest:
 * editing one re-owes `check`, which is keyed to the full tree, and no device run.
 */
export const TOOLING_PREFIXES = [
  'scripts/__tests__/',
  'scripts/bench/',
  'scripts/perf/',
  'scripts/smoke/',
  'eslint-rules/',
  'etc/',
  '.changeset/',
];

/** The tooling paths that are single files, named rather than globbed. */
export const TOOLING_FILES = [
  'scripts/gate.mjs',
  'scripts/gate-core.mjs',
  // The supervisor `gate.mjs` runs each gate's command under.
  'scripts/gate-runner.mjs',
  'scripts/nitrogen-check.mjs',
  'scripts/readme-examples-check.mjs',
  'scripts/package-files.mjs',
  'scripts/release-catch-up.mjs',
  'scripts/check-autolinking.mjs',
  'scripts/doctor.mjs',
  'scripts/doctor-core.mjs',
  // Writes only the file the release path writes; a device run consumes
  // `example/ios/Podfile.lock` itself, which is mapped as iOS.
  'scripts/sync-example-lock.mjs',
  'scripts/example-lock-core.mjs',
  'scripts/check.mjs',
  'scripts/check-steps.mjs',
  // Writes source regions only when asked to (`--write`); the half `check` runs
  // writes nothing.
  'scripts/gen-registry.mjs',
  'scripts/registry-core.mjs',
  // The build-slot lock decides when a build may start, never what goes into it.
  'scripts/build-slot-core.mjs',
  // The device and port allocator. The harness config and the Android real-input
  // runner import env guards from it; those decide which device a run may address,
  // never what is compiled, so a wrong one refuses a run instead of changing a binary.
  'scripts/lease.mjs',
  'scripts/lease-core.mjs',
  // The template `doctor.mjs --setup` copies to `~/.nitro-ui/devices.json`. A device
  // run reads that copy, never this file, and neither is in the app.
  'scripts/devices.example.json',
  // The hand-in checklist: reads the ledger, the registry and the report, runs nothing.
  'scripts/task-ready.mjs',
  'scripts/task-ready-core.mjs',
  // The worktree lister and the watchdog: nothing a device run starts imports either.
  'scripts/worktrees.mjs',
  'scripts/worktrees-core.mjs',
  'scripts/watchdog.mjs',
  'scripts/watchdog-core.mjs',
  // The task-record retention tool. No device run imports it.
  'scripts/task-records.mjs',
  'scripts/task-records-core.mjs',
  // The README's code samples. It sits under `example/src/`, which the directory
  // rule would call both platforms, but no app code imports it.
  'example/src/readme-examples.tsx',
  // Wires `eslint-rules/` to the files it checks; no build reads it.
  'eslint.config.mjs',
  '.gitignore',
  '.prettierignore',
];

/**
 * @param {string} file repo-relative path
 * @returns {boolean} whether this path is tooling (check-only, no platform)
 */
export function isToolingPath(file) {
  const clean = String(file ?? '').replace(/^\.\//, '');
  return (
    TOOLING_FILES.includes(clean) ||
    TOOLING_PREFIXES.some((prefix) => clean.startsWith(prefix))
  );
}

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
  for (const platform of PLATFORMS) {
    if (touchedPlatforms.includes(platform)) gates.push(`harness:${platform}`);
  }
  return gates;
}

/**
 * Which platforms a *single* code file belongs to, and how that was decided.
 *
 * `kind` is `'tooling'` for check-only paths, `'non-code'` for anything outside
 * the code tree, `'mapped'` for a path the rules below place, and `'unmapped'`
 * for code outside them. `unmapped` counts as both platforms, and `need` names
 * it: not knowing what a change touched has to be visible and expensive, never
 * quietly cheap.
 *
 * @param {string} file repo-relative path with forward slashes
 * @returns {{kind: 'ios'|'android'|'both'|'unmapped'|'tooling'|'non-code',
 *   platforms: ('ios'|'android')[]}}
 */
export function platformMappingFor(file) {
  const clean = String(file ?? '').replace(/^\.\//, '');
  if (!isCodeFile(clean)) return { kind: 'non-code', platforms: [] };
  if (isToolingPath(clean)) return { kind: 'tooling', platforms: [] };
  const both = { kind: 'both', platforms: [...PLATFORMS] };
  if (
    clean === 'NitroUi.podspec' ||
    clean.startsWith('ios/') ||
    clean.startsWith('example/ios/')
  ) {
    return { kind: 'ios', platforms: ['ios'] };
  }
  if (clean.startsWith('android/') || clean.startsWith('example/android/')) {
    return { kind: 'android', platforms: ['android'] };
  }
  // The generated halves are checked before the bare `nitrogen/` prefix, so each
  // belongs to its own platform; `shared` and anything else stays both.
  if (clean.startsWith('nitrogen/generated/ios/'))
    return { kind: 'ios', platforms: ['ios'] };
  if (clean.startsWith('nitrogen/generated/android/'))
    return { kind: 'android', platforms: ['android'] };
  if (
    clean.startsWith('cpp/') ||
    clean.startsWith('src/') ||
    clean.startsWith('nitrogen/')
  ) {
    return both;
  }
  // Nothing claimed it: both platforms, and `need` says which paths it guessed on.
  return { kind: 'unmapped', platforms: [...PLATFORMS] };
}

/**
 * The platforms whose per-platform tree includes this file: `[]` for tooling and
 * non-code, both for unmapped code. See `platformMappingFor` for the rules.
 *
 * @param {string} file repo-relative path with forward slashes
 * @returns {('ios'|'android')[]}
 */
export function platformsOwningFile(file) {
  return platformMappingFor(file).platforms;
}

/**
 * Which platforms a code diff touches, derived from paths, plus the tooling and
 * the unmapped paths it touched. Docs and bench paths are not code (`isCodeFile`),
 * so a docs commit asks for no device run.
 *
 * @param {string[]} paths repo-relative paths
 * @returns {{platforms: ('ios'|'android')[], unmapped: string[], tooling: string[]}}
 */
export function platformsTouchedByPaths(paths) {
  const platforms = new Set();
  const unmapped = [];
  const tooling = [];
  for (const raw of paths) {
    const mapping = platformMappingFor(raw);
    if (mapping.kind === 'non-code') continue;
    if (mapping.kind === 'tooling') {
      tooling.push(String(raw).replace(/^\.\//, ''));
      continue;
    }
    if (mapping.kind === 'unmapped')
      unmapped.push(String(raw).replace(/^\.\//, ''));
    for (const platform of mapping.platforms) platforms.add(platform);
  }
  return {
    platforms: PLATFORMS.filter((platform) => platforms.has(platform)),
    unmapped,
    tooling,
  };
}

/**
 * The per-platform digests for a set of `path -> content hash` entries.
 *
 * Each is the full tree's digest restricted to the files that belong to that
 * platform (`platformsOwningFile`). Shared code (`src/`, `cpp/`) is in both
 * binaries, so a change there moves both digests.
 *
 * @param {Record<string, string>} entries path -> content hash
 * @returns {Record<'ios'|'android', string>}
 */
export function platformTreesFromEntries(entries) {
  const byPlatform = { ios: {}, android: {} };
  for (const [file, hash] of Object.entries(entries ?? {})) {
    for (const platform of platformsOwningFile(file)) {
      byPlatform[platform][file] = hash;
    }
  }
  return {
    ios: codeTreeDigest(byPlatform.ios),
    android: codeTreeDigest(byPlatform.android),
  };
}

/**
 * The git invocations that say what a branch changed (used by `need`).
 *
 * `--no-renames` is load-bearing: git follows renames by default and prints only
 * the destination, so moving an iOS source into `docs/` would read as a docs change
 * and ask for no iOS gate.
 *
 * @param {string} mergeBase
 * @returns {string[][]} argument arrays for `git`
 */
export function changedPathsGitArgs(mergeBase) {
  return [
    ['diff', '--name-only', '--no-renames', `${mergeBase}...HEAD`],
    ['diff', '--name-only', '--no-renames', mergeBase],
    ['ls-files', '--others', '--exclude-standard'],
  ];
}

/**
 * One run of one gate, as it is written to the ledger.
 *
 * `tree` is the code tree the command ran against, the key every decision reads.
 * It excludes docs, so a docs commit does not invalidate a device run; `head` is
 * recorded beside it and never gates anything. `stepTimings` (the steps of
 * `check`) and `suiteTimings` (the suites of a harness run) are records only: no
 * decision in this file reads them.
 *
 * @returns {object} a JSON-ready line
 */
export function ledgerLineFromRun({
  gate,
  command,
  tree,
  trees = null,
  treeAfter = null,
  head,
  branch,
  platform = null,
  device = null,
  lease = null,
  load = null,
  durationMs,
  result,
  counts = null,
  summaries = null,
  stepTimings = null,
  suiteTimings = null,
  logPath = null,
  startedAt,
  exitCode = null,
  signal = null,
}) {
  return {
    v: LEDGER_VERSION,
    ts: new Date(startedAt).toISOString(),
    gate,
    command,
    tree,
    trees,
    treeAfter,
    head: head ?? null,
    branch: branch ?? null,
    platform,
    device,
    lease,
    load,
    durationMs: Math.round(durationMs),
    result,
    counts,
    summaries,
    stepTimings,
    suiteTimings,
    logPath,
    exitCode,
    signal,
  };
}

/**
 * The per-step records on a ledger line, or `[]` for a gate that has none.
 * Anything that is not an object with a `name` is dropped, so a hand-edited or
 * half-written line cannot make `table` throw.
 *
 * @param {object | undefined} entry a ledger line
 * @returns {Array<{name: string, status: string, durationMs: number, exitCode: number | null, signal: string | null, reason: string | null}>}
 */
export function stepTimingsOf(entry) {
  const steps = entry?.stepTimings?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter(
    (step) =>
      step != null && typeof step === 'object' && typeof step.name === 'string'
  );
}

const STEP_STATUS_LABELS = {
  pass: '**PASS**',
  fail: '**FAIL**',
  skipped: 'not started',
};

/**
 * The per-step table `gate.mjs table --full` prints under the gate rows.
 *
 * @param {object} options
 * @param {object[]} options.entries ledger lines
 * @param {string[]} [options.gates] which gates to render, in order
 * @returns {string} Markdown, or `''` when no line has step timings
 */
export function renderStepTimings({ entries, gates = null }) {
  const lists = listByGate(entries);
  const names = gates ?? Object.keys(lists);
  const blocks = [];
  for (const gate of names) {
    const list = lists[gate] ?? [];
    // The newest line that has them, which is the run the gate row above reports.
    const entry = [...list]
      .reverse()
      .find((line) => stepTimingsOf(line).length > 0);
    const steps = stepTimingsOf(entry);
    if (steps.length === 0) continue;
    const jobs = entry?.stepTimings?.jobs;
    const rows = steps.map((step) => {
      // The runner's `reason` already spells out the exit code and signal, so the
      // numbers are only the fallback. Pipes are escaped for the table cell.
      const detail =
        step.reason != null
          ? String(step.reason)
          : step.signal != null
            ? `signal ${step.signal}`
            : typeof step.exitCode === 'number' && step.exitCode !== 0
              ? `exit ${step.exitCode}`
              : '';
      return `| \`${step.name}\` | ${STEP_STATUS_LABELS[step.status] ?? step.status} | ${formatDuration(step.durationMs)} | ${detail.replaceAll('|', '\\|') || '—'} |`;
    });
    blocks.push(
      [
        `### \`${gate}\` steps${jobs == null ? '' : ` - ${String(jobs)} job(s)`}`,
        '',
        '| Step | Result | Duration | Detail |',
        '| --- | --- | --- | --- |',
        ...rows,
      ].join('\n')
    );
  }
  return blocks.join('\n\n');
}

/**
 * Ledger text -> entries. Blank lines are skipped and an unparseable line is
 * kept as a `{ corrupt: true }` marker, so a half-written line from an interrupted
 * run shows up in `status` rather than vanishing.
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
 * The lines for each gate name, in append order.
 *
 * Append order decides, not the timestamp: a tie, or a clock that moved, would
 * let a timestamp pick the wrong winner.
 *
 * @param {object[]} entries
 * @returns {Record<string, object[]>}
 */
export function listByGate(entries) {
  const lists = {};
  for (const entry of entries) {
    if (typeof entry?.gate !== 'string') continue;
    (lists[entry.gate] ??= []).push(entry);
  }
  return lists;
}

/**
 * The platform half of the tree a gate is keyed to, or `null` for a gate that is
 * not per-platform (`check`, `smoke:*`, `bench`).
 *
 * @param {string} gate
 * @returns {'ios'|'android'|null}
 */
export function platformOfGate(gate) {
  const name = String(gate ?? '');
  for (const prefix of ['harness:', 'real-input:']) {
    if (!name.startsWith(prefix)) continue;
    const platform = name.slice(prefix.length).split(':')[0];
    if (PLATFORMS.includes(platform)) return platform;
  }
  return null;
}

/**
 * Which tree a line is evidence for.
 *
 * A device gate is evidence about one binary, so it is keyed to that platform's
 * half of the tree (`platformTreesFromEntries`) at both stages: a change inside
 * `ios/` voids only the iOS runs, shared or unmapped code voids both, and a
 * tooling-only commit voids neither. Any other gate, `check` above all, reads
 * every platform's files, so it is keyed to the whole tree.
 *
 * `stage` is not part of the decision; callers may still pass it.
 *
 * @param {{gate: string, stage?: string}} options
 * @returns {'ios'|'android'|'full'}
 */
export function digestKeyFor({ gate }) {
  return platformOfGate(gate) ?? 'full';
}

/**
 * Green / red / stale / missing for one line of one gate on one code tree.
 *
 * `stale` means the line is not evidence about this code, whether it passed or
 * failed; `need` reports it as missing. Two ways in:
 *
 *   - the digest the gate is keyed to does not match; or
 *   - the tree moved while the run went on (`treeAfter` != `tree`). Metro serves
 *     the edited JS and jest reads files lazily, so such a run proved neither tree.
 *
 * @param {object} options
 * @param {string} options.gate
 * @param {object | undefined} options.entry
 * @param {'review'|'merge'} [options.stage]
 * @param {string | null} [options.tree] the full code tree being asked about
 * @param {Record<string, string> | null} [options.trees] the per-platform trees
 * @returns {{state: string, entry: object | null, matched: string | null,
 *   key: string, why: string | null, want: string | null, got: string | null}}
 */
export function gateStateFor({
  gate,
  entry,
  stage = 'merge',
  tree = null,
  trees = null,
}) {
  if (entry == null) {
    return {
      state: 'missing',
      entry: null,
      matched: null,
      key: digestKeyFor({ gate, stage }),
      why: null,
      want: null,
      got: null,
    };
  }
  const key = digestKeyFor({ gate, stage });
  const want = key === 'full' ? tree : (trees?.[key] ?? null);
  const got =
    key === 'full' ? (entry.tree ?? null) : (entry.trees?.[key] ?? null);
  // A line with no `trees` falls back to the full digest rather than reading as
  // stale forever.
  const useKey = want != null && got != null ? key : 'full';
  const useWant = useKey === 'full' ? tree : want;
  const useGot = useKey === 'full' ? (entry.tree ?? null) : got;
  const base = { entry, key: useKey, want: useWant, got: useGot };
  if (useWant == null || useGot == null || useWant !== useGot) {
    return { ...base, state: 'stale', matched: null, why: 'tree' };
  }
  if (
    entry.treeAfter != null &&
    entry.tree != null &&
    entry.treeAfter !== entry.tree
  ) {
    return { ...base, state: 'stale', matched: null, why: 'moved' };
  }
  return {
    ...base,
    state: entry.result === 'pass' ? 'green' : 'red',
    matched: useKey,
    why: null,
  };
}

/**
 * The row for one gate, given every line it has.
 *
 * The latest line whose digest matches the tree being asked about wins: a pass on
 * one tree, a fail on a second, then a revert to the first is green again, because
 * the current code is the code that passed. With no matching line the latest one
 * is returned as `stale`, so `status` can still name the tree it came from. A line
 * whose tree moved mid-run is never decisive.
 *
 * @param {object} options
 * @param {string} options.gate
 * @param {object[]} [options.list] that gate's lines, in append order
 * @param {'review'|'merge'} [options.stage]
 * @param {string | null} [options.tree]
 * @param {Record<string, string> | null} [options.trees]
 * @returns {object} a row: `{gate, state, entry, matched, key, why, want, got}`
 */
export function gateRowFor({
  gate,
  list = [],
  stage = 'merge',
  tree = null,
  trees = null,
}) {
  const args = { gate, stage, tree, trees };
  let decisive = null;
  let latest = null;
  for (const entry of list) {
    const row = gateStateFor({ ...args, entry });
    if (row.state === 'green' || row.state === 'red') decisive = row;
    latest = row;
  }
  if (decisive != null) return { gate, ...decisive };
  if (latest != null) return { gate, ...latest };
  return {
    gate,
    state: 'missing',
    entry: null,
    matched: null,
    key: digestKeyFor(args),
    why: null,
    want: tree,
    got: null,
  };
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
 * @param {string | null} [options.tree] the full code tree
 * @param {Record<string, string> | null} [options.trees] the per-platform trees
 * @param {'review'|'merge'} [options.stage] how strict a match counts
 * @param {string[]} [options.required]
 * @returns {object[]} rows with `gate`, `state`, `entry`, `matched`
 */
export function summarizeGates({
  entries,
  tree = null,
  trees = null,
  stage = 'review',
  required = MERGE_GATES,
}) {
  const lists = listByGate(entries);
  return gatesSeen(entries, required).map((gate) =>
    gateRowFor({ gate, list: lists[gate] ?? [], stage, tree, trees })
  );
}

/**
 * What `need` decides.
 *
 * @param {object} options
 * @param {object[]} options.entries ledger lines
 * @param {string | null} options.tree the full code tree being asked about
 * @param {Record<string, string> | null} [options.trees] the per-platform trees
 * @param {'review'|'merge'} options.stage
 * @param {('ios'|'android')[]} [options.touchedPlatforms]
 * @param {string[]} [options.unmappedPaths] code paths outside the known prefixes
 * @param {string[]} [options.toolingPaths] check-only paths the diff touched
 * @param {boolean} [options.diffUnknown] when the diff could not be read
 * @returns {{ok: boolean, stage: string, required: object[], missing: string[],
 *   notes: string[]}}
 */
export function decideNeed({
  entries,
  tree,
  trees = null,
  stage,
  touchedPlatforms = [],
  unmappedPaths = [],
  toolingPaths = [],
  diffUnknown = false,
}) {
  const requiredGates = requiredGatesFor({ stage, touchedPlatforms });
  const lists = listByGate(entries);
  const required = requiredGates.map((gate) =>
    gateRowFor({ gate, list: lists[gate] ?? [], stage, tree, trees })
  );

  const missing = required
    .filter((row) => row.state !== 'green')
    .map((row) => row.gate);

  const notes = [];
  if (stage === 'review' && touchedPlatforms.length === 0) {
    notes.push(
      toolingPaths.length > 0
        ? `the code diff is tooling (check-only) only: ${toolingPaths
            .slice(0, 6)
            .join(
              ', '
            )}${toolingPaths.length > 6 ? ', …' : ''} - no device gate is ` +
            'asked for beyond check (a device run does not depend on these files)'
        : 'the code diff touches no platform-specific code, so no device gate is ' +
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

/** The counts column: `162 tests / 11 suites`. A failing run leads with the failures. */
export function formatCounts(counts) {
  if (counts == null || typeof counts !== 'object') return '—';
  const tests = counts.tests ?? null;
  const suites = counts.suites ?? null;
  const parts = [];
  if (tests != null) {
    const total =
      tests.total ??
      (tests.passed ?? 0) + (tests.failed ?? 0) + (tests.skipped ?? 0);
    parts.push(
      tests.failed > 0
        ? `${String(tests.failed)} failed of ${String(total)} tests`
        : `${String(total)} tests`
    );
  }
  if (suites != null) {
    const total =
      suites.total ??
      (suites.passed ?? 0) + (suites.failed ?? 0) + (suites.skipped ?? 0);
    parts.push(`${String(total)} suites`);
  }
  if (parts.length === 0) return '—';
  return tests == null && suites != null
    ? `${parts[0]} / —`
    : parts.join(' / ');
}

/**
 * The counts a row reports. A gate that prints several summaries shows its first
 * (for `check`, the unit-test run); when anything failed, it shows the total
 * across steps instead, so a red row never sits beside a passing-looking count.
 *
 * @param {object | undefined} entry a ledger line
 * @returns {object | null}
 */
export function countsForDisplay(entry) {
  const summaries =
    Array.isArray(entry?.summaries) && entry.summaries.length > 0
      ? entry.summaries
      : entry?.counts != null
        ? [entry.counts]
        : [];
  if (summaries.length === 0) return entry?.counts ?? null;
  if (summaries.length === 1) return summaries[0];
  const failed = summaries.reduce(
    (total, summary) =>
      total + (summary?.tests?.failed ?? 0) + (summary?.suites?.failed ?? 0),
    0
  );
  return failed > 0 ? combineSummaries(summaries) : summaries[0];
}

/**
 * The Counts cell of a row. A full `harness:<platform>` run prints two summaries - the
 * shared run, then the isolated suites' own app instance (`scripts/harness-isolated.mjs`)
 * - and both are shown, each with its own failures, so a table says the isolated run
 * happened and what it held.
 *
 * @param {object | undefined} entry a ledger line
 * @returns {string}
 */
export function formatRowCounts(entry) {
  const summaries = Array.isArray(entry?.summaries) ? entry.summaries : [];
  if (
    /^harness:(ios|android)$/.test(entry?.gate ?? '') &&
    summaries.length === 2
  ) {
    return `${formatCounts(summaries[0])} + isolated ${formatCounts(summaries[1])}`;
  }
  return formatCounts(countsForDisplay(entry));
}

/** Sum two or more step summaries into one, so a red row can lead with them. */
export function combineSummaries(summaries) {
  const keys = ['passed', 'failed', 'skipped', 'pending', 'total'];
  const out = { suites: null, tests: null };
  for (const field of ['suites', 'tests']) {
    let seen = null;
    for (const summary of summaries) {
      const value = summary?.[field];
      if (value == null) continue;
      seen ??= {};
      for (const key of keys) {
        if (typeof value[key] === 'number')
          seen[key] = (seen[key] ?? 0) + value[key];
      }
    }
    out[field] = seen;
  }
  return out.suites == null && out.tests == null ? null : out;
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
 * The tree cell: which digest the row was matched on. A row matched on its
 * platform's half says so, because the full digest beside it is not the current tree.
 */
function formatTreeCell(row) {
  const entry = row.entry;
  if (entry?.tree == null) return '—';
  const short = String(entry.tree).slice(0, 12);
  if (row.state === 'stale') return `${short} (not this tree)`;
  if (row.matched != null && row.matched !== 'full')
    return `\`${short}\` (${row.matched} tree)`;
  return `\`${short}\``;
}

/**
 * The Markdown gate table for a report. Generated, so a report cannot claim a
 * gate the ledger has no line for, and a row whose tree is not the current one
 * says `stale` instead of `PASS`.
 *
 * @param {object} options
 * @param {object[]} options.entries
 * @param {string | null} [options.tree]
 * @param {Record<string, string> | null} [options.trees]
 * @param {'review'|'merge'} [options.stage]
 * @param {string[]} [options.required]
 * @param {(entry: object) => string} [options.evidence] how to cite a run
 * @returns {string}
 */
export function renderGateTable({
  entries,
  tree = null,
  trees = null,
  stage = 'review',
  required = MERGE_GATES,
  evidence = null,
}) {
  const rows = summarizeGates({ entries, tree, trees, stage, required });
  const header =
    '| Gate | Result | Counts | Code tree | Duration | Load |' +
    '\n| --- | --- | --- | --- | --- | --- |';
  const body = rows.map((row) => {
    const entry = row.entry;
    const evidenceText =
      evidence != null && entry != null ? ` ${evidence(entry)}` : '';
    return (
      `| \`${row.gate}\` | ${STATE_LABELS[row.state] ?? row.state} | ` +
      `${formatRowCounts(entry)} | ${formatTreeCell(row)} | ` +
      `${entry == null ? '—' : formatDuration(entry.durationMs)} | ` +
      `${entry == null ? '—' : formatLoad(entry.load)}${evidenceText} |`
    );
  });
  return [header, ...body].join('\n');
}

/**
 * Summarise the load samples a gate took. A gate is never refused for load, so
 * this only records how loaded the machine was while it ran.
 *
 * Every value is rounded, because `os.loadavg()` returns a float. `end` is the
 * last sample rather than a fresh read, so it is the same measurement the median
 * was computed from.
 *
 * @param {{start: number | null, samples: number[]}} options
 * @returns {{start: number | null, median: number | null, max: number | null, count: number, end: number | null}}
 */
export function summarizeLoad({ start = null, samples = [] }) {
  const round = (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value * 100) / 100
      : null;
  const values = samples.filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return {
      start: round(start),
      median: null,
      max: null,
      count: 0,
      end: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    start: round(start),
    median: round(median),
    max: round(Math.max(...values)),
    count: values.length,
    end: round(values[values.length - 1]),
  };
}

/**
 * The jest-style summaries a gate printed, from its log, in document order.
 * `bun run check` prints several.
 *
 * @param {string} text
 * @returns {{suites: object | null, tests: object | null}[]}
 */
export function parseTestSummaries(text) {
  const summaries = [];
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
    if (Object.keys(counts).length === 0) continue;
    const previous = summaries[summaries.length - 1];
    if (previous != null && previous[key] == null) {
      previous[key] = counts;
    } else {
      summaries.push({
        suites: key === 'suites' ? counts : null,
        tests: key === 'tests' ? counts : null,
      });
    }
  }
  return summaries.filter(
    (summary) => summary.suites != null || summary.tests != null
  );
}

/**
 * The first summary a gate printed - the unit-test step, which is the one a
 * report quotes. `null` rather than invented counts.
 *
 * @param {string} text
 * @returns {{suites: object | null, tests: object | null} | null}
 */
export function parseTestCounts(text) {
  return parseTestSummaries(text)[0] ?? null;
}

/**
 * `task/my-branch` -> `task/my-branch.jsonl`.
 *
 * Nested rather than flattened with a separator: any character chosen to replace
 * `/` can collide, because it is itself legal in a ref (`task/a` and `task+a`).
 * Git refs are already path-safe, so nothing is escaped; the guard below is for a
 * branch string that did not come from git.
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

/* ------------------------------ gate log store ------------------------------ */

/**
 * The directory of one clone's gate logs, inside the git directory the worktrees
 * of this clone share. `git worktree remove` deletes a linked worktree's own git
 * directory with the checkout and never the common one, so the logs outlive the
 * worktree that wrote them.
 *
 * @param {string} commonDir the output of `git rev-parse --git-common-dir`
 * @returns {string}
 */
export function gateLogStoreDir(commonDir) {
  return `${String(commonDir).replace(/\/+$/, '')}/${LOG_STORE_BASENAME}`;
}

/**
 * Where one run's log goes, relative to the store: `<branch>/<gate>-<started-at>.log`.
 * `ledgerFileName` supplies the guard against a branch string that is not a git
 * ref: a `../` in it would otherwise write outside the store.
 *
 * @param {string} branch
 * @param {string} logName e.g. `harness+android-2026-10-28T12-00-00.000Z.log`
 * @returns {string}
 */
export function logRelativePath(branch, logName) {
  return `${ledgerFileName(branch).replace(/\.jsonl$/, '')}/${String(logName).replace(/^\/+/, '')}`;
}

/**
 * The name of one run's log file: `<gate>-<iso-time>.log`, with `:` folded to `-`.
 *
 * @param {string} gate
 * @param {number} startedAt
 * @returns {string}
 */
export function logNameFor(gate, startedAt) {
  return `${String(gate).replaceAll(/[^\w.-]+/g, '+')}-${new Date(startedAt).toISOString().replaceAll(':', '-')}.log`;
}

/**
 * Where a ledger line's log actually is.
 *
 * Two shapes resolve:
 *
 *   1. an absolute path — a line whose store was renamed or moved, and a path a
 *      test wrote deliberately;
 *   2. `<branch>/<name>` — the current format, relative to the store.
 *
 * @param {object | null | undefined} entry a ledger line
 * @param {{storeDir?: string | null, repoRoot?: string | null, existsSync?: (file: string) => boolean}} options
 * @returns {{file: string | null, candidates: string[]}} the first existing
 *   candidate, and every path that was asked — so a caller can say *where* it
 *   looked when the answer is "nowhere".
 */
export function ledgerLogCandidates(entry, options) {
  const logPath = typeof entry?.logPath === 'string' ? entry.logPath : null;
  const candidates = [];
  const join = (root, relative) =>
    `${String(root).replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`;
  if (logPath != null && logPath !== '') {
    if (logPath.startsWith('/')) candidates.push(logPath);
    for (const root of [options.repoRoot ?? null, options.storeDir ?? null]) {
      if (root == null) continue;
      candidates.push(join(root, logPath));
    }
  }
  const exists = options.existsSync ?? ((file) => file != null && false);
  return {
    candidates,
    file: candidates.find((candidate) => exists(candidate)) ?? null,
  };
}

/**
 * How long a gate log is kept, and how much of them:
 *
 *   - 35 days by mtime;
 *   - then 64 MiB in total, oldest first;
 *   - a log touched inside `protectNewerThan` is never deleted, because a run in
 *     progress may still be writing it.
 *
 * Failure logs get no exemption.
 */
export const LOG_RETENTION_DAYS = 35;
export const LOG_RETENTION_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Which stored logs a retention sweep deletes: by age, then by size, and never a
 * file whose mtime is inside `protectNewerThan`.
 *
 * @param {Array<{file: string, bytes: number, mtimeMs: number, startedAt?: number | null}>} logs
 *   every stored log, with the store's own bookkeeping merged in where available
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.days]
 * @param {number} [options.maxBytes]
 * @param {number} [options.protectNewerThan] ms; anything touched more recently
 *   than this survives both rules
 * @returns {{victims: Array<{file: string, reason: string}>, keptBytes: number, kept: number}}
 */
export function planLogRetention(
  logs,
  {
    now = Date.now(),
    days = LOG_RETENTION_DAYS,
    maxBytes = LOG_RETENTION_MAX_BYTES,
    protectNewerThan = LOG_RETENTION_MIN_AGE_MS,
  } = {}
) {
  const ageMs = days * 86_400_000;
  const byAge = (logs ?? []).filter((log) => {
    const touchedAt = Number(log?.mtimeMs ?? Number.NaN);
    if (!Number.isFinite(touchedAt)) return false;
    return now - touchedAt > ageMs && now - touchedAt > protectNewerThan;
  });
  const victims = new Map(
    [...byAge]
      .sort((a, b) => Number(a.mtimeMs) - Number(b.mtimeMs))
      .map((log) => [log.file, { file: log.file, reason: 'age' }])
  );
  // Size is measured over what survives the age rule, so the cap is a backstop and
  // not a second way to lose a young log.
  const survivors = (logs ?? []).filter((log) => !victims.has(log.file));
  let total = survivors.reduce((sum, log) => sum + Number(log?.bytes ?? 0), 0);
  if (total > maxBytes) {
    for (const log of [...survivors].sort(
      (a, b) => Number(a.mtimeMs) - Number(b.mtimeMs)
    )) {
      if (total <= maxBytes) break;
      if (now - Number(log.mtimeMs) <= protectNewerThan) continue;
      victims.set(log.file, { file: log.file, reason: 'size' });
      total -= Number(log.bytes ?? 0);
    }
  }
  const kept = (logs ?? []).filter((log) => !victims.has(log.file));
  return {
    victims: [...victims.values()],
    kept: kept.length,
    keptBytes: kept.reduce((sum, log) => sum + Number(log?.bytes ?? 0), 0),
  };
}

/** Never sweep a log touched in the last two hours, whatever the other rules say. */
export const LOG_RETENTION_MIN_AGE_MS = 2 * 60 * 60_000;

/** The markers `gate.mjs` writes around the device context block it appends. */
export const DEVICE_CONTEXT_START =
  'gate: ---- device context (recorded on failure, X12) ----';
export const DEVICE_CONTEXT_END = 'gate: ---- end device context ----';

/**
 * Splits a log into its run output and the device-context block appended to it,
 * so the tail of the run is not buried under the block.
 *
 * @param {string} text
 * @returns {{body: string, context: string | null}}
 */
export function splitDeviceContext(text) {
  const haystack = String(text ?? '');
  const start = haystack.indexOf(DEVICE_CONTEXT_START);
  if (start === -1) return { body: haystack, context: null };
  const end = haystack.indexOf(DEVICE_CONTEXT_END, start);
  const block = haystack.slice(
    start,
    end === -1 ? undefined : end + DEVICE_CONTEXT_END.length
  );
  return {
    body: `${haystack.slice(0, start)}${haystack.slice(end === -1 ? haystack.length : end + DEVICE_CONTEXT_END.length)}`,
    context: block,
  };
}

/** A simulator's UDID, as `simctl` and `xcrun` print it. */
const SIMULATOR_UDID_SHAPE =
  /\b[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\b/gi;

/** An emulator serial, which is what an adb error line leads with. */
const EMULATOR_SERIAL_SHAPE = /\bemulator-\d{2,5}\b/gi;

/**
 * Replaces every device identifier in `text` except the ones this run owns.
 *
 * The device block lists every device on the machine, not just the leased pair,
 * and a committed excerpt must not publish another task's. A device's name and
 * state survive ("iPhone 16 (Booted)"); only the identifier is replaced.
 *
 * @param {string} text
 * @param {{udid?: string | null, serial?: string | null, device?: string | null}} own
 *   the identifiers this run's lease names
 * @returns {string}
 */
export function redactForeignDeviceIds(text, own = {}) {
  const allowed = new Set(
    [own.udid, own.serial, own.device]
      .filter((value) => typeof value === 'string' && value !== '')
      .map((value) => value.toLowerCase())
  );
  const keepOwn = (whole) =>
    allowed.has(whole.toLowerCase()) ? whole : '<other device>';
  return String(text ?? '')
    .replace(SIMULATOR_UDID_SHAPE, keepOwn)
    .replace(EMULATOR_SERIAL_SHAPE, keepOwn);
}

/**
 * Did this stored log belong to a run that failed? Answered from the record that
 * closed the run, and failing that from the ledger line, if the caller has one.
 *
 * @param {object | null | undefined} record the store's record for the log
 * @param {object | null | undefined} entry the ledger line for the same run
 * @returns {boolean | null} null when neither source can say
 */
export function storedLogFailed(record, entry = null) {
  if (record?.done === true) {
    if (typeof record.result === 'string') return record.result === 'fail';
    if (record.exitCode != null) return Number(record.exitCode) !== 0;
  }
  if (record?.done !== true && record?.result != null) {
    return String(record.result) === 'fail';
  }
  if (entry != null && entry.corrupt !== true) {
    if (entry.result === 'fail') return true;
    if (entry.result === 'pass') return false;
  }
  return null;
}

/**
 * Which device a gate ran on and under which lease, read from the lease environment.
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
 * Which gates drive a device, and so which ones owe a lease: a gate with a
 * `platform`, a bench, and a `smoke:expo`/`smoke:rn-cli` run, which boots a device
 * of its own without ever setting `platform`. `check` and `smoke:pack` touch no
 * device. A filtered run is a device gate exactly when its base gate is.
 *
 * @param {{gate?: string, platform?: string | null, bench?: boolean}} resolved
 * @returns {boolean}
 */
export function isDeviceGate(resolved) {
  if (resolved == null) return false;
  if (resolved.bench === true) return true;
  if (resolved.platform != null) return true;
  return smokeTouchesDevice(String(resolved.gate ?? ''));
}

/** Is this gate a `smoke:expo`/`smoke:rn-cli` run, with or without a filter? */
function smokeTouchesDevice(gate) {
  return /^smoke:(expo|rn-cli)(?::|$)/.test(gate);
}

/**
 * Which platform a device gate is about to drive, or null when it has not said yet.
 *
 * Read the way the runner reads it: a harness or real-input gate carries its
 * platform in the name, a bench only has `--platform`, and a smoke run reads the
 * `PLATFORM` variable, which `scripts/smoke/common.sh` defaults to `both`.
 *
 * @param {{gate?: string, platform?: string | null, bench?: boolean, benchPlatform?: string | null}} resolved
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'ios' | 'android' | 'both' | null}
 */
export function deviceGatePlatform(resolved, env = {}) {
  if (resolved == null) return null;
  if (resolved.bench === true) return resolved.benchPlatform ?? null;
  if (resolved.platform != null) return resolved.platform;
  if (smokeTouchesDevice(String(resolved.gate ?? ''))) {
    const platform = String(env?.PLATFORM ?? '').trim();
    return platform === 'ios' || platform === 'android' ? platform : 'both';
  }
  return null;
}

/** Does a lease taken for `leasePlatform` cover a run that needs `needed`? */
function leaseCoversPlatform(leasePlatform, needed) {
  const held = String(leasePlatform ?? '').trim() || 'both';
  return held === 'both' || held === needed;
}

/**
 * Why this device gate must not start on the lease in `env`, or `null`.
 *
 * `NITRO_UI_LEASE_ID` has to name a lease that is still live in the store, for a
 * task and platform that match this run, holding the very devices the environment
 * names. The caller asks before the build, the Metro pre-flight and the first
 * `adb`/`simctl` call, so a refused run has touched no device.
 *
 * The lease record is the authority, not the environment: a shell's variables can
 * be edited, and a released lease's devices are somebody else's now.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} [options.env] the run's environment
 * @param {{gate: string, platform: string | null, bench?: boolean, benchPlatform?: string | null}} options.resolved `resolveGate`'s answer
 * @param {object[]} [options.leases] the live leases from `leases.json`
 * @param {object[] | null} [options.pairs] the pool pairs from `devices.json`
 * @param {string | null} [options.poolProblem] why the pool could not be read
 * @param {number} [options.now]
 * @returns {string | null} the refusal, in the shape `gate.mjs` prints
 */
export function deviceGateLeaseRefusal({
  env = {},
  resolved,
  leases = [],
  pairs = null,
  poolProblem = null,
  now = Date.now(),
} = {}) {
  if (!isDeviceGate(resolved)) return null;
  const gate = String(resolved?.gate ?? 'device gate');
  // Every refusal ends with the commands that fix it.
  const acquire = `Lease a device and source it:\n${ACQUIRE_HINT}`;
  const leaseId = String(env?.NITRO_UI_LEASE_ID ?? '').trim();

  if (leaseId === '') {
    return [
      `${gate} is a device gate and this shell has no lease: ` +
        `NITRO_UI_LEASE_ID is not set, so nothing here says which device this run ` +
        `may use. Without it the runner would pick one itself, and on a shared ` +
        `machine that is another task\'s emulator.`,
      acquire,
    ].join('\n');
  }

  const lease = (Array.isArray(leases) ? leases : []).find(
    (entry) => entry?.id === leaseId
  );
  if (lease == null) {
    return [
      `${gate} is a device gate and NITRO_UI_LEASE_ID=${leaseId} names no lease in ` +
        `the lease store: it was released (or expired and pruned), so its devices ` +
        `belong to the pool again. ${acquire}`,
    ].join('\n');
  }
  if (!leaseIsLive(lease, now)) {
    const ttl = Number(lease.ttlMinutes) || 0;
    return [
      `${gate} is a device gate and lease ${leaseId} (task ${lease.task ?? '?'}) ` +
        `is outlived: it is past its own ${String(ttl)}-minute ttl. A gate that ran ` +
        `on it now would record green for a device it no longer holds, and the pool ` +
        `may have handed that device to another task. ${acquire}`,
    ].join('\n');
  }

  const task = String(env?.NITRO_UI_LEASE_TASK ?? '').trim();
  if (task !== '' && lease.task != null && task !== lease.task) {
    return [
      `${gate} has an environment from two leases: NITRO_UI_LEASE_ID=${leaseId} ` +
        `belongs to task ${lease.task}, but NITRO_UI_LEASE_TASK says ${task}. ` +
        `Source one lease file, not two — the gate cannot tell which devices the ` +
        `mismatched variables were meant to name.`,
      acquire,
    ].join('\n');
  }

  const holds = Array.isArray(lease.holds) ? lease.holds : null;
  if (holds == null || holds.length === 0) {
    return [
      `${gate} cannot check lease ${leaseId}: its record holds no pair, so there ` +
        `is no device the store agrees this run may use. Release it and take a ` +
        `fresh one (\`node scripts/lease.mjs list\` shows what is there).`,
      acquire,
    ].join('\n');
  }

  const needed = deviceGatePlatform(resolved, env);
  if (needed === null) {
    // A bench with no `--platform`: the runner refuses that run itself, and nothing
    // here can say which half of the pair to check.
    return null;
  }
  if (!leaseCoversPlatform(lease.platform, needed)) {
    return [
      `${gate} drives ${needed}, and lease ${leaseId} was taken for ` +
        `${lease.platform ?? 'the other'} devices. ${acquire}`,
    ].join('\n');
  }

  // The pool is asked about only once the lease fits: a stale lease is the refusal
  // the caller can fix in one command, so it is reported first.
  if (poolProblem != null) {
    return [
      `${gate} cannot check lease ${leaseId}: ${poolProblem}. A device gate is ` +
        `refused rather than run unverifiable — without the pool it cannot know ` +
        `which devices the lease holds.`,
      acquire,
    ].join('\n');
  }

  const held = (Array.isArray(pairs) ? pairs : []).filter((pair) =>
    holds.includes(pair?.id)
  );
  if (held.length === 0) {
    return [
      `${gate} cannot check lease ${leaseId}: it holds ${holds.join(', ')}, which ` +
        `is no pair in this machine's devices.json. The pool changed after the ` +
        `lease was taken — release it and take one from the current pool.`,
      acquire,
    ].join('\n');
  }

  if (needed === 'ios' || needed === 'both') {
    const refusal = checkLeasedIosDevice({ env, gate, lease, held, acquire });
    if (refusal != null) return refusal;
  }
  if (needed === 'android' || needed === 'both') {
    const refusal = checkLeasedAndroidDevice({
      env,
      gate,
      lease,
      held,
      acquire,
    });
    if (refusal != null) return refusal;
  }
  return null;
}

/**
 * Does the environment name the simulator this lease holds?
 *
 * `IOS_UDID` is checked too because `scripts/real-input/ios.mjs` reads it *before*
 * `IOS_SIM_UDID`: a shell that exports both, with the second one leased, would have
 * the gate approve a device the runner then ignores.
 */
function checkLeasedIosDevice({ env, gate, lease, held, acquire }) {
  const udid = String(env?.IOS_SIM_UDID ?? '').trim();
  const udids = held
    .map((pair) => pair?.ios?.udid)
    .filter((entry) => entry != null && entry !== '');
  if (udid === '') {
    return [
      `${gate} has no simulator to run on: lease ${lease.id} is live, but ` +
        `IOS_SIM_UDID is not set, so this shell did not source that lease.`,
      acquire,
    ].join('\n');
  }
  const override = String(env?.IOS_UDID ?? '').trim();
  if (override !== '' && override !== udid) {
    return [
      `${gate} names two simulators: IOS_UDID=${override} (which ` +
        `scripts/real-input/ios.mjs prefers) and IOS_SIM_UDID=${udid}, which is ` +
        `the one lease ${lease.id} exports. Unset IOS_UDID and run on the leased ` +
        `simulator.`,
      acquire,
    ].join('\n');
  }
  if (!udids.includes(udid)) {
    return [
      `${gate} would run on ${udid}, which is not a device of lease ${lease.id} ` +
        `(it holds ${held.map((pair) => pair?.id).join(', ')}). ` +
        `The environment was edited, or belongs to another task's lease.`,
      acquire,
    ].join('\n');
  }
  return null;
}

/**
 * Does the environment name the emulator this lease holds — and only it?
 *
 * The serial is derived from the pair's console port the same way
 * `renderEnvFile` derives the one the lease exports, so a hand-set
 * `ANDROID_SERIAL` that points at a warm but unleased emulator cannot pass. The adb
 * server is checked against the pair too: the default server on 5037 also sees
 * every other device on the machine.
 */
function checkLeasedAndroidDevice({ env, gate, lease, held, acquire }) {
  const serial = String(env?.ANDROID_SERIAL ?? '').trim();
  const bySerial = held.filter((pair) => {
    const port = pair?.android?.emulatorPort;
    return port != null && emulatorSerial(port) === serial;
  });
  if (serial === '') {
    return [
      `${gate} has no emulator to run on: lease ${lease.id} is live, but ` +
        `ANDROID_SERIAL is not set, so this shell did not source that lease. ` +
        `This is where the 2026-11-11 incident started — with no serial the runner ` +
        `went looking for one.`,
      acquire,
    ].join('\n');
  }
  if (bySerial.length === 0) {
    const leased = held
      .filter((pair) => pair?.android?.emulatorPort != null)
      .map((pair) => emulatorSerial(pair.android.emulatorPort));
    return [
      `${gate} would drive ${serial}, which is not the emulator of lease ` +
        `${lease.id} (${leased.join(', ') || 'it holds no emulator'}). ` +
        `Address the leased serial, or take a lease for that device.`,
      acquire,
    ].join('\n');
  }
  const pair = bySerial[0];
  const avd = String(env?.ANDROID_AVD ?? env?.AVD ?? '').trim();
  if (avd !== '' && pair?.android?.avd != null && avd !== pair.android.avd) {
    return [
      `${gate} has an environment from two leases: ANDROID_SERIAL=${serial} is ` +
        `lease ${lease.id}'s ${pair.id}, whose AVD is ${pair.android.avd}, but ` +
        `ANDROID_AVD says ${avd}.`,
      acquire,
    ].join('\n');
  }
  const server = String(env?.ANDROID_ADB_SERVER_PORT ?? '').trim();
  if (
    pair?.android?.adbPort != null &&
    server !== String(pair.android.adbPort)
  ) {
    return [
      `${gate} would address ${server === '' ? "the machine's own adb server" : `adb server ${server}`}, ` +
        `and lease ${lease.id} exports ${pair.android.adbPort} for ${serial}. The ` +
        `default server also sees every other device on this machine, which is why ` +
        `AGENTS.md says to use the lease's.`,
      acquire,
    ].join('\n');
  }
  return null;
}

/**
 * A gate name with any extra arguments encoded into it, so a filtered run can
 * never be recorded as the full gate.
 *
 * `harness:android` plus `ColdSizing` is `harness:android:ColdSizing`, and
 * `real-input:android` plus `--control switch` is
 * `real-input:android:--control:switch`. Each argument is URI-encoded, so `x:y`
 * as one argument cannot impersonate two. The encoding is idempotent
 * (`gate.mjs harness:android:ColdSizing` records the same name), so a recorded
 * name can be pasted straight back as a command.
 *
 * @param {string} base e.g. `harness:android`
 * @param {string[]} [extraArgs]
 * @returns {string}
 */
export function canonicalGateName(base, extraArgs = []) {
  const args = extraArgs.filter((value) => String(value) !== '');
  if (args.length === 0) return base;
  return `${base}:${args.map((value) => encodeURIComponent(value)).join(':')}`;
}

/** The flags that mean "just tell me how this is spelled". */
export const USAGE_PROBE_FLAGS = ['--help', '-h'];

/**
 * Is this command line a help probe rather than a gate run?
 *
 * A probe must never run as a gate: `bench --help` would launch the runner, which
 * prints its usage and exits 2, and record a FAIL row for a command that measured
 * nothing. Recognised on either side of `--` and in the colon-packed form
 * (`bench:--help`).
 *
 * @param {string} name the gate name as typed
 * @param {string[]} extraArgs every remaining argument, before or after `--`
 * @returns {boolean}
 */
export function isUsageProbe(name, extraArgs = []) {
  const packed = String(name ?? '')
    .split(':')
    .slice(1);
  return [...packed, ...extraArgs].some((value) =>
    USAGE_PROBE_FLAGS.includes(String(value))
  );
}

/**
 * The platform a bench run says it will drive, read out of its own arguments.
 *
 * Read the way `scripts/bench/run.mjs` reads it, as the token after `--platform`:
 * a `--platform=ios` or a colon-packed `bench:--platform:ios` is a run the runner
 * refuses to start, so it is null here too, like anything but `ios`/`android`.
 *
 * @param {string[]} args the bench's own arguments
 * @returns {'ios' | 'android' | null}
 */
export function benchPlatformFromArgs(args = []) {
  const index = args.indexOf('--platform');
  if (index === -1 || index + 1 >= args.length) return null;
  const value = args[index + 1];
  return value === 'ios' || value === 'android' ? value : null;
}

/**
 * Gate name -> the command to run, where, and the name to record it under.
 *
 * These are the commands `package.json` runs, spelled out because
 * `bun run <script>` mangles arguments that follow it. The returned `gate` is what
 * the ledger records: a run with a filter is a different gate from the full one,
 * and `need` will not accept it in place of one.
 *
 * @param {string} name e.g. `check`, `harness:android`, `harness:android:ColdSizing`
 * @param {string[]} [extraArgs] what came after `--`
 * @returns {{gate: string, argv: string[], cwd: 'repo'|'example',
 *   platform: 'ios'|'android'|null, bench: boolean}}
 */
export function resolveGate(name, extraArgs = []) {
  const args = [...extraArgs];
  if (name === 'check') {
    if (args.length > 0) {
      throw new Error(
        `gate check takes no arguments (got ${args.join(' ')}): check is ` +
          '`bun run check` as one gate - name a narrower gate instead of ' +
          'running a wider one under this name'
      );
    }
    return {
      gate: 'check',
      argv: ['bun', 'run', 'check'],
      cwd: 'repo',
      platform: null,
      bench: false,
    };
  }
  if (name.startsWith('harness:')) {
    const [, platform, ...suites] = name.split(':');
    if (platform !== 'ios' && platform !== 'android') {
      throw new Error(
        `gate ${name}: harness needs a platform - harness:ios or harness:android ` +
          '(append a suite with harness:android:MySuite or -- MySuite)'
      );
    }
    const suiteArgs = [...suites, ...args];
    return {
      gate: canonicalGateName(`harness:${platform}`, suiteArgs),
      // `../scripts/` because the cwd is `example/`.
      argv: [
        'node',
        '../scripts/harness.mjs',
        '--harnessRunner',
        platform,
        ...suiteArgs,
      ],
      cwd: 'example',
      platform,
      bench: false,
    };
  }
  if (name.startsWith('real-input:')) {
    const [, platform, ...extra] = name.split(':');
    if (platform !== 'ios' && platform !== 'android') {
      throw new Error(`gate ${name}: needs ios or android`);
    }
    const extraArgsForRun = [...extra, ...args];
    return {
      gate: canonicalGateName(`real-input:${platform}`, extraArgsForRun),
      argv: ['node', `scripts/real-input/${platform}.mjs`, ...extraArgsForRun],
      cwd: 'repo',
      platform,
      bench: false,
    };
  }
  if (name.startsWith('smoke:')) {
    const [kind, ...extra] = name.slice('smoke:'.length).split(':');
    if (['pack', 'expo', 'rn-cli'].includes(kind) === false) {
      throw new Error(
        `gate ${name}: smoke is one of pack, expo, rn-cli (from package.json)`
      );
    }
    const extraArgsForRun = [...extra, ...args];
    return {
      gate: canonicalGateName(`smoke:${kind}`, extraArgsForRun),
      argv: ['bash', `scripts/smoke/${kind}.sh`, ...extraArgsForRun],
      cwd: 'repo',
      platform: null,
      bench: false,
    };
  }
  if (name === 'bench' || name.startsWith('bench:')) {
    const extra = name === 'bench' ? [] : [name.slice('bench:'.length)];
    const extraArgsForRun = [...extra, ...args];
    return {
      gate: canonicalGateName('bench', extraArgsForRun),
      argv: ['node', 'scripts/bench/run.mjs', ...extraArgsForRun],
      cwd: 'repo',
      // Deliberately null: `platform` keys the device claim, the Metro pre-flight
      // and the harness suite timings, and a bench uses none of them.
      platform: null,
      bench: true,
      // The bench's own `--platform`, for the ledger. A bench lease covers both
      // halves of a pair, so the environment cannot say which device the run drove.
      benchPlatform: benchPlatformFromArgs(extraArgsForRun),
    };
  }
  throw new Error(
    `unknown gate ${name}: use check, harness:<platform>[:suite], ` +
      'real-input:<platform>, smoke:<pack|expo|rn-cli> or bench'
  );
}

/** The line `need` prints for one row, with the reason when it is not satisfied. */
export function explainNeedRow(row, codeTree) {
  if (row.state === 'green') {
    return row.matched != null && row.matched !== 'full'
      ? `${row.gate} — green on the ${row.matched} code tree`
      : `${row.gate} — green`;
  }
  if (row.state === 'red') {
    return `${row.gate} — red (exit ${String(row.entry?.exitCode ?? '?')} on tree ${String(row.entry?.tree ?? '?').slice(0, 12)}, ${row.entry?.logPath ?? 'no log'})`;
  }
  if (row.state === 'stale') {
    const ran = String(row.got ?? row.entry?.tree ?? '?').slice(0, 12);
    if (row.why === 'moved') {
      return `${row.gate} — ran on tree ${ran} while the code tree moved during the run (${String(row.entry?.treeAfter ?? '?').slice(0, 12)} after): re-run it`;
    }
    const label =
      row.key === 'full' || row.key == null
        ? 'code tree'
        : `${row.key} code tree`;
    return `${row.gate} — passed on ${row.key === 'full' ? 'tree' : `the ${row.key} tree`} ${ran} at ${String(row.entry?.head ?? 'unknown HEAD').slice(0, 7)}, which is not this ${label} (${String(row.want ?? codeTree ?? '?').slice(0, 12)}): re-run it`;
  }
  return `${row.gate} — never run on this tree`;
}

/** Re-exported so `gate.mjs` can build the per-platform trees from one listing. */
export { codeTreeDigest, contentHash, isCodeFile };

/* ----------------------------- background gates ---------------------------- */

/**
 * The exit code of `gate.mjs wait` when the gate is still running at the timeout.
 * Distinct from the gate's own failure (1) and from bad arguments (2), so a script
 * can tell "the gate said no" from "keep waiting" without reading a log.
 */
export const STILL_RUNNING_EXIT = 13;

/** The default `wait` budget; `--timeout-minutes` overrides it. */
export const DEFAULT_WAIT_MINUTES = 45;

/** How often `wait` prints a progress line. */
export const WAIT_PROGRESS_INTERVAL_MS = 60_000;

/**
 * Where a backgrounded gate's bookkeeping lives:
 * `<gate>-<started-at>.gate.json`, beside `<gate>-<started-at>.log`.
 *
 * @param {string} logPath the log path already recorded in the ledger line
 */
export function backgroundRecordPath(logPath) {
  return String(logPath).replace(/\.log$/, '.gate.json');
}

/**
 * Which background records belong to this checkout, in the order given.
 *
 * The store is shared by every worktree of the clone, so a record counts only
 * when both its branch and its worktree match: the branch alone would let two
 * worktrees on one branch adopt each other's runs, and the directory alone would
 * not tell this branch's run from an earlier branch's in the same checkout. A
 * record with neither field matches.
 *
 * @param {object[]} records every record in the store
 * @param {{branch: string | null, worktree: string | null}} own this checkout
 * @returns {object[]}
 */
export function ownBackgroundRecords(records, { branch, worktree }) {
  return (records ?? []).filter((record) => {
    if (record == null || typeof record !== 'object') return false;
    const recordBranch =
      typeof record.branch === 'string' && record.branch !== ''
        ? record.branch
        : null;
    const recordWorktree =
      typeof record.worktree === 'string' && record.worktree !== ''
        ? record.worktree
        : null;
    if (recordBranch == null && recordWorktree == null) return true;
    if (recordWorktree != null && recordWorktree !== worktree) return false;
    if (recordBranch != null && recordBranch !== branch) return false;
    return true;
  });
}

/**
 * The last non-empty line of a log, which is what `wait` prints as progress,
 * capped at 200 characters.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function lastLogLine(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
  const last = lines[lines.length - 1];
  if (last == null) return null;
  const trimmed = last.trim();
  return trimmed.length > 200 ? `…${trimmed.slice(-199)}` : trimmed;
}

/**
 * Whether a pid is a process that could still be this gate. EPERM counts as
 * alive: a pid owned by another user is running, even though it cannot be signalled.
 *
 * @param {number} pid
 * @param {(pid: number, signal?: number) => boolean} [kill]
 * @returns {boolean}
 */
export function pidMayBeRunning(pid, kill = process.kill) {
  try {
    kill(Number(pid), 0);
    return true;
  } catch (error) {
    return /** @type {{code?: string}} */ (error).code === 'EPERM';
  }
}

/**
 * What `gate.mjs wait` should do next, given one read of the background record.
 *
 * `record.done` is written by the detached runner only after the ledger line is on
 * disk, so a record that exists without it means the gate is mid-run - not missing,
 * not failed.
 *
 * @param {object} options
 * @param {{pid?: number, done?: boolean, exitCode?: number|null, gate?: string} | null} record
 *   the background record, or null when the file is not there yet
 * @param {boolean} pidAlive whether the recorded pid still exists
 * @param {number} elapsedMs how long `wait` has been waiting
 * @param {number} timeoutMs the caller's budget
 * @param {string | null} progress the log's last line
 * @param {{exitCode?: number|null, result?: string, gate?: string} | null} [ledgerEntry]
 *   the ledger line for this gate, when one exists - the fallback answer when a
 *   runner is gone but its evidence is not
 * @returns {{kind: 'running' | 'exit', exitCode: number, message: string}}
 *   `kind: 'running'` means "print progress and keep going"; `exit` is final.
 */
export function decideWait({
  record,
  pidAlive,
  elapsedMs,
  timeoutMs,
  progress,
  ledgerEntry = null,
}) {
  const show = progress == null ? '' : ` | ${progress}`;
  if (record == null) {
    // The runner writes its record before the gate produces any output, so "no
    // file" is either a race an instant after launch or a run that never started.
    if (elapsedMs >= timeoutMs) {
      return {
        kind: 'exit',
        exitCode: STILL_RUNNING_EXIT,
        message: 'no background gate record to wait for',
      };
    }
    return {
      kind: 'running',
      exitCode: 0,
      message: `no background record yet${show}`,
    };
  }

  if (record.done === true) {
    // A signal-killed gate records `exitCode: null`, which is a failure and must
    // never collapse into "passed" through `?? 0`.
    const code =
      record.exitCode == null
        ? record.result === 'pass'
          ? 0
          : 1
        : Number(record.exitCode);
    return {
      kind: 'exit',
      exitCode: code,
      message:
        code === 0
          ? `${record.gate ?? 'gate'} passed`
          : `${record.gate ?? 'gate'} failed with exit ${String(code)}${record.signal == null ? '' : ` (signal ${String(record.signal)})`}`,
    };
  }

  if (!pidAlive) {
    // Killed before it wrote `done`, or a run so fast that the launcher's pid write
    // landed after the run's `done` write and overwrote it. Either way the ledger
    // is the source of truth: a line there means the gate finished with that code.
    if (ledgerEntry != null) {
      const code = Number(
        ledgerEntry.exitCode ?? (ledgerEntry.result === 'pass' ? 0 : 1)
      );
      return {
        kind: 'exit',
        exitCode: code,
        message:
          code === 0
            ? `${record.gate ?? ledgerEntry.gate ?? 'gate'} passed (from the ledger line; its runner is gone)`
            : `${record.gate ?? ledgerEntry.gate ?? 'gate'} failed with exit ${String(code)} (from the ledger line; its runner is gone)`,
      };
    }
    return {
      kind: 'exit',
      exitCode: STILL_RUNNING_EXIT,
      message:
        `${record.gate ?? 'gate'}: pid ${String(record.pid)} is gone without recording a result or a ledger line` +
        (progress == null ? '' : ` (last log line: ${progress})`) +
        ' - read the log, then re-run the gate',
    };
  }

  if (elapsedMs >= timeoutMs) {
    return {
      kind: 'exit',
      exitCode: STILL_RUNNING_EXIT,
      message: `${record.gate ?? 'gate'} still running after ${String(Math.round(elapsedMs / 60_000))} min (pid ${String(record.pid)}) - it was left running, keep waiting or read its log`,
    };
  }

  return {
    kind: 'running',
    exitCode: 0,
    message: `${record.gate ?? 'gate'}: ${String(Math.round(elapsedMs / 1000))}s${show}`,
  };
}

/**
 * Which of the pids serving a Metro port belong to the run that is ending.
 *
 * A run that starts Metro must stop it, or the next gate on the lease finds the
 * port busy and refuses. Ownership is decided by process group: the gate spawns
 * its child detached, so the child leads a group of its own, and only a listener
 * in that group was started by this run. A listener in any other group, or one the
 * kernel cannot answer for, is left alone.
 *
 * The leader itself is never a target: the sweep runs after it has exited, so a
 * process with its pid by then is an unrelated one that reused the number.
 *
 * @param {object} options
 * @param {Array<{pid: number, command: string}>} [options.listeners] what `lsof` found
 * @param {number | null} options.leaderPid the run's direct child, which leads its own group
 * @param {(pid: number) => number | null} options.groupOf the kernel's answer, injected
 * @returns {number[]} the pids this run owns, in the order they were found
 */
export function ownMetroPids({ listeners, leaderPid, groupOf }) {
  const owned = [];
  if (leaderPid == null) return owned;
  for (const listener of listeners ?? []) {
    const pid = Number(listener?.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === leaderPid) continue;
    let group = null;
    try {
      group = groupOf(pid);
    } catch {
      group = null;
    }
    if (group != null && group === leaderPid) owned.push(pid);
  }
  return owned;
}

/**
 * Does a process holding the leased port belong to a gate that died mid-run?
 *
 * `records` are the runner sidecars (`<log>.runner.json`), written when a run
 * starts and naming the process group that run leads. A match needs all three:
 *   - the listener's group is a recorded run's group (otherwise the server is
 *     somebody else's);
 *   - that run's gate process is gone (a live one means the run is still going);
 *   - that run left no ledger line (a run with one finished, and did not die).
 *
 * @param {object} options
 * @param {Array<{group?: number, pid?: number, gatePid?: number, logPath?: string, gate?: string, startedAt?: number}>} records
 *   runner sidecars for runs this branch started
 * @param {Array<{pid: number, command?: string}>} listeners the processes serving the port
 * @param {(pid: number) => boolean} [pidAlive]
 * @param {(pid: number) => number | null} [groupOf] the process group a listener leads, or belongs to
 * @param {Set<string> | string[]} [ledgerLogPaths] log paths with a ledger line
 * @returns {{record: object, listener: {pid: number, command?: string}, group: number} | null}
 */
export function deadGateBehindPort({
  records,
  listeners,
  pidAlive = pidMayBeRunning,
  groupOf = () => null,
  ledgerLogPaths = [],
}) {
  const recorded = (records ?? []).filter(
    (record) =>
      Number.isInteger(Number(record?.group)) && Number(record.group) > 0
  );
  if (recorded.length === 0) return null;
  const written = new Set(
    Array.isArray(ledgerLogPaths) ? ledgerLogPaths : [...(ledgerLogPaths ?? [])]
  );
  for (const listener of listeners ?? []) {
    const listenerPid = Number(listener?.pid);
    if (!Number.isInteger(listenerPid) || listenerPid <= 0) continue;
    let group = null;
    try {
      group = groupOf(listenerPid);
    } catch {
      group = null;
    }
    if (!Number.isInteger(group) || group <= 0) continue;
    const record = recorded.find(
      (candidate) => Number(candidate.group) === group
    );
    if (record == null) continue;
    const gatePid = Number(record.gatePid ?? record.pid);
    if (!Number.isInteger(gatePid) || gatePid <= 0) continue;
    if (pidAlive(gatePid)) continue;
    if (record.logPath != null && written.has(String(record.logPath))) continue;
    return { record, listener, group };
  }
  return null;
}

/**
 * Which backgrounded gates are still running, so `status` does not call a run
 * that is in progress "missing".
 *
 * @param {Array<{pid?: number, done?: boolean, gate?: string, logPath?: string, startedAt?: number}>} records
 * @param {(pid: number) => boolean} [isAlive]
 * @returns {Array<{gate: string, pid: number, startedAt: number | null, logPath: string | null}>}
 */
export function runningBackgroundGates(records, isAlive = pidMayBeRunning) {
  return (records ?? [])
    .filter((record) => record?.done !== true && isAlive(Number(record?.pid)))
    .map((record) => ({
      gate: String(record.gate ?? '?'),
      pid: Number(record.pid),
      startedAt: Number.isFinite(record.startedAt) ? record.startedAt : null,
      logPath: record.logPath ?? null,
    }));
}
