/**
 * The conformance suite: four rules, run over every control in the registry.
 *
 * This is the in-app half of task X4. Three of the four rules are asserted here, for
 * every self-sizing control, from one parameterised suite rather than seven hand-written
 * ones; the fourth — the accessibility name on the node a person can act on — is asserted
 * here on iOS and, on Android, from the host inside `real-input:android`
 * (`scripts/real-input/a11y.mjs`), because a test process on Android cannot see a Compose
 * control's name at all: the harness queries match `View.contentDescription` and Compose
 * publishes `SemanticsNode`s that are not Views. `Slider.harness.tsx` and
 * `Progress.harness.tsx` already say so where they hit the same wall, so this file does not
 * pretend otherwise: it asserts the iOS half and, on Android, prints where the rule runs.
 *
 * ## Why a suite instead of seven tests
 *
 * Every one of these bug classes was caught late in review because the check for it existed
 * for one control and not for the others (`docs/tasks/PROCESS-review-2026-10-26.md` §1: fix
 * rounds cost 44 % of implementer time). The rules and tables live in
 * `scripts/conformance-core.mjs`, driven by the registry's own manifests, and
 * `scripts/__tests__/component-coverage.test.js` asserts this file has one fixture per
 * manifest — so 0.4's Menu is covered the day it gets a `component.json`, and the day
 * before that `check` is red on a machine with no device.
 *
 * ## Why the table below is a mirror, and not an import
 *
 * No harness suite imports anything from `scripts/` (nothing in `example/__tests__/` does
 * today), so the shared numbers are embedded as JSON in the marked region and
 * `checkSharedTableMirror` asserts that region equals `sharedInAppTable()` on every
 * `bun run check`. That is what stops this file from asserting against its own copy of the
 * answer — the tautology AGENTS.md rules out ("test fixtures must not coincide with the
 * right answer"), which is otherwise exactly what a duplicated table becomes.
 *
 * ## What makes these able to fail
 *
 * Each rule body is shown red in `scripts/__tests__/conformance.test.js` against the pure
 * decision function, and each has a device-side counterpart here that is not satisfied by
 * the same number twice:
 *
 * - the fallback rule compares the control's measured size with a table written from the
 *   component's source, then **poisons** the engine's guess with a size no control declares
 *   and requires a correction to arrive. `Button.harness.tsx` explains the precedent for
 *   why, at its own poison helper: a declared fallback that is close to the truth makes
 *   every "the box was right" assertion pass even when no correction ever happens.
 * - the leak rule takes its baseline *after* a warm-up mount, so the component's own
 *   registry row cannot be counted as a leak — the mistake that would get the rule exempted
 *   the first time it was green-ish for the wrong reason.
 * - the recycle rule asserts each property against the props of the control's *second*
 *   owner, so a value that stayed behind names itself.
 *
 * ## The recycle rule's limitation, stated rather than hidden
 *
 * `enableViewRecycling` is off in this app — it appears nowhere in `src/` or `example/`, and
 * `FOLLOWUPS.md` B1 lists "recycling path has no leak gate" as still open — so Android's
 * real `prepareForRecycle` is not reached. What this asserts is the identity a list gives a
 * control: one `testID`, a second owner's props, and nothing from the first owner visible in
 * what the control says about itself. That is the case a component can get wrong today; when
 * recycling is switched on the same fixture becomes the real path with no change to the
 * assertions, and the rule is named for what it measures.
 *
 * @file Gates: `harness:ios`, `harness:android`. Discovered automatically:
 *       `example/jest.harness.config.mjs` matches any `*.harness.tsx` under a
 *       `__tests__` directory, so nothing here needed registering.
 */
