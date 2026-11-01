/**
 * The conformance suite's rules, as data — the half that *decides*, so it can be
 * proved against fixtures instead of against a device.
 *
 * ## Why a suite, and why manifest-driven
 *
 * Four classes of must-fix bug recurred across the component reviews, and each was
 * caught late because the check for it had been hand-written for one control and
 * never carried to the others (`docs/tasks/PROCESS-review-2026-10-26.md` §1, which
 * measures fix rounds at 44 % of implementer time):
 *
 * 1. an accessibility label on a node other than the one a person acts on — G5
 *    review M2, G6 review M3, and the `FOLLOWUPS.md` line "Core a11y check";
 * 2. a dropped view that leaked — `FOLLOWUPS.md` B1, H1 M1;
 * 3. a declared sizing fallback that was missing, or equal to the measured size so a
 *    failed correction could not be seen — G5, G6;
 * 4. a recycled view that came back wearing its previous owner's props.
 *
 * X3 put every control's facts in `src/components/<Name>/component.json`, so these
 * four rules run over *every* control from that one source. A control the suite does
 * not cover is a **failing test**, not a gap: {@link checkCoverage} is what makes 0.4's
 * Menu conform the moment it has a manifest, with nobody writing a case for it.
 *
 * ## Where each rule runs, and why there
 *
 * A rule belongs where its witness is readable, and the two platforms do not offer
 * the same witnesses. `runs` records the answer per rule; the reasoning is repeated in
 * the harness suite's header and in `scripts/real-input/a11y.mjs`.
 *
 * - **declared fallback**, **no-leak-on-drop** and **recycle-reset** are engine- and
 *   prop-visible, so they run in the on-device harness
 *   (`example/__tests__/Conformance.harness.tsx`, gate `harness:<platform>`) against
 *   `nitroUiCore.sizingStats()` and `drainSizingTrace()`.
 * - **a11y name on the focusable node** runs in the harness on iOS, where
 *   `HarnessUI.queryByAccessibilityLabel` reads `UIView.accessibilityLabel` and so
 *   reaches through the SwiftUI host (the box comparison is what makes it a rule
 *   rather than a tautology). On Android it cannot run in-app at all: the harness
 *   matches `View.contentDescription`, and Compose publishes its control's name on a
 *   `SemanticsNode` that is not a `View` — the gap `Slider.harness.tsx` records. So
 *   the Android half reads `uiautomator dump`, the accessibility tree, from the host
 *   **inside the `real-input:android` gate**. Not a new gate: a gate nobody runs is
 *   not a guardrail, and the sweep rides a run that already boots the device, walks
 *   every screen and pays for a dump.
 *
 * ## `failing`, not fixed
 *
 * The brief is explicit that a control which fails a rule is not fixed here. Such a
 * rule is declared in {@link CONFORMANCE_EXEMPTIONS} or `A11Y_EXEMPTIONS` with its
 * `docs/tasks/FOLLOWUPS.md` line, the runner *requires* each row to still match
 * something real ({@link staleExemptions}), and {@link checkCoverage} demands a
 * FOLLOWUPS line for every `failing` cell — so debt stays visible in the report and
 * removes itself with a red test when the control is fixed, rather than by a reviewer
 * noticing.
 *
 * ## Why nothing here is imported by the app
 *
 * `example/__tests__/Conformance.harness.tsx` bundles into the app binary, and no
 * harness suite imports anything from `scripts/` today (`rn-harness.config.mjs` does,
 * on the host). So the numbers the in-app assertions need are mirrored in that file
 * inside one region-marked JSON block, and {@link checkSharedTableMirror} asserts the
 * mirror equals what this module builds — on every `bun run check`, by text, with no
 * device.
 *
 * @file Pure Node module: no device, no app, no `react-native`. Unit-tested in
 *       `scripts/__tests__/conformance.test.js`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  A11Y_CONTROLS,
  A11Y_EXEMPTIONS,
  staleExemptions as staleA11yExemptions,
} from './real-input/a11y.mjs';
import { SCREEN_FILE } from './real-input/screens.mjs';
// Pure (no `node:` imports, no side effects), which is what makes it safe to share
// with a Jest bundle: `scripts/__tests__/component-coverage.test.js` already imports
// both this module and that one.
import { manifestsFromEntries } from './registry-core.mjs';

/**
 * The repo root.
 *
 * Derived from the working directory rather than `import.meta.url`, for the same reason
 * `gate-core.mjs`, `lease-core.mjs` and `app-stamp-core.mjs` all do it that way: those
 * files say so in their headers because `import.meta` makes a module unimportable from a
 * Jest suite, and this one is imported by `scripts/__tests__/conformance.test.js`. Every
 * script and gate in this repo runs from the repo root; a caller that is not can pass its
 * own root to {@link readerFor}.
 *
 * @returns {string}
 */
function defaultRepoRoot() {
  return resolve(process.cwd());
}

/**
 * The repo root, from the working directory. See {@link defaultRepoRoot} for why this is
 * not `import.meta.url`.
 *
 * @returns {string}
 */
export function repoRoot() {
  return defaultRepoRoot();
}

/* ---------------------------------- the rules --------------------------------- */

/**
 * A rule's verdict for one manifest: `null` when it applies, or the reason it does
 * not. Reasons are mandatory because "not applicable" has to be something a reviewer
 * can read, not an empty cell.
 *
 * @typedef {(manifest: any, context: ConformanceContext) => string | null} Applies
 * @typedef {object} ConformanceContext
 * @property {Record<string, string>} sizing the `nitro-ui.sizing.json` rows
 */

/**
 * @typedef {object} ConformanceRule
 * @property {string} id stable — it appears in the report and in exemption rows
 * @property {string} title one line, for the report
 * @property {ReadonlyArray<string>} runs which gates assert it, so a reader can see
 *   which run has to be green before the rule counts as checked
 * @property {Applies} applies
 */

/**
 * Two names for the accessibility rule, because two things need to key on it.
 *
 * {@link A11Y_RULE_ID} is the matrix's cell — every key in {@link failingKeys} and every
 * column in {@link formatMatrix}. {@link A11Y_FINDING_RULE} is what a *finding* carries, and
 * it is short because a finding's `rule` is a category, and the a11y rule is the only one
 * whose findings are produced on the host rather than in-app. Keeping both as constants is
 * what stops the two spellings from drifting apart in an `===` nobody notices.
 */
export const A11Y_RULE_ID = 'a11y-name-on-focusable-node';
export const A11Y_FINDING_RULE = 'a11y';

/** @type {ReadonlyArray<ConformanceRule>} */
export const CONFORMANCE_RULES = Object.freeze([
  {
    id: A11Y_RULE_ID,
    title: 'named on the node a person can act on, and only there',
    runs: ['real-input:ios', 'real-input:android'],
    // Applies to every control, with no reason attached — and it used to carry one, which
    // was the bug. The reason read "a11y.mjs has no case for this control", and it was
    // unreachable: `checkA11yTable` already fails the run when a manifest has no case, so
    // the matrix could never reach a cell that wanted to explain an omission. A branch
    // that cannot fire is not a guard, it is a guess about the future that reads as
    // evidence — the missing case is a red test in `component-coverage.test.js`, which is
    // where the omission is actually caught.
    applies: () => null,
  },
  {
    id: 'declared-fallback',
    title:
      'a declared fallback exists before the first measure, and is its own',
    runs: ['harness:ios', 'harness:android'],
    applies: (manifest) =>
      manifest.sizing == null
        ? `${manifest.name} declares no sizing policy, so it has no fallback to ` +
          'declare and never enters the engine to guess one'
        : null,
  },
  {
    id: 'no-leak-on-drop',
    title: 'mounting and dropping N instances returns the engine to baseline',
    runs: ['harness:ios', 'harness:android'],
    applies: (manifest) =>
      manifest.sizing == null
        ? `${manifest.name} is not self-sizing, so it never enters the engine's ` +
          'ledger or registry and there is no per-instance bookkeeping to leak'
        : null,
  },
  {
    id: 'recycle-reset',
    title:
      'a control that comes back under one identity shows no previous owner',
    runs: ['harness:ios', 'harness:android'],
    // Applies to every control, except one whose own fixture says it has no state for a
    // reset to clear (X4 re-review, medium "the matrix says covered"). `covered` on that
    // cell is a claim about a check that does not exist, so the reason has to be the
    // fixture's own words, read from the file the suite runs — not a second list here that
    // can disagree with it. A `blindSpot` is *not* an exemption: see
    // {@link CONFORMANCE_EXEMPTIONS}.
    applies: (manifest, context) => {
      const note = (context.recycleNotes ?? {})[manifest.name];
      return note?.kind === 'noProbe' ? note.reason : null;
    },
  },
]);

/** Rule ids, in report order. */
export const RULE_IDS = CONFORMANCE_RULES.map((rule) => rule.id);

