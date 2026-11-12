/**
 * On-device tests for the Checkbox (task G15).
 *
 * A Checkbox is Switch's value and Chip's label, so this suite asks those two
 * siblings' questions and one of its own:
 *
 * - **Switch's**: does the event-count handshake hold - a controlled `checked` both
 *   ways, a toggle JS refused reverting, a value written from JS applying?
 * - **Chip's**: is the box the size the control measured, for every configuration the
 *   sizing key names? The label is content here (a bare box and a labelled one are
 *   different controls of different widths), so the cold configurations are poisoned
 *   first (`seedSizingSize` with a size no checkbox has) and a correction is required
 *   (`Button.harness.tsx`/`Chip.harness.tsx` explain why: a declared fallback close to
 *   the truth makes every "the box was right" assertion pass for free).
 * - **its own**: is it *announced* as a checkbox? On Android that is one merged node
 *   with `Role.Checkbox` and its toggleable state, which the control's own probe reads
 *   (`nuiTestProbeAccessibility`); on iOS there is nothing to read in-process and
 *   `real-input:ios`'s XCUITest asserts the role instead, as Chip's does.
 *
 * Indeterminate is the third state. It is a display, not a value: the case below asserts
 * what is drawn (`mixed`) *and* that a tap still reports `true`, so the two platforms
 * cannot drift into disagreeing about what the prop means.
 *
 * G31's cases (task G31, DECISIONS D47) are about the *picture*: `iosStyle` picks which
 * glyph iOS draws, so the suite asks which symbol the drawing code was handed
 * (`nuiTestStateReport`'s `symbol=` field, because a SwiftUI hosting view answers
 * `accessibilityElements == []` to an in-process probe and there is no pixel to read),
 * what each style's box is from a poisoned fallback, what a style change costs in
 * corrections, and - the Android half, which is the half that must not move - that the
 * prop is stored, ignored, and kept out of Android's sizing key.
 *
 * The readings: `harnessUi.queryByTestId` (the box Fabric gave the view),
 * `hybridRef.measureContent()` (the size the hosted control measured),
 * `nitroUiCore.sizingStats()` (what the engine did) and the checkbox's own
 * `nuiTestStateReport()` (what the control is drawing, and on Android what its
 * accessibility node says).
 */
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

/** What `hybridRef` hands back - declared, not imported (DECISIONS D14). */
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
 * The engine's correction counters, read once they have stopped moving.
 *
 * The counters are process-wide: they add up every configuration the engine corrects,
 * including the ones a case that already finished is still landing. Two cases here read
 * them as *this* render's number, and a straggler from the case before arrives as an
 * extra correction - the engine counts one per *instance* laid out at a wrong size, so a
 * case that mounts four boxes owes four, and the styles case below used to read the third
 * state case's four late ones as its own. Two consecutive equal reads, because "settled"
 * only means something against a number that is not on its way somewhere else: the same
 * rule `Conformance.harness.tsx`'s `settledStats` applies to the ledger.
 *
 * Throws rather than returning a contested read - a window that never settles is not a
 * baseline, and a bound checked against one is green for the wrong reason.
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

/** Poll until the control reports a size. */
async function waitForMeasured(testId: string, what: string): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

/** Poll until the control reports a size that is not `previous`. */
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

/** Poll until the box of `testId` is `size`. */
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

/** The checkbox's own report, as `key -> value`. */
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
 * Poll until the labelled checkbox reports its centring, as `{ off, room }` in dp.
 *
 * `off` is the label's middle measured against the row's middle, `room` how much taller
 * the row is than the text. Both come from the label's own layout pass, so they arrive a
 * frame after the mount: until then the field reads `none` and there is nothing to read.
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

/** Poll until the checkbox is drawing `displayed` (`1`, `0`, `mixed` or `none`). */
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
 * Poll until the control reports the picture `symbol` (`circle`,
 * `checkmark.circle.fill`, `minus.square.fill`, `switch`, ...).
 *
 * This is how an iOS Checkbox's *drawing* is read: the hosting view answers
 * `accessibilityElements == []` to anything that is not an accessibility client, so the
 * element itself is `real-input`'s to assert, and the field is written in the SwiftUI
 * body - the name the drawing code was handed, not an echo of the prop. On Android the
 * field does not exist, which the cases below assert rather than skip.
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

