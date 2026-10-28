/**
 * On-device tests for the DatePicker (task G5).
 *
 * DatePicker is the first control in this library that *presents*: a popover on
 * iOS, a dialog window on Android. That adds two things the SegmentedControl
 * suite does not have — a piece of UI that outlives a tap and must not outlive
 * the mount, and a value that is a calendar instant rather than a number, so the
 * device's time zone is part of the result. It keeps everything the other suites
 * have: the event-count handshake, and a size that comes from what the control
 * renders.
 *
 * Three readings, as in the Button/SegmentedControl suites:
 *  - `harnessUi.queryByTestId` — the box Fabric gave the view;
 *  - `hybridRef.measureContent()` — the size the hosted control measured;
 *  - `hybridRef.nuiTestStateReport()` — `(displayed instant, presented?)`.
 *
 * The third one is new, and it is here because of what a date picker is: a
 * calendar cell, a wheel row and a dialog button are all unreachable to a
 * synthesised press on at least one platform (see `nuiTestSelect`'s doc comment),
 * so the suite drives selections through the control's own selection path and
 * reads the result back through the only two channels that are honest about it —
 * the event that reached JS, and the report native keeps in step with what it is
 * showing. The dialog test then needs no readout at all: a leaked dialog window
 * (Android) or popover (iOS) swallows the press of the witness next to it.
 *
 * Two things make these tests able to fail:
 *  - every cold configuration is **poisoned** first (`seedSizingSize` with a size
 *    no date picker has, then an environment bump), so a correction that never
 *    arrives leaves a visible wrong box and costs a correction the test requires;
 *  - the pair test requires **exactly one** correction for two mounted pickers,
 *    which is the assertion that fails if a `compact` field's width ever depends
 *    on the date it is showing.
 */
import {
  Platform,
  Pressable,
  Text,
  TurboModuleRegistry,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import {
  DatePicker,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The Fabric name — what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiDatePicker';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back — declared, not imported (DECISIONS D14 keeps
 * Hybrid View types off the public surface). Read-only except for the two test
 * seams, which are the point of having the handle at all here.
 */
type DatePickerHandle = {
  /** The instant React sent, clamped to the bounds; null when uncontrolled. */
  readonly valueMillis: number | null;
  readonly mostRecentEventCount: number;
  readonly mode: string;
  readonly variant: string;
  readonly minimumMillis: number | null;
  readonly maximumMillis: number | null;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  readonly onValueChange?: unknown;
  measureContent(): { width: number; height: number };
  /** `month` is 1-12; fields the `mode` does not show keep the displayed value. */
  nuiTestSelect(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
  ): void;
  nuiTestPresent(): void;
  /**
   * `"<displayed millis>|<presented 0|1>|<calendar month>|<calendar has selection>|<live presentations>|<control builds>"`.
   *
   * The middle two are the composed *calendar's* own facts and Android's only:
   * Material 3's `DatePickerState` publishes a displayed month and a nullable
   * selection, SwiftUI's `DatePicker` publishes neither, so iOS reports `-1` for both
   * (see `readReport()` in `HybridNitroUiDatePicker.swift`). The fifth field is
   * process-wide on both platforms; the sixth counts this mount's own platform-control
   * builds, which is what a rebuild is measured by (`keeps the live control…`).
   */
  nuiTestStateReport(): string;
};

/** Handles by testID, so a test can ask each control what it holds. */
const handles = new Map<string, DatePickerHandle>();
const captureHybrid =
  (testId: string) =>
  (view: DatePickerHandle): void => {
    handles.set(testId, view);
  };

/**
 * Every `onChange` the app has reported, in order: `testID:millis`.
 *
 * The instant is in the line rather than just a count because half of what this
 * suite asserts is *which* instant a pick produced (clamping, the DST round-trip),
 * and re-rendering the tree to show one would spend a render on the measurement.
 */
const eventLog: string[] = [];
const recordChange =
  (testId: string) =>
  (date: Date): void => {
    eventLog.push(`${testId}:${String(date.getTime())}`);
  };

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

/** `after - before` for the counters a test asserts on. */
function delta(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return {
    corrections:
      after.correctionsImmediate -
      before.correctionsImmediate +
      (after.correctionsBatched - before.correctionsBatched),
    immediate: after.correctionsImmediate - before.correctionsImmediate,
    flushes: after.flushes - before.flushes,
    measurements: after.measurements - before.measurements,
    epoch: after.environmentEpoch - before.environmentEpoch,
    cachedSizes: after.cachedSizes - before.cachedSizes,
  };
}

type Size = { width: number; height: number };

/** Within what Yoga rounds to. */
function sameSize(a: Size | null, b: Size | null): boolean {
  return (
    a != null &&
    b != null &&
    Math.abs(a.width - b.width) < 0.6 &&
    Math.abs(a.height - b.height) < 0.6
  );
}

function describeSize(size: Size | null): string {
  return size == null
    ? 'null'
    : `${size.width.toFixed(2)}x${size.height.toFixed(2)}`;
}

function sizeOf(testId: string): Size | null {
  return harnessUi.queryByTestId(testId);
}

function measured(testId: string): Size | null {
  return handles.get(testId)?.measureContent() ?? null;
}

/** The report native keeps in step with what it is showing, parsed. */
type Report = {
  /** The instant the control is showing, in ms. */
  millis: number;
  presented: boolean;
  /** UTC millis of the first of the month the composed calendar is showing, or -1. */
  calendarMonthUtc: number;
  /** 1 = the calendar has a day selected, 0 = it declined one, -1 = no calendar. */
  calendarHasSelection: number;
  /** Presentations open in this whole process, from any mount, present or gone. */
  livePresentations: number;
  /**
   * How many times this mount built its platform control. It moves exactly when a
   * bounds change rebuilt the live control (Android's `key(...)`, iOS's `.id(...)`),
   * which is the only honest way to see a rebuild: the page and selection a rebuild
   * throws away are both re-derived from the value, so nothing else can read it.
   */
  controlBuilds: number;
  /**
   * What the platform control ON SCREEN was built with, as the two bounds the
   * native build recorded for it (`-1` = no control built yet, `-2` = that bound is
   * unset).
   *
   * `controlBuilds` says how often a control was built; this says *what the one that
   * is up there knows*. That difference is the whole content of `docs/tasks/
   * FOLLOWUPS.md` row 46: iOS keyed a rebuild on the live control's bounds while the
   * record of those bounds was written from an `.onAppear` that survived rebuilds, so
   * the count and the bounds disagreed about which control was on screen. Only
   * reading both can show that.
   */
  builtMinimum: number;
  builtMaximum: number;
};

function reportOf(testId: string): Report {
  const raw = handles.get(testId)?.nuiTestStateReport() ?? '';
  const [
    millis,
    presented,
    calendarMonthUtc,
    calendarHasSelection,
    livePresentations,
    controlBuilds,
    builtMinimum,
    builtMaximum,
  ] = raw.split('|');
  return {
    millis: Number(millis),
    presented: presented === '1',
    calendarMonthUtc: Number(calendarMonthUtc),
    calendarHasSelection: Number(calendarHasSelection),
    livePresentations: Number(livePresentations),
    controlBuilds: Number(controlBuilds),
    builtMinimum: Number(builtMinimum),
    builtMaximum: Number(builtMaximum),
  };
}

/**
 * The platform-build count of `testId` once it has stopped moving, and why the
 * word "settled" is load-bearing.
 *
 * A mount is built again while its props land - the bounds arrive after the first
 * commit, and on iOS a value still outside the bounds the control was built with is
 * one more reason to rebuild - so a baseline sampled too early is a race, not an
 * assertion. What a re-render may not do is *add* to the settled number, which is
 * why every rebuild assertion in this file is made against a baseline.
 *
 * Shared by the two tests that measure rebuilds (`keeps the live control when a
 * re-render sends a new bound instant` and the escape-clause test), because the
 * quiet-window rule has to be the same in both or one of them is racing.
 */
async function settledBuilds(testId: string, what: string): Promise<number> {
  const QUIET_POLLS = 15;
  let previous = -1;
  let quiet = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(100);
    const now = reportOf(testId).controlBuilds;
    quiet = now >= 1 && now === previous ? quiet + 1 : 0;
    previous = now;
    if (quiet >= QUIET_POLLS) {
      console.log(`settled platform builds (${testId}): ${String(now)}`);
      return now;
    }
  }
  throw new Error(
    `"${testId}" never settled on a platform-build count (${what}): its report ` +
      `is "${handles.get(testId)?.nuiTestStateReport() ?? '<no handle>'}" - ` +
      `still changing after 12s, so there is no baseline for the re-render ` +
      `assertions to be made against.`
  );
}

