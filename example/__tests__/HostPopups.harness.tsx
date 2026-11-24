import { useState } from 'react';
import { PixelRatio, Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  beforeAll,
  beforeEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { userEvent } from '@react-native-harness/ui';
import {
  Button,
  DatePicker,
  Host,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
  nitroUiCore,
} from 'react-native-nitro-ui';
import {
  forgetPromisedHandles,
  handleOf,
  handleRef,
  waitForPromisedHandle,
} from './handles';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type PickerHandle = {
  readonly options: readonly string[];
  readonly selectedIndex: number | null;
  readonly disabled: boolean;
  readonly variant: string;
  nuiTestSelect(index: number): void;
  nuiTestMenuReport(): string;
};
type SegmentedHandle = {
  readonly options: readonly string[];
  readonly selectedIndex: number | null;
  readonly disabled: boolean;
};
type DatePickerHandle = {
  readonly valueMillis: number | null;
  readonly mode: string;
  readonly variant: string;
  readonly disabled: boolean;
  nuiTestPresent(): void;
  nuiTestStateReport(): string;
  nuiTestSelect(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
  ): void;
};

type MenuReport = {
  expanded: boolean;
  live: number;
  /** Menu windows composed in the process, including one still fading out. */
  windows: number;
  /** How many times a menu has opened in the process. Only ever goes up. */
  opens: number;
  anchor: number[];
  menu: number[];
  rows: number;
};

type DateReport = {
  displayed: number;
  presented: boolean;
  livePresentations: number;
  calendarMonth: number;
};

// A harness press reaches the React Native window only. A Compose `Popup` and a
// Material dialog are separate windows, so these tests open a menu by pressing its
// anchor and choose or dismiss through the control's `nuiTest*` methods.

function edges(rect: number[], what: string): [number, number, number, number] {
  if (rect.length !== 4 || rect.some((value) => Number.isNaN(value))) {
    throw new Error(
      `The ${what} rect is not four numbers: "${rect.join(',')}".`
    );
  }
  return [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0];
}

function parseMenuReport(line: string): MenuReport {
  const field = (name: string): string => {
    const found = line.split(';').find((part) => part.startsWith(`${name}=`));
    if (found == null) {
      throw new Error(`No "${name}" in menu report "${line}".`);
    }
    return found.slice(name.length + 1);
  };
  const rect = (name: string): number[] =>
    field(name)
      .split(',')
      .map((part) => Number(part));
  return {
    expanded: field('expanded') === '1',
    live: Number(field('live')),
    windows: Number(field('windows')),
    opens: Number(field('opens')),
    anchor: rect('anchor'),
    menu: rect('menu'),
    rows: Number(field('rows')),
  };
}

function parseDateReport(line: string): DateReport {
  // `displayed | presented | calendarMonth | calendarHasSelection | live | builds
  // | builtMinimum | builtMaximum`. Index 3 is `calendarHasSelection`, not the count.
  const parts = line.split('|');
  if (parts.length !== 8) {
    throw new Error(
      `Date report is not eight fields: "${line}". Shape changes break every gate here.`
    );
  }
  return {
    displayed: Number(parts[0]),
    presented: parts[1] === '1',
    calendarMonth: Number(parts[2]),
    livePresentations: Number(parts[4]),
  };
}

// MARK: - Helpers

function settle(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reads once, so only for a handle already known to exist. The first read after a
// mount goes through `handleOf`: the `hybridRef` callback lands on a later commit.
function need<T>(value: T | undefined, what: string): T {
  if (value == null) {
    throw new Error(
      `No hybrid handle for "${what}" - the control never mounted.`
    );
  }
  return value;
}

async function waitForAnswer<T>(
  read: () => T | undefined,
  what: string,
  timeoutMs = 8000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const seen = read();
    if (seen !== undefined) {
      return seen;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No answer for "${what}" within ${String(timeoutMs)}ms - the press never reached JS.`
      );
    }
    await settle(50);
  }
}

// Also waits for the handle of a control wired with `handleRef`, which lands after
// the box does.
async function boxOf(testId: string, timeoutMs = 15000): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
      await waitForPromisedHandle(
        testId,
        Math.max(5000, deadline - nitroUiCore.now())
      );
      return box;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${String(timeoutMs)}ms.`
      );
    }
    await settle(50);
  }
}

/**
 * The index the control holds once the app's write has reached it: a pick closes the
 * menu natively, and React's `setIndex` only arrives on a later commit, so the menu
 * report being back to closed says nothing about the index yet.
 */
async function indexReached(
  handle: PickerHandle,
  expected: number,
  timeoutMs = 8000
): Promise<number | null> {
  return await waitForAnswer(
    () =>
      handle.selectedIndex === expected ? handle.selectedIndex : undefined,
    `the hosted picker to hold index ${String(expected)}`,
    timeoutMs
  );
}

async function mount(ui: Parameters<typeof render>[0], timeoutMs = 30000) {
  return await render(ui, { timeout: timeoutMs });
}

// `pressAt` takes React Native's units; the menu report answers in device pixels.
function dp(px: number): number {
  return px / PixelRatio.get();
}

// A popup opens on the UI thread after the press has returned to JS, so poll the
// report instead of sleeping a fixed time.
async function waitForMenu(
  handle: PickerHandle,
  read: (report: MenuReport) => boolean,
  timeoutMs = 12000
): Promise<MenuReport> {
  const deadline = nitroUiCore.now() + timeoutMs;
  let seen = 'never read';
  for (;;) {
    const line = handle.nuiTestMenuReport();
    const report = parseMenuReport(line);
    if (read(report)) {
      return report;
    }
    seen = line;
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Menu report never matched within ${String(timeoutMs)}ms; last read "${seen}".`
      );
    }
    await settle(50);
  }
}

async function waitForDate(
  handle: DatePickerHandle,
  read: (report: DateReport) => boolean,
  timeoutMs = 12000
): Promise<DateReport> {
  const deadline = nitroUiCore.now() + timeoutMs;
  let seen = 'never read';
  for (;;) {
    const line = handle.nuiTestStateReport();
    const report = parseDateReport(line);
    if (read(report)) {
      return report;
    }
    seen = line;
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Date report never matched within ${String(timeoutMs)}ms; last read "${seen}".`
      );
    }
    await settle(50);
  }
}

// How long a dialog's window may stay composed after its `presented` flag fell. The
// flag falls with the props batch and the window a frame or two later; a longer
// budget would pass a dialog that lingers over the screen for seconds.
const DISMISSAL_GRACE_MS = 2000;

