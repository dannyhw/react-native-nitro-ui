/**
 * The conformance suite's rules, as data — the half that decides, so it can be
 * unit-tested against fixtures instead of against a device.
 *
 * ## Why a suite and not seven tests
 *
 * Four classes of must-fix bug recurred across the component reviews, and every one
 * of them was caught late because the check for it had been written by hand for one
 * control and never for the others (`docs/tasks/PROCESS-review-2026-10-26.md` §1, §4
 * row 3: fix rounds took 44 % of implementer time):
 *
 * - an Android accessibility label on a node other than the one TalkBack focuses
 *   (G5 review M2, G6 review M3);
 * - a dropped view that leaked (`FOLLOWUPS.md`: B1, H1 M1);
 * - a declared sizing fallback that was missing, or equal to the measured size so a
 *   failed correction was invisible (G5, G6);
 * - a recycled view that came back with its previous owner's state.
 *
 * X3 put every control's facts in `src/components/<Name>/component.json`, so the four
 * rules here can be run over *every* control from that one source: a new control
 * (0.4's Menu) is covered the moment it has a manifest, with nobody writing a case.
 *
 * ## Where each rule runs, and why there
 *
 * A rule belongs where its witness is readable, and the two platforms do not offer
 * the same witnesses:
 *
 * - **fallback** and **no-leak-on-drop** are sizing- and engine-visible, so they run
 *   in the on-device harness (`example/__tests__/Conformance.harness.tsx`, gate
 *   `harness:<platform>`) against `nitroUiCore.sizingStats()` / `drainSizingTrace()`.
 * - **recycle reset** is a prop- and drawing-visible thing, same place, using the
 *   same testID across several lifetimes — what a list actually does, and what
 *   `Picker.harness.tsx` calls "the recycle" (Android's real `prepareForRecycle`
 *   needs `enableViewRecycling`, which the example app leaves off; the report records
 *   that).
 * - **a11y name on the focusable node**: iOS runs in the harness too, because
 *   `HarnessUI.queryByAccessibilityLabel` reads `UIView.accessibilityLabel` and
 *   therefore reaches through the SwiftUI host (the box comparison is what makes it
 *   a rule rather than a tautology). **Android cannot run in-app at all** — the
 *   harness matches `View.contentDescription` and Compose semantics are not Views,
 *   the gap `Slider.harness.tsx` documents. So the Android half reads `uiautomator
 *   dump` — the accessibility tree — from the host, inside `real-input:android`
 *   (`scripts/real-input/a11y.mjs`). It is not a new gate, because a gate nobody runs
 *   is not a guardrail.
 *
 * ## `failing`, not fixed
 *
 * The brief is explicit that a control which fails a rule is not fixed here. A rule
 * that would fail is declared in `CONFORMANCE_EXEMPTIONS` / `A11Y_EXEMPTIONS`, with a
 * `docs/tasks/FOLLOWUPS.md` line, and the runner *requires* the exemption to still
 * match something real (see {@link staleExemptions}) — so debt is visible and
 * self-clearing, and cannot quietly become a permanent skip.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_BASENAME,
  manifestsFromEntries,
} from './registry-core.mjs';
import { A11Y_CONTROLS } from './real-input/a11y.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Where the fixture manifests live, for `scripts/__tests__/conformance.test.js`. */
export const FIXTURE_ROOT = join(here, 'conformance', 'fixtures');

/**
 * The four rules, as data.
 *
 * `applies` decides per control whether the rule means anything for it, so "not
 * applicable" is a stated answer with a reason rather than a gap in coverage.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   title: string,
 *   runs: ReadonlyArray<string>,
 *   applies: (
 *     manifest: any,
 *     context: {components: Set<string>, sizing: Record<string, string>}
 *   ) => string | null,
 * }>}
 */
