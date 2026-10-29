/**
 * On-device tests for the controls task H2b added to `<Host>`: **SegmentedControl,
 * Picker and DatePicker** — the three that open a window of their own.
 *
 * H1 shipped Switch and H2a shipped Slider, Progress and Button; those files stay the
 * owners of the geometry rules that do not depend on which control is inside. What is
 * different here is that a menu and a dialog are *not* inside the Host's rectangle:
 * each is a window, so nothing a React Native tree can read says where it is or whether
 * it is still there. That leaves exactly two things to measure, and this file measures
 * both.
 *
 * 1. **The witness.** `Picker.nuiTestMenuReport()` answers, from the composition that
 *    renders them, the anchor's screen rect, the open menu's own window rect, the rows
 *    it listed, and a process-wide count of composed menus. Those five numbers make the
 *    brief's claims testable: the menu sits **under the box the Host drew** (a delta
 *    between two rects, asserted twice with the Host moved in between — an absolute
 *    offset would be a statement about Material insets, and would pass when the anchor
 *    reading was simply broken), it **follows** the Host when the Host moves, and it is
 *    **gone** when the composition that opened it is (`live` back to 0, read from an
 *    unrelated second control because a dropped mount cannot report its own leak).
 * 2. **The press.** `pressAt` is given the anchor's rect as the witness reported it. If
 *    the witness were lying, the menu would not open — so every gate that opens a menu
 *    by pressing is also the red-proof that the rect it pressed with was measured, not
 *    assumed. The same is done for `SegmentedControl`, whose drawn segment is the only
 *    thing there is to aim at inside a Host.
 *
 * The DatePicker's dialog is read through `nuiTestStateReport()`, whose
 * `livePresentations` field is already process-wide for the same reason (G5 shipped it).
 * The two G5 follow-ups that touch this path are gated as well: a dialog follows a value
 * React writes while it is open, and a disabled control does not keep a window up.
 *
 * **Android asserts, iOS passes through.** `<Host>` is the documented passthrough there
 * (D23's outcome), so the popup cases would measure SwiftUI's own menu — which reports
 * nothing (`nuiTestMenuReport` answers `-1` for exactly that reason). The cases that hold
 * on both platforms — the SegmentedControl's props, and the mixed all-seven cases in
 * `HostControls.harness.tsx` and `MountChurn.harness.tsx` — run everywhere.
 */
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

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back for a Picker: props, and the popup witness. */
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

/** The five numbers a hosted menu is asked about, parsed out of its report line. */
type MenuReport = {
  expanded: boolean;
  live: number;
  anchor: number[];
  menu: number[];
  rows: number;
};

/**
 * The DatePicker report split: displayed ms, presented, calendar pair, live, builds,
 * built bounds.
 */
type DateReport = {
  displayed: number;
  presented: boolean;
  livePresentations: number;
  calendarMonth: number;
};

/**
 * What the harness can and cannot reach, and why the gates below are shaped the way they
 * are.
 *
 * `userEvent.pressAt` hands one point to the harness's touch injector, and on Android
 * that reaches the React Native window — which includes the `<Host>`'s composition, so
 * pressing the *anchor* of a hosted Picker really opens its menu (every gate here does
 * that). A Compose `Popup` and a Material dialog are *separate windows*, so neither a
 * press inside them nor an outside-tap dismissal reaches them from here. `DatePicker`
 * already documents this for the same reason ("a calendar cell in a dialog is a separate
 * window", `HybridNitroUiDatePicker.nuiTestSelect`), and `DatePicker.harness.tsx` says
 * the dialog's own Cancel/OK and the tap outside "are the platform's, not the harness's".
 *
 * So these gates use the seam a control offers for the same code path — `Picker`'s
 * `nuiTestSelect` goes through `applyUserSelection`, the one entry a popup row uses, so
 * the menu really closes — and the taps that must land in another window are gated where
 * they can land: `scripts/real-input`, whose `adb shell input` goes through the window
 * manager. This is a limit of the injector, not of the Host, and the report says so.
 */

/**
 * A parsed rect as four plain numbers.
 *
 * `noUncheckedIndexedAccess` makes every `rect[0]` an `| undefined`, and `?? 0` at each
 * use would let an unparsed or missing field read as "at the origin" — which is exactly
 * how a broken anchor measurement would sneak through a geometry gate. `edges` refuses
 * a short rect instead, so a report that lost a field fails here and not in a comparison.
 */
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
    anchor: rect('anchor'),
    menu: rect('menu'),
    rows: Number(field('rows')),
  };
}

