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
 * ## The recycle rule, and what it can reach on each platform
 *
 * The two platforms do not run the same code here, and round 1 of this file had it backwards.
 *
 * - **iOS recycles by default.** Nitrogen reports each of our views as recyclable when it
 *   implements `RecyclableView` (`NitroUiAutolinking.swift:71`), which all seven do, and
 *   nothing overrides that — so Fabric's registry enqueues the instance on unmount, calling
 *   `prepareForRecycle` as it does (`RCTComponentViewRegistry.mm:117`), and dequeues it for
 *   the next mount of that component (`:95`). The reset is live code on this platform, which
 *   is why the residue probes below are real tests on iOS and not only on paper.
 * - **Android does not reach it.** Nitro's generated manager wires recycling up and would call
 *   `prepareForRecycle` from `prepareToRecycleView`, but that method is a legacy-architecture
 *   hook: its only caller is `ViewManager.recycleView` (`ViewManager.java:269`), and Fabric's
 *   Android mounting layer calls `onDropViewInstance` and nothing else
 *   (`SurfaceMountingManager.kt:1060`). So `onDropView` runs on Android and `prepareForRecycle`
 *   does not — `FOLLOWUPS.md` B1's "recycling path has no leak gate" is that gap, and
 *   `docs/tasks/B1-android-mount-oom.report.md` is where `onDropView` is proved instead.
 *
 * Consequence for this suite, stated plainly: the residue probes can only go red on iOS, and
 * on Android the rule's failure mode is a prop that stops arriving. Both halves run on both
 * platforms, and `checkInAppFixtures` insists every control has a probe or a written reason it
 * cannot have one, so the list of unprovable controls cannot grow by omission.
 *
 * @file Gates: `harness:ios`, `harness:android`. Discovered automatically:
 *       `example/jest.harness.config.mjs` matches any `*.harness.tsx` under a
 *       `__tests__` directory, so nothing here needed registering.
 */
import type { ReactElement } from 'react';
import { Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
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
  /**
   * The Slider's own answer to "what value is showing, and what happened when a reader
   * acted on it" — `performed accessibilityIncrement on <node> <from>-><to> disabled=<bool>`,
   * numbered `#n` on Android. The recycle rule's oracle for this control, because it is the
   * one number that comes from the view rather than from React's last write: the `value`
   * getter above returns `model.state.js` (`HybridNitroUiSlider.swift:693`), which is what
   * React sent, so it cannot show what the reset owns.
   */
  nuiTestAccessibilityStep?(direction: number): void;
  nuiTestAccessibilityStepReport?(): string;
  /**
   * Picker's report — `expanded=<0|1>;live=<n>;…`. `live` is how many menus the platform
   * believes this control has open, which is state the reset owns and no prop rewrites.
   */
  nuiTestMenuReport?(): string;
  /**
   * DatePicker's report — its displayed instant plus whether a presentation is open, both
   * from the view. `nuiTestSelect(...)` drives a selection through the control's own path,
   * which is what leaves residue for a reset to clear.
   */
  nuiTestStateReport?(): string;
  /** Opens the DatePicker's own presentation — the other thing a dropped mount can leak. */
  nuiTestPresent?(): void;
  /**
   * Drive a selection through the control's own path. Two arities because two controls share
   * the hook name: `Picker` names an index (`HybridNitroUiPicker.swift:544`), `DatePicker`
   * names a year/month/day/hour/minute, and this is one handle type for all seven controls.
   */
  nuiTestSelect?(...fields: number[]): void;
  /** Progress's displayed fraction, as the view draws it, plus its animation flag. */
  nuiTestDisplayedValue?(): string;
};

