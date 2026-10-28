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
 * The name of the gate **log store** inside a clone's git common directory.
 *
 * Chosen over moving the ledger too: `.gates/<branch>.jsonl` is read by path in
 * reuse and export code, it is small, and it is re-created by the next run in a
 * fresh checkout anyway - whereas the logs are the evidence nothing re-creates.
 * So the brief's "keep `.gates/<branch>.jsonl` where it is" is what this does, and
 * only the logs move (X12 item 1 says to keep it unless moving is simpler).
 */
export const LOG_STORE_BASENAME = 'nitro-ui-gates';

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
 * v3 adds `stepTimings` for `check` (X10): what each of the sixteen steps did, with
 * its own duration. `check` is the one gate long enough that "3 m 04 s" is not an
 * actionable number - the thing a reader wants is which step got slower. It is a
 * record, not a rule: no decision in this file reads `stepTimings`, so a v2 line and
 * a v3 line mean the same thing to `need` and `table`.
 *
 * v5 (X12) changes no rule and adds three things:
 *
 *   - `logPath` is now relative to the clone's **gate log store** (the git common
 *     directory) rather than to the worktree, because a run's evidence must outlive
 *     `git worktree remove`. Old `.gates/logs/...` paths are still read (see
 *     `ledgerLogCandidates`), and a worktree's own `logs/` directory is migrated into
 *     the store on the next run.
 *   - `load.end`: the last sample, so an excerpt can show the load a run started and
 *     finished under. `median`/`max` are what judge a run; `start`/`end` are context.
 *   - `failureLogPath`, written by `export` on a **failed** line only: the committed
 *     excerpt beside `gates.jsonl` that carries the failing test names, the assertion
 *     messages, the tail of the log and the device context.
 *
 * v4 adds `fullTree` and `worktreeClean`, and they are the only fields reuse reads.
 *
 *   - `fullTree` is `git rev-parse HEAD^{tree}`: git's own hash of the *entire*
 *     tracked tree, `docs/` and `bench/` and every `*.md` included. `tree` is a
 *     digest of the build inputs, deliberately blind to those paths so a docs
 *     commit never re-owns a build; that is the wrong blindness for "has this been
 *     checked", which is a question about the files `check` reads. Reuse compares
 *     `fullTree` and nothing else (X10 review round 2, M1-M3), so there is no list
 *     of paths reuse is permitted to be blind to - an exact hash cannot be fooled by
 *     a rename, a new test file, or a path nobody thought to list.
 *   - `worktreeClean` records that the working tree matched that commit when the run
 *     started. Without it a pass would name a tree that never existed: the run saw
 *     the tree *plus* uncommitted edits, and only the commit's hash is written down.
 *     A line with `worktreeClean: false` is kept as evidence for `tree`/`trees`
 *     matching (a build really did get tested) but is never reusable.
 *
 * v1 lines are still read: with no `trees` they compare on the full digest, and
 * with no `treeAfter` they are taken at their word. A line with no `fullTree` -
 * anything written before v4 - cannot be reused, because there is nothing exact to
 * compare: falling back to `tree` would be the old unsound rule under a new name.
 */
export const LEDGER_VERSION = 5;

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
  // X10. The runner and its step graph schedule `bun run <step>` and write only the
  // timing file under `.gates/` (gitignored); they touch no source the app builds.
  'scripts/check.mjs',
  'scripts/check-steps.mjs',
  // Writes `src/components/**`/`example/src/App.tsx` regions when asked to (`--write`),
  // and `registry:check` - the half `check` runs - writes nothing at all. A broken
  // version of either is a wrong *gate*, caught by its own unit test in
  // `scripts/__tests__/registry.test.js`, never a different binary.
  'scripts/gen-registry.mjs',
  'scripts/registry-core.mjs',
  // The build-slot lock in `~/.nitro-ui/builds.json`: it decides *when* a build may
  // start, never what goes into it. `build-app.mjs` (which is mapped, and stays so)
  // fails loudly if this misbehaves, and `scripts/__tests__/build-slot.test.js`
  // proves it in `check`.
  'scripts/build-slot-core.mjs',
  // The template `doctor.mjs --setup` copies to `~/.nitro-ui/devices.json`. A device
  // run reads that copy, never this file, and neither is in the app.
  'scripts/devices.example.json',
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
 * `fullTree` and `worktreeClean` are the pair merge reuse reads, and both are
 * supplied by the caller rather than derived here, because only the caller knows
 * whether it measured them at the moment the gate actually started. Both default to
 * `null`, and reuse demands `worktreeClean === true` rather than "not false", so a
 * caller that did not measure cleanliness writes a line that is honest about
 * everything except reuse.
 *
 * @returns {object} a JSON-ready line
 */
export function ledgerLineFromRun({
  gate,
  command,
  tree,
  trees = null,
  treeAfter = null,
  fullTree = null,
  worktreeClean = null,
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
  logPath = null,
  failureLogPath = null,
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
    fullTree,
    worktreeClean,
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
    logPath,
    // Set by `gate.mjs export`, not by a run: the committed excerpt beside
    // `gates.jsonl` for this failed line. Carried on the line so a red row in the
    // ledger points at its own evidence (X12 item 2).
    failureLogPath,
    exitCode,
    signal,
  };
}

/**
 * The per-step records on a ledger line, or `[]` for a gate that has none.
 *
 * Tolerant by shape rather than by version: a line written before X10 has no
 * `stepTimings`, and a hand-edited or half-written one must not make `table`
 * throw. Anything that is not an object with a `name` is dropped rather than
 * rendered as an empty row, because a blank duration reads like a zero-length step.
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
 * It is a second table rather than extra cells on the first because it belongs to
 * one gate: `check` is the only run long enough to need it, and its row's duration
 * is the sum of this column's interesting parts. `--full` is the switch because
 * the report's gate table is the one a reviewer reads, and sixteen rows under it
 * would bury the five device rows.
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
      // A passing step's detail is nothing. For the rest, the runner's `reason`
      // already spells out the exit code and signal (`exit 2`, `exit null (signal
      // SIGTERM)`, `not started - prepare failed`), so it is shown as-is and the
      // numbers are not repeated beside it; they are the fallback when no reason
      // arrived. Pipes are escaped because a reason is a sentence and a table cell
      // is not a paragraph.
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
 * The exact-tree test merge reuse rests on (X10 review round 2, orchestrator decision).
 *
 * Two git trees are the same tree when their hashes are equal, so the whole rule is one string
 * comparison - and the reason it can be that short is that a git tree hash is computed over
 * *everything tracked*, `docs/` and `bench/` and every `*.md` included. The earlier version of reuse
 * compared `tree`, a digest of the build inputs, and then tried to patch the gap with an allowlist of
 * paths "no step reads". That list was always going to lose: it missed a rename out of `bench/` into
 * `docs/` (git reports only the destination), and it missed a new test file landing under `docs/`
 * where jest will find it. A hash has no such blind spot, because there is nothing it does not see.
 *
 * Both sides are normalised only by trimming: no prefix matching, no case folding, no partial
 * compare. Two hashes that differ in one character are different trees, which is the entire point.
 *
 * @param {string | null | undefined} recorded `fullTree` from a ledger line
 * @param {string | null | undefined} current `fullTree` of the tree being asked about
 * @returns {boolean} true only when both are present and identical
 */
