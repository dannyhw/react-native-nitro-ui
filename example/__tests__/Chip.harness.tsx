/**
 * On-device tests for the Chip (task G12).
 *
 * A Chip is a sibling of two controls, and this suite asks each sibling's questions:
 *
 * - **Button's**: is the box the size the control measured, for every configuration
 *   the sizing key names? The cold configurations are poisoned first (`seedSizingSize`
 *   with a size no chip has), so a correction that never arrives leaves a visible
 *   wrong box and costs a correction the test requires (`Button.harness.tsx` explains
 *   the precedent).
 * - **Switch's**: does the event-count handshake hold - a controlled selection both
 *   ways, a toggle JS refused reverting, a value written from JS applying?
 *
 * And one question of its own. On Android a filter chip's *user* toggle changes its
 * size (Material 3's selected filter chip gains a leading check), which is the moment
 * the sizing key is out of date: native has painted the selection, React has not
 * re-keyed it yet. A size measured in between and filed under the old key would make
 * every later unselected chip of that label the selected one's width - Picker's G6
 * review M1. "re-keys a toggle" below is the test that sees that, by counting the
 * corrections a *fresh* unselected chip needs: zero, if the cache still holds the
 * unselected size.
 *
 * The readings: `harnessUi.queryByTestId` (the box Fabric gave the view),
 * `hybridRef.measureContent()` (the size the hosted control measured),
 * `nitroUiCore.sizingStats()` (what the engine did) and the chip's own
 * `nuiTestStateReport()` (what the control is drawing, and on Android what its
 * accessibility node says).
 */
import { useCallback, useRef, useState } from 'react';
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
  Chip,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

import { waitForHandle } from './handles';

/** The Chip's Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiChip';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back - declared, not imported (DECISIONS D14). */
type ChipHandle = {
  readonly label: string;
  readonly variant: string;
  readonly selected: boolean | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  measureContent(): { width: number; height: number };
  nuiTestPress(): void;
  nuiTestProbeAccessibility(): void;
  nuiTestStateReport(): string;
};