async function waitForDialogGone(
  handle: DatePickerHandle,
  what: string,
  expected = 0
): Promise<DateReport> {
  await waitForDate(handle, (r) => !r.presented);
  try {
    return await waitForDate(
      handle,
      (r) => r.livePresentations === expected,
      DISMISSAL_GRACE_MS
    );
  } catch {
    const seen = parseDateReport(handle.nuiTestStateReport()).livePresentations;
    throw new Error(
      `"${what}": the dialog's own flag came down and its window was still composed ` +
        `${String(DISMISSAL_GRACE_MS)} ms later (${String(seen)} live DatePicker ` +
        `window(s), expected ${String(expected)}). A window that takes seconds to ` +
        `leave is not "coming down with its row" - it is hanging over the screen.`
    );
  }
}

// `livePresentations` counts every DatePicker dialog in the process, and a previous
// test's unmount can still be disposing one. When the count is not zero this opens
// and closes a dialog of its own: a disposal in flight lands meanwhile, a leak stays.
async function waitForNoDateWindows(
  handle: DatePickerHandle,
  closeWindow: (closed: boolean) => void,
  what: string
): Promise<void> {
  if (parseDateReport(handle.nuiTestStateReport()).livePresentations === 0) {
    return;
  }
  handle.nuiTestPresent();
  await waitForDate(handle, (r) => r.presented);
  closeWindow(true);
  await waitForDate(handle, (r) => !r.presented);
  closeWindow(false);
  try {
    await waitForDate(handle, (r) => r.livePresentations === 0, 20_000);
  } catch {
    const stuck = parseDateReport(
      handle.nuiTestStateReport()
    ).livePresentations;
    throw new Error(
      `"${what}" could not earn a zero baseline: ${String(stuck)} DatePicker ` +
        `window(s) were live before it opened anything, and they did not come ` +
        `down when it closed its own. Those are windows this gate did not open ` +
        `and cannot close - a leaked or still-undisposed dialog, not a wrong ` +
        `count in the control under test.`
    );
  }
}

async function expectDateWindowsAt(
  reader: DatePickerHandle,
  expected: number,
  what: string,
  timeoutMs = 20_000
): Promise<number> {
  try {
    const report = await waitForDate(
      reader,
      (r) => r.livePresentations === expected,
      timeoutMs
    );
    return report.livePresentations;
  } catch {
    const seen = parseDateReport(reader.nuiTestStateReport()).livePresentations;
    throw new Error(
      `"${what}" reads ${String(seen)} live DatePicker window(s) on a mount of ` +
        `its own, expected ${String(expected)}. Anything above the baseline is a ` +
        `window this gate did not open - the dialog of a mount that was dropped ` +
        `before its composition disposed.`
    );
  }
}

// Inside a Host a child's React Native frame is `0 × 0`, so the anchor rect in the
// control's own report is the only place to aim a press.
async function pressWitnessed(
  handle: PickerHandle | (SegmentedHandle & { nuiTestMenuReport(): string })
) {
  const report = parseMenuReport(handle.nuiTestMenuReport());
  const [left, top, right, bottom] = edges(report.anchor, 'anchor');
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  await userEvent.pressAt(dp((left + right) / 2), dp((top + bottom) / 2));
}

async function pressWitnessedAndOpen(
  handle: PickerHandle
): Promise<MenuReport> {
  await pressWitnessed(handle);
  return await waitForMenu(handle, (r) => r.expanded && r.live === 1);
}

/**
 * One read, five fields, each asserted on its own line so a red names the field and shows the
 * number it got. What a control reports when its menu has closed and its window has gone.
 * `opens` is the count the caller already saw: a menu that opened again between the reads is a
 * different answer.
 */
function expectStillClosed(handle: PickerHandle, after: string, opens: number) {
  const report = parseMenuReport(handle.nuiTestMenuReport());
  const seen: Record<string, string> = {
    expanded: String(report.expanded),
    live: String(report.live),
    windows: String(report.windows),
    opens: String(report.opens),
    menu: report.menu.join(','),
  };
  for (const [name, closed] of Object.entries({
    expanded: 'false',
    live: '0',
    windows: '0',
    opens: String(opens),
    menu: '-1,-1,-1,-1',
  })) {
    expect(`${name}=${seen[name]} ${after}`).toBe(`${name}=${closed} ${after}`);
  }
}

/**
 * A close is over when the popup's window has left, which is when its fade ends. Returns the
 * opens count as of then.
 */
async function awaitCloseOver(handle: PickerHandle): Promise<number> {
  const closed = await waitForMenu(handle, (r) => r.windows === 0);
  return closed.opens;
}

/** Where the control reports its anchor now: the one thing a Host move must change. */
function anchorOf(handle: PickerHandle): string {
  return parseMenuReport(handle.nuiTestMenuReport()).anchor.join(',');
}

/**
 * The control's own `disabled`, read back from the view: a step here is known to have
 * arrived rather than only to have been asked for, so two writes cannot share one batch.
 */
async function waitForDisabled(
  handle: PickerHandle,
  want: boolean,
  timeoutMs = 12000
): Promise<void> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (handle.disabled === want) {
      return;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `The control never reported disabled=${String(want)} within ` +
          `${String(timeoutMs)}ms.`
      );
    }
    await settle(50);
  }
}

// MARK: - Fixtures

type Log = {
  /** The `testID` of every control that answered a press, in order. */
  taps: string[];
  pickers: Record<string, PickerHandle>;
  segments: Record<string, SegmentedHandle>;
  dates: Record<string, DatePickerHandle>;
  /** Indices the app agreed to, by control id. Absent means refused. */
  acceptedPickers: Record<string, number>;
  acceptedSegments: Record<string, number>;
  acceptedDates: Record<string, number>;
  acceptedSwitches: Record<string, boolean>;
  setIds?: (ids: string[]) => void;
  writePicker?: (index: number) => void;
  writeDate?: (date: Date) => void;
  setOptions?: (options: string[]) => void;
  setPickerDisabled?: (disabled: boolean) => void;
  setDateDisabled?: (disabled: boolean) => void;
  setDateDisabledTwo?: (disabled: boolean) => void;
  setDateDisabledFor?: (id: string, disabled: boolean) => void;
  setPickerKey?: (key: string) => void;
  setPickerPresent?: (present: boolean) => void;
  setDatePresent?: (present: boolean) => void;
  /** `display: 'none'` on the `DatePicker` child — hidden, not unmounted. */
  setDateHidden?: (hidden: boolean) => void;
  /** Height of the spacer above the Host — how a test moves the Host. */
  setSpacer?: (height: number) => void;
};

const newLog = (): Log => ({
  taps: [],
  acceptedSwitches: {},
  pickers: {},
  segments: {},
  dates: {},
  acceptedPickers: {},
  acceptedSegments: {},
  acceptedDates: {},
});

const OPTIONS = ['Alpha', 'Beta', 'Gamma'];
const MORE_OPTIONS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

const SEED = new Date(2026, 4, 17, 0, 0, 0, 0).getTime();