/**
 * The recycle rule's per-control oracle, and the honest answer to what round 1 asserted.
 *
 * A recycled control's **props cannot show residue**, on either platform, for reasons two
 * layers above ours:
 *
 * - Fabric hands a recycled instance its props as a *fresh mount* - the Insert mutation calls
 *   `updateProps:newProps oldProps:nil` (`RCTMountingManager.mm:83`) - so the generated
 *   setters run for every provided prop (`HybridNitroUiSwitchComponent.mm:84`:
 *   `oldViewProps == nullptr ? prop.isProvided() : ...`).
 * - and our wrappers always provide: every prop is sent, `null` included (`Switch.tsx:145-151`),
 *   and a callback the app did not pass is sent as a stable no-op *specifically* so a recycled
 *   view cannot keep the previous owner's handler (`Button.tsx:99-110`).
 *
 * So `model.accessibilityLabel = nil` in a reset is a safety line, not an observable one: the
 * next mount writes that field either way, which is exactly why deleting it left round 1's rule
 * green and the review called the rule unable to fail. What a reset *uniquely* owns is state no
 * prop rewrites - the **displayed value**, the handshake's **event counts**, and the
 * `didApplyDefault` one-shot. Only an *interaction* produces that state, and only a control's
 * own read-out shows it: the handle's `value` returns `model.state.js`
 * (`HybridNitroUiSlider.swift:693`), which is what React sent, not what is drawn.
 *
 * A probe therefore owns both lifetimes: it leaves residue behind on purpose, mounts a second
 * owner whose props are all defaults, and asks the control the one question only its own state
 * can answer. A control with no such question says so in the run rather than banking a pass
 * from a check that could not have failed - and `component-coverage.test.js` insists each
 * control has either a probe or that note, so the list of unprovable controls cannot grow in
 * silence.
 */
type RecycleProbe = {
  /** What the residue is, in words, printed beside the verdict. */
  leaveBehind: string;
  /** The first owner, in non-default state. */
  first: () => ReactElement;
  /** The interaction that creates the state the reset must clear. */
  act: () => Promise<void>;
  /** The second owner: same testID, every prop at its default. */
  second: () => ReactElement;
  /**
   * Ask the second mount. An `actual` that is not what the second owner's own props imply is
   * the control answering out of somebody else's state.
   */
  read: () => Promise<
    Array<{ label: string; expected: unknown; actual: unknown }>
  >;
};

/** Why a control has no probe: printed as the verdict, so a pass is not read as coverage. */
type RecycleNote = { noProbe: string };

/** Every callback the probes wired up, in order, as `testID:value`. */
const recycleEvents: string[] = [];

/** One handler per control, recording what the app was told. */
const recordRecycle =
  (testId: string) =>
  (value: unknown): void => {
    recycleEvents.push(`${testId}:${String(value)}`);
  };

/** Events recorded since `from`, so a probe reads only the effect of its own press. */
const eventsSince = (from: number): string[] => recycleEvents.slice(from);

/**
 * Wait for `wanted` to be the whole of what the app has been told since `from`, and hand back
 * what was actually seen either way.
 *
 * A probe's *setup* may throw - an interaction that never produced its event means the fixture
 * is broken, and that should stop the run. A probe's **read** may not: a control that stays
 * silent is the residue this rule looks for, and it has to arrive as a finding naming both
 * values, not as a Jest timeout that names neither. So this waits, and then reports.
 */
async function eventsSettled(from: number, wanted: string): Promise<string> {
  const deadline = Date.now() + 1500;
  for (;;) {
    const seen = eventsSince(from).join(',');
    if (seen === wanted) return seen;
    if (Date.now() >= deadline) return seen;
    await sleep(50);
  }
}

/** Press a control at its own box. */
const pressControl = async (testId: string): Promise<void> => {
  await userEvent.press(await screen.findByTestId(testId));
};

/**
 * Press the right-hand end of a control's box - the last segment of a SegmentedControl, which
 * names an index no default does. The suite's own SegmentedControl tests press at the ends for
 * the same reason (`SegmentedControl.harness.tsx:413`).
 */

/** Poll a control's own report until it answers the way `until` wants, then hand it back. */
async function pollReport(
  read: () => string,
  until: (report: string) => boolean,
  what: string
): Promise<string> {
  const seen: { report: string } = { report: '' };
  await waitFor(
    () => {
      seen.report = read();
      if (!until(seen.report)) {
        throw new Error(`${what}: report="${seen.report}"`);
      }
    },
    { timeout: 8000 }
  );
  return seen.report;
}

/** Epoch millis for a local day, so the DatePicker probe can name a day rather than a number. */
const localDay = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

/**
 * One `key=value` field out of a control's report string.
 *
 * The reports are `|`-separated on iOS and `;`-separated on Android for Picker, so both are
 * treated as one separator class here rather than the probes each carrying their own split.
 */