/* -------------------------------- exemptions --------------------------------- */

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
 * The in-app half of the debt list; the Android a11y half is `A11Y_EXEMPTIONS`.
 *
 * One row, and its history is the part to read. Both entries here were written by X4 as
 * `recycle-reset` holes for a control whose `fixture probe` is a `blindSpot`: the control
 * **does** hold state a recycle has to clear, and no platform can be shown the difference.
 * Those two facts together are a failing cell, not an unapplicable one — the rule's subject
 * exists and the suite cannot reach it, which is the definition of a hole. A control with no
 * such state (`Button`, `Progress`) is `not-applicable` instead, and the difference between
 * the two is exactly what `probe: { blindSpot }` versus `probe: { noProbe }` records in
 * `Conformance.harness.tsx`.
 *
 * **SegmentedControl's row is gone (F6)**, and the way it retired is the mechanism working:
 * the fixture gained a read-out that can see the residue (`nuiTestDisplayedIndex`, written in
 * the composable/SwiftUI body rather than in a prop setter), so the fixture's note became a
 * real probe and `checkRecycleNotes` would refuse this row as an exemption for a control that
 * now has a failing-producible check. Keeping it would have gone red, not quietly excused the
 * finding the probe can produce.
 *
 * **Menu stays**, with its reason corrected: what X4 recorded ("Android reads `expanded` and
 * never recycles") turned out not to hold on RN 0.88 once `enableViewRecycling` was on, so the
 * blind half is now iOS alone — no gesture reaches a SwiftUI `Menu` (D29) *and* the read-out
 * answers `-1` there. Android's side of that reset line is guarded in
 * `MenuModelTest.aRecycleClosesThePopupWithoutReportingToItsPreviousOwner`, which is why the
 * cell is still honest debt rather than a cover for an untested line.
 *
 * @type {ReadonlyArray<ConformanceExemption>}
 */
export const CONFORMANCE_EXEMPTIONS = Object.freeze([
  {
    component: 'Menu',
    rule: 'recycle-reset',
    followups:
      'X4 recycle rule: Menu holds residue no read-out can show, so the rule ' +
      'cannot fail for it',
    detail:
      'a Menu’s open popup is native-owned state (D29). Since F6 the blind half is ' +
      'iOS alone: no harness gesture reaches a SwiftUI `Menu`, and ' +
      '`nuiTestMenuReport()` answers `-1` for `expanded` there. Android reads the ' +
      'flag and recycles, and its reset line is guarded by `MenuModelTest`.',
  },
]);

/**
 * The key both halves of the debt ledger share.
 *
 * @param {string} component
 * @param {string} rule
 * @returns {string}
 */
export function findingKey(component, rule) {
  return `${component}|${rule}`;
}

/**
 * Split raw findings into failures and known debt.
 *
 * A finding is `{component, rule, problem}`; `rule: 'a11y'` is exempted through the a11y
 * table, which matches on the *problem text* rather than on the control, so a second and
 * different a11y failure on an already-exempt control still goes red.
 *
 * A finding may instead carry `skipped` and no `problem`: one comparison a *premise* of the
 * run makes meaningless ({@link localePremiseMiss}). That is neither a failure nor debt, and it
 * is kept apart from both so it is printed as its own line rather than counted green — a
 * skipped check has to stay visible in the log or the next reader cannot tell a green run from
 * a run that quietly compared nothing.
 *
 * @param {Array<{component: string, rule: string, problem?: string | null, skipped?: string, controlId?: string}>} findings
 * @param {object} [tables] the debt lists to consult. Production leaves this empty and
 *   reads the two real lists; a test passes rows, because both are frozen arrays and
 *   freezing them is the point.
 * @param {ReadonlyArray<any>} [tables.a11y]
 * @param {ReadonlyArray<ConformanceExemption>} [tables.conformance]
 * @returns {{failures: string[], known: string[], skipped: string[], matched: string[]}} `matched` is the
 *   `component|rule` keys an exemption covered, which is what {@link staleExemptions}
 *   clears the lists against.
 */
export function classifyFindings(findings, tables = {}) {
  const a11yExemptions = tables.a11y ?? A11Y_EXEMPTIONS;
  const exemptions = tables.conformance ?? CONFORMANCE_EXEMPTIONS;
  const failures = [];
  const known = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const matched = [];

  for (const finding of findings) {
    if (finding.skipped != null) {
      skipped.push(
        `skipped (${finding.component} × ${finding.rule}): ${finding.skipped}`
      );
      continue;
    }
    const key = findingKey(finding.component, finding.rule);
    const exemption =
      exemptions.find(
        (candidate) => findingKey(candidate.component, candidate.rule) === key
      ) ??
      (finding.rule === A11Y_FINDING_RULE
        ? a11yExemptions.find(
            (candidate) =>
              candidate.control === finding.controlId &&
              candidate.matches.test(finding.problem)
          )
        : undefined);

    if (exemption == null) {
      failures.push(
        `${finding.component} × ${finding.rule}: ${finding.problem}`
      );
      continue;
    }
    if (!matched.includes(key)) matched.push(key);
    known.push(
      `known failing (${exemption.followups}): ` +
        `${finding.component} × ${finding.rule}: ${finding.problem}`
    );
  }
  return { failures, known, skipped, matched };
}

/**
 * Exemptions that no longer describe anything, because the run covered their control
 * and produced nothing for it.
 *
 * A row earns its place by matching something real on every run. This is what stops
 * either list decaying into a permanent skip list, and it is the reason a `failing`
 * rule can be reported without also being allowed to stay broken.
 *
 * @param {Iterable<string>} coveredKeys `component|rule` keys the run exercised
 * @param {Iterable<string>} matchedKeys keys that produced a finding an exemption covered
 * @param {ReadonlyArray<{component: string, rule: string, followups: string}>} [rows]
 * @returns {string[]} one line per stale exemption
 */
export function staleExemptions(
  coveredKeys,
  matchedKeys,
  rows = CONFORMANCE_EXEMPTIONS
) {
  const covered = new Set(coveredKeys);
  const matched = new Set(matchedKeys);
  return rows
    .filter(
      (row) =>
        covered.has(findingKey(row.component, row.rule)) &&
        !matched.has(findingKey(row.component, row.rule))
    )
    .map(
      (row) =>
        `exemption for ${row.component} × ${row.rule} (${row.followups}) matched ` +
        'no finding this run — the control passes the rule now, so delete the ' +
        'exemption and let the rule guard it'
    );
}

/**
 * Every stale row, from both lists, in one call.
 *
 * The two lists are keyed differently on purpose — the a11y one on a *case* id, because
 * its rows match findings and one component has two cases (its own screen and inside a
 * `<Host>`), the in-app one on `component|rule` — so each has its own sweeper and this is
 * the single place a caller goes to ask the question. It is deliberately not a merge into
 * one key space: mapping a11y rows onto components would report the same piece of debt
 * twice whenever a component has two cases, and a run that prints one bug as two teaches
 * people to skim the failures.
 *
 * @param {object} run
 * @param {Iterable<string>} run.a11yCovered the `A11yControl.id`s the run read
 * @param {Iterable<string>} run.a11yMatched the ids whose problems matched a row
 * @param {'android'|'ios'} [run.a11yPlatform] which platform's a11y rows this run read.
 *   Each half has its own debt for some controls — the Slider's Android name is on a node
 *   nothing can act on, its iOS name is announced as the wrong kind of control — so an
 *   Android run must not report the iOS rows as stale, or clearing one bug reads as
 *   clearing both.
 * @param {Iterable<string>} run.coveredKeys `component|rule` keys the run exercised
 * @param {Iterable<string>} run.matchedKeys keys that matched an in-app row
 * @param {ReadonlyArray<any>} [run.conformanceRows] the in-app rows to sweep (default:
 *   the real list). An argument because that list is frozen — deliberately, so nothing can
 *   add debt at runtime — and a test of the sweeper cannot push to a frozen array. The
 *   a11y half needs no such argument: its real list is not empty, so it is sweepable as
 *   it stands.
 * @returns {string[]}
 */
export function staleDebt(run) {
  return [
    ...staleA11yExemptions(
      run.a11yCovered,
      run.a11yMatched,
      run.a11yPlatform ?? 'android'
    ),
    ...staleExemptions(
      run.coveredKeys,
      run.matchedKeys,
      run.conformanceRows ?? CONFORMANCE_EXEMPTIONS
    ),
  ];
}

/* ------------------------------ the a11y table -------------------------------- */

/**
 * The a11y table, cross-checked against the manifests and the example screens.
 *
 * The table is hand-written — the labels are JSX literals in the screens, so there is
 * nothing to generate them from — and a hand-written table is exactly the thing that
 * decays: a screen rename turns the rule into a search for a name nothing draws, and a
 * new component simply is not in it. Both become a failing test in `check`, on a
 * machine with no device:
 *
 * - every manifest is covered by at least one case;
 * - every case names a real manifest and agrees with it on `hybridView`;
 * - every label still appears in the screen the case reads, as the JSX the case says;
 * - every `anchorTestId` still appears in that screen.
 *
 * @param {any[]} manifests
 * @param {(path: string) => string | null} readFile repo-relative
 * @param {ReadonlyArray<any>} [table]
 * @param {Readonly<Record<string, string>>} [screenFile]
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
        `(${manifest.id}) — a control the rule never reads is a gap, not a pass, ` +
        'and this is the only place anyone would notice'
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
          `"${entry.screen}", which SCREEN_FILE names no file for`
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
        `${screenPath}: nothing carries ${want}, so the a11y rule for ` +
          `"${entry.id}" is looking for a name no screen renders`
      );
    }
    if (
      entry.anchorTestId != null &&
      !screen.includes(
        entry.anchorTestIdAttribute != null
          ? entry.anchorTestIdAttribute
          : `testID="${entry.anchorTestId}"`
      )
    ) {
      problems.push(
        `${screenPath}: no testID "${entry.anchorTestId}", so the a11y rule for ` +
          `"${entry.id}" cannot compare the named node's box with the control's own`
      );
    }
  }
  return problems;
}

/* ------------------------------ the fallback table ---------------------------- */

/**
 * The size each component declares as its fallback, per platform.
 *
 * Hand-written, deliberately. The numbers live in the components themselves
 * (`fallbackSize` in Swift, `FALLBACK_*_DP` in Kotlin), and a table *generated* from
 * those sources would compare a constant with itself — precisely what the brief rules
 * out ("test fixtures must not coincide with the right answer"). So the harness
 * compares the engine's answer against *this* table, and separately poisons the engine
 * with {@link POISON_SIZES} — a size no control declares — so a correction that never
 * arrives is red rather than accidentally green.
 *
 * The other half of the rule needs the distinction spelled out: for an `intrinsic`
 * control the declared fallback *is* its real size — that is what makes a warm mount
 * cost zero corrections — so the rule cannot be "declared ≠ measured". It is: the
 * declared number is the control's own and nobody else's ({@link checkFallbackTable}
 * forbids a shared row, which is the shape of a paste), and the poisoned variant
 * proves the engine still corrects a wrong one. Both are asserted; neither is the
 * other.
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
  // Read off the component's own source, which is the only place the number is decided:
  // `HybridNitroUiMenu.swift:458` (`fallbackSize`) and `HybridNitroUiMenu.kt:844-845`
  // (`FALLBACK_WIDTH_DP`/`FALLBACK_HEIGHT_DP`). Button-sized on iOS, and a Material 3
  // trigger's box on Android. Menu is a `CONTENT_SIZED_BOX` control, so the suite never
  // asks a measured Menu to equal these — see `boxRuleFor`.
  NitroUiMenu: {
    android: { width: 118, height: 52 },
    ios: { width: 74, height: 38 },
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
  // The one row whose iOS width belongs to a *locale* as well as a control: it is
  // `NitroUiDatePickerField`'s widest `.medium` date, i.e. a formatter's output, so
  // it is the right answer only in the locale it was measured in —
  // `measuredUnderLocale` says which that is, `example/rn-harness.config.mjs` pins
  // the iOS launch locale to it, and a run whose app reports another locale FAILS
  // rather than skipping (`localePremiseMiss`; the opt-out is explicit and loud).
  //
  // The Android row names no locale, and that is a claim rather than an oversight:
  // nothing pins the emulator's locale (its locale is an AVD/boot setting, not a
  // launch argument this repo passes), so a `measuredUnderLocale` there would be a
  // premise no run checks and a comparison that could skip on every machine without
  // a red test. It measured 131 wide both times it was measured, on a `UTC`
  // emulator and a Lisbon one. If Android ever pins a locale, name it here and
  // `checkLaunchPinAgreesWithTable` will hold the two together.
  NitroUiDatePicker: {
    android: { width: 131, height: 48 },
    ios: { width: 107, height: 36.33, measuredUnderLocale: 'en-US' },
  },
  NitroUiPicker: {
    android: { width: 280, height: 56 },
    ios: { width: 72, height: 35 },
  },
});

/**
 * Which of a control's own axes the declared number is supposed to describe.
 *
 * The first version of this rule asked every control for `measured ≈ declared` and the
 * device run went red on three of seven, correctly:
 *
 * - a `fillWidth` control's width is its **parent's**. Slider measured 420 wide on a 420 dp
 *   screen and declares 328, and both statements are true: the declaration is what the
 *   first frame is laid out at, before the parent is known. Its **height** is its own, so
 *   that half is still asserted and a stale `FALLBACK_HEIGHT_DP` goes red.
 * - `NitroUiButton` is `intrinsic` but *content-sized*: `docs/components/button.md`
 *   measures 33.3 to 103.2 wide across titles and variants, and its row in
 *   {@link DECLARED_FALLBACKS} is documented as the middle of that table, not a measured
 *   configuration. Asserting the box against it would be asserting a guess.
 *
 * A control in {@link CONTENT_SIZED_BOX} is therefore not compared with its declaration at
 * all — and {@link fallbackFindings} then requires its box to *differ* from the
 * declaration, so an exemption that stops being true goes red instead of quietly weakening
 * the rule. Same self-clearing trick {@link staleExemptions} uses on the a11y debt.
 *
 * The return value also decides which axes a poisoned fallback has to move: the control's
 * own ones. For `fillWidth` the width would come back from the parent whether or not the
 * correction ran, so counting it as evidence would make the poisoned assertion green on the
 * bug.
 *
 * @param {string} hybridView
 * @param {Record<string, string>} sizingTable the generated `nitro-ui.sizing.json`
 * @returns {'both' | 'height' | 'none'}
 */
export function boxRuleFor(hybridView, sizingTable) {
  if (CONTENT_SIZED_BOX.includes(hybridView)) return 'none';
  const policy = sizingTable[`Hybrid${hybridView}`];
  return policy === 'fillWidth' ? 'height' : 'both';
}

/**
 * Controls whose box is their content's, so no measured configuration matches their
 * declaration.
 *
 * Membership has to be *earned*: {@link checkFallbackTable} refuses a name that is not a
 * control or that is not `intrinsic`, and {@link fallbackFindings} refuses a member whose
 * box turns out to equal its declaration after all. Adding a name here to get one run
 * green therefore buys exactly one run — the next says the exemption earns nothing.
 */
export const CONTENT_SIZED_BOX = Object.freeze([
  'NitroUiButton',
  // Menu's trigger is a Button's box (`docs/components/menu.md`): the fallback is
  // Button-sized on iOS by decree (`HybridNitroUiMenu.swift:451-458` says so in as many
  // words, and picks 74×38 against Button's 77×35), and the trigger's width is its
  // title's, so no measured configuration of a Menu is any single number. `intrinsic`, so
  // `checkContentSizedBox` accepts the claim, and the suite still refuses a fixture that
  // happens to measure exactly the declaration.
  'NitroUiMenu',
]);

/**
 * The one entry that is a real exception rather than a number, recorded so the report
 * can say it out loud.
 *
 * `NitroUiSwitch.swift` declares 51×31 under `#if compiler(<6.2)` and 61×28 for the
 * SDKs that ship. The table records what a current toolchain compiles.
 *
 * What that leaves unguarded, said plainly (X4 review N5): **the harness never learns the
 * engine's number.** The only JS seam is `prewarmSizing`, which answers how many names have
 * a fallback (`HybridNitroUiCore.cpp:84`) — a count, not a size — so an older-compiler build
 * registers 51×31, the table says 61×28, and the *only* thing that can notice is the warm
 * comparison of the measured box against the table's number, which then reports a control
 * whose declaration looks stale. That is a real red, but it is filed as a declaration drift
 * rather than as "you built with Swift <6.2", and a reader who does not know this row exists
 * would chase the component. So this entry is documentation of a known false-red shape, not
 * a check — it is not read by the suite at all, and the string should not be quoted in a
 * failure message as though it were.
 */
export const DECLARED_FALLBACK_EXCEPTIONS = Object.freeze([
  'NitroUiSwitch ios: 51x31 under Swift <6.2 (UINavigationBar API changed)',
]);

/**
 * A size that belongs to no control in the library, per platform.
 *
 * Poisoning with a *neighbour's* size would not do: `guesses_` is per component, so a
 * wrong guess that happens to be a real size is still wrong — but a reader could not
 * tell "the correction arrived" from "another control's number leaked in". Nothing
 * declares these, which is what makes the poisoned assertion say something.
 *
 * @type {Readonly<Record<'ios'|'android', {width: number, height: number}>>}
 */
export const POISON_SIZES = Object.freeze({
  android: { width: 111, height: 13 },
  ios: { width: 97, height: 11 },
});

/** Points: both dumps come from the same device, so anything at whole-pixel scale is
 *  a real difference and anything under it is the dump rounding a fractional layout. */
export const SIZE_TOLERANCE_DP = 0.6;

/**
 * The generated sizing policy table, as the suite reads it.
 *
 * `checkFallbackTable` is handed one by its callers; the shared table and the in-app
 * mirror need the same file and would otherwise each write their own `JSON.parse` of a
 * path, which is how a path stops existing and three call sites go red.
 *
 * @param {(path: string) => string | null} [read]
 * @returns {Record<string, string>}
 */
export function repoSizingTable(read = readerFor()) {
  const text = read('nitro-ui.sizing.json');
  if (text == null) {
    throw new Error(
      'nitro-ui.sizing.json: not found. It is generated by `bun run registry`, and ' +
        'the conformance rules read the sizing policy out of it rather than assuming one'
    );
  }
  return JSON.parse(text);
}

/**
 * Everything the in-app suite needs, as one JSON document.
 *
 * `boxRules` is in here rather than worked out on the device because the sizing policy is
 * a host-side fact: a control whose width is its parent's must not be asked to match its
 * declaration on that axis, and the suite that asserts must not get to decide that itself.
 *
 * @param {Record<string, string>} [sizingTable]
 * @returns {{
 *   declaredFallbacks: Record<string, {android: {width: number, height: number}, ios: {width: number, height: number}}>,
 *   poisonSizes: Record<string, {width: number, height: number}>,
 *   tolerance: number,
 *   boxRules: Record<string, 'both' | 'height' | 'none'>,
 *   exemptions: Array<{component: string, rule: string, followups: string, detail: string}>
 * }}
 */
export function sharedInAppTable(sizingTable = repoSizingTable()) {
  return {
    declaredFallbacks: structuredClone(DECLARED_FALLBACKS),
    poisonSizes: structuredClone(POISON_SIZES),
    tolerance: SIZE_TOLERANCE_DP,
    boxRules: Object.fromEntries(
      Object.keys(DECLARED_FALLBACKS).map((hybridView) => [
        hybridView,
        boxRuleFor(hybridView, sizingTable),
      ])
    ),
    exemptions: structuredClone(CONFORMANCE_EXEMPTIONS),
  };
}

/**
 * The region markers {@link checkSharedTableMirror} looks for.
 *
 * Kept as one string pair rather than prose so the harness file and this check cannot
 * drift apart on a rename.
 */
export const SHARED_TABLE_BEGIN = 'BEGIN CONFORMANCE SHARED TABLE';
export const SHARED_TABLE_END = 'END CONFORMANCE SHARED TABLE';

/**
 * Assert the in-app mirror of {@link sharedInAppTable} is that table, byte for byte.
 *
 * This is what lets the harness suite use the same numbers without importing a
 * script: the mirror is *checked text*, not a convention. Without it the in-app suite
 * would assert against its own copy of the answer — a tautology with a `describe()`
 * around it.
 *
 * @param {string} harnessText the text of `example/__tests__/Conformance.harness.tsx`
 * @returns {string[]} problems
 */
export function checkSharedTableMirror(harnessText) {
  const begin = harnessText.indexOf(SHARED_TABLE_BEGIN);
  if (begin < 0) {
    return [
      `example/__tests__/Conformance.harness.tsx: no "${SHARED_TABLE_BEGIN}" ` +
        'region, so the numbers it asserts against are its own and nothing connects ' +
        'them to the tables in this file',
    ];
  }
  const end = harnessText.indexOf(SHARED_TABLE_END, begin);
  const body = harnessText.slice(begin, end < 0 ? harnessText.length : end);
  const json = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return [
      `example/__tests__/Conformance.harness.tsx: the ${SHARED_TABLE_BEGIN} ` +
        `region is not JSON (${String(error)}) — the mirror is unreadable, so it ` +
        'is not a mirror',
    ];
  }
  const want = JSON.stringify(sharedInAppTable(), null, 2);
  const have = JSON.stringify(parsed, null, 2);
  if (want !== have) {
    return [
      `example/__tests__/Conformance.harness.tsx: the ${SHARED_TABLE_BEGIN} ` +
        'region no longer matches scripts/conformance-core.mjs. Regenerate it from ' +
        '`sharedInAppTable()` — the in-app assertions are only as honest as this table',
    ];
  }
  return [];
}