// The spacer above the Host moves it by layout: the harness has no scroll gesture.
function PopupHost({
  log,
  controlled = true,
  mode = 'date',
}: {
  log: Log;
  controlled?: boolean;
  mode?: 'date' | 'time' | 'datetime';
}) {
  const [spacer, setSpacer] = useState(0);
  const [options, setOptions] = useState<string[]>(OPTIONS);
  const [index, setIndex] = useState(1);
  const [pickerDisabled, setPickerDisabled] = useState(false);
  const [dateDisabled, setDateDisabled] = useState(false);
  const [segmented, setSegmented] = useState(0);
  const [date, setDate] = useState(() => new Date(SEED));
  const [pickerKey, setPickerKey] = useState('picker-a');
  const [pickerPresent, setPickerPresent] = useState(true);
  const [datePresent, setDatePresent] = useState(true);
  const [dateHidden, setDateHidden] = useState(false);
  log.setSpacer = setSpacer;
  log.setOptions = setOptions;
  log.setPickerDisabled = setPickerDisabled;
  log.setDateDisabled = setDateDisabled;
  log.setPickerKey = setPickerKey;
  log.setPickerPresent = setPickerPresent;
  log.setDatePresent = setDatePresent;
  log.setDateHidden = setDateHidden;
  log.writePicker = setIndex;
  log.writeDate = setDate;
  return (
    <View>
      <View testID="popup-spacer" style={{ height: spacer, width: 40 }} />
      <Host testID="popup-host" style={{ width: 300, height: 300 }}>
        <SegmentedControl
          options={options}
          selectedIndex={segmented}
          onChange={(event) => {
            log.acceptedSegments.segmented = event.index;
            setSegmented(event.index);
          }}
          testID="pop-segmented"
          accessibilityLabel="Hosted segmented"
          hybridRef={(view: SegmentedHandle) => {
            log.segments.segmented = view;
          }}
        />
        {pickerPresent ? (
          <Picker
            key={pickerKey}
            options={options}
            {...(controlled ? { selectedIndex: index } : {})}
            defaultSelectedIndex={1}
            disabled={pickerDisabled}
            onChange={(event) => {
              log.acceptedPickers.picker = event.index;
              setIndex(event.index);
            }}
            label="Hosted picker"
            testID="pop-picker"
            accessibilityLabel="Hosted picker"
            hybridRef={(view: PickerHandle) => {
              log.pickers.picker = view;
            }}
          />
        ) : null}
        {datePresent ? (
          <DatePicker
            value={date}
            disabled={dateDisabled}
            mode={mode}
            // Hidden, not unmounted: the view and its handle stay, and only the
            // Host's composition drops the child.
            {...(dateHidden ? { style: { display: 'none' } } : {})}
            onChange={(next) => {
              log.acceptedDates.date = next.getTime();
              setDate(next);
            }}
            testID="pop-date"
            accessibilityLabel="Hosted date picker"
            hybridRef={(view: DatePickerHandle) => {
              log.dates.date = view;
            }}
          />
        ) : null}
      </Host>
      {/* Unhosted, so it outlives the hosted Picker and can read the process-wide
          menu count after that one is dropped. */}
      <Picker
        options={OPTIONS}
        defaultSelectedIndex={0}
        testID="pop-witness"
        accessibilityLabel="Witness picker"
        hybridRef={(view: PickerHandle) => {
          log.pickers.witness = view;
        }}
      />
    </View>
  );
}

function TwoPopupOwners({ log }: { log: Log }) {
  const [index, setIndex] = useState(0);
  const [date, setDate] = useState(() => new Date(SEED));
  const [dateDisabled, setDateDisabled] = useState(false);
  // Disabling the control is the one dialog dismissal the harness can drive.
  log.setDateDisabledTwo = setDateDisabled;
  return (
    <Host testID="two-host" style={{ width: 300, height: 300 }}>
      <Picker
        options={OPTIONS}
        selectedIndex={index}
        onChange={(event) => setIndex(event.index)}
        label="First picker"
        testID="two-picker"
        accessibilityLabel="Two picker"
        hybridRef={(view: PickerHandle) => {
          log.pickers.first = view;
        }}
      />
      <DatePicker
        value={date}
        disabled={dateDisabled}
        onChange={(next) => setDate(next)}
        testID="two-date"
        accessibilityLabel="Two date picker"
        hybridRef={(view: DatePickerHandle) => {
          log.dates.first = view;
        }}
      />
    </Host>
  );
}

afterEach(() => {
  cleanup();
  forgetPromisedHandles();
});

beforeAll(async () => {
  // Pay the process-wide first-mount cost before anything is asserted.
  const { unmount } = await mount(
    <Switch defaultValue testID="popups-warm-up" />
  );
  unmount();
});

// MARK: - SegmentedControl

/** Height of one hosted SegmentedControl row, in dp. */
const SEG_ROW = 44;

// The second row always accepts, so "the first row answered nothing" cannot mean the
// Host composed nothing at all.
function SegRows({
  log,
  refuse = false,
  disableFirst = false,
}: {
  log: Log;
  refuse?: boolean;
  disableFirst?: boolean;
}) {
  const [first, setFirst] = useState(0);
  const [second, setSecond] = useState(0);
  return (
    <Host testID="seg-host" style={{ width: 300, height: 2 * SEG_ROW }}>
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={first}
        disabled={disableFirst}
        onChange={(event) => {
          log.acceptedSegments.first = event.index;
          if (!refuse) {
            setFirst(event.index);
          }
        }}
        testID="seg-first"
        accessibilityLabel="Segmented first"
        hybridRef={handleRef(log.segments, 'first', 'seg-first')}
      />
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={second}
        onChange={(event) => {
          log.acceptedSegments.second = event.index;
          setSecond(event.index);
        }}
        testID="seg-second"
        accessibilityLabel="Segmented second"
        hybridRef={handleRef(log.segments, 'second', 'seg-second')}
      />
    </Host>
  );
}