const handles = new Map<string, ChipHandle>();
const captureHybrid =
  (testId: string) =>
  (view: ChipHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app was told, in order, as `testID:value`. */
const events: string[] = [];
const recordSelected =
  (testId: string) =>
  (selected: boolean): void => {
    events.push(`${testId}:${String(selected)}`);
  };
const recordPress = (testId: string) => (): void => {
  events.push(`${testId}:press`);
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

async function handleOf(testId: string): Promise<ChipHandle> {
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

/** The chip's own report, as `key -> value`. */
function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/** Poll until the chip is drawing `displayed` (`1`, `0` or `none`). */
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
  // Then a quiet period, and everything that arrived: returning the moment the count is
  // reached let an extra event through on iOS (G12's red proof - an `onPress` called twice
  // per press passed there, because the first press's second call made the count before
  // the second press had landed). A caller compares the whole list, so a surplus is red.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/**
 * Press a chip the way this platform's harness can.
 *
 * Android: a harness tap, which Compose takes like any touch. iOS: the chip's own
 * `nuiTestPress()`, which runs the tap's path (the Toggle's binding, or the Button's
 * action). The harness's iOS tap is a `UITouch` with no HID event behind it and
 * SwiftUI's button gesture refuses it - `Button.harness.tsx` measured that for
 * `Button`, and `Toggle(.button)` is a button: measured again here in G12, the
 * harness tap reached neither variant (the report's red-proof section). The real
 * tap on iOS is `real-input:ios`'s, which is where SwiftUI's own gesture is proved.
 */
async function pressChip(testId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await userEvent.press(await waitForTestId(testId));
    return;
  }
  (await handleOf(testId)).nuiTestPress();
}

/** Wait for the chip's next accessibility probe, and return its `a11y` field. */
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
 * The key `Chip.tsx` builds: `variant|selected|systemImage|label`, with the
 * selection only where it moves the size (an Android filter chip). Written out
 * rather than imported, so a wrong helper cannot poison and pass its own test.
 */
function sizingKey(variant: string, selected: boolean, label: string): string {
  const field =
    variant === 'filter' && Platform.OS === 'android' && selected ? '1' : '0';
  return `${variant}|${field}||${label}`;
}

/** A size that is no chip's, planted as the engine's answer before a mount. */
const WRONG_SIZE = { width: 13.5, height: 66.5 };

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

describe('Chip · G12', () => {
  it('lays both variants out at the size the control measured', async () => {
    poison([
      sizingKey('filter', false, 'Measured'),
      sizingKey('assist', false, 'Measured'),
    ]);
    const before = stats();
    await render(
      <View style={rowStyle}>
        <Chip
          label="Measured"
          testID="filter"
          hybridRef={captureHybrid('filter')}
        />
        <Chip
          variant="assist"
          label="Measured"
          testID="assist"
          hybridRef={captureHybrid('assist')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes: string[] = [];
    for (const testId of ['filter', 'assist']) {
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, testId);
      const box = await waitForBox(testId, content, testId);
      boxes.push(`${testId}=${describeSize(box)}`);
      expect(sameSize(content, WRONG_SIZE)).toBe(false);
    }
    const made = corrections(before, stats());
    console.log(`chip variants: ${boxes.join(' ')} corrections=${made}`);
    // Two cold, poisoned configurations: each has to be corrected, or the boxes
    // above came from the planted size and proved nothing.
    expect(made).toBeGreaterThanOrEqual(2);
  });

  it('keeps its size when selected on iOS, and grows by the check on Android', async () => {
    // Two chips of one label, one selected from its first frame: their measurements
    // are the two states' sizes, each taken by a control that never changed state.
    await render(
      <View style={rowStyle}>
        <Chip
          label="Sized"
          selected={false}
          testID="off"
          hybridRef={captureHybrid('off')}
        />
        <Chip
          label="Sized"
          selected
          testID="on"
          hybridRef={captureHybrid('on')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('off');
    await waitForTestId('on');
    const off = await waitForMeasured('off', 'unselected');
    const on = await waitForMeasured('on', 'selected');
    await waitForBox('off', off, 'unselected');
    await waitForBox('on', on, 'selected');
    await waitForDisplayed('on', '1');
    console.log(
      `chip selection: off=${describeSize(off)} on=${describeSize(on)}`
    );
    if (Platform.OS === 'android') {
      // The leading check (18 dp plus its padding): the reason `selected` is in the
      // Android sizing key at all.
      expect(on.width).toBeGreaterThan(off.width + 8);
      expect(on.height).toBeCloseTo(off.height, 0);
    } else {
      // The reason it is *not* in the iOS key: `Toggle(.button)` fills the same
      // capsule. If this ever goes red, `SELECTION_RESIZES` in `Chip.tsx` is wrong.
      expect(sameSize(on, off)).toBe(true);
    }
  });

  it('re-keys a toggle: each state keeps its own size', async () => {
    const LABEL = 'Re-keyed';
    poison([
      sizingKey('filter', false, LABEL),
      sizingKey('filter', true, LABEL),
    ]);
    const toggled = (
      <Chip
        label={LABEL}
        onSelectedChange={recordSelected('toggled')}
        testID="toggled"
        hybridRef={captureHybrid('toggled')}
      />
    );
    const { rerender } = await render(<View style={rowStyle}>{toggled}</View>, {
      timeout: 20000,
    });
    await waitForTestId('toggled');
    const unselected = await waitForMeasured('toggled', 'before the toggle');
    await waitForBox('toggled', unselected, 'before the toggle');

    // An uncontrolled toggle: native paints first, and the key follows only because
    // the wrapper re-renders for it (Android).
    nitroUiCore.setSizingTraceEnabled(true);
    nitroUiCore.drainSizingTrace();
    await pressChip('toggled');
    await waitForEvents(0, ['toggled:true']);
    await waitForDisplayed('toggled', '1');
    await sleep(600);
    const trace = nitroUiCore
      .drainSizingTrace()
      .map((e) => `${e.stage}:${e.width.toFixed(2)}x${e.height.toFixed(2)}`);
    nitroUiCore.setSizingTraceEnabled(false);
    const afterToggle = sizeOf('toggled');
    const afterToggleMeasured = measured('toggled');

    // Half one: a fresh, *unselected* chip of the same label. Its configuration was
    // measured before the toggle, so it must lay out exact - no correction at all. A
    // toggle whose selected width was filed under the unselected key hands it the
    // wrong answer, and its own measure then has to correct it.
    const before = stats();
    await rerender(
      <View style={rowStyle}>
        {toggled}
        <Chip label={LABEL} testID="fresh" hybridRef={captureHybrid('fresh')} />
      </View>
    );
    await waitForTestId('fresh');
    const fresh = await waitForMeasured('fresh', 'the fresh chip');
    await waitForBox('fresh', fresh, 'the fresh chip');
    await sleep(250);
    const freshCorrections = corrections(before, stats());

    // Half two: a chip mounted *selected* is the oracle for the selected size - it
    // never toggled, so nothing the toggle path did can have moved its measurement.
    // The toggled chip has to be laid out at exactly that.
    await rerender(
      <View style={rowStyle}>
        {toggled}
        <Chip label={LABEL} testID="fresh" hybridRef={captureHybrid('fresh')} />
        <Chip
          label={LABEL}
          selected
          testID="reference"
          hybridRef={captureHybrid('reference')}
        />
      </View>
    );
    await waitForTestId('reference');
    const reference = await waitForMeasured('reference', 'the reference');
    await waitForBox('reference', reference, 'the reference');
    console.log(
      `chip re-key: unselected=${describeSize(unselected)} ` +
        `afterToggle box=${describeSize(afterToggle)} ` +
        `measured=${describeSize(afterToggleMeasured)} ` +
        `reference=${describeSize(reference)} fresh=${describeSize(fresh)} ` +
        `freshCorrections=${freshCorrections} trace=${trace.join(',')}`
    );
    expect(sameSize(fresh, unselected)).toBe(true);
    expect(sameSize(sizeOf('fresh'), unselected)).toBe(true);
    expect(freshCorrections).toBe(0);
    await waitForBox('toggled', reference, 'the toggled chip, selected');
    expect(sameSize(measured('toggled'), reference)).toBe(true);
    if (Platform.OS === 'android') {
      expect(reference.width).toBeGreaterThan(unselected.width + 8);
    }
  });

  it('files nothing under a key two quick toggles have already left', async () => {
    // The hold's other edge (G12 review, fix round 1). A toggle holds its size report
    // until a props batch re-keys the chip, but the first batch to arrive need not be
    // the one that names what is drawn. Here the second toggle reaches native while
    // the first toggle's render is still on its way - an order a quick double tap can
    // take. That render's batch names `selected` while the chip draws unselected, and
    // a hold that ended on whatever batch came next let the re-measure the batch asks
    // for file the unselected width under the selected key: every later selected chip
    // of this label then started narrow and corrected. The hold now ends only on a
    // batch that has seen every toggle (the echoed event count, `Chip.tsx`).
    //
    // The oracle is a fresh *selected* chip of the label. Its configuration was
    // measured before the toggles, by a chip that never toggled, so it must lay out
    // exact. On iOS the selection is not in the key and the case holds trivially.
    //
    // The order is made, not hoped for, and each of the three waits below was found
    // by a version without it staying green against the old hold (Android, with the
    // host's own log beside the trace):
    // - each event keeps JS busy before it renders. After the first, so the first
    //   toggle's frame has drawn: its relayout holds main's ordinary messages behind
    //   that frame, which is also where the render's batch is applied, and a press
    //   posted before it lands after the batch. After the second, so the second
    //   render's batch cannot arrive within a frame of the first and re-key the chip
    //   before the first batch's re-measure has reported;
    // - the second press is posted from inside the first render, before its commit,
    //   and the render then waits for main to draw it. Posted from the commit's layout
    //   effect it landed after the batch; without the wait the batch shared the
    //   press's frame and the re-measure read the composition from before the press.
    const LABEL = 'Twice';
    poison([
      sizingKey('filter', false, LABEL),
      sizingKey('filter', true, LABEL),
    ]);
    const spin = (ms: number) => {
      const until = nitroUiCore.now() + ms;
      while (nitroUiCore.now() < until) {
        // Deliberately busy, as Picker's `recordChangeThenBlock` is.
      }
    };
    function TwoQuickToggles() {
      const [toggles, setToggles] = useState(0);
      const pressedAgain = useRef(false);
      const onChange = useCallback((next: boolean) => {
        events.push(`twice:${String(next)}`);
        spin(150);
        setToggles((count) => count + 1);
      }, []);
      if (toggles === 1 && !pressedAgain.current) {
        pressedAgain.current = true;
        handles.get('twice')?.nuiTestPress();
        spin(150);
      }
      return (
        <Chip
          label={LABEL}
          onSelectedChange={onChange}
          testID="twice"
          hybridRef={captureHybrid('twice')}
        />
      );
    }

    // The selected configuration, measured by a chip that never toggles - and then
    // gone, so nothing mounted under that key can re-report it after the toggles.
    const { rerender } = await render(
      <View style={rowStyle}>
        <Chip
          label={LABEL}
          selected
          testID="reference"
          hybridRef={captureHybrid('reference')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('reference');
    const reference = await waitForMeasured('reference', 'the reference');
    await waitForBox('reference', reference, 'the reference');
    await rerender(
      <View style={rowStyle}>
        <TwoQuickToggles />
      </View>
    );
    await waitForTestId('twice');
    const unselected = await waitForMeasured('twice', 'before the toggles');
    await waitForBox('twice', unselected, 'before the toggles');
    await sleep(250);

    nitroUiCore.setSizingTraceEnabled(true);
    nitroUiCore.drainSizingTrace();
    (await handleOf('twice')).nuiTestPress();
    expect(await waitForEvents(0, ['twice:true', 'twice:false'])).toEqual([
      'twice:true',
      'twice:false',
    ]);
    await waitForDisplayed('twice', '0');
    await waitForBox('twice', unselected, 'the chip, unselected again');
    await sleep(300);
    const trace = nitroUiCore
      .drainSizingTrace()
      .map((e) => `${e.stage}:${e.width.toFixed(2)}x${e.height.toFixed(2)}`);
    nitroUiCore.setSizingTraceEnabled(false);

    const before = stats();
    await rerender(
      <View style={rowStyle}>
        <TwoQuickToggles />
        <Chip
          label={LABEL}
          selected
          testID="fresh-on"
          hybridRef={captureHybrid('fresh-on')}
        />
      </View>
    );
    await waitForTestId('fresh-on');
    const firstBox = sizeOf('fresh-on');
    const fresh = await waitForMeasured('fresh-on', 'the fresh selected chip');
    await waitForBox('fresh-on', fresh, 'the fresh selected chip');
    await sleep(250);
    const freshCorrections = corrections(before, stats());
    console.log(
      `chip quick toggles: reference=${describeSize(reference)} ` +
        `unselected=${describeSize(unselected)} ` +
        `fresh first box=${describeSize(firstBox)} measured=${describeSize(fresh)} ` +
        `freshCorrections=${freshCorrections} trace=${trace.join(',')}`
    );
    expect(sameSize(fresh, reference)).toBe(true);
    expect(freshCorrections).toBe(0);
    if (Platform.OS === 'android') {
      // Otherwise the two keys would hold the same width and the case could not fail.
      expect(reference.width).toBeGreaterThan(unselected.width + 8);
    }
  });

  it('re-measures when the label changes', async () => {
    const { rerender } = await render(
      <Chip label="Short" testID="label" hybridRef={captureHybrid('label')} />,
      { timeout: 20000 }
    );
    await waitForTestId('label');
    const short = await waitForMeasured('label', 'the short label');
    await waitForBox('label', short, 'the short label');
    await rerender(
      <Chip
        label="A much longer label"
        testID="label"
        hybridRef={captureHybrid('label')}
      />
    );
    const long = await waitForRemeasure('label', short, 'the long label');
    await waitForBox('label', long, 'the long label');
    expect(long.width).toBeGreaterThan(short.width + 20);
  });

  it('follows a controlled selection in both directions', async () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      const onChange = useCallback((next: boolean) => {
        events.push(`controlled:${String(next)}`);
        setOn(next);
      }, []);
      return (
        <Chip
          label="Controlled"
          selected={on}
          onSelectedChange={onChange}
          testID="controlled"
          hybridRef={captureHybrid('controlled')}
        />
      );
    }
    await render(<Controlled />);
    await waitForTestId('controlled');
    await waitForDisplayed('controlled', '0');
    await pressChip('controlled');
    expect(await waitForEvents(0, ['controlled:true'])).toEqual([
      'controlled:true',
    ]);
    await waitForDisplayed('controlled', '1');
    await pressChip('controlled');
    expect(
      await waitForEvents(0, ['controlled:true', 'controlled:false'])
    ).toEqual(['controlled:true', 'controlled:false']);
    await waitForDisplayed('controlled', '0');
    expect(handles.get('controlled')?.selected).toBe(false);
  });

  it('reverts a toggle JS refused', async () => {
    // The handler never updates state, so `selected` stays false.
    await render(
      <Chip
        label="Refused"
        selected={false}
        onSelectedChange={recordSelected('refused')}
        testID="refused"
        hybridRef={captureHybrid('refused')}
      />
    );
    await waitForTestId('refused');
    await waitForDisplayed('refused', '0');
    await pressChip('refused');
    await waitForEvents(0, ['refused:true']);
    // Native showed `true` optimistically; the batch that echoed the event count
    // carried `selected={false}` again, so it has to be drawn unselected.
    await waitForDisplayed('refused', '0');
    // And the next toggle starts from unselected, so it requests `true` again. A chip
    // that kept the refused selection would request `false`.
    await pressChip('refused');
    expect(await waitForEvents(0, ['refused:true', 'refused:true'])).toEqual([
      'refused:true',
      'refused:true',
    ]);
    await waitForDisplayed('refused', '0');
    expect(handles.get('refused')?.mostRecentEventCount).toBeGreaterThanOrEqual(
      2
    );
  });

  it('applies a selection written from JS, and keeps its own when uncontrolled', async () => {
    const { rerender } = await render(
      <View style={rowStyle}>
        <Chip
          label="From JS"
          selected={false}
          testID="from-js"
          hybridRef={captureHybrid('from-js')}
        />
        <Chip
          label="Free"
          defaultSelected
          onSelectedChange={recordSelected('free')}
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
        <Chip
          label="From JS"
          selected
          testID="from-js"
          hybridRef={captureHybrid('from-js')}
        />
        <Chip
          label="Free"
          defaultSelected
          onSelectedChange={recordSelected('free')}
          testID="free"
          hybridRef={captureHybrid('free')}
        />
      </View>
    );
    await waitForDisplayed('from-js', '1');

    await pressChip('free');
    await waitForEvents(0, ['free:false']);
    await waitForDisplayed('free', '0');
    await pressChip('free');
    expect(await waitForEvents(0, ['free:false', 'free:true'])).toEqual([
      'free:false',
      'free:true',
    ]);
    await waitForDisplayed('free', '1');
  });

  it('presses an assist chip once per press, and it has no selection', async () => {
    await render(
      <Chip
        variant="assist"
        label="Assist"
        onPress={recordPress('assist')}
        onSelectedChange={recordSelected('assist')}
        testID="assist"
        hybridRef={captureHybrid('assist')}
      />
    );
    await waitForTestId('assist');
    await waitForDisplayed('assist', 'none');
    await pressChip('assist');
    await waitForEvents(0, ['assist:press']);
    await pressChip('assist');
    expect(await waitForEvents(0, ['assist:press', 'assist:press'])).toEqual([
      'assist:press',
      'assist:press',
    ]);
    // A press is a gesture, not a value: nothing was reported as a selection.
    await waitForDisplayed('assist', 'none');
    expect(handles.get('assist')?.mostRecentEventCount).toBe(0);
  });

  it('takes no press while disabled, of either variant', async () => {
    await render(
      <View style={rowStyle}>
        <Chip
          label="Disabled filter"
          disabled
          selected
          onSelectedChange={recordSelected('disabled-filter')}
          testID="disabled-filter"
          hybridRef={captureHybrid('disabled-filter')}
        />
        <Chip
          variant="assist"
          label="Disabled assist"
          disabled
          onPress={recordPress('disabled-assist')}
          testID="disabled-assist"
          hybridRef={captureHybrid('disabled-assist')}
        />
        {/* The barrier: an enabled chip whose event can be awaited, so an empty log
            for the disabled pair means "delivered nothing", not "not yet". */}
        <Chip
          variant="assist"
          label="Barrier"
          onPress={recordPress('barrier')}
          testID="barrier"
          hybridRef={captureHybrid('barrier')}
        />
      </View>
    );
    await waitForTestId('disabled-filter');
    await waitForTestId('disabled-assist');
    await waitForDisplayed('disabled-filter', '1');
    await pressChip('disabled-filter');
    await pressChip('disabled-assist');
    await pressChip('disabled-filter');
    await pressChip('barrier');
    expect(await waitForEvents(0, ['barrier:press'])).toEqual([
      'barrier:press',
    ]);
    await sleep(200);
    expect(events).toEqual(['barrier:press']);
    await waitForDisplayed('disabled-filter', '1');
    expect(handles.get('disabled-filter')?.disabled).toBe(true);
    expect(handles.get('disabled-filter')?.mostRecentEventCount).toBe(0);
  });

  it('tells accessibility what it is and whether it is selected', async () => {
    await render(
      <View style={rowStyle}>
        <Chip
          label="Vegan"
          onSelectedChange={recordSelected('a11y-filter')}
          testID="a11y-filter"
          hybridRef={captureHybrid('a11y-filter')}
        />
        <Chip
          variant="assist"
          label="Directions"
          accessibilityLabel="Get directions"
          testID="a11y-assist"
          hybridRef={captureHybrid('a11y-assist')}
        />
        <Chip
          label="Closed"
          disabled
          testID="a11y-disabled"
          hybridRef={captureHybrid('a11y-disabled')}
        />
      </View>
    );
    for (const testId of ['a11y-filter', 'a11y-assist', 'a11y-disabled']) {
      await waitForTestId(testId);
    }
    const filterOff = await probeAccessibility('a11y-filter');
    await pressChip('a11y-filter');
    await waitForEvents(0, ['a11y-filter:true']);
    await waitForDisplayed('a11y-filter', '1');
    const filterOn = await probeAccessibility('a11y-filter');
    const assist = await probeAccessibility('a11y-assist');
    const disabled = await probeAccessibility('a11y-disabled');
    console.log(
      `chip a11y: filterOff=[${filterOff}] filterOn=[${filterOn}] ` +
        `assist=[${assist}] disabled=[${disabled}]`
    );
    if (Platform.OS === 'android') {
      // M3's filter chip is a selectable checkbox; its assist chip is a button.
      expect(filterOff).toContain('role=Checkbox');
      expect(filterOff).toContain('selected=false');
      expect(filterOff).toContain('label=Vegan');
      expect(filterOn).toContain('selected=true');
      expect(assist).toContain('role=Button');
      expect(assist).toContain('selected=none');
      expect(assist).toContain('label=Get directions');
      expect(disabled).toContain('disabled=true');
      expect(filterOn).toContain('disabled=false');
    } else {
      // Nothing to read in-process (the spec says why); the role and the selected
      // state are asserted by XCUITest in `real-input:ios`.
      for (const report of [filterOff, filterOn, assist, disabled]) {
        expect(report).toBe('unavailable');
      }
    }
  });
});