/** `'2026-07'` for the month a report names, in UTC — the calendar's own page. */
function monthKeyOf(utcMillis: number): string {
  const date = new Date(utcMillis);
  return (
    String(date.getUTCFullYear()) +
    '-' +
    String(date.getUTCMonth() + 1).padStart(2, '0')
  );
}

/** `'2026-07'` for the year/month a test expects the calendar to be showing. */
function expectedMonthKey(year: number, month: number): string {
  return String(year) + '-' + String(month).padStart(2, '0');
}

/** Poll until the composed calendar is showing the given month. */
async function waitForMonth(
  testId: string,
  year: number,
  month: number,
  what: string
) {
  const wanted = expectedMonthKey(year, month);
  return await pollUntil(
    () =>
      monthKeyOf(reportOf(testId).calendarMonthUtc) === wanted ? wanted : null,
    () =>
      new Error(
        `"${testId}" (${what}) is not showing ${wanted} - its report is ` +
          `"${handles.get(testId)?.nuiTestStateReport() ?? '<no handle>'}" ` +
          `(month ${monthKeyOf(reportOf(testId).calendarMonthUtc)}), while the ` +
          `model displays ${String(displayedOf(testId))} ` +
          `(${new Date(displayedOf(testId)).toISOString()}).`
      )
  );
}

/** Poll until the process-wide count of open presentations is `count`. */
async function waitForLivePresentations(
  testId: string,
  count: number,
  what: string
) {
  return await pollUntil(
    () => (reportOf(testId).livePresentations === count ? count : null),
    () =>
      new Error(
        `"${testId}" (${what}) reports ` +
          `${String(reportOf(testId).livePresentations)} live presentations, ` +
          `want ${String(count)} - the report is ` +
          `"${handles.get(testId)?.nuiTestStateReport() ?? '<no handle>'}".`
      )
  );
}

/** The instant native is showing, or NaN when the handle is gone. */
function displayedOf(testId: string): number {
  return reportOf(testId).millis;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
  read: () => T | null,
  failure: () => Error,
  timeoutMs = 8000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value != null) {
      return value;
    }
    if (nitroUiCore.now() > deadline) {
      throw failure();
    }
    await sleep(25);
  }
}

async function waitForTestId(testId: string, timeoutMs = 10000) {
  await pollUntil(
    () => (harnessUi.queryByTestId(testId) == null ? null : true),
    () =>
      new Error(`No element with testID "${testId}" within ${timeoutMs}ms.`),
    timeoutMs
  );
  return screen.findByTestId(testId);
}

