/**
 * The conformance suite's rules and tables as data, so they can be checked against the
 * component manifests and the harness file without a device.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  A11Y_CONTROLS,
  A11Y_EXEMPTIONS,
  A11Y_PRESENTATIONS,
} from './real-input/a11y.mjs';
import { SCREEN_FILE } from './real-input/screens.mjs';
import { manifestsFromEntries } from './registry-core.mjs';

// From the working directory, not `import.meta.url`, which would make this module
// unimportable from Jest. Every script runs from the repo root.
function defaultRepoRoot() {
  return resolve(process.cwd());
}

export function repoRoot() {
  return defaultRepoRoot();
}

/* ---------------------------------- the rules --------------------------------- */

/**
 * A rule's verdict for one manifest: `null` when it applies, or the reason it does not.
 *
 * @typedef {(manifest: any, context: ConformanceContext) => string | null} Applies
 * @typedef {object} ConformanceContext
 * @property {Record<string, string>} sizing the `nitro-ui.sizing.json` rows
 */

/**
 * @typedef {object} ConformanceRule
 * @property {string} id stable — it appears in the report and in exemption rows
 * @property {string} title one line, for the report
 * @property {ReadonlyArray<string>} runs the gates that assert it
 * @property {Applies} applies
 */

export const A11Y_RULE_ID = 'a11y-name-on-focusable-node';

/** @type {ReadonlyArray<ConformanceRule>} */
export const CONFORMANCE_RULES = Object.freeze([
  {
    id: A11Y_RULE_ID,
    title: 'named on the node a person can act on, and only there',
    runs: ['real-input:ios', 'real-input:android'],
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
    // Not applicable only where the control's own fixture says it holds no state for a
    // reset to clear.
    applies: (manifest, context) => {
      const note = (context.recycleNotes ?? {})[manifest.name];
      return note?.kind === 'noProbe' ? note.reason : null;
    },
  },
]);

export const RULE_IDS = CONFORMANCE_RULES.map((rule) => rule.id);

/* -------------------------------- exemptions --------------------------------- */

/**
 * A rule a control is known to fail, recorded rather than fixed.
 *
 * @typedef {object} ConformanceExemption
 * @property {string} component the manifest `name`
 * @property {string} rule a {@link RULE_IDS} member
 * @property {string} followups what owns the fix, as free text
 * @property {string} detail what goes wrong, for the report
 */

/**
 * Rules a control is known to fail in the app; the Android a11y half is `A11Y_EXEMPTIONS`.
 * A row is valid only while its control's fixture marks the recycle probe as a `blindSpot`:
 * state a recycle must clear that no read-out can show.
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

export function findingKey(component, rule) {
  return `${component}|${rule}`;
}

/* ------------------------------ the a11y table -------------------------------- */

/**
 * Cross-checks the hand-written a11y table against the manifests and the example screens:
 *
 * - every manifest is covered by at least one case;
 * - every case names a real manifest and agrees with it on `hybridView`;
 * - every label and `anchorTestId` still appears in the screen the case reads;
 * - a presentation case (`A11Y_PRESENTATIONS`) covers only a component with no box
 *   (`sizing: null`) whose real-input check is on, and never one the table also covers.
 *
 * @param {any[]} manifests
 * @param {(path: string) => string | null} readFile repo-relative
 * @param {ReadonlyArray<any>} [table]
 * @param {Readonly<Record<string, string>>} [screenFile]
 * @param {ReadonlyArray<any>} [presentations]
 * @returns {string[]} problems
 */