import type { ReactElement } from 'react';
import { Platform, TurboModuleRegistry } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  Button,
  DatePicker,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/**
 * BEGIN CONFORMANCE SHARED TABLE
 *
 * Emitted by `sharedInAppTable()` in `scripts/conformance-core.mjs` and checked
 * against it by `checkSharedTableMirror` on every `bun run check`, so a number
 * changed here without being changed there fails `check` rather than passing a
 * wrong assertion. The region is JSON — that is what makes it checkable as text —
 * so no type annotation, comment or expression may go inside it, and the
 * `prettier-ignore` below stays: the formatter quotes object keys, and quoted-out
 * keys are no longer JSON. Regenerate the whole block with
 * `node scripts/conformance/print-shared-table.mjs --write`.
 */
// prettier-ignore
const SHARED = {
  "declaredFallbacks": {
    "NitroUiSwitch": {
      "android": {
        "width": 52,
        "height": 48
      },
      "ios": {
        "width": 61,
        "height": 28
      }
    },
    "NitroUiSlider": {
      "android": {
        "width": 328,
        "height": 48
      },
      "ios": {
        "width": 351,
        "height": 31
      }
    },
    "NitroUiButton": {
      "android": {
        "width": 91,
        "height": 48
      },
      "ios": {
        "width": 77,
        "height": 35
      }
    },
    "NitroUiProgress": {
      "android": {
        "width": 320,
        "height": 4
      },
      "ios": {
        "width": 320,
        "height": 4
      }
    },
    "NitroUiSegmentedControl": {
      "android": {
        "width": 256,
        "height": 48
      },
      "ios": {
        "width": 165,
        "height": 31
      }
    },
    "NitroUiDatePicker": {
      "android": {
        "width": 131,
        "height": 48
      },
      "ios": {
        "width": 103,
        "height": 36.33
      }
    },
    "NitroUiPicker": {
      "android": {
        "width": 280,
        "height": 56
      },
      "ios": {
        "width": 72,
        "height": 35
      }
    }
  },
  "poisonSizes": {
    "android": {
      "width": 111,
      "height": 13
    },
    "ios": {
      "width": 97,
      "height": 11
    }
  },
  "tolerance": 0.6,
  "boxRules": {
    "NitroUiSwitch": "both",
    "NitroUiSlider": "height",
    "NitroUiButton": "none",
    "NitroUiProgress": "height",
    "NitroUiSegmentedControl": "both",
    "NitroUiDatePicker": "both",
    "NitroUiPicker": "both"
  },
  "exemptions": []
};
/** END CONFORMANCE SHARED TABLE */

/** The in-app view of {@link SHARED}, typed; the table itself stays JSON so it is checkable. */
type Exemption = {
  component: string;
  rule: string;
  followups: string;
  detail: string;
};
const EXEMPTIONS = SHARED.exemptions as ReadonlyArray<Exemption>;

/* --------------------------------- the seams --------------------------------- */

type Size = { width: number; height: number };
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What a control's `hybridRef` hands back.
 *
 * Declared here rather than imported: DECISIONS D14 keeps Hybrid View types off the public
 * surface, and every field below is one the real handles all have — `accessibilityLabel`
 * and `measureContent()` on all seven, the value fields on the ones that have a value to
 * report. Optional because a control that has no `selectedIndex` reports no field, and the
 * recycle rule must not invent one.
 */
type Handle = {
  readonly accessibilityLabel: string | null;
  readonly value?: boolean | number | null;
  readonly selectedIndex?: number | null;
  measureContent(): Size;
};

/** A `hybridRef` callback per testID, so one `render` can hand several controls out. */
const handles = new Map<string, Handle>();
const captureFor =
  (testId: string) =>
  (handle: Handle): void => {
    handles.set(testId, handle);
  };

function handleFor(testId: string): Handle {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(
      `no hybridRef handle for "${testId}" — the control never handed back its own ` +
        'state, so nothing here can ask it what it is'
    );
  }
  return handle;
}

