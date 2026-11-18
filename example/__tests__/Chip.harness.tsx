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
 * Ask `testId` for the pixels it is drawing, and wait for that probe's own answer. A
 * refusal to sample is a failed read, so it is an error here rather than a reading.
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
  if (!/ hits=\d+ mean=#[0-9A-F]{6}/.test(report)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) reported a line that is not a ` +
        `sample: ${report}`
    );
  }
  return report;
}

/** The area a probe found in the colour it asked for. */
function probeHits(report: string): number {
  const hits = / hits=(\d+)/.exec(report);
  return hits == null ? 0 : Number(hits[1]);
}

/** The colour a probe says the whole box averages at, as `#RRGGBB`. */
function probeMean(report: string): string {
  const mean = / mean=(#[0-9A-F]{6})/.exec(report);
  if (mean == null) {
    throw new Error(`the pixel probe report carries no mean colour: ${report}`);
  }
  return mean[1] ?? '';
}

/** Per-channel-sum distance between two `#RRGGBB` colours. */
function colourDistance(a: string, b: string): number {
  const first = channels(a);
  const second = channels(b);
  return first.reduce(
    (total, channel, index) => total + Math.abs(channel - second[index]!),
    0
  );
}

/** How far a colour's widest channel sits above its narrowest: how coloured it is. */
function chroma(colour: string): number {
  const [lowest, highest] = channels(colour).sort((a, b) => a - b);
  return (highest ?? 0) - (lowest ?? 0);
}

/** The red, green and blue of a `#RRGGBB` colour. */
function channels(colour: string): number[] {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(colour.slice(offset, offset + 2), 16)
  );
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
  // A quiet period, so a surplus event that arrives just after the count is reached
  // is in the list the caller compares.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/**
 * Android takes a harness tap. The harness's iOS tap is a `UITouch` with no HID
 * event behind it, which SwiftUI's button gesture refuses, so iOS runs the tap's
 * path through the chip's own `nuiTestPress()`.
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
 * `androidIcon` is the resolved string: a dev-server URL or a drawable name.
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
      // Material 3's selected filter chip gains a leading check.
      expect(on.width).toBeGreaterThan(off.width + 8);
      expect(on.height).toBeCloseTo(off.height, 0);
    } else {
      // `Toggle(.button)` fills the same capsule in both states.
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

    // Uncontrolled: native paints the toggle first and the wrapper re-keys it after.
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

    // A fresh unselected chip of the label was measured before the toggle, so it
    // needs no correction unless the selected width was filed under its key.
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

    // A chip mounted selected never toggled, so its size is the reference for the
    // toggled one.
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
    // The second toggle must reach native while the first toggle's render is still on
    // its way. So each event keeps JS busy before it renders, and the second press is
    // posted from inside the first render, which then waits for main to draw it.
    const LABEL = 'Twice';
    poison([
      sizingKey('filter', false, LABEL),
      sizingKey('filter', true, LABEL),
    ]);
    const spin = (ms: number) => {
      const until = nitroUiCore.now() + ms;
      while (nitroUiCore.now() < until) {
        // Deliberately busy.
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
      // iOS has nothing to read in-process; XCUITest asserts the role and the state.
      for (const report of [filterOff, filterOn, assist, disabled]) {
        expect(report).toBe('unavailable');
      }
    }
  });
});