/* ------------------------------ static table checks -------------------------- */

/**
 * The static half of the declared-fallback rule: what the tables can get wrong with
 * no device anywhere near it.
 *
 * @param {any[]} manifests
 * @param {Record<string, string>} sizingTable the parsed `nitro-ui.sizing.json`
 * @param {Readonly<Record<string, any>>} [declared]
 * @returns {string[]} problems
 */
export function checkFallbackTable(
  manifests,
  sizingTable,
  declared = DECLARED_FALLBACKS
) {
  const problems = [];
  const selfSizing = manifests.filter((manifest) => manifest.sizing != null);

  for (const manifest of selfSizing) {
    const key = `Hybrid${manifest.hybridView}`;
    const policy = sizingTable[key];
    if (policy == null) {
      problems.push(
        `nitro-ui.sizing.json: no row for ${key}, and its manifest says ` +
          `sizing: ${JSON.stringify(manifest.sizing)} — both generated ` +
          'DeclaredFallbacks tables come from that row, so the control reaches the `0x0` ' +
          'branch of `sizeFor` and is force-laid-out with no declaration at all'
      );
    } else if (policy !== manifest.sizing) {
      problems.push(
        `nitro-ui.sizing.json: ${key} says ${JSON.stringify(policy)} and the ` +
          `manifest says ${JSON.stringify(manifest.sizing)} — the policy is ` +
          'generated from the manifest, so that file is stale or hand-edited'
      );
    }
    if (declared[manifest.hybridView] == null) {
      problems.push(
        'scripts/conformance-core.mjs: no DECLARED_FALLBACKS row for ' +
          `${manifest.hybridView}, so the suite cannot name the fallback it ` +
          'expects. Add it from the component’s own source — never from here'
      );
    }
  }

  // Membership of the one exemption the suite offers, checked on the way through: a name
  // added to `CONTENT_SIZED_BOX` to get a run green must at least describe a control that
  // could be content-sized, and `fallbackFindings` does the rest by refusing a member whose
  // box turns out to equal its declaration anyway.
  problems.push(...checkContentSizedBox(manifests));

  for (const platform of /** @type {const} */ (['android', 'ios'])) {
    /** @type {Map<string, string[]>} */
    const bySize = new Map();
    for (const manifest of selfSizing) {
      const entry = declared[manifest.hybridView];
      if (entry == null) continue;
      const size = entry[platform];
      if (size == null || !(size.width > 0) || !(size.height > 0)) {
        problems.push(
          `scripts/conformance-core.mjs: DECLARED_FALLBACKS.${platform} for ` +
            `${manifest.hybridView} is not a positive size — the engine ignores a ` +
            'non-positive declaration, so the control is laid out at 0x0 for a frame'
        );
        continue;
      }
      const key = `${String(size.width)}x${String(size.height)}`;
      bySize.set(key, [...(bySize.get(key) ?? []), manifest.hybridView]);
    }
    for (const [size, owners] of bySize) {
      if (owners.length < 2) continue;
      problems.push(
        'scripts/conformance-core.mjs: DECLARED_FALLBACKS has ' +
          `${size} on ${platform} for ${owners.join(' and ')} — two components do ` +
          'not declare the same number, so one of these rows was copied, and the ' +
          'suite can no longer say which control a fallback belongs to'
      );
    }
  }
  return problems;
}