function reportField(report: string, key: string): string {
  const pair = report
    .split(/[|;]/)
    .find((entry) => entry.startsWith(`${key}=`));
  return pair === undefined
    ? `<no ${key} in "${report}">`
    : pair.slice(key.length + 1);
}

/**
 * The DatePicker's report: `millis|presented|calendarMonthUtc|hasSelection|livePresentations|
 * controlBuilds|builtMinimum|builtMaximum` — displayed instant and open presentation, both read
 * off the view (`HybridNitroUiDatePicker.swift`'s `nuiTestStateReport`). The field order is the
 * one `DatePicker.harness.tsx:208` parses, so the two suites cannot disagree about it silently.
 */
function datePickerReportOf(testId: string): string {
  const handle = handleFor(testId);
  if (handle.nuiTestStateReport == null) {
    throw new Error(
      `"${testId}" reports no state, so the recycle rule cannot read it`
    );
  }
  return handle.nuiTestStateReport();
}

/** The Slider's a11y step: fire the queued action and wait for its report to change. */
async function sliderStep(
  handle: Handle,
  direction: number,
  what: string
): Promise<string> {
  if (
    handle.nuiTestAccessibilityStep == null ||
    handle.nuiTestAccessibilityStepReport == null
  ) {
    throw new Error(
      `${what}: this control's handle reports no accessibility step`
    );
  }
  // Both calls stay on the handle (see `datePickerReportOf`'s note). The action runs in a turn
  // of the UI thread's queue (`HybridNitroUiSlider.swift:957`), so the wait is on the report
  // *changing*, not on a guessed pause - same shape as `Slider.harness.tsx:80`.
  const before = handle.nuiTestAccessibilityStepReport();
  handle.nuiTestAccessibilityStep(direction);
  return pollReport(
    () => handle.nuiTestAccessibilityStepReport?.() ?? '',
    (next) => next !== before,
    what
  );
}

/** The `from` of a `... <from>-><to> ...` step report: what the control was showing. */
function stepFrom(report: string): string {
  const pair = /(\d+(?:\.\d+)?)->(\d+(?:\.\d+)?)/.exec(report);
  const from = pair == null ? undefined : pair[1];
  if (from == null) {
    throw new Error(`step report names no value pair: "${report}"`);
  }
  return from;
}

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
 * The engine's own answer, for every control, read **before this file seeds anything**.
 *
 * `prewarmSizing` is the only way to ask from JS whether the engine has a declared fallback for
 * a name, and its answer is just "the name is in `fallbacks_`" (`NitroUiSizingEngine.cpp:855`).
 * That is a question with an expiry date: `seedSizingSize` writes `fallbacks_` too — not only
 * the guess, the declaration (`NitroUiSizingEngine.cpp:512`) — so after any seed in a process,
 * the answer is `true` whether or not the library's startup table ever had a row for the
 * control. Reading it once per test, as round 1 did, means the first poison in this file makes
 * every later read in this file evidence of nothing; and it is why Button's row can read `true`
 * in a whole-suite run even though `Button.harness.tsx` was the one that seeded it
 * (`Button.harness.tsx:297`).
 *
 * So the read is done once, in the file's first test, before any poison here has run, and every
 * later assertion takes its `declared` from this table rather than re-asking. On a warm process
 * even that first read is not the startup table's answer, and the log says which of the two it
 * is — the same `measurements === 0` witness `ColdSizing.harness.tsx` uses, for the same reason.
 */
const registration: Record<string, boolean> = {};

function readRegistrationOnce(): void {
  if (Object.keys(registration).length > 0) return;
  const cold = stats().measurements === 0;
  for (const fixture of FIXTURES) {
    registration[fixture.component] = hasDeclaredFallback(fixture.component);
  }
  const declared = Object.values(registration).filter(Boolean).length;
  console.log(
    `    · registration (${cold ? 'COLD' : 'NOT COLD'} process): ` +
      `${String(declared)}/${String(Object.keys(registration).length)} controls ` +
      `have an engine fallback` +
      (cold
        ? ' — read before any seed in this process, so this is the startup ' +
          "table's own answer"
        : ' — something has already measured in this process, so a `true` here ' +
          'is the engine’s current state and not proof of the startup table. ' +
          'That claim is `bun run harness:cold:*` and `checkFallbackTable` ' +
          "in `check`, which don't seed at all")
  );
}

