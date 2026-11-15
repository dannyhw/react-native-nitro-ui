import { useCallback, useState } from 'react';
import { Platform, TurboModuleRegistry, View } from 'react-native';
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
  Checkbox,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

import { waitForHandle } from './handles';

/** The Checkbox's Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiCheckbox';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type CheckboxHandle = {
  readonly checked: boolean | null;
  readonly mostRecentEventCount: number;
  readonly label: string | null;
  readonly disabled: boolean;
  readonly indeterminate: boolean | null;
  readonly iosStyle: string;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  nuiTestToggle(): void;
  nuiTestProbeAccessibility(): void;
  nuiTestStateReport(): string;
};

const handles = new Map<string, CheckboxHandle>();
const captureHybrid =
  (testId: string) =>
  (view: CheckboxHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app was told, in order, as `testID:value`. */
const events: string[] = [];
const recordChecked =
  (testId: string) =>
  (checked: boolean): void => {
    events.push(`${testId}:${String(checked)}`);
  };

type Size = { width: number; height: number };

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

function corrections(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return (
    after.correctionsImmediate -
    before.correctionsImmediate +
    (after.correctionsBatched - before.correctionsBatched)
  );
}

/**
 * The correction counters are process-wide, so a straggler from an earlier case
 * can arrive as an extra correction. This waits for two consecutive equal
 * reads, and throws if the counter never settles.
 */
async function settledCorrections(what: string): Promise<NitroUiSizingStats> {
  let previous = stats();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(150);
    const current = stats();
    if (corrections(previous, current) === 0) {
      return current;
    }
    previous = current;
  }
  throw new Error(
    `${what}: the engine's correction counters kept moving for 3s (last read ` +
      `${String(previous.correctionsImmediate)}/` +
      `${String(previous.correctionsBatched)}), so no count here is a baseline`
  );
}

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

const sizeOf = (testId: string): Size | null => harnessUi.queryByTestId(testId);
const measured = (testId: string): Size | null =>
  handles.get(testId)?.measureContent() ?? null;

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

async function handleOf(testId: string): Promise<CheckboxHandle> {
  return waitForHandle(() => handles.get(testId), { what: `"${testId}"` });
}

async function waitForMeasured(testId: string, what: string): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

async function waitForRemeasure(
  testId: string,
  previous: Size,
  what: string
): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && !sameSize(size, previous) ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) still measures ${describeSize(previous)} - ` +
          'it never re-measured.'
      )
  );
}

async function waitForBox(testId: string, size: Size, what: string) {
  return pollUntil(
    () => (sameSize(sizeOf(testId), size) ? sizeOf(testId) : null),
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached ${describeSize(size)} - ` +
          `last box ${describeSize(sizeOf(testId))}, control measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/**
 * `off` is the label's middle measured against the row's middle, `room` how
 * much taller the row is than the text, both in dp. They come from the label's
 * own layout pass, so they arrive a frame after the mount; until then the field
 * reads `none`.
 */
async function waitForLabelBox(
  testId: string,
  what: string
): Promise<{ off: number; room: number }> {
  return pollUntil(
    () => {
      const value = reportOf(testId).labelBox;
      if (value == null || value === 'none') return null;
      const [off = NaN, room = NaN] = value.split(',').map(Number);
      return Number.isFinite(off) && Number.isFinite(room)
        ? { off, room }
        : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never reported its label's centring - it answers ` +
          `"${reportOf(testId).labelBox ?? 'no field'}".`
      )
  );
}

async function waitForDisplayed(testId: string, displayed: string) {
  return pollUntil(
    () => (reportOf(testId).displayed === displayed ? true : null),
    () =>
      new Error(
        `"${testId}" never drew displayed=${displayed} - it reports ` +
          `"${handles.get(testId)?.nuiTestStateReport() ?? 'no handle'}".`
      )
  );
}

/**
 * An iOS Checkbox's drawing is read from `symbol=`: the hosting view answers
 * `accessibilityElements == []` in-process, and the field is written in the
 * SwiftUI body. Android has no such field.
 */
async function waitForSymbol(testId: string, symbol: string) {
  return pollUntil(
    () => (reportOf(testId).symbol === symbol ? symbol : null),
    () =>
      new Error(
        `"${testId}" never drew symbol=${symbol} - it reports ` +
          `"${handles.get(testId)?.nuiTestStateReport() ?? 'no handle'}".`
      )
  );
}