/** Wait until the app has been told exactly `wanted` since `from`. */
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
  // Then a quiet period, and everything that arrived: Chip's G12 red proof - a
  // handler called twice per press passed a count-only wait, because the surplus
  // event arrived after the count was reached. A caller compares the whole list.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/**
 * Toggle a checkbox the way this platform's harness can.
 *
 * Android: a harness tap, which Compose takes like any touch. iOS: the checkbox's own
 * `nuiTestToggle()`, which runs the tap's path (the Toggle's binding). The harness's
 * iOS tap is a `UITouch` with no HID event behind it and SwiftUI's gesture refuses it
 * (`Button.harness.tsx` measured that for `Button`, and Chip's G12 run for
 * `Toggle(.button)`); a `.switch` Toggle is the same kind of gesture recognizer. The
 * real tap on iOS is `real-input:ios`'s, which is where SwiftUI's own gesture is
 * proved.
 */
async function toggleCheckbox(testId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await userEvent.press(await waitForTestId(testId));
    return;
  }
  (await handleOf(testId)).nuiTestToggle();
}

/** Wait for the checkbox's next accessibility probe, and return its `a11y` field. */
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

/** The iOS pictures `iosStyle` names (DECISIONS D47), in declaration order. */
const STYLES = ['circle', 'square', 'switch'] as const;
type IosStyle = (typeof STYLES)[number];

