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
 *     the platforms the code diff touches, each accepted on *its own platform's*
 *     tree (see `platformTreesFromEntries`), so an Android-only fix does not
 *     re-owe an iOS run;
 *   - merge: the full set once on the final code tree - `check`, full harness on
 *     both, real-input on both - always matched on the whole tree;
 *   - benches are never required here at all (they belong to the bench host, D15
 *     and the second-machine plan).
 *
 * No `import.meta` here, so `scripts/__tests__/gate.test.js` can import it (same
 * reason `scripts/app-stamp-core.mjs` and `scripts/lease-core.mjs` exist).
 */

import { codeTreeDigest, contentHash, isCodeFile } from './app-stamp-core.mjs';

/** Where a machine's ledgers live. Gitignored: the committed copy is exported. */
export const LEDGER_DIR = '.gates';

/**
 * The shape of the JSON lines this version writes (see `ledgerLineFromRun`).
 *
 * v2 adds three fields, all of them from the X2 round-1 review:
 *
 *   - `trees`: `{ios, android}` - the code-tree digest restricted to the files
 *     that belong to that platform. This is what makes the fix-round rule real:
 *     a round that edits only `android/` leaves `trees.ios` alone, so a
 *     `harness:ios` pass from earlier in the branch still counts at review.
 *   - `treeAfter`: the code tree when the run *finished*. A line whose tree moved
 *     under it is not evidence about either tree, so it never reads green (N1).
 *   - `summaries`: every test summary the gate printed, in order. `check` runs
 *     jest, then perf, then more, and "the last summary wins" made its row report
 *     the 7-test perf step instead of the 391-test unit run (M3).
 *
 * v1 lines are still read: with no `trees` they compare on the full digest, and
 * with no `treeAfter` they are taken at their word.
 */