export function checkA11yTable(
  manifests,
  readFile,
  table = A11Y_CONTROLS,
  screenFile = SCREEN_FILE,
  presentations = A11Y_PRESENTATIONS
) {
  const problems = [];
  const covered = new Set([
    ...table.map((entry) => entry.component),
    ...presentations.map((entry) => entry.component),
  ]);
  for (const entry of presentations) {
    const manifest = manifests.find(
      (candidate) => candidate.name === entry.component
    );
    if (manifest == null) {
      problems.push(
        `scripts/real-input/a11y.mjs: the presentation case "${entry.id}" guards ` +
          `"${entry.component}" and no manifest declares that control`
      );
      continue;
    }
    if (entry.hybridView !== manifest.hybridView) {
      problems.push(
        `scripts/real-input/a11y.mjs: the presentation case "${entry.id}" says ` +
          `hybridView "${entry.hybridView}" and the manifest says "${manifest.hybridView}"`
      );
    }
    if (manifest.sizing != null) {
      problems.push(
        `scripts/real-input/a11y.mjs: "${entry.id}" is a presentation case, but ` +
          `${manifest.name} is self-sizing (sizing "${String(manifest.sizing)}") - a ` +
          'control with a box is read by the sweep, so it belongs in A11Y_CONTROLS'
      );
    }
    if (manifest.realInput !== true) {
      problems.push(
        `scripts/real-input/a11y.mjs: "${entry.id}" is a presentation case and ` +
          `${manifest.name} asks for no real-input check (realInput is not true), so ` +
          'nothing ever opens the window this case says is read'
      );
    }
    if (table.some((row) => row.component === entry.component)) {
      problems.push(
        `scripts/real-input/a11y.mjs: ${entry.component} is in both A11Y_CONTROLS ` +
          'and A11Y_PRESENTATIONS - it either has a box the sweep reads or it does not'
      );
    }
  }
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
 * The size each component declares as its fallback, per platform. Hand-written on purpose:
 * generated from the native constants, it would compare each constant with itself. A row
 * must match the component's `fallbackSize` in Swift and `FALLBACK_*_DP` in Kotlin.
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
  // Android's width is Button's, because the trigger is the shared Material 3 button. Menu
  // is content-sized, so a measured Menu is never compared with these.
  NitroUiMenu: {
    android: { width: 75.1, height: 52 },
    ios: { width: 74, height: 38 },
  },
  NitroUiSlider: {
    android: { width: 328, height: 48 },
    ios: { width: 351, height: 31 },
  },
  NitroUiButton: {
    android: { width: 75.1, height: 48 },
    ios: { width: 77, height: 35 },
  },
  NitroUiProgress: {
    android: { width: 320, height: 4 },
    ios: { width: 320, height: 4 },
  },
  NitroUiSegmentedControl: {
    android: { width: 187.9, height: 48 },
    ios: { width: 165, height: 31 },
  },
  // The iOS width is the widest `.medium` date a formatter prints, so it holds only in the
  // locale it was measured in, which the harness pins at launch. Android names no locale
  // because nothing pins the emulator's.
  NitroUiDatePicker: {
    android: { width: 131, height: 48 },
    ios: { width: 107, height: 36.33, measuredUnderLocale: 'en-US' },
  },
  NitroUiPicker: {
    android: { width: 280, height: 56 },
    ios: { width: 72, height: 35 },
  },
  // One line of the body font: 22 pt on iOS, 24 dp on Android. The field fills its width,
  // so only the height is compared.
  NitroUiTextField: {
    android: { width: 200, height: 24 },
    ios: { width: 200, height: 22 },
  },
  // The search bar's own height: 56 dp on Android, 28 pt on iOS. The field fills its
  // width, so only the height is compared.
  NitroUiSearchField: {
    android: { width: 200, height: 56 },
    ios: { width: 200, height: 28 },
  },
  // Content-sized: the width is the label's, so a measured Chip is never compared with
  // these.
  NitroUiChip: {
    android: { width: 96, height: 48 },
    ios: { width: 80, height: 28 },
  },
  // The bare box of the default configuration: Material 3's 48 dp touch target on Android
  // and the `circle` glyph on iOS. The width grows with a label, so only the height is
  // compared.
  NitroUiCheckbox: {
    android: { width: 48, height: 48 },
    ios: { width: 26, height: 26 },
  },
  // The default configuration's box on both platforms, so the whole box is compared.
  NitroUiIconButton: {
    android: { width: 48, height: 48 },
    ios: { width: 44, height: 44 },
  },
  // Two fixed-width halves on both platforms: no range, step or label moves the box, so
  // the whole box is compared.
  NitroUiStepper: {
    android: { width: 104, height: 48 },
    ios: { width: 94, height: 32 },
  },
  // Fills its width, so only the height is compared: Material 3's 48 dp minimum row, and
  // SwiftUI's `.bordered` row (34.33 pt) rounded up so a cold frame is never short.
  NitroUiButtonGroup: {
    android: { width: 300, height: 48 },
    ios: { width: 300, height: 34.4 },
  },
  // Fills its width, so only the height is compared. The height is the title-only row's;
  // a row with a subtitle has another height, which is not declared here.
  NitroUiListItem: {
    android: { width: 300, height: 56 },
    ios: { width: 300, height: 52 },
  },
});