export function fullTreesMatch(recorded, current) {
  const a = typeof recorded === 'string' ? recorded.trim() : '';
  const b = typeof current === 'string' ? current.trim() : '';
  if (a === '' || b === '') return false;
  return a === b;
}

/**
 * A `check` line from another branch's ledger that may stand in for a run on this
 * tree at merge, or `null`.
 *
 * The question `need --for merge` asks after a merge is "has *this tree* been
 * checked?" - and the answer is one string comparison: a ledger line whose `fullTree`
 * equals the merge result's. The merge result's tree is the tree a run on the merged
 * branch would have recorded, so a match is not an analogy, it is the same bytes.
 * Six things have to hold, and all six are checked here rather than assumed:
 *
 *   - the line passed on that exact tree, with its `treeAfter` agreeing - a run whose
 *     tree moved under it proved neither tree (N1);
 *   - it was run with a **clean worktree** (`worktreeClean === true`). A line recorded
 *     over uncommitted edits names a tree that was never checked on its own: the run
 *     saw that tree *plus* those edits, and only the commit's hash is written down.
 *     (M3, in the shape the second review showed it: the earlier "the diff shows no
 *     code files" rescue could not tell a dirty worktree from an unstaged docs commit,
 *     and both excuses were live at once);
 *   - it is the **newest decisive line on that tree** in its own ledger, and the newest
 *     across all of them (M2). A ledger with a pass at 10:00 and a fail at 11:00 on the
 *     same tree is a branch that stopped passing, and reusing its earlier green would
 *     contradict what `gateRowFor` says about the very same lines. So each ledger
 *     contributes its latest pass-or-fail line on the tree, those are compared by
 *     timestamp, and a fail at the top ends the question;
 *   - the caller's own worktree is clean. Asking about a tree that is not committed is
 *     asking about a tree no hash names;
 *   - it names a `head` commit, and the caller can prove that commit is an ancestor of
 *     the tree being asked about, so the evidence is *this* merge's rather than some
 *     branch that happened to share a digest. A line with no `head` cannot be placed;
 *   - it is a `check`, and only a `check`. Device gates are keyed to a binary built on
 *     the branch's own machine and lease, and the brief leaves them to the tree rules
 *     X11 works with.
 *
 * What this deliberately does *not* carry: an allowlist of paths reuse may ignore. An
 * earlier version compared the code-tree digest - blind to `docs/`, `bench/`,
 * `.github/` and `*.md`, three of which `check` does read - and patched the gap with
 * `docs/**` plus an exclusion list, and still got both a rename out of `bench/` into
 * `docs/` and a new jest test under `docs/` wrong, because git reports only a rename's
 * destination and no list can be told about files that do not exist yet. Exact trees
 * have no such blind spot, and the cost is that a docs-only merge re-runs check. That
 * is the 2 m 33 s the review said is worth paying for a rule that cannot be fooled.
 *
 * Where a ledger came from is carried through as `source`: `.gates/<branch>.jsonl` is
 * the machine that ran it, and `docs/tasks/<ID>/gates.jsonl` is that file's committed
 * copy - the only version that exists in the checkout where a merge gets confirmed. The
 * ancestor condition is what makes the copy strong enough for this question.
 *
 * Ties on timestamp are broken toward the fail (N2), then by branch name, so the choice
 * never depends on directory order.
 *
 * @param {object} options
 * @param {Array<{branch: string, entries: object[], source?: string}>} options.ledgers
 *   other branches' ledgers, in any order
 * @param {string | null} options.fullTree git's hash of the whole tree being asked about
 *   (`git rev-parse HEAD^{tree}`), or null when it cannot be read
 * @param {boolean} [options.worktreeClean] whether the caller's own working tree matches
 *   that commit; anything but `true` refuses reuse
 * @param {(commit: string) => boolean} options.headIsAncestor proves `commit` is
 *   in the history of the tree being asked about (git, in `gate.mjs`)
 * @param {string} [options.gate] which gate may be reused
 * @returns {{branch: string, entry: object, source: string} | null}
 */