function stats(): NitroUiSizingStats {
  return nitroUiCore.sizingStats();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Let queued corrections land before reading counters that move on a later turn. */
async function settle(ms = 350): Promise<void> {
  await sleep(ms);
}

function describeBox(box: Size | ViewInfo | null): string {
  return box == null
    ? 'null'
    : `${box.width.toFixed(1)}x${box.height.toFixed(1)}`;
}

/** Corrections issued since `before` was read, so the number is this mount's. */
function correctionsSince(before: NitroUiSizingStats): number {
  const now = stats();
  return Math.max(
    0,
    now.correctionsImmediate -
      before.correctionsImmediate +
      (now.correctionsBatched - before.correctionsBatched)
  );
}

const PLATFORM = Platform.OS === 'ios' ? 'ios' : 'android';

/**
 * Every `render` in this file, for the reason every other harness suite gives it.
 *
 * `react-native-harness` rejects with "Render timeout: Element did not mount within 1000ms"
 * unless a suite says otherwise, and the first cold mount of a native view on an emulator can
 * exceed that on its own — the Android run went red on exactly that, at load1 11, on a control
 * that had nothing wrong with it. 20 s is what `Button.harness.tsx` and
 * `MountChurn.harness.tsx` pass; the value is a budget for the *mount*, not for the
 * measurement, and the wall-clock assertions below still have their own tighter gates.
 */
const RENDER = { timeout: 20000 } as const;

/* ------------------------------ the rule bodies ------------------------------ */
/* Mirrors of `fallbackFindings`, `leakFindings` and `recycleFindings` in
 * `scripts/conformance-core.mjs`: the harness cannot import a Node module, so the wording
 * is duplicated and the *tables* are not — they are the mirror above. The originals are
 * driven line by line in `scripts/__tests__/conformance.test.js`, which is where a
 * divergence between the two halves is caught. */

type Finding = { component: string; rule: string; problem: string };

function near(a: Size, b: Size, tolerance: number): boolean {
  return (
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function fmt(size: Size | null): string {
  return size == null
    ? 'nothing'
    : `${String(size.width)}x${String(size.height)}`;
}

/**
 * Rule 1: is the fallback the control's own, and does a wrong guess still get corrected?
 *
 * @param input.declared what the engine reports for the control (`null` = nothing
 *   registered). JS cannot read the number, only whether one exists, so the caller passes
 *   `expected` when `hasDeclaredFallback` said yes and `null` when it said no.
 * @param input.boxRule which axes the declaration describes — from the mirrored table,
 *   never worked out here. See `boxRuleFor` in `scripts/conformance-core.mjs` for why a
 *   `fillWidth` control's width and a content-sized control's box are not its declaration.
 */
function fallbackFindings(input: {
  component: string;
  declared: Size | null;
  measured: Size | null;
  corrections: number;
  poisoned: boolean;
  expected: Size;
  boxRule: 'both' | 'height' | 'none';
}): Finding[] {
  const {
    component,
    declared,
    measured,
    corrections,
    poisoned,
    expected,
    boxRule,
  } = input;
  const tolerance = SHARED.tolerance;
  const poisonedSize = SHARED.poisonSizes[PLATFORM];
  const problems: Finding[] = [];
  const report = (problem: string): void => {
    problems.push({ component, rule: 'declared-fallback', problem });
  };
  const ownsAgrees = (actual: Size, want: Size): boolean => {
    if (Math.abs(actual.height - want.height) > tolerance) return false;
    if (boxRule === 'both') {
      return Math.abs(actual.width - want.width) <= tolerance;
    }
    return true;
  };

  if (declared == null) {
    report(
      'the engine knows no declared fallback, so a cold mount falls to the `0x0` ' +
        'branch and is force-laid-out — the frame the first frame lies about'
    );
  }
  if (measured == null) {
    report('a warm mount settled at nothing, so there is no size to compare');
    return problems;
  }
  if (poisoned && near(measured, poisonedSize, tolerance)) {
    report(
      `settled at the poisoned ${fmt(poisonedSize)} — the guess was never corrected, and ` +
        'every cold mount of this control is laid out at a size it never declared'
    );
    return problems;
  }
  if (boxRule === 'none') {
    if (near(measured, expected, tolerance)) {
      report(
        `this control is exempt from the box comparison as content-sized, and it ` +
          `settled at its own declared ${fmt(expected)} anyway — a control that ` +
          'always measures its declared size is not sizing itself from its content, ' +
          'so the exemption is no longer true'
      );
    }
  } else if (!ownsAgrees(measured, expected)) {
    report(
      `the fallback ${fmt(expected)} is not the measured ${fmt(measured)} for a ` +
        (boxRule === 'height'
          ? 'control whose own axis is its height (its width is its parent’s)'
          : 'control that declares its size') +
        ' — a mismatch means the declaration drifted from the component'
    );
  }
  if (!poisoned && corrections > 0 && boxRule === 'both') {
    report(
      `needed ${String(corrections)} correction(s) from a warm engine whose ` +
        `fallback ${fmt(expected)} already describes this control’s whole box — ` +
        'the declaration is not reaching the engine'
    );
  }
  if (poisoned && corrections === 0) {
    report(
      `settled at ${fmt(measured)} with no correction, having been poisoned to ` +
        `${fmt(poisonedSize)} — that size can only have come from the component, so the ` +
        'correction went missing while the ledger stayed quiet'
    );
  }
  return problems;
}

/**
 * Rule 2: did the engine's bookkeeping return to baseline after every instance dropped?
 *
 * `baseline` is taken after a warm-up mount, so the component's own registry row is already
 * in it and cannot be mistaken for a leak.
 */
function leakFindings(input: {
  component: string;
  baseline: NitroUiSizingStats;
  after: NitroUiSizingStats;
  instances: number;
}): Finding[] {
  const problems: Finding[] = [];
  const report = (problem: string): void => {
    problems.push({
      component: input.component,
      rule: 'no-leak-on-drop',
      problem,
    });
  };
  const ledger = input.after.ledgerEntries - input.baseline.ledgerEntries;
  const registry = input.after.registryEntries - input.baseline.registryEntries;
  if (ledger !== 0) {
    report(
      `${String(ledger)} ledger entry(ies) survived ${String(
        input.instances
      )} drops — each missing ` +
        '`NitroUiSizing::forget(sizing_.get())` pair in `onDropView` shows up here, and ' +
        'a handle keeps the view alive, so the leaked entry is the leak'
    );
  }
  if (registry > 0) {
    report(
      `the registry grew by ${String(registry)} across ${String(
        input.instances
      )} mounts of an already-registered component — per-instance state in a ` +
        'process-wide table is the shape of a leak the engine cannot see either'
    );
  }
  return problems;
}

/** Rule 3: does the control show any of its previous owner's props? */
function recycleFindings(input: {
  component: string;
  identity: string;
  checks: ReadonlyArray<{ label: string; expected: unknown; actual: unknown }>;
}): Finding[] {
  const problems: Finding[] = [];
  for (const check of input.checks) {
    if (check.actual === check.expected) continue;
    problems.push({
      component: input.component,
      rule: 'recycle-reset',
      problem:
        `${input.identity} kept its identity across lifetimes and ${check.label} ` +
        `reads ${String(check.actual)} where the props say ${String(
          check.expected
        )} — the view came back wearing its previous owner`,
    });
  }
  return problems;
}

/**
 * Print debt, fail on anything new. The one report every rule shares, and the reason an
 * exemption is visible in the run rather than only in a source file.
 */
function expectConformance(findings: Finding[]): void {
  const failures: string[] = [];
  for (const finding of findings) {
    const exemption = EXEMPTIONS.find(
      (row) => row.component === finding.component && row.rule === finding.rule
    );
    if (exemption == null) {
      failures.push(
        `${finding.component} × ${finding.rule}: ${finding.problem}`
      );
      continue;
    }
    console.log(
      `    · known failing (${exemption.followups}): ${finding.component} × ` +
        `${finding.rule}: ${finding.problem}`
    );
  }
  expect(failures).toEqual([]);
}

/* ------------------------------- the shared tables --------------------------- */

/**
 * Does the engine have a declared fallback for this control?
 *
 * `prewarmSizing` returns how many of the names it was given had one registered, so `1` is
 * the engine saying "the startup table registered a size for this control" and `0` is it
 * saying nobody did. That is the only way to ask from JS, and it is why this rule does not
 * depend on `ColdSizing.harness.tsx`'s process-ordering contract: the answer comes from the
 * registry, so it does not change when another suite has already mounted the control.
 */
function hasDeclaredFallback(component: string): boolean {
  return nitroUiCore.prewarmSizing([component]) === 1;
}

/**
 * Plant a size no control declares, so being right requires correcting it.
 *
 * `seedSizingSize` also *writes* the declared fallback (`ColdSizing.harness.tsx:288-292`
 * says so because it matters there), so poisoning is a process-wide act and must be undone:
 * the harness resets the JS runtime between files, not the native engine.
 */
function poison(component: string): void {
  const size = SHARED.poisonSizes[PLATFORM];
  nitroUiCore.seedSizingSize(component, '', size.width, size.height);
  nitroUiCore.invalidateSizingEnvironment();
}

/**
 * Put the declared fallback back, exactly.
 *
 * Exact because the suite's own first assertion is that the engine's fallback equals
 * `SHARED.declaredFallbacks`, and that table is checked against
 * `scripts/conformance-core.mjs` on every `check` — so a restored number cannot be a wrong
 * number the rest of the process then quietly trusts.
 */
function restore(component: string): void {
  const declared =
    SHARED.declaredFallbacks[
      component as keyof typeof SHARED.declaredFallbacks
    ];
  if (declared == null) return;
  const size = declared[PLATFORM];
  nitroUiCore.seedSizingSize(component, '', size.width, size.height);
  nitroUiCore.invalidateSizingEnvironment();
}

function declaredFallback(component: string): Size {
  const table = SHARED.declaredFallbacks as Record<
    string,
    Record<'ios' | 'android', Size>
  >;
  const entry = table[component];
  if (entry == null) {
    throw new Error(
      `no DECLARED_FALLBACKS row for ${component} on ${PLATFORM}, so every ` +
        'assertion about this control’s fallback would be vacuous'
    );
  }
  return entry[PLATFORM];
}

/**
 * Which axes this control's declaration describes, from the mirrored table.
 *
 * A missing entry throws rather than defaulting: `boxRules` is generated from the same keys
 * as `declaredFallbacks`, so its absence means the mirror is stale, and silently choosing
 * the strict rule would turn a broken table into a false red on the control.
 */
function boxRuleFor(component: string): 'both' | 'height' | 'none' {
  const rule = (SHARED.boxRules as Record<string, string>)[component];
  if (rule !== 'both' && rule !== 'height' && rule !== 'none') {
    throw new Error(
      `no boxRules row for ${component} — regenerate the shared table with ` +
        '`node scripts/conformance/print-shared-table.mjs --write`'
    );
  }
  return rule;
}

/* ------------------------------ the control table ---------------------------- */
/* One fixture per control the registry declares. `component-coverage.test.js` asserts this
 * list has exactly one row per manifest in `src/components`, which is what makes a new
 * control a *failing test* rather than an untested control.
 *
 * `owner(second)` is how the recycle rule hands one testID to a second owner, and `state`
 * reads what the control says about itself afterwards — through `hybridRef`, because that is
 * the control's own answer rather than a React-side copy of the props. */

type Fixture = {
  /** The manifest `name`, which is also the key the tables use. */
  name: string;
  /** The Fabric name: what the sizing engine files sizes under. */
  component: string;
  /** The `accessibilityLabel` the first owner sends, and the a11y rule looks for. */
  label: string;
  /** The same control's identity in both lifetimes. */
  testId: string;
  /** One owner's element. Every prop is always passed: nitro#1184. */
  owner: (second: boolean) => ReactElement;
  /** What the control reports about itself, for the recycle rule. */
  state: (
    handle: Handle,
    second: boolean
  ) => Array<{ label: string; expected: unknown; actual: unknown }>;
};

const SECOND = 'second owner';

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: 'Switch',
    component: 'NitroUiSwitch',
    label: 'Conformance switch',
    testId: 'conformance-switch',
    owner: (second) => (
      <Switch
        value={second}
        testID="conformance-switch"
        accessibilityLabel={
          second ? `Conformance switch, ${SECOND}` : 'Conformance switch'
        }
        hybridRef={captureFor('conformance-switch')}
      />
    ),
    state: (handle, second) => [
      { label: 'value', expected: second, actual: handle.value },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance switch, ${SECOND}`
          : 'Conformance switch',
        actual: handle.accessibilityLabel,
      },
    ],
  },
  {
    name: 'Slider',
    component: 'NitroUiSlider',
    label: 'Conformance slider',
    testId: 'conformance-slider',
    owner: (second) => (
      <Slider
        value={second ? 0.75 : 0.25}
        testID="conformance-slider"
        accessibilityLabel={
          second ? `Conformance slider, ${SECOND}` : 'Conformance slider'
        }
        hybridRef={captureFor('conformance-slider')}
      />
    ),
    state: (handle, second) => [
      { label: 'value', expected: second ? 0.75 : 0.25, actual: handle.value },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance slider, ${SECOND}`
          : 'Conformance slider',
        actual: handle.accessibilityLabel,
      },
    ],
  },
  {
    name: 'Button',
    component: 'NitroUiButton',
    label: 'Conformance button',
    testId: 'conformance-button',
    owner: (second) => (
      <Button
        title={second ? 'Second' : 'First'}
        testID="conformance-button"
        accessibilityLabel={
          second ? `Conformance button, ${SECOND}` : 'Conformance button'
        }
        hybridRef={captureFor('conformance-button')}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance button, ${SECOND}`
          : 'Conformance button',
        actual: handle.accessibilityLabel,
      },
    ],
  },
  {
    name: 'Progress',
    component: 'NitroUiProgress',
    label: 'Conformance progress',
    testId: 'conformance-progress',
    owner: (second) => (
      <Progress
        value={second ? 0.8 : 0.2}
        testID="conformance-progress"
        accessibilityLabel={
          second ? `Conformance progress, ${SECOND}` : 'Conformance progress'
        }
        hybridRef={captureFor('conformance-progress')}
      />
    ),
    state: (handle, second) => [
      { label: 'value', expected: second ? 0.8 : 0.2, actual: handle.value },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance progress, ${SECOND}`
          : 'Conformance progress',
        actual: handle.accessibilityLabel,
      },
    ],
  },
  {
    name: 'SegmentedControl',
    component: 'NitroUiSegmentedControl',
    label: 'Conformance segmented',
    testId: 'conformance-segmented',
    owner: (second) => (
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={second ? 2 : 0}
        testID="conformance-segmented"
        accessibilityLabel={
          second ? `Conformance segmented, ${SECOND}` : 'Conformance segmented'
        }
        hybridRef={captureFor('conformance-segmented')}
      />
    ),
    state: (handle, second) => [
      {
        label: 'selectedIndex',
        expected: second ? 2 : 0,
        actual: handle.selectedIndex,
      },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance segmented, ${SECOND}`
          : 'Conformance segmented',
        actual: handle.accessibilityLabel,
      },
    ],
  },
  {
    name: 'DatePicker',
    component: 'NitroUiDatePicker',
    label: 'Conformance date picker',
    testId: 'conformance-date-picker',
    owner: (second) => (
      <DatePicker
        value={new Date(second ? 1735700000000 : 1735600000000)}
        testID="conformance-date-picker"
        accessibilityLabel={
          second
            ? `Conformance date picker, ${SECOND}`
            : 'Conformance date picker'
        }
        hybridRef={captureFor('conformance-date-picker')}
      />
    ),
    state: (handle, second) => [
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance date picker, ${SECOND}`
          : 'Conformance date picker',
        actual: handle.accessibilityLabel,
      },
    ],
  },
  {
    name: 'Picker',
    component: 'NitroUiPicker',
    label: 'Conformance picker',
    testId: 'conformance-picker',
    owner: (second) => (
      <Picker
        options={['One', 'Two', 'Three']}
        selectedIndex={second ? 2 : 0}
        testID="conformance-picker"
        accessibilityLabel={
          second ? `Conformance picker, ${SECOND}` : 'Conformance picker'
        }
        hybridRef={captureFor('conformance-picker')}
      />
    ),
    state: (handle, second) => [
      {
        label: 'selectedIndex',
        expected: second ? 2 : 0,
        actual: handle.selectedIndex,
      },
      {
        label: 'accessibilityLabel',
        expected: second
          ? `Conformance picker, ${SECOND}`
          : 'Conformance picker',
        actual: handle.accessibilityLabel,
      },
    ],
  },
];

