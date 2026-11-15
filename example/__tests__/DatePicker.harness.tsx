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
import { deviceZone } from './deviceContext';

/** The Fabric name — what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiDatePicker';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** Declared here: Hybrid View types are not part of the public API. */
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
   * `|`-separated fields, in the order `reportOf` parses them. The calendar's
   * month and selection are Android-only: iOS reports `-1` for both.
   */
  nuiTestStateReport(): string;
};

const handles = new Map<string, DatePickerHandle>();
const captureHybrid =
  (testId: string) =>
  (view: DatePickerHandle): void => {
    handles.set(testId, view);
  };

/** Every `onChange` the app has reported, in order: `testID:millis`. */
const eventLog: string[] = [];
const recordChange =
  (testId: string) =>
  (date: Date): void => {
    eventLog.push(`${testId}:${String(date.getTime())}`);
  };

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

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

/** What native reports it is showing, parsed. */
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
   * How many times this mount built its platform control. It moves only when a
   * bounds change rebuilds the live control.
   */
  controlBuilds: number;
  /**
   * The bounds the platform control on screen was built with (`-1` = no control
   * built yet, `-2` = that bound is unset).
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
 * The platform-build count of `testId` once it has stopped moving. A mount is
 * built again while its props land (the bounds arrive after the first commit),
 * so a count sampled early is a race: rebuild assertions compare against this.
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

/** Polled: a host measures after its first commit. */
async function waitForMeasured(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

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
 * Poll until the box is `width` wide and as tall as the control reports. A
 * Material 3 calendar lays out twice as its year range and selectable dates
 * land, so a single read of `measureContent()` can be a frame old.
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
 * The sizing key `DatePicker.tsx` builds: `"<variant>|<mode>"`. Written out
 * rather than imported, so a wrong key in the library cannot hide itself. The
 * date is deliberately not part of it.
 */
function sizingKey(variant: string, mode: string): string {
  return `${variant}|${mode}`;
}

/**
 * A size no date picker has, planted as the cached answer before a first mount
 * so that a correction which never arrives leaves a visibly wrong box.
 */
const WRONG_SIZE = { width: 13.25, height: 66.5 };

/**
 * Plant a wrong size for each configuration, then invalidate: invalidating
 * keeps the last known size as the guess a cold mount starts from.
 */
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
 * A local instant from calendar fields, resolved in the device's time zone as
 * native resolves the fields `nuiTestSelect` is given. `month` is 1-12.
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

function zoneNote(): string {
  const offsetMinutes = new Date().getTimezoneOffset();
  return `tzOffset=${String(offsetMinutes)}`;
}

/** The widest string `mode` can format. Only for the log lines. */
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
    // `compact` sizes to its own width; `inline` and `wheel` take the caller's
    // width and the control's height.
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
    expect(fieldSize.width).toBeLessThan(320);

    for (const testId of ['inline', 'wheel']) {
      const size = await waitForMeasured(testId, `the ${testId} picker`);
      await waitForBoxToMatchMeasured(testId, 320, `the ${testId} picker`);
      expect(size.height).toBeGreaterThan(100);
    }

    const after = delta(before, stats());
    console.log(
      `variants (${Platform.OS}, ${zoneNote()}): field=${describeSize(fieldSize)} ` +
        `inline=${describeSize(sizeOf('inline'))} wheel=${describeSize(sizeOf('wheel'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    // Three poisoned configurations, so each owes a correction.
    expect(after.corrections).toBeGreaterThanOrEqual(3);
    expect(sameSize(sizeOf('field'), WRONG_SIZE)).toBe(false);
    unmount();
  });

  it('reports a pick once, and nothing for the same day', async () => {
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
    await waitForDisplayed('pick', localMs(2026, 6, 4), 'the default');
    // Uncontrolled means React sent no instant, so there is nothing to read back.
    expect(handles.get('pick')?.valueMillis).toBeNull();

    handles.get('pick')?.nuiTestSelect(2027, 1, 15, 0, 0);
    const first = await waitForEvents(1);
    // `mode="date"` shows no clock, so the hour and minute passed are ignored.
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
    // A picker that has reverted shows the parent's date again, so the same pick
    // is a change again and reports a second event.
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
    // Two controls: a controlled picker's clamped pick is refused by its parent,
    // so only an uncontrolled one can stay on the bound and be read back.
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
    handles.get('bounded-pick')?.nuiTestSelect(2031, 6, 1, 0, 0);
    const clampedHigh = await waitForEvents(1);
    expect(clampedHigh).toEqual([`bounded-pick:${String(MAX)}`]);
    await waitForDisplayed('bounded-pick', MAX, 'the upper clamp');

    // A day the month does not have stays inside the month rather than rolling
    // over: 2026-02-31 means 2026-02-28.
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
    // The months are derived from the device's clock so that none of them is
    // today's: a calendar that wrongly opened on today's month would pass a
    // hardcoded month whenever the device was in it.
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
    // For the picker whose bounds never move: nothing rebuilds its calendar, so
    // its page has to follow the value on its own.
    const laterPlain = new Date(
      target.getFullYear(),
      target.getMonth() + 6,
      9,
      8,
      15
    );
    // The calendar's month and selection are reported on Android only.
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
      await waitForMonth(
        'page-plain',
        target.getFullYear(),
        target.getMonth() + 1,
        'an unbounded calendar'
      );
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
    // Left open on purpose: the test seam opens a presentation and cannot close it.

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
      await waitForMonth(
        'page-plain',
        target.getFullYear(),
        target.getMonth() + 1,
        'the picker whose props did not move'
      );
    }

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
    // `minimumDate={new Date()}` hands the control a new instant on every render,
    // and bounds reach a mounted calendar only by rebuilding it. A rebuild keyed
    // on the raw instant would discard the user's page and any open dialog.
    const value = new Date(2026, 6, 4, 12, 0);
    // `tick` moves the bound by a few milliseconds or by whole days.
    const baseMinimum = new Date(2026, 0, 1, 0, 0).getTime();
    const DAY = 86400000;
    // A different month, sent while the `compact` field's dialog is open.
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

    // A value-only change does not rebuild, and an open dialog follows it: its
    // page and lit day track the value React sends. A rebuild would also land on
    // the value's month, so the build count is what tells the two apart.
    for (const tick of [4, 5]) {
      await rerender(tree(tick, laterValue));
    }
    await waitForDisplayed(
      'fresh-dialog',
      laterValue.getTime(),
      'the value moved under the open dialog'
    );
    expect(reportOf('fresh-dialog').controlBuilds).toBe(buildsOpen); // the open presentation was not rebuilt
    await waitForLivePresentations(
      'fresh-dialog',
      1,
      'the presentation across a value that moved'
    );
    if (isAndroid) {
      await waitForMonth(
        'fresh-dialog',
        laterValue.getFullYear(),
        laterValue.getMonth() + 1,
        'the open dialog following a value React wrote'
      );
    }

    // A bound that moves by a whole day must take effect: `maximumDate` lands on
    // the day before the dialog's value, so the value is clamped down onto it.
    // Both controls are rebuilt for it, and the presentation stays up.
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
            `a whole day of movement in \`minimumDate\`, with a \`maximumDate\` that ` +
              `did not exist before, did not rebuild "${testId}": ` +
              `"${reportText(testId)}" still reports ` +
              `${String(reportOf(testId).controlBuilds)} builds, want more than ` +
              `${String(baseline)}. A calendar that never rebuilds cannot take new ` +
              `bounds - Material 3's state reads them once, and SwiftUI's control ` +
              `asserts when a date is clamped by a bound it still holds.`
          )
      );
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
    // iOS rebuilds the control when a value leaves the bounds the control on
    // screen was built with (`UIDatePicker` asserts when it clamps such a value),
    // so the record of those bounds has to move with every rebuild.
    const MIN = localMs(2026, 0, 1, 0, 0);
    const FIRST_MAX = localMs(2026, 0, 20, 12, 0);
    const WIDER_MAX = localMs(2026, 1, 20, 12, 0);
    const INSIDE_FIRST = localMs(2026, 0, 10, 12, 0);
    // Inside the widened range and outside the first build's.
    const BETWEEN = localMs(2026, 1, 10, 12, 0);
    // The report publishes the bounds truncated to whole seconds.
    const truncated = (millis: number) => Math.trunc(millis / 1000) * 1000;
    const boundOf = (testId: string, which: 'builtMinimum' | 'builtMaximum') =>
      reportOf(testId)[which];

    // `inline` keeps its platform control on screen; a `compact` field builds no
    // calendar until its dialog opens.
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
    // The bounds arrive after the first commit, so the control may first be built
    // with none: poll until the record describes the bounds the mount was given.
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

    // Bounds and value move in the same render.
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
    expect(widened).toBeGreaterThan(built0);
    expect(afterWiden.builtMaximum).toBe(truncated(WIDER_MAX));
    expect(afterWiden.builtMinimum).toBe(truncated(MIN));

    // Only the value moves now, back and forth across the bound the first build
    // held. The control on screen no longer holds it, so nothing may rebuild.
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
    expect(afterFlips).toBe(widened);
    expect(boundOf('built-bounds', 'builtMaximum')).toBe(truncated(WIDER_MAX));
    unmount();
  });

  it('round-trips an instant across a DST boundary', async () => {
    // The pickers speak in calendar fields (Material 3 stores a UTC midnight per
    // day), so converting to and from an instant is where an hour or a day can go
    // missing. `dst-set` is written by React and must show the instant without
    // emitting; `dst-pick` is picked and must report JS's own instant.
    //
    // The device's zone is read, not assumed. In a zone with no transition the
    // round trip still has to be exact, and the run logs what it could not show.
    const zone = deviceZone();
    const winterOffset = zone.winterOffset;
    const summerOffset = zone.summerOffset;
    const zoneDescription = new Date(2026, 6, 1).toString();
    console.log(
      `dst zone: ${zoneDescription} zone=${zone.name ?? 'unknown'} ` +
        `winterOffset=${String(winterOffset)} summerOffset=${String(summerOffset)}`
    );
    const observesDst = zone.observesDst;
    if (!observesDst) {
      console.log(
        `    · DST PREMISE MISSING: ${zone.name ?? 'this zone'} shows the same ` +
          'offset in January and July, so no instant here crosses a transition. ' +
          'The instant round trip below still runs and still has to be exact, but ' +
          'the DST half of this rule is not evidence on this device. Pin ' +
          'NITRO_UI_TEST_TZ=Europe/Lisbon (iOS) or set the device’s zone to see it.'
      );
    }

    const WINTER = localMs(2026, 1, 5, 12, 30);
    const SUMMER = localMs(2026, 7, 5, 12, 30);
    const SPRING_DAY = localMs(2026, 3, 29, 12, 30);
    const AUTUMN_EVE = localMs(2026, 10, 24, 23, 45);
    const AUTUMN_DAY = localMs(2026, 10, 25, 23, 45);
    // A noon instant has the same day in every zone. 00:30 is the day before in
    // UTC for a zone ahead of it and 23:45 the day after for a zone behind it,
    // which is what makes a wrong UTC-midnight conversion visible.
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
    // Gated on the offset rather than on DST: a zone such as Asia/Kolkata has no
    // transition but still puts an instant on another UTC day. Only at UTC can
    // none of these differ.
    if (winterOffset !== 0 || summerOffset !== 0) {
      expect(discriminating.length).toBeGreaterThan(0);
    } else {
      console.log(
        '    · DST PREMISE MISSING: this device is at UTC, so every instant here ' +
          'has the same local day as its UTC day and the UTC-midnight conversion ' +
          'has nothing to convert. The instant round trip still has to be exact.'
      );
    }

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

    // Each pick differs from the instant before it, starting from the
    // `defaultValue`: a pick of the instant already showing reports nothing.
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
    // An Android `Dialog` is a separate window and the harness dispatches touches
    // into the app's own, so a leaked dialog does not swallow the witness press.
    // The process-wide count of live presentations is the primary check, read
    // through a fresh mount because the dropped view has no handle left.
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

    await waitForLivePresentations('opener', 0, 'the untouched process');
    handles.get('opener')?.nuiTestPresent();
    await waitForPresented('opener', true, 'the field press');
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
    await waitForLivePresentations('probe', 0, 'the mount after the drop');
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
    // The sizing key excludes the value: instances that share a key share one
    // cached size, so a width that followed the date would have two pickers
    // correcting each other's box.
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
    expect(sameSize(wideSize, narrowSize)).toBe(true);
    // Polled: two instances of one cold configuration are corrected on separate
    // turns, and Android settles the second box after the control has reported.
    await waitForBox('wide', narrowSize, 'the 2288 field');
    expect(sameSize(sizeOf('narrow'), WRONG_SIZE)).toBe(false);
    // Wider than the 44 pt floor the implementation clamps the field to.
    expect(narrowSize.width).toBeGreaterThan(44);

    // The same instance with a different date: the box must hold.
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
    // A configuration whose cached size is exact costs no correction.
    expect(after.corrections).toBe(0);
    unmount();
  });

  it('keeps a date field and a time field at their own boxes', async () => {
    // `mode` is part of the sizing key, so a date field and a time field each
    // have their own cached size.
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
    // Premise: the widest date a field can show is wider than the widest time.
    expect(dateSize.width).toBeGreaterThan(timeSize.width + 1);
    expect(sameSize(sizeOf('key-date'), dateSize)).toBe(true);
    expect(sameSize(sizeOf('key-time'), timeSize)).toBe(true);
    unmount();
  });

  it('re-measures the field when the mode changes', async () => {
    // The size planted for `compact|time` is the date field's own box, so only a
    // measurement under the new key can move the control.
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
    // Logged before the assertions, so a locale where the two fields are the
    // same width shows in the output.
    console.log(
      `mode-change (${Platform.OS}, ${zoneNote()}): date=${describeSize(dateSize)} ` +
        `time=${describeSize(now)} box=${describeSize(sizeOf(DATE))} ` +
        `probeDate="${probeTextOf('date')}" probeTime="${probeTextOf('time')}" ` +
        `delta=${JSON.stringify(after)}`
    );
    // Premise: a time field is narrower, so the planted size is wrong for it.
    expect(now !== null && now.width < dateSize.width - 1).toBe(true);
    expect(sameSize(sizeOf(DATE), now)).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it("starts a remount from its own default, not the previous mount's", async () => {
    // A recycled native view that kept its old state would show a date React
    // never sent. `valueMillis` reports what React sent, so only the state report
    // can see it.
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
    // The report is only meaningful once the control has committed.
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
    expect(state.millis).not.toBe(PICKED);
    second.unmount();
  });
});

