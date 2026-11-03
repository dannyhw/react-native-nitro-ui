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
 * Indeterminate is the Android third state. It is a display, not a value: the case
 * below asserts what is drawn (`mixed`) *and* that a tap still reports `true`, so the
 * two platforms cannot drift into disagreeing about what the prop means.
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

/**
 * The key `Checkbox.tsx` builds: `indeterminate|label`, with the third state only
 * where it changes what is drawn (Android). Written out rather than imported, so a
 * wrong helper cannot poison and pass its own test (Chip's rule).
 */
function sizingKey(indeterminate: boolean, label: string): string {
  const field = Platform.OS === 'android' && indeterminate ? '1' : '0';
  return `${field}|${label}`;
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
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('off');
    await waitForTestId('on');
    const off = await waitForMeasured('off', 'unchecked');
    const on = await waitForMeasured('on', 'checked');
    await waitForBox('off', off, 'unchecked');
    await waitForBox('on', on, 'checked');
    await waitForDisplayed('on', '1');
    await waitForDisplayed('off', '0');
    console.log(
      `checkbox states: off=${describeSize(off)} on=${describeSize(on)}`
    );
    expect(sameSize(on, off)).toBe(true);
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

  it('draws the third state on Android, and off on iOS', async () => {
    // The platform difference the brief settles (Q5, D29's style): Material 3's
    // `TriStateCheckbox` has a dash, SwiftUI's switch has two positions. Both
    // platforms take the prop - only one can draw it - and a tap reports `true` on
    // both, so an app's `onCheckedChange` never sees a third value.
    poison([sizingKey(true, 'Select all')]);
    const before = stats();
    await render(
      <Checkbox
        label="Select all"
        indeterminate
        onCheckedChange={recordChecked('mixed')}
        testID="mixed"
        hybridRef={captureHybrid('mixed')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('mixed');
    const size = await waitForMeasured('mixed', 'the third state');
    await waitForBox('mixed', size, 'the third state');
    const made = corrections(before, stats());
    if (Platform.OS === 'android') {
      await waitForDisplayed('mixed', 'mixed');
      // The third state is its own configuration on Android because it is its own
      // composable; poisoned, it has to be corrected or the box above is the
      // planted size.
      expect(made).toBeGreaterThanOrEqual(1);
    } else {
      // iOS answers `0`: the switch is off, which is what "reads as off" means at
      // the seam a test can read. It never answers `mixed`, so the day SwiftUI
      // gains a checkbox and this library draws one, this line goes red.
      await waitForDisplayed('mixed', '0');
    }
    await toggleCheckbox('mixed');
    expect(await waitForEvents(0, ['mixed:true'])).toEqual(['mixed:true']);
    await waitForDisplayed('mixed', '1');
    console.log(
      `checkbox indeterminate: drawn=${reportOf('mixed').displayed} ` +
        `size=${describeSize(size)} corrections=${made}`
    );
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
    await toggleCheckbox('disabled');
    await toggleCheckbox('disabled');
    await toggleCheckbox('barrier');
    expect(await waitForEvents(0, ['barrier:true'])).toEqual(['barrier:true']);
    await sleep(200);
    expect(events).toEqual(['barrier:true']);
    await waitForDisplayed('disabled', '1');
    expect(handles.get('disabled')?.disabled).toBe(true);
    expect(handles.get('disabled')?.mostRecentEventCount).toBe(0);
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
});