/**
 * Which axes of a control's measured box are compared with its declared fallback. A
 * `fillWidth` control's width is its parent's, and a content-sized control matches no
 * single size. A poisoned fallback has to move the same axes: the others never show a
 * correction.
 *
 * @param {string} hybridView
 * @param {Record<string, string>} sizingTable the generated `nitro-ui.sizing.json`
 * @returns {'both' | 'height' | 'none'}
 */
export function boxRuleFor(hybridView, sizingTable) {
  if (CONTENT_SIZED_BOX.includes(hybridView)) return 'none';
  if (HEIGHT_ONLY_FALLBACK.includes(hybridView)) return 'height';
  const policy = sizingTable[`Hybrid${hybridView}`];
  return policy === 'fillWidth' ? 'height' : 'both';
}

/**
 * Controls whose box is their content's, so no measured configuration matches their
 * declaration. A member must be `intrinsic`, and the harness suite fails a member whose
 * measured box equals its declaration after all.
 */
export const CONTENT_SIZED_BOX = Object.freeze([
  'NitroUiButton',
  // The trigger's width is its title's.
  'NitroUiMenu',
  // A chip is its label plus padding, and on Android a selected filter chip grows by its
  // check mark.
  'NitroUiChip',
]);

/**
 * Controls whose declaration describes only their height. A Checkbox is a fixed box plus
 * its label, so its width is the label's; unlike {@link CONTENT_SIZED_BOX}, its height is
 * still compared.
 */
export const HEIGHT_ONLY_FALLBACK = Object.freeze(['NitroUiCheckbox']);

/**
 * Rows two components may share because one platform constant decides both; any other
 * shared size fails {@link checkFallbackTable}. A row names the platform, the size and
 * exactly its owners.
 *
 * @type {ReadonlyArray<{ platform: 'ios' | 'android', size: string, owners:
 *   ReadonlyArray<string>, reason: string }>}
 */
export const SHARED_FALLBACK_ROWS = Object.freeze([
  {
    platform: 'android',
    size: '48x48',
    owners: ['NitroUiCheckbox', 'NitroUiIconButton'],
    reason:
      'both default boxes *are* material3\u2019s `MinInteractiveComponentSize` (48 dp), ' +
      'so the number is one platform constant read off two component sources, not one ' +
      'row copied from the other',
  },
]);

/**
 * Documentation only: nothing reads it. A build with a Swift compiler older than 6.2
 * declares 51×31 for the Switch while the table says 61×28, so that build's box comparison
 * reports a stale declaration.
 */
export const DECLARED_FALLBACK_EXCEPTIONS = Object.freeze([
  'NitroUiSwitch ios: 51x31 under Swift <6.2 (UINavigationBar API changed)',
]);

/**
 * A size no control declares, per platform, so a correction that arrives cannot be
 * mistaken for another control's number.
 *
 * @type {Readonly<Record<'ios'|'android', {width: number, height: number}>>}
 */
export const POISON_SIZES = Object.freeze({
  android: { width: 111, height: 13 },
  ios: { width: 97, height: 11 },
});

/** In dp or points. A whole pixel is a real difference; anything under it is rounding. */
export const SIZE_TOLERANCE_DP = 0.6;

/**
 * The generated sizing policy table, `nitro-ui.sizing.json`.
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
 * Everything the in-app suite needs, as one JSON document. `boxRules` is worked out here,
 * from the sizing policy, rather than by the suite that asserts them.
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

/** The region markers {@link checkSharedTableMirror} looks for in the harness file. */
export const SHARED_TABLE_BEGIN = 'BEGIN CONFORMANCE SHARED TABLE';
export const SHARED_TABLE_END = 'END CONFORMANCE SHARED TABLE';