export function findReusableCheck({
  ledgers = [],
  fullTree,
  worktreeClean = true,
  headIsAncestor,
  gate = 'check',
  diagnostics = null,
}) {
  if (typeof fullTree !== 'string' || fullTree === '') return null;
  if (typeof headIsAncestor !== 'function') return null;
  const note = (text) => {
    if (Array.isArray(diagnostics)) diagnostics.push(text);
  };
  if (worktreeClean !== true) {
    note(
      'this worktree has uncommitted changes, so nothing here is a committed tree an ' +
        'earlier run can have checked - commit or stash them and ask again'
    );
    return null;
  }
  const latestPerLedger = [];
  for (const ledger of ledgers) {
    if (ledger?.branch == null || !Array.isArray(ledger.entries)) continue;
    // One ledger's own answer about this tree, by the rule `gateRowFor` uses: the
    // latest line that is pass or fail on it. A stale line is not decisive.
    let decisive = null;
    for (const entry of ledger.entries) {
      if (entry?.gate !== gate) continue;
      // Exact tree, exact run. A line with no `fullTree` - anything written before
      // ledger v4 - has nothing exact to compare, which is not a reason to guess.
      if (!fullTreesMatch(entry.fullTree, fullTree)) continue;
      if (
        entry.treeAfter != null &&
        entry.tree != null &&
        entry.treeAfter !== entry.tree
      ) {
        continue;
      }
      if (entry.result !== 'pass' && entry.result !== 'fail') continue;
      decisive = entry;
    }
    if (decisive == null) continue;
    latestPerLedger.push({
      branch: ledger.branch,
      entry: decisive,
      source: ledger.source ?? `.gates/${ledger.branch}.jsonl`,
    });
  }
  if (latestPerLedger.length === 0) {
    note(
      `no other ledger has a ${gate} line on tree ${shortTreeHash(fullTree)}`
    );
    return null;
  }
  // Newest wins. On an exact timestamp tie the fail is the decisive line (N2): the
  // result is compared *ascending*, and "fail" sorts before "pass", so contradictory
  // evidence about the same tree resolves against reuse instead of for it.
  const newest = [...latestPerLedger].sort(
    (a, b) =>
      String(b.entry.ts ?? '').localeCompare(String(a.entry.ts ?? '')) ||
      String(a.entry.result).localeCompare(String(b.entry.result)) ||
      a.branch.localeCompare(b.branch)
  )[0];
  if (newest.entry.result !== 'pass') {
    note(
      `${newest.branch}'s newest ${gate} line on this tree (${newest.source}) is a ` +
        `fail at ${String(newest.entry.ts ?? '?')} - reuse would override it, so ` +
        'nothing else is asked'
    );
    return null;
  }
  const candidates = [];
  for (const candidate of latestPerLedger) {
    if (candidate.entry.result !== 'pass') continue;
    if (candidate !== newest) {
      note(
        `${candidate.branch}'s pass is older than ${newest.branch}'s evidence on the ` +
          'same tree, and only the newest line counts'
      );
      continue;
    }
    if (candidate.entry.worktreeClean !== true) {
      note(
        `${candidate.branch} ran ${gate} on this tree with a dirty worktree (` +
          `${String(candidate.entry.ts ?? '?')}), so that pass covers the tree plus ` +
          "unrecorded edits - it doesn't say this tree was checked on its own"
      );
      continue;
    }
    if (
      typeof candidate.entry.head !== 'string' ||
      candidate.entry.head === ''
    ) {
      note(
        `${candidate.branch}: its line names no head commit, so it cannot be placed in this history`
      );
      continue;
    }
    if (!headIsAncestor(candidate.entry.head)) {
      note(
        `${candidate.branch}: its head ${String(candidate.entry.head).slice(0, 7)} is not an ancestor of this tree`
      );
      continue;
    }
    candidates.push(candidate);
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      String(b.entry.ts ?? '').localeCompare(String(a.entry.ts ?? '')) ||
      a.branch.localeCompare(b.branch)
  );
  return candidates[0];
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
 * @param {{branch: string, entry: object} | null} [options.reusedCheck] a `check`
 *   from another branch's ledger that `findReusableCheck` accepted for this tree
 * @param {string[]} [options.reuseRefusals] why `findReusableCheck` declined, for the
 *   notes: a refusal a reader cannot interrogate is indistinguishable from a bug
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
  reusedCheck = null,
  reuseRefusals = [],
}) {
  const requiredGates = requiredGatesFor({ stage, touchedPlatforms });
  const lists = listByGate(entries);
  const scheduled = requiredGates.map((gate) =>
    gateRowFor({ gate, list: lists[gate] ?? [], stage, tree, trees })
  );
  // Merge reuse (X10): `check` may be satisfied by another branch's line for *this
  // exact git tree*, because an equal tree hash means the run would read the same
  // bytes. `applyReusedCheckRow` is where the rule lives, shared with `table` so the
  // two cannot disagree.
  const { rows: required, reused: reusedRow } = applyReusedCheckRow({
    rows: scheduled,
    reusedCheck,
    stage,
    tree,
    trees,
  });

  const missing = required
    .filter((row) => row.state !== 'green')
    .map((row) => row.gate);

  const notes = [];
  if (reusedRow != null) {
    notes.push(
      `check was satisfied by \`${reusedRow.reused.branch}\`'s ledger ` +
        `(${reusedRow.reused.source}): it passed on this exact tree ` +
        `(${shortTreeHash(reusedRow.entry.fullTree)}) with a clean worktree at ` +
        `${String(reusedRow.entry.head ?? 'unknown HEAD').slice(0, 7)}, and that ` +
        'commit is merged into this tree. An equal tree hash means a run here would ' +
        'read the same files, so `check` is not re-owed (see ORCHESTRATOR.md, ' +
        '"The loop" step 5)'
    );
  } else if (stage === 'merge' && reuseRefusals.length > 0) {
    // A refusal with no reason reads like a bug. The M1 rule in particular asks a
    // question with an answer a person can check, so the answer goes on the page.
    // Wording matters here: "not reused" would contain the word the *accepting* note
    // uses, and a test that asserts "did not reuse" by string would match both.
    notes.push(
      `no check line was borrowed for this tree: ${reuseRefusals.join('; ')}`
    );
  }
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

/**
 * Swap a `check` row that has no verdict on this tree for one proved by another
 * branch's ledger.
 *
 * Shared by `decideNeed` and `renderGateTable` so the two can never disagree about
 * what reuse means - a report whose table says `missing` while `need` says satisfied
 * is exactly the kind of contradiction this ledger exists to remove.
 *
 * Only at merge, only for `check`, and only when this branch's own row says nothing
 * about this tree (M2):
 *
 *   - `green` - nothing to do;
 *   - `red` - **never** overridden. This checkout ran `check` on this exact code tree
 *     and it failed. Another branch's older pass on the same digest cannot un-fail
 *     it; that machine, or this one, has an answer that the merge has to see;
 *   - `stale` with `why: 'moved'` - refused for the same reason in the other
 *     direction: the row here is a run whose tree moved under it, which is not a
 *     verdict either, but it *is* the most recent thing this branch knows, and
 *     silently preferring someone else's older green would hide a run nobody looked
 *     at;
 *   - `missing`, or `stale` with `why: 'tree'` - this branch has no evidence about
 *     this code, which is precisely when borrowing one is the honest answer.
 *
 * @param {object} options
 * @param {object[]} options.rows rows from `summarizeGates` / `gateRowFor`
 * @param {{branch: string, entry: object} | null} options.reusedCheck
 * @param {'review'|'merge'} options.stage
 * @param {string | null} options.tree
 * @param {Record<string, string> | null} [options.trees]
 * @returns {{rows: object[], reused: object | null}}
 */
export function applyReusedCheckRow({
  rows,
  reusedCheck = null,
  stage = 'merge',
  tree = null,
  trees = null,
}) {
  if (
    stage !== 'merge' ||
    reusedCheck?.entry == null ||
    reusedCheck?.branch == null
  ) {
    return { rows, reused: null };
  }
  const current = rows.find((row) => row.gate === 'check');
  if (current == null) return { rows, reused: null };
  if (current.state === 'green' || current.state === 'red')
    return { rows, reused: null };
  if (current.state === 'stale' && current.why === 'moved')
    return { rows, reused: null };
  const candidate = gateRowFor({
    gate: 'check',
    list: [reusedCheck.entry],
    stage,
    tree,
    trees,
  });
  if (candidate.state !== 'green') return { rows, reused: null };
  const reused = {
    ...candidate,
    reused: {
      branch: reusedCheck.branch,
      source: reusedCheck.source ?? `.gates/${reusedCheck.branch}.jsonl`,
    },
  };
  return {
    rows: rows.map((row) => (row.gate === 'check' ? reused : row)),
    reused,
  };
}

/**
 * A hash short enough to print. Both the tree digest and a git tree hash are hex, and
 * twelve characters is far past any collision anyone could stumble into by accident.
 *
 * @param {string | null | undefined} hash
 * @returns {string}
 */
export function shortTreeHash(hash) {
  const text = String(hash ?? '').trim();
  return text === '' ? '?' : text.slice(0, 12);
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
 * @param {{branch: string, entry: object} | null} [options.reusedCheck] the same
 *   reuse `need` accepted, so the table and the decision cannot disagree
 * @returns {string}
 */
export function renderGateTable({
  entries,
  tree = null,
  trees = null,
  stage = 'review',
  required = MERGE_GATES,
  evidence = null,
  reusedCheck = null,
}) {
  const rows = applyReusedCheckRow({
    rows: summarizeGates({ entries, tree, trees, stage, required }),
    reusedCheck,
    stage,
    tree,
    trees,
  }).rows;
  const header =
    '| Gate | Result | Counts | Code tree | Duration | Load |' +
    '\n| --- | --- | --- | --- | --- | --- |';
  const body = rows.map((row) => {
    const entry = row.entry;
    const evidenceText =
      evidence != null && entry != null ? ` ${evidence(entry)}` : '';
    // A `check` carried across a merge is still a pass on this code, but a reader
    // has to be able to see it did not run here.
    const label = `${STATE_LABELS[row.state] ?? row.state}${row.reused != null ? ' *(reused)*' : ''}`;
    return (
      `| \`${row.gate}\` | ${label} | ` +
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
 * v5 adds `end` (X12). It is not a fourth judgement - `median` and `max` are what
 * make a row trustworthy - but a failure excerpt wants "this run started under a
 * load of 3 and finished under 40", and that is two of the three numbers a reader
 * of a red harness run asks for. It is the last sample rather than a fresh read so
 * it is the same measurement the median was computed from.
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

/* --------------------------- gate log store (X12) --------------------------- */

/**
 * The directory of one clone's gate logs, beside the git directory the worktrees
 * of this clone share.
 *
 * `git rev-parse --git-common-dir` is the answer to "where does evidence go so
 * that removing a worktree cannot delete it": a linked worktree's own `.git`
 * directory is deleted *with* the checkout, and the common directory is not. That
 * is precisely the X12 bug — Q3 could not read the logs of the failing X3 runs
 * because the X3 worktree was already gone.
 *
 * The store lives under the common directory rather than in `~/.nitro-ui`, so it
 * is scoped to the clone (two checkouts of two forks do not mix logs) and a
 * developer who deletes the clone deletes their own logs with it, which is what
 * they expect.
 *
 * @param {string} commonDir the output of `git rev-parse --git-common-dir`
 * @returns {string}
 */
export function gateLogStoreDir(commonDir) {
  return `${String(commonDir).replace(/\/+$/, '')}/${LOG_STORE_BASENAME}`;
}

/**
 * Where one run's log goes, relative to whatever root the caller prints it from.
 *
 * `<branch>/<gate>-<started-at>.log`: keyed by branch because that is the question
 * a reader asks ("the logs of that X3 run"), and it cannot collide with another
 * branch's run of the same name at the same instant. `ledgerFileName` is reused so
 * the same guard against a branch string that is not a git ref applies here too —
 * a `../` in a branch name would otherwise write outside the store.
 *
 * @param {string} branch
 * @param {string} logName e.g. `harness+android-2026-10-28T12-00-00.000Z.log`
 * @returns {string}
 */
export function logRelativePath(branch, logName) {
  return `${ledgerFileName(branch).replace(/\.jsonl$/, '')}/${String(logName).replace(/^\/+/, '')}`;
}

/**
 * The name of one run's log file.
 *
 * Same shape as before X12 (`<gate>-<iso-time>.log`, `:` folded to `-`) so a log
 * path from an old ledger line looks like a log path, and so a reader who has used
 * this tool for a week recognises the file at a glance.
 *
 * @param {string} gate
 * @param {number} startedAt
 * @returns {string}
 */
export function logNameFor(gate, startedAt) {
  return `${String(gate).replaceAll(/[^\w.-]+/g, '+')}-${new Date(startedAt).toISOString().replaceAll(':', '-')}.log`;
}

/**
 * Where a ledger line's log actually is, oldest-format first.
 *
 * Three shapes have to resolve (the brief's "old relative paths still resolve, or
 * are migrated"):
 *
 *   1. an absolute path — a line whose store was renamed or moved, and a path
 *      `export` or a test wrote deliberately;
 *   2. `.gates/logs/<name>` — everything written before X12. This checkout's own
 *      copy if it is still on disk, then the store's copy under
 *      `.gates/logs/<branch>/` (where the migration put it, keyed by the branch the
 *      line carries — see `migrateWorktreeLogs`), then the flat spelling an earlier
 *      migration used;
 *   3. `<branch>/<name>` — the current format, relative to the store.
 *
 * Resolution order is *worktree first, store second*. A `.gates/logs/` file that
 * still exists was written by the run that wrote the line, in this checkout: it is
 * the original, and the copy in the store is at best the same bytes. Preferring the
 * store would mean the copy silently wins over the original, which is the wrong
 * order for evidence.
 *
 * `logBranch` is what makes a migrated line findable once its worktree is gone. A
 * pre-X12 path carries no branch, and once the worktree is removed there is no
 * checkout left to ask which branch wrote it — so the caller passes the branch from
 * the line or the record that closed the run, and a `task/a/b` name keeps its
 * slashes rather than being guessed at from the path's first segment.
 *
 * @param {object | null | undefined} entry a ledger line
 * @param {{storeDir?: string | null, repoRoot?: string | null, logBranch?: string | null, extraCandidates?: string | string[] | null, existsSync?: (file: string) => boolean}} options
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
    const storeDir = options.storeDir ?? null;
    if (logPath.startsWith(`${LEDGER_DIR}/logs/`)) {
      // Legacy spelling: this checkout's own copy first (it is the original, if it
      // is still there), then the store's copy — keyed by the branch that wrote it,
      // then the flat spelling an older migration used.
      const legacy = logPath.slice(`${LEDGER_DIR}/logs/`.length);
      if (options.repoRoot != null) {
        candidates.push(join(options.repoRoot, logPath));
      }
      if (storeDir != null) {
        const inStore = (worktree) =>
          join(storeDir, `${LEDGER_DIR}/logs/${worktree}${legacy}`);
        const logBranch = options.logBranch ?? null;
        if (logBranch != null && logBranch !== '') {
          candidates.push(inStore(`${String(logBranch).replace(/^\/+/, '')}/`));
        }
        candidates.push(inStore(''));
      }
    } else {
      for (const root of [options.repoRoot ?? null, storeDir]) {
        if (root == null) continue;
        candidates.push(join(root, logPath));
      }
    }
  }
  // Anything the caller wants offered last: a line whose `logPath` was derived by
  // older code may name a file that was never written, and the canonical path for
  // that run is worth one more stat before the export says "no log".
  for (const extra of [options.extraCandidates ?? []].flat()) {
    if (
      typeof extra === 'string' &&
      extra !== '' &&
      !candidates.includes(extra)
    )
      candidates.push(extra);
  }
  const exists = options.existsSync ?? ((file) => file != null && false);
  return {
    candidates,
    file: candidates.find((candidate) => exists(candidate)) ?? null,
  };
}

/**
 * How many days a gate log is kept, and how much of it.
 *
 * The rule, stated because the brief asks for one and because a retention rule
 * nobody can read is a rule that gets bypassed:
 *
 *   - **35 days by mtime** — five working weeks of branches, which is longer than
 *     any task in this repo has lived, and short enough that a machine does not
 *     accumulate a year of harness transcripts;
 *   - **64 MiB total**, oldest-first, and only *after* the age rule — so a machine
 *     that ran 200 gates a day for a week loses the week's tail, not a month's worth
 *     of everything;
 *   - a log whose `startedAt` is inside `protectNewerThan` is never deleted: a run
 *     in progress is writing it, and a `wait` that loses its log mid-run is a worse
 *     bug than an over-full directory.
 *
 * Failure logs get no exemption: an export copies what matters into `docs/tasks/`
 * first, which is the point of item 2.
 */
export const LOG_RETENTION_DAYS = 35;
export const LOG_RETENTION_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Which stored logs a retention sweep deletes.
 *
 * Age and size, in that order, with a floor for "just started writing": a file
 * whose mtime is inside `protectNewerThan` is not a candidate at all, because the
 * run that made it may still be appending to it.
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
  // Size is measured over what survives the age rule: deleting stale files first is
  // what makes the cap a backstop rather than a second way to lose a young log.
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

/* ------------------------ failure excerpts (X12 item 2) --------------------- */

/** How many trailing lines an excerpt carries. The brief's "~150". */
export const EXCERPT_TAIL_LINES = 150;

/** How many failure blocks an excerpt carries before it says "and N more". */
export const EXCERPT_MAX_FAILURES = 20;

/** Cap on the excerpt as a whole, so one pathological log cannot bloat a commit. */
export const EXCERPT_MAX_BYTES = 128 * 1024;

/**
 * Which key names count as credentials. Matched against the whole key, so
 * `sort_key`, `monkey` and `keyframes` are not credentials.
 *
 * `[_-]?auth` is here because `.npmrc` writes `_auth=` (base64 `user:password`) for a
 * registry, and that line is exactly what a failing `npm publish` prints.
 */
const CREDENTIAL_KEY =
  /^(?:[\w.-]*(?:token|secret|password|passwd|passfile|credential|authorization|bearer|cookie|dsn|npm[-_.]?config)[\w.-]*|[\w.-]*(?:api|access|secret|private|auth|session|encryption|signing|deploy)[-_.]?key[\w.-]*|[\w.-]*session[-_.]?(?:id|key|token)[\w.-]*|[_-]?auth|auth[-_.]?(?:token|key|header)|x[-_.]?sc[-_.]?auth|aws[-_.]?access[-_.]?key[-_.]?(?:id|secret))$/i;

/** Values that are credentials by *shape* alone, wherever they appear. */
const CREDENTIAL_SHAPE =
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;

/**
 * Scrubs the secret shapes from a log before it is committed.
 *
 * What is scrubbed, stated because the brief asks what the rule is and because a
 * committed file is a *published* one (D25):
 *
 *   - a PEM private-key block, whole;
 *   - a URL's userinfo (`https://user:***@host/`);
 *   - `Authorization:` / `Proxy-Authorization:` / `Cookie:` / `Set-Cookie:`, whose
 *     **whole** value goes — scheme included. Replacing only the first token would
 *     scrub the word `Bearer` and publish the credential beside a marker that reads
 *     as if it had worked, which is what the first version of this did;
 *   - the value of any assignment whose key looks like a credential —
 *     token/secret/password/passwd/passfile/credential/authorization/bearer/cookie/
 *     dsn/`NPM_CONFIG_*`, or `<something>_key` where the something is api/access/
 *     secret/private/auth/session/encryption/signing/deploy, plus `.npmrc`'s `_auth`
 *     /`_authToken`/`_password`, `auth`, `SESSION_ID` and `X_SC_AUTH` — in any of
 *     `KEY=value`, `"KEY": "value"`, `KEY: value`, `--key value` or `<token>…</token>`;
 *   - a bare credential *shape*: `ghp_…`, `npm_…`, `github_pat_…`, a Slack
 *     `xox…-…`, an AWS access-key id, a JWT.
 *
 * Two deliberate biases. It scrubs by *shape*, not by entropy: guessing at
 * "random-looking strings" would shred stack traces and still miss a short
 * password. And it errs toward scrubbing — `--monkey-key value` loses its value —
 * because the cost of hiding a build flag's argument is a reader's mild confusion,
 * and the cost of missing a token is a rotated credential.
 *
 * **Paths and hostnames are not this function's business, and are still scrubbed** —
 * by `redactLocalPaths`, which `renderFailureExcerpt` applies to everything it writes
 * (review M4, D25). The split is by mechanism, not by policy: a credential's shape is
 * recognisable anywhere, whereas only the caller knows where its own repo, store and
 * home directory are. Together the two mean an excerpt commits no token and no home
 * path; neither alone does.
 *
 * @param {string} text
 * @returns {{text: string, replaced: number}}
 */
export function scrubSecrets(text) {
  let replaced = 0;
  const scrub = (value) => {
    replaced += 1;
    return value;
  };
  let out = String(text ?? '');

  // A PEM block first and wholesale: its body is base64, so the assignment rules
  // would match inside it and leave a plausible-looking fragment behind.
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    () => scrub('[scrubbed: private key]')
  );

  // URL userinfo, including a percent-encoded password.
  out = out.replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@]+:)[^\s@]+(@)/gi,
    (_all, scheme, user, at) => scrub(`${scheme}${user}[scrubbed]${at}`)
  );

  // `Authorization: <scheme> <credential>`, `Cookie: …`, `Set-Cookie: …`.
  //
  // The whole value goes, scheme included. The generic assignment rule below would
  // otherwise replace the first token after the colon - the word `Bearer` - and
  // publish the credential next to a `[scrubbed]` marker that reads as if it worked.
  // A quoted value keeps its quotes so the JSON or YAML around it survives; an
  // unquoted one runs to the end of the line, because that is where a header ends.
  out = out.replace(
    /(^|[^A-Za-z0-9-])((?:[\w.-]*[-_.]?)?authorization|[\w.-]*proxy[-_.]?authorization|[\w.-]*set[-_.]cookie|[\w.-]*cookie)(["']?)(\s*[:=]\s*)\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\n]*))/gi,
    (all, before, key, quoteAfterKey, sep, dq, sq, bareValue) => {
      const quote = dq != null ? '"' : sq != null ? "'" : '';
      let value = dq ?? sq ?? bareValue ?? '';
      // A value that is not quoted but sits *inside* a quoted shell argument
      // (`-H 'Authorization: token abc'`) ends at the closing quote: keep that
      // quote, or the line loses its syntax and a reader cannot tell what ran.
      let trailing = '';
      if (quote === '') {
        const unquoted = /^(.*?)(["'])$/.exec(value);
        if (unquoted != null && unquoted[1].trim() !== '') {
          value = unquoted[1];
          trailing = unquoted[2];
        }
      }
      if (value.trim() === '' || value.trim() === '[scrubbed]') return all;
      return scrub(
        `${before}${key}${quoteAfterKey}${sep}${quote}[scrubbed]${quote}${trailing}`
      );
    }
  );

  // `KEY = value` in shell, JSON, YAML, PHP-array and plain-log spelling. The value
  // is quoted or bare and only the value is replaced, so `--token` in a printed
  // command line still shows which flag was involved.
  const quoted = String.raw`(?:"([^"\n]*)"|'([^'\n]*)')`;
  const bare = String.raw`([^\s"',;&<>|\\]+)`;
  out = out.replace(
    new RegExp(
      String.raw`(\b[\w.-]{3,})(["']?)(\s*[:=]\s*)\s*(?:${quoted}|${bare})`,
      'g'
    ),
    (all, key, quoteAfterKey, sep, dq, sq, bareValue) => {
      if (!CREDENTIAL_KEY.test(key)) return all;
      const value = dq ?? sq ?? bareValue;
      if (value == null || value === '' || value === '[scrubbed]') return all;
      const quote = dq != null ? '"' : sq != null ? "'" : '';
      return scrub(`${key}${quoteAfterKey}${sep}${quote}[scrubbed]${quote}`);
    }
  );

  // `--token value`, `--token=value` (the assignment rule above takes the second
  // form, so this only has to handle the spaced one).
  out = out.replace(
    /(--[\w-]*(?:token|secret|password|passwd|key|auth|cookie|credential)[\w-]*)(\s+)([^\s]{4,})/gi,
    (all, flag, sep, value) =>
      CREDENTIAL_KEY.test(flag.replace(/^-+/, '')) ||
      /(?:token|secret|password|passwd|api[-_]?key|auth)/i.test(flag)
        ? scrub(`${flag}${sep}[scrubbed]`)
        : all
  );

  // `<token>value</token>` / `<auth>value</auth>`: the XML shapes a Maven `settings.xml`
  // or a plist leaves in a build log. (`.npmrc` is INI, not XML — its `_auth=` and
  // `_authToken=` are covered by the assignment rule above.)
  out = out.replace(
    /<([A-Za-z][\w.-]*)>([^<\n]*)<\/\1>/g,
    (all, name, value) =>
      CREDENTIAL_KEY.test(name) && value.trim() !== ''
        ? scrub(`<${name}>[scrubbed]</${name}>`)
        : all
  );

  // Bare shapes.
  out = out.replace(CREDENTIAL_SHAPE, () => scrub('[scrubbed: credential]'));

  return { text: out, replaced };
}

/** The markers `gate.mjs` writes around the device context block it appends. */
export const DEVICE_CONTEXT_START =
  'gate: ---- device context (recorded on failure, X12) ----';
export const DEVICE_CONTEXT_END = 'gate: ---- end device context ----';

/**
 * Splits a log into its run output and the device-context block appended to it.
 *
 * An excerpt wants both, but not mixed: "the last 150 lines" of a log whose last
 * 500 are logcat would show no failure at all. So the block is lifted out, shown as
 * its own section, and the tail is taken from the run's own output.
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

/**
 * The failing test names and assertion messages in a log, in the shapes the gates
 * actually print (jest, and the real-input suites' own `✗`/`FAIL` lines).
 *
 * Capped, because a run where every suite failed has a log whose *whole* content is
 * failures, and the point of an excerpt is to be shorter than the log.
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
export function failureLinesFrom(text, max = EXCERPT_MAX_FAILURES) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  const found = [];
  const push = (line) => {
    const trimmed = line.trim();
    if (trimmed !== '' && !found.includes(trimmed)) found.push(trimmed);
  };
  for (const line of lines) {
    if (found.length >= max) break;
    // The bullets and headers the gates themselves print: jest's `FAIL <file>` and
    // `● Suite › test`, the harness/real-input `✕`/`✗` check lines, and the
    // assertion noise that follows them. A passing test's name only ever appears
    // beside `✓`/`PASS`, so it cannot match here.
    if (/^\s*(FAIL(ED)?|●|✕|✗|not ok)\s+\S/.test(line)) {
      push(line);
      continue;
    }
    if (
      /^\s*(Error|AssertionError|Expected|Received|expect\(|Unable to |Timed out)/i.test(
        line
      )
    ) {
      push(line);
    }
  }
  return found;
}

/**
 * Local paths that must not survive into a committed file, and what replaces them.
 *
 * Why (review M4, D25): this repo is public, and an excerpt is written *into* it. The
 * old header printed `Full log: … (/Users/<name>/…)` in every excerpt, by
 * construction - so the rule "never write home paths into a committed file" was
 * broken by the tool that produced the file, and the only defence was a comment
 * telling the reader to look first. A store or lease path is still useful to that
 * reader as a placeholder: `<store>/task/X3/check-….log` says where to look on the
 * machine that ran it, without saying who that machine belongs to.
 *
 * Longest first, because `/Users/name/repo` sits inside `/Users/name` and the
 * specific one has to win. Anything shorter than three characters is dropped: a home
 * of `/` or a user called `a` would shred every path in a stack trace, which is the
 * opposite of useful evidence.
 *
 * @param {{repoRoot?: string | null, storeDir?: string | null, leaseFile?: string | null, home?: string | null, hostname?: string | null, tmpDir?: string | string[] | null}} [paths]
 * @returns {Array<[string, string]>}
 */
export function localPathRedactions(paths = {}) {
  // The scratch directory is per user and per machine (`/var/folders/<3 hex>/<32
  // base36>/T` on macOS) and jest prints it in every temp fixture path, so it
  // identifies the machine exactly like `$HOME` does. Both spellings are passed:
  // `os.tmpdir()` and its realpath differ on macOS (`/var/...` vs `/private/var/...`)
  // and logs contain the resolved one. A plain `/tmp` is left alone - it names no
  // machine, and redacting it would mangle every unrelated `/tmp/...` in a log.
  const tmpDirs = (
    Array.isArray(paths.tmpDir) ? paths.tmpDir : [paths.tmpDir]
  ).filter(
    (value) => typeof value === 'string' && value.length > '/tmp'.length
  );
  const wanted = [
    [paths.storeDir, '<store>'],
    [paths.repoRoot, '<repo>'],
    [paths.leaseFile, '<lease file>'],
    // `~` is what a human types, so the redaction stays readable.
    [paths.home, '~'],
    [paths.hostname, '<host>'],
    ...tmpDirs.map((value) => [value, '<tmp>']),
  ];
  return wanted
    .filter(
      ([value, replacement]) =>
        typeof value === 'string' &&
        value.length >= 3 &&
        !value.includes('\0') &&
        !value.startsWith('<') &&
        value !== replacement
    )
    .sort((a, b) => b[0].length - a[0].length);
}

/** Applies `localPathRedactions` pairs to a piece of text. */
export function redactLocalPaths(text, redactions) {
  let out = String(text ?? '');
  for (const [needle, replacement] of redactions ?? []) {
    out = out.split(needle).join(replacement);
  }
  return out;
}

/**
 * The failure excerpt `gate.mjs export` commits beside the ledger for one red run.
 *
 * Contents, in the order a reader wants them: what ran and how it ended, the
 * scrubbed device/run context, the failing test names and assertion messages, the
 * last ~150 lines, and the load at the start and end. The full log stays on the
 * machine; this is the part that has to survive the worktree, and the part that is
 * safe to commit.
 *
 * @param {object} options
 * @param {object} options.entry the ledger line (a failed one)
 * @param {string} options.logText the log's text, unscrubbed
 * @param {string} [options.logLocation] where the full log is now, for the header
 * @param {number} [options.tailLines]
 * @param {Array<[string, string]>} [options.redactions] local paths to replace,
 *   from `localPathRedactions`. Applied to the whole excerpt - header, device
 *   block and tail - because a jest stack trace carries the same home path the
 *   header would, and scrubbing only the header would be theatre.
 * @returns {{content: string, scrubbed: number, truncated: boolean}}
 */
export function renderFailureExcerpt({
  entry,
  logText,
  logLocation = null,
  tailLines = EXCERPT_TAIL_LINES,
  redactions = [],
}) {
  const { text: scrubbedText, replaced } = scrubSecrets(logText ?? '');
  // The device block is the *tail* of a failing device run's log, so taking "the
  // last 150 lines" without splitting would spend the whole excerpt on `simctl`
  // output and show none of the failure (X12 item 3 fed straight into item 2).
  const { body, context } = splitDeviceContext(scrubbedText);
  const lines = body.split('\n');
  const tail = lines.slice(-Math.max(0, tailLines));
  const truncated = lines.length > tail.length;
  const load = entry?.load ?? null;
  const header = [
    `# Failure excerpt — ${String(entry?.gate ?? '?')}`,
    '',
    `- Ran: ${String(entry?.ts ?? '?')} on code tree \`${String(entry?.tree ?? '?').slice(0, 12)}\` at HEAD \`${String(entry?.head ?? '?').slice(0, 7)}\` (branch \`${String(entry?.branch ?? '?')}\`)`,
    `- Command: \`${String(entry?.command ?? '?')}\``,
    `- Result: ${String(entry?.result ?? '?')}, exit ${String(entry?.exitCode ?? 'null')}${entry?.signal == null ? '' : ` signal ${String(entry.signal)}`}, ${String(entry?.durationMs ?? '?')} ms`,
    `- Load: start ${formatLoadValue(load?.start)}, end ${formatLoadValue(load?.end)}, median ${formatLoadValue(load?.median)}, max ${formatLoadValue(load?.max)}`,
    `- Device: ${describeDeviceForExcerpt(entry)}`,
    // The line that makes the difference between "we lost the log" (Q3) and
    // "we know where to look": the excerpt is a copy, the store has the original.
    `- Full log: \`${String(entry?.logPath ?? 'not recorded')}\`${logLocation == null ? '' : ` (${String(logLocation)})`}`,
    `- Scrubbed: ${String(replaced)} credential-looking value(s) were replaced, and this checkout's, the store's and your home paths are written as \`<repo>\`/\`<store>\`/\`~\`, before this file was written. Device identifiers appear only when the run recorded its own lease.`,
    '',
    '## Failing tests and assertion messages',
    '',
  ];
  const failures = failureLinesFrom(body);
  const failureSection =
    failures.length === 0
      ? ['_(none matched — the log had no jest/real-input failure lines)_']
      : failures.map((line) => `- \`${escapeMarkdown(line)}\``);
  const contextSection =
    context == null
      ? []
      : [
          '',
          '## Device and run context (captured when the gate failed)',
          '',
          '```',
          ...context.split('\n').filter((line) => line.trim() !== ''),
          '```',
        ];
  const body2 = [
    ...header,
    ...failureSection,
    ...contextSection,
    '',
    `## Last ${String(tail.length)} log line(s)${truncated ? ` (of ${String(lines.length)} — the rest is in the full log above)` : ''}`,
    '',
    '```',
    ...tail,
    '```',
    '',
  ];
  return {
    content: clampToBytes(
      redactLocalPaths(body2.join('\n'), redactions),
      EXCERPT_MAX_BYTES
    ),
    scrubbed: replaced,
    truncated,
  };
}

/**
 * Keeps the excerpt bounded. The header is prose and the tail is the evidence, so
 * when it does not fit this keeps the header, drops from the *front* of the tail,
 * and says so — a reader looking at a truncated excerpt has to be able to tell.
 */
function clampToBytes(text, max = EXCERPT_MAX_BYTES) {
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  const marker = '\n… excerpt truncated: the rest is in the full log …\n';
  const budget = Math.max(0, max - Buffer.byteLength(marker, 'utf8'));
  const bytes = Buffer.from(text, 'utf8');
  // Keep the first 4 KiB (the header and the failure list), then the newest bytes.
  const headBytes = bytes.subarray(0, Math.min(4096, bytes.length));
  const tailBudget = Math.max(0, budget - headBytes.length);
  const tailBytes = bytes.subarray(
    Math.max(headBytes.length, bytes.length - tailBudget)
  );
  return `${headBytes.toString('utf8')}${marker}${tailBytes.toString('utf8')}`;
}

function escapeMarkdown(text) {
  return String(text).replaceAll('`', "'");
}

function formatLoadValue(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : '?';
}

/**
 * The device a failed run had, in the form safe to commit.
 *
 * Identifiers only when the ledger recorded them — the ledger records the lease id
 * and the serial (X1), which are machine-local strings. They are already in the
 * committed `gates.jsonl` lines, so repeating them in the excerpt adds no exposure,
 * but a reader should see that they came from the line rather than from this
 * function inventing them.
 */
function describeDeviceForExcerpt(entry) {
  const parts = [];
  if (entry?.platform != null) parts.push(String(entry.platform));
  if (entry?.device != null) parts.push(`device \`${String(entry.device)}\``);
  if (entry?.lease != null) parts.push(`lease \`${String(entry.lease)}\``);
  return parts.length === 0
    ? 'none recorded (not a device gate)'
    : parts.join(' / ');
}

/**
 * A short id for one ledger line, used as the excerpt's file name.
 *
 * Timestamp + gate + a sequence number, sanitised the same way log names are, so the
 * excerpt for a run is recognisable from `gates.jsonl` without reading either file.
 * Not the log path: slashes in a branch-qualified log path would turn a file name
 * into a directory.
 *
 * The sequence is not decoration. `ts` is second-granular and two failed runs of one
 * gate inside the same second are a thing that happens (a re-run after a typo in a
 * command), so a name made of the timestamp and gate alone would have the second
 * export overwrite the first excerpt while both ledger lines pointed at it.
 *
 * @param {object} entry a failed ledger line
 * @param {number} [sequence] 1-based position of this run among the exported failures
 */
export function failureExcerptName(entry, sequence = 1) {
  const ts = String(entry?.ts ?? 'unknown')
    .replaceAll(':', '-')
    .replace(/\.\d+Z$/, 'Z');
  const gate = String(entry?.gate ?? 'gate').replaceAll(/[^\w.-]+/g, '+');
  const n = Math.max(1, Math.trunc(Number(sequence) || 1));
  return `${ts}--${gate}--${String(n).padStart(2, '0')}.log`;
}

/**
 * Does this ledger line describe a failed run that owes an excerpt?
 *
 * Only `result: 'fail'`, and only a line that actually has a log to excerpt: a
 * corrupt line, or a pass, gets nothing — the brief's "never copies a passing run's
 * log" — and a fail with no log has no evidence to attach, which the export says
 * out loud rather than writing an empty file.
 *
 * `storedLogFailed` is the other half of the question, for a caller that is looking
 * at a *log in the store* rather than a line in a ledger.
 */
export function isFailedRunWithLog(entry) {
  return (
    entry != null &&
    entry.corrupt !== true &&
    entry.result === 'fail' &&
    typeof entry.logPath === 'string' &&
    entry.logPath !== ''
  );
}

/**
 * Did this stored log belong to a run that failed?
 *
 * One place for the answer, because two callers need it and must not disagree: the
 * record that closed the run (`result`, `exitCode`), and, for a run whose record is
 * older than that field or missing altogether, the ledger line, if the caller has one.
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
    if (row.reused != null) {
      return (
        `${row.gate} — green, reused from \`${row.reused.branch}\`'s ledger: it passed ` +
        'on this exact tree with a clean worktree and its commit is merged here, so ' +
        'the merge owes no re-run'
      );
    }
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
 * Which background records belong to *this* checkout, newest first.
 *
 * The store is one directory shared by every worktree of the clone, so "the newest
 * record for `check`" is a question with the wrong subject once two tasks run gates
 * at the same time - which is the normal case here, not an edge one (review M1: a
 * passing run in worktree C reported worktree B's exit 7 and exited 7). Both halves
 * are compared, and for a reason: the branch alone would still let two worktrees on
 * one branch (a `git worktree add --force`, a detached pair) adopt each other's
 * runs, and the directory alone would not tell a re-run of this branch from another
 * task's run of a different one.
 *
 * A record with neither field is from before this scoping existed and matches: the
 * alternative is that `wait` loses a run that is happening right now, which is a
 * worse failure than the one being fixed.
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