export const CONFORMANCE_RULES = Object.freeze([
  {
    id: 'a11y-name-on-focusable-node',
    title:
      'the control carries its own accessibility name, on the node a person can act on',
    runs: ['harness:ios', 'real-input:android'],
    applies: (manifest, { components }) =>
      components.has(manifest.name)
        ? null
        : `no a11y case for ${manifest.name} in scripts/real-input/a11y.mjs — ` +
          'add one (label + screen) when a control gains a screen to read it from',
  },
  {
    id: 'no-leak-on-drop',
    title:
      'mounting and unmounting N instances returns the sizing engine to baseline',
    runs: ['harness:ios', 'harness:android'],
    applies: (manifest) =>
      manifest.sizing == null
        ? `${manifest.name} is not self-sizing, so it never enters the engine's ` +
          'ledger/registry and there is no per-instance bookkeeping to leak'
        : null,
  },
  {
    id: 'declared-fallback',
    title:
      'a declared fallback is registered before the first measure, and differs from the measured size',
    runs: ['harness:ios', 'harness:android'],
    applies: (manifest) =>
      manifest.sizing == null
        ? `${manifest.name} declares no sizing policy, so it has no fallback to declare`
        : null,
  },
  {
    id: 'recycle-reset',
    title:
      'a control that comes back under the same identity shows none of its previous owner’s props',
    runs: ['harness:ios', 'harness:android'],
    applies: () => null,
  },
]);

/** Rule ids, in the order a report lists them. */
export const RULE_IDS = CONFORMANCE_RULES.map((rule) => rule.id);

/**
 * A rule a control is known to fail, recorded rather than fixed.
 *
 * @typedef {object} ConformanceExemption
 * @property {string} component the manifest `name`
 * @property {string} rule a {@link RULE_IDS} member
 * @property {string} followups the `docs/tasks/FOLLOWUPS.md` line that owns the fix
 * @property {string} detail what goes wrong, for the report
 */

/**
 * The in-app half of the debt list (the Android a11y half is
 * `A11Y_EXEMPTIONS`). Empty today: every in-app rule passes on every control, which
 * is why nothing here is pretending to be a fix.
 *
 * @type {ReadonlyArray<ConformanceExemption>}
 */
export const CONFORMANCE_EXEMPTIONS = Object.freeze([]);

/**
 * Every exemption that is stale, because the component it excuses has no entry
 * among the findings.
 *
 * Same rule as the a11y half: an exemption earns its place by matching something
 * real on every run. `covered` is the set of `component|rule` pairs the run actually
 * exercised — an exemption for a rule the run skipped (a filtered harness run, say)
 * is not evidence that the control got fixed.
 *
 * @param {Iterable<string>} covered `component|rule` pairs the run exercised
 * @param {Iterable<string>} matched `component|rule` pairs that produced a problem
 * @returns {string[]} one line per stale exemption
 */
export function staleExemptions(covered, matched) {
  const coveredSet = new Set(covered);
  const matchedSet = new Set(matched);
  return CONFORMANCE_EXEMPTIONS.filter(
    (exemption) =>
      coveredSet.has(`${exemption.component}|${exemption.rule}`) &&
      !matchedSet.has(`${exemption.component}|${exemption.rule}`)
  ).map(
    (exemption) =>
      `CONFORMANCE_EXEMPTIONS: ${exemption.component} / ${exemption.rule} ` +
      `(${exemption.followups}) matched no finding this run — it passes now, so ` +
      'delete the exemption'
  );
}

/**
 * Split raw findings into failures and known debt.
 *
 * @param {Array<{component: string, rule: string, problem: string}>} findings
 * @returns {{failures: string[], known: string[], matched: string[]}}
 *   `matched` is the set of `component|rule` pairs an exemption covered.
 */
export function classifyFindings(findings) {
  const failures = [];
  const known = [];
  const matched = [];
  for (const finding of findings) {
    const exemption = CONFORMANCE_EXEMPTIONS.find(
      (candidate) =>
        candidate.component === finding.component &&
        candidate.rule === finding.rule
    );
    if (exemption == null) {
      failures.push(
        `${finding.component} × ${finding.rule}: ${finding.problem}`
      );
      continue;
    }
    const key = `${exemption.component}|${exemption.rule}`;
    if (!matched.includes(key)) matched.push(key);
    known.push(
      `known failing (${exemption.followups}): ` +
        `${finding.component} × ${finding.rule}: ${finding.problem}`
    );
  }
  return { failures, known, matched };
}