export const LEDGER_VERSION = 2;

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
 * Paths that *run* the checks rather than change what ships.
 *
 * An explicit allow-list, not `scripts/` wholesale (X2 review, "Rules, docs and
 * tests"). A device run imports a lot of `scripts/`: `example/rn-harness.config.mjs`
 * pulls in `app-stamp*.mjs`, `lease-core.mjs`, `node-version.mjs` and
 * `harness-timing-gate.js`, `example/metro.config.js` requires the timing gate,
 * and `scripts/real-input/**`, `harness.mjs`, `build-app.mjs`, `pod-install*.mjs`
 * and `patch-nitrogen.mjs` shape the binary or the run. Everything not listed
 * below therefore stays unmapped, which means both platforms - the expensive
 * answer, which is the right one for a tool a device run depends on.
 *
 * A tooling path belongs to *no* platform, so it is also out of both per-platform
 * digests (`platformsOwningFile`). That is what stops a fix round that edits
 * `scripts/gate.mjs` from re-owing two device runs, and it is the same decision
 * as `check` being keyed to the full tree: tooling is proven by `check`.
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

/** @see TOOLING_PREFIXES - the single-file members, named rather than globbed. */
export const TOOLING_FILES = [
  'scripts/gate.mjs',
  'scripts/gate-core.mjs',
  'scripts/nitrogen-check.mjs',
  'scripts/readme-examples-check.mjs',
  'scripts/package-files.mjs',
  'scripts/release-catch-up.mjs',
  'scripts/check-autolinking.mjs',
  'scripts/doctor.mjs',
  'scripts/doctor-core.mjs',
  // Runs the checks, and only writes the file the release path writes; a device run
  // consumes `example/ios/Podfile.lock` itself, which is mapped as iOS.
  'scripts/sync-example-lock.mjs',
  'scripts/example-lock-core.mjs',
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
 * for code outside them. `unmapped` matters twice over: it counts as both
 * platforms, and `need` names it, because "we did not know what this touched"
 * has to be visible rather than quietly cheap.
 *
 * Counting unmapped code as both is a deliberate deviation from "derive from
 * paths": `example/`, `patches/` and `package.json` are not in the brief's list,
 * and a ledger that quietly required nothing when a change touched the harness
 * patch or the app's `Main.tsx` would be a machine-shaped false claim - the exact
 * failure class this task exists to remove. Unknown is therefore expensive rather
 * than cheap.
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
    // The Podfile, Podfile.lock and the Xcode project are iOS-only, exactly as
    // `example/android/` is Android-only (X2 review N3).
    clean.startsWith('example/ios/')
  ) {
    return { kind: 'ios', platforms: ['ios'] };
  }
  if (clean.startsWith('android/') || clean.startsWith('example/android/')) {
    return { kind: 'android', platforms: ['android'] };
  }
  // The generated halves are checked before the bare `nitrogen/` prefix so each
  // belongs to its own platform (N3); `shared` and anything unseen stays both.
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
 * Which platforms a code diff touches, derived from paths (the brief's rule),
 * plus the tooling and the unmapped paths it touched.
 *
 * Docs and bench paths are not code (`isCodeFile`), which is what keeps a report
 * commit from asking for a device run.
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
 * Each is `codeTreeDigest` over the same hash function and the same file set as
 * the full tree, restricted to the files that belong to that platform
 * (`platformsOwningFile`), so a pass keyed to `trees.ios` means "the iOS half of
 * this tree is exactly the code that ran". Shared code (`src/`, `cpp/`) is in
 * both, so a change there moves both and re-owes both - which is correct, that
 * code is in both binaries.
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
 * `--no-renames` is load-bearing (M4): git follows renames by default and prints
 * only the destination, so `git mv ios/components/Button/Hybrid.swift bench/attic/`
 * reads as "a file appeared in bench/", and the ledger asks for no iOS gate for a
 * commit that deleted an iOS source. The same trick works by moving the file into
 * `docs/`. It is cheap to be wrong here and expensive to notice.
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
    logPath,
    exitCode,
    signal,
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
 * The lines for each gate name, in append order.
 *
 * Append order decides, not the timestamp: two runs in the same second on a
 * machine whose clock moved are exactly when a timestamp tie would pick the wrong
 * winner.
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
 * The last line written for each gate name.
 *
 * Kept for display and for `gatesSeen`; the *decision* uses `gateRowFor`, which
 * prefers the latest line for the tree being asked about (N2).
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
 * Which tree a line is evidence for at a given stage.
 *
 * `review` keys a device gate to its own platform's tree - that is the whole
 * point of recording `trees` (M2). `merge`, and every gate that is not
 * per-platform, keys to the full code tree, so merge still wants every gate once
 * on the final tree.
 *
 * @param {{gate: string, stage?: string}} options
 * @returns {'ios'|'android'|'full'}
 */
export function digestKeyFor({ gate, stage = 'merge' }) {
  if (stage !== 'review') return 'full';
  return platformOfGate(gate) ?? 'full';
}

/**
 * Green / red / stale / missing for one line of one gate on one code tree.
 *
 * `stale` is the state the process review was about: a gate whose evidence is not
 * about this code. It is not red - nothing failed - but it is not evidence
 * either, and `need` reports it as missing with the tree it came from so nobody
 * reads it as a re-run they did not do. Two ways in:
 *
 *   - the digest the stage asks for does not match (the classic: passed on an
 *     older tree); or
 *   - the tree moved while the run went on (`treeAfter` != `tree`, N1). Metro
 *     serves the edited JS and jest reads files lazily, so a run that started on
 *     one tree and ended on another proved neither, and a green row for it is a
 *     claim about code it did not entirely see.
 *
 * A line from another tree reads `stale` whether it passed or failed (N2): a red
 * from an older tree printing `**FAIL**` tells a reader the current code fails,
 * which it does not know.
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
  // A v1 line (or a line from a tree with no per-platform half) has no `trees`,
  // so it falls back to the full digest rather than reading as stale forever.
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
 * The latest line *whose digest matches the tree being asked about* wins
 * (N2). A pass on T1 then a fail on T2 then a revert to T1 is green again, which
 * is right: the current code is the code that passed. With no matching line the
 * latest one is returned as `stale` so `status` can still name the tree it came
 * from, and a line whose tree moved mid-run is never decisive - an earlier clean
 * line on this tree is better evidence than an interrupted run.
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
 * The counts a row reports (M3).
 *
 * A gate that prints one summary shows it. A gate that prints several shows its
 * *first* - jest runs before perf in `bun run check`, and 391 unit tests across
 * 23 suites is the number a reviewer uses to notice a deleted or skipped suite,
 * where "7 tests / 7 suites" from the perf step hid it. When anything failed, the
 * row shows the total across steps with the failures first, because "check FAIL"
 * beside a passing-looking count is worse than an approximate total.
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
 * The tree cell: which digest the row was matched on.
 *
 * A green row matched on the full tree prints the bare digest; one matched on its
 * platform's half says so, because the full digest beside it is *not* the current
 * tree and a reader has to be able to tell those apart at a glance.
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
 * The Markdown gate table for a report.
 *
 * It is generated so the report cannot claim a gate the ledger has no line for,
 * and a row whose tree is not the current one says `stale` instead of `PASS` -
 * the review item "report claims to correct" was mostly this, written by hand.
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
      `${formatCounts(countsForDisplay(entry))} | ${formatTreeCell(row)} | ` +
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
 * All three are rounded: `os.loadavg()` returns a float, and an unrounded `start`
 * was writing `"start":13.54443359375` into the committed ledger (N5).
 *
 * @param {{start: number | null, samples: number[]}} options
 * @returns {{start: number | null, median: number | null, max: number | null, count: number}}
 */
export function summarizeLoad({ start = null, samples = [] }) {
  const round = (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value * 100) / 100
      : null;
  const values = samples.filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return { start: round(start), median: null, max: null, count: 0 };
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
  };
}

/**
 * The jest-style summaries a gate printed, from its log, in document order.
 *
 * `bun run check` prints several (jest, then the perf step), and which one a
 * report should quote is a decision, not an accident - see `countsForDisplay`.
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
 * A gate name with any extra arguments encoded into it, so a filtered run can
 * never be recorded as the full gate.
 *
 * `harness:android` plus `ColdSizing` is `harness:android:ColdSizing`, and
 * `real-input:android` plus `--control switch` is
 * `real-input:android:--control:switch`. `encodeURIComponent` per argument,
 * joined with `:`: a name a reader recognises (`ColdSizing`, `--control`) stays
 * readable, and a character that could fake a separator (`:`, a space) cannot,
 * so `x:y` as one argument cannot impersonate two arguments. It is also
 * idempotent - `gate.mjs harness:android:ColdSizing` records the same name - so
 * a recorded name can be pasted straight back as a command.
 *
 * This is M1. Before it, `gate.mjs harness:android -- ColdSizing` recorded
 * `gate: "harness:android"`, and one suite satisfied the platform gate.
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

/**
 * Gate name -> the command to run, where, and the name to record it under.
 *
 * These are the same commands `package.json` runs, spelled out because
 * `bun run <script>` mangles arguments that follow it and a gate name has to
 * survive an append of extra args (a single harness suite). The harness entry is
 * `scripts/harness.mjs` from `example/`, exactly as `bun --cwd example
 * harness:ios` expands to, so the Node guard and the printed command still apply.
 *
 * The returned `gate` is what the ledger records, not `argv[0]`: a run with a
 * filter is a different gate from the full one (M1), and `need` will not accept
 * it in place of one.
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
      // `../scripts/` because the cwd is `example/`, exactly as `bun --cwd
      // example harness:android` expands its own script line. A root-relative
      // path here fails to resolve before the suite starts (found by the first
      // real run of this file, not by a unit test).
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

/* --------------------------- background gates (X9) ------------------------- */

/**
 * The exit code `gate.mjs wait` prints when the gate is *still running* at the
 * timeout.
 *
 * Distinct from 1, which is what the gate's own failure produces: the point of
 * `wait` is that a script or an agent can act on the difference between "the gate
 * said no" and "the gate has not finished yet, keep waiting" without reading a log
 * to find out which. 13 rather than a small number because 1..2 are already taken
 * here by "failed" and "bad arguments".
 */
export const STILL_RUNNING_EXIT = 13;

/**
 * The default `wait` budget: 45 minutes. That is a `check` on a cold machine with
 * room for one harness run, and short enough that a wrong guess costs a coffee
 * rather than an hour - `--timeout-minutes` exists for the long ones.
 */
export const DEFAULT_WAIT_MINUTES = 45;

/**
 * How often `wait` prints a progress line: once a minute, which is what makes an
 * agent's transcript readable instead of a wall of identical lines.
 */
export const WAIT_PROGRESS_INTERVAL_MS = 60_000;

/**
 * Where a backgrounded gate's bookkeeping lives, beside the log it is writing.
 *
 * `<gate>-<started-at>.gate.json` next to `<gate>-<started-at>.log`: the pair
 * belongs together, and `wait` finds both from the ledger rather than by scanning
 * a directory of loose state files that can outlive their meaning.
 *
 * @param {string} logPath the log path already recorded in the ledger line
 */
export function backgroundRecordPath(logPath) {
  return String(logPath).replace(/\.log$/, '.gate.json');
}

/**
 * The last non-empty line of a log, which is what `wait` prints as progress.
 *
 * Trailing blank lines are skipped because a finished gate always ends with some,
 * and "the log's last line" as a progress signal means *what is it doing now* - a
 * blank says nothing. Capped so one assertion diff cannot push a progress line
 * across a terminal.
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
 * Whether a pid is a process that could still be *this* gate.
 *
 * A backgrounded gate killed by anything other than its own exit leaves its record
 * behind with no process to read, and `wait` must say "gone" rather than block for
 * its whole timeout on something that stopped existing. EPERM counts as alive: a
 * pid owned by another user is running, and declaring someone's gate dead because
 * we cannot signal it would report a run that has not finished as finished.
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
 * All four outcomes in one pure function, because the interesting bugs are exactly
 * here: reporting a still-running gate as passed, or treating a record whose
 * process is gone as "still running" and burning the whole timeout on a corpse.
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
    // Killed hard enough never to have written `done` - or, the case that actually
    // happens, a race where the run finished so fast the launcher's "here is my
    // pid" write landed *after* the run's "I am done" write and resurrected the
    // record as running. Either way the **ledger** is the source of truth: if the
    // line is there, the gate finished and its recorded exit code is the answer.
    // Inventing a failure or a pass from the record alone would be wrong in one
    // direction or the other.
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
        // Where it stopped, which is the thing a reader acts on: the log may say
        // "Compiling Switch.swift" or nothing at all.
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
 * Which backgrounded gates are still running, for `status`.
 *
 * A gate started with `--background` returns before it finishes, so without this
 * `status` would say "missing" for a run that is happening right now - the most
 * misleading thing it could say while someone decides whether to start it again.
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