async function waitForEvents(from: number, wanted: readonly string[]) {
  await pollUntil(
    () => {
      const seen = events.slice(from);
      return seen.length >= wanted.length ? seen : null;
    },
    () =>
      new Error(
        `expected events ${JSON.stringify(wanted)}, saw ` +
          JSON.stringify(events.slice(from))
      )
  );
  // Then a quiet period, and everything that arrived: a surplus event lands
  // after the count is reached, so the caller compares the whole list.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/**
 * Android: a harness tap, which Compose takes like any touch. iOS: the
 * checkbox's own `nuiTestToggle()`, which runs the tap's path. The harness's
 * iOS tap is a `UITouch` with no HID event behind it, and SwiftUI's gesture
 * refuses it.
 */
async function toggleCheckbox(testId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await userEvent.press(await waitForTestId(testId));
    return;
  }
  (await handleOf(testId)).nuiTestToggle();
}

async function probeAccessibility(testId: string): Promise<string> {
  const handle = await handleOf(testId);
  const before = Number(reportOf(testId).probes ?? '0');
  handle.nuiTestProbeAccessibility();
  return pollUntil(
    () =>
      Number(reportOf(testId).probes ?? '0') > before
        ? (reportOf(testId).a11y ?? '')
        : null,
    () => new Error(`"${testId}" never answered an accessibility probe.`)
  );
}

const STYLES = ['circle', 'square', 'switch'] as const;
type IosStyle = (typeof STYLES)[number];

/**
 * The key `Checkbox.tsx` builds: `indeterminate|label` on Android and
 * `0|iosStyle|label` on iOS, where the dash is painted inside the same symbol
 * box. Written out rather than imported, so a wrong helper cannot poison and
 * pass its own test.
 */
function sizingKey(
  indeterminate: boolean,
  label: string,
  style: IosStyle = 'circle'
): string {
  if (Platform.OS === 'android') {
    return `${indeterminate ? '1' : '0'}|${label}`;
  }
  // No `indeterminate ? '1' : ...` branch on purpose: on iOS the dash shares the box.
  return `0|${style}|${label}`;
}

function expectedSymbol(
  style: IosStyle,
  checked: boolean,
  indeterminate: boolean
): string {
  if (style === 'switch') return 'switch';
  const shape = style === 'square' ? 'square' : 'circle';
  if (checked) return `checkmark.${shape}.fill`;
  return indeterminate ? `minus.${shape}.fill` : shape;
}

/** A size that is no checkbox's, planted as the engine's answer before a mount. */
const WRONG_SIZE = { width: 11.5, height: 57.5 };