/**
 * Whether every name in {@link CONTENT_SIZED_BOX} describes a control that could be.
 *
 * Separate from {@link checkFallbackTable} so a test can hand it a manifest set where a
 * name is *not* intrinsic — the case that matters, and one this repo cannot produce without
 * pretending.
 *
 * @param {any[]} manifests
 * @param {ReadonlyArray<string>} [list]
 * @returns {string[]}
 */
export function checkContentSizedBox(manifests, list = CONTENT_SIZED_BOX) {
  const problems = [];
  for (const hybridView of list) {
    const manifest = manifests.find((entry) => entry.hybridView === hybridView);
    if (manifest != null && manifest.sizing === 'intrinsic') continue;
    problems.push(
      'scripts/conformance-core.mjs: CONTENT_SIZED_BOX lists ' +
        `${hybridView}${
          manifest == null
            ? ', and no manifest declares that control'
            : `, and its manifest says sizing: ${JSON.stringify(manifest.sizing)}`
        } — that list is only for a control that is intrinsic and sizes itself ` +
        'from its content, and a name here skips the comparison that would ' +
        'otherwise catch a stale declaration'
    );
  }
  return problems;
}

/* --------------------------- the locale the table is valid in --------------------------- */

/** Set this to compare a locale-dependent row in some *other* locale, deliberately. */
export const ALLOW_LOCALE_MISMATCH_ENV = 'NITRO_UI_ALLOW_LOCALE_MISMATCH';

/**
 * Is the app under test running in the locale the declared number was measured in?
 *
 * A `boxRule: 'both'` comparison of a localised measurement against a localised
 * declaration is only a comparison while both sides are in the same locale: the
 * DatePicker's iOS width is its locale's formatter's widest date, so the same
 * binary settles at 107 in `en_US` and 103 in `en_PT`, and both are correct.
 *
 * A mismatch is therefore a **failed premise**, and a failed premise is a failure:
 * `example/rn-harness.config.mjs` pins the launch locale, so the app reporting a
 * different one means the pin was dropped, overridden by someone who did not say
 * so, or that the formatter stopped following the locale it is handed. Each of
 * those is worth a red row. Reporting a *skip* instead is what round 1 of this task
 * did, and the reviewer's objection was right — a suite that reads green while
 * comparing less than its name claims is worse than one that stops.
 *
 * So this returns `{ expected, actual, tolerated }` on a mismatch and the caller
 * decides: the finding is a failure unless `tolerated`, which only an explicit
 * `NITRO_UI_ALLOW_LOCALE_MISMATCH=1` in the run's environment grants (published to
 * the app by `example/rn-harness.config.mjs`, and read back through
 * `example/__tests__/deviceContext.ts` — the app cannot see the runner's own
 * environment any more than it can see `CI`). That is the escape hatch for someone
 * probing another locale on purpose; it prints which two claims it suspended, so a
 * run that compared less is legible.
 *
 * `null` — the premise holds — when the row names no locale, when the app reports
 * the one it names, or… not when the app cannot tell: an app that reports no locale
 * keeps the strict comparison, because "we do not know" must not read as "the
 * premise holds".
 *
 * @param {{ measuredUnderLocale?: string } | undefined} row One platform's
 *   {@link DECLARED_FALLBACKS} entry: the locale its numbers were measured in, if they depend on
 *   one.
 * @param {string | null | undefined} deviceLocale As the *app* reports it
 *   (`example/__tests__/deviceContext.ts`), which is what the engine actually rendered under.
 * @param {boolean | null} [mismatchAllowed] Whether this run published
 *   {@link ALLOW_LOCALE_MISMATCH_ENV}. `null`/`false` means it did not, which is the
 *   default and the safe answer for a reader that cannot check.
 */