/**
 * The key `Checkbox.tsx` builds: `indeterminate|label` on Android and
 * `0|iosStyle|label` on iOS. The third state is a field only on Android, where it answers
 * `TriStateCheckbox`; on iOS the dash is painted inside the same symbol box, so the field
 * answers `0` for every style - the answer `checked` gets - and a warm row that grows a
 * dash costs no configuration (the case at "costs nothing to flip..." measures that, and
 * the Android half of this helper is why the same flip *is* a configuration there).
 * Written out rather than imported, so a wrong helper cannot poison and pass its own test
 * (Chip's rule) - and here it is the whole Android half of G31: a helper that put the
 * style in Android's key would poison three keys, the engine would answer three cold
 * configurations, and every Android assertion below would still read green.
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

/** The symbol the iOS drawing code should be handed for one state of one style. */
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
    // above came from the planted size and proved nothing.
    expect(made).toBeGreaterThanOrEqual(2);
    // The label is the whole width difference: a bare box is a box, and a labelled
    // one is a box plus its text. If these ever measure the same, the label is not
    // in the layout on this platform and the sizing key is a lie.
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
    // Two checkboxes of one label, one checked from its first frame: their
    // measurements are the two states' sizes, each taken by a control that never
    // changed state. Neither platform's box moves - which is why `checked` is in
    // neither platform's sizing key (`Checkbox.tsx`). If this goes red, that key is
    // wrong and a first toggle is a cold configuration with a frame at the fallback.
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
        {/* The third state joined the pair in G31: on iOS the dash is a *symbol* now
            (`minus.circle.fill`), and the claim that keeps `checked` and `indeterminate`
            out of the sizing key is that the empty box, the check mark and the dash are
            one symbol box. Two of the three was the old claim; three is the new one. */}
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
    // Native showed `true` optimistically; the batch that echoed the event count
    // carried `checked={false}` again, so it has to be drawn unchecked.
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
    // An uncontrolled box that was showing `true` asks for `false` - until it is
    // asked again: this platform's box is a two-state control whose native owner
    // reports what it shows, and a tap on a checked box reports unchecked.
    const first = await waitForEvents(0, ['free:false']);
    expect(first).toEqual(['free:false']);
    await waitForDisplayed('free', '0');
  });

  it('draws the third state on both platforms, and off in the switch style', async () => {
    // The third state is a display, not a value, on both platforms: Material 3's
    // `TriStateCheckbox` has a dash and, since DECISIONS D47 item 3, so do the iOS glyph
    // styles (`minus.circle.fill` / `minus.square.fill`). `'switch'` is the one control
    // here with two positions, so the third fixture - the same props in the switch style -
    // is where G15's "iOS reads this as off" now lives: still true, about one style
    // instead of a whole platform.
    //
    // `checked` outranks `indeterminate`, which is Android's rule (`TriStateCheckbox` shows
    // the dash only while the value is off) and is asserted here as `displayed` on both
    // platforms, so the two cannot disagree about what the props mean even though one of
    // them has a new picture. And a tap reports `true` from the dash everywhere, so an
    // app's `onCheckedChange` never sees a third value.
    // Both keys are poisoned: the dash's and the same label's plain unchecked one. On
    // Android those are two keys (`TriStateCheckbox` is a configuration of its own); on
    // iOS `sizingKey` answers the same string for both, because the dash is painted
    // inside the box the row already had - so on iOS this plants one key that two mounted
    // instances read, and the corrections below are the two boxes coming off it.
    // Comparing two boxes that were never corrected would only prove the fallback is
    // one number - the equality below is about what the control measured.
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
          The same label with the third state *off*, so "the dash costs nothing" is a
          comparison and not a sentence: one label, two states, two cold keys. G15
          pinned the same fact for `checked` in the sizing case; this is its twin for
          `indeterminate`, on both platforms, and the reason the dash can share a box
          with the state that replaced it.
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
      // The dash is drawn, named, and - with `checked` also set - not drawn.
      await waitForSymbol('mixed', 'minus.circle.fill');
      await waitForSymbol('mixed-on', 'checkmark.circle.fill');
      // The switch has two positions: the prop arrives, and the answer stays `0`.
      await waitForDisplayed('mixed-switch', '0');
      await waitForSymbol('mixed-switch', 'switch');
    } else {
      await waitForLabelBox('mixed', 'the third state');
    }
    // Two instances of the dash's configuration and the plain box's, both planted at a
    // size no checkbox is: the engine has to walk both off it, or the equality below is a
    // comparison between two failures to measure. Note what this does *not* claim: on iOS
    // it is two instances of one configuration, not two configurations - which is the
    // whole point of `sizingKey` answering `0|circle|Select all` for both. How much the
    // flip costs a row that is already on screen is the next case's question.
    expect(made).toBeGreaterThanOrEqual(2);
    // And neither box is the planted one, or the comparison below is a comparison
    // between two failures to measure.
    expect(sameSize(size, WRONG_SIZE)).toBe(false);
    expect(sameSize(plainSize, WRONG_SIZE)).toBe(false);
    // The dash replaces the mark inside the same box: one label, two states, one size.
    // If this ever differs, the box moved with the glyph and the sizing table in
    // `docs/components/checkbox.md` has a row missing.
    expect(sameSize(size, plainSize)).toBe(true);
    await toggleCheckbox('mixed');
    expect(await waitForEvents(0, ['mixed:true'])).toEqual(['mixed:true']);
    await waitForDisplayed('mixed', '1');
    if (Platform.OS === 'ios') {
      // And the press that resolves the dash draws the check mark it asked for, in the
      // same box - which is what keeps `checked` out of the sizing key honest.
      await waitForSymbol('mixed', 'checkmark.circle.fill');
    }
    // The same counter read once it has stopped moving. That is not a second assertion -
    // `total >= made` could not fail, since a counter only grows - it is the number this
    // case prints, and reading the shared counter settled is what stops these corrections
    // from landing inside the next case's window (the Android failure this replaced read
    // exactly that: four late corrections of this case, arriving as the styles case's own
    // count).
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
    // D47 item 3 gave iOS a dash to draw, and a drawing is not a size:
    // `minus.circle.fill`, `checkmark.circle.fill` and `circle` are one SF Symbol box, so
    // `indeterminate` stays out of the iOS key, where Android's `TriStateCheckbox` does
    // earn a place. That decision is only worth anything on a row the app has already
    // drawn, which is where a keyed field costs real frames: the row becomes a cold
    // configuration, goes back through the fallback for a frame, and pays a correction to
    // come off it. Measured here, both ways round.
    //
    // Both keys are poisoned - the dash's included, which iOS never asks about. That is
    // what makes the iOS bound below a red proof and not a warm cache: put
    // `indeterminate` back into `sizingVariantFor`'s iOS field and the flip asks the
    // engine for a configuration whose size it was told is wrong, so the row relayouts at
    // 11.5 x 57.5 and `made` stops being 0.
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
    // The poison has to have been escaped first, or "nothing was corrected below" is a
    // sentence about a row that never measured at all.
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
      // The picture really did change, so the zero below is about a row that repainted and
      // not about a rerender that did nothing at all.
      await waitForSymbol('warm', 'minus.circle.fill');
    }
    await waitForDisplayed('warm', 'mixed');
    // Settled first, so a correction on its way is inside the count and the box read below
    // is the answer the engine ended on.
    const made = corrections(before, await settledCorrections('the warm flip'));
    const after = measured('warm');
    console.log(
      `checkbox warm indeterminate: plain=${describeSize(plain)} ` +
        `flipped=${describeSize(after)} corrections=${made}`
    );
    // One box for the two pictures on both platforms - the third state never moved a box,
    // which is the fact the key is built out of.
    expect(sameSize(after, plain)).toBe(true);
    if (Platform.OS === 'ios') {
      // Zero: a row already on screen at its own size owes the engine nothing.
      expect(made).toBe(0);
    } else {
      // Android's field is the one that earns its place: the flip is
      // `TriStateCheckbox`, a configuration of its own, and the planted size under its key
      // has to be corrected. A run answering 0 here would be a flip that never asked the
      // engine anything - which is what iOS does, and why the branches differ.
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
      // The barrier is enabled and untouched here, so this reads the empty glyph,
      // *before* anything is pressed on it. Below it is checked, and the read there
      // proves the enabled box moved into the picture of the state its press asked for.
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
      // A disabled checkbox is a dimmed picture and not a missing one: the row is still
      // the glyph with `.opacity` over it (`CheckboxGlyphToggleStyle`), so the state a
      // reader cannot change is still the state they can see. A style that answered
      // `circle` here would be drawing the *enabled* box of a disabled control.
      await waitForSymbol('disabled', 'checkmark.circle.fill');
      // The barrier is checked by now - that was its job in this case - so the enabled
      // box answers with the check mark its own press asked for. Measured, not reasoned
      // out: the first device run read `checkmark.circle.fill` here while the case still
      // asked for `circle`, the empty box it had already left.
      await waitForSymbol('barrier', 'checkmark.circle.fill');
    }
  });

  it('is one node with the label as its name when a label is shown', async () => {
    // The a11y half of the design (Q5): TalkBack has to be handed a checkbox with a
    // name, not a nameless box and a separate piece of text. Android reads its own
    // merged semantics node; iOS has nothing to read in-process (`unavailable`, the
    // Chip/Slider measurement) and XCUITest asserts the role in `real-input:ios`.
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
      // One focusable node for a labelled checkbox: the merged node is what
      // `Content.harness.tsx`'s rule and TalkBack both need. `merged` counts the
      // nodes that publish a toggle, so a control that hands a reader two says so.
      expect(merged).toBe('1');
    } else {
      for (const report of [off, on, bare, disabled]) {
        expect(report).toBe('unavailable');
      }
    }
  });

  it('centres its label against the box', async () => {
    // The row is 48 dp tall because the box asks for a 48 dp touch target, and the text
    // is far shorter than that, so something has to decide where the label sits inside
    // the extra height. A `Row` that defaults to top alignment draws the text along the
    // top of a row that still measures 48 dp, which is why no size assertion in this
    // suite ever saw it: the box, the row and the screenshot all agree, and the label is
    // the one thing that disagrees. Measured in the control, from the label's own layout
    // coordinates against its parent's (`CheckboxModel.recordLabelBox`).
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
      // Both numbers or neither. An offset on its own cannot tell a real mis-centring
      // from a fixture that left nothing to mis-centre - text as tall as its row is
      // centred by every alignment there is - so the room the row leaves around the text
      // is checked before the offset is believed, and 8 dp of slack is a sixth of a
      // 48 dp row. The offset itself gets a rounding step of the middle.
      if (room < 8 || Math.abs(off) > 1) {
        throw new Error(
          `"centred" draws its label ${String(off)}dp from the middle of a row that ` +
            `leaves ${String(room)}dp around the text`
        );
      }
    } else {
      // Nothing to read on iOS, and that is the honest answer rather than a skip: the
      // platform's `Toggle` lays out its own label, so there is no row of ours to align
      // wrongly. Asserted absent so the day this control grows a `labelBox`, this case
      // has to grow the claim instead of quietly measuring nothing.
      expect(reportOf('centred').labelBox).toBeUndefined();
    }
  });

  it('lays out every iOS style at the box that style measures', async () => {
    // DECISIONS D47's three pictures are three boxes: the switch's 61x28 pt and a glyph
    // row each. The style is in the iOS sizing key because of that, so all three are cold
    // configurations here and the poisoned cache has to see all three corrected - read
    // without the poison, "each box is the size the control measured" is a sentence about
    // a size the test planted.
    //
    // Android is the other half of this case and the half that must not move: the prop is
    // stored and ignored (`HybridNitroUiCheckbox.kt`), so it is out of Android's key and
    // three style names of one label are *one* configuration - which is what the three
    // boxes have to say, one box whichever name was sent. The correction count is not
    // where that claim lives; the Android branch below says why.
    // Take the baseline once the counter has stopped moving: it is a process-wide one,
    // and the iOS bound below is only about what *this* render corrects. Whatever an
    // earlier case still has in flight lands in the settle instead of inside this window.
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
        // Every style drew the picture it was named, at the size it measured: the box and
        // the glyph are read from the same instance, so a style that laid out one control
        // and drew another cannot pass.
        await waitForSymbol(testId, expectedSymbol(style, true, false));
      }
    }
    // The bare default box: the configuration `HybridNitroUiCheckbox.swift`'s
    // `declaresFallback` names, because a fallback is a guess about what an app draws
    // first, and the first thing an app draws is a checkbox with no label in the default
    // style. Deliberately *not* poisoned: what is claimed about this box is which control
    // it belongs to, and a size the engine read from this Toggle does not need a wrong
    // guess to be true - the poison above is for the boxes whose claim is "this is the
    // correction's answer, not the fallback's".
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
      // Three poisoned configurations, three corrections...
      expect(made).toBeGreaterThanOrEqual(STYLES.length);
      // ...and the glyph row is not the switch's box, which is the claim the declared
      // fallback and the iOS key are both built on. Over one labelled string, so the
      // label cannot be what tells them apart.
      // The bare default box is not the Switch's box either - the number this component
      // declared as its fallback until D47 made the glyph the default. That is the claim
      // `declaresFallback` and `scripts/conformance-core.mjs` now have to agree on.
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
      // One box for all three names: Material 3's checkbox, whichever picture iOS was
      // asked for. No correction count is read here, for two measured reasons. It counts
      // *instances* laid out at a wrong size - `applyReports` corrects every instance
      // sharing a key, one increment each - so four mounted boxes cost four corrections
      // whether the key carries the style or not (4 on Android from one configuration,
      // and the same 4 on iOS from four). And the count is not a probe for the key
      // either: with `iosStyle` pushed into Android's key, the case below that rerenders
      // one style into another still costs 0 there, because the view is already on screen
      // at the size the new key would answer with and a confirmation is not a correction.
      // A key is pinned by comparing strings, which is
      // `src/__tests__/checkbox.test.tsx`; what this case owes Android is the picture.
      expect(sameSize(boxOf('square'), boxOf('circle'))).toBe(true);
      expect(sameSize(boxOf('switch'), boxOf('circle'))).toBe(true);
    }
  });

  it('draws the glyph its state names, and keeps one state per platform', async () => {
    // The picture, named. `symbol=` is what the iOS drawing code was handed, written in
    // the SwiftUI body, so the three states of a style answer three different names and
    // "checked and unchecked look different" is a comparison rather than a claim (the
    // alternative this suite has - a pixel probe - would have to guess the colour before
    // it knew what was on screen, and `real-input`'s screenshot is not a test).
    //
    // `displayed=` is asserted for every fixture on *both* platforms, which is the half
    // that keeps the new picture from drifting: the same props answer the same state on
    // Android and iOS, including the one that surprises - a box that is `indeterminate`
    // *and* checked is checked (`displayed=1`), because `checked` outranks the display on
    // both platforms.
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
        // Android has no symbol of ours to name - the field is absent, as iOS has never
        // answered Android's `labelBox`. Asserted rather than skipped: a Material box that
        // started publishing symbol names would be a second implementation.
        expect(reportOf(testId).symbol).toBeUndefined();
      }
    }
    console.log(`checkbox glyphs: ${drawn.join(' ')}`);
    if (Platform.OS === 'ios') {
      // Named out loud because the whole point of D47 is that three of these nine rows no
      // longer look like a switch.
      expect(reportOf('glyph-0').symbol).toBe('circle');
      expect(reportOf('glyph-1').symbol).toBe('checkmark.circle.fill');
      expect(reportOf('glyph-2').symbol).toBe('minus.circle.fill');
      expect(reportOf('glyph-6').symbol).toBe('minus.square.fill');
      expect(reportOf('glyph-8').symbol).toBe('switch');
      // A style that drew the same picture for checked and unchecked would satisfy every
      // size assertion in this file, which is why the pair is compared here.
      expect(reportOf('glyph-0').symbol).not.toBe(reportOf('glyph-1').symbol);
    }
  });

  it('re-measures for a new style on iOS, and never on Android', async () => {
    // A style change is a *configuration* change, and D17's rule is about the frame after
    // it: the box has to move to the new control's, from a poisoned start, with a
    // correction that is not swallowed by the engine's dedupe (`noteSizingKeyChanged`,
    // whose absence is review F1's stuck fallback).
    //
    // Android answers the same rerender with nothing: the prop is stored and ignored, the
    // key does not change, and so no new configuration is asked about and no correction is
    // owed. Zero is the assertion - three style names of one label that cost a correction
    // on Android would be the key carrying a field that changes nothing.
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
      // The counters are read once the box has actually moved: `made` is this rerender's
      // correction and the correction is what moves the box, so a count taken while the
      // engine is still on its way reports the window that has not happened yet.
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
    // RN's pool hands a dropped Checkbox to the next mount (`Recycling.harness.tsx` proves
    // the pool is real on both platforms), and `prepareForRecycle` is the reset that
    // instance has to arrive with: the style, the handshake, the reports, and the
    // `defaultChecked` seed it has not yet applied.
    //
    // The two residue failures a device can actually see are asserted: an instance that
    // kept its previous owner's *report* answers a square glyph for a circle owner, and an
    // instance whose `didApplyDefault` survived never applies the new owner's
    // `defaultChecked` - it draws an empty box while its own prop says checked, which no
    // assertion about props would catch because the prop is indeed `true`.
    //
    // What the first version of this case could not do is go red. Every round's owner
    // re-sends `iosStyle`, `label` and `defaultChecked`, so the new owner repaints and
    // re-seeds whatever it likes, and a read of `symbol`/`displayed` after the swap is a
    // reading of the new owner either way. Two counters close that hole, and they are the
    // pair the Switch's identity test reads for the same reason:
    //
    // - `recycles` is the host object's lifetime, which the reset deliberately does not
    //   clear. A round whose report answers `recycles>=1` is a view the pool popped, so
    //   the bound at the end is what says this case tested a reset at all;
    // - `probes` is the per-mount one, which the reset *does* clear. One probe per round
    //   therefore has to read 1; a recycled instance that had kept the last owner's report
    //   answers 2, and that is the assertion `clearReports()` exists to satisfy.
    //
    // The swap is by `key` inside one parent (drop one instance, ask for another, stay on
    // the surface whose pool this is - see `Recycling.harness.tsx`), and the styles
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
    /** One numeric field of the box's own report. */
    const fieldOf = (name: string): number =>
      Number(reportOf('recycled')[name] ?? Number.NaN);
    const { rerender, unmount } = await render(owner('a'), { timeout: 25000 });
    await waitForTestId('recycled', 10000);
    // Every round's counters, for the message below: a device run carries a thrown Error
    // out of the process, where `console.log` goes nowhere (Conformance's lesson).
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
        // Its own props, from this round: a recycled view that had come back as a corpse
        // would answer the previous owner's label here.
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
        // One probe for this mount, read once it has answered, and then the bound: this
        // mount's own report, not the last owner's.
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
      // The witness before the claim: with no round handed back a view that had been
      // through a mount, every `probes=1` above would be a fresh instance answering
      // trivially, and the reset would be untested. Thrown, with the whole series.
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