/**
 * Put the declared *number* back.
 *
 * This does not, and cannot, restore the startup declaration: `seedSizingSize` writes
 * `fallbacks_` (`NitroUiSizingEngine.cpp:512`), so from the first poison onward this component's
 * engine row is JS-supplied, and there is no JS seam that re-runs the startup table's
 * `setFallback` pass. What it does is leave a sane fallback for the suites that run after this
 * one — the obligation `ColdSizing.harness.tsx`'s header states for the same reason — and the
 * number is exact because the table it writes is the mirror checked against
 * `scripts/conformance-core.mjs` on every `check`, so a restored number cannot be a wrong number
 * the rest of the process then quietly trusts.
 *
 * Round 1 called this `restore` as if it undid the poison. It does not: what protects the
 * registration claim is {@link readRegistrationOnce} running first, not anything undone here.
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
 * the control's own answer rather than a React-side copy of the props.
 *
 * The two owners are deliberately **not** symmetric, and that asymmetry is the fix. The first
 * owner puts its control in non-default state — by interaction where the control can be
 * interacted with — and the second owner sends its props at their defaults. Because:
 *
 * - if the second owner re-sends every prop with a fresh value, every generated setter runs
 *   and overwrites exactly what the reset was supposed to have cleared, so the rule passes
 *   with the reset deleted. Fabric's Insert mutation passes `oldProps:nil`
 *   (`RCTMountingManager.mm:83`), so a recycled mount runs *all* provided setters anyway;
 * - and a prop the second owner sends at its default leaves the reset as the only source of
 *   its stored value, which is the thing under test.
 *
 * `residue`/`oracle` are the part that decides whether this rule can fail at all — see
 * {@link RecycleProbe}. A control with no `oracle` has no state that survives independently
 * of React's next write (or no read-out that is not a stub on one platform), and says so in
 * the run instead of banking a pass from a check that could not have failed. */

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
  /**
   * The same control under a caller-chosen `testID`, for the leak rule's positive control,
   * which mounts K of them *at once* — `owner` reuses one testID, and K controls sharing an
   * identity is a different test (and a broken query). `variant` flips a prop so the rows are
   * visibly distinct, the way the other suites' churn does (`Sizing.harness.tsx:504`).
   */
  control: (testId: string, variant: boolean) => ReactElement;
  /** What the control reports about itself, for the recycle rule. */
  state: (
    handle: Handle,
    second: boolean
  ) => Array<{ label: string; expected: unknown; actual: unknown }>;
  /**
   * The part of this rule that can actually fail: two owners of one testID, an interaction,
   * and the control's own answer afterwards. See {@link RecycleProbe} for why a prop cannot
   * show residue and an interaction can, and {@link RecycleNote} for the controls where even
   * that is not available.
   */
  probe: RecycleProbe | RecycleNote;
};

const SECOND = 'second owner';

const columnStyle = { flexDirection: 'column' } as const;