/** Mounts per control in the leak fixture. */
const CHURN = 50;

afterEach(() => {
  cleanup();
  handles.clear();
});

/* ---------------------------------- the suite --------------------------------- */

describe('conformance · every control, four rules', () => {
  for (const fixture of FIXTURES) {
    describe(`· ${fixture.name}`, () => {
      const expected = declaredFallback(fixture.component);
      // From the mirrored table, because which axes a control's declaration describes is a
      // host-side fact about its sizing policy — the suite that asserts does not get to
      // decide it. See `boxRuleFor` in scripts/conformance-core.mjs.
      const boxRule = boxRuleFor(fixture.component);

      it('has its own declared fallback, and still corrects a wrong guess', async () => {
        // 1. The engine knows a fallback at all. `prewarmSizing` answers from the
        //    registry, so this is the half a warm process cannot fake.
        const registered = hasDeclaredFallback(fixture.component);

        // 2. Poisoned mount, first: the correction has to arrive, and the box that results
        //    has to be the declared one. Done before the warm case so the seed cannot be
        //    masked by a cached answer the warm mount would have left behind.
        try {
          poison(fixture.component);
          const coldBefore = stats();
          const cold = await render(fixture.owner(false), RENDER);
          await settle(600);
          const coldMeasure = handleFor(fixture.testId).measureContent();
          const coldBox = harnessUi.queryByTestId(fixture.testId);
          const coldCorrections = correctionsSince(coldBefore);
          console.log(
            `    · poisoned measured=${describeBox(coldMeasure)} box=` +
              `${describeBox(coldBox)} corrections=${String(coldCorrections)} ` +
              `poison=${describeBox(SHARED.poisonSizes[PLATFORM])}`
          );
          expectConformance(
            fallbackFindings({
              component: fixture.name,
              declared: registered ? expected : null,
              measured: coldMeasure,
              corrections: coldCorrections,
              poisoned: true,
              expected,
              boxRule,
            })
          );
          cold.unmount();
        } finally {
          restore(fixture.component);
        }
        await settle();

        // 3. Warm. For a control whose declaration describes its whole box, the declared
        //    number *is* the measured one and nothing has to be corrected — the assertion a
        //    poisoned fallback cannot satisfy and a stale declaration cannot either. For a
        //    `fillWidth` or content-sized control the box it settles at is its parent's or
        //    its content's, so `boxRule` narrows the comparison and this run only reports a
        //    finding if a correction was needed where the declaration should have made it
        //    unnecessary.
        const warmBefore = stats();
        const warm = await render(fixture.owner(false), RENDER);
        await settle(600);
        const warmMeasure = handleFor(fixture.testId).measureContent();
        console.log(
          `    · warm measured=${describeBox(warmMeasure)} declared=${describeBox(expected)} ` +
            `boxRule=${boxRule}`
        );
        expectConformance(
          fallbackFindings({
            component: fixture.name,
            declared: registered ? expected : null,
            measured: warmMeasure,
            corrections: correctionsSince(warmBefore),
            poisoned: false,
            expected,
            boxRule,
          })
        );
        warm.unmount();
      });

      it('leaves the engine where it started after N mounts and drops', async () => {
        // Warm-up first: the component's own registry row is created by the first measure,
        // not by a drop, so a baseline taken before it would count one legitimate entry as
        // a leak — and the first green-ish run of a wrongly-based rule is how a rule gets
        // exempted for the wrong reason.
        const warmUp = await render(fixture.owner(false), RENDER);
        await settle();
        warmUp.unmount();
        await settle(500);

        const baseline = stats();
        for (let cycle = 0; cycle < CHURN; cycle += 1) {
          const mounted = await render(fixture.owner(cycle % 2 === 1), RENDER);
          mounted.unmount();
        }
        await settle(700);
        const after = stats();
        console.log(
          `    · ledger ${String(baseline.ledgerEntries)}→` +
            `${String(after.ledgerEntries)} registry ${String(
              baseline.registryEntries
            )}→${String(after.registryEntries)} cached ${String(
              baseline.cachedSizes
            )}→${String(after.cachedSizes)} across ${String(CHURN)} mounts`
        );
        expectConformance(
          leakFindings({
            component: fixture.name,
            baseline,
            after,
            instances: CHURN,
          })
        );
      });

      it('shows none of its previous owner under one identity', async () => {
        const first = await render(fixture.owner(false), RENDER);
        await settle();
        const firstChecks = fixture.state(handleFor(fixture.testId), false);
        expect(
          recycleFindings({
            component: fixture.name,
            identity: 'first owner',
            checks: firstChecks,
          })
        ).toEqual([]);
        first.unmount();
        await settle(400);

        const second = await render(fixture.owner(true), RENDER);
        await settle();
        const checks = fixture.state(handleFor(fixture.testId), true);
        console.log(
          `    · ${fixture.testId} after the second owner: ` +
            checks
              .map((check) => `${check.label}=${String(check.actual)}`)
              .join(' ')
        );
        expectConformance(
          recycleFindings({
            component: fixture.name,
            identity: `testID "${fixture.testId}"`,
            checks,
          })
        );
        second.unmount();
      });

      it('is named on its own box, not on a wrapper around it', async () => {
        const mounted = await render(fixture.owner(false), RENDER);
        await settle();
        const box = harnessUi.queryByTestId(fixture.testId);
        const labelled = harnessUi.queryByAccessibilityLabel(fixture.label);
        if (PLATFORM !== 'ios') {
          // The honest Android statement, from the suites that already make it: the harness
          // walks `View.contentDescription`, Compose publishes `SemanticsNode`s, and so
          // nothing in-process can see the name however well the component behaves. The
          // rule runs from the host against the accessibility tree instead.
          console.log(
            `    · Android: the in-app a11y query cannot see a Compose control's ` +
              `name (labelBox=${describeBox(labelled)}) — this rule is asserted by ` +
              'real-input:android, see scripts/real-input/a11y.mjs'
          );
          expect(box).not.toBeNull();
          mounted.unmount();
          return;
        }
        console.log(
          `    · box=${describeBox(box)} labelBox=${describeBox(labelled)}`
        );
        expect(box).not.toBeNull();
        expect(labelled).not.toBeNull();
        // The box comparison is the rule. "Some node carries the label" is also true of a
        // wrapper, and a wrapper is the bug; a node whose box *is* the control's is a name
        // the person can act on.
        expect(Math.abs(labelled!.width - box!.width)).toBeLessThan(2);
        expect(Math.abs(labelled!.height - box!.height)).toBeLessThan(2);
        expect(handleFor(fixture.testId).accessibilityLabel).toBe(
          fixture.label
        );
        mounted.unmount();
      });
    });
  }
});