function parseDateReport(line: string): DateReport {
  // `displayed | presented | calendarMonth | calendarHasSelection | live | builds
  // | builtMinimum | builtMaximum`, per `DatePickerModel.readReport`. The calendar pair
  // is two fields, which is where a `parts[3]` here comes from: it reads
  // `calendarHasSelection`, and `-1` for a control with no calendar on screen looks
  // exactly like a count that never came down.
  //
  // Eight since F3 appended what the control on screen was built with, so a bounds
  // change could be told apart from a re-render. This guard is the reason the pair is
  // documented rather than assumed: it is what caught that `HostPopups` was still
  // reading six, and the two new fields sit *after* the pair, so every index below is
  // the field it always was.
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

/**
 * A `hybridRef` handle the test needs, or a failure that names it.
 *
 * `noUncheckedIndexedAccess` makes every `log.pickers[id]` an `| undefined`, and the
 * alternative - optional chaining through a gate - turns a handle that never arrived
 * into `undefined === undefined`, which is green. Naming the handle in the message is
 * what makes the red legible.
 */
function need<T>(value: T | undefined, what: string): T {
  if (value == null) {
    throw new Error(
      `No hybrid handle for "${what}" - the control never mounted.`
    );
  }
  return value;
}

/**
 * Wait for a press's answer to reach JS, or fail naming the press that is missing.
 *
 * The device this runs on shares a machine with other tasks' emulators, so "answered
 * within N ms" is not the claim any of these gates wants to make - "an answer arrives"
 * is. Reading the log once also turns a press that never landed into a matcher error
 * about the *type* of `undefined`, which says nothing about the press.
 */
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

/** Poll for a `testID`; a hosted control mounts through the Host's composition. */
async function boxOf(testId: string, timeoutMs = 15000): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
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

async function mount(ui: Parameters<typeof render>[0], timeoutMs = 30000) {
  return await render(ui, { timeout: timeoutMs });
}

/**
 * `pressAt` wants React Native's own units; the witness answers in device pixels.
 *
 * One conversion, done where the two meet, and asserted: at the reported density a
 * hosted `SegmentedControl`'s segment has to be at least a few dp across, so a report
 * that was already in dp (or a density read wrongly) lands the press somewhere nothing
 * answers for and the gate goes red rather than quietly green.
 */
function dp(px: number): number {
  return px / PixelRatio.get();
}

/**
 * Poll the witness until `read` is happy, and hand back what it saw.
 *
 * Every popup assertion goes through here. A popup opens on the UI thread while JS is
 * back in the test, so a fixed sleep would measure the machine — the same reason
 * `waitForDisplayed` exists in `HostControls.harness.tsx`.
 */
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

/**
 * How long a dialog's *window* gets to come down once its own `presented` flag fell.
 *
 * The flag is model state and falls with the props batch; the count falls when the
 * UI thread disposes the dialog's subtree, a frame or two later. Waiting on the pair
 * with the file's 12 s default made "gone" mean "gone within twelve seconds", and a
 * dialog still composed over the screen three or ten seconds later is H2b's original
 * bug in a slower form. Two seconds is many frames, including the ones a loaded
 * machine spends between them (this file's own gates are run at load1 up to 39).
 *
 * The long budgets elsewhere in this file are not the same wait and stay long: the
 * baseline probe and the fresh-mount readers are waiting for *another* gate's
 * disposal to land, which nobody here can bound, and a long budget there only costs
 * time - it cannot let a lingering window pass, because the window it waits for is
 * not one it just closed.
 */
const DISMISSAL_GRACE_MS = 2000;

/**
 * Wait for a dialog to come down, and give the count only `DISMISSAL_GRACE_MS` of it.
 *
 * Two polls, in the order that makes both halves provable: the flag half with the
 * normal budget (a busy JS thread is allowed to be slow to re-render), then the count
 * half polled - not read once - inside a frame-scale window. Reading the count after
 * waiting only for the flag is what threw `expected 1 to be +0` at load 28, because
 * it measured the frame in between; waiting for the count with the full budget is
 * what let a lingering window pass. This waits for both, and fails if "both" takes
 * seconds.
 *
 * @param what the gate's own name, so a slow teardown says whose dialog it was
 */
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

/**
 * Earn the right to call the DatePicker window count zero.
 *
 * `livePresentations` counts every DatePicker dialog in the process (G5 shipped it
 * that way, and `readReport` reports it live on purpose: a dropped mount cannot
 * report its own leak). So a gate that asserts `=== 0` is asserting what every *other*
 * test in the file did too, and a leftover is charged to whichever gate reads next.
 * The likeliest leftover is not a leak: the harness's `cleanup()` only nulls React's
 * element, so a previous test's unmount — and the dialog's UI-thread `onDispose` with
 * it — can still be in flight when the next gate reads. That is X3's
 * `expected 1 to be 0` at load 5.3 and 6.7, green at 6.1: a disposal that lost a
 * race, on a file whose other gates *poll* the same count.
 *
 * Hence the name: this does not measure a baseline to subtract, and it never returns
 * anything but zero. Already zero is zero. Otherwise it opens a dialog of its own and
 * takes it down, which is the only probe that tells a disposal still in flight (it
 * comes down) from a window that is stuck (it does not, and that is a real leak worth
 * failing on — snapshotting the count instead would hide it behind a delta). Callers
 * therefore compare against 0 and 1 like the rest of the file, which is what this
 * helper makes true rather than assumes.
 *
 * @param closeWindow the app-side close for *this* control: `setDateDisabled` for
 *   the single-host screens, `setDateDisabledFor(id, …)` inside the seven list.
 */
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

/**
 * Read a process-wide count on a mount this gate did not open, and fail by name.
 *
 * The `waitForDate` + `expect` pair it replaces said only "Date report never
 * matched", which reads like the control mis-reported rather than like a window
 * somebody else left standing.
 */
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

/**
 * Press the middle of the box the *witness* says the control's row is.
 *
 * This is the whole trick of the file: inside a Host the React Native frame is `0 × 0`
 * (D24), so it is nothing to aim at, and the drawn row is not in the React Native tree
 * either. The witness is the only address there is — which is also why these cases are
 * the proof that the address is honest.
 */
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

/**
 * Press where the witness says the row is, and hand back the report once the window is up.
 *
 * The press is what proves the rect is current: aimed at a stale box it lands on something
 * else and no menu opens, so a gate that gets here has measured the anchor rather than
 * repeated it.
 */
async function pressWitnessedAndOpen(
  handle: PickerHandle
): Promise<MenuReport> {
  await pressWitnessed(handle);
  return await waitForMenu(handle, (r) => r.expanded && r.live === 1);
}

// MARK: - Fixtures

type Log = {
  /**
   * Every control in this file that answers a press, in order, named by `testID`.
   *
   * One list rather than one per control because a press has to answer for all of them:
   * two entries for one press is two hosted children claiming one touch, which is what
   * the ordering gates below read.
   */
  taps: string[];
  pickers: Record<string, PickerHandle>;
  segments: Record<string, SegmentedHandle>;
  dates: Record<string, DatePickerHandle>;
  /** Indices the app agreed to, by control id. Absent means refused. */
  acceptedPickers: Record<string, number>;
  acceptedSegments: Record<string, number>;
  acceptedDates: Record<string, number>;
  /** Every Switch answer, by id, so an order gate can say what was accepted. */
  acceptedSwitches: Record<string, boolean>;
  /** Replace the child list of the all-seven Host: add, remove, reorder. */
  setIds?: (ids: string[]) => void;
  /** Move a control with no touch at all: a real React write. */
  writePicker?: (index: number) => void;
  writeDate?: (date: Date) => void;
  setOptions?: (options: string[]) => void;
  setPickerDisabled?: (disabled: boolean) => void;
  setDateDisabled?: (disabled: boolean) => void;
  /** The same, on the two-owners fixture. */
  setDateDisabledTwo?: (disabled: boolean) => void;
  /** The same, on one row of the all-seven Host, addressed by id. */
  setDateDisabledFor?: (id: string, disabled: boolean) => void;
  /** The `Picker` child's identity, so a test can reorder or drop it. */
  setPickerKey?: (key: string) => void;
  setPickerPresent?: (present: boolean) => void;
  /** Take the `DatePicker` child out of the Host's list, leaving the others. */
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

/** 2026-05-17 local midnight, the seed for the DatePicker fixtures. */
const SEED = new Date(2026, 4, 17, 0, 0, 0, 0).getTime();

/**
 * One Host holding a SegmentedControl, a Picker and a DatePicker.
 *
 * The spacer above it moves the Host's rectangle, which is what a scroll does to a
 * composition's place on screen — and it is *not* a scroll, which the anchor-follow
 * gate says out loud: a spacer is a layout move, so `dropOpenMenu` runs, while a real
 * scroll changes neither the layout nor the anchor's box and is a path nothing here
 * drives. Real input covers the half it can: opening after a scroll, on both platforms.
 * Height rather than `ScrollView` because the harness has no scroll gesture — and the
 * witness moving is asserted, not assumed, so a spacer that failed to move the Host
 * would fail the gate that reads it.
 */
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
            // Hiding is not unmounting: the view stays in the React Native tree and
            // the handle stays live, and only the Host's composition drops the child
            // (`NitroComposeHost.isHiddenByReact`). That is the difference the gate
            // below needs — a teardown with no dismissal in it.
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
      {/* A second, unhosted control of the same kind: after a hosted mount is dropped
          mid-menu, this is what is left to ask. The count is process-wide on purpose. */}
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

/**
 * Two popup owners in one Host (brief item 4), each with its own id.
 */
function TwoPopupOwners({ log }: { log: Log }) {
  const [index, setIndex] = useState(0);
  const [date, setDate] = useState(() => new Date(SEED));
  const [dateDisabled, setDateDisabled] = useState(false);
  // The one dismissal the harness can drive on a dialog window (see the note above
  // `parseDateReport`): the control going out of service while its window is up.
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
});

beforeAll(async () => {
  // Pay the process-wide firsts before anything is asserted, as the other Host
  // suites do.
  const { unmount } = await mount(
    <Switch defaultValue testID="popups-warm-up" />
  );
  unmount();
});

// MARK: - SegmentedControl

/** One row of a hosted SegmentedControl, in dp — the engine's box for it. */
const SEG_ROW = 44;

/**
 * Two SegmentedControls in one Host: the row under test and a twin that always accepts.
 *
 * The twin is what makes every "nothing answered" below an assertion rather than an
 * accident — a Host that composed nothing at all would also answer nothing for the row
 * under test. `refuse` is the controlled fixture: the event reaches JS and the state
 * does not move, which is the snap-back the unhosted suite checks with a Slider drag.
 */
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
        hybridRef={(view: SegmentedHandle) => {
          log.segments.first = view;
        }}
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
        hybridRef={(view: SegmentedHandle) => {
          log.segments.second = view;
        }}
      />
    </Host>
  );
}