/**
 * The rule × control matrix, with a reason for every "not applicable".
 *
 * This is what `scripts/task-ready.mjs` calls "conformance coverage", and what the
 * report prints: the suite's answer per control per rule is one of `covered` (the
 * run asserts it), `failing` (it asserts it, and an exemption records the debt) or
 * `not-applicable` with a stated reason. There is no fourth state, which is the
 * point: a new manifest either lands inside a rule or the matrix says why it did not.
 *
 * @param {any[]} manifests validated manifests
 * @param {object} [context]
 * @param {Iterable<string>} [context.a11yControls] ids the a11y table covers
 * @param {Iterable<string>} [context.failing] `component|rule` pairs currently
 *   exempted
 * @returns {Array<{name: string, rules: Record<string,
 *   {state: 'covered'|'failing'|'not-applicable', reason?: string}>}>}
 */
export function coverageMatrix(manifests, context = {}) {
  const controls = new Set(context.a11yControls ?? A11Y_CONTROLS.map((c) => c.id));
  const failing = new Set(context.failing ?? []);
  return manifests.map((manifest) => {
    /** @type {Record<string, {state: string, reason?: string}>} */
    const rules = {};
    for (const rule of CONFORMANCE_RULES) {
      const reason = rule.applies(manifest, { controls });
      if (reason != null) {
        rules[rule.id] = { state: 'not-applicable', reason };
        continue;
      }
      rules[rule.id] = failing.has(`${manifest.name}|${rule.id}`)
        ? { state: 'failing' }
        : { state: 'covered' };
    }
    return { name: manifest.name, rules };
  });
}

/**
 * The a11y table, cross-checked against the manifests and the example screens.
 *
 * The table in `scripts/real-input/a11y.mjs` is hand-written — the labels are JSX
 * literals in the screens, so there is nothing to generate them from. That makes it
 * exactly the kind of table that decays: a screen rename turns the rule into a check
 * for a name nothing draws, and a new component simply is not in it. This function is
 * what turns both of those into a failing test in `check`, on a machine with no
 * device:
 *
 * - every manifest is covered by at least one case;
 * - every case names a real manifest, and its `hybridView` agrees with it;
 * - every label still appears as an `accessibilityLabel` in the screen it names;
 * - every `anchorTestId` still appears in that screen.
 *
 * @param {any[]} manifests
 * @param {(path: string) => string | null} readFile repo-relative
 * @param {ReadonlyArray<{id: string, component: string, hybridView: string, screen: keyof typeof SCREEN_FILE, label: string, labelAttribute?: string, anchorTestId?: string}>} [table]
 * @param {Readonly<Record<string, string>>} [screenFile] tab id → screen file
 * @returns {string[]} problems
 */
export function checkA11yTable(
  manifests,
  readFile,
  table = A11Y_CONTROLS,
  screenFile = SCREEN_FILE
) {
  const problems = [];
  const covered = new Set(table.map((entry) => entry.component));
  for (const manifest of manifests) {
    if (covered.has(manifest.name)) continue;
    problems.push(
      `scripts/real-input/a11y.mjs: no a11y case for ${manifest.name} ` +
        `(${manifest.id}) — a control the rule does not cover is a gap, not a ` +
        'pass, and this is the only place anyone would notice'
    );
  }
  for (const entry of table) {
    const manifest = manifests.find(
      (candidate) => candidate.name === entry.component
    );
    if (manifest == null) {
      problems.push(
        `scripts/real-input/a11y.mjs: the case "${entry.id}" guards ` +
          `"${entry.component}" and no manifest declares that control`
      );
      continue;
    }
    if (entry.hybridView !== manifest.hybridView) {
      problems.push(
        `scripts/real-input/a11y.mjs: the case "${entry.id}" says hybridView ` +
          `"${entry.hybridView}" and the manifest says "${manifest.hybridView}"`
      );
    }
    const screenPath = screenFile[entry.screen];
    if (screenPath == null) {
      problems.push(
        `scripts/real-input/a11y.mjs: the case "${entry.id}" is on screen ` +
          `"${entry.screen}", which SCREEN_FILE does not name a file for`
      );
      continue;
    }
    const screen = readFile(screenPath);
    if (screen == null) {
      problems.push(
        `${screenPath}: not found, and the a11y case "${entry.id}" reads a ` +
          'control from it'
      );
      continue;
    }
    const want =
      entry.labelAttribute != null
        ? entry.labelAttribute
        : `accessibilityLabel="${entry.label}"`;
    if (!screen.includes(want)) {
      problems.push(
        `${screenPath}: no control carries ${want}, so the a11y rule for ` +
          `"${entry.id}" is looking for a name nothing renders`
      );
    }
    if (
      entry.anchorTestId != null &&
      !screen.includes(`testID="${entry.anchorTestId}"`)
    ) {
      problems.push(
        `${screenPath}: no testID "${entry.anchorTestId}", so the a11y rule for ` +
          `"${entry.id}" cannot compare the named node's box with the control's own`
      );
    }
  }
  return problems;
}