/**
 * Every callback the a11y rule's own wrapper has to keep alive: a probe's control is wrapped
 * in a plain `View`, so the box the harness measures is the control's and the press lands on
 * it. `columnStyle` is what `Slider.harness.tsx` and the other suites use for the same reason.
 */
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
    control: (testId, variant) => (
      <Switch
        value={variant}
        testID={testId}
        accessibilityLabel={`Leak switch ${String(variant)}`}
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
    probe: {
      leaveBehind:
        'a tap the app rejected, which leaves the Switch *displayed* on',
      first: () => (
        <Switch
          value={false}
          onValueChange={recordRecycle('conformance-switch')}
          testID="conformance-switch"
          accessibilityLabel="Conformance switch"
          hybridRef={captureFor('conformance-switch')}
        />
      ),
      act: async () => {
        await pressControl('conformance-switch');
        // The handshake: native paints `true` immediately, JS refuses to move off
        // `value={false}`, and the next commit reverts the display. Waiting for the event
        // rather than a pause, because the revert is only real once the echo has arrived.
        await waitFor(() =>
          expect(eventsSince(0)).toEqual(['conformance-switch:true'])
        );
      },
      second: () => (
        <Switch
          value={false}
          onValueChange={recordRecycle('conformance-switch')}
          testID="conformance-switch"
          accessibilityLabel="Conformance switch"
          hybridRef={captureFor('conformance-switch')}
        />
      ),
      read: async () => {
        const from = recycleEvents.length;
        await pressControl('conformance-switch');
        // A fresh Switch at `value={false}` has one thing to say when pressed: `true`. A
        // display left on by the previous owner says `false` instead - the tap-twice oracle
        // `Switch.harness.tsx:8` uses for the same reason, pointed at the reset rather than at
        // the revert it sits behind.
        return [
          {
            label: 'the first press after the second mount reports',
            expected: 'conformance-switch:true',
            actual: await eventsSettled(from, 'conformance-switch:true'),
          },
        ];
      },
    },
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
    control: (testId, variant) => (
      <Slider
        value={variant ? 0.6 : 0.2}
        testID={testId}
        accessibilityLabel={`Leak slider ${String(variant)}`}
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
    probe: {
      leaveBehind:
        'an uncontrolled drag to 0.5, which is state only native holds (no prop ' +
        'describes it once the second owner sends no `value`)',
      first: () => (
        <View style={columnStyle}>
          <Slider
            defaultValue={0}
            step={0.25}
            onValueChange={recordRecycle('conformance-slider')}
            testID="conformance-slider"
            accessibilityLabel="Conformance slider"
            hybridRef={captureFor('conformance-slider')}
          />
        </View>
      ),
      act: async () => {
        const before = eventsSince(0).length;
        await sliderStep(
          handleFor('conformance-slider'),
          1,
          'the first owner’s drag'
        );
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-slider:0.25'])
        );
        await sliderStep(
          handleFor('conformance-slider'),
          1,
          'the first owner’s second step'
        );
        await waitFor(() =>
          expect(eventsSince(before)).toEqual([
            'conformance-slider:0.25',
            'conformance-slider:0.5',
          ])
        );
      },
      second: () => (
        <View style={columnStyle}>
          <Slider
            defaultValue={0}
            step={0.25}
            onValueChange={recordRecycle('conformance-slider')}
            testID="conformance-slider"
            accessibilityLabel="Conformance slider"
            hybridRef={captureFor('conformance-slider')}
          />
        </View>
      ),
      read: async () => {
        // One step up from wherever the second mount is standing. The report's `from` is
        // `model.state.displayed` read on the main thread
        // (`HybridNitroUiSlider.swift:979`), so it is the drawn value, not React's number.
        const report = await sliderStep(
          handleFor('conformance-slider'),
          1,
          'the second owner’s first step'
        );
        return [
          {
            label: 'the value the control was showing before any step',
            expected: '0',
            actual: stepFrom(report),
          },
        ];
      },
    },
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
    control: (testId, variant) => (
      <Button
        title={variant ? 'Leak B' : 'Leak A'}
        testID={testId}
        accessibilityLabel={`Leak button ${String(variant)}`}
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
    probe: {
      noProbe:
        'a Button owns no state a reset can clear. `title`, `accessibilityLabel` and ' +
        '`onPress` are all re-sent by the wrapper on every mount - and the callback ' +
        'is deliberately always sent, as a stable no-op when the app passed none, ' +
        'which is what stops a recycled view keeping a dead owner’s handler ' +
        '(Button.tsx:99-110). Its `prepareForRecycle` is the belt, and nothing on ' +
        'either platform can show it missing.',
    },
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
    control: (testId, variant) => (
      <Progress
        value={variant ? 0.6 : 0.2}
        testID={testId}
        accessibilityLabel={`Leak progress ${String(variant)}`}
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
    probe: {
      noProbe:
        'Progress has no interaction to leave residue with - it is an indicator, not ' +
        'a control - and both platforms’ own read-out of it is a stub: ' +
        '`nuiTestDisplayedValue()` answers `-1` on iOS and `-1;animating=-1` on ' +
        'Android, so any assertion written against it would be a tautology. Its ' +
        'value, tint and variant are props the wrapper re-sends.',
    },
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
    control: (testId, variant) => (
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={variant ? 1 : 0}
        testID={testId}
        accessibilityLabel={`Leak segmented ${String(variant)}`}
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
    probe: {
      noProbe:
        'it has residue and no way to see it. A pick really does move the ' +
        'displayed index and the handshake counts, but neither platform reports ' +
        "the drawn index: the handle's `selectedIndex` is `model.state.js`, which " +
        'is what React sent, and `nuiTestPixelReport()` answers a colour, not a ' +
        'position. A press oracle cannot stand in either - iOS emits from the ' +
        'selection binding without asking whether the index changed ' +
        '(HybridNitroUiSegmentedControl.swift:150-156), so the same press reports ' +
        'an event whether or not the control was already there, and the answer ' +
        "would differ per platform for reasons that are not the reset's. The fix " +
        "is a read-out (a `nuiTestDisplayedIndex`, alongside Progress's and " +
        "DatePicker's), not a weaker assertion.",
    },
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
    control: (testId, variant) => (
      <DatePicker
        value={new Date(variant ? 1735700000000 : 1735600000000)}
        testID={testId}
        accessibilityLabel={`Leak date picker ${String(variant)}`}
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
    probe: {
      leaveBehind:
        'a picked day and an opened presentation, both owned by the view rather ' +
        'than by a prop',
      first: () => (
        <DatePicker
          defaultValue={new Date(localDay(2026, 6, 4))}
          onChange={(date) => recordRecycle('conformance-date-picker')(date)}
          testID="conformance-date-picker"
          accessibilityLabel="Conformance date picker"
          hybridRef={captureFor('conformance-date-picker')}
        />
      ),
      act: async () => {
        const picked = localDay(2027, 1, 15);
        handleFor('conformance-date-picker').nuiTestSelect?.(2027, 1, 15, 0, 0);
        await pollReport(
          () => datePickerReportOf('conformance-date-picker'),
          (report) => reportField(report, 'millis') === String(picked),
          'the first owner’s pick'
        );
        handleFor('conformance-date-picker').nuiTestPresent?.();
        await pollReport(
          () => datePickerReportOf('conformance-date-picker'),
          (report) => reportField(report, 'presented') === '1',
          'the first owner’s presentation'
        );
      },
      second: () => (
        <DatePicker
          defaultValue={new Date(localDay(2026, 6, 4))}
          onChange={(date) => recordRecycle('conformance-date-picker')(date)}
          testID="conformance-date-picker"
          accessibilityLabel="Conformance date picker"
          hybridRef={captureFor('conformance-date-picker')}
        />
      ),
      read: async () => {
        const report = await pollReport(
          () => datePickerReportOf('conformance-date-picker'),
          (next) =>
            reportField(next, 'millis') === String(localDay(2026, 6, 4)),
          'the second owner’s default'
        );
        return [
          {
            label: 'the day the field shows',
            expected: localDay(2026, 6, 4),
            actual: Number(reportField(report, 'millis')),
          },
          {
            label: 'a presentation left open',
            expected: '0',
            actual: reportField(report, 'presented'),
          },
        ];
      },
    },
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
    control: (testId, variant) => (
      <Picker
        options={['One', 'Two', 'Three']}
        selectedIndex={variant ? 1 : 0}
        testID={testId}
        accessibilityLabel={`Leak picker ${String(variant)}`}
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
    probe: {
      leaveBehind:
        'a pick of the last option on an uncontrolled control, then the same pick ' +
        'again - which only counts as a choice if the selection has been reset',
      first: () => (
        <Picker
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={0}
          onChange={(event) => recordRecycle('conformance-picker')(event.index)}
          testID="conformance-picker"
          accessibilityLabel="Conformance picker"
          hybridRef={captureFor('conformance-picker')}
        />
      ),
      act: async () => {
        const before = eventsSince(0).length;
        const choose = () => handleFor('conformance-picker').nuiTestSelect?.(2);
        choose();
        await waitFor(() =>
          expect(eventsSince(before)).toEqual(['conformance-picker:2'])
        );
        // The same choice again: `applyUserSelection` returns without emitting when the
        // index equals what is displayed (`HybridNitroUiPicker.swift:103`, whose comment
        // names this as the thing that makes a *rolled-back* selection observable). So the
        // second call says, in the negative, that the control really is on 2.
        choose();
        await settle(300);
        if (eventsSince(before).length !== 1) {
          throw new Error(
            `the picker emitted twice for one repeated choice: ` +
              eventsSince(before).join(',')
          );
        }
      },
      second: () => (
        <Picker
          options={['One', 'Two', 'Three']}
          defaultSelectedIndex={0}
          onChange={(event) => recordRecycle('conformance-picker')(event.index)}
          testID="conformance-picker"
          accessibilityLabel="Conformance picker"
          hybridRef={captureFor('conformance-picker')}
        />
      ),
      read: async () => {
        const before = eventsSince(0).length;
        handleFor('conformance-picker').nuiTestSelect?.(2);
        // The event is the reset reporting for itself: the previous owner left this control on
        // 2, and a control that still believes it is there emits nothing for a choice that
        // would change nothing. Silence *is* the residue, so it gets reported, not waited away.
        return [
          {
            label: 'choosing the previous owner’s option again emits',
            expected: 'conformance-picker:2',
            actual: await eventsSettled(before, 'conformance-picker:2'),
          },
        ];
      },
    },
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
      // Both lookups are done *inside* the one test that uses them, not here (X4 review N3).
      // In the `describe` body they ran while Jest was collecting the file, so a fixture whose
      // component has no row in the shared table took every other control's suite down with it:
      // one stale row became a collection error and the run reported nothing about the six
      // controls that were fine. Here it is one red test with its name on it.
      // `checkInAppFixtures` is what refuses such a fixture at all, on the host, in `check`.

      it('has its own declared fallback, and still corrects a wrong guess', async () => {
        // Which axes this control's declaration describes comes from the mirrored table,
        // because that is a host-side fact about its sizing policy — the suite that asserts
        // does not get to decide it. See `boxRuleFor` in scripts/conformance-core.mjs.
        const expected = declaredFallback(fixture.component);
        const boxRule = boxRuleFor(fixture.component);

        // 1. The engine knows a fallback at all — read once for the whole file, before any
        //    poison here has had the chance to write one. See `readRegistrationOnce` for why a
        //    per-test read is not evidence, and for what a `false` means on a warm process.
        readRegistrationOnce();
        const registered = registration[fixture.component] === true;

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

      it('is known to the engine while mounted, and unknown after', async () => {
        // The positive control, which is the half round 1's leak rule was missing. It churned
        // 50 mount/unmount pairs with no settle between them and read `ledger 0→0`, a number a
        // control that never registered an instance in the first place produces just as well as
        // one that registers and forgets correctly. So this mounts K controls, waits for each to
        // be laid out — an instance reaches the engine on its first measure, which is what
        // `laidOut` records — and requires the ledger to have risen by K. Only then does it drop
        // them and require the rise to have gone away.
        //
        // Both halves are needed and they fail for different reasons: without the first, "back
        // to baseline" is unfalsifiable; without the second, a control that registers and never
        // forgets is invisible.
        const MOUNTS = 8;
        const before = stats();
        const many = await render(
          <View>
            {Array.from({ length: MOUNTS }, (_, row) => row).map((row) =>
              // `testID` per row so every one is its own Fabric node, and alternating
              // `defaultValue` because the wrappers memoise on props: 8 identical elements
              // would be 8 nodes either way, but this is what the other suites' churn uses
              // (`Sizing.harness.tsx:504`).
              fixture.control(`leak-mounted-${String(row)}`, row % 2 === 0)
            )}
          </View>,
          RENDER
        );
        // The layout has to have happened for all K, or the ledger rise being asserted below is
        // a race rather than a fact. The last row's box is the witness: Fabric lays out in
        // order, so a measured last row means all rows were measured.
        await waitFor(
          () => {
            const box = harnessUi.queryByTestId(
              `leak-mounted-${String(MOUNTS - 1)}`
            );
            if (box == null || box.height <= 0) {
              throw new Error(`row ${String(MOUNTS - 1)} not laid out yet`);
            }
          },
          { timeout: 20000 }
        );
        const mounted = stats();
        many.unmount();
        // A settle, then the read: `onDropView` runs on the mounting transaction that removes
        // the view, and `host.drop()` is where the instance is released
        // (`NitroSwiftUIHost.swift:327`), so this waits for the drops rather than assuming they
        // were synchronous with `unmount()`.
        await settle(700);
        const after = stats();
        console.log(
          `    · ledger ${String(before.ledgerEntries)}→` +
            `${String(mounted.ledgerEntries)}→${String(after.ledgerEntries)} ` +
            `registry ${String(before.registryEntries)}→` +
            `${String(mounted.registryEntries)}→${String(after.registryEntries)} ` +
            `across ${String(MOUNTS)} mounted together`
        );
        const problems: Finding[] = [];
        const rose = mounted.ledgerEntries - before.ledgerEntries;
        if (rose < MOUNTS) {
          // Said as a finding rather than a thrown error, because the reason matters: a control
          // whose instances never reach the engine cannot leak there, and this rule would be
          // vacuous for it — which is a fact about the control worth printing.
          problems.push({
            component: fixture.name,
            rule: 'no-leak-on-drop',
            problem:
              `${MOUNTS} controls were mounted and laid out together and the ledger rose ` +
              `by ${String(rose)}, so this control does not hold ${
                rose === 0 ? 'an' : 'enough'
              } engine entry per instance — the drop half below can return to ` +
              'baseline without anything having been released, which is the same ' +
              'vacuity a churn loop with no settle between mounts had',
          });
        }
        problems.push(
          ...leakFindings({
            component: fixture.name,
            baseline: mounted,
            after,
            instances: MOUNTS,
          })
        );
        expectConformance(problems);
      });

      it('leaves the engine where it started across a churn of drops', async () => {
        // The churn, kept because it is a different shape from the one above: instances that
        // come and go over time, in a process that has already measured this component. The
        // warm-up is what makes its baseline honest — the component's own registry row is
        // created by the first measure, not by a drop, so a baseline taken before it would
        // count one legitimate entry as a leak.
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
        // Half one is the props, and it is the half round 1 mistook for the rule. It still
        // earns its place: it is what notices a wrapper that stopped *providing* a prop,
        // which is the other way this class of bug arrives (a prop that goes unset never
        // reaches native at all, so the next mount keeps whatever was there). It is not what
        // notices a missing reset, and the log says which half is which.
        const first = await render(fixture.owner(false), RENDER);
        await settle();
        expect(
          recycleFindings({
            component: fixture.name,
            identity: 'first owner',
            checks: fixture.state(handleFor(fixture.testId), false),
          })
        ).toEqual([]);
        first.unmount();
        await settle(400);

        const second = await render(fixture.owner(true), RENDER);
        await settle();
        const propChecks = fixture.state(handleFor(fixture.testId), true);
        console.log(
          `    · ${fixture.testId} props after the second owner: ` +
            propChecks
              .map((check) => `${check.label}=${String(check.actual)}`)
              .join(' ')
        );
        expectConformance(
          recycleFindings({
            component: fixture.name,
            identity: `testID "${fixture.testId}"`,
            checks: propChecks,
          })
        );
        second.unmount();
        await settle(400);

        // Half two is the one that can fail, and it owns both lifetimes: an interaction that
        // puts state in the view no prop describes, then a second mount whose props are all
        // defaults, then a question only the control's own state can answer.
        const probe = fixture.probe;
        if ('noProbe' in probe) {
          console.log(
            `    · ${fixture.testId} residue probe: none — ${probe.noProbe}`
          );
          return;
        }
        console.log(
          `    · ${fixture.testId} residue probe: ${probe.leaveBehind}`
        );
        recycleEvents.length = 0;
        const firstOwner = await render(probe.first(), RENDER);
        await settle();
        await probe.act();
        firstOwner.unmount();
        // Long enough for the drop to have run and, on iOS, for the instance to reach the
        // recycle pool: `enqueueComponentViewWithComponentHandle` is what calls
        // `prepareForRecycle` (`RCTComponentViewRegistry.mm:117`), and it happens on the
        // mounting transaction that removes the view.
        await settle(500);

        const secondOwner = await render(probe.second(), RENDER);
        await settle();
        const checks = await probe.read();
        for (const check of checks) {
          console.log(
            `    · ${fixture.testId} after the second owner: ` +
              `${check.label}=${String(check.actual)} (expected ` +
              `${String(check.expected)})`
          );
        }
        expectConformance(
          recycleFindings({
            component: fixture.name,
            identity: `testID "${fixture.testId}"`,
            checks,
          })
        );
        secondOwner.unmount();
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
