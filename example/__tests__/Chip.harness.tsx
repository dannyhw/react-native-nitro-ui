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
import { Platform, PixelRatio, TurboModuleRegistry, View } from 'react-native';
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
  readonly androidIcon: string | null;
  measureContent(): { width: number; height: number };
  nuiTestPress(): void;
  nuiTestProbeAccessibility(): void;
  nuiTestStateReport(): string;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
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
 * The key `Chip.tsx` builds: `variant|selected|systemImage|androidIcon|label`, with
 * the selection only where it moves the size (an Android filter chip). Written out
 * rather than imported, so a wrong helper cannot poison and pass its own test.
 *
 * The `androidIcon` field (G21) is the *resolved* string - a dev-server URL or a
 * drawable name - so callers pass what the wrapper will send, not what the app wrote.
 * Both platforms carry it on both platforms: the glyph widens the chip on whichever
 * one draws it, and a key that only grew on one would let a chip with a glyph inherit
 * the cached width of a chip without one on the other.
 */
function sizingKey(
  variant: string,
  selected: boolean,
  label: string,
  androidIcon = ''
): string {
  const field =
    variant === 'filter' && Platform.OS === 'android' && selected ? '1' : '0';
  return `${variant}|${field}||${androidIcon}|${label}`;
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

/**
 * A select and a deselect come back to the width the chip started at (E1).
 *
 * What the always-present leading slot buys (`ChipLeadingSlotEmpty`) is exactly this
 * sentence, and E1 re-earns it rather than trusting it: Material 3 1.5.0-beta02 still
 * draws a selectable chip's leading icon through an `AnimatedVisibility` with an
 * `expandHorizontally`/`shrinkHorizontally` spring, so a `null` icon is still a width
 * animation the host cannot follow - the original measurement settled 1.1 dp narrower
 * than a chip mounted selected, with its label ellipsised. If the spring ever goes,
 * the slot can go with it, and the first thing this test would notice is a deselect
 * that no longer lands on the width it left.
 */
describe('chip · a toggle round trip (E1)', () => {
  it('comes back to the width it started at across a select and a deselect', async () => {
    const LABEL = 'Round trip';
    poison([
      sizingKey('filter', false, LABEL),
      sizingKey('filter', true, LABEL),
    ]);
    // Three chips, one label: the one that is toggled, and a twin for each state
    // that is never touched. A twin is the only oracle for "the width this state
    // really is" — a chip mounted in that state never goes through the toggle path,
    // so nothing that path does can have moved its measurement (G12's re-key test
    // reads it the same way, and the poisoned keys mean being right requires
    // correcting rather than agreeing with a wrong starting number).
    await render(
      <View style={rowStyle}>
        <Chip
          label={LABEL}
          onSelectedChange={recordSelected('round-trip')}
          testID="round-trip"
          hybridRef={captureHybrid('round-trip')}
        />
        <Chip
          label={LABEL}
          testID="round-trip-off"
          hybridRef={captureHybrid('round-trip-off')}
        />
        <Chip
          label={LABEL}
          selected
          testID="round-trip-on"
          hybridRef={captureHybrid('round-trip-on')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('round-trip');
    const before = await waitForMeasured('round-trip', 'before the toggle');
    await waitForBox('round-trip', before, 'before the toggle');
    const twinOff = await waitForMeasured(
      'round-trip-off',
      'the chip that was never toggled, unselected'
    );
    const twinOn = await waitForMeasured(
      'round-trip-on',
      'the chip that was never toggled, selected'
    );
    await waitForBox('round-trip-off', twinOff, 'the unselected twin');
    await waitForBox('round-trip-on', twinOn, 'the selected twin');

    await pressChip('round-trip');
    await waitForDisplayed('round-trip', '1');
    await sleep(600);
    const selected = await waitForMeasured('round-trip', 'the selected state');
    await waitForBox('round-trip', selected, 'the selected state');

    await pressChip('round-trip');
    await waitForDisplayed('round-trip', '0');
    await sleep(600);
    const after = measured('round-trip');
    const afterBox = sizeOf('round-trip');
    console.log(
      `chip round trip: before=${describeSize(before)} ` +
        `selected=${describeSize(selected)} after=${describeSize(after)} ` +
        `box=${describeSize(afterBox)} twins(off)=${describeSize(
          twinOff
        )} twins(on)=${describeSize(twinOn)}`
    );

    // Each state of the toggled chip is the width of the twin that has always been
    // in it. This is the half the leading slot is for: with a `null` leading icon
    // the toggle is a width *animation*, and the frames that settle it are never
    // reported, so the toggled chip lands off its own twin by about a dp.
    expect(
      sameSize(selected, twinOn),
      `selecting left the chip at ${describeSize(
        selected
      )} where a chip mounted selected is ${describeSize(twinOn)}`
    ).toBe(true);
    expect(
      sameSize(after, twinOff),
      `a deselect left the chip at ${describeSize(
        after
      )} where a chip mounted unselected is ${describeSize(twinOff)}`
    ).toBe(true);
    // And the round trip itself: the same chip, back where it started, box included.
    expect(
      sameSize(before, after),
      `a deselect left the chip measuring ${describeSize(
        after
      )} where it started at ${describeSize(before)}`
    ).toBe(true);
    expect(
      sameSize(before, afterBox),
      `a deselect left the chip laid out at ${describeSize(
        afterBox
      )} where it started at ${describeSize(before)}`
    ).toBe(true);
  });
});

/**
 * `androidIcon` on a Chip (G21): the glyph, in Material's leading slot, in the
 * colour Material picked for it.
 *
 * The probe answers here are *differences*, and that is the whole design of this
 * suite. A probe counts every pixel of one colour in the view, and the chip draws
 * other things in colours close to its icon's - so "N pixels of the glyph's colour
 * are on screen" on its own would pass with the label's ink alone. Measured against
 * the same chip with no icon, the label's contribution cancels (its glyphs are the
 * same glyphs, only moved along) and what is left is the artwork: which is the only
 * reading that can tell a glyph that drew from a prop that was echoed.
 *
 * The artwork is a filled square, not a glyph (`nitroui_test_slab`), because then the
 * area that is left is the slot's area - and the slot's area is the size claim.
 */
describe('Chip · the androidIcon (G21)', () => {
  /** The same square, through each road D43 gives an app. */
  const SLAB_ASSET = require('../src/assets/icons/slab_24px.xml');
  const SLAB_NAME = 'nitroui_test_slab';
  const NOT_SHIPPED = 'nitroui_test_never_built';
  const LABEL = 'Slab';

  /** Material's chip icon slot: `AssistChipTokens.IconSize` and `FilterChipTokens`' are both 18 dp. */
  const ICON_DP = 18;

  /**
   * Ask `testId` for its pixels, and wait for that probe's own answer.
   *
   * `Button.harness.tsx`'s helper of the same name, copied rather than shared: the
   * suites run apart, and a shared util module would be a third file to keep in step.
   */
  async function pixelProbe(testId: string, color: number, what: string) {
    const handle = handles.get(testId);
    if (handle == null) {
      throw new Error(
        `testID "${testId}" has no handle - it was never rendered.`
      );
    }
    const before = handle.nuiTestPixelReport();
    handle.nuiTestPixelProbe(color);
    const report = await pollUntil(
      () => {
        const next = handle.nuiTestPixelReport();
        return next === '' || next === before ? null : next;
      },
      () =>
        new Error(
          `the pixel probe for "${testId}" (${what}) never reported. Last: ` +
            `"${handle.nuiTestPixelReport()}".`
        ),
      8000
    );
    if (
      !/ hits=\d+ mean=#[0-9A-F]{6}/.test(report) &&
      !/no pixels/.test(report) &&
      !/size=\d+x\d+ no pixels/.test(report)
    ) {
      throw new Error(
        `the pixel probe for "${testId}" (${what}) reported a line that is neither a ` +
          `sample nor a refusal: ${report}`
      );
    }
    return report;
  }

  /** The `hits=` count of a probe line. */
  function probeHits(report: string): number {
    const hits = / hits=(\d+)/.exec(report);
    return hits == null ? 0 : Number(hits[1]);
  }

  /** The colour the chip tinted its glyph with, or `null` when none drew. */
  function iconTintOf(testId: string): string | null {
    const tint = reportOf(testId).iconTint;
    return tint == null || tint === '-' ? null : tint;
  }

  /** A `#RRGGBB` as the number the probe wants. */
  const rgbOf = (tint: string): number => {
    const hex = /^#([0-9A-Fa-f]{6})$/.exec(tint);
    if (hex == null) {
      throw new Error(`"${tint}" is not a #RRGGBB colour.`);
    }
    return parseInt(hex[1] ?? '', 16);
  };

  /** The `iconTint` of `testId` as a probe colour, with a message that says what was expected. */
  async function tintOf(testId: string, what: string): Promise<number> {
    const tint = await pollUntil(
      () => iconTintOf(testId),
      () =>
        new Error(
          `"${testId}" (${what}) never recorded a glyph tint - it reports ` +
            `"${handles.get(testId)?.nuiTestStateReport() ?? 'no handle'}".`
        )
    );
    return rgbOf(tint);
  }

  /** Pixels of `color` this chip is drawing. */
  async function hitsOf(testId: string, color: number): Promise<number> {
    return probeHits(await pixelProbe(testId, color, testId));
  }

  /** One chip per testID, each with its own key poisoned, and every box settled. */
  async function renderChips(
    specs: ReadonlyArray<{
      testId: string;
      variant?: 'filter' | 'assist';
      androidIcon?: string | number;
      selected?: boolean;
      onPress?: boolean;
    }>
  ): Promise<Map<string, Size>> {
    // The key the wrapper will build, for every chip this file can name it for: a
    // drawable is the string itself and no icon is the empty field. An *asset* resolves
    // to a URL carrying the asset's own hash, and restating that rule here would be
    // testing a copy of the thing under test - `Button.harness.tsx` proves the asset's
    // key, and a planted size that never comes back is worth more when the key is one
    // this file wrote than when it is one this file guessed.
    poison(
      specs
        .filter((spec) => typeof spec.androidIcon !== 'number')
        .map((spec) =>
          sizingKey(
            spec.variant ?? 'filter',
            spec.selected === true,
            LABEL,
            typeof spec.androidIcon === 'string' ? spec.androidIcon : ''
          )
        )
    );
    await render(
      <View style={rowStyle}>
        {specs.map((spec) => (
          <Chip
            key={spec.testId}
            label={LABEL}
            variant={spec.variant ?? 'filter'}
            selected={spec.selected}
            androidIcon={spec.androidIcon}
            onPress={spec.onPress ? recordPress(spec.testId) : undefined}
            testID={spec.testId}
            hybridRef={captureHybrid(spec.testId)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const boxes = new Map<string, Size>();
    for (const spec of specs) {
      await waitForTestId(spec.testId);
      const content = await waitForMeasured(spec.testId, spec.testId);
      boxes.set(
        spec.testId,
        await waitForBox(spec.testId, content, spec.testId)
      );
      expect(sameSize(content, WRONG_SIZE)).toBe(false);
    }
    return boxes;
  }

  const logged = (boxes: Map<string, Size>): string =>
    [...boxes.entries()]
      .map(([id, size]) => `${id}=${describeSize(size)}`)
      .join(' ');

  it('draws the imported glyph in the slot, and leaves nothing else in its colour', async () => {
    const boxes = await renderChips([
      { testId: 'plain', variant: 'assist' },
      { testId: 'asset', variant: 'assist', androidIcon: SLAB_ASSET },
    ]);
    console.log(`chip glyph boxes: ${logged(boxes)}`);
    if (Platform.OS !== 'android') {
      // iOS draws `systemImage` and ignores `androidIcon`, exactly as Button does, so
      // the chip with the prop is the chip without it - and the probe says so rather
      // than answering zero, which would be a green test about nothing.
      expect(sameSize(boxes.get('asset')!, boxes.get('plain')!)).toBe(true);
      expect(reportOf('asset').iconTint).toBe('-');
      expect(await pixelProbe('asset', 0x000000, 'the iOS refusal')).toContain(
        'no pixels'
      );
      return;
    }

    // The wire the wrapper built, read back off the control: an asset arrives as the
    // dev-server URL (or the drawable Metro filed it under), never as the number
    // `require` evaluated to.
    expect(handles.get('asset')?.androidIcon ?? '').toMatch(
      /^url:.*slab_24px\.xml/
    );
    expect(reportOf('plain').iconTint).toBe('-');

    const color = await tintOf('asset', 'the imported slab');
    const withIcon = await hitsOf('asset', color);
    const without = await hitsOf('plain', color);
    const ink = withIcon - without;
    console.log(
      `chip glyph ink: tint=#${color.toString(16)} hits=${withIcon} plain=${without}`
    );
    // Something drew, and it is the size of the slot: `FilterChipDefaults.IconSize`
    // is 18 dp on the density of this device, and a square that fills its canvas paints
    // the slot squared. 12% is room for the anti-aliased edge of a 50-pixel square and
    // no room for a slot of the wrong size: 24 dp would be 78% more ink, and no slot at
    // all is 100% less.
    const slot = ICON_DP * PixelRatio.get();
    expect(ink).toBeGreaterThan(slot * slot * 0.88);
    expect(ink).toBeLessThan(slot * slot * 1.12);
    // The glyph widens the chip by the slot and its spacing, which is the same claim
    // read off the box rather than the pixels.
    expect(boxes.get('asset')!.width).toBeGreaterThan(
      boxes.get('plain')!.width + 8
    );
  });

  it('draws the named glyph the same pixels as the imported one', async () => {
    const boxes = await renderChips([
      { testId: 'by-asset', variant: 'assist', androidIcon: SLAB_ASSET },
      { testId: 'by-name', variant: 'assist', androidIcon: SLAB_NAME },
    ]);
    console.log(`chip glyph roads: ${logged(boxes)}`);
    if (Platform.OS !== 'android') {
      expect(sameSize(boxes.get('by-name')!, boxes.get('by-asset')!)).toBe(
        true
      );
      return;
    }
    // The two forms of D43's prop are two roads to one file: same tint, same ink, same
    // box - a name that resolved to a *different* drawable, or to nothing, shows up here.
    expect(handles.get('by-name')?.androidIcon).toBe(SLAB_NAME);
    expect(sameSize(boxes.get('by-name')!, boxes.get('by-asset')!)).toBe(true);
    const color = await tintOf('by-asset', 'the imported slab');
    const fromName = await hitsOf('by-name', color);
    const fromAsset = await hitsOf('by-asset', color);
    console.log(`chip glyph roads ink: name=${fromName} asset=${fromAsset}`);
    expect(Math.abs(fromName - fromAsset)).toBeLessThan(
      Math.max(4, fromAsset * 0.05)
    );
  });

  it('leaves a name that resolves to nothing exactly its no-icon self', async () => {
    const boxes = await renderChips([
      { testId: 'none', variant: 'assist' },
      { testId: 'missing', variant: 'assist', androidIcon: NOT_SHIPPED },
      { testId: 'plain-filter' },
      { testId: 'missing-filter', androidIcon: NOT_SHIPPED },
    ]);
    console.log(`chip missing-glyph boxes: ${logged(boxes)}`);
    // Both variants, each against its own kind: a filter chip with this label is 3.81 dp
    // narrower than an assist chip (`docs/components/chip.md`'s size table), so one
    // baseline cannot settle both. The assist chip is handed `null` and the filter chip
    // the zero-wide spacer, two ways of saying the same thing to two different
    // compositions; an unresolvable name must not cost a pixel of width on either.
    expect(sameSize(boxes.get('missing')!, boxes.get('none')!)).toBe(true);
    expect(
      sameSize(boxes.get('missing-filter')!, boxes.get('plain-filter')!),
      `an unresolvable name left a filter chip at ${describeSize(
        boxes.get('missing-filter')!
      )} where the same chip with no icon at all is ${describeSize(
        boxes.get('plain-filter')!
      )}`
    ).toBe(true);
    if (Platform.OS !== 'android') {
      return;
    }
    expect(reportOf('missing').iconTint).toBe('-');
    // A colour that some *other* chip recorded, probed here: the answer is the same
    // count the plain chip gives, because the only thing of that colour on this chip is
    // whatever the plain chip has too.
    const color = 0x00a000;
    expect(await hitsOf('missing', color)).toBe(await hitsOf('none', color));
  });

  it('hands the check the slot when the filter chip is selected, without moving the box', async () => {
    const boxes = await renderChips([
      { testId: 'toggle', androidIcon: SLAB_ASSET, onPress: true },
      { testId: 'twin-on', androidIcon: SLAB_NAME, selected: true },
      // A selected filter chip that never asked for a glyph. Material's check is
      // `FilterChipDefaults.IconSize` - the same 18 dp the glyph holds - so this chip is
      // the *same width* as the ones with a glyph. That equality is the claim.
      { testId: 'bare-on', selected: true },
      // And the contrast: the same chip unselected, whose slot is the zero-wide spacer,
      // so here the check really does arrive in an empty row.
      { testId: 'bare-off' },
    ]);
    const before = boxes.get('toggle')!;
    console.log(`chip toggle boxes: ${logged(boxes)}`);
    if (Platform.OS !== 'android') {
      expect(sameSize(boxes.get('toggle')!, boxes.get('twin-on')!)).toBe(true);
      return;
    }
    // Unselected, the glyph holds the slot.
    const color = await tintOf('toggle', 'the unselected filter chip');
    expect(await hitsOf('toggle', color)).toBeGreaterThan(
      await hitsOf('bare-on', color)
    );
    const widthWithGlyph = before.width;

    // Select it. Material keeps the slot - `leadingContent`'s `AnimatedVisibility` is
    // keyed on the *presence* of a leading icon, not on the selection, which is why this
    // chip is handed a lambda in both states - and the check takes it.
    await pressChip('toggle');
    await waitForDisplayed('toggle', '1');
    const after = await waitForBox(
      'toggle',
      before,
      'the selected filter chip'
    );
    // The glyph is gone from the slot: what draws there now is Material's check, and a
    // check is not the app's glyph, so the tint field goes back to `-`.
    expect(reportOf('toggle').iconTint).toBe('-');
    // The box did not move. A chip that hid its slot when selected would grow or shrink
    // by the slot and its spacing here, which is the difference between "the check takes
    // the slot" and "the slot comes and goes".
    expect(Math.abs(after.width - widthWithGlyph)).toBeLessThan(0.6);
    // And it lands where a chip *mounted* selected lands: the same width, glyph or no
    // glyph, which is the half that proves the swap and not just the stability.
    expect(
      sameSize(after, boxes.get('twin-on')!),
      `selecting left the chip at ${describeSize(
        after
      )} where a chip mounted selected with a glyph is ${describeSize(
        boxes.get('twin-on')!
      )}`
    ).toBe(true);
    expect(
      sameSize(after, boxes.get('bare-on')!),
      `a chip that swapped its glyph for the check is ${describeSize(
        after
      )} where a chip that only ever had the check is ${describeSize(
        boxes.get('bare-on')!
      )}`
    ).toBe(true);
    // The contrast that turns those two equalities into a claim: with no glyph to hold
    // the slot, the very same check *does* move the box, by the slot and its spacing.
    expect(boxes.get('bare-on')!.width).toBeGreaterThan(
      boxes.get('bare-off')!.width + 8
    );
  });

  it('starts empty for its next owner', async () => {
    const first = (
      <Chip
        label={LABEL}
        variant="assist"
        androidIcon={SLAB_NAME}
        testID="recycled"
        hybridRef={captureHybrid('recycled')}
      />
    );
    const { rerender } = await render(<View style={rowStyle}>{first}</View>, {
      timeout: 20000,
    });
    await waitForTestId('recycled');
    await waitForMeasured('recycled', 'the first owner');
    if (Platform.OS !== 'android') {
      expect(reportOf('recycled').iconTint).toBe('-');
      return;
    }
    const firstTint = await tintOf('recycled', 'the first owner');
    expect(await hitsOf('recycled', firstTint)).toBeGreaterThan(
      // The same colour on a chip that never had an icon, taken from the previous
      // gate's fixture: not needed for the claim, so the assertion below is the one
      // that matters - this owner draws its own glyph, and the next one draws none.
      0
    );

    // Unmount the icon and mount nothing in its place, then hand the row to a chip
    // that asks for nothing. `key` is what makes it a new view rather than an update.
    await rerender(
      <View style={rowStyle}>
        <Chip
          key="second"
          label={LABEL}
          variant="assist"
          testID="recycled"
          hybridRef={captureHybrid('recycled')}
        />
      </View>
    );
    await waitForMeasured('recycled', 'the second owner');
    // The report a recycled chip gives is its own: no tint, and a probe counter that
    // starts again - a view that kept its previous owner's state would answer for it.
    expect(reportOf('recycled').iconTint).toBe('-');
    const report = await pixelProbe('recycled', firstTint, 'the second owner');
    expect(probeHits(report)).toBe(0);
    expect(/ n=1 |^n=1 /.test(report) || report.startsWith('n=1')).toBe(true);
  });
});