/* ------------------------- the declared-fallback table ------------------------ */

/**
 * The size each component declares, per platform.
 *
 * Hand-written, and that is the point: the numbers live inside
 * `HybridNitroUi<Name>.swift` / `.kt` as `fallbackSize` / `FALLBACK_*_DP`, and a
 * generated table read from those sources would compare a constant with itself —
 * the exact failure mode the brief calls out ("a fixture equal to the right answer
 * hides a failed correction"). The harness therefore compares the engine's answer
 * against *this* table, and separately poisons it with a size that belongs to no
 * control at all, so a correction that never arrives is red rather than green.
 *
 * `distinct` is the second half of the rule: for `intrinsic` controls the declared
 * fallback *is* the real size (that is what makes a warm mount cost zero
 * corrections), so the rule cannot be "declared ≠ measured". What it is instead:
 * the declared number must be the component's own, not a neighbour's, and not a
 * placeholder — which is what the poisoned variant proves on device, and what
 * {@link checkFallbackTable} proves statically.
 *
 * @type {Readonly<Record<string, {
 *   android: {width: number, height: number},
 *   ios: {width: number, height: number},
 * }>>}
 */
export const DECLARED_FALLBACKS = Object.freeze({
  NitroUiSwitch: {
    android: { width: 52, height: 48 },
    ios: { width: 61, height: 28 },
  },
  NitroUiSlider: {
    android: { width: 328, height: 48 },
    ios: { width: 351, height: 31 },
  },
  NitroUiButton: {
    android: { width: 91, height: 48 },
    ios: { width: 77, height: 35 },
  },
  NitroUiProgress: {
    android: { width: 320, height: 4 },
    ios: { width: 320, height: 4 },
  },
  NitroUiSegmentedControl: {
    android: { width: 256, height: 48 },
    ios: { width: 165, height: 31 },
  },
  NitroUiDatePicker: {
    android: { width: 131, height: 48 },
    ios: { width: 103, height: 36.33 },
  },
  NitroUiPicker: {
    android: { width: 280, height: 56 },
    ios: { width: 72, height: 35 },
  },
});

/**
 * A size that belongs to no control in the library, per platform.
 *
 * Poisoning with a *neighbour's* size would not do: `guesses_` is keyed by
 * component, so a wrong guess that happens to be a real size is still a wrong guess
 * — but a reader could not tell "the correction arrived" from "another control's
 * size leaked into this one". These are the sizes nothing declares, which is what
 * makes the poisoned assertion say something.
 */
export const POISON_SIZES = Object.freeze({
  android: { width: 111, height: 13 },
  ios: { width: 97, height: 11 },
});

/**
 * The static half of the declared-fallback rule.
 *
 * Three things a manifest/table pair can get wrong without any device noticing:
 * a self-sizing control with no row here (the harness cannot assert a fallback it
 * does not know), a control that declares sizing in its manifest but is missing from
 * `nitro-ui.sizing.json` (which is what makes the generated `registerAll` rows), and
 * a declared size shared verbatim by two controls — the shape of "someone pasted the
 * previous component's number", which the `nitro-ui.sizing.json` policy check cannot
 * see because the policy is right and only the number is stale.
 *
 * @param {any[]} manifests
 * @param {Record<string, string>} sizingTable the parsed `nitro-ui.sizing.json`
 * @returns {string[]} problems
 */