describe('Host · a hosted SegmentedControl is still a SegmentedControl', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  // Android draws the control at the Host's leading edge at a width React Native
  // cannot read, so aim by a fraction of the Host's box. On iOS the Host passes its
  // child through as a plain React Native view, so aim at that view.
  async function aimAt(hostBox: ViewInfo, row: 0 | 1, childId: string) {
    if (Platform.OS === 'android') {
      return {
        x: hostBox.x + hostBox.width * 0.39,
        y: hostBox.y + 14 + row * SEG_ROW,
      };
    }
    const own = await boxOf(childId);
    return { x: own.x + own.width * (5 / 6), y: own.y + own.height / 2 };
  }

  it('takes a real press on a segment, through the Host’s composition', async () => {
    await mount(<SegRows log={log} />);
    const control = await handleOf(() => log.segments.first, 'segmented row');
    expect(control.selectedIndex).toBe(0);
    const hostBox = await boxOf('seg-host');
    const aim = await aimAt(hostBox, 0, 'seg-first');
    await userEvent.pressAt(aim.x, aim.y);
    const answered = await waitForAnswer(
      () => log.acceptedSegments.first,
      'first row press'
    );
    expect(answered).toBeGreaterThan(0);
    expect(control.selectedIndex).toBe(answered);
  });

  it('goes back to what React kept when the app refuses a change', async () => {
    await mount(<SegRows log={log} refuse />);
    const control = await handleOf(() => log.segments.first, 'segmented row');
    const twinRow = await handleOf(() => log.segments.second, 'twin row');
    const hostBox = await boxOf('seg-host');
    const aim = await aimAt(hostBox, 0, 'seg-first');
    expect(control.selectedIndex).toBe(0);
    await userEvent.pressAt(aim.x, aim.y);
    const refused = await waitForAnswer(
      () => log.acceptedSegments.first,
      'refused row press'
    );
    expect(refused).toBeGreaterThan(0);
    expect(control.selectedIndex).toBe(0);
    const twin = await aimAt(hostBox, 1, 'seg-second');
    await userEvent.pressAt(twin.x, twin.y);
    const twinAnswer = await waitForAnswer(
      () => log.acceptedSegments.second,
      'twin row press, after the first was refused'
    );
    expect(twinAnswer).toBeGreaterThan(0);
    expect(twinRow.selectedIndex).toBe(twinAnswer);
  });

  it('answers nothing while disabled, and the twin beside it still does', async () => {
    await mount(<SegRows log={log} disableFirst />);
    const firstRow = await handleOf(() => log.segments.first, 'first row');
    const twinRow = await handleOf(() => log.segments.second, 'twin row');
    const hostBox = await boxOf('seg-host');
    expect(firstRow.disabled).toBe(true);
    const aim = await aimAt(hostBox, 0, 'seg-first');
    await userEvent.pressAt(aim.x, aim.y);
    await settle(350);
    expect(log.acceptedSegments.first).toBeUndefined();
    expect(firstRow.selectedIndex).toBe(0);
    const twin = await aimAt(hostBox, 1, 'seg-second');
    await userEvent.pressAt(twin.x, twin.y);
    await settle(350);
    expect(log.acceptedSegments.second).not.toBeUndefined();
    expect(twinRow.selectedIndex).toBe(log.acceptedSegments.second);
  });

  it('draws its own width at the leading edge, not the Host’s (D24)', async () => {
    // Three short titles are far narrower than a 300 dp Host, so a press at the Host's
    // far edge is outside the drawing and answers nothing.
    await mount(<SegRows log={log} />);
    const control = await handleOf(() => log.segments.first, 'segmented row');
    const hostBox = await boxOf('seg-host');
    await userEvent.pressAt(hostBox.x + hostBox.width - 6, hostBox.y + 14);
    await settle(350);
    expect(log.acceptedSegments.first).toBeUndefined();
    expect(control.selectedIndex).toBe(0);
    const aim = await aimAt(hostBox, 0, 'seg-first');
    await userEvent.pressAt(aim.x, aim.y);
    await settle(350);
    expect(log.acceptedSegments.first).toBeGreaterThan(0);
  });
});

// MARK: - Picker's menu, hosted