export function localePremiseMiss(row, deviceLocale, mismatchAllowed = null) {
  const expected = row?.measuredUnderLocale;
  if (expected == null) return null;
  if (deviceLocale == null || deviceLocale === '') return null;
  if (canonicalLocale(expected) === canonicalLocale(deviceLocale)) return null;
  return {
    expected,
    actual: deviceLocale,
    tolerated: mismatchAllowed === true,
  };
}

/**
 * `en-US`, `en_US`, `en-US-POSIX` → `en-us`.
 *
 * Compared on the language(+script)+region prefix, because the identifier the engine itself
 * reports (`NSLocale.languageCode`/`regionCode`, Android's `Locale.getLanguage()`/`getCountry()`)
 * carries fewer subtags than a launcher's `en-US-POSIX`, and the region is the part that changes a
 * date's shape. `und` (the engine's own "no locale" answer, `NitroUiAppleSizing.mm`'s fallback) is
 * deliberately *not* equal to anything, so an app that cannot name its locale fails the premise
 * rather than silently matching a row.
 */
export function canonicalLocale(identifier) {
  const parts = String(identifier).replace(/_/g, '-').split('-');
  const out = [(parts[0] ?? '').toLowerCase()];
  for (const part of parts.slice(1)) {
    if (part.length === 4 || part.length === 2 || /^\d{3}$/.test(part)) {
      out.push(part.toLowerCase());
    } else {
      break; // a variant (`POSIX`, `u-ca-…`): not part of what the engine reports
    }
  }
  return out.join('-');
}

/**
 * Static check: does the launch locale the harness pins agree with the table's rows?
 *
 * `example/rn-harness.config.mjs` pins the iOS app's locale so the locale-dependent rows above
 * are comparable on every runner, and a mismatch between that pin and a row is a failing run
 * rather than a skip. The two halves live in different files and the failure mode of drift is
 * asymmetric: a row the pin does not match makes every device run red, so it cannot be missed,
 * but a row that names a locale *nothing* pins is invisible — it can only ever be compared in
 * whatever locale a machine happens to be in. Hence the two directions below.
 *
 * @param {string} configText the text of `example/rn-harness.config.mjs`
 * @param {Readonly<Record<string, any>>} [declared]
 * @returns {string[]} problems
 */
export function checkLaunchPinAgreesWithTable(
  configText,
  declared = DECLARED_FALLBACKS
) {
  const problems = [];
  const pinned = /const DEFAULT_APP_TEST_LOCALE = '([^']*)'/.exec(configText);
  if (pinned == null) {
    return [
      'example/rn-harness.config.mjs: no DEFAULT_APP_TEST_LOCALE, so the app ' +
        'launches in whatever locale the machine is in — the DatePicker row’s ' +
        'box comparison then fails on every runner that is not in the locale it ' +
        'was measured in (and if that comparison ever becomes a skip again, it ' +
        'would skip everywhere and still read green)',
    ];
  }
  const pinTag = canonicalLocale(pinned[1]);
  for (const [hybridView, row] of Object.entries(declared)) {
    const want = row.ios?.measuredUnderLocale;
    if (want != null && canonicalLocale(want) !== pinTag) {
      problems.push(
        `example/rn-harness.config.mjs pins the app to locale ${pinned[1]} ` +
          `(${pinTag}), and DECLARED_FALLBACKS.${hybridView}.ios says its ` +
          `numbers were measured in ${want} — every device run of that row’s box ` +
          'comparison would fail on the premise alone. Make the pin match the ' +
          'row, or the row match the pin'
      );
    }
    // Android has no pin to agree with: the emulator's locale is an AVD/boot
    // setting, and nothing here passes one (see the row comment in
    // DECLARED_FALLBACKS). So a locale named there would be a premise no run ever
    // checks — which is only dangerous if it goes unnoticed, hence a red `check`.
    const androidWant = row.android?.measuredUnderLocale;
    if (androidWant != null) {
      problems.push(
        `DECLARED_FALLBACKS.${hybridView}.android names measuredUnderLocale ` +
          `${androidWant}, but nothing pins the emulator’s locale — that premise ` +
          'could never be checked, so the comparison it guards would depend on ' +
          'the AVD. Either drop the locale from the row, or pin the emulator ' +
          'locale at boot (a `device-pool.mjs` boot arg) and teach this check ' +
          'where to read it'
      );
    }
  }
  return problems;
}

/* ------------------------------- the rule bodies ----------------------------- */

/**
 * Rule: is the fallback the control's own, registered before the first measure, and
 * not simply the answer?
 *
 * @param {object} input
 * @param {string} input.component
 * @param {'ios'|'android'} input.platform
 * @param {{width: number, height: number} | null} input.declared what the *engine*
 *   reports for the control (`null` = nothing registered)
 * @param {{width: number, height: number} | null} input.measured what a warm,
 *   self-sized mount settles at
 * @param {number} input.corrections corrections the engine needed for those mounts
 * @param {boolean} [input.poisoned] the run replaced the guess with
 *   {@link POISON_SIZES} first, so a correction *must* arrive
 * @param {Record<string, any>} [input.declaredTable]
 * @param {Record<string, {width: number, height: number}>} [input.poisonSizes]
 * @param {number} [input.tolerance]
 * @param {'both' | 'height' | 'none'} [input.boxRule] which axes the declaration is
 *   supposed to describe — see {@link boxRuleFor}. Callers pass what they read from the
 *   shared table; the default is the strictest rule, so forgetting to pass one can
 *   produce a false red but never a false green.
 * @param {boolean | null} [input.mismatchAllowed] Whether this run published
 *   {@link ALLOW_LOCALE_MISMATCH_ENV}. Default `null`: a caller that cannot check
 *   gets the failure, not the skip.
 * @returns {Array<{component: string, rule: string, problem: string | null, skipped?: string}>}
 */