function poison(keys: readonly string[]): void {
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

const rowStyle = { gap: 8, alignItems: 'flex-start' } as const;

afterEach(() => {
  cleanup();
  handles.clear();
  events.length = 0;
});

describe('Checkbox · G15', () => {
  it('lays out bare and labelled at the size the control measured', async () => {
    poison([sizingKey(false, ''), sizingKey(false, 'Measured')]);
    const before = stats();
    await render(
      <View style={rowStyle}>
        <Checkbox
          accessibilityLabel="Measured bare"
          testID="bare"
          hybridRef={captureHybrid('bare')}
        />
        <Checkbox
          label="Measured"
          testID="labelled"
          hybridRef={captureHybrid('labelled')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes: string[] = [];
    for (const testId of ['bare', 'labelled']) {
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, testId);
      const box = await waitForBox(testId, content, testId);
      boxes.push(`${testId}=${describeSize(box)}`);
      expect(sameSize(content, WRONG_SIZE)).toBe(false);
    }
    const made = corrections(before, stats());
    console.log(`checkbox sizes: ${boxes.join(' ')} corrections=${made}`);
    // Two cold, poisoned configurations: each has to be corrected, or the boxes
    // above came from the planted size.
    expect(made).toBeGreaterThanOrEqual(2);
    const bareSize = await waitForMeasured('bare', 'the bare box');
    const labelledSize = await waitForMeasured('labelled', 'the labelled one');
    expect(labelledSize.width).toBeGreaterThan(bareSize.width + 10);
    expect(Math.abs(labelledSize.height - bareSize.height)).toBeLessThan(0.6);
  });

  it('re-measures when the label changes', async () => {
    const { rerender } = await render(
      <Checkbox
        label="Short"
        testID="label"
        hybridRef={captureHybrid('label')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('label');
    const short = await waitForMeasured('label', 'the short label');
    await waitForBox('label', short, 'the short label');
    await rerender(
      <Checkbox
        label="A much longer label"
        testID="label"
        hybridRef={captureHybrid('label')}
      />
    );
    const long = await waitForRemeasure('label', short, 'the long label');
    await waitForBox('label', long, 'the long label');
    expect(long.width).toBeGreaterThan(short.width + 20);
  });

  it('keeps its size checked and unchecked', async () => {
    // One is checked from its first frame, so each size is taken by a control
    // that never changed state.
    await render(
      <View style={rowStyle}>
        <Checkbox
          label="Sized"
          checked={false}
          testID="off"
          hybridRef={captureHybrid('off')}
        />
        <Checkbox
          label="Sized"
          checked
          testID="on"
          hybridRef={captureHybrid('on')}
        />
        {/*
          On iOS the empty box, the check mark and the dash are one symbol box.
        */}
        <Checkbox
          label="Sized"
          indeterminate
          testID="dash"
          hybridRef={captureHybrid('dash')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('off');
    await waitForTestId('on');
    await waitForTestId('dash');
    const off = await waitForMeasured('off', 'unchecked');
    const on = await waitForMeasured('on', 'checked');
    const dash = await waitForMeasured('dash', 'the third state');
    await waitForBox('off', off, 'unchecked');
    await waitForBox('on', on, 'checked');
    await waitForBox('dash', dash, 'the third state');
    await waitForDisplayed('on', '1');
    await waitForDisplayed('off', '0');
    await waitForDisplayed('dash', 'mixed');
    console.log(
      `checkbox states: off=${describeSize(off)} on=${describeSize(on)} ` +
        `dash=${describeSize(dash)}`
    );
    expect(sameSize(on, off)).toBe(true);
    expect(sameSize(dash, off)).toBe(true);
  });

  it('follows a controlled checked in both directions', async () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      const onChange = useCallback((next: boolean) => {
        events.push(`controlled:${String(next)}`);
        setOn(next);
      }, []);
      return (
        <Checkbox
          label="Controlled"
          checked={on}
          onCheckedChange={onChange}
          testID="controlled"
          hybridRef={captureHybrid('controlled')}
        />
      );
    }
    await render(<Controlled />);
    await waitForTestId('controlled');
    await waitForDisplayed('controlled', '0');
    await toggleCheckbox('controlled');
    expect(await waitForEvents(0, ['controlled:true'])).toEqual([
      'controlled:true',
    ]);
    await waitForDisplayed('controlled', '1');
    await toggleCheckbox('controlled');
    expect(
      await waitForEvents(0, ['controlled:true', 'controlled:false'])
    ).toEqual(['controlled:true', 'controlled:false']);
    await waitForDisplayed('controlled', '0');
    expect(handles.get('controlled')?.checked).toBe(false);
  });

  it('reverts a toggle JS refused', async () => {
    // The handler never updates state, so `checked` stays false.
    await render(
      <Checkbox
        label="Refused"
        checked={false}
        onCheckedChange={recordChecked('refused')}
        testID="refused"
        hybridRef={captureHybrid('refused')}
      />
    );
    await waitForTestId('refused');
    await waitForDisplayed('refused', '0');
    await toggleCheckbox('refused');
    await waitForEvents(0, ['refused:true']);
    await waitForDisplayed('refused', '0');
    // And the next toggle starts from unchecked, so it requests `true` again. A
    // checkbox that kept the refused value would request `false`.
    await toggleCheckbox('refused');
    expect(await waitForEvents(0, ['refused:true', 'refused:true'])).toEqual([
      'refused:true',
      'refused:true',
    ]);
    await waitForDisplayed('refused', '0');
    expect(handles.get('refused')?.mostRecentEventCount).toBeGreaterThanOrEqual(
      2
    );
  });

  it('applies a value written from JS, and keeps its own when uncontrolled', async () => {
    const { rerender } = await render(
      <View style={rowStyle}>
        <Checkbox
          label="From JS"
          checked={false}
          testID="from-js"
          hybridRef={captureHybrid('from-js')}
        />
        <Checkbox
          label="Free"
          defaultChecked
          onCheckedChange={recordChecked('free')}
          testID="free"
          hybridRef={captureHybrid('free')}
        />
      </View>
    );
    await waitForTestId('from-js');
    await waitForDisplayed('from-js', '0');
    await waitForDisplayed('free', '1');
    await rerender(
      <View style={rowStyle}>
        <Checkbox
          label="From JS"
          checked
          testID="from-js"
          hybridRef={captureHybrid('from-js')}
        />
        <Checkbox
          label="Free"
          defaultChecked
          onCheckedChange={recordChecked('free')}
          testID="free"
          hybridRef={captureHybrid('free')}
        />
      </View>
    );
    await waitForDisplayed('from-js', '1');

    await toggleCheckbox('free');
    const first = await waitForEvents(0, ['free:false']);
    expect(first).toEqual(['free:false']);
    await waitForDisplayed('free', '0');
  });

  it('draws the third state on both platforms, and off in the switch style', async () => {
    // `checked` outranks `indeterminate` on both platforms, and a tap on the
    // dash reports `true`. Both keys are poisoned: on Android the dash is a
    // configuration of its own; on iOS `sizingKey` answers the same string for
    // both.
    poison([sizingKey(true, 'Select all'), sizingKey(false, 'Select all')]);
    const before = stats();
    await render(
      <View style={rowStyle}>
        <Checkbox
          label="Select all"
          indeterminate
          onCheckedChange={recordChecked('mixed')}
          testID="mixed"
          hybridRef={captureHybrid('mixed')}
        />
        {/*
          The same label with the third state off, to compare the two boxes.
        */}
        <Checkbox
          label="Select all"
          testID="plain"
          hybridRef={captureHybrid('plain')}
        />
        <Checkbox
          label="Select all, checked"
          checked
          indeterminate
          testID="mixed-on"
          hybridRef={captureHybrid('mixed-on')}
        />
        <Checkbox
          label="Select all, switch"
          iosStyle="switch"
          indeterminate
          testID="mixed-switch"
          hybridRef={captureHybrid('mixed-switch')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('mixed');
    const size = await waitForMeasured('mixed', 'the third state');
    await waitForBox('mixed', size, 'the third state');
    await waitForTestId('plain');
    const plainSize = await waitForMeasured(
      'plain',
      'the same label, unchecked'
    );
    await waitForBox('plain', plainSize, 'the same label, unchecked');
    const made = corrections(before, stats());
    await waitForDisplayed('mixed', 'mixed');
    await waitForDisplayed('mixed-on', '1');
    if (Platform.OS === 'ios') {
      await waitForSymbol('mixed', 'minus.circle.fill');
      await waitForSymbol('mixed-on', 'checkmark.circle.fill');
      // The switch has two positions: the prop arrives, and the answer stays `0`.
      await waitForDisplayed('mixed-switch', '0');
      await waitForSymbol('mixed-switch', 'switch');
    } else {
      await waitForLabelBox('mixed', 'the third state');
    }
    expect(made).toBeGreaterThanOrEqual(2);
    expect(sameSize(size, WRONG_SIZE)).toBe(false);
    expect(sameSize(plainSize, WRONG_SIZE)).toBe(false);
    // The dash replaces the mark inside the same box: one label, two states,
    // one size.
    expect(sameSize(size, plainSize)).toBe(true);
    await toggleCheckbox('mixed');
    expect(await waitForEvents(0, ['mixed:true'])).toEqual(['mixed:true']);
    await waitForDisplayed('mixed', '1');
    if (Platform.OS === 'ios') {
      await waitForSymbol('mixed', 'checkmark.circle.fill');
    }
    // Read settled, so these corrections cannot land inside the next case's
    // window.
    const total = corrections(
      before,
      await settledCorrections('the third state')
    );
    console.log(
      `checkbox indeterminate: drawn=${reportOf('mixed').displayed} ` +
        `symbol=${reportOf('mixed').symbol ?? '-'} checked-with-dash=` +
        `${reportOf('mixed-on').displayed} switch=${reportOf('mixed-switch').displayed} ` +
        `size=${describeSize(size)} corrections=${total}`
    );
  });

  it('costs nothing to flip a mounted row to the third state on iOS', async () => {
    // Both keys are poisoned, the dash's included, which iOS never asks about:
    // if `indeterminate` were in the iOS key, the flip would relayout the row
    // at the planted size.
    poison([sizingKey(true, 'Warm flip'), sizingKey(false, 'Warm flip')]);
    const { rerender } = await render(
      <Checkbox
        label="Warm flip"
        testID="warm"
        hybridRef={captureHybrid('warm')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('warm');
    const plain = await waitForMeasured('warm', 'the unchecked row');
    await waitForBox('warm', plain, 'the unchecked row');
    expect(sameSize(plain, WRONG_SIZE)).toBe(false);
    // The window starts after that correction has landed: the counters are process-wide.
    await settledCorrections('the warm row');
    const before = stats();
    await rerender(
      <Checkbox
        label="Warm flip"
        indeterminate
        testID="warm"
        hybridRef={captureHybrid('warm')}
      />
    );
    const handle = await handleOf('warm');
    // "Nothing happened" only means something once the prop has arrived.
    await pollUntil(
      () => (handle.indeterminate === true ? true : null),
      () =>
        new Error(
          `"warm" never took the third state it was sent - it answers indeterminate=` +
            `${String(handle.indeterminate)}.`
        )
    );
    if (Platform.OS === 'ios') {
      await waitForSymbol('warm', 'minus.circle.fill');
    }
    await waitForDisplayed('warm', 'mixed');
    const made = corrections(before, await settledCorrections('the warm flip'));
    const after = measured('warm');
    console.log(
      `checkbox warm indeterminate: plain=${describeSize(plain)} ` +
        `flipped=${describeSize(after)} corrections=${made}`
    );
    expect(sameSize(after, plain)).toBe(true);
    if (Platform.OS === 'ios') {
      // Zero: a row already on screen at its own size owes the engine nothing.
      expect(made).toBe(0);
    } else {
      // On Android the flip is `TriStateCheckbox`, a configuration of its own,
      // so the planted size under its key has to be corrected.
      expect(made).toBeGreaterThanOrEqual(1);
    }
  });

  it('takes no toggle while disabled', async () => {
    await render(
      <View style={rowStyle}>
        <Checkbox
          label="Disabled"
          disabled
          checked
          onCheckedChange={recordChecked('disabled')}
          testID="disabled"
          hybridRef={captureHybrid('disabled')}
        />
        {/* The barrier: an enabled checkbox whose event can be awaited, so an empty
            log for the disabled one means "delivered nothing", not "not yet". */}
        <Checkbox
          label="Barrier"
          onCheckedChange={recordChecked('barrier')}
          testID="barrier"
          hybridRef={captureHybrid('barrier')}
        />
      </View>
    );
    await waitForTestId('disabled');
    await waitForTestId('barrier');
    await waitForDisplayed('disabled', '1');
    if (Platform.OS === 'ios') {
      await waitForSymbol('barrier', 'circle');
    }
    await toggleCheckbox('disabled');
    await toggleCheckbox('disabled');
    await toggleCheckbox('barrier');
    expect(await waitForEvents(0, ['barrier:true'])).toEqual(['barrier:true']);
    await sleep(200);
    expect(events).toEqual(['barrier:true']);
    await waitForDisplayed('disabled', '1');
    expect(handles.get('disabled')?.disabled).toBe(true);
    expect(handles.get('disabled')?.mostRecentEventCount).toBe(0);
    if (Platform.OS === 'ios') {
      // A disabled checkbox is the same glyph with `.opacity` over it, so it
      // still names its state.
      await waitForSymbol('disabled', 'checkmark.circle.fill');
      await waitForSymbol('barrier', 'checkmark.circle.fill');
    }
  });

  it('is one node with the label as its name when a label is shown', async () => {
    // Android reads its own merged semantics node. iOS has nothing to read
    // in-process, and reports `unavailable`.
    await render(
      <View style={rowStyle}>
        <Checkbox
          label="Email me offers"
          onCheckedChange={recordChecked('a11y-labelled')}
          testID="a11y-labelled"
          hybridRef={captureHybrid('a11y-labelled')}
        />
        <Checkbox
          accessibilityLabel="Bare box"
          onCheckedChange={recordChecked('a11y-bare')}
          testID="a11y-bare"
          hybridRef={captureHybrid('a11y-bare')}
        />
        <Checkbox
          label="Closed"
          disabled
          testID="a11y-disabled"
          hybridRef={captureHybrid('a11y-disabled')}
        />
      </View>
    );
    for (const testId of ['a11y-labelled', 'a11y-bare', 'a11y-disabled']) {
      await waitForTestId(testId);
    }
    const off = await probeAccessibility('a11y-labelled');
    await toggleCheckbox('a11y-labelled');
    await waitForEvents(0, ['a11y-labelled:true']);
    await waitForDisplayed('a11y-labelled', '1');
    const on = await probeAccessibility('a11y-labelled');
    const bare = await probeAccessibility('a11y-bare');
    const disabled = await probeAccessibility('a11y-disabled');
    const merged = reportOf('a11y-labelled').merged ?? '';
    console.log(
      `checkbox a11y: off=[${off}] on=[${on}] bare=[${bare}] ` +
        `disabled=[${disabled}] merged=${merged}`
    );
    if (Platform.OS === 'android') {
      expect(off).toContain('role=Checkbox');
      expect(off).toContain('checked=false');
      expect(off).toContain('label=Email me offers');
      expect(on).toContain('checked=true');
      expect(bare).toContain('label=Bare box');
      expect(disabled).toContain('disabled=true');
      expect(on).toContain('disabled=false');
      // `merged` counts the nodes that publish a toggle: a labelled checkbox is
      // one focusable node.
      expect(merged).toBe('1');
    } else {
      for (const report of [off, on, bare, disabled]) {
        expect(report).toBe('unavailable');
      }
    }
  });

  it('centres its label against the box', async () => {
    // The row is 48 dp tall for the touch target and the text is far shorter,
    // so where the label sits in the row is measured from its own layout
    // coordinates.
    await render(
      <View style={rowStyle}>
        <Checkbox
          label="Email me offers"
          testID="centred"
          hybridRef={captureHybrid('centred')}
        />
      </View>
    );
    await waitForTestId('centred');
    if (Platform.OS === 'android') {
      const { off, room } = await waitForLabelBox(
        'centred',
        'the labelled Checkbox'
      );
      // Both numbers or neither: text as tall as its row is centred by every
      // alignment, so the room around the text is checked before the offset is
      // believed.
      if (room < 8 || Math.abs(off) > 1) {
        throw new Error(
          `"centred" draws its label ${String(off)}dp from the middle of a row that ` +
            `leaves ${String(room)}dp around the text`
        );
      }
    } else {
      // Nothing to read on iOS: the platform's `Toggle` lays out its own label.
      expect(reportOf('centred').labelBox).toBeUndefined();
    }
  });

  it('lays out every iOS style at the box that style measures', async () => {
    // Each iOS style is its own box, so the style is in the iOS sizing key and
    // all three are cold, poisoned configurations. Android stores and ignores
    // the prop, so three style names of one label are one configuration. The
    // baseline is taken once the process-wide counter has stopped moving.
    await settledCorrections('the iOS styles');
    poison(STYLES.map((style) => sizingKey(false, 'Measured', style)));
    const before = stats();
    await render(
      <View style={rowStyle}>
        {STYLES.map((style) => (
          <Checkbox
            key={style}
            label="Measured"
            iosStyle={style}
            checked
            testID={`style-${style}`}
            hybridRef={captureHybrid(`style-${style}`)}
          />
        ))}
        <Checkbox
          accessibilityLabel="Bare measured"
          testID="style-bare"
          hybridRef={captureHybrid('style-bare')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = new Map<IosStyle, Size>();
    for (const style of STYLES) {
      const testId = `style-${style}`;
      await waitForTestId(testId);
      const size = await waitForMeasured(testId, testId);
      await waitForBox(testId, size, testId);
      boxes.set(style, size);
      expect(sameSize(size, WRONG_SIZE)).toBe(false);
      if (Platform.OS === 'ios') {
        await waitForSymbol(testId, expectedSymbol(style, true, false));
      }
    }
    // The bare default box is deliberately not poisoned: it is the
    // configuration the declared fallback names.
    await waitForTestId('style-bare');
    const bare = await waitForMeasured('style-bare', 'the bare default box');
    await waitForBox('style-bare', bare, 'the bare default box');
    const made = corrections(before, stats());
    const boxOf = (style: IosStyle): Size => {
      const size = boxes.get(style);
      if (size == null) throw new Error(`no box for style "${style}"`);
      return size;
    };
    console.log(
      `checkbox styles: ${STYLES.map(
        (style) => `${style}=${describeSize(boxOf(style))}`
      ).join(' ')} bare=${describeSize(bare)} corrections=${made}`
    );
    if (Platform.OS === 'ios') {
      expect(made).toBeGreaterThanOrEqual(STYLES.length);
      expect(
        Math.abs(bare.width - 61) > 0.6 || Math.abs(bare.height - 28) > 0.6
      ).toBe(true);
      const circle = boxOf('circle');
      const toggled = boxOf('switch');
      expect(
        Math.abs(circle.width - toggled.width) > 0.6 ||
          Math.abs(circle.height - toggled.height) > 0.6
      ).toBe(true);
    } else {
      // No correction count is read on Android: it counts instances laid out at
      // a wrong size, one per instance sharing a key, so it cannot tell whether
      // the key carries the style.
      expect(sameSize(boxOf('square'), boxOf('circle'))).toBe(true);
      expect(sameSize(boxOf('switch'), boxOf('circle'))).toBe(true);
    }
  });

  it('draws the glyph its state names, and keeps one state per platform', async () => {
    // `symbol=` is what the iOS drawing code was handed, written in the SwiftUI
    // body. `displayed=` is asserted on both platforms: `checked` outranks
    // `indeterminate` on both.
    const fixtures = [
      { style: 'circle', checked: false, indeterminate: false },
      { style: 'circle', checked: true, indeterminate: false },
      { style: 'circle', checked: false, indeterminate: true },
      { style: 'circle', checked: true, indeterminate: true },
      { style: 'square', checked: false, indeterminate: false },
      { style: 'square', checked: true, indeterminate: false },
      { style: 'square', checked: false, indeterminate: true },
      { style: 'switch', checked: false, indeterminate: false },
      { style: 'switch', checked: true, indeterminate: true },
    ] satisfies { style: IosStyle; checked: boolean; indeterminate: boolean }[];
    await render(
      <View style={rowStyle}>
        {fixtures.map((fixture, index) => (
          <Checkbox
            key={`glyph-${String(index)}`}
            label={`Glyph ${String(index)}`}
            iosStyle={fixture.style}
            checked={fixture.checked}
            indeterminate={fixture.indeterminate}
            testID={`glyph-${String(index)}`}
            hybridRef={captureHybrid(`glyph-${String(index)}`)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const drawn: string[] = [];
    for (const [index, fixture] of fixtures.entries()) {
      const testId = `glyph-${String(index)}`;
      await waitForTestId(testId);
      const wanted = fixture.checked
        ? '1'
        : fixture.indeterminate
          ? 'mixed'
          : '0';
      await waitForDisplayed(testId, wanted);
      drawn.push(
        `${fixture.style}/${fixture.checked ? 'on' : 'off'}/` +
          `${fixture.indeterminate ? 'ind' : '-'}=${reportOf(testId).displayed}` +
          `/symbol=${reportOf(testId).symbol ?? 'none'}`
      );
      if (Platform.OS === 'ios') {
        await waitForSymbol(
          testId,
          expectedSymbol(fixture.style, fixture.checked, fixture.indeterminate)
        );
      } else {
        // Android publishes no `symbol` field.
        expect(reportOf(testId).symbol).toBeUndefined();
      }
    }
    console.log(`checkbox glyphs: ${drawn.join(' ')}`);
    if (Platform.OS === 'ios') {
      expect(reportOf('glyph-0').symbol).toBe('circle');
      expect(reportOf('glyph-1').symbol).toBe('checkmark.circle.fill');
      expect(reportOf('glyph-2').symbol).toBe('minus.circle.fill');
      expect(reportOf('glyph-6').symbol).toBe('minus.square.fill');
      expect(reportOf('glyph-8').symbol).toBe('switch');
      expect(reportOf('glyph-0').symbol).not.toBe(reportOf('glyph-1').symbol);
    }
  });

  it('re-measures for a new style on iOS, and never on Android', async () => {
    // A style change is a configuration change on iOS: the box moves to the new
    // control's from a poisoned start. Android ignores the prop, so the key
    // does not change and no correction is owed.
    poison([
      sizingKey(false, 'Remeasured', 'circle'),
      sizingKey(false, 'Remeasured', 'switch'),
    ]);
    const { rerender } = await render(
      <Checkbox
        label="Remeasured"
        iosStyle="circle"
        checked
        testID="style-change"
        hybridRef={captureHybrid('style-change')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('style-change');
    const circle = await waitForMeasured('style-change', 'the circle style');
    await waitForBox('style-change', circle, 'the circle style');
    if (Platform.OS === 'ios') {
      await waitForSymbol('style-change', 'checkmark.circle.fill');
    }
    const before = stats();
    await rerender(
      <Checkbox
        label="Remeasured"
        iosStyle="switch"
        checked
        testID="style-change"
        hybridRef={captureHybrid('style-change')}
      />
    );
    const handle = await handleOf('style-change');
    // The prop has to have arrived before "nothing else happened" means anything.
    await pollUntil(
      () => (handle.iosStyle === 'switch' ? true : null),
      () =>
        new Error(
          `"style-change" never took the style it was given - it still answers ` +
            `iosStyle=${handle.iosStyle}.`
        )
    );
    if (Platform.OS === 'ios') {
      // The counters are read once the box has moved: the correction is what
      // moves it.
      const toggled = await waitForRemeasure(
        'style-change',
        circle,
        'the switch style'
      );
      await waitForBox('style-change', toggled, 'the switch style');
      await waitForSymbol('style-change', 'switch');
      const made = corrections(before, stats());
      console.log(
        `checkbox style change: circle=${describeSize(circle)} ` +
          `switch=${describeSize(toggled)} corrections=${made}`
      );
      expect(made).toBeGreaterThanOrEqual(1);
    } else {
      // Give any correction the engine might still owe a turn to arrive, then read the
      // box and the counters: it may not have moved, and nothing may have been corrected.
      await sleep(500);
      const made = corrections(before, stats());
      const after = measured('style-change');
      console.log(
        `checkbox style change (ignored): circle=${describeSize(circle)} ` +
          `after=${describeSize(after)} corrections=${made}`
      );
      expect(sameSize(after, circle)).toBe(true);
      expect(made).toBe(0);
    }
  });

  it('recycles into the next owner with its own picture', async () => {
    // `recycles` is the host object's lifetime count, which the reset does not
    // clear: a round that reads `recycles>=1` is a view the pool popped.
    // `probes` is per mount and the reset clears it, so one probe per round has
    // to read 1. The swap is by `key` inside one parent, and the styles
    // alternate so each round's expected glyph names the round.
    const owner = (key: 'a' | 'b') => (
      <Checkbox
        key={key}
        label={`Round ${key}`}
        iosStyle={key === 'a' ? 'square' : 'circle'}
        defaultChecked
        testID="recycled"
        hybridRef={captureHybrid('recycled')}
      />
    );
    const fieldOf = (name: string): number =>
      Number(reportOf('recycled')[name] ?? Number.NaN);
    const { rerender, unmount } = await render(owner('a'), { timeout: 25000 });
    await waitForTestId('recycled', 10000);
    // Every round's counters go in the thrown message: `console.log` from a
    // device run goes nowhere.
    const rounds: string[] = [];
    let maxRecycles = 0;
    try {
      for (const key of ['a', 'b', 'a', 'b'] as const) {
        await rerender(owner(key));
        // A settle for the drop, the pool entry and the next mount's own commit.
        await sleep(400);
        const handle = await handleOf('recycled');
        await waitForDisplayed('recycled', '1');
        const expected = expectedSymbol(
          key === 'a' ? 'square' : 'circle',
          true,
          false
        );
        if (Platform.OS === 'ios') {
          await waitForSymbol('recycled', expected);
        }
        if (
          handle.label !== `Round ${key}` ||
          handle.iosStyle !== (key === 'a' ? 'square' : 'circle')
        ) {
          throw new Error(
            `a recycled Checkbox describes someone else: label=${String(
              handle.label
            )} iosStyle=${handle.iosStyle} report=${handle.nuiTestStateReport()}`
          );
        }
        // Read before the probe: `nuiTestStateReport()` is a live read of the
        // host object, so `probes >= 1` could be the previous owner's count.
        const probesBeforeProbe = fieldOf('probes');
        if (probesBeforeProbe !== 0) {
          throw new Error(
            `round ${key}: "recycled" arrived with probes=${String(
              probesBeforeProbe
            )} - a recycled Checkbox kept the last owner's probe count, so every count ` +
              `after this one is somebody else's: "${handle.nuiTestStateReport()}"`
          );
        }
        handle.nuiTestProbeAccessibility();
        await pollUntil(
          () => (fieldOf('probes') >= 1 ? true : null),
          () =>
            new Error(
              `round ${key}: "recycled" never answered a probe - ` +
                `"${handle.nuiTestStateReport()}"`
            )
        );
        const probes = fieldOf('probes');
        const recycles = fieldOf('recycles');
        const drops = fieldOf('drops');
        rounds.push(
          `key=${key} recycles=${String(recycles)} drops=${String(drops)} ` +
            `probes=${String(probes)}`
        );
        maxRecycles = Number.isFinite(recycles)
          ? Math.max(maxRecycles, recycles)
          : maxRecycles;
        console.log(
          `checkbox recycle: round=${key} drawn=${
            reportOf('recycled').displayed
          } symbol=${reportOf('recycled').symbol ?? '-'} label=${String(
            handle.label
          )} ${rounds[rounds.length - 1]}`
        );
        expect(probes).toBe(1);
      }
      // With no round handed back a recycled view, every `probes=1` above is a
      // fresh instance and the reset is untested.
      if (maxRecycles < 1) {
        throw new Error(
          `no round of the recycle case was a recycled view - highest recycles on a ` +
            `mounted Checkbox was ${String(maxRecycles)} over ${String(
              rounds.length
            )} rounds [${rounds.join(' | ')}], so this case asserted a reset it never ` +
            `ran: the pool handed no view back`
        );
      }
    } finally {
      unmount();
    }
  });
});