// Android only: on iOS a Host passes its children through, so these would measure
// SwiftUI's own menu, for which `nuiTestMenuReport` answers `-1`.
if (Platform.OS === 'android') {
  describe('Host · a hosted Picker’s menu is a window of the Host', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    it('anchors under the box the Host drew, and follows it when it moves', async () => {
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      const first = await pressWitnessedAndOpen(picker);
      const [aLeft, aTop, aRight, aBottom] = edges(first.anchor, 'anchor');
      const [mLeft, mTop, , mBottom] = edges(first.menu, 'menu');
      expect(aLeft).toBeGreaterThanOrEqual(0);
      expect(aRight).toBeGreaterThan(aLeft);
      expect(mBottom).toBeGreaterThan(mTop);
      expect(aBottom).toBeGreaterThan(aTop);
      expect(mTop + 24).toBeGreaterThanOrEqual(aBottom);
      expect(Math.abs(mLeft - aLeft)).toBeLessThan(40);
      expect(first.rows).toBe(OPTIONS.length);
      const gap = mTop - aBottom;

      // A Compose `Popup` positions itself inside its own composition and is not told
      // when React Native moves the Host under it, so the control closes the menu.
      log.setSpacer?.(120);
      const moved = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(moved.menu).toEqual([-1, -1, -1, -1]);

      // Aimed at the rect reported now: a stale one would land the press on the spacer
      // and open nothing.
      const reopened = await pressWitnessedAndOpen(picker);
      const [nextLeft, , , nextBottom] = edges(reopened.anchor, 'anchor');
      const [nextMenuLeft, nextMenuTop] = edges(reopened.menu, 'menu');
      expect(
        Math.abs(nextBottom - aBottom - 120 * PixelRatio.get())
      ).toBeLessThan(6);
      expect(Math.abs(nextMenuTop - nextBottom - gap)).toBeLessThan(2);
      expect(Math.abs(nextMenuLeft - nextLeft)).toBeLessThan(40);
      expect(reopened.rows).toBe(OPTIONS.length);
      // `live` counts menus in the whole process, so close this one before leaving.
      // Picking the index the control already has closes it and changes nothing else.
      picker.nuiTestSelect(picker.selectedIndex ?? 0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
    });

    it('a row closes it, the handshake holds, and a refusal still closes it', async () => {
      // `nuiTestSelect` runs the same code a menu row's click does, so the menu really
      // closes.
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      const open = await waitForMenu(picker, (r) => r.expanded && r.rows > 0);
      expect(open.menu).not.toEqual(open.anchor);
      picker.nuiTestSelect(OPTIONS.length - 1);
      const afterPick = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(log.acceptedPickers.picker).toBe(OPTIONS.length - 1);
      expect(await indexReached(picker, OPTIONS.length - 1)).toBe(
        OPTIONS.length - 1
      );
      expect(afterPick.menu).toEqual([-1, -1, -1, -1]);

      // Choosing the row already shown is the refusal: it closes and emits nothing.
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      picker.nuiTestSelect(OPTIONS.length - 1);
      const afterRefusal = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(afterRefusal.expanded).toBe(false);
      expect(log.acceptedPickers.picker).toBe(OPTIONS.length - 1);
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      picker.nuiTestSelect(0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
      expect(log.acceptedPickers.picker).toBe(0);
      expect(await indexReached(picker, 0)).toBe(0);
    });

    it('relays the rows when the options change while it is open', async () => {
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      const open = await waitForMenu(picker, (r) => r.rows === OPTIONS.length);
      expect(open.rows).toBe(OPTIONS.length);
      log.setOptions?.(MORE_OPTIONS);
      const grown = await waitForMenu(
        picker,
        (r) => r.rows === MORE_OPTIONS.length
      );
      expect(grown.expanded).toBe(true);
      expect(grown.live).toBe(1);
      expect(grown.live).toBe(1);
      picker.nuiTestSelect(MORE_OPTIONS.length - 1);
      const after = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(after.rows).toBe(0);
      expect(log.acceptedPickers.picker).toBe(MORE_OPTIONS.length - 1);
      expect(await indexReached(picker, MORE_OPTIONS.length - 1)).toBe(
        MORE_OPTIONS.length - 1
      );
    });

    it('closes when the control is disabled while the menu is open', async () => {
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      log.setPickerDisabled?.(true);
      // `expanded` drops with the props batch and the window goes when Compose disposes
      // the popup a frame later, so wait for both.
      const closed = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(closed.live).toBe(0);
      expect(picker.disabled).toBe(true);
      const opens = await awaitCloseOver(picker);
      // Re-enabling must not resurrect a window nobody asked for.
      log.setPickerDisabled?.(false);
      await settle(300);
      expectStillClosed(picker, 'after re-enabling', opens);
    });

    it('keeps a closed menu closed through the batches that follow it', async () => {
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      const date = await handleOf(() => log.dates.date, 'hosted date picker');
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      picker.nuiTestSelect(2);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
      expect(await indexReached(picker, 2)).toBe(2);
      const opens = await awaitCloseOver(picker);

      // Three things that reach the Host after the close, none of which asks for a menu:
      // the control going back to enabled, the Host moving, and a second popup owner
      // presenting. Each is waited for where it lands, so a slow device delays a step
      // instead of skipping it; the dwell before each absence read is where a menu that
      // opened and closed again would still show in `opens` and `windows`.
      log.setPickerDisabled?.(true);
      await waitForDisabled(picker, true);
      log.setPickerDisabled?.(false);
      await waitForDisabled(picker, false);
      await settle(300);
      expectStillClosed(picker, 'after the disable and re-enable', opens);

      const beforeMove = anchorOf(picker);
      log.setSpacer?.(80);
      await waitForMenu(picker, (r) => r.anchor.join(',') !== beforeMove);
      await settle(300);
      expectStillClosed(picker, 'after the Host moved', opens);

      date.nuiTestPresent();
      await waitForDate(date, (r) => r.presented && r.livePresentations === 1);
      expectStillClosed(picker, 'while the date picker’s dialog is up', opens);
      log.setDateDisabled?.(true);
      await waitForDialogGone(date, 'the second popup owner’s dialog');

      // The count counts: the menu opens again, and the rows are the ones it draws.
      expect(parseMenuReport(picker.nuiTestMenuReport()).opens).toBe(opens);
      const reopened = await pressWitnessedAndOpen(picker);
      expect(reopened.rows).toBe(OPTIONS.length);
      expect(reopened.opens).toBe(opens + 1);
      picker.nuiTestSelect(0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
      expectStillClosed(
        picker,
        'after the second close',
        await awaitCloseOver(picker)
      );
    });

    it('leaves no window behind when the composition that opened one goes away', async () => {
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      const witness = await handleOf(
        () => log.pickers.witness,
        'witness picker'
      );
      expect(parseMenuReport(witness.nuiTestMenuReport()).live).toBe(0);

      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.live === 1);
      log.setPickerPresent?.(false);
      await waitForMenu(witness, (r) => r.live === 0);
      expect(parseMenuReport(witness.nuiTestMenuReport()).live).toBe(0);

      // A changed key is a removal and a mount; the menu must not reopen on the new
      // mount.
      delete log.pickers.picker;
      log.setPickerPresent?.(true);
      await settle(400);
      const second = await handleOf(() => log.pickers.picker, 'hosted picker');
      await pressWitnessed(second);
      await waitForMenu(second, (r) => r.live === 1);
      delete log.pickers.picker;
      log.setPickerKey?.('picker-b');
      await waitForMenu(
        need(log.pickers.witness, 'witness picker'),
        (r) => r.live === 0
      );
      await settle(500);
      expect(
        parseMenuReport(
          need(log.pickers.witness, 'witness picker').nuiTestMenuReport()
        ).live
      ).toBe(0);
      const rekeyed = await handleOf(
        () => log.pickers.picker,
        'hosted picker, new key'
      );
      expect(parseMenuReport(rekeyed.nuiTestMenuReport()).expanded).toBe(false);
    });

    it('opens two popup owners in one Host, one after the other', async () => {
      await mount(<TwoPopupOwners log={log} />);
      const picker = await handleOf(() => log.pickers.first, 'first picker');
      const date = await handleOf(() => log.dates.first, 'first date picker');
      await pressWitnessed(picker);
      const opened = await waitForMenu(
        picker,
        (r) => r.expanded && r.live === 1
      );
      expect(opened.rows).toBe(OPTIONS.length);
      expect(parseDateReport(date.nuiTestStateReport()).presented).toBe(false);
      picker.nuiTestSelect(2);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);

      date.nuiTestPresent();
      // `presented` is published with the props batch and the dialog composes a frame
      // later, so wait for the window too.
      const dialog = await waitForDate(
        date,
        (r) => r.presented && r.livePresentations === 1
      );
      expect(dialog.livePresentations).toBe(1);
      expect(parseMenuReport(picker.nuiTestMenuReport()).live).toBe(0);
      expect(await indexReached(picker, 2)).toBe(2);
      log.setDateDisabledTwo?.(true);
      const closed = await waitForDialogGone(date, 'hosted dialog + menu gate');
      expect(closed.livePresentations).toBe(0);
      expect(parseMenuReport(picker.nuiTestMenuReport()).live).toBe(0);
    });

    it('leaves nothing behind when the Host itself is dropped mid-menu', async () => {
      const { unmount } = await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.live === 1);
      unmount();
      await settle(600);
      // A dropped mount cannot report its own leak, so a fresh control reads the same
      // process-wide count.
      const after = newLog();
      await mount(<PopupHost log={after} />);
      const reader = await handleOf(
        () => after.pickers.witness,
        'witness picker'
      );
      expect(parseMenuReport(reader.nuiTestMenuReport()).live).toBe(0);
    });
  });

  // MARK: - DatePicker's dialog, hosted

  describe('Host \u00b7 a hosted DatePicker\u2019s dialog is a window of the Host', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    it('opens its dialog as a window of the Host\u2019s composition', async () => {
      await mount(<PopupHost log={log} />);
      const date = await handleOf(() => log.dates.date, 'hosted date picker');
      const before = parseDateReport(date.nuiTestStateReport());
      expect(before.presented).toBe(false);
      expect(before.livePresentations).toBe(0);
      date.nuiTestPresent();
      const open = await waitForDate(
        date,
        (r) => r.presented && r.livePresentations === 1
      );
      expect(open.livePresentations).toBe(1);
      expect(open.calendarMonth).toBe(Date.UTC(2026, 4, 1));
      // `livePresentations` is process-wide, so take the dialog down before leaving.
      // Disabling a control whose dialog is up closes it.
      log.setDateDisabled?.(true);
      const closed = await waitForDialogGone(date, 'dialog before Host drop');
      expect(closed.presented).toBe(false);
      log.setDateDisabled?.(false);
    });

    it('follows a value React writes while the dialog is open (G5)', async () => {
      await mount(<PopupHost log={log} />);
      const date = await handleOf(() => log.dates.date, 'hosted date picker');
      date.nuiTestPresent();
      const open = await waitForDate(date, (r) => r.presented);
      const moved = new Date(2027, 10, 3, 0, 0, 0, 0).getTime();
      const expectedMonth = Date.UTC(2027, 10, 1);
      log.writeDate?.(new Date(moved));
      // Wait on the calendar's own field, not on `displayed`: the model answers with
      // the props batch, and an effect writes the open dialog a frame later.
      const followed = await waitForDate(
        date,
        (r) => r.presented && r.calendarMonth === expectedMonth
      );
      expect(followed.displayed).toBe(moved);
      expect(open.calendarMonth).not.toBe(expectedMonth);
      log.setDateDisabled?.(true);
      await waitForDialogGone(date, 'dialog after the value-follow gate');
      log.setDateDisabled?.(false);
    });

    it('closes when the control is disabled while the dialog is open (G5)', async () => {
      await mount(<PopupHost log={log} />);
      const date = await handleOf(() => log.dates.date, 'hosted date picker');
      date.nuiTestPresent();
      await waitForDate(date, (r) => r.presented && r.livePresentations === 1);
      log.setDateDisabled?.(true);
      const closed = await waitForDialogGone(date, 'disabled while open (G5)');
      expect(closed.presented).toBe(false);
      expect(date.disabled).toBe(true);
      // Re-enabling must not bring a dismissed dialog back.
      log.setDateDisabled?.(false);
      await settle(300);
      expect(parseDateReport(date.nuiTestStateReport()).presented).toBe(false);
    });

    it('does not reopen a dialog that a hidden child left behind', async () => {
      await mount(<PopupHost log={log} />);
      const date = await handleOf(() => log.dates.date, 'hosted date picker');
      date.nuiTestPresent();
      await waitForDate(date, (r) => r.presented && r.livePresentations === 1);
      log.setDateHidden?.(true);
      const hidden = await waitForDialogGone(
        date,
        'hidden child leaves no window'
      );
      expect(hidden.presented).toBe(false);
      // A dialog nobody asked for would take a frame to compose, so give it more than
      // a frame before reading.
      log.setDateHidden?.(false);
      await settle(600);
      const shown = parseDateReport(date.nuiTestStateReport());
      expect(shown.presented).toBe(false);
      expect(shown.livePresentations).toBe(0);
    });

    it('takes a hosted dialog down when only its child leaves the Host', async () => {
      const { unmount } = await mount(<PopupHost log={log} />);
      const date = await handleOf(() => log.dates.date, 'hosted date picker');
      await waitForNoDateWindows(
        date,
        (closed) => log.setDateDisabled?.(closed),
        'child-leaves-the-host'
      );
      date.nuiTestPresent();
      await waitForDate(date, (r) => r.presented && r.livePresentations === 1);
      log.setDatePresent?.(false);
      const gone = await waitForDialogGone(date, 'child leaves the Host');
      expect(gone.presented).toBe(false);
      // "No window left" would also hold if the Host stopped composing altogether, so
      // check the hosted Picker still opens its menu.
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      await pressWitnessedAndOpen(picker);
      expect(parseDateReport(date.nuiTestStateReport()).livePresentations).toBe(
        0
      );
      log.setPickerDisabled?.(true);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
      log.setPickerDisabled?.(false);
      unmount();
      await settle(400);
      // Read on a fresh mount: a removed child cannot report its own leak.
      const after = newLog();
      await mount(<PopupHost log={after} />);
      await expectDateWindowsAt(
        await handleOf(() => after.dates.date, 'fresh hosted date picker'),
        0,
        'child leaves the Host (fresh mount reader)'
      );
    });

    it('comes down with its row, and leaves nothing when the Host is dropped', async () => {
      await mount(<PopupHost log={log} />);
      const first = await handleOf(() => log.dates.date, 'hosted date picker');
      await waitForNoDateWindows(
        first,
        (closed) => log.setDateDisabled?.(closed),
        'comes-down-with-its-row'
      );
      first.nuiTestPresent();
      await waitForDate(first, (r) => r.presented && r.livePresentations === 1);
      // A row above the DatePicker leaves, so its own row is re-framed.
      log.setPickerPresent?.(false);
      const moved = await waitForDialogGone(first, 'comes down with its row');
      expect(moved.livePresentations).toBe(0);
      // A sibling's key change moves no other row, so the dialog must stay up.
      log.setPickerPresent?.(true);
      await settle(500);
      first.nuiTestPresent();
      await waitForDate(first, (r) => r.presented && r.livePresentations === 1);
      log.setPickerKey?.('picker-b');
      await settle(500);
      expect(parseDateReport(first.nuiTestStateReport()).presented).toBe(true);
      expect(
        parseDateReport(first.nuiTestStateReport()).livePresentations
      ).toBe(1);
      log.setPickerKey?.('picker-a');
      await settle(300);
      // Read on a fresh mount: a dropped Host cannot report its own leak.
      delete log.dates.date;
      const { unmount } = await mount(<PopupHost log={log} />);
      const second = await handleOf(() => log.dates.date, 'hosted date picker');
      second.nuiTestPresent();
      await waitForDate(
        second,
        (r) => r.presented && r.livePresentations === 1
      );
      unmount();
      await settle(600);
      const after = newLog();
      await mount(<PopupHost log={after} />);
      const reader = await handleOf(
        () => after.dates.date,
        'hosted date picker'
      );
      await expectDateWindowsAt(
        reader,
        0,
        'comes down with its row (fresh mount reader)'
      );
    });

    it('presents a dialog for the time and datetime modes too', async () => {
      for (const mode of ['time', 'datetime'] as const) {
        const modeLog = newLog();
        const { unmount } = await mount(
          <PopupHost log={modeLog} mode={mode} />
        );
        const date = await handleOf(
          () => modeLog.dates.date,
          'hosted ' + mode + ' picker'
        );
        expect(date.mode).toBe(mode);
        await waitForNoDateWindows(
          date,
          (closed) => modeLog.setDateDisabled?.(closed),
          `hosted ${mode} picker`
        );
        date.nuiTestPresent();
        const open = await waitForDate(
          date,
          (r) => r.presented && r.livePresentations === 1
        );
        expect(open.livePresentations).toBe(1);
        unmount();
        await settle(400);
        expect(
          parseDateReport(date.nuiTestStateReport()).livePresentations
        ).toBe(0);
      }
    });

    it('presses where the witness says a control is, not where RN says', async () => {
      await mount(<PopupHost log={log} />);
      const picker = await handleOf(() => log.pickers.picker, 'hosted picker');
      const own = harnessUi.queryByTestId('pop-picker');
      expect(own).not.toBeNull();
      expect(own!.width * own!.height).toBe(0);
      const [left, top, right, bottom] = edges(
        parseMenuReport(picker.nuiTestMenuReport()).anchor,
        'anchor'
      );
      expect(right).toBeGreaterThan(left);
      expect(bottom - top).toBeGreaterThan(10);
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded);
      picker.nuiTestSelect(picker.selectedIndex ?? 0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
    });
  });

  // MARK: - All seven controls, one Host (brief item 4)

  const SEVEN = [
    'mix-sw-0',
    'mix-sl-1',
    'mix-pr-2',
    'mix-btn-3',
    'mix-seg-4',
    'mix-pk-5',
    'mix-dp-6',
  ];

  const PRESSABLE = ['sw', 'btn'];

  const kindOf = (id: string) => id.split('-')[1] ?? '';

  function SevenList({ log, ids }: { log: Log; ids: string[] }) {
    const [current, setCurrent] = useState(ids);
    const [switches, setSwitches] = useState<Record<string, boolean>>({});
    const [segments, setSegments] = useState<Record<string, number>>({});
    const [picks, setPicks] = useState<Record<string, number>>({});
    const [dates, setDates] = useState<Record<string, number>>({});
    const [dateOff, setDateOff] = useState<Record<string, boolean>>({});
    log.setIds = setCurrent;
    log.setDateDisabledFor = (id, disabled) =>
      setDateOff((off) => ({ ...off, [id]: disabled }));
    return (
      <Host testID="seven-host" style={{ width: 300, height: 360 }}>
        {current.map((id) => {
          const kind = kindOf(id);
          if (kind === 'sw') {
            return (
              <Switch
                key={id}
                testID={id}
                accessibilityLabel={`Seven switch ${id.slice(-1)}`}
                value={switches[id] ?? false}
                onValueChange={(next) => {
                  log.taps.push(id);
                  log.acceptedSwitches[id] = next;
                  setSwitches((c) => ({ ...c, [id]: next }));
                }}
              />
            );
          }
          if (kind === 'btn') {
            return (
              <Button
                key={id}
                testID={id}
                title={`Go ${id.slice(-1)}`}
                accessibilityLabel={`Seven button ${id.slice(-1)}`}
                onPress={() => {
                  log.taps.push(id);
                }}
              />
            );
          }
          if (kind === 'sl') {
            return (
              <Slider
                key={id}
                testID={id}
                defaultValue={0.3}
                accessibilityLabel={`Seven slider ${id.slice(-1)}`}
              />
            );
          }
          if (kind === 'pr') {
            return (
              <Progress
                key={id}
                testID={id}
                value={0.4}
                accessibilityLabel={`Seven progress ${id.slice(-1)}`}
              />
            );
          }
          if (kind === 'seg') {
            return (
              <SegmentedControl
                key={id}
                testID={id}
                options={['One', 'Two', 'Three']}
                selectedIndex={segments[id] ?? 0}
                accessibilityLabel={`Seven segmented ${id.slice(-1)}`}
                onChange={(event) => {
                  log.taps.push(id);
                  log.acceptedSegments[id] = event.index;
                  setSegments((c) => ({ ...c, [id]: event.index }));
                }}
              />
            );
          }
          if (kind === 'pk') {
            return (
              <Picker
                key={id}
                testID={id}
                options={OPTIONS}
                selectedIndex={picks[id] ?? 0}
                label={`Pick ${id.slice(-1)}`}
                accessibilityLabel={`Seven picker ${id.slice(-1)}`}
                onChange={(event) => {
                  log.taps.push(id);
                  log.acceptedPickers[id] = event.index;
                  setPicks((c) => ({ ...c, [id]: event.index }));
                }}
                hybridRef={(view: PickerHandle) => {
                  log.pickers[id] = view;
                }}
              />
            );
          }
          return (
            <DatePicker
              key={id}
              testID={id}
              disabled={dateOff[id] ?? false}
              value={new Date(dates[id] ?? SEED)}
              accessibilityLabel={`Seven date picker ${id.slice(-1)}`}
              onChange={(next) => {
                log.acceptedDates[id] = next.getTime();
                setDates((c) => ({ ...c, [id]: next.getTime() }));
              }}
              hybridRef={(view: DatePickerHandle) => {
                log.dates[id] = view;
              }}
            />
          );
        })}
      </Host>
    );
  }

  describe('Host \u00b7 all seven controls, one composition', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    const pressableOf = (ids: string[]) =>
      ids.filter((id) => PRESSABLE.includes(kindOf(id)));

    // The shortest pressable row (a Switch) is about 34 dp tall, so a 24 dp stride
    // cannot skip one. A press that lands on a Picker or DatePicker field opens its
    // window; the sweep counts those and closes them, as popup counts are process-wide.
    async function sweepOrder(box: ViewInfo, ids: string[]) {
      const allowed = [
        ...pressableOf(ids),
        ...ids.filter((id) => kindOf(id) === 'sl'),
      ];
      const popupIds = ids.filter((id) => {
        const kind = kindOf(id);
        return kind === 'pk' || kind === 'dp';
      });
      // A row added since the last sweep may not have handed its handle back yet, and
      // `popupIsUp` reads a missing handle as "no window".
      for (const id of popupIds) {
        await (kindOf(id) === 'pk'
          ? handleOf(() => log.pickers[id], `seven picker ${id}`)
          : handleOf(() => log.dates[id], `seven date picker ${id}`));
      }
      const opened = new Set<string>();
      const seen: string[] = [];
      for (let offset = 6; offset <= 300; offset += 24) {
        const before = log.taps.length;
        await userEvent.pressAt(box.x + 12, box.y + offset);
        await settle(90);
        const hit = log.taps.slice(before);
        expect(hit.length).toBeLessThanOrEqual(1);
        const last = hit[0];
        if (last != null) {
          expect(allowed).toContain(last);
          if (seen[seen.length - 1] !== last) {
            seen.push(last);
          }
        }
        for (const id of popupIds) {
          if (popupIsUp(id)) {
            opened.add(id);
          }
        }
      }
      // Close every popup row, not only those seen up: a dialog composes a frame after
      // the press, so one opened on the last press can miss every read above.
      for (const id of popupIds) {
        await closePopup(id);
      }
      return {
        order: seen.filter((hit) => PRESSABLE.includes(kindOf(hit))),
        windows: opened.size,
      };
    }

    function popupIsUp(id: string) {
      if (kindOf(id) === 'pk') {
        const picker = log.pickers[id];
        return (
          picker != null && parseMenuReport(picker.nuiTestMenuReport()).live > 0
        );
      }
      const date = log.dates[id];
      return (
        date != null &&
        parseDateReport(date.nuiTestStateReport()).livePresentations > 0
      );
    }

    // A pick closes a Picker's menu and disabling closes a DatePicker's dialog; a
    // harness press cannot reach either window.
    async function closePopup(id: string) {
      if (kindOf(id) === 'pk') {
        const picker = need(log.pickers[id], `seven picker ${id}`);
        picker.nuiTestSelect(picker.selectedIndex ?? 0);
        await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
        return;
      }
      const date = need(log.dates[id], `seven date picker ${id}`);
      log.setDateDisabledFor?.(id, true);
      await waitForDialogGone(date, `sweep close ${id}`);
      log.setDateDisabledFor?.(id, false);
    }

    it('mounts all seven hosted, and every handle arrives', async () => {
      await mount(<SevenList log={log} ids={SEVEN} />);
      for (const id of SEVEN) {
        const own = await boxOf(id);
        // A hosted control's own view declines to measure, so its box is empty.
        expect(own.width * own.height).toBe(0);
      }
      const picker = await handleOf(
        () => log.pickers['mix-pk-5'],
        'seven picker'
      );
      const date = await handleOf(
        () => log.dates['mix-dp-6'],
        'seven date picker'
      );
      expect(picker.options.length).toBe(OPTIONS.length);
      expect(date.variant).toBe('compact');
      expect(log.pickers['mix-pk-5']).toBeDefined();
    });

    it('follows all seven when two of them trade places', async () => {
      await mount(<SevenList log={log} ids={SEVEN} />);
      const host = await boxOf('seven-host');
      const stacked = await sweepOrder(host, SEVEN);
      expect(stacked.order).toEqual(['mix-sw-0', 'mix-btn-3']);
      expect(stacked.windows).toBeGreaterThan(0);

      const swapped = [
        'mix-btn-3',
        'mix-sl-1',
        'mix-pr-2',
        'mix-sw-0',
        'mix-seg-4',
        'mix-pk-5',
        'mix-dp-6',
      ];
      log.setIds?.(swapped);
      await settle(700);
      const swappedSweep = await sweepOrder(host, swapped);
      expect(swappedSweep.order).toEqual(['mix-btn-3', 'mix-sw-0']);
      expect(swappedSweep.windows).toBeGreaterThan(0);
      const moved = need(log.pickers['mix-pk-5'], 'reordered picker');
      expect(moved.options.length).toBe(OPTIONS.length);
      expect(moved.selectedIndex).toBe(0);
      expect(
        parseMenuReport(
          need(log.pickers['mix-pk-5'], 'reordered picker').nuiTestMenuReport()
        ).live
      ).toBe(0);
      expect(
        parseDateReport(
          need(log.dates['mix-dp-6'], 'reordered date').nuiTestStateReport()
        ).livePresentations
      ).toBe(0);
    });

    it('takes a hosted menu down when a reorder moves the row under it', async () => {
      // The key is unchanged, so React Native keeps the view and only the column's
      // order moves under the open menu.
      await mount(<SevenList log={log} ids={SEVEN} />);
      const picker = await handleOf(
        () => log.pickers['mix-pk-5'],
        'seven picker'
      );
      await pressWitnessedAndOpen(picker);
      log.setIds?.([
        'mix-pk-5',
        'mix-sw-0',
        'mix-sl-1',
        'mix-pr-2',
        'mix-btn-3',
        'mix-seg-4',
        'mix-dp-6',
      ]);
      const gone = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(gone.menu).toEqual([-1, -1, -1, -1]);
      expect(gone.rows).toBe(0);
      await pressWitnessedAndOpen(picker);
      picker.nuiTestSelect(picker.selectedIndex ?? 0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
    });

    it('follows all seven when one is removed and another added back', async () => {
      await mount(<SevenList log={log} ids={SEVEN} />);
      const host = await boxOf('seven-host');

      const minusPicker = [
        'mix-sw-0',
        'mix-sl-1',
        'mix-pr-2',
        'mix-btn-3',
        'mix-seg-4',
        'mix-dp-6',
      ];
      log.setIds?.(minusPicker);
      await settle(700);
      const withoutPicker = await sweepOrder(host, minusPicker);
      expect(withoutPicker.order).toEqual(['mix-sw-0', 'mix-btn-3']);
      expect(withoutPicker.windows).toBeGreaterThan(0);
      expect(log.pickers['mix-pk-5']).toBeDefined();
      const withNew = [
        'mix-sw-0',
        'mix-sl-1',
        'mix-btn-3',
        'mix-seg-4',
        'mix-pk-7',
        'mix-dp-6',
      ];
      log.setIds?.(withNew);
      await settle(700);
      await boxOf('mix-pk-7');
      const withAnother = await sweepOrder(host, withNew);
      expect(withAnother.order).toEqual(['mix-sw-0', 'mix-btn-3']);
      expect(withAnother.windows).toBeGreaterThan(0);
      expect(
        parseMenuReport(
          need(log.pickers['mix-pk-7'], 'new picker').nuiTestMenuReport()
        ).live
      ).toBe(0);
    });

    it('opens a hosted menu inside the seven and still leaves nothing after a churn', async () => {
      const witness = newLog();
      for (let cycle = 0; cycle < 4; cycle += 1) {
        delete log.pickers['mix-pk-5'];
        delete log.dates['mix-dp-6'];
        const { unmount } = await mount(<SevenList log={log} ids={SEVEN} />);
        const picker = await handleOf(
          () => log.pickers['mix-pk-5'],
          'seven picker'
        );
        const date = await handleOf(
          () => log.dates['mix-dp-6'],
          'seven date picker'
        );
        if (cycle % 2 === 0) {
          await pressWitnessed(picker);
          await waitForMenu(picker, (r) => r.expanded && r.live === 1);
        } else {
          date.nuiTestPresent();
          await waitForDate(
            date,
            (r) => r.presented && r.livePresentations === 1
          );
        }
        unmount();
        await settle(500);
      }
      await mount(<SevenList log={witness} ids={SEVEN} />);
      const reader = await handleOf(
        () => witness.pickers['mix-pk-5'],
        'reader picker'
      );
      const dateReader = await handleOf(
        () => witness.dates['mix-dp-6'],
        'reader date'
      );
      expect(parseMenuReport(reader.nuiTestMenuReport()).live).toBe(0);
      await waitForNoDateWindows(
        dateReader,
        (closed) => witness.setDateDisabledFor?.('mix-dp-6', closed),
        'churn reader'
      );
      await expectDateWindowsAt(dateReader, 0, 'churn (fresh mount reader)');
    });
  });
}