export function fallbackFindings(input) {
  const {
    component,
    platform,
    declared,
    measured,
    corrections,
    poisoned = false,
    declaredTable = DECLARED_FALLBACKS,
    poisonSizes = POISON_SIZES,
    tolerance = SIZE_TOLERANCE_DP,
    boxRule = 'both',
    deviceLocale = null,
    mismatchAllowed = null,
  } = input;
  const problems = [];
  const hybridView = `NitroUi${component}`;
  const expected = declaredTable[hybridView]?.[platform];
  const report = (problem) =>
    problems.push({ component, rule: 'declared-fallback', problem });

  /**
   * Does `measured` agree with `want` on every axis this control's declaration describes?
   *
   * `both` compares both numbers. `height` compares only the height, because that control's
   * width is its parent's and agrees with nothing the component declares — and comparing it
   * anyway is what made the first device run report Slider and Progress as broken for
   * filling the width they were given.
   */
  const ownsAgrees = (measured_, want) => {
    if (Math.abs(measured_.height - want.height) > tolerance) return false;
    if (boxRule === 'both') {
      return Math.abs(measured_.width - want.width) <= tolerance;
    }
    return true;
  };
  /** The whole box, for the mode that compares none of it against a declaration. */
  const boxEquals = (a, b) =>
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance;

  if (expected == null) {
    report(
      `no DECLARED_FALLBACKS row for ${hybridView} on ${platform}, so every ` +
        'assertion about this control’s fallback is vacuous — which is worse than ' +
        'having none at all'
    );
    return problems;
  }

  if (declared == null) {
    report(
      'the engine knows no declared fallback, so a cold mount falls to the `0x0` ' +
        'branch and is force-laid-out — that is the frame the first frame lies about'
    );
  } else if (!near(declared, expected, tolerance)) {
    report(
      `the engine declares ${fmt(declared)} and the table says ` +
        `${fmt(expected)} — one of them is stale, and the table is written from the ` +
        'component’s source, so suspect the component'
    );
  }

  if (measured == null) {
    report('a warm mount settled at nothing, so there is no size to compare');
    return problems;
  }
  const poison = poisoned ? poisonSizes[platform] : null;
  // Whole-box, and in every mode: the poison is an exact pair rather than a declaration, so
  // "the box is still the poison" needs no policy to say it. A control that settled at a
  // size it never declared is the bug, whoever's width it would have been.
  if (poison != null && boxEquals(measured, poison)) {
    // The most specific diagnosis wins, and reporting the generic one as well would bury
    // it: "the fallback is not the measured size" is also true here, and says much less.
    report(
      `settled at the poisoned ${fmt(poison)} — the guess was never corrected, ` +
        'and every cold mount of this control is laid out at a size it never declared'
    );
    return problems;
  }

  // Is this row's locale the app is actually running in? `null` means the row does not
  // depend on one, or the app could not name its locale (in which case nothing is skipped:
  // "unknown" must never read as "premise met").
  const localeMiss = localePremiseMiss(expected, deviceLocale, mismatchAllowed);

  if (boxRule === 'none') {
    // The exemption has to be *earned*, every run. A control whose box came to equal its
    // declaration is a control whose size stopped depending on its content, and the run
    // that discovers it goes red rather than printing nothing.
    if (boxEquals(measured, expected)) {
      report(
        `${hybridView} is exempt from the box comparison as content-sized, and it ` +
          `settled at its own declared ${fmt(expected)} anyway — a control that ` +
          'always measures its declared size is not sizing itself from its content, ' +
          'so the exemption is no longer true and the comparison should be restored'
      );
    }
  } else if (localeMiss != null && !ownsAgrees(measured, expected)) {
    // The row's locale and the app's disagree, and the mismatch moves both sides of the
    // comparison, so it cannot be read as a stale declaration. What it *is* depends on whether
    // this run asked to be in another locale:
    //
    //  - It did not (`NITRO_UI_ALLOW_LOCALE_MISMATCH` unset, the default): a FAILURE. The
    //    harness pins the launch locale, so the app reporting a different one means the pin
    //    was lost, was overridden without being said, or the formatter stopped following its
    //    locale. Any of those deserves a red row; printing a skip here is how a suite ends up
    //    green while comparing nothing, which is the mistake this branch used to make.
    //  - It did: the printed skip, naming both claims it suspends, because both rest on this
    //    one number — the box comparison above, and the warm-corrections claim below that
    //    `HybridNitroUiDatePicker.swift`'s `fallbackSize` prices in words (“a locale *narrower*
    //    than this one … pays a horizontal correction to lose it”).
    //
    // Either way the rest of the rule runs: a poisoned guess must still be corrected, and a
    // mount that settles at nothing is still a failure.
    const both =
      `the app runs in ${localeMiss.actual} and ${hybridView}’s declared ` +
      `${fmt(expected)} is what it measures in ${localeMiss.expected}, so the ` +
      `measured ${fmt(measured)} is the same formatter answering a different ` +
      'question. Either launch the app in the pinned locale (the harness does ' +
      `this by default; ${localeMiss.expected.replace(/-/g, '_')} here) or run ` +
      `with ${ALLOW_LOCALE_MISMATCH_ENV}=1 to say you meant it`;
    if (localeMiss.tolerated) {
      problems.push({
        component,
        rule: 'declared-fallback',
        problem: null,
        skipped:
          `box and warm-corrections comparison skipped (${ALLOW_LOCALE_MISMATCH_ENV}` +
          `=1): ${fmt(expected)} is what this control measures in ` +
          `${localeMiss.expected} and this run's app locale is ` +
          `${localeMiss.actual}, so the measured ${fmt(measured)} proves nothing ` +
          'about the declaration',
      });
    } else {
      report(both);
    }
  } else if (!ownsAgrees(measured, expected)) {
    report(
      `the fallback ${fmt(expected)} is not the measured ${fmt(measured)} for a ` +
        (boxRule === 'height'
          ? 'control whose own axis is its height (its width is its parent’s) — a ' +
            'mismatch there means the declaration drifted from the component'
          : 'control that declares its size — for an intrinsic control those are the ' +
            'same number by definition, so a mismatch means the declaration drifted ' +
            'from the component')
    );
  }

  // Only a control whose declaration describes its *whole* box can be asked not to need a
  // correction when warm: a `fillWidth` control's declared width is not its parent's, and a
  // content-sized control's is a documented middle of a measured table, so both are
  // corrected on a cold configuration by design. Asserting zero there would be asserting
  // that a guess is an answer.
  if (
    !poisoned &&
    corrections > 0 &&
    boxRule === 'both' &&
    !(localeMiss != null && !ownsAgrees(measured, expected))
  ) {
    report(
      `needed ${String(corrections)} correction(s) from a warm engine whose ` +
        `fallback ${fmt(expected)} already describes this control’s whole box — ` +
        'the declaration is not reaching the engine'
    );
  }
  if (poison != null && corrections === 0) {
    report(
      `settled at ${fmt(measured)} with no correction, having been poisoned ` +
        `to ${fmt(poison)} — that size can only have come from the component, so ` +
        'the correction went missing while the ledger stayed quiet'
    );
  }
  return problems;
}

/**
 * Rule: did the engine's bookkeeping return to baseline after every instance dropped?
 *
 * @param {object} input
 * @param {string} input.component
 * @param {number} input.baselineLedger entries before the first mount
 * @param {number} input.baselineRegistry entries before the first mount
 * @param {number} input.ledgerEntries entries after every instance has dropped
 * @param {number} input.registryEntries entries after every instance has dropped
 * @param {number} input.instances how many were mounted and dropped
 * @param {number} [input.registryGrowth] entries the engine may keep: the component's
 *   own registry row is created by the first measure, not by a drop, so an honest
 *   baseline is one taken after a single warm-up mount. Anything above that is
 *   per-instance state that outlived its instance — B1 is exactly that shape
 *   (`PrewarmCache` held `SizingHandle`s by identity, and they never left).
 * @returns {Array<{component: string, rule: string, problem: string}>}
 */
export function leakFindings(input) {
  const {
    component,
    baselineLedger,
    baselineRegistry,
    ledgerEntries,
    registryEntries,
    instances,
    registryGrowth = 0,
  } = input;
  const problems = [];
  const report = (problem) =>
    problems.push({ component, rule: 'no-leak-on-drop', problem });

  if (ledgerEntries !== baselineLedger) {
    report(
      `${String(ledgerEntries - baselineLedger)} ledger entry(ies) survived ` +
        `${String(instances)} drops. Each ` +
        '`NitroUiSizing::forget(sizing_.get())` pair missing from `onDropView` ' +
        'shows up here, and a handle keeps the view alive, so the leaked entry is ' +
        'the leak'
    );
  }
  if (registryEntries - baselineRegistry > registryGrowth) {
    report(
      `the registry grew by ${String(
        registryEntries - baselineRegistry
      )} across ${String(instances)} mounts, of which ${String(
        registryGrowth
      )} is accounted for — per-instance state in a process-wide table is the shape ` +
        'of a leak the engine cannot see either'
    );
  }
  return problems;
}

/**
 * Rule: does the control show any of its previous owner's props?
 *
 * @param {object} input
 * @param {string} input.component
 * @param {string} input.identity the identity that stayed the same across lifetimes
 * @param {Array<{label: string, expected: unknown, actual: unknown}>} input.checks
 *   what the control reports about itself, after the new owner took over
 * @returns {Array<{component: string, rule: string, problem: string}>}
 */
export function recycleFindings(input) {
  const problems = [];
  for (const check of input.checks) {
    if (check.actual === check.expected) continue;
    problems.push({
      component: input.component,
      rule: 'recycle-reset',
      problem:
        `${input.identity} kept its identity across lifetimes and ` +
        `${check.label} reads ${JSON.stringify(check.actual)} where the props say ` +
        `${JSON.stringify(check.expected)} — the view came back wearing its ` +
        'previous owner',
    });
  }
  return problems;
}

/* ------------------------------ the in-app fixtures -------------------------- */

/**
 * The harness suite's fixture table, cross-checked against the manifests.
 *
 * The other half of "a new manifest is covered automatically". `checkA11yTable` guards the
 * host-side sweep; this guards `example/__tests__/Conformance.harness.tsx`, whose fixtures
 * are the only way the three in-app rules reach a control. A control with no fixture would
 * otherwise be silently absent from every assertion in that file — the exact gap the suite
 * exists to close, in the file that was written to close it.
 *
 * A text scan, because the harness file is a React Native module jest cannot render here
 * (no Nitro, no device), and the same reason `component-coverage.test.js` scans the bench
 * arms: what actually goes missing is whether the table has a row for the control at all.
 *
 * @param {any[]} manifests
 * @param {string | null} harnessText
 * @returns {string[]} problems
 */