describe('Host · a hosted SegmentedControl is still a SegmentedControl', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  /**
   * Aim a press at the far segment of a hosted row.
   *
   * Android: inside the Host's box, through its composition, at the leading edge where
   * an intrinsic control draws (D24). iOS: the passthrough lays the child out as an RN
   * view, so aim at that view — the same split `HostControls.harness.tsx`'s `pressRow`
   * documents. The x is a fraction of the *Host's* width because the drawing's own width
   * is the control's and unknown to RN; the assertions are about which index answers,
   * never about a pixel.
   */
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
    const control = need(log.segments.first, 'segmented row');
    expect(control.selectedIndex).toBe(0);
    const hostBox = await boxOf('seg-host');
    const aim = await aimAt(hostBox, 0, 'seg-first');
    await userEvent.pressAt(aim.x, aim.y);
    // Something answered, and the value React kept moved with it: the event and the
    // controlled write are both alive inside somebody else's composition.
    const answered = await waitForAnswer(
      () => log.acceptedSegments.first,
      'first row press'
    );
    expect(answered).toBeGreaterThan(0);
    expect(control.selectedIndex).toBe(answered);
  });

  it('goes back to what React kept when the app refuses a change', async () => {
    await mount(<SegRows log={log} refuse />);
    const control = need(log.segments.first, 'segmented row');
    const hostBox = await boxOf('seg-host');
    const aim = await aimAt(hostBox, 0, 'seg-first');
    expect(control.selectedIndex).toBe(0);
    await userEvent.pressAt(aim.x, aim.y);
    // The press reached JS (so the row is live), the app said no, and the control still
    // shows what React holds.
    const refused = await waitForAnswer(
      () => log.acceptedSegments.first,
      'refused row press'
    );
    expect(refused).toBeGreaterThan(0);
    expect(control.selectedIndex).toBe(0);
    // And it is not stuck: the twin's press still answers after the refusal. A refusal
    // that left the composition unable to answer the *next* press is the failure this
    // half catches, and it is why the twin is pressed rather than re-read.
    const twin = await aimAt(hostBox, 1, 'seg-second');
    await userEvent.pressAt(twin.x, twin.y);
    const twinAnswer = await waitForAnswer(
      () => log.acceptedSegments.second,
      'twin row press, after the first was refused'
    );
    expect(twinAnswer).toBeGreaterThan(0);
    expect(need(log.segments.second, 'twin row').selectedIndex).toBe(
      twinAnswer
    );
  });

  it('answers nothing while disabled, and the twin beside it still does', async () => {
    await mount(<SegRows log={log} disableFirst />);
    const hostBox = await boxOf('seg-host');
    expect(need(log.segments.first, 'first row').disabled).toBe(true);
    const aim = await aimAt(hostBox, 0, 'seg-first');
    await userEvent.pressAt(aim.x, aim.y);
    await settle(350);
    expect(log.acceptedSegments.first).toBeUndefined();
    expect(need(log.segments.first, 'first row').selectedIndex).toBe(0);
    const twin = await aimAt(hostBox, 1, 'seg-second');
    await userEvent.pressAt(twin.x, twin.y);
    await settle(350);
    expect(log.acceptedSegments.second).not.toBeUndefined();
    expect(need(log.segments.second, 'twin row').selectedIndex).toBe(
      log.acceptedSegments.second
    );
  });

  it('draws its own width at the leading edge, not the Host’s (D24)', async () => {
    // `intrinsic` (sizing.md §4), like Button, and proved the same way: the answer, not
    // a pixel count. Three short titles are far narrower than a 300 dp Host, so a press
    // at the Host's far edge is outside the drawing and answers nothing. The second half
    // — the same row answering a press inside the drawing — is what stops "the Host
    // composed nothing" from reading the same as "the row is narrower than the Host".
    await mount(<SegRows log={log} />);
    const control = need(log.segments.first, 'segmented row');
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

// Android only, and the guard is the top-level one `Host.harness.tsx` and
// `MountChurn.harness.tsx` use: on iOS a Host is the documented passthrough (D23), so
// these cases would measure SwiftUI's own menu - which reports nothing, because
// `nuiTestMenuReport` answers `-1` there - rather than anything this task changed.
if (Platform.OS === 'android') {
  describe('Host · a hosted Picker’s menu is a window of the Host', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    it('anchors under the box the Host drew, and follows it when it moves', async () => {
      // The claim is a delta between two rects, asserted at two Host positions. An
      // absolute `menuTop - anchorBottom` would only state what Material insets are, and
      // would stay green if the anchor reading were pinned to nothing.
      await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
      const first = await pressWitnessedAndOpen(picker);
      const [aLeft, aTop, aRight, aBottom] = edges(first.anchor, 'anchor');
      const [mLeft, mTop, , mBottom] = edges(first.menu, 'menu');
      expect(aLeft).toBeGreaterThanOrEqual(0);
      expect(aRight).toBeGreaterThan(aLeft);
      expect(mBottom).toBeGreaterThan(mTop);
      expect(aBottom).toBeGreaterThan(aTop);
      // Under the anchor's box, and the menu's own window is not the anchor's rect.
      expect(mTop + 24).toBeGreaterThanOrEqual(aBottom);
      expect(Math.abs(mLeft - aLeft)).toBeLessThan(40);
      expect(first.rows).toBe(OPTIONS.length);
      const gap = mTop - aBottom;

      // Now move the Host. Compose is never told: a `Popup` positions itself against the
      // anchor's box inside its own composition, and this pass is React Native moving the
      // view underneath that composition. Measured on a device with the menu open and the
      // Host moved 120 dp: the anchor's box went from top 126 to top 441 while the menu's
      // window stayed at 294, a window pointing at where the row used to be. So the
      // control takes the window down instead (`HybridNitroUiPicker.dropOpenMenu`) — the
      // same answer it gives when a scrolling ancestor carries the anchor out of view.
      log.setSpacer?.(120);
      const moved = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(moved.menu).toEqual([-1, -1, -1, -1]);

      // The witness followed the Host rather than freezing where it first measured: the
      // press below is aimed at the rect it reports *now*, and if that rect were the old
      // one the press would land on the spacer and no menu would open. That is what makes
      // the second half evidence rather than a restatement of the first.
      const reopened = await pressWitnessedAndOpen(picker);
      const [nextLeft, , , nextBottom] = edges(reopened.anchor, 'anchor');
      const [nextMenuLeft, nextMenuTop] = edges(reopened.menu, 'menu');
      expect(
        Math.abs(nextBottom - aBottom - 120 * PixelRatio.get())
      ).toBeLessThan(6);
      // Same gap and same leading edge at the new position: the anchoring rule, twice.
      expect(Math.abs(nextMenuTop - nextBottom - gap)).toBeLessThan(2);
      expect(Math.abs(nextMenuLeft - nextLeft)).toBeLessThan(40);
      expect(reopened.rows).toBe(OPTIONS.length);
      // Leave nothing up. `live` counts menus in the whole process, so a window this
      // gate forgets to take down is the next gate's leak - and picking the index the
      // control already has is the close that changes nothing else (`applyUserSelection`
      // closes first, whatever the choice does).
      picker.nuiTestSelect(picker.selectedIndex ?? 0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
    });

    it('a row closes it, the handshake holds, and a refusal still closes it', async () => {
      // The row press is the seam, not a tap in the menu's window, for the reason at
      // `parseDateReport`: `nuiTestSelect` runs `applyUserSelection`, which is the one
      // entry a popup row's click uses (`HybridNitroUiPicker.applyUserSelection` says so),
      // so closing here is the same code a row reaches — and the menu really disappears,
      // which is what `live === 0` measures.
      await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      const open = await waitForMenu(picker, (r) => r.expanded && r.rows > 0);
      expect(open.menu).not.toEqual(open.anchor);
      picker.nuiTestSelect(OPTIONS.length - 1);
      const afterPick = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      // The handshake: the app's answer is what the control ends up showing, and the
      // window's rect is forgotten with the window — a stale one would let a later gate
      // press where a closed menu used to be.
      expect(log.acceptedPickers.picker).toBe(OPTIONS.length - 1);
      expect(picker.selectedIndex).toBe(OPTIONS.length - 1);
      expect(afterPick.menu).toEqual([-1, -1, -1, -1]);

      // Open it again and choose the row that is already shown. A refusal still has to
      // close the window (it must not survive the press that made no choice) and still
      // has to emit nothing.
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      picker.nuiTestSelect(OPTIONS.length - 1);
      const afterRefusal = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(afterRefusal.expanded).toBe(false);
      expect(log.acceptedPickers.picker).toBe(OPTIONS.length - 1);
      // ... and the next real choice still works, so the refusal left nothing armed.
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      picker.nuiTestSelect(0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
      expect(log.acceptedPickers.picker).toBe(0);
      expect(picker.selectedIndex).toBe(0);
    });

    it('relays the rows when the options change while it is open', async () => {
      await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
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
      // And the new list is the one a pick comes out of: the fifth row only exists in
      // the relaunched menu, so an answer of 4 says the window listed the new options.
      expect(grown.live).toBe(1);
      picker.nuiTestSelect(MORE_OPTIONS.length - 1);
      const after = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      // Closing clears what the window reported while it was open.
      expect(after.rows).toBe(0);
      expect(log.acceptedPickers.picker).toBe(MORE_OPTIONS.length - 1);
      expect(picker.selectedIndex).toBe(MORE_OPTIONS.length - 1);
    });

    it('closes when the control is disabled while the menu is open', async () => {
      await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.expanded && r.live === 1);
      log.setPickerDisabled?.(true);
      // Both halves, not just `expanded`: `expanded` is model state and drops the moment
      // the props batch lands, while the window goes when Compose disposes the popup —
      // so waiting on the first alone would read the frame in between as a pass.
      const closed = await waitForMenu(
        picker,
        (r) => !r.expanded && r.live === 0
      );
      expect(closed.live).toBe(0);
      expect(picker.disabled).toBe(true);
      // Re-enabling must not resurrect a window nobody asked for.
      log.setPickerDisabled?.(false);
      await settle(300);
      expect(parseMenuReport(picker.nuiTestMenuReport()).expanded).toBe(false);
      expect(parseMenuReport(picker.nuiTestMenuReport()).live).toBe(0);
    });

    it('leaves no window behind when the composition that opened one goes away', async () => {
      await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
      const witness = need(log.pickers.witness, 'witness picker');
      expect(parseMenuReport(witness.nuiTestMenuReport()).live).toBe(0);

      // (a) remove the child from the Host's list while its menu is open.
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.live === 1);
      log.setPickerPresent?.(false);
      await waitForMenu(witness, (r) => r.live === 0);
      expect(parseMenuReport(witness.nuiTestMenuReport()).live).toBe(0);

      // (b) put it back, open, and change its key — a reorder is a removal and a
      // mount, and a reopened window on the new identity is what must not happen.
      log.setPickerPresent?.(true);
      await settle(400);
      const second = need(log.pickers.picker, 'hosted picker');
      await pressWitnessed(second);
      await waitForMenu(second, (r) => r.live === 1);
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
      // …and it did not silently reopen itself on the new key.
      expect(
        parseMenuReport(
          need(log.pickers.picker, 'hosted picker').nuiTestMenuReport()
        ).expanded
      ).toBe(false);
    });

    it('opens two popup owners in one Host, one after the other', async () => {
      await mount(<TwoPopupOwners log={log} />);
      const picker = need(log.pickers.first, 'first picker');
      const date = need(log.dates.first, 'first date picker');
      await pressWitnessed(picker);
      const opened = await waitForMenu(
        picker,
        (r) => r.expanded && r.live === 1
      );
      // Two windows in one composition: the menu is up, and the dialog is not.
      expect(opened.rows).toBe(OPTIONS.length);
      expect(parseDateReport(date.nuiTestStateReport()).presented).toBe(false);
      picker.nuiTestSelect(2);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);

      // Then the dialog, in the same composition, with the menu gone.
      date.nuiTestPresent();
      // Wait for the window, not just the model's word for it: `presented` is published
      // with the props batch and the dialog composes a frame later.
      const dialog = await waitForDate(
        date,
        (r) => r.presented && r.livePresentations === 1
      );
      expect(dialog.livePresentations).toBe(1);
      expect(parseMenuReport(picker.nuiTestMenuReport()).live).toBe(0);
      expect(picker.selectedIndex).toBe(2);
      // Neither may be stuck. The dialog's own buttons are in its window (see the note
      // at `parseDateReport`), so this is the dismissal the harness can drive.
      log.setDateDisabledTwo?.(true);
      const closed = await waitForDialogGone(date, 'hosted dialog + menu gate');
      expect(closed.livePresentations).toBe(0);
      expect(parseMenuReport(picker.nuiTestMenuReport()).live).toBe(0);
    });

    it('leaves nothing behind when the Host itself is dropped mid-menu', async () => {
      const { unmount } = await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
      await pressWitnessed(picker);
      await waitForMenu(picker, (r) => r.live === 1);
      unmount();
      await settle(600);
      // The mount that leaked cannot report its own leak, so a fresh control reads the
      // same process-wide counter.
      const after = newLog();
      await mount(<PopupHost log={after} />);
      const reader = need(after.pickers.witness, 'witness picker');
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
      const date = need(log.dates.date, 'hosted date picker');
      const before = parseDateReport(date.nuiTestStateReport());
      expect(before.presented).toBe(false);
      expect(before.livePresentations).toBe(0);
      date.nuiTestPresent();
      const open = await waitForDate(
        date,
        (r) => r.presented && r.livePresentations === 1
      );
      // `presented` alone is not enough: it is model state, and a dialog that outlived its
      // mount would leave a stale one behind on a recycled control. `live` is the count a
      // later mount reads.
      expect(open.livePresentations).toBe(1);
      // And it is *this* control's dialog: the open calendar publishes the month it is
      // showing, so the dialog composed by the shared composition is on the value the
      // Host drew, not on some default.
      expect(open.calendarMonth).toBe(Date.UTC(2026, 4, 1));
      // Take the window down before leaving: `livePresentations` is process-wide, so a
      // dialog left up here would fail every gate after it — the same reason the leak
      // gates work. Disabling a control whose window is up closes it (G5).
      log.setDateDisabled?.(true);
      const closed = await waitForDialogGone(date, 'dialog before Host drop');
      expect(closed.presented).toBe(false);
      log.setDateDisabled?.(false);
      // What the harness cannot press: the dialog's own OK and Cancel live in another
      // window (`parseDateReport`'s note), so they are gated where a real tap can reach a
      // window. On Android that is `hosted-date-picker` in `scripts/real-input`: a real
      // tap opens this dialog, a real tap on a day reaches JS, and OK, Cancel and Back
      // each take it down. On iOS `<Host>` is the passthrough (D23) and there is no
      // second window to press into, so `testRealInputHostedDatePicker` drives the same
      // JSX: the field's button, a day inside the presentation, and the tap outside that
      // presentation which dismisses it. The one dismissal neither case presses is a tap
      // outside the *Android* dialog's window — the H2b report lists it as the follow-up
      // it is, not as coverage.
    });

    it('follows a value React writes while the dialog is open (G5)', async () => {
      await mount(<PopupHost log={log} />);
      const date = need(log.dates.date, 'hosted date picker');
      date.nuiTestPresent();
      const open = await waitForDate(date, (r) => r.presented);
      // A different month, written with no touch: the dialog moves to it rather than sits
      // on a date the control no longer has. The calendar pair is published by the open
      // calendar itself, so this reads what the dialog shows, not what JS asked for.
      const moved = new Date(2027, 10, 3, 0, 0, 0, 0).getTime();
      const expectedMonth = Date.UTC(2027, 10, 1);
      log.writeDate?.(new Date(moved));
      // Wait on the calendar's own field, not on `displayed`: the model answers with the
      // props batch, and the open dialog is written by an effect a frame later. Waiting on
      // the model and then reading the calendar measured the frame in between.
      const followed = await waitForDate(
        date,
        (r) => r.presented && r.calendarMonth === expectedMonth
      );
      expect(followed.displayed).toBe(moved);
      expect(open.calendarMonth).not.toBe(expectedMonth);
      // Take the dialog down before leaving: `livePresentations` counts the whole
      // process, so leaving it up here reads as a leak in the mixed gates below.
      // Disabling is the app-side close, and the gate after this one is what proves it.
      log.setDateDisabled?.(true);
      await waitForDialogGone(date, 'dialog after the value-follow gate');
      log.setDateDisabled?.(false);
    });

    it('closes when the control is disabled while the dialog is open (G5)', async () => {
      await mount(<PopupHost log={log} />);
      const date = need(log.dates.date, 'hosted date picker');
      date.nuiTestPresent();
      await waitForDate(date, (r) => r.presented && r.livePresentations === 1);
      log.setDateDisabled?.(true);
      // Both halves, as the menu gate above does, and bounded: `presented` is model
      // state and drops with the props batch, while the window goes when Compose
      // disposes the dialog a frame or two later. Reading the count in between measured
      // a window already on its way out; waiting for the count with the file's whole
      // 12 s budget would accept a dialog still over the screen ten seconds later.
      const closed = await waitForDialogGone(date, 'disabled while open (G5)');
      expect(closed.presented).toBe(false);
      expect(date.disabled).toBe(true);
      // Re-enabling must not bring a dismissed dialog back.
      log.setDateDisabled?.(false);
      await settle(300);
      expect(parseDateReport(date.nuiTestStateReport()).presented).toBe(false);
    });

    /**
     * A hosted child React hid (`display: 'none'`) leaves the Host's composition, which
     * disposes the dialog's subtree without any dismissal in it.
     *
     * The model has to learn that. It does not on its own: `setVisibility` only tells the
     * Host its drawn content moved, and the `DisposableEffect` that counts live
     * presentations only decrements a number. So the open flag stayed true over a
     * teardown, and showing the child again composed the dialog back over the screen -
     * with no provisional selection left, because `rememberDatePickerState` lives in the
     * subtree that just died. `Picker`'s `MenuWitness` has written `model.expanded` from
     * `onDispose` for exactly this reason since H2b round 1; this is the same write, and
     * it is a no-op on every path that already closed the dialog.
     */
    it('does not reopen a dialog that a hidden child left behind', async () => {
      await mount(<PopupHost log={log} />);
      const date = need(log.dates.date, 'hosted date picker');
      date.nuiTestPresent();
      await waitForDate(date, (r) => r.presented && r.livePresentations === 1);
      // Hide it. The window goes because the composition dropped the child; `presented`
      // going with it is the fix, and the half this gate exists to watch.
      log.setDateHidden?.(true);
      const hidden = await waitForDialogGone(
        date,
        'hidden child leaves no window'
      );
      expect(hidden.presented).toBe(false);
      // Show it again. A dialog nobody asked for would compose itself here and take a
      // frame to appear, so give it more than a frame before reading the answer.
      log.setDateHidden?.(false);
      await settle(600);
      const shown = parseDateReport(date.nuiTestStateReport());
      expect(shown.presented).toBe(false);
      expect(shown.livePresentations).toBe(0);
    });

    /**
     * The removal the file was missing: only the `DatePicker` child leaves the Host while
     * its dialog is up, the SegmentedControl and the Picker stay where they are.
     *
     * The Host-drop gate below proves the composition can be taken down as a whole, and
     * the gate above proves a single child's hiding; a parent removing one row is the
     * third teardown an app actually performs. Two halves are asserted, because "no
     * window left" alone would also be true if the Host gave up composing everything:
     * the window is gone, *and* the composition that kept it is still answering.
     */
    it('takes a hosted dialog down when only its child leaves the Host', async () => {
      const { unmount } = await mount(<PopupHost log={log} />);
      const date = need(log.dates.date, 'hosted date picker');
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
      // And the rest of the Host is alive: the hosted Picker still opens its menu on a
      // press aimed by its own witness, in the same composition the dialog just left.
      const picker = need(log.pickers.picker, 'hosted picker');
      await pressWitnessedAndOpen(picker);
      expect(parseDateReport(date.nuiTestStateReport()).livePresentations).toBe(
        0
      );
      // Take that menu down before leaving, the way the disable gate does.
      log.setPickerDisabled?.(true);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
      log.setPickerDisabled?.(false);
      unmount();
      await settle(400);
      // Read the process-wide count on a fresh mount: the removed child's own handle is
      // the one thing that cannot be trusted to report about itself.
      const after = newLog();
      await mount(<PopupHost log={after} />);
      await expectDateWindowsAt(
        need(after.dates.date, 'fresh hosted date picker'),
        0,
        'child leaves the Host (fresh mount reader)'
      );
    });

    it('comes down with its row, and leaves nothing when the Host is dropped', async () => {
      await mount(<PopupHost log={log} />);
      const first = need(log.dates.date, 'hosted date picker');
      // Everything below counts relative to this: `livePresentations` is the whole
      // process, so a window another gate left mid-disposal would otherwise be
      // charged to this one as `expected 1 to be 0`.
      await waitForNoDateWindows(
        first,
        (closed) => log.setDateDisabled?.(closed),
        'comes-down-with-its-row'
      );
      first.nuiTestPresent();
      await waitForDate(first, (r) => r.presented && r.livePresentations === 1);
      // ... a row *above* it leaves, and its row is re-framed: the dialog comes down with
      // the row, which is the rule `docs/components/host.md` states for both popup
      // controls. Measured, both halves (H2b fix round, `HostPopups` probe):
      // a hosted menu whose row moved reads `expanded=0;live=0`, and so does a hosted
      // dialog - and the dialog used to read `presented=1;live=1` here, a window still
      // hanging over a row that was no longer there. That was the bug, not the contract.
      log.setPickerPresent?.(false);
      // Both halves, and bounded. `presented` is model state and falls with the props
      // batch; the count falls when Compose disposes the dialog's subtree, a frame or
      // two later. Waiting on `presented` and then reading the count measured the frame
      // in between - the `expected 1 to be +0` this gate threw at load 28 - while
      // waiting for the pair with the file's 12 s budget would have accepted a dialog
      // still composed seconds later, which is the bug this gate exists to catch.
      const moved = await waitForDialogGone(first, 'comes down with its row');
      expect(moved.livePresentations).toBe(0);
      // A change that leaves the row where it is must not close it either: this is the
      // guard against "tear the window down whenever the Host recomposes". A sibling's
      // key changing takes *that sibling's* group out and moves nothing else, and the
      // dialog above it is still up - measured as `presented=1`, one window above the
      // baseline.
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
      // ... and dropping the Host while a dialog is up must take the window with it. Read
      // on a fresh mount, because the dropped one cannot report its own leak.
      const { unmount } = await mount(<PopupHost log={log} />);
      const second = need(log.dates.date, 'hosted date picker');
      second.nuiTestPresent();
      await waitForDate(
        second,
        (r) => r.presented && r.livePresentations === 1
      );
      unmount();
      await settle(600);
      const after = newLog();
      await mount(<PopupHost log={after} />);
      const reader = need(after.dates.date, 'hosted date picker');
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
        const date = need(modeLog.dates.date, 'hosted ' + mode + ' picker');
        expect(date.mode).toBe(mode);
        await waitForNoDateWindows(
          date,
          (closed) => modeLog.setDateDisabled?.(closed),
          `hosted ${mode} picker`
        );
        date.nuiTestPresent();
        // Both halves in one wait, as the gates above do: `presented` is model state
        // and lands with the props batch, while the count moves when the dialog's
        // composition starts. Waiting on `presented` and then reading the count
        // measured the frame in between.
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
      // The sanity gate under the whole file. Inside a Host the child's own RN view is
      // `0 x 0` at mount (D24), so if the anchor rect these gates press with came from the
      // React Native frame, this would compare two zeroes and pass. It does not: the
      // witness has to report a real box, and the press that follows it has to open the
      // menu - which is the same evidence that makes the anchoring gates above honest.
      await mount(<PopupHost log={log} />);
      const picker = need(log.pickers.picker, 'hosted picker');
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
      // Same rule as every other gate here: a window opened is a window closed.
      picker.nuiTestSelect(picker.selectedIndex ?? 0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
    });
  });

  // MARK: - All seven controls, one Host (brief item 4)

  /** Every kind the library ships, in the order a settings screen would stack them. */
  const SEVEN = [
    'mix-sw-0',
    'mix-sl-1',
    'mix-pr-2',
    'mix-btn-3',
    'mix-seg-4',
    'mix-pk-5',
    'mix-dp-6',
  ];

  /** The kinds a harness press can get an answer out of, on both platforms. */
  const PRESSABLE = ['sw', 'btn'];

  const kindOf = (id: string) => id.split('-')[1] ?? '';

  /**
   * One Host whose children are named by `ids`, each id's *kind* choosing the control.
   *
   * This is H2a's `MixedList` with the three popup controls added, which is what the brief
   * asks the mixed add/remove/reorder cases to become. The popup controls never answer a
   * press in these cases - and they do raise a window during a sweep, which round 1
   * measured: a band landing on a `Picker`'s field or a `DatePicker`'s field opens it, the
   * same way it does outside a Host. `sweepOrder` reads that, counts it, and takes it down
   * again, because the popup count is process-wide and a window left up by one case is the
   * next case's "leak". What the popup rows contribute here is that they *recompose, move
   * and go away* with the other four, window and all.
   */
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

    /** The ids in `ids` a press can answer for, in list order. */
    const pressableOf = (ids: string[]) =>
      ids.filter((id) => PRESSABLE.includes(kindOf(id)));

    /**
     * Sweep the Host's column and report which pressable child answered each band.
     *
     * The stride is a claim, not a detail: the shortest pressable row in the seven (a
     * Switch) is ~34 dp tall, so a 24 dp step cannot skip a row it should have found, and
     * one sweep is 13 presses rather than the 24 that put this test over the 30 s harness
     * budget on a loaded machine. H2a's `HostControls.harness.tsx` sweeps the same way.
     *
     * Two of the seven rows are popup owners, and a band that lands on a `Picker` field
     * or a `DatePicker` field does what those controls do when touched: it opens their
     * window. Nothing shows up in `log.taps` for that - neither control answers until a
     * choice is made - so the sweep reads the two witnesses after every band, counts the
     * ids that were ever up, and closes whatever is still up on the way out. It has to:
     * the popup counts are process-wide, so a window left standing here is the next
     * case's "leak", and a sweep that had opened nothing would prove nothing by leaving
     * nothing behind either - which is what the returned count is for.
     */
    async function sweepOrder(box: ViewInfo, ids: string[]) {
      const allowed = [
        ...pressableOf(ids),
        ...ids.filter((id) => kindOf(id) === 'sl'),
      ];
      const popupIds = ids.filter((id) => {
        const kind = kindOf(id);
        return kind === 'pk' || kind === 'dp';
      });
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
      // Close every popup row the sweep pressed near, not just the ones it *saw* up.
      // A dialog composes a frame after the press, so one opened on the last band can
      // miss every band's read, enter nobody's `opened`, and then stand for the rest of
      // the process — the demonstrable leak-*creator* in this file, and the reason the
      // fresh-mount reader below has a baseline to earn at all. `closePopup` is already
      // a no-op for a row that never opened, so this costs nothing when there is
      // nothing to close; `opened` still answers what the sweep proved to open.
      for (const id of popupIds) {
        await closePopup(id);
      }
      return {
        order: seen.filter((hit) => PRESSABLE.includes(kindOf(hit))),
        windows: opened.size,
      };
    }

    /** Whether the popup control for `id` has a window on screen right now. */
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

    /**
     * Close one hosted popup the way an app can, and wait for the window to go.
     *
     * A harness press cannot reach a popup's own window (the note on `parseDateReport`
     * says why), so these use the two levers that live on the control: a `Picker` pick
     * closes its menu, and disabling a `DatePicker` closes its dialog
     * (`HybridNitroUiDatePicker.afterUpdate`). Both then wait on the process-wide count
     * rather than on the model's own flag, because the window goes a frame or two later.
     */
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
        // Every one of the seven is *hosted*: its own view declines to measure (D24), so
        // its box is nothing. A control left out of the allowlist draws nothing and keeps
        // a real React Native frame, which is what this distinguishes.
        expect(own.width * own.height).toBe(0);
      }
      expect(need(log.pickers['mix-pk-5'], 'seven picker').options.length).toBe(
        OPTIONS.length
      );
      expect(need(log.dates['mix-dp-6'], 'seven date picker').variant).toBe(
        'compact'
      );
      expect(log.pickers['mix-pk-5']).toBeDefined();
    });

    it('follows all seven when two of them trade places', async () => {
      await mount(<SevenList log={log} ids={SEVEN} />);
      const host = await boxOf('seven-host');
      const stacked = await sweepOrder(host, SEVEN);
      expect(stacked.order).toEqual(['mix-sw-0', 'mix-btn-3']);
      // Not vacuous: the column was swept through both popup rows, so a window opened.
      expect(stacked.windows).toBeGreaterThan(0);

      // Reorder: the Button and the Switch trade places, and the popup rows — the two
      // controls this task added — move in the same relayout as the pressable ones.
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
      // The popup controls came through the same relayout answering, and nothing of
      // theirs is up. The handle is the one the reordered list handed back — a stale one
      // would report a control that is no longer in the column.
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
      // The same child, at a different index: `key` is unchanged, so React Native keeps
      // both views and only the column's order moves under the open window.
      //
      // Not through the anchor's box, though - that is what the red proof of this gate
      // measured. Stubbing `anchorMoved` out left *this* gate green and turned the
      // anchor-follow gate above it red: a reorder takes the group out of the
      // composition, and a popup goes with the composition that composed it. So this is
      // an outcome gate - "a row that moved does not keep a stale list on screen" - and
      // the case named `anchors under the box the Host drew` is the witness for
      // `dropOpenMenu` itself.
      await mount(<SevenList log={log} ids={SEVEN} />);
      const picker = need(log.pickers['mix-pk-5'], 'seven picker');
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
      // No window, and no ghost of one in the report.
      expect(gone.menu).toEqual([-1, -1, -1, -1]);
      expect(gone.rows).toBe(0);
      // The row answers where it now is: the press below is aimed at the rect the
      // witness reports after the move, so a frozen anchor lands it on nothing.
      await pressWitnessedAndOpen(picker);
      picker.nuiTestSelect(picker.selectedIndex ?? 0);
      await waitForMenu(picker, (r) => !r.expanded && r.live === 0);
    });

    it('follows all seven when one is removed and another added back', async () => {
      await mount(<SevenList log={log} ids={SEVEN} />);
      const host = await boxOf('seven-host');

      // Remove the Picker row entirely, then add a Picker that never mounted before, at a
      // different index — a removal and an addition in one test, so a row that only
      // answers for its old slot cannot pass.
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
      // Nothing is left open by any of that moving.
      expect(
        parseMenuReport(
          need(log.pickers['mix-pk-7'], 'new picker').nuiTestMenuReport()
        ).live
      ).toBe(0);
    });

    it('opens a hosted menu inside the seven and still leaves nothing after a churn', async () => {
      // Churn with a window in play: mount all seven, open the Picker's menu, drop the
      // whole Host, and read the process-wide counts on a fresh mount. This is the leak
      // question `MountChurn.harness.tsx` asks of Switches, asked of the two controls that
      // own windows.
      const witness = newLog();
      for (let cycle = 0; cycle < 4; cycle += 1) {
        const { unmount } = await mount(<SevenList log={log} ids={SEVEN} />);
        const picker = need(log.pickers['mix-pk-5'], 'seven picker');
        const date = need(log.dates['mix-dp-6'], 'seven date picker');
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
      const reader = need(witness.pickers['mix-pk-5'], 'reader picker');
      const dateReader = need(witness.dates['mix-dp-6'], 'reader date');
      expect(parseMenuReport(reader.nuiTestMenuReport()).live).toBe(0);
      // The count is process-wide, so the baseline is earned on the reader's own
      // mount rather than assumed: a previous gate's unmount can still be in flight
      // here, and a window that comes down was never this churn's leak. One that
      // does not comes back as the baseline refusal, which names the leak.
      await waitForNoDateWindows(
        dateReader,
        (closed) => witness.setDateDisabledFor?.('mix-dp-6', closed),
        'churn reader'
      );
      await expectDateWindowsAt(dateReader, 0, 'churn (fresh mount reader)');
    });
  });
}