/** Poll until the box of `testId` is `size`, i.e. until a size has really arrived. */
async function waitForBox(testId: string, size: Size, what: string) {
  return await pollUntil(
    () => (sameSize(sizeOf(testId), size) ? sizeOf(testId) : null),
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached ` +
          `${size.width.toFixed(2)}x${size.height.toFixed(2)} - last box ` +
          `${describeSize(sizeOf(testId))}, control measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/** Poll until the control reports a size (a host measures after its first commit). */
async function waitForMeasured(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

/** Poll until the control is showing `millis`, i.e. until a write or a revert landed. */
async function waitForDisplayed(testId: string, millis: number, what: string) {
  return await pollUntil(
    () => (displayedOf(testId) === millis ? millis : null),
    () =>
      new Error(
        `"${testId}" (${what}) is not showing ${String(millis)} - it reports ` +
          `${String(displayedOf(testId))}, and the last box was ` +
          `${describeSize(sizeOf(testId))}.`
      )
  );
}

/** Poll until the presentation of `testId` is `presented`. */
async function waitForPresented(
  testId: string,
  presented: boolean,
  what: string
) {
  return await pollUntil(
    () => (reportOf(testId).presented === presented ? presented : null),
    () =>
      new Error(
        `"${testId}" (${what}) never reported presented=${presented ? '1' : '0'} ` +
          `- the control's report is "${
            handles.get(testId)?.nuiTestStateReport() ?? '<no handle>'
          }".`
      )
  );
}

/**
 * Poll until the box agrees with the size the control itself reports, at a
 * caller's `width`.
 *
 * Used for the `fillWidth` variants, where a single read of `measureContent()` is
 * not enough: a Material 3 calendar lays out twice when its year range and
 * `SelectableDates` land, so the first reported height can be a frame's-old
 * number, and the correction that follows is the control settling rather than the
 * engine failing. The claim is that the box ends up where the control ends up.
 */
async function waitForBoxToMatchMeasured(
  testId: string,
  width: number,
  what: string
) {
  return await pollUntil(
    () => {
      const box = sizeOf(testId);
      const size = measured(testId);
      return box != null &&
        size != null &&
        Math.abs(box.width - width) < 0.6 &&
        Math.abs(box.height - size.height) < 0.6
        ? box
        : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never laid out at ${String(width)} x ` +
          `its own height - last box ${describeSize(sizeOf(testId))}, control ` +
          `measures ${describeSize(measured(testId))}.`
      )
  );
}

/** Wait for `eventLog` to hold at least `count` entries. */
async function waitForEvents(count: number) {
  return await pollUntil(
    () => (eventLog.length >= count ? eventLog.slice() : null),
    () =>
      new Error(
        `Only ${String(eventLog.length)} of ${String(count)} change events ` +
          `arrived: ${JSON.stringify(eventLog)}.`
      )
  );
}

/**
 * The key `DatePicker.tsx` builds: `"<variant>|<mode>"`.
 *
 * Written out here rather than imported — a harness that poisoned the cache
 * through the library's own helper could not catch the helper being wrong, and a
 * missing input in that key is exactly the R3 bug class. Note what is *not* in
 * it: the date. That omission is the claim of the pair test, not an oversight.
 */
function sizingKey(variant: string, mode: string): string {
  return `${variant}|${mode}`;
}

/**
 * A size that is *not* any date picker's size, planted as the engine's answer for
 * a configuration before it is first mounted (see the SegmentedControl suite).
 */
const WRONG_SIZE = { width: 13.25, height: 66.5 };

/** Plant a wrong answer for several configurations, then drop the cache once. */
function poisonConfigurations(keys: readonly string[]): void {
  for (const key of keys) {
    nitroUiCore.seedSizingSize(
      COMPONENT,
      key,
      WRONG_SIZE.width,
      WRONG_SIZE.height
    );
  }
  nitroUiCore.invalidateSizingEnvironment();
}

/** Let queued work land before reading counters that only move on a later turn. */
async function settle(ms = 250): Promise<void> {
  await sleep(ms);
}

/**
 * A local instant, from calendar fields — the same arithmetic native performs.
 *
 * Both sides resolve these fields in the *device's* time zone (a JS `Date`
 * constructor and a native `Calendar`/`DateComponents`), which is what makes this
 * usable as an expectation for `nuiTestSelect`: the claim under test is that the
 * two agree, including across a DST boundary. `month` is 1-12, like the seam's.
 */
function localMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

/** What the device thinks its UTC offset is, for the log lines (D21 evidence). */
function zoneNote(): string {
  const offsetMinutes = new Date().getTimezoneOffset();
  return `tzOffset=${String(offsetMinutes)}`;
}

/**
 * The widest string `mode` can format, from the same formatter the field's probe
 * uses. Only for failure output: a mode change that does not move the box is
 * undiagnosable without knowing what the two fields were sized from.
 */
function probeTextOf(mode: string): string {
  const probe = new Date(2288, 10, 28, 23, 59);
  return mode === 'time'
    ? probe.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : probe.toLocaleDateString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

const columnStyle: StyleProp<ViewStyle> = { gap: 6 };

afterEach(() => {
  cleanup();
  handles.clear();
  eventLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('DatePicker · G5', () => {
  it('lays each variant out at the size the control measured', async () => {
    // The base R3 claim plus the policy claim for this component: `compact` is
    // intrinsic (the field's own width), `inline` and `wheel` are `fillWidth`
    // (the caller's width, the control's height). A `wheel` on Android is the
    // inline picker, so it must behave like `inline` here rather than like a
    // field — which is also the assertion that catches a variant flipping the
    // wrong policy.
    poisonConfigurations([
      sizingKey('compact', 'date'),
      sizingKey('inline', 'date'),
      sizingKey('wheel', 'datetime'),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={columnStyle}>
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 13, 45)}
          testID="field"
          hybridRef={captureHybrid('field')}
        />
        <View style={{ width: 320 }}>
          <DatePicker
            defaultValue={new Date(2026, 6, 4)}
            variant="inline"
            testID="inline"
            hybridRef={captureHybrid('inline')}
          />
        </View>
        <View style={{ width: 320 }}>
          <DatePicker
            defaultValue={new Date(2026, 6, 4, 13, 45)}
            variant="wheel"
            mode="datetime"
            testID="wheel"
            hybridRef={captureHybrid('wheel')}
          />
        </View>
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('field');
    await waitForTestId('inline');
    await waitForTestId('wheel');

    const fieldSize = await waitForMeasured('field', 'the compact field');
    await waitForBox('field', fieldSize, 'the compact field');
    // Intrinsic: the field is narrower than the caller's 320 dp box around the
    // other two, and it is the control's width rather than the window's.
    expect(fieldSize.width).toBeLessThan(320);

    for (const testId of ['inline', 'wheel']) {
      const size = await waitForMeasured(testId, `the ${testId} picker`);
      // Height comes from the control, width from the caller. The height is what a
      // `fillWidth` host has to get right (a calendar is not 34 dp tall); the width
      // is what the policy is for, and 320 rather than the control's own width is
      // the difference between `fillWidth` and `intrinsic`.
      await waitForBoxToMatchMeasured(testId, 320, `the ${testId} picker`);
      expect(size.height).toBeGreaterThan(100);
    }

    const after = delta(before, stats());
    console.log(
      `variants (${Platform.OS}, ${zoneNote()}): field=${describeSize(fieldSize)} ` +
        `inline=${describeSize(sizeOf('inline'))} wheel=${describeSize(sizeOf('wheel'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    // Three configurations, each poisoned, so each owes a correction. Without a
    // measure or a report any one of them sits at 13.25x66.5 and this fails.
    expect(after.corrections).toBeGreaterThanOrEqual(3);
    expect(sameSize(sizeOf('field'), WRONG_SIZE)).toBe(false);
    unmount();
  });

  it('reports a pick once, and nothing for the same day', async () => {
    // The event contract, in the order a user produces it: one pick, one event
    // with the instant; the same day again, no event. The second half is the
    // no-op suppression that also underwrites the rejection test below — a picker
    // that echoed "still 2027-01-15" would make a snap-back invisible.
    const FIRST = localMs(2027, 1, 15);
    const { unmount } = await render(
      <DatePicker
        defaultValue={new Date(2026, 5, 4)}
        onChange={recordChange('pick')}
        testID="pick"
        hybridRef={captureHybrid('pick')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('pick');
    // The seed: an uncontrolled picker shows the `defaultValue` it was given.
    await waitForDisplayed('pick', localMs(2026, 6, 4), 'the default');
    // Uncontrolled means React sent no instant, so there is nothing to read back.
    expect(handles.get('pick')?.valueMillis).toBeNull();

    handles.get('pick')?.nuiTestSelect(2027, 1, 15, 0, 0);
    const first = await waitForEvents(1);
    // `mode="date"` shows no clock, so the seam's hour/minute are ignored and the
    // displayed 00:00 survives — the instant a day cell tap produces.
    expect(first).toEqual([`pick:${String(FIRST)}`]);
    await waitForDisplayed('pick', FIRST, 'the pick');

    handles.get('pick')?.nuiTestSelect(2027, 1, 15, 0, 0);
    await settle(300);
    expect(eventLog).toEqual([`pick:${String(FIRST)}`]);

    handles.get('pick')?.nuiTestSelect(2027, 1, 16, 0, 0);
    const second = await waitForEvents(2);
    expect(second[1]).toBe(`pick:${String(localMs(2027, 1, 16))}`);
    console.log(
      `events (${Platform.OS}): ${JSON.stringify(eventLog)} default=` +
        `${String(localMs(2026, 6, 4))}`
    );
    unmount();
  });

  it('reverts a pick the parent refuses', async () => {
    // The controlled half of the handshake (core.md §4), with the tap-twice oracle
    // the SegmentedControl suite uses: a picker that has reverted is showing the
    // parent's date again, so *the same pick is a change again*. A picker that
    // never reverted is still showing 2027-01-15, the second pick is a no-op, and
    // the log has one line instead of two.
    const PARENT = localMs(2026, 6, 4);
    const PICKED = localMs(2027, 1, 15);
    const { unmount } = await render(
      <DatePicker
        value={new Date(PARENT)}
        onChange={recordChange('rejected')}
        testID="rejected"
        hybridRef={captureHybrid('rejected')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('rejected');
    await waitForDisplayed('rejected', PARENT, 'the parent value');

    handles.get('rejected')?.nuiTestSelect(2027, 1, 15, 0, 0);
    const first = await waitForEvents(1);
    expect(first).toEqual([`rejected:${String(PICKED)}`]);
    // Native owns the *displayed* instant, so the pick is painted first and the
    // parent's refusal is what puts it back. Reading "still painted" here is not
    // observable: waiting for the event already yielded the JS loop, so the echo
    // of the event count and its commit have landed by now on a fast device. The
    // revert itself, and the pick-twice oracle below, are what the handshake is
    // actually asserted on.
    await waitForDisplayed('rejected', PARENT, 'the revert');
    expect(handles.get('rejected')?.valueMillis).toBe(PARENT);

    handles.get('rejected')?.nuiTestSelect(2027, 1, 15, 0, 0);
    const second = await waitForEvents(2);
    expect(second).toEqual([
      `rejected:${String(PICKED)}`,
      `rejected:${String(PICKED)}`,
    ]);
    console.log(
      `rejection (${Platform.OS}): log=${JSON.stringify(eventLog)} ` +
        `displayed=${String(displayedOf('rejected'))}`
    );
    unmount();
  });

  it('clamps a value and a pick to minimumDate/maximumDate', async () => {
    // Two controls, because the two clamps are two different paths and a
    // controlled one cannot show the second: a pick that native clamped onto a
    // bound is refused by a parent that keeps sending its own value, so the
    // controlled instance ends up back on the value rather than on the bound.
    //  - `bounded-value`: React sends an instant past `maximumDate`, and both the
    //    wrapper and native clamp it. The handle reports the *clamped* instant,
    //    which is what makes an out-of-range value readable instead of live;
    //  - `bounded-pick`: uncontrolled, so a pick outside the range can stay where
    //    the clamp put it and be read back.
    const MIN = localMs(2026, 1, 1);
    const MAX = localMs(2027, 1, 1);
    const { unmount } = await render(
      <View style={columnStyle}>
        <DatePicker
          value={new Date(localMs(2030, 1, 1))}
          minimumDate={new Date(MIN)}
          maximumDate={new Date(MAX)}
          onChange={recordChange('bounded-value')}
          testID="bounded-value"
          hybridRef={captureHybrid('bounded-value')}
        />
        <DatePicker
          defaultValue={new Date(2026, 5, 4)}
          minimumDate={new Date(MIN)}
          maximumDate={new Date(MAX)}
          onChange={recordChange('bounded-pick')}
          testID="bounded-pick"
          hybridRef={captureHybrid('bounded-pick')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('bounded-value');
    await waitForTestId('bounded-pick');

    await waitForDisplayed('bounded-value', MAX, 'a value past maximumDate');
    expect(handles.get('bounded-value')?.valueMillis).toBe(MAX);
    expect(handles.get('bounded-value')?.maximumMillis).toBe(MAX);
    expect(handles.get('bounded-value')?.minimumMillis).toBe(MIN);
    // A clamp is not a pick: nothing reached JS.
    expect(eventLog).toEqual([]);

    await waitForDisplayed('bounded-pick', localMs(2026, 6, 4), 'the seed');
    // A pick above the range lands on the upper bound and reports it.
    handles.get('bounded-pick')?.nuiTestSelect(2031, 6, 1, 0, 0);
    const clampedHigh = await waitForEvents(1);
    expect(clampedHigh).toEqual([`bounded-pick:${String(MAX)}`]);
    await waitForDisplayed('bounded-pick', MAX, 'the upper clamp');

    // ...and the 31st of a month the target year does not have stays inside the
    // month rather than rolling over, which is the other clamp a calendar seam
    // needs (2026-02-31 has to mean 2026-02-28).
    handles.get('bounded-pick')?.nuiTestSelect(2026, 2, 31, 0, 0);
    const clampedDay = await waitForEvents(2);
    expect(clampedDay[1]).toBe(`bounded-pick:${String(localMs(2026, 2, 28))}`);

    handles.get('bounded-pick')?.nuiTestSelect(2020, 1, 1, 0, 0);
    const clampedLow = await waitForEvents(3);
    expect(clampedLow[2]).toBe(`bounded-pick:${String(MIN)}`);
    await waitForDisplayed('bounded-pick', MIN, 'the lower clamp');
    console.log(
      `clamping (${Platform.OS}, ${zoneNote()}): min=${String(MIN)} ` +
        `max=${String(MAX)} log=${JSON.stringify(eventLog)}`
    );
    unmount();
  });

  it('shows the month the value is in, and moves the page with it', async () => {
    // A Material 3 calendar has a *page* of its own (`displayedMonthMillis`) that the
    // model does not, and it is easy to hand it the wrong one:
    // `rememberDatePickerState`'s second positional argument is
    // `initialDisplayedMonthMillis` - *not* a minimum - so the call that read like a
    // minimum opened the calendar on today's month (or the minimum's), with the day the
    // field was showing off-screen. `docs/tasks/G5-datepicker/android-dialog.png` is
    // the record: `Jul 4, 2026` in the header over an October 2026 grid.
    //
    // The second half is that the state reads the month, the year range and the
    // selectable days once, at construction, so React widening the range has to
    // *rebuild* it: a calendar whose `yearRange` the value has outgrown stores `null`
    // for the selection it is handed, and then shows no day at all while the field
    // reads one. `calendarHasSelection` is the oracle for that, and the one the
    // rebuild has to satisfy.
    //
    // Both months are derived from the device's clock rather than fixed: with the
    // positional bug the page lands on *today's* month, so a hardcoded July would pass
    // by luck whenever the device was in July. The value is three months out, the
    // minimum four months before that, the rerender eleven months further again - no
    // two of them share a month with each other or with today.
    //
    // The calendar pair in the report is Android's (SwiftUI publishes neither fact),
    // so the month assertions are guarded and iOS runs this as the model-level check
    // it can be: the value, the page and the presentation still have to agree.
    const today = new Date();
    const target = new Date(
      today.getFullYear(),
      today.getMonth() + 3,
      4,
      12,
      0
    );
    const minimum = new Date(
      target.getFullYear(),
      target.getMonth() - 4,
      1,
      0,
      0
    );
    const moved = new Date(
      target.getFullYear() + 1,
      target.getMonth() + 2,
      15,
      9,
      30
    );
    const endOfTargetYear = new Date(target.getFullYear(), 11, 31, 23, 59);
    const endTwoYearsLater = new Date(target.getFullYear() + 2, 11, 31, 23, 59);
    // A value for the picker whose bounds never move. Only the model->picker effect can
    // follow this one: nothing rebuilds an unbounded calendar's state, so if the page
    // sync is missing, the day moves and the page does not.
    const laterPlain = new Date(
      target.getFullYear(),
      target.getMonth() + 6,
      9,
      8,
      15
    );
    const isAndroid = Platform.OS === 'android';

    const tree = (widened: boolean, plainValue = target) => (
      <View style={columnStyle}>
        <DatePicker
          value={plainValue}
          variant="inline"
          testID="page-plain"
          hybridRef={captureHybrid('page-plain')}
        />
        <DatePicker
          value={target}
          variant="inline"
          minimumDate={minimum}
          testID="page-min"
          hybridRef={captureHybrid('page-min')}
        />
        <DatePicker
          value={widened ? moved : target}
          variant="inline"
          maximumDate={widened ? endTwoYearsLater : endOfTargetYear}
          testID="page-bounded"
          hybridRef={captureHybrid('page-bounded')}
        />
        <DatePicker
          value={target}
          testID="page-dialog"
          hybridRef={captureHybrid('page-dialog')}
        />
      </View>
    );

    const { rerender, unmount } = await render(tree(false), {
      timeout: 20000,
    });
    for (const testId of [
      'page-plain',
      'page-min',
      'page-bounded',
      'page-dialog',
    ]) {
      await waitForTestId(testId);
    }
    for (const testId of ['page-plain', 'page-min', 'page-bounded']) {
      await waitForDisplayed(testId, target.getTime(), `the seed on ${testId}`);
    }
    if (isAndroid) {
      // No bounds: the page is the value's month, not the device's.
      await waitForMonth(
        'page-plain',
        target.getFullYear(),
        target.getMonth() + 1,
        'an unbounded calendar'
      );
      // A minimum a different month again: still the value's month, not the bound's.
      await waitForMonth(
        'page-min',
        target.getFullYear(),
        target.getMonth() + 1,
        'a bounded calendar'
      );
      await waitForMonth(
        'page-bounded',
        target.getFullYear(),
        target.getMonth() + 1,
        'a range-limited calendar'
      );
    }

    // The dialog the field opens has to start on the same page (this is the case the
    // screenshot showed wrong), and it is the presentation the count below is for.
    handles.get('page-dialog')?.nuiTestPresent();
    await waitForPresented('page-dialog', true, 'the field press');
    if (isAndroid) {
      await waitForMonth(
        'page-dialog',
        target.getFullYear(),
        target.getMonth() + 1,
        'the dialog calendar'
      );
    }
    await waitForLivePresentations('page-dialog', 1, 'the open dialog');
    // Left open on purpose: the seam opens a presentation and does not toggle it (a
    // dialog's own Cancel/OK and the tap outside are the platform's, not the harness's),
    // and `presents nothing after the mount that opened it is gone` is the test that
    // unmounts an open one and checks the count comes back to zero.

    // A programmatic value moves the page. Without this the example screen's "Reset to
    // 2026-01-01" selects a day on a page the user is not looking at.
    await rerender(tree(true));
    await waitForDisplayed(
      'page-bounded',
      moved.getTime(),
      'the widened range'
    );
    if (isAndroid) {
      await waitForMonth(
        'page-bounded',
        moved.getFullYear(),
        moved.getMonth() + 1,
        'the rebuilt range'
      );
      await pollUntil(
        () => (reportOf('page-bounded').calendarHasSelection === 1 ? 1 : null),
        () =>
          new Error(
            'the rebuilt calendar has no day selected: its report is ' +
              `"${handles.get('page-bounded')?.nuiTestStateReport() ?? '<no handle>'}" ` +
              `while the model displays ${String(moved.getTime())}. A ` +
              '`yearRange' +
              '` the value outgrew stores null, which is a calendar with no day ' +
              'and a field that says otherwise.'
          )
      );
      // The picker whose props did *not* move keeps its page: rebuilding the state of
      // the one whose range widened must not disturb its neighbours.
      await waitForMonth(
        'page-plain',
        target.getFullYear(),
        target.getMonth() + 1,
        'the picker whose props did not move'
      );
    }

    // Then a value-only change on that same unbounded picker. The page has to follow
    // the value with nothing rebuilding the state underneath - the example screen's
    // external "Reset" button is exactly this write, and a calendar left on the month
    // the user was looking at shows no selected day for it.
    await rerender(tree(true, laterPlain));
    await waitForDisplayed(
      'page-plain',
      laterPlain.getTime(),
      'the value-only move'
    );
    if (isAndroid) {
      await waitForMonth(
        'page-plain',
        laterPlain.getFullYear(),
        laterPlain.getMonth() + 1,
        'the value-only move'
      );
      // A neighbour that follows the page also keeps its *selection* lit.
      await pollUntil(
        () => (reportOf('page-plain').calendarHasSelection === 1 ? 1 : null),
        () =>
          new Error(
            'the unbounded calendar lost its day on a value-only move: ' +
              `"${handles.get('page-plain')?.nuiTestStateReport() ?? '<no handle>'}"`
          )
      );
    }
    console.log(
      `calendar page (${Platform.OS}, ${zoneNote()}): ` +
        `target=${target.toISOString()} minimum=${minimum.toISOString()} ` +
        `moved=${moved.toISOString()} ` +
        `plain=${handles.get('page-plain')?.nuiTestStateReport() ?? '-'} ` +
        `bounded=${handles.get('page-bounded')?.nuiTestStateReport() ?? '-'}`
    );
    unmount();
  });

  it('keeps the live control when a re-render sends a new bound instant', async () => {
    // `minimumDate={new Date()}` is the first example in
    // `docs/components/date-picker.md`, and it hands the control a *new instant* on
    // every render. Bounds reach a mounted calendar by rebuilding it - Material 3's
    // state reads `selectableDates`/`yearRange` once, and SwiftUI's control asserts when
    // a new date is clamped by a bound it still holds - so keying that rebuild on the
    // raw instants made every parent render (and every pick, which re-renders through
    // the same props) tear the platform control down: the month the user turned to, the
    // wheel's position, and an open dialog's or popover's pending selection with it.
    //
    // `controlBuilds` counts the platform controls this mount built, read once it has
    // stopped moving (`settledBuilds`). It has to stand still across re-renders that
    // only moved a bound's millisecond: an identity keyed on the raw instants makes
    // every one of them a new control, and everything the user had - the month they
    // turned to, an open dialog's pending selection - goes with it. A bound that moves
    // as far as the control can see must still get through; the two platforms let it
    // through differently enough that the test asserts each one's mechanism rather
    // than forcing one number on both (see the bound-that-moved step below).
    const value = new Date(2026, 6, 4, 12, 0);
    // The bound these assertions move along: `tick` is a few milliseconds (a new
    // instant inside one minute) or whole days (a bound the control can see).
    const baseMinimum = new Date(2026, 0, 1, 0, 0).getTime();
    const DAY = 86400000;
    // A different month, sent while the `compact` field's dialog is open. A rebuild
    // re-seeds the dialog's page from the value, so Android can see the same regression
    // the way a user does - through the page it is showing - not only through the count.
    const laterValue = new Date(2026, 8, 15, 9, 0);
    const isAndroid = Platform.OS === 'android';
    const reportText = (testId: string) =>
      handles.get(testId)?.nuiTestStateReport() ?? '<no handle>';

    const tree = (tick: number, dialogValue: Date, maximum?: Date) => (
      <View style={columnStyle}>
        <DatePicker
          value={value}
          variant="inline"
          minimumDate={new Date(baseMinimum + tick)}
          testID="fresh-inline"
          hybridRef={captureHybrid('fresh-inline')}
        />
        <DatePicker
          value={dialogValue}
          minimumDate={new Date(baseMinimum + tick)}
          maximumDate={maximum}
          testID="fresh-dialog"
          hybridRef={captureHybrid('fresh-dialog')}
        />
      </View>
    );

    const { rerender, unmount } = await render(tree(0, value), {
      timeout: 20000,
    });
    await waitForTestId('fresh-inline');
    await waitForTestId('fresh-dialog');
    await waitForDisplayed('fresh-inline', value.getTime(), 'the seed');

    // The instrument first: the sixth field has to be readable and counting, because a
    // missing one would make every assertion below vacuous. And it has to be read once it
    // has *stopped moving* (`settledBuilds`, shared with the escape-clause test), or a
    // baseline is a race. What a re-render may not do is add to the settled number,
    // which is why every assertion below is against a baseline.
    const buildsInline0 = await settledBuilds(
      'fresh-inline',
      'the seed of the fresh-instant test'
    );

    for (const tick of [1, 2, 3]) {
      await rerender(tree(tick, value));
    }
    await waitForDisplayed(
      'fresh-inline',
      value.getTime(),
      'the fresh-instant re-renders'
    );
    expect(reportOf('fresh-inline').controlBuilds).toBe(buildsInline0); // a millisecond of a bound is not a new calendar

    // The presentation is where a rebuild costs the most, so it gets its own half: open
    // it, re-render under it, and the control the user is interacting with has to still
    // be the one they started with.
    handles.get('fresh-dialog')?.nuiTestPresent();
    await waitForPresented('fresh-dialog', true, 'the field press');
    await waitForLivePresentations('fresh-dialog', 1, 'the open presentation');
    const buildsOpen = await settledBuilds(
      'fresh-dialog',
      'the open presentation'
    );
    if (isAndroid) {
      await waitForMonth('fresh-dialog', 2026, 7, 'the dialog as it opened');
    }

    // Two more renders under the open presentation, and a value that moved to another
    // month while it was up. A value-only change is not a rebuild, and since H2b it is
    // also not something the open dialog ignores: the model's value reaches an open
    // dialog in one direction only (it never *emits* - the pick stays provisional until
    // OK), so the page and the lit day follow React's value while the user is looking at
    // it. That is the G5 follow-up `docs/tasks/FOLLOWUPS.md` recorded and H2b fixed; the
    // round this case was written in asserted the opposite, because a page that stayed
    // put was the easiest visible sign that no rebuild had happened. The sign is now
    // ambiguous in exactly the wrong way - a rebuild would also land the dialog on the
    // value's month - so the rebuild is asserted with the instrument that cannot be
    // confused: the settled control-build count, plus a presentation that never went
    // down and came back.
    for (const tick of [4, 5]) {
      await rerender(tree(tick, laterValue));
    }
    await waitForDisplayed(
      'fresh-dialog',
      laterValue.getTime(),
      'the value moved under the open dialog'
    );
    expect(reportOf('fresh-dialog').controlBuilds).toBe(buildsOpen); // the open presentation was not rebuilt
    // The same control, still up: a rebuild tears the presentation down and this count
    // is read from the live one.
    await waitForLivePresentations(
      'fresh-dialog',
      1,
      'the presentation across a value that moved'
    );
    if (isAndroid) {
      // And the user sees the value the control has, not the one the dialog opened on.
      // Against a `followValueInDialog` that does not run, this stays on July and goes
      // red; against a rebuild, the count above goes red first.
      await waitForMonth(
        'fresh-dialog',
        laterValue.getFullYear(),
        laterValue.getMonth() + 1,
        'the open dialog following a value React wrote'
      );
    }

    // A bound that moved as far as the control can see still has to be *in force*, and
    // it is asserted here as something a user can see: `maximumDate` moves to the day
    // before the dialog's value, so the value has to be clamped down onto it. A re-key
    // that dropped the bound instead of moving with it would leave the value sitting
    // past its maximum.
    //
    // Android also gets the rebuild itself, because that is how a bound arrives there:
    // Compose's `key(selectable, yearRange)` re-creates the control and the count sees
    // it, which is what makes the Android half of this test red against the raw instants.
    // iOS gets no rebuild assertion. Its counter counts *appearances*, and an `.id(_:)`
    // change on a control that is already on screen was measured not to move it in
    // either direction - the raw bound instants give the same settled number as the
    // day-granular key - so on iOS the number can only say "nothing was put on screen
    // again", never "the control survived". What iOS asserts instead is the contract the
    // rebuild exists for: the presentation stays up, and the new bound is in force a
    // moment later. The one case where iOS genuinely needs a *fresh* control - a value
    // the live control would clamp against a bound it still holds - is the escape clause
    // of `controlIdentity`, driven by the `shows the month the value is in...` test.
    const clampedMaximum = new Date(laterValue.getTime() - DAY);
    await rerender(tree(6 + DAY, laterValue, clampedMaximum));
    await waitForLivePresentations(
      'fresh-dialog',
      1,
      'the presentation across a bound that moved'
    );
    await waitForDisplayed(
      'fresh-dialog',
      clampedMaximum.getTime(),
      'a maximum a day before the value'
    );
    if (isAndroid) {
      for (const [testId, baseline] of [
        ['fresh-dialog', buildsOpen],
        ['fresh-inline', buildsInline0],
      ] as const) {
        await pollUntil(
          () =>
            reportOf(testId).controlBuilds > baseline
              ? reportOf(testId).controlBuilds
              : null,
          () =>
            new Error(
              `a whole day of movement in \`minimumDate\` did not rebuild ` +
                `"${testId}": "${reportText(testId)}" still reports ` +
                `${String(reportOf(testId).controlBuilds)} builds, want more than ` +
                `${String(baseline)}. A calendar that never rebuilds cannot take new ` +
                `bounds, and Material 3's state reads them once.`
            )
        );
      }
    }
    console.log(
      `re-render bounds (${Platform.OS}, ${zoneNote()}): ` +
        `value=${value.toISOString()} later=${laterValue.toISOString()} ` +
        `inline=${reportText('fresh-inline')} ` +
        `dialog=${reportText('fresh-dialog')}`
    );
    unmount();
  });

  it('records the bounds the control it just built was built with', async () => {
    // The rebuild decision (`controlIdentity` on iOS, `key(selectable, yearRange)` on
    // Android) and the record of *what the live control holds* have to agree, because
    // iOS's own escape clause reads that record: a value that has left the range the
    // control ON SCREEN was built with is one more reason to rebuild, since
    // `UIDatePicker` clamps such a value inside its own update and the reload that
    // follows asserts in `UICalendarView _setVisibleMonth:`.
    //
    // Until F3 the two disagreed on iOS: `.onAppear` sat *outside* `.id(_:)`, so it
    // fired once per mount and `builtBounds` froze there - while the identity, and the
    // control, went on changing (`docs/tasks/FOLLOWUPS.md` row 46). That costs a
    // rebuild for every later crossing of a bound the live control does not hold, and
    // it makes the escape clause check the value against bounds nobody is showing.
    //
    // The oracle is the pair `readReport()` now ends with - the bounds recorded *at
    // the build* - plus the build count, because the failure was precisely that a
    // rebuild happened without the record moving. Android is the control half: it
    // records at the same moment Compose builds the state, so it passes either way
    // and proves the assertions are about the mechanism rather than about one
    // platform's quirk.
    const MIN = localMs(2026, 0, 1, 0, 0);
    const FIRST_MAX = localMs(2026, 0, 20, 12, 0);
    const WIDER_MAX = localMs(2026, 1, 20, 12, 0);
    const INSIDE_FIRST = localMs(2026, 0, 10, 12, 0);
    // Inside the widened range and outside the first build's, so the two readings of
    // the record disagree about whether this value needs a fresh control.
    const BETWEEN = localMs(2026, 1, 10, 12, 0);
    // Truncated to whole seconds: `readReport()` publishes the bounds as integers, so
    // a sub-second difference would look like a mismatch here even though the control
    // holds exactly the instant React sent (and `maximumMillis` above already proves
    // the wire is exact).
    const truncated = (millis: number) => Math.trunc(millis / 1000) * 1000;
    const boundOf = (testId: string, which: 'builtMinimum' | 'builtMaximum') =>
      reportOf(testId)[which];
    const isAndroid = Platform.OS === 'android';

    // `inline`, because that is the variant whose platform control is on screen the
    // whole time: a `compact` field composes no calendar until its dialog opens, so
    // neither the record nor the count would move.
    const tree = (maximum: number, value: number) => (
      <DatePicker
        value={new Date(value)}
        variant="inline"
        minimumDate={new Date(MIN)}
        maximumDate={new Date(maximum)}
        testID="built-bounds"
        hybridRef={captureHybrid('built-bounds')}
      />
    );

    const { rerender, unmount } = await render(tree(FIRST_MAX, INSIDE_FIRST), {
      timeout: 20000,
    });
    await waitForTestId('built-bounds');
    await waitForDisplayed('built-bounds', INSIDE_FIRST, 'the seed');
    // The bounds arrive after the first commit, so the control may well be built once
    // with none of them; what has to be true is that the record ends up describing the
    // control that is up. This is already red on iOS before the fix when the control
    // appeared before its bounds did, and the assertions below are red either way.
    await pollUntil(
      () =>
        boundOf('built-bounds', 'builtMaximum') === truncated(FIRST_MAX)
          ? truncated(FIRST_MAX)
          : null,
      () =>
        new Error(
          `the record never became the bounds the mount started with: report is ` +
            `"${handles.get('built-bounds')?.nuiTestStateReport() ?? '<no handle>'}", ` +
            `want builtMaximum ${String(truncated(FIRST_MAX))} (first maximumDate).`
        )
    );
    const built0 = await settledBuilds('built-bounds', 'the seed');
    expect(boundOf('built-bounds', 'builtMinimum')).toBe(truncated(MIN));

    // Bounds and value move together - one batch, the shape of the crash the escape
    // clause exists for.
    await rerender(tree(WIDER_MAX, BETWEEN));
    await waitForDisplayed('built-bounds', BETWEEN, 'the widened range');
    const widened = await settledBuilds('built-bounds', 'the widened bounds');
    const afterWiden = reportOf('built-bounds');
    console.log(
      `built bounds (${Platform.OS}): built0=${String(built0)} ` +
        `afterWiden=${String(widened)} report="${
          handles.get('built-bounds')?.nuiTestStateReport() ?? '<no handle>'
        }" firstMax=${String(truncated(FIRST_MAX))} ` +
        `widerMax=${String(truncated(WIDER_MAX))} between=${String(BETWEEN)}`
    );
    // The rebuild itself, on both platforms. On Android this is `key(...)` re-creating
    // the state; on iOS it is the `.id(_:)` replacement, which the counter could not
    // see while the appearance handler sat *outside* the identity - the handler
    // belonged to the structure that survives a re-identification, so the count was
    // blind to every rebuild (that blindness is `keeps the live control…`'s reason for
    // saying iOS gets no rebuild assertion at all, and it is the same fact row 46
    // recorded about `builtBounds`). With the handler inside the identity, one bounds
    // change is one appearance of one control, on either platform.
    expect(widened).toBeGreaterThan(built0);
    // And the record describes the control that is on screen. Red on iOS before the
    // move: the record still said `firstMax` (or nothing at all, if the control had
    // appeared before its bounds did) while the identity, the control and React all
    // said `widerMax`.
    expect(afterWiden.builtMaximum).toBe(truncated(WIDER_MAX));
    expect(afterWiden.builtMinimum).toBe(truncated(MIN));

    // And now nothing moves but the value, across the bound the *first* build held. A
    // control that holds `WIDER_MAX` has no reason to be rebuilt.
    for (const value of [INSIDE_FIRST, BETWEEN, INSIDE_FIRST]) {
      await rerender(tree(WIDER_MAX, value));
      await waitForDisplayed(
        'built-bounds',
        value,
        'the value across the first build’s bound'
      );
    }
    const afterFlips = await settledBuilds(
      'built-bounds',
      'three crossings of the first build’s bound'
    );
    if (isAndroid) {
      expect(afterFlips).toBe(widened); // no bound moved, so no control was rebuilt
    }
    expect(boundOf('built-bounds', 'builtMaximum')).toBe(truncated(WIDER_MAX));
    unmount();
  });

  it('round-trips an instant across a DST boundary', async () => {
    // The value on the wire is an instant and both platforms' pickers speak in
    // calendar fields - Material 3 stores a *UTC midnight* per day, SwiftUI a
    // `Date` - so the conversion between the two is where an hour, or a day, goes
    // missing. Both directions:
    //  - `dst-set`: React writes an instant, native shows it unchanged
    //    (`nuiTestStateReport` is native's own reading), and - the half that used to
    //    be missing - says nothing about it. A conversion that reads the wrong day
    //    makes the control *emit* the instant it just painted, which a controlled
    //    parent then refuses, and a polling test cannot see the round trip. The
    //    recorder makes the spurious event visible.
    //  - `dst-pick`: uncontrolled, so a pick's calendar fields have to produce JS's
    //    own instant. On Android the seam runs the day through the picker's own
    //    `toUtcMidnightOfLocalDay`/`fromUtcMidnightKeepingTimeOfDay` pair, exactly as
    //    a day cell does.
    //
    // The zone is asserted, not assumed - nothing in this suite sets it, so an
    // environment that moved the device to `UTC` used to make this test pass without
    // crossing a transition. Two checks, both loud:
    //  - the zone must observe DST at all (a January and a July offset differ);
    //  - at least one of *these* instants must have a local day that is not its UTC
    //    day, because that is what the conversion exists to get right. A noon instant
    //    has the same day number in every zone on the planet, so an hour-skipping
    //    conversion error would sail through it - which is how the mutation that
    //    deleted the conversion altogether stayed green here. Hence the 00:30 and
    //    23:45 pairs: one of them lands on another UTC day in any zone with a
    //    non-zero offset, and the check below says so if neither does.
    const winterOffset = new Date(2026, 0, 1).getTimezoneOffset();
    const summerOffset = new Date(2026, 6, 1).getTimezoneOffset();
    const zoneDescription = new Date(2026, 6, 1).toString();
    console.log(
      `dst zone: ${zoneDescription} winterOffset=${String(winterOffset)} ` +
        `summerOffset=${String(summerOffset)}`
    );
    expect(winterOffset).not.toBe(summerOffset); // the device is not observing DST, so nothing here crosses a boundary

    const WINTER = localMs(2026, 1, 5, 12, 30);
    const SUMMER = localMs(2026, 7, 5, 12, 30);
    const SPRING_DAY = localMs(2026, 3, 29, 12, 30);
    const AUTUMN_EVE = localMs(2026, 10, 24, 23, 45);
    const AUTUMN_DAY = localMs(2026, 10, 25, 23, 45);
    // The two that make the UTC-midnight conversion observable. 00:30 is the day
    // before in UTC for a zone ahead of it (Lisbon in summer: 23:30Z), 23:45 is the
    // day after in UTC for a zone behind it, and both are times that exist on every
    // date used here.
    const SUMMER_JUST_AFTER_MIDNIGHT = localMs(2026, 7, 5, 0, 30);
    const WINTER_JUST_BEFORE_MIDNIGHT = localMs(2026, 1, 5, 23, 45);
    const discriminating = [
      WINTER,
      SUMMER,
      SPRING_DAY,
      AUTUMN_EVE,
      AUTUMN_DAY,
      SUMMER_JUST_AFTER_MIDNIGHT,
      WINTER_JUST_BEFORE_MIDNIGHT,
    ].filter(
      (millis) => new Date(millis).getUTCDate() !== new Date(millis).getDate()
    );
    console.log(
      `dst cases: ${String(discriminating.length)} of 7 cross a UTC day - ` +
        `summerNight=${String(SUMMER_JUST_AFTER_MIDNIGHT)} ` +
        `winterLate=${String(WINTER_JUST_BEFORE_MIDNIGHT)}`
    );
    expect(discriminating.length).toBeGreaterThan(0); // no instant here has a local day that differs from its UTC day: in this zone the conversion cannot be observed, and the test would pass vacuously

    const { rerender, unmount } = await render(
      <View style={columnStyle}>
        <DatePicker
          value={new Date(WINTER)}
          mode="datetime"
          variant="inline"
          testID="dst-set"
          onChange={recordChange('dst-set')}
          hybridRef={captureHybrid('dst-set')}
        />
        <DatePicker
          defaultValue={new Date(AUTUMN_EVE)}
          mode="datetime"
          onChange={recordChange('dst-pick')}
          testID="dst-pick"
          hybridRef={captureHybrid('dst-pick')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('dst-set');
    await waitForTestId('dst-pick');
    await waitForDisplayed('dst-set', WINTER, 'the winter instant');
    expect(handles.get('dst-set')?.valueMillis).toBe(WINTER);
    expect(eventLog).toEqual([]); // a controlled write is not a pick: saying otherwise is the bug

    for (const [label, millis] of [
      ['summer', SUMMER],
      ['spring-forward day', SPRING_DAY],
      ['day before the autumn change', AUTUMN_EVE],
      ['autumn change day', AUTUMN_DAY],
      ['summer instant just after midnight', SUMMER_JUST_AFTER_MIDNIGHT],
      ['winter instant just before midnight', WINTER_JUST_BEFORE_MIDNIGHT],
    ] as const) {
      await rerender(
        <View style={columnStyle}>
          <DatePicker
            value={new Date(millis)}
            mode="datetime"
            variant="inline"
            testID="dst-set"
            onChange={recordChange('dst-set')}
            hybridRef={captureHybrid('dst-set')}
          />
          <DatePicker
            defaultValue={new Date(AUTUMN_EVE)}
            mode="datetime"
            onChange={recordChange('dst-pick')}
            testID="dst-pick"
            hybridRef={captureHybrid('dst-pick')}
          />
        </View>
      );
      await waitForDisplayed('dst-set', millis, `the ${label} instant`);
      expect(handles.get('dst-set')?.valueMillis).toBe(millis);
      expect(eventLog).toEqual([]); // and none of them made the control report a pick
    }

    // The other direction, on the uncontrolled instance: the same fields, in the
    // order a user produces them, must produce JS's own instants.
    // Each pick is a different instant from the one before it, including the
    // `defaultValue` this instance was seeded with (`AUTUMN_EVE`): the suppression
    // rule means a pick of the instant already showing reports nothing, and a
    // missing line here would read as a DST failure.
    const picks: ReadonlyArray<
      readonly [number, number, number, number, number, number]
    > = [
      [2026, 1, 5, 12, 30, WINTER],
      [2026, 3, 29, 12, 30, SPRING_DAY],
      [2026, 10, 25, 23, 45, AUTUMN_DAY],
      [2026, 7, 5, 0, 30, SUMMER_JUST_AFTER_MIDNIGHT],
      [2026, 1, 5, 23, 45, WINTER_JUST_BEFORE_MIDNIGHT],
    ];
    for (const [
      index,
      [year, month, day, hour, minute, millis],
    ] of picks.entries()) {
      handles.get('dst-pick')?.nuiTestSelect(year, month, day, hour, minute);
      const logged = await waitForEvents(index + 1);
      expect(logged[index]).toBe(`dst-pick:${String(millis)}`);
    }
    console.log(
      `dst (${Platform.OS}, ${zoneNote()}): winter=${String(WINTER)} ` +
        `summer=${String(SUMMER)} spring=${String(SPRING_DAY)} ` +
        `autumnEve=${String(AUTUMN_EVE)} autumn=${String(AUTUMN_DAY)} ` +
        `summerNight=${String(SUMMER_JUST_AFTER_MIDNIGHT)} ` +
        `winterLate=${String(WINTER_JUST_BEFORE_MIDNIGHT)}`
    );
    unmount();
  });

  it('presents nothing after the mount that opened it is gone', async () => {
    // The B1 rule for the one control in this library with a window of its own: a
    // Material 3 `Dialog` is a second window and UIKit's popover is a view the
    // presenting controller hosts, so either one that outlived the mount would sit on
    // top of an app that can no longer close it.
    //
    // The witness press below is the *second* signal, not the first. On its own it was
    // not enough: the kept mutation that stops `onDropView` from closing the Android
    // dialog or disposing its composition (`/tmp/g5-mut/android-t6b.py`) left the
    // window on screen and this press still landed, because a `Dialog` is a separate
    // window and the harness dispatches its touch into the app's own. So the primary
    // assertion is structural - the process-wide count of live presentations, which
    // each platform keeps in the one place that survives a drop.
    //
    // It is read through a *fresh* mount, because the dropped view has no handle left:
    // the count is process-wide, so a picker that never presented anything reports how
    // many presentations exist. And it is asserted at 1 while the dialog is open,
    // because a counter stuck at zero would otherwise satisfy every assertion after
    // this one vacuously.
    const presses: number[] = [];
    const Witness = () => (
      <Pressable
        onPress={() => {
          presses.push(1);
        }}
        testID="witness"
      >
        <Text>Witness</Text>
      </Pressable>
    );

    const first = await render(
      <View style={columnStyle}>
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          testID="opener"
          hybridRef={captureHybrid('opener')}
        />
        <Witness />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('witness');
    await waitForTestId('opener');

    // Nothing else in this process is presenting: the count starts at zero.
    await waitForLivePresentations('opener', 0, 'the untouched process');
    handles.get('opener')?.nuiTestPresent();
    await waitForPresented('opener', true, 'the field press');
    // Opening is not picking: the instant and the event log are untouched.
    expect(displayedOf('opener')).toBe(localMs(2026, 7, 4));
    expect(eventLog).toEqual([]);
    await waitForLivePresentations('opener', 1, 'the open presentation');

    first.unmount();
    await settle(300);
    handles.clear();
    expect(sizeOf('opener')).toBeNull();

    const second = await render(
      <View style={columnStyle}>
        <DatePicker
          defaultValue={new Date(2026, 6, 4)}
          testID="probe"
          hybridRef={captureHybrid('probe')}
        />
        <Witness />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('probe');
    // The structural half: the mount that opened the window is gone, so nothing may
    // still be presenting. This is the assertion the Android leak mutation failed.
    await waitForLivePresentations('probe', 0, 'the mount after the drop');
    // The second half, and the one the leak mutation did not fail: a window that is
    // really on top of the app also swallows a press.
    const witness = await waitForTestId('witness');
    await userEvent.press(witness);
    await pollUntil(
      () => (presses.length >= 1 ? true : null),
      () =>
        new Error(
          'A press on a plain Pressable did not land after the picker was dropped ' +
            'with its presentation open, which is what a surviving popover or dialog ' +
            'window looks like from here. The count above already says whether one ' +
            'is up; this says whether it is in the way.'
        )
    );
    expect(presses.length).toBeGreaterThanOrEqual(1);
    second.unmount();
  });

  it('is inert while disabled', async () => {
    // `disabled` has no native equivalent for a calendar or a clock: Material 3's
    // `DatePicker` has no `enabled`, and SwiftUI's `.disabled` cannot reach the
    // `nuiTestSelect` path. What the prop has to mean is "nothing the user does
    // can change the app's date", which is assertable on the seam: no presentation,
    // no selection, no event.
    const PINNED = localMs(2026, 6, 4);
    const { unmount } = await render(
      <DatePicker
        value={new Date(PINNED)}
        disabled
        onChange={recordChange('locked')}
        testID="locked"
        hybridRef={captureHybrid('locked')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('locked');
    await waitForDisplayed('locked', PINNED, 'the pinned value');

    handles.get('locked')?.nuiTestPresent();
    handles.get('locked')?.nuiTestSelect(2027, 1, 15, 9, 30);
    await settle(400);
    expect(reportOf('locked').presented).toBe(false);
    expect(displayedOf('locked')).toBe(PINNED);
    expect(eventLog).toEqual([]);
    console.log(
      `disabled (${Platform.OS}): report="${
        handles.get('locked')?.nuiTestStateReport() ?? '<none>'
      }" log=${JSON.stringify(eventLog)}`
    );
    unmount();
  });

  it('gives two compact pickers one box, whatever dates they show', async () => {
    // The sizing decision this component had to make (brief: "the field width
    // depends on locale formatting - decide and justify, with a test"). The key is
    // `variant|mode` and the *value is deliberately not in it*, because two
    // instances that share a key share the engine's one size for it: if a field's
    // width depended on the date it shows, every pair of pickers on one screen
    // would spend the process correcting each other's box. Asserted twice:
    //  - two instances, two very different dates, one box, and both boxes are the
    //    size the control measures rather than the poisoned guess;
    //  - one instance, the same key, its date moved from the narrowest day to the
    //    widest the mode can produce: the box must not move, and no correction is
    //    allowed - the entry is already exact (D17), which is only true while the
    //    width is value-independent.
    const NARROW = new Date(2026, 8, 1, 0, 0); //  Sep  1, 2026
    const WIDE = new Date(2288, 10, 28, 0, 0); //  Nov 28, 2288
    poisonConfigurations([sizingKey('compact', 'date')]);
    const { rerender, unmount } = await render(
      <View style={columnStyle}>
        <DatePicker
          defaultValue={NARROW}
          testID="narrow"
          hybridRef={captureHybrid('narrow')}
        />
        <DatePicker
          defaultValue={WIDE}
          testID="wide"
          hybridRef={captureHybrid('wide')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('narrow');
    await waitForTestId('wide');
    const narrowSize = await waitForMeasured('narrow', 'the 2026 field');
    await waitForBox('narrow', narrowSize, 'the 2026 field');
    const wideSize = await waitForMeasured('wide', 'the 2288 field');
    // One key, so one answer - and it is the answer the control gives, not the
    // fallback the engine guessed. A width that followed the date would put these
    // two fields at different widths and leave one box wrong.
    expect(sameSize(wideSize, narrowSize)).toBe(true);
    // Polled: two instances of one cold configuration are corrected on separate
    // turns, and Android in particular settles the second box after the control
    // has already reported its size.
    await waitForBox('wide', narrowSize, 'the 2288 field');
    expect(sameSize(sizeOf('narrow'), WRONG_SIZE)).toBe(false);
    // Not degenerate: the field really is a field, wider than the 44 pt floor the
    // implementation clamps its probe to.
    expect(narrowSize.width).toBeGreaterThan(44);

    // Second half: the same instance, a different date, and the box holds.
    await settle(400);
    const before = stats();
    await rerender(
      <View style={columnStyle}>
        <DatePicker
          defaultValue={WIDE}
          testID="narrow"
          hybridRef={captureHybrid('narrow')}
        />
        <DatePicker
          defaultValue={WIDE}
          testID="wide"
          hybridRef={captureHybrid('wide')}
        />
      </View>
    );
    await settle(400);
    const after = delta(before, stats());
    console.log(
      `pair (${Platform.OS}, ${zoneNote()}): narrow=${describeSize(narrowSize)} ` +
        `wide=${describeSize(wideSize)} box=${describeSize(sizeOf('narrow'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(sameSize(sizeOf('narrow'), narrowSize)).toBe(true);
    expect(sameSize(measured('narrow'), narrowSize)).toBe(true);
    // A configuration whose cached size is exact costs no correction. With the
    // value in the key - or a field that sized itself to its own string - the
    // 2288 date wants a different box and this counter moves.
    expect(after.corrections).toBe(0);
    unmount();
  });

  it('keeps a date field and a time field at their own boxes', async () => {
    // The other half of the sizing-key decision. `mode` IS in the key, so a date
    // field and a time field are two configurations with two cached answers;
    // `gives two compact pickers one box` covers the input that is deliberately
    // *not* in it. Take the mode out and the pair shares one cached width, which
    // cannot be right for both - the claim here is that each box ends up at its
    // own control's size rather than at the one answer the key can hold.
    poisonConfigurations([
      sizingKey('compact', 'date'),
      sizingKey('compact', 'time'),
    ]);
    const { unmount } = await render(
      <View style={columnStyle}>
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 13, 45)}
          testID="key-date"
          hybridRef={captureHybrid('key-date')}
        />
        <DatePicker
          defaultValue={new Date(2026, 6, 4, 13, 45)}
          mode="time"
          testID="key-time"
          hybridRef={captureHybrid('key-time')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('key-date');
    await waitForTestId('key-time');
    const dateSize = await waitForMeasured('key-date', 'the date field');
    await waitForBox('key-date', dateSize, 'the date field');
    const timeSize = await waitForMeasured('key-time', 'the time field');
    await waitForBox('key-time', timeSize, 'the time field');
    console.log(
      `mode-keys (${Platform.OS}, ${zoneNote()}): date=${describeSize(dateSize)} ` +
        `time=${describeSize(timeSize)} boxes=${describeSize(
          sizeOf('key-date')
        )}/${describeSize(sizeOf('key-time'))} ` +
        `probeDate="${probeTextOf('date')}" probeTime="${probeTextOf('time')}"`
    );
    // Two configurations: the widest date a `date` field can show is wider than
    // the widest time, in every locale these two devices run.
    expect(dateSize.width).toBeGreaterThan(timeSize.width + 1);
    // And each is laid out at its own size. One shared key would leave the
    // narrower of the two at the wider one's box, or set both chasing a cache
    // entry that is right for neither.
    expect(sameSize(sizeOf('key-date'), dateSize)).toBe(true);
    expect(sameSize(sizeOf('key-time'), timeSize)).toBe(true);
    unmount();
  });

  it('re-measures the field when the mode changes', async () => {
    // `mode` is in the key, so `compact|date` and `compact|time` are two
    // configurations. Drop the mode off the key and a time field keeps the date
    // field's box: the planted size below is the *date* field's own box, so the
    // only thing that can move the control is a new configuration's answer.
    const DATE = 'mode-date';
    const { rerender, unmount } = await render(
      <DatePicker
        defaultValue={new Date(2026, 6, 4, 13, 45)}
        testID={DATE}
        hybridRef={captureHybrid(DATE)}
      />,
      { timeout: 20000 }
    );
    await waitForTestId(DATE);
    const dateSize = await waitForMeasured(DATE, 'the date field');
    await waitForBox(DATE, dateSize, 'the date field');

    nitroUiCore.seedSizingSize(
      COMPONENT,
      sizingKey('compact', 'time'),
      dateSize.width,
      dateSize.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    await settle(200);
    const before = stats();

    await rerender(
      <DatePicker
        defaultValue={new Date(2026, 6, 4, 13, 45)}
        mode="time"
        testID={DATE}
        hybridRef={captureHybrid(DATE)}
      />
    );
    await settle(600);
    const now = measured(DATE);
    const after = delta(before, stats());
    // Logged before the assertions: this test's whole value is the difference
    // between a date field and a time field, and a locale where they are the same
    // width has to be visible in the output rather than as a bare `false`.
    console.log(
      `mode-change (${Platform.OS}, ${zoneNote()}): date=${describeSize(dateSize)} ` +
        `time=${describeSize(now)} box=${describeSize(sizeOf(DATE))} ` +
        `probeDate="${probeTextOf('date')}" probeTime="${probeTextOf('time')}" ` +
        `delta=${JSON.stringify(after)}`
    );
    // A time field is narrower than a date field in every locale this is measured
    // in, so the planted answer is provably wrong for the new configuration...
    expect(now !== null && now.width < dateSize.width - 1).toBe(true);
    // ...the box followed the control rather than the guess, and the engine
    // recorded a correction for the key that includes the mode.
    expect(sameSize(sizeOf(DATE), now)).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it("starts a remount from its own default, not the previous mount's", async () => {
    // The `RecyclableView` reset, from the outside. A recycled instance whose
    // model kept the old instant, or whose `didApplyDefault` flag survived, paints
    // a date its React element never mentioned — invisible to the box and to the
    // handle's `valueMillis` (which reports what *React* sent). The report is what
    // can see it, and a presentation left open by the dropped mount is read the
    // same way.
    const DEFAULT_DAY = localMs(2026, 6, 4);
    const PICKED = localMs(2027, 1, 15);
    const tree = () => (
      <View style={columnStyle}>
        <DatePicker
          defaultValue={new Date(DEFAULT_DAY)}
          onChange={recordChange('recycled')}
          testID="recycled"
          hybridRef={captureHybrid('recycled')}
        />
      </View>
    );

    const first = await render(tree(), { timeout: 20000 });
    await waitForTestId('recycled');
    await waitForDisplayed('recycled', DEFAULT_DAY, 'the first default');
    handles.get('recycled')?.nuiTestSelect(2027, 1, 15, 0, 0);
    await waitForEvents(1);
    await waitForDisplayed('recycled', PICKED, 'the first pick');
    // Open the presentation *and* pick, so the dropped mount leaves both kinds of
    // state behind if either survives.
    handles.get('recycled')?.nuiTestPresent();
    await waitForPresented('recycled', true, 'the first presentation');
    first.unmount();
    await settle(200);
    handles.clear();

    const second = await render(tree(), { timeout: 20000 });
    await waitForTestId('recycled');
    await waitForMeasured('recycled', 'the remounted field');
    // No correction is required here, but the report is only meaningful once the
    // control has committed, so wait for that and then read it.
    await settle(200);
    const state = reportOf('recycled');
    console.log(
      `remount (${Platform.OS}): report="${
        handles.get('recycled')?.nuiTestStateReport() ?? '<none>'
      }" expected=${String(DEFAULT_DAY)}|0`
    );
    expect(state.millis).toBe(DEFAULT_DAY);
    expect(state.presented).toBe(false);
    // The new mount has emitted nothing of its own.
    expect(eventLog).toHaveLength(1);
    // And it is the *default* rather than a value it could have inherited: the
    // pick above proves the seam works, so a remount showing 2027-01-15 could only
    // come from state that survived.
    expect(state.millis).not.toBe(PICKED);
    second.unmount();
  });
});