export function checkInAppFixtures(manifests, harnessText) {
  if (harnessText == null) {
    return [
      'example/__tests__/Conformance.harness.tsx: not found — the three in-app ' +
        'rules have no suite, so no control is checked by them',
    ];
  }
  const table = fixtureRows(harnessText);
  if (table == null) {
    return [
      'example/__tests__/Conformance.harness.tsx: the FIXTURES table could not be ' +
        'found, so nothing here can say which controls the three in-app rules ' +
        'actually run — a scan that cannot find the table must not report that it ' +
        'checked it',
    ];
  }
  const problems = [];
  for (const manifest of manifests) {
    // The row itself, not a substring of the file. Round 1 asked whether the text
    // `name: 'Switch'` appeared anywhere, so a comment saying
    // `// TODO: name: 'Switch' is missing` satisfied it, and so would a fixture for a
    // different control whose props happened to mention the string. A row is a `{` at the
    // table's indent level whose *own* members carry the name and the component — the
    // shape a comment cannot take, and the shape the suite actually renders.
    const row = table.find((entry) => entry.name === manifest.name);
    if (row == null) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: no fixture for ` +
          `${manifest.name} (${manifest.id}). Every control the registry declares ` +
          'has to be in the conformance table, or it is silently outside all three ' +
          'in-app rules — add the fixture, do not skip the control'
      );
      continue;
    }
    if (row.component !== manifest.hybridView) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: the ${manifest.name} fixture ` +
          `says ${String(row.component)} and the manifest says ` +
          `${manifest.hybridView}, so the sizing rules ask the engine about a ` +
          'component that is not this one'
      );
    }
    // And the recycle rule's oracle for this control, or the reason it has none. Per row
    // rather than one scan for either word, because the failure it exists for is a probe
    // quietly *leaving* one control's row while the other six keep theirs — a suite that
    // prints seven green lines, one of which asserts nothing, is the shape this file was
    // written to refuse.
    if (!/\n {4}probe: \{/.test(row.text)) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: the ${manifest.name} ` +
          'fixture has no `probe`, so this control has no recycle rule that can ' +
          'fail — add the residue probe, or say why it cannot have one with ' +
          '`probe: { noProbe: … }`'
      );
    } else if (
      !/\n {6}leaveBehind:/.test(row.text) &&
      !/\n {6}noProbe:/.test(row.text) &&
      !/\n {6}blindSpot:/.test(row.text)
    ) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: the ${manifest.name} ` +
          'fixture has a `probe` that is neither a residue probe (`leaveBehind`), ' +
          'nor a reason it cannot be one (`noProbe`), nor a stated hole in the guard ' +
          '(`blindSpot`) — and only the last two are visible in the coverage table'
      );
    }
  }

  // And the reverse: a row for a control that no longer exists is a test of nothing. Read
  // from the same parse, so the two directions cannot disagree about what a row is.
  for (const row of table) {
    if (manifests.some((manifest) => manifest.name === row.name)) continue;
    problems.push(
      `example/__tests__/Conformance.harness.tsx: a fixture guards "${row.name}" ` +
        'and no manifest declares that control — the suite is asserting about a ' +
        'component that is not in the registry'
    );
  }
  return problems;
}

/**
 * The recycle verdict each fixture declares: `{ kind: 'probe' }`, `{ kind: 'noProbe', reason }`
 * or `{ kind: 'blindSpot', reason }`.
 *
 * @typedef {object} RecycleNote
 * @property {'probe' | 'noProbe' | 'blindSpot'} kind
 * @property {string} [reason] the fixture's own words, for the two kinds that have none
 */

/**
 * The `name` → note map {@link CONFORMANCE_RULES}' recycle rule and {@link checkRecycleNotes}
 * read out of the harness's fixture table.
 *
 * Read from the file rather than written out beside the matrix because the matrix's answer has
 * to be the *suite's* answer: a list here of which controls have no probe is a second opinion
 * that goes stale the day a probe lands, and the stale direction is the flattering one —
 * `covered`. Returns `{}` when the table cannot be found; `checkInAppFixtures` is what reports
 * that as a problem rather than letting an empty map read as "no control is missing a probe".
 *
 * @param {string | null} harnessText
 * @returns {Record<string, RecycleNote>}
 */
export function recycleNotes(harnessText) {
  const table = harnessText == null ? null : fixtureRows(harnessText);
  /** @type {Record<string, RecycleNote>} */
  const notes = {};
  for (const row of table ?? []) {
    notes[row.name] = recycleNoteOf(row.text);
  }
  return notes;
}

/**
 * One fixture row's recycle verdict, or `{ kind: 'probe' }` when it has a real probe.
 *
 * The reason is the string literal in the row, which may be a `+`-joined multi-line one; the
 * joins are collapsed and the quotes taken out so the coverage table prints a sentence rather
 * than the middle of an expression.
 *
 * @param {string} rowText
 * @returns {RecycleNote}
 */