/**
 * Checks that the harness file's mirror of {@link sharedInAppTable} equals that table. The
 * harness bundle cannot import this module, so its numbers are a checked copy.
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
 * Checks the fallback tables against the manifests and the sizing policy, with no device.
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
      const shared = SHARED_FALLBACK_ROWS.find(
        (row) =>
          row.platform === platform &&
          row.size === size &&
          row.owners.length === owners.length &&
          row.owners.every((owner) => owners.includes(owner))
      );
      if (shared != null) continue;
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
 * Checks that every name in {@link CONTENT_SIZED_BOX} is an `intrinsic` control.
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

/**
 * `en-US`, `en_US`, `en-US-POSIX` → `en-us`. Only language, script and region are kept: the
 * app reports no more than that about its locale, and the region is what changes a date.
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
 * Checks that the iOS launch locale the harness pins matches every locale a table row was
 * measured in, and that no Android row names a locale, since nothing pins the emulator's.
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

/* ------------------------------ the in-app fixtures -------------------------- */

/**
 * Checks the harness suite's fixture table against the manifests by scanning its text: the
 * harness file is a React Native module that Jest cannot load.
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
    // A component with no box must opt out of the sizing rules, and only it may.
    const optsOut = /\n {4}selfSizing: false,/.test(row.text);
    if (manifest.sizing == null && !optsOut) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: ${manifest.name} declares no sizing ` +
          'policy (sizing: null) and its fixture does not say `selfSizing: false`, so the ' +
          'suite would assert sizing rules about a control that never enters the engine'
      );
    }
    if (manifest.sizing != null && optsOut) {
      problems.push(
        `example/__tests__/Conformance.harness.tsx: the ${manifest.name} fixture says ` +
          `\`selfSizing: false\` and its manifest declares sizing "${String(manifest.sizing)}" ` +
          '- a self-sizing control cannot opt out of its fallback and leak rules'
      );
    }
    // Each row needs a recycle probe, or a stated reason it has none.
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

  // The reverse: a row for a control that no longer exists.
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
 * Each fixture's recycle verdict, by control name, read out of the harness's fixture table.
 * Returns `{}` when the table cannot be found; {@link checkInAppFixtures} reports that.
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
 * One fixture row's recycle verdict. A reason written as a `+`-joined string literal is
 * collapsed into one sentence.
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
  // Prettier puts the value on the line after its key, so any whitespace may follow the
  // colon.
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
 * Checks that the fixtures' recycle notes and the exemption rows agree: every `blindSpot`
 * has a row, and every row's control has a fixture whose note is a `blindSpot`.
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
          'debt row, not a note in a fixture: add the row'
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
 * The FIXTURES table, parsed into rows of `{ name, component, text }`. Rows and members
 * are matched as whole lines at their own indent, so a mention in a comment or a nested
 * object is not one. Returns `null` when the table is not in that shape.
 *
 * @param {string} harnessText
 * @returns {Array<{name: string, component: string | null, text: string}> | null}
 */
function fixtureRows(harnessText) {
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
    // A row with no `name` member is named after its first member rather than `undefined`.
    return {
      name: name ?? String(text.match(/^ {4}\S[^:\n]*:/m)?.[0] ?? '(no name)'),
      component: component ?? null,
      text,
    };
  });
}

/**
 * The `component|rule` keys the exemption lists mark as failing, in the matrix's keys. An
 * a11y exemption is keyed on a case id and one component can have several cases; they
 * collapse to one cell per component here.
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

/* ---------------------------------- coverage --------------------------------- */

/**
 * The rule × control matrix: every cell is `covered`, `failing` (asserted, with an
 * exemption) or `not-applicable` with a stated reason.
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
 * Checks that every rule has a verdict for every manifest.
 *
 * @param {any[]} manifests
 * @param {ReturnType<typeof coverageMatrix>} matrix
 * @returns {string[]} problems
 */
export function checkCoverage(manifests, matrix) {
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
      }
    }
  }
  return problems;
}

/* --------------------------------- the readers --------------------------------- */

/**
 * The repo's manifests, through the loader the registry generator uses.
 *
 * @param {(path: string) => string | null} [readFile] a fake, for a test
 * @param {string[]} [directories] the component directory names, when the reader is a fake
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
      // primitive).
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