describe('DatePicker · wheel variant (G29)', () => {
  it('measures the time drum from a poisoned fallback', async () => {
    if (Platform.OS !== 'android') {
      console.log('time drum: Android case - iOS has had a wheel since G5');
      return;
    }
    poisonConfigurations([sizingKey('wheel', 'time')]);
    const before = stats();
    const { unmount } = await render(
      <DatePicker
        mode="time"
        variant="wheel"
        defaultValue={new Date(2024, 5, 15, 9, 20)}
        testID="wheel-time"
        hybridRef={captureHybrid('wheel-time')}
        style={{ width: 320 }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-time');
    const size = await waitForMeasured('wheel-time', 'the time drum');
    const cold = delta(before, stats());
    console.log(
      `time drum box: ${describeSize(size)} in a 320 dp box ` +
        `cold=${JSON.stringify(cold)}`
    );
    expect(sameSize(sizeOf('wheel-time'), WRONG_SIZE)).toBe(false);
    // Only the height is compared: the width is the 320 the caller pinned, and
    // the drum sits inside it at its own narrower width.
    const box = sizeOf('wheel-time');
    expect(box).not.toBeNull();
    expect(Math.abs((box?.height ?? 0) - size.height)).toBeLessThanOrEqual(1);
    // The drum is three rows, 120 dp. A looser bound would accept a drum clipped
    // to one row.
    expect(Math.abs(size.height - 120)).toBeLessThanOrEqual(1);
    console.log(
      `time drum height: ${String(size.height)} dp (TimeWheelHeight=120)`
    );
    expect(cold.corrections).toBeGreaterThanOrEqual(1);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('draws the calendar for a date wheel, because there is no date drum', async () => {
    // Material has no date wheel, so on Android a date wheel is the inline
    // calendar and measures the same box. The two are mounted one after the
    // other: stacked, the second calendar would be off-screen.
    if (Platform.OS !== 'android') {
      console.log(
        'date wheel: Android case - iOS draws a real wheel for a date, not a calendar'
      );
      return;
    }
    poisonConfigurations([
      sizingKey('wheel', 'date'),
      sizingKey('inline', 'date'),
    ]);
    const tree = (variant: 'wheel' | 'inline', testId: string) => (
      <DatePicker
        mode="date"
        variant={variant}
        defaultValue={new Date(2024, 5, 15)}
        testID={testId}
        hybridRef={captureHybrid(testId)}
        style={{ width: 320 }}
      />
    );

    const drum = await render(tree('wheel', 'wheel-date'), { timeout: 20000 });
    await waitForTestId('wheel-date');
    const wheelSize = await waitForMeasured('wheel-date', 'the date wheel');
    await waitForBox('wheel-date', wheelSize, 'the date wheel');
    const report = reportOf('wheel-date');
    console.log(`date wheel box: ${describeSize(wheelSize)}`);
    expect(sameSize(sizeOf('wheel-date'), WRONG_SIZE)).toBe(false);
    expect(report.controlBuilds).toBeGreaterThanOrEqual(1);
    expect(report.calendarHasSelection).toBe(1);
    expect(monthKeyOf(report.calendarMonthUtc)).toBe(expectedMonthKey(2024, 6));
    drum.unmount();
    await settle(200);
    handles.clear();

    const inline = await render(tree('inline', 'wheel-date'), {
      timeout: 20000,
    });
    await waitForTestId('wheel-date');
    const inlineSize = await waitForMeasured(
      'wheel-date',
      'the inline calendar'
    );
    console.log(
      `date wheel vs inline: ${describeSize(wheelSize)} vs ${describeSize(inlineSize)}`
    );
    expect(sameSize(wheelSize, inlineSize)).toBe(true);
    inline.unmount();
  });

  it('sends nothing from a disabled time drum', async () => {
    const PINNED = localMs(2026, 5, 15, 9, 20);
    const { unmount } = await render(
      <DatePicker
        mode="time"
        variant="wheel"
        value={new Date(PINNED)}
        disabled
        onChange={recordChange('wheel-locked')}
        testID="wheel-locked"
        hybridRef={captureHybrid('wheel-locked')}
        style={{ width: 320 }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-locked');
    await waitForDisplayed('wheel-locked', PINNED, 'the pinned time');

    handles.get('wheel-locked')?.nuiTestPresent();
    handles.get('wheel-locked')?.nuiTestSelect(2027, 0, 15, 14, 5);
    await settle(400);
    expect(reportOf('wheel-locked').presented).toBe(false);
    expect(displayedOf('wheel-locked')).toBe(PINNED);
    expect(eventLog).toEqual([]);
    unmount();
  });

  it('reverts a time the parent refuses, and reports the next roll of it', async () => {
    // On this variant `nuiTestSelect` rolls the drums rather than writing the
    // model. The parent keeps sending 09:20, so the same roll reports a second
    // time only if the drums were really put back after the first.
    const PARENT = localMs(2026, 5, 15, 9, 20);
    const ROLLED = localMs(2026, 5, 15, 14, 5);
    const { unmount } = await render(
      <DatePicker
        mode="time"
        variant="wheel"
        value={new Date(PARENT)}
        onChange={recordChange('wheel-refused')}
        testID="wheel-refused"
        hybridRef={captureHybrid('wheel-refused')}
        style={{ width: 320 }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-refused');
    await waitForDisplayed('wheel-refused', PARENT, 'the parent’s time');
    expect(eventLog).toEqual([]);

    handles.get('wheel-refused')?.nuiTestSelect(2026, 5, 15, 14, 5);
    const first = await waitForEvents(1);
    expect(first).toEqual([`wheel-refused:${String(ROLLED)}`]);
    await waitForDisplayed('wheel-refused', PARENT, 'the revert');

    handles.get('wheel-refused')?.nuiTestSelect(2026, 5, 15, 14, 5);
    const second = await waitForEvents(2);
    expect(second[1]).toBe(`wheel-refused:${String(ROLLED)}`);
    // Polled, not read: the revert lands a frame after the event does.
    await waitForDisplayed('wheel-refused', PARENT, 'the second revert');
    unmount();
  });

  it('leaves nothing behind when the drum becomes a field again', async () => {
    // A variant change is a remount: nothing of the drum (its box, its scroll
    // position, a pending roll) may carry over to the field.
    poisonConfigurations([
      sizingKey('wheel', 'time'),
      sizingKey('compact', 'time'),
    ]);
    const VALUE = localMs(2024, 5, 15, 9, 20);
    const tree = (variant: 'wheel' | 'compact') => (
      <DatePicker
        mode="time"
        variant={variant}
        value={new Date(VALUE)}
        onChange={recordChange('wheel-remount')}
        testID="wheel-remount"
        hybridRef={captureHybrid('wheel-remount')}
        style={{ width: 320 }}
      />
    );

    const drum = await render(tree('wheel'), { timeout: 20000 });
    await waitForTestId('wheel-remount');
    const drumSize = await waitForMeasured('wheel-remount', 'the drum');
    expect(eventLog).toEqual([]);
    drum.unmount();
    await settle(200);
    handles.clear();

    const field = await render(tree('compact'), { timeout: 20000 });
    await waitForTestId('wheel-remount');
    const fieldSize = await waitForMeasured('wheel-remount', 'the field');
    await settle(400);
    console.log(
      `wheel to compact: ${describeSize(drumSize)} -> ${describeSize(fieldSize)}`
    );
    expect(sameSize(fieldSize, drumSize)).toBe(false);
    expect(sameSize(sizeOf('wheel-remount'), WRONG_SIZE)).toBe(false);
    expect(eventLog).toEqual([]);
    expect(displayedOf('wheel-remount')).toBe(VALUE);
    field.unmount();
  });
});