function recycleNoteOf(rowText) {
  const kind = /\n {4}probe: \{/m.test(rowText)
    ? /\n {6}noProbe:/.test(rowText)
      ? 'noProbe'
      : /\n {6}blindSpot:/.test(rowText)
        ? 'blindSpot'
        : 'probe'
    : 'probe';
  if (kind === 'probe') return { kind };
  // The value may start on the same line or, as prettier writes every one of these, the
  // next — so the pattern allows whitespace rather than a space after the colon, and the
  // unwrapping below is what turns `'a ' +` / newline / `'b'` back into one sentence.
  const literal = new RegExp(
    `\\n {6}${kind}:\\s((?:.|\\n)*?)(?:\\n {6}\\w+:|\\n {4}\\},|\\n {4}\\}$)`
  ).exec(rowText);
  const reason =
    literal == null
      ? '(no reason given)'
      : literal[1]
          .replace(/\r?\n\s*/g, ' ')
          .replace(/'\s*\+\s*'/g, '')
          .replace(/['`]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/[,;\s]+$/, '')
          .trim();
  return { kind, reason };
}

/**
 * The two lists that describe a recycle hole are the fixture's note and a debt row, and they
 * have to say the same thing.
 *
 * Four ways they can disagree, all of them a coverage lie in one direction or the other:
 *
 * - a `blindSpot` with no debt row: the matrix would say `covered` for a hole the suite knows
 *   about, which is the re-review's finding verbatim;
 * - a debt row for a control whose fixture has a real probe: the exemption would swallow a
 *   finding the probe can actually produce, and a run that reproduced it would print `known
 *   failing` over a number that says something;
 * - a debt row for a control whose fixture says `noProbe`: the two files disagree about
 *   whether the state exists, and the honest reading is that the *probe* is missing;
 * - a debt row for a control no fixture guards: nothing reports the key, so
 *   {@link staleDebt} can never retire the row and it excuses a finding nothing looks for.
 *
 * @param {string | null} harnessText
 * @param {ReadonlyArray<any>} [rows] the debt list to compare with
 * @returns {string[]} problems
 */
export function checkRecycleNotes(harnessText, rows = CONFORMANCE_EXEMPTIONS) {
  const notes = recycleNotes(harnessText);
  const problems = [];
  for (const [name, note] of Object.entries(notes)) {
    if (note.kind !== 'blindSpot') continue;
    if (
      !rows.some(
        (row) => row.component === name && row.rule === 'recycle-reset'
      )
    ) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: the ${name} fixture says its ` +
          'recycle rule is a `blindSpot` — the control holds state a reset must clear ' +
          'and no platform can see it — and scripts/conformance-core.mjs has no ' +
          'CONFORMANCE_EXEMPTIONS row for it. A known hole is a failing cell with a ' +
          'FOLLOWUPS line, not a note in a fixture: add the row'
      );
    }
  }
  for (const row of rows) {
    if (row.rule !== 'recycle-reset') continue;
    const note = notes[row.component];
    if (note == null) {
      problems.push(
        `scripts/conformance-core.mjs: CONFORMANCE_EXEMPTIONS has a recycle-reset ` +
          `row for "${row.component}" and no fixture guards that control, so nothing ` +
          'reports the key and nothing can retire the row — it would excuse a finding ' +
          'no probe is capable of producing'
      );
      continue;
    }
    if (note.kind === 'probe') {
      problems.push(
        `scripts/conformance-core.mjs: CONFORMANCE_EXEMPTIONS exempts ` +
          `"${row.component}" from recycle-reset and that fixture has a residue ` +
          'probe, so the row would cover up a finding the probe can produce. Either ' +
          'the probe is wrong or the debt is paid — delete one'
      );
    } else if (note.kind === 'noProbe') {
      problems.push(
        `scripts/conformance-core.mjs: CONFORMANCE_EXEMPTIONS files ` +
          `"${row.component}"’s recycle-reset as failing debt and its fixture says ` +
          '`noProbe` — the two disagree about whether the control holds state at all. ' +
          'If the state is real the fixture’s note is a `blindSpot`; if it is not, the ' +
          'debt row is excusing nothing'
      );
    }
  }
  return problems;
}

/**
 * The FIXTURES table, parsed into rows of `{ name, component, text }`.
 *
 * Line-anchored rather than a substring scan (X4 review N3): round 1's `includes` was
 * satisfied by a comment, by a mention in a doc block, and by one fixture's props naming
 * another control. What is being asked is "does the suite render a fixture for this
 * control", and the only evidence for that is a row of the table it renders from.
 *
 * Returns `null` when the table is not there in the shape this understands — reported as a
 * problem rather than silently skipping, because an unfound table looks exactly like an
 * empty one to a caller that trusts the scan.
 *
 * @param {string} harnessText
 * @returns {Array<{name: string, component: string | null, text: string}> | null}
 */
function fixtureRows(harnessText) {
  // Not `/g`: `String#match` with the global flag returns the matched strings and drops
  // their offsets, which reads as "the table is not there" to the caller below.
  const declared = /^const FIXTURES: ReadonlyArray<Fixture> = \[\n/m.exec(
    harnessText
  );
  if (declared == null || declared.index == null) return null;
  const body = harnessText.slice(declared.index + declared[0].length);
  const close = body.indexOf('\n];');
  if (close === -1) return null;
  const tableText = body.slice(0, close);
  // A row opens with `{` at the table's own indent (two spaces: one level under the
  // array), and every row boundary is such a line.
  const openers = [...tableText.matchAll(/^ {2}\{$/gm)];
  return openers.map((opener, index) => {
    const next = openers[index + 1];
    const text = tableText.slice(
      opener.index,
      next == null ? tableText.length : next.index
    );
    // Members are properties of the row: exactly four spaces of indent, so a mention
    // inside a comment (`   * name: 'Switch'`) or in a nested object is not one.
    const name = text.match(/^ {4}name: '([^']+)',$/m)?.[1];
    const component = text.match(/^ {4}component: '([^']+)',$/m)?.[1];
    // An un-named `{` block in the table is a shape this scan does not understand, and a
    // row that reads as `undefined` would fail the reverse check for the wrong reason.
    return {
      name: name ?? String(text.match(/^ {4}\S[^:\n]*:/m)?.[0] ?? '(no name)'),
      component: component ?? null,
      text,
    };
  });
}

/**
 * The `component|rule` keys the debt lists mark as failing today, in **matrix** keys.
 *
 * Feeds `coverageMatrix`'s `failing` context, so the report's matrix says *failing* rather
 * than *covered* for a rule the current code does not pass. Deriving it from the debt lists
 * rather than writing it out is what keeps the matrix and the exemptions from being two
 * lists that can disagree.
 *
 * Two key spaces exist because two things are keyed differently: the a11y debt rows are keyed
 * on a *case* id (one component has two cases — its own screen and inside a `<Host>`) and
 * their findings carry the short rule name `a11y`, while the matrix is keyed on control and
 * full rule id. This function is the bridge, and the one place the translation happens; the
 * a11y rows of several cases for one component collapse to a single matrix cell, which is
 * right — the matrix is about controls.
 *
 * @param {ReadonlyArray<any>} [a11yRows]
 * @param {ReadonlyArray<any>} [rows]
 * @param {ReadonlyArray<any>} [table]
 * @returns {string[]}
 */
export function failingKeys(
  a11yRows = A11Y_EXEMPTIONS,
  rows = CONFORMANCE_EXEMPTIONS,
  table = A11Y_CONTROLS
) {
  const keys = new Set(rows.map((row) => findingKey(row.component, row.rule)));
  for (const row of a11yRows) {
    const component =
      table.find((entry) => entry.id === row.control)?.component ?? row.control;
    keys.add(findingKey(component, A11Y_RULE_ID));
  }
  return [...keys];
}

/**
 * The resolver {@link checkCoverage} and {@link formatMatrix} ask for a failing cell's line.
 *
 * A failing cell has to point at a line that exists in `docs/tasks/FOLLOWUPS.md`, and this is
 * where that is proved: each debt row's `followups` text is compared with the document, so
 * debt cannot cite a line somebody deleted or never wrote. It returns `null` when the cell has
 * no row or the row's line is not in the file, which is what makes {@link checkCoverage}
 * report it as debt with no owner.
 *
 * @param {string | null} followupsText the text of `docs/tasks/FOLLOWUPS.md`
 * @param {object} [tables] the debt lists to read (default: the real ones)
 * @param {ReadonlyArray<any>} [tables.a11y]
 * @param {ReadonlyArray<any>} [tables.conformance]
 * @param {ReadonlyArray<any>} [tables.table] the a11y case table, for case-id → component
 * @returns {(key: string) => string | null}
 */
export function followupsResolver(followupsText, tables = {}) {
  const a11yRows = tables.a11y ?? A11Y_EXEMPTIONS;
  const rows = tables.conformance ?? CONFORMANCE_EXEMPTIONS;
  const table = tables.table ?? A11Y_CONTROLS;
  const componentOf = (controlId) =>
    table.find((entry) => entry.id === controlId)?.component ?? controlId;
  return (key) => {
    const [component, rule] = key.split('|');
    const cited = [
      ...rows
        .filter((row) => findingKey(row.component, row.rule) === key)
        .map((row) => row.followups),
      ...(rule === A11Y_RULE_ID || rule === A11Y_FINDING_RULE
        ? a11yRows
            .filter((row) => componentOf(row.control) === component)
            .map((row) => row.followups)
        : []),
    ];
    if (cited.length === 0 || followupsText == null) return null;
    const unique = [...new Set(cited)];
    return unique.every((line) => followupsText.includes(line))
      ? unique.join(' · ')
      : null;
  };
}

/* ---------------------------------- coverage --------------------------------- */

/**
 * The rule × control matrix, with a reason for every "not applicable".
 *
 * This is the answer to "what does the suite check, per control": every cell is
 * `covered`, `failing` (asserted, with an exemption recording the debt) or
 * `not-applicable` with a stated reason. There is no fourth state, which is the point.
 *
 * @param {any[]} validated manifests
 * @param {object} [context]
 * @param {Record<string, string>} [context.sizing]
 * @param {Iterable<string>} [context.failing] `component|rule` keys exempted today
 * @returns {Array<{name: string, rules: Record<string, {state: string, reason?: string}>}>}
 */
export function coverageMatrix(manifests, context = {}) {
  const failing = new Set(context.failing ?? []);
  return manifests.map((manifest) => {
    /** @type {Record<string, {state: string, reason?: string}>} */
    const rules = {};
    for (const rule of CONFORMANCE_RULES) {
      const reason = rule.applies(manifest, {
        sizing: context.sizing ?? {},
        recycleNotes: context.recycleNotes ?? {},
      });
      rules[rule.id] =
        reason != null
          ? { state: 'not-applicable', reason }
          : failing.has(findingKey(manifest.name, rule.id))
            ? { state: 'failing' }
            : { state: 'covered' };
    }
    return { name: manifest.name, rules };
  });
}

/**
 * Every rule, for every manifest, has an answer — and a `failing` answer has a
 * FOLLOWUPS line to own it.
 *
 * The one that matters for the brief's "picks up a new manifest automatically": this
 * is what makes an uncovered control impossible rather than invisible.
 *
 * @param {any[]} manifests
 * @param {ReturnType<typeof coverageMatrix>} matrix
 * @param {(key: string) => string | null} followupsFor
 * @returns {string[]} problems
 */
export function checkCoverage(manifests, matrix, followupsFor) {
  const problems = [];
  if (matrix.length !== manifests.length) {
    problems.push(
      `the coverage matrix has ${String(matrix.length)} rows for ` +
        `${String(manifests.length)} manifests — a manifest with no row is a ` +
        'control nobody decided anything about'
    );
  }
  for (const row of matrix) {
    for (const rule of CONFORMANCE_RULES) {
      const cell = row.rules[rule.id];
      if (cell == null) {
        problems.push(
          `${row.name} × ${rule.id}: no verdict — every control answers every ` +
            'rule, even if the answer is "not applicable, because…"'
        );
        continue;
      }
      if (cell.state !== 'failing') continue;
      if (followupsFor(findingKey(row.name, rule.id)) == null) {
        problems.push(
          `${row.name} × ${rule.id}: marked failing with no ` +
            'docs/tasks/FOLLOWUPS.md line. Debt with no owner is debt nobody pays'
        );
      }
    }
  }
  return problems;
}

/* --------------------------------- reporting --------------------------------- */

/**
 * The matrix as Markdown, for the report's coverage table.
 *
 * @param {ReturnType<typeof coverageMatrix>} matrix
 * @param {ReadonlyArray<ConformanceRule>} [rules]
 * @param {(key: string) => string | null} [followupsFor]
 * @returns {string[]}
 */
export function formatMatrix(matrix, rules = CONFORMANCE_RULES, followupsFor) {
  const lines = [
    `| Control | ${rules.map((rule) => rule.id).join(' | ')} |`,
    `| --- |${rules.map(() => ' --- |').join('')}`,
  ];
  for (const row of matrix) {
    const cells = rules.map((rule) => {
      const cell = row.rules[rule.id];
      if (cell.state === 'not-applicable') return `n/a — ${cell.reason}`;
      if (cell.state === 'failing') {
        const line = followupsFor?.(findingKey(row.name, rule.id));
        return `**failing**${line == null ? '' : ` — see ${line}`}`;
      }
      return 'covered';
    });
    lines.push(`| ${row.name} | ${cells.join(' | ')} |`);
  }
  return lines;
}

/* --------------------------------- the readers --------------------------------- */

/**
 * The repo's own manifests, through the same loader `gen-registry.mjs` uses — so a
 * manifest the suite reads is a manifest the registry accepts, and a manifest that
 * would make `registry:check` red makes this red too.
 *
 * @param {(path: string) => string | null} [readFile] a fake, for a test
 * @param {string[]} [directories] the component names, when the reader is a fake: one
 *   with no directory listing cannot be asked for them, so they are passed in under
 *   the `__component_directories__` key instead
 * @returns {any[]}
 */
export function repoManifests(readFile = readerFor(), directories = null) {
  const names =
    directories ??
    readdirSync(join(repoRoot(), 'src', 'components'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  return manifestsFromEntries(
    names.flatMap((directory) => {
      const text = readFile(`src/components/${directory}/component.json`);
      // A directory without a manifest is not a control (`Host` is the composition
      // primitive, and `gen-registry.mjs` skips it the same way) — skipping here keeps
      // the two loaders in agreement about what the registry is made of.
      return text == null ? [] : [{ directory, text }];
    })
  );
}

/**
 * A reader for repo-relative paths, so every check here can be handed a fake.
 *
 * @param {string} [root]
 * @returns {(path: string) => string | null}
 */
export function readerFor(root = repoRoot()) {
  return (path) => {
    const absolute = join(root, path);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  };
}

/* ----------------------------------- helpers ---------------------------------- */

/**
 * @param {{width: number, height: number}} a
 * @param {{width: number, height: number}} b
 * @param {number} tolerance
 */
function near(a, b, tolerance) {
  return (
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/** @param {{width: number, height: number} | null} size */
function fmt(size) {
  return size == null ? 'nothing' : `${trim(size.width)}x${trim(size.height)}`;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