export function checkFallbackTable(manifests, sizingTable) {
  const problems = [];
  const selfSizing = manifests.filter((m) => m.sizing != null);
  for (const manifest of selfSizing) {
    const key = `Hybrid${manifest.hybridView}`;
    if (sizingTable[key] == null) {
      problems.push(
        `nitro-ui.sizing.json: no row for ${key} and its manifest says ` +
          `sizing: ${JSON.stringify(manifest.sizing)} — the two ` +
          'NitroUiDeclaredFallbacks tables come from that row, so the control has ' +
          'no startup declaration'
      );
    }
    if (sizingTable[key] != null && sizingTable[key] !== manifest.sizing) {
      problems.push(
        `nitro-ui.sizing.json: ${key} says ` +
          `${JSON.stringify(sizingTable[key])} and the manifest says ` +
          `${JSON.stringify(manifest.sizing)}`
      );
    }
    if (DECLARED_FALLBACKS[manifest.hybridView] == null) {
      problems.push(
        'scripts/conformance-core.mjs: no DECLARED_FALLBACKS row for ' +
          `${manifest.hybridView}, so the conformance suite cannot name the ` +
          'fallback it expects — add it, from the component’s own source'
      );
    }
  }
  for (const platform of ['android', 'ios']) {
    /** @type {Map<string, string[]>} */
    const bySize = new Map();
    for (const manifest of selfSizing) {
      const entry = DECLARED_FALLBACKS[manifest.hybridView];
      if (entry == null) continue;
      const size = entry[platform];
      const key = `${String(size.width)}x${String(size.height)}`;
      const owners = bySize.get(key) ?? [];
      owners.push(manifest.hybridView);
      bySize.set(key, owners);
    }
    for (const [size, owners] of bySize) {
      if (owners.length > 1) {
        problems.push(
          `scripts/conformance-core.mjs: DECLARED_FALLBACKS has ${size} on ` +
            `${platform} for ${owners.join(' and ')} — a fallback the components ` +
            'share is a copied number, and the suite cannot tell the control it ' +
            'belongs to'
        );
      }
    }
    for (const manifest of selfSizing) {
      const entry = DECLARED_FALLBACKS[manifest.hybridView];
      if (entry == null) continue;
      const { width, height } = entry[platform];
      if (!(width > 0) || !(height > 0)) {
        problems.push(
          `scripts/conformance-core.mjs: DECLARED_FALLBACKS has a non-positive ` +
            `${platform} size for ${manifest.hybridView} — the engine ignores one, ` +
            'so the control is laid out at 0x0 for a frame'
        );
      }
    }
  }
  return problems;
}

/* --------------------------------- fixtures --------------------------------- */

/**
 * One fixture manifest set: every directory under `fixtures/manifests`.
 *
 * @param {string} [root]
 * @returns {any[]}
 */
export function fixtureManifests(root = join(FIXTURE_ROOT, 'manifests')) {
  if (!existsSync(root)) {
    throw new Error(
      `no fixture manifests under ${root} — the conformance rules have nothing to ` +
        'be proved against'
    );
  }
  return manifestsFromEntries(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((directory) => ({
        directory,
        text: readFileSync(join(root, directory, MANIFEST_BASENAME), 'utf8'),
      }))
  );
}

/* --------------------------------- reporting -------------------------------- */

/**
 * The rule × control matrix as Markdown, for the report.
 *
 * @param {ReturnType<typeof coverageMatrix>} matrix
 * @returns {string[]} one line per control per rule
 */
export function formatMatrix(matrix) {
  const lines = [
    '| Control | Rule | Verdict |',
    '| --- | --- | --- |',
  ];
  for (const row of matrix) {
    for (const rule of CONFORMANCE_RULES) {
      const cell = row.rules[rule.id];
      const verdict =
        cell.state === 'not-applicable'
          ? `not applicable — ${cell.reason}`
          : cell.state === 'failing'
            ? `failing — see docs/tasks/FOLLOWUPS.md`
            : 'covered';
      lines.push(`| ${row.name} | \`${rule.id}\` | ${verdict} |`);
    }
  }
  return lines;
}

/**
 * Read a repo-relative file, or null. Kept local so `checkA11yTable` and the
 * `task-ready` script can be handed either a real reader or a fake.
 *
 * @param {string} repoRoot
 * @returns {(path: string) => string | null}
 */
export function readerFor(repoRoot = resolve(process.cwd())) {
  return (path) => {
    const absolute = join(repoRoot, path);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  };
}