describe('chip · a toggle round trip (E1)', () => {
  it('comes back to the width it started at across a select and a deselect', async () => {
    const LABEL = 'Round trip';
    poison([
      sizingKey('filter', false, LABEL),
      sizingKey('filter', true, LABEL),
    ]);
    // One chip is toggled; a twin for each state is never touched, so each twin's
    // size is the reference for that state.
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
 * A probe counts every pixel of one colour in the view, and the label draws in
 * colours close to the icon's, so each reading is a difference against the same chip
 * with no icon. The artwork is a filled square, so the area left is the slot's area.
 */
describe('Chip · the androidIcon (G21)', () => {
  /** The same square, as an imported asset and as a drawable name. */
  const SLAB_ASSET = require('../src/assets/icons/slab_24px.xml');
  const SLAB_NAME = 'nitroui_test_slab';
  const NOT_SHIPPED = 'nitroui_test_never_built';
  const LABEL = 'Slab';

  /** Material's icon size for both the assist and the filter chip. */
  const ICON_DP = 18;

  /** The colour the chip tinted its glyph with, or `null` when none drew. */
  function iconTintOf(testId: string): string | null {
    const tint = reportOf(testId).iconTint;
    return tint == null || tint === '-' ? null : tint;
  }

  const rgbOf = (tint: string): number => {
    const hex = /^#([0-9A-Fa-f]{6})$/.exec(tint);
    if (hex == null) {
      throw new Error(`"${tint}" is not a #RRGGBB colour.`);
    }
    return parseInt(hex[1] ?? '', 16);
  };

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
    // An asset resolves to a URL carrying the asset's hash, a key this file cannot
    // write out, so only chips with a drawable name or no icon are poisoned.
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
      // iOS ignores `androidIcon`, and now says so with pixels: the chip with the prop
      // paints what the chip without it paints. A glyph would move the mean colour of
      // the box by its own share of ink, and none of that appeared.
      expect(sameSize(boxes.get('asset')!, boxes.get('plain')!)).toBe(true);
      expect(reportOf('asset').iconTint).toBe('-');
      const assetMean = probeMean(
        await pixelProbe('asset', 0x000000, 'the chip with a drawable')
      );
      const plainMean = probeMean(
        await pixelProbe('plain', 0x000000, 'the chip without one')
      );
      console.log(
        `chip glyph iOS means: asset=${assetMean} plain=${plainMean} ` +
          `apart=${colourDistance(assetMean, plainMean)}`
      );
      expect(
        colourDistance(assetMean, plainMean) < 8,
        `iOS painted the chip with \`androidIcon\` at ${assetMean} against ` +
          `${plainMean} without it - the prop drew something.`
      ).toBe(true);
      return;
    }

    // An asset arrives as the dev-server URL (or the drawable Metro filed it under),
    // never as the number `require` evaluated to.
    expect(handles.get('asset')?.androidIcon ?? '').toMatch(
      /^url:.*slab_24px\.xml/
    );
    expect(reportOf('plain').iconTint).toBe('-');

    // The box grows by the icon's 18 dp, not by the icon plus its spacing.
    const growth = boxes.get('asset')!.width - boxes.get('plain')!.width;
    console.log(
      `chip glyph width growth: ${growth.toFixed(2)} dp (asset ` +
        `${boxes.get('asset')!.width.toFixed(2)} plain ` +
        `${boxes.get('plain')!.width.toFixed(2)})`
    );
    expect(growth).toBeGreaterThan(ICON_DP - 1);
    expect(growth).toBeLessThan(ICON_DP + 1);

    const color = await tintOf('asset', 'the imported slab');
    const withIcon = await hitsOf('asset', color);
    const without = await hitsOf('plain', color);
    const ink = withIcon - without;
    console.log(
      `chip glyph ink: tint=#${color.toString(16)} hits=${withIcon} plain=${without}`
    );
    // A square that fills its canvas paints the slot squared. 12% is room for the
    // anti-aliased edge and none for a slot of the wrong size.
    const slot = ICON_DP * PixelRatio.get();
    expect(ink).toBeGreaterThan(slot * slot * 0.88);
    expect(ink).toBeLessThan(slot * slot * 1.12);
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
    // A name and an asset are two roads to one file: same tint, same ink, same box.
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
    // Each variant against its own kind: a filter chip is narrower than an assist chip
    // of the same label, so one baseline cannot settle both.
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
  });

  it('hands the check the slot when the filter chip is selected, without moving the box', async () => {
    const boxes = await renderChips([
      { testId: 'toggle', androidIcon: SLAB_ASSET, onPress: true },
      { testId: 'twin-on', androidIcon: SLAB_NAME, selected: true },
      // Selected with no glyph: Material's check is the same 18 dp as the glyph, so
      // this chip is as wide as the ones with a glyph.
      { testId: 'bare-on', selected: true },
      // Unselected with no glyph: here the check does arrive in an empty row.
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

    // Selected, Material keeps the slot and the check takes it.
    await pressChip('toggle');
    await waitForDisplayed('toggle', '1');
    const after = await waitForBox(
      'toggle',
      before,
      'the selected filter chip'
    );
    // What draws in the slot now is Material's check, not the app's glyph.
    expect(reportOf('toggle').iconTint).toBe('-');
    // A chip that hid its slot when selected would change width here.
    expect(Math.abs(after.width - widthWithGlyph)).toBeLessThan(0.6);
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
    // With no glyph to hold the slot, the same check does move the box.
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
    expect(await hitsOf('recycled', firstTint)).toBeGreaterThan(0);

    // `key` makes the second chip a new view rather than an update.
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
    // A recycled chip reports as its own: no tint, and a probe counter that starts
    // again.
    expect(reportOf('recycled').iconTint).toBe('-');
    const report = await pixelProbe('recycled', firstTint, 'the second owner');
    expect(probeHits(report)).toBe(0);
    expect(/ n=1 |^n=1 /.test(report) || report.startsWith('n=1')).toBe(true);
  });
});

/**
 * The chip's fill, read back off the screen. Every number is the mean colour of one chip's
 * own box, so a state that never reaches the display cannot pass: the enabled pair is the
 * control on the read, and two chips mounted the same way say what the read costs in noise.
 */
describe('Chip · the selected fill in every state (G12)', () => {
  /** One label for every chip, so only the paint can tell two of them apart. */
  const LABEL = 'Filters';

  /** The smallest separation asked for, in channel sums. Well above what one label's ink
   *  moves the mean by, and well below the gap between two of the chip's own fills. */
  const SEPARATION = 60;

  /** What two chips of one drawing may sit apart - the noise floor of the read itself. */
  const NOISE = 10;

  type Spec = { testId: string; selected: boolean; disabled?: boolean };

  const SPECS: Spec[] = [
    { testId: 'on', selected: true },
    { testId: 'on-twin', selected: true },
    { testId: 'off', selected: false },
    { testId: 'disabled-on', selected: true, disabled: true },
    { testId: 'disabled-off', selected: false, disabled: true },
  ];

  /** Every state at once: laid out, drawn, and settled at the size the control measured. */
  async function renderEveryState(): Promise<Map<string, Size>> {
    await render(
      <View style={rowStyle}>
        {SPECS.map((spec) => (
          <Chip
            key={spec.testId}
            label={LABEL}
            selected={spec.selected}
            disabled={spec.disabled}
            testID={spec.testId}
            hybridRef={captureHybrid(spec.testId)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    const boxes = new Map<string, Size>();
    for (const spec of SPECS) {
      await waitForTestId(spec.testId);
      const content = await waitForMeasured(spec.testId, spec.testId);
      boxes.set(
        spec.testId,
        await waitForBox(spec.testId, content, spec.testId)
      );
      expect(sameSize(content, WRONG_SIZE)).toBe(false);
      await waitForDisplayed(spec.testId, spec.selected ? '1' : '0');
    }
    return boxes;
  }

  /** What `testId` paints, as the mean colour of its own box. */
  async function paintOf(testId: string): Promise<string> {
    return probeMean(await pixelProbe(testId, 0x000000, testId));
  }

  it('measures one size whether or not it is disabled', async () => {
    const boxes = await renderEveryState();
    const logged = [...boxes.entries()]
      .map(([id, size]) => `${id}=${describeSize(size)}`)
      .join(' ');
    console.log(`chip disabled sizes: ${logged}`);
    // `disabled` is in no sizing key: a chip that changed size when it was disabled would
    // be laid out at an enabled chip's box and repaint nothing.
    expect(
      sameSize(boxes.get('disabled-on')!, boxes.get('on')!),
      `a disabled selected chip measures ${describeSize(
        boxes.get('disabled-on')!
      )} where the enabled one is ${describeSize(boxes.get('on')!)} - ${logged}`
    ).toBe(true);
    expect(
      sameSize(boxes.get('disabled-off')!, boxes.get('off')!),
      `a disabled unselected chip measures ${describeSize(
        boxes.get('disabled-off')!
      )} where the enabled one is ${describeSize(boxes.get('off')!)} - ${logged}`
    ).toBe(true);
  });

  const itIos = Platform.OS === 'ios' ? it : it.skip;

  itIos(
    'paints a disabled selected chip apart from an unselected one and from itself',
    async () => {
      await renderEveryState();
      const on = await paintOf('on');
      const twin = await paintOf('on-twin');
      const off = await paintOf('off');
      const dimOn = await paintOf('disabled-on');
      const dimOff = await paintOf('disabled-off');
      const seen =
        `on=${on} twin=${twin} off=${off} ` +
        `disabledOn=${dimOn} disabledOff=${dimOff}`;
      console.log(`chip iOS fill: ${seen}`);

      expect(
        colourDistance(on, twin) < NOISE,
        `two chips mounted the same way read ${on} and ${twin}, ` +
          `${colourDistance(on, twin)} apart: the read is too unsteady to separate ` +
          `anything. ${seen}`
      ).toBe(true);

      // The control on the read: an enabled chip says "selected" with its fill.
      expect(
        colourDistance(on, off) > SEPARATION,
        `the read cannot tell an enabled selected chip (${
          on
        }) from an unselected one (${off}) - ${seen}`
      ).toBe(true);

      // The bug: once disabled, the same two chips drew one fill.
      expect(
        colourDistance(dimOn, dimOff) > SEPARATION,
        `a disabled chip paints ${dimOn} selected and ${
          dimOff
        } unselected, ${colourDistance(
          dimOn,
          dimOff
        )} apart: the selection does not reach the screen once the chip is ` +
          `disabled. ${seen}`
      ).toBe(true);

      // Dimmed, not enabled: the selected container survives at reduced strength.
      expect(
        colourDistance(dimOn, on) > SEPARATION / 2,
        `a disabled selected chip paints ${dimOn}, the same as the enabled ` +
          `${on}: a disabled chip now looks like an enabled one. ${seen}`
      ).toBe(true);

      // And what separates them is the selected colour, not any difference at all.
      expect(
        chroma(dimOn) - chroma(dimOff) > 30,
        `the disabled pair differs, but not in the selected colour: ${
          dimOn
        } carries ${chroma(dimOn)} of colour and ${
          dimOff
        } carries ${chroma(dimOff)}. ${seen}`
      ).toBe(true);
    }
  );
});
