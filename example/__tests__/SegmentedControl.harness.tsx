import { useState } from 'react';
import {
  Platform,
  Pressable,
  Text,
  TurboModuleRegistry,
  View,
  processColor,
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
  SegmentedControl,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiSegmentedControl';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type SegmentedHandle = {
  readonly options: string[];
  /** The index as React sent it, normalised against `options`; null if uncontrolled. */
  readonly selectedIndex: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  readonly onValueChange?: unknown;
  measureContent(): { width: number; height: number };
  /** Fire-and-forget on the UI thread; the answer arrives in a later report. */
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
  /**
   * What the hosted row is painting as its selection: `displayed=<index>`, or
   * `displayed=none` before the first draw. The only reading that can see an
   * uncontrolled selection, because `selectedIndex` is null on one.
   */
  nuiTestDisplayedIndex?(): string;
};

/** Handles by testID, so a test can ask each control what it holds. */
const handles = new Map<string, SegmentedHandle>();
const captureHybrid =
  (testId: string) =>
  (view: SegmentedHandle): void => {
    handles.set(testId, view);
  };

/** Every `onChange` the app has reported, in order: `testID:index`. */
const eventLog: string[] = [];
const recordChange =
  (testId: string) =>
  (event: { index: number }): void => {
    eventLog.push(`${testId}:${String(event.index)}`);
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

/** The box with its position in screen dp, the unit `userEvent.pressAt` takes. */
function boxOf(testId: string): ViewInfo | null {
  return harnessUi.queryByTestId(testId);
}

function measured(testId: string): Size | null {
  return handles.get(testId)?.measureContent() ?? null;
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

/**
 * Wait until the hosted row reports painting `want` as its selection. The read-out
 * is written from the draw path, so an applied update shows up a frame later.
 */
async function waitForDisplayed(
  testId: string,
  want: string,
  what: string
): Promise<string> {
  const handle = handles.get(testId);
  expect(handle).toBeDefined();
  return await pollUntil(
    () => {
      const report = handle?.nuiTestDisplayedIndex?.() ?? '';
      return report === want ? report : null;
    },
    () =>
      new Error(
        `${what}: "${testId}" never reported ${want}. Last report: ` +
          `"${handle?.nuiTestDisplayedIndex?.() ?? '<no read-out>'}".`
      ),
    8000
  );
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

/**
 * Poll until the control reports a size that is not `previous`. On Android
 * `measureContent()` still answers the old size for the frame in which new props
 * landed, because Compose re-measures on the UI thread.
 */
async function waitForRemeasure(
  testId: string,
  previous: Size,
  what: string
): Promise<Size> {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && !sameSize(size, previous) ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) still measures ${describeSize(previous)} ` +
          `after the change - control now measures ` +
          `${describeSize(measured(testId))}, so it never re-measured.`
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
 * The sizing key `SegmentedControl.tsx` builds: `optionCount|label|label|...`, with
 * `|` and `\` escaped in each label. Written out here rather than imported, so a
 * wrong key in the library cannot agree with itself.
 */
function sizingKey(options: readonly string[]): string {
  return `${String(options.length)}|${options
    .map((label) => label.replace(/[\\|]/g, '\\$&'))
    .join('|')}`;
}

/**
 * A size no segmented control has, planted as the engine's answer for a
 * configuration before its first mount. The declared fallback is close to the real
 * size, so without this a correction that never arrived would go unnoticed.
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
 * Ask `testId`'s control what colour it drew, and wait for that probe's own answer.
 * The probe runs on the UI thread without blocking, and each report is numbered, so
 * this waits for the report to change.
 */
async function pixelProbe(
  testId: string,
  color: number,
  what: string
): Promise<string> {
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
      return next === before || next === '' ? null : next;
    },
    () =>
      new Error(
        `the pixel probe for "${testId}" (${what}) never reported. Last report: ` +
          `"${handle.nuiTestPixelReport()}".`
      ),
    8000
  );
  // A probe that sampled nothing would make every "absent" assertion pass.
  if (/no pixels|no image|no context|no colour|size=0x/.test(report)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) sampled nothing: ${report}`
    );
  }
  if (!/ mean=#[0-9A-F]{6}( |$)/.test(report)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) reported a mean that is not six ` +
        `hex digits: ${report}`
    );
  }
  return report;
}

/**
 * Require the probe report to say the colour was, or was not, on the screen. Thrown
 * rather than matched, because a matcher failure shortens the report line.
 */
function expectPixels(
  report: string,
  want: 'present' | 'absent',
  what: string
): void {
  const hits = /hits=(\d+)/.exec(report)?.[1];
  if (hits == null) {
    throw new Error(`${what}: the probe reported no hit count: ${report}`);
  }
  const found = Number(hits) > 0;
  if (found !== (want === 'present')) {
    throw new Error(
      `${what}: expected the probed colour to be ${want} on screen, and the ` +
        `platform said ${report}`
    );
  }
}

/**
 * Tap the middle of segment `index` of `testId` and require exactly one change event
 * for that index. Assumes equal-width segments in a row that fits its box.
 */
async function tapSegment(
  testId: string,
  index: number,
  optionCount: number
): Promise<void> {
  const box = boxOf(testId);
  expect(box).not.toBeNull();
  const before = eventLog.length;
  await userEvent.pressAt(
    box!.x + (box!.width * (2 * index + 1)) / (2 * optionCount),
    box!.y + box!.height / 2
  );
  await waitForEvents(before + 1);
  expect(eventLog.slice(before)).toEqual([`${testId}:${String(index)}`]);
}

/**
 * Tap both ends of a control's box and require `expected` to be the log after.
 * Compose's segments are virtual nodes no geometry query can see, so a tap is how
 * a test learns which segment is where. Content drawn wider than its box is
 * centred, so each end of the box would show a different neighbour's segment.
 */
async function pressBothEnds(
  testId: string,
  expected: readonly string[]
): Promise<void> {
  const box = boxOf(testId);
  expect(box).not.toBeNull();
  await userEvent.pressAt(box!.x + box!.width - 2, box!.y + box!.height / 2);
  await userEvent.pressAt(box!.x + 2, box!.y + box!.height / 2);
  // Joined, because the harness abbreviates an array diff.
  expect((await waitForEvents(expected.length)).join(',')).toEqual(
    [...expected].join(',')
  );
}

const rowStyle: StyleProp<ViewStyle> = { gap: 6 };

afterEach(() => {
  cleanup();
  handles.clear();
  eventLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('SegmentedControl · G4', () => {
  it('lays each option list out at the size the control measured', async () => {
    const SHORT = ['Go'];
    const MIDDLE = ['One', 'Two', 'Three'];
    // Narrow enough to fit either device's window: Yoga clamps a wider box.
    const LONG = ['North', 'South', 'East', 'West'];
    poisonConfigurations([
      sizingKey(SHORT),
      sizingKey(MIDDLE),
      sizingKey(LONG),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={rowStyle}>
        <SegmentedControl
          options={SHORT}
          testID="short"
          hybridRef={captureHybrid('short')}
        />
        <SegmentedControl
          options={MIDDLE}
          testID="middle"
          hybridRef={captureHybrid('middle')}
        />
        <SegmentedControl
          options={LONG}
          testID="long"
          hybridRef={captureHybrid('long')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('short');
    const shortSize = await waitForMeasured('short', 'one option');
    await waitForBox('short', shortSize, 'one option');
    const middleSize = await waitForMeasured('middle', 'three options');
    await waitForBox('middle', middleSize, 'three options');
    const longSize = await waitForMeasured('long', 'four options');
    await waitForBox('long', longSize, 'four options');
    for (const testId of ['short', 'middle', 'long']) {
      expect(sameSize(sizeOf(testId), WRONG_SIZE)).toBe(false);
    }
    const cold = delta(before, stats());
    console.log(
      `three lists: short=${describeSize(shortSize)} ` +
        `middle=${describeSize(middleSize)} long=${describeSize(longSize)} ` +
        `cold=${JSON.stringify(cold)}`
    );
    // Three poisoned configurations: three corrections and three cache entries.
    expect(cold.corrections).toBeGreaterThanOrEqual(3);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(3);
    expect(middleSize.width).toBeGreaterThan(shortSize.width + 1);
    expect(longSize.width).toBeGreaterThan(middleSize.width + 1);
    // The height does not move with the labels.
    expect(
      sameSize(shortSize, { width: shortSize.width, height: longSize.height })
    ).toBe(true);
    unmount();
  });

  // The expected width is the same control measured one label at a time, plus the
  // gaps between segments. Asserted on Android only: an iOS segmented `Picker`
  // shares its width equally between segments.
  it('is as wide as its own segments added up', async () => {
    const FIVE = ['Hour', 'Day', 'Week', 'Month', 'Year'];
    /** `ButtonGroupDefaults.ConnectedSpaceBetween`, the gap between two segments. */
    const GAP_DP = 2;
    const { unmount } = await render(
      <View style={rowStyle}>
        {FIVE.map((label) => (
          <SegmentedControl
            key={label}
            options={[label]}
            testID={`one-${label}`}
            hybridRef={captureHybrid(`one-${label}`)}
          />
        ))}
        <SegmentedControl
          options={FIVE}
          testID="five"
          hybridRef={captureHybrid('five')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('five');
    const singles = await Promise.all(
      FIVE.map(
        async (label) =>
          (await waitForMeasured(`one-${label}`, `the "${label}" segment`))
            .width
      )
    );
    const row = await waitForMeasured('five', 'the five-label row');
    const wanted =
      singles.reduce((total, width) => total + width, 0) +
      GAP_DP * (FIVE.length - 1);
    const box = await waitForBox('five', row, 'the five-label row');
    console.log(
      `sum of segments (${Platform.OS}): singles=[${singles
        .map((width) => width.toFixed(2))
        .join(', ')}] row=${describeSize(row)} wanted=${wanted.toFixed(
        2
      )} box=${describeSize(box)}`
    );

    if (Platform.OS === 'android') {
      expect(
        Math.abs(row.width - wanted) < 1 ||
          `the row of ${FIVE.join(', ')} measures ${describeSize(
            row
          )} and was laid out at ${describeSize(
            box
          )}, but its own segments are ${singles
            .map((width) => width.toFixed(2))
            .join(' + ')} plus ${String(FIVE.length - 1)} gaps of ${String(
            GAP_DP
          )} dp = ${wanted.toFixed(2)} dp - off by ${(
            row.width - wanted
          ).toFixed(2)} dp`
      ).toBe(true);
    }
    unmount();
  });

  it('re-measures when the options change (R3)', async () => {
    const SHORT = ['Run'];
    const LONG = ['Run', 'the', 'whole', 'build'];
    poisonConfigurations([sizingKey(SHORT), sizingKey(LONG)]);
    const before = stats();
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={SHORT}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('opts');
    const shortSize = await waitForMeasured('opts', 'the one-option list');
    await waitForBox('opts', shortSize, 'the one-option list');
    const cold = delta(before, stats());
    expect(sameSize(sizeOf('opts'), WRONG_SIZE)).toBe(false);
    expect(cold.corrections).toBeGreaterThanOrEqual(1);

    await rerender(
      <SegmentedControl
        options={LONG}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    const longSize = await waitForRemeasure(
      'opts',
      shortSize,
      'the four-option list'
    );
    await waitForBox('opts', longSize, 'the four-option list');
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);

    await rerender(
      <SegmentedControl
        options={SHORT}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    await waitForBox('opts', shortSize, 'the one-option list again');

    // Both configurations are cached now, so a size change from here must cost no
    // correction: the measure pass alone has to reach the new size.
    await settle(150);
    const warmBefore = stats();
    await rerender(
      <SegmentedControl
        options={LONG}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    await waitForRemeasure('opts', shortSize, 'the four-option list, warm');
    await waitForBox('opts', longSize, 'the four-option list, warm');
    await rerender(
      <SegmentedControl
        options={SHORT}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    await waitForBox('opts', shortSize, 'the one-option list again, warm');
    const warm = delta(warmBefore, stats());
    console.log(
      `options R3: short=${describeSize(shortSize)} long=${describeSize(longSize)} ` +
        `warm=${JSON.stringify(warm)}`
    );
    expect(warm.corrections).toBe(0);
    expect(warm.cachedSizes).toBe(0);
    // Zero corrections with zero measurements would mean nothing happened at all.
    expect(warm.measurements).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('re-reports a key change that keeps the size (R3)', async () => {
    // The same two labels in the other order: the key changes and the measured size
    // does not. A host skips a report within 0.5 of the last one it sent, so the
    // key change itself has to reset that memory.
    const FIRST = ['Left', 'Right'];
    const SECOND = ['Right', 'Left'];
    poisonConfigurations([sizingKey(FIRST), sizingKey(SECOND)]);
    const before = stats();
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={FIRST}
        testID="same"
        hybridRef={captureHybrid('same')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('same');
    const size = await waitForMeasured('same', 'the first list');
    await waitForBox('same', size, 'the first list');
    expect(sameSize(sizeOf('same'), WRONG_SIZE)).toBe(false);
    expect(delta(before, stats()).corrections).toBeGreaterThanOrEqual(1);

    await settle(150);
    const changed = stats();
    await rerender(
      <SegmentedControl
        options={SECOND}
        testID="same"
        hybridRef={captureHybrid('same')}
      />
    );
    // No `waitForRemeasure`: the control still measures `size`, so only the box and
    // the engine's counters can change.
    await settle(500);
    const box = sizeOf('same');
    const after = delta(changed, stats());
    console.log(
      `same-size key change (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(measured('same'))} delta=${JSON.stringify(after)}`
    );
    expect(sameSize(box, WRONG_SIZE)).toBe(false);
    expect(sameSize(box, measured('same'))).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('keeps its size when the selection moves', async () => {
    // Material 3 puts a check mark on the selected segment by default, which would
    // make the row's width depend on the selection. This component asks for
    // label-only segments.
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={['Alpha', 'Beta', 'Gamma']}
        selectedIndex={0}
        testID="sel"
        hybridRef={captureHybrid('sel')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('sel');
    const size = await waitForMeasured('sel', 'the first selection');
    await waitForBox('sel', size, 'the first selection');
    await settle(150);

    const before = stats();
    for (const selectedIndex of [1, 2, 0]) {
      await rerender(
        <SegmentedControl
          options={['Alpha', 'Beta', 'Gamma']}
          selectedIndex={selectedIndex}
          testID="sel"
          hybridRef={captureHybrid('sel')}
        />
      );
      await settle(120);
    }
    const moved = delta(before, stats());
    console.log(`selection turns: ${JSON.stringify(moved)}`);
    expect(sameSize(sizeOf('sel'), size)).toBe(true);
    // The measure count is not asserted: an instance that was corrected once
    // re-measures on every later props change by design.
    expect(moved.corrections).toBe(0);
    expect(moved.cachedSizes).toBe(0);
    unmount();
  });

  it('clamps a selection the caller sends out of range', async () => {
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={99}
        testID="high"
        hybridRef={captureHybrid('high')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('high');
    const wide = await waitForMeasured('high', 'three options');
    await waitForBox('high', wide, 'three options');
    await settle(150);
    const before = stats();
    expect(handles.get('high')?.selectedIndex).toBe(2);

    await rerender(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={-4}
        testID="high"
        hybridRef={captureHybrid('high')}
      />
    );
    await settle(200);
    expect(handles.get('high')?.selectedIndex).toBe(0);
    const clamped = delta(before, stats());
    expect(sameSize(sizeOf('high'), wide)).toBe(true);
    expect(clamped.corrections).toBe(0);
    expect(clamped.cachedSizes).toBe(0);
    unmount();
  });

  it('clamps an index written straight to native', async () => {
    // The wrapper clamps the index before React sends it, so writing through the
    // handle is the only way to hand native an out-of-range index. This covers the
    // clamp on reading `selectedIndex` back, not which segment is painted.
    const { unmount } = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        testID="raw"
        hybridRef={captureHybrid('raw')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('raw');
    await settle(150);
    const raw = handles.get('raw') as unknown as {
      selectedIndex: number | null;
    };
    // Uncontrolled, so native has no index of React's yet.
    expect(raw.selectedIndex).toBe(null);

    raw.selectedIndex = 9;
    expect(handles.get('raw')?.selectedIndex).toBe(2);

    raw.selectedIndex = -3;
    expect(handles.get('raw')?.selectedIndex).toBe(0);

    // A prop write is not an interaction: it must not emit a change event.
    expect(eventLog).toEqual([]);
    unmount();
  });

  it('clamps the selection and re-measures when the options shrink', async () => {
    // `options` and the selection arrive in one batch in no particular order, so
    // native has to clamp after both have landed.
    const WIDE = ['One', 'Two', 'Three', 'Four'];
    const SMALL = ['One', 'Two'];
    poisonConfigurations([sizingKey(WIDE), sizingKey(SMALL)]);
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={WIDE}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('shrink');
    const wideSize = await waitForMeasured('shrink', 'four options');
    await waitForBox('shrink', wideSize, 'four options');
    expect(handles.get('shrink')?.selectedIndex).toBe(3);

    await rerender(
      <SegmentedControl
        options={SMALL}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />
    );
    const smallSize = await waitForRemeasure('shrink', wideSize, 'two options');
    await waitForBox('shrink', smallSize, 'two options');
    expect(smallSize.width).toBeLessThan(wideSize.width - 1);
    await settle(150);
    expect(handles.get('shrink')?.selectedIndex).toBe(1);
    expect(handles.get('shrink')?.options).toEqual(['One', 'Two']);
    unmount();
  });

  it('moves an uncontrolled selection into the list when the options shrink', async () => {
    // An uncontrolled control answers `selectedIndex` as null, so the only reading
    // that shows where the row sits is `nuiTestDisplayedIndex`.
    const LARGE = ['One', 'Two', 'Three', 'Four'];
    const SMALL = ['One', 'Two'];
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={LARGE}
        defaultSelectedIndex={0}
        onChange={recordChange('uncontrolled-shrink')}
        testID="uncontrolled-shrink"
        hybridRef={captureHybrid('uncontrolled-shrink')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('uncontrolled-shrink');
    await waitForMeasured('uncontrolled-shrink', 'four options');
    expect(handles.get('uncontrolled-shrink')?.selectedIndex).toBeNull();

    await tapSegment('uncontrolled-shrink', 2, LARGE.length);
    await waitForDisplayed(
      'uncontrolled-shrink',
      'displayed=2',
      'the tap, as the row draws it'
    );

    await rerender(
      <SegmentedControl
        options={SMALL}
        defaultSelectedIndex={0}
        onChange={recordChange('uncontrolled-shrink')}
        testID="uncontrolled-shrink"
        hybridRef={captureHybrid('uncontrolled-shrink')}
      />
    );
    // 1 is the clamp's answer: `defaultSelectedIndex` is still 0 and is not
    // applied a second time.
    await waitForDisplayed(
      'uncontrolled-shrink',
      'displayed=1',
      'the clamp of an uncontrolled selection'
    );
    unmount();
  });

  it('reads back what React sent', async () => {
    const tint = processColor('#7C4DFF') as number;
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={['One', 'Two']}
        selectedIndex={1}
        disabled
        tintColor="#7C4DFF"
        accessibilityLabel="View mode"
        testID="props"
        hybridRef={captureHybrid('props')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('props');
    const handle = handles.get('props');
    expect(handle?.options).toEqual(['One', 'Two']);
    expect(handle?.selectedIndex).toBe(1);
    expect(handle?.disabled).toBe(true);
    expect(handle?.tintColor).toBe(tint);
    expect(handle?.accessibilityLabel).toBe('View mode');
    expect(handle?.mostRecentEventCount).toBe(0);

    await rerender(
      <SegmentedControl
        options={['One', 'Two']}
        selectedIndex={1}
        testID="props"
        hybridRef={captureHybrid('props')}
      />
    );
    await settle(150);
    expect(handles.get('props')?.disabled).toBe(false);
    expect(handles.get('props')?.tintColor).toBeNull();
    expect(handles.get('props')?.accessibilityLabel).toBeNull();
    unmount();
  });

  it('keeps a caller width in charge', async () => {
    const { unmount } = await render(
      <SegmentedControl
        options={['January', 'February', 'March', 'April']}
        testID="capped"
        style={{ width: 140 }}
        hybridRef={captureHybrid('capped')}
      />
    );
    await waitForTestId('capped');
    const box = sizeOf('capped');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 140) < 0.6).toBe(true);
    unmount();
  });

  it('fits an over-wide row into the box the caller gave it', async () => {
    // The labels want about 330 dp and the box is 140: the row has to be drawn at
    // 140, with each outer segment at its own edge of the box. The reported size
    // must stay the row's own width, or 140 would be cached for this option list.
    const { unmount } = await render(
      <SegmentedControl
        options={['January', 'February', 'March', 'April']}
        onChange={recordChange('overwide')}
        testID="overwide"
        style={{ width: 140 }}
        hybridRef={captureHybrid('overwide')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('overwide');
    const box = boxOf('overwide');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 140) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('overwide', 'four long options');
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);

    // The box reaching 140 does not mean the row has been fitted into it yet: the
    // first placement costs one clipped frame, and a tap during it hits a neighbour.
    await settle();
    await userEvent.pressAt(box!.x + box!.width - 2, box!.y + box!.height / 2);
    expect(await waitForEvents(1)).toEqual(['overwide:3']);

    await userEvent.pressAt(box!.x + 2, box!.y + box!.height / 2);
    expect(await waitForEvents(2)).toEqual(['overwide:3', 'overwide:0']);
    unmount();
  });

  it('fits a row whose box comes from a narrow parent, not from a width', async () => {
    // No `width` on the control: the row reports about 600 dp and the 300 dp parent
    // clamps its box. The parent then narrows twice, because the fit made for one
    // box width has to be made again for the next.
    //
    // `alignItems: flex-start` matters: a stretched child is pinned to the parent's
    // width from its first frame, and its box is then never a clamped report.
    const COLD_SIX = ['January', 'February', 'March', 'April', 'May', 'June'];
    const row = (width: number) => (
      <View style={{ width, alignItems: 'flex-start' }}>
        <SegmentedControl
          options={COLD_SIX}
          onChange={recordChange('clamped')}
          testID="clamped"
          hybridRef={captureHybrid('clamped')}
        />
      </View>
    );
    const { rerender, unmount } = await render(row(300), { timeout: 20000 });
    await waitForTestId('clamped');
    const box = boxOf('clamped');
    expect(box).not.toBeNull();
    const intrinsic = await waitForMeasured('clamped', 'six month labels');
    // The box is the parent's width while the report stays the row's own.
    expect(Math.abs(box!.width - 300) < 0.6).toBe(true);
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);
    await settle();
    await pressBothEnds('clamped', ['clamped:5', 'clamped:0']);

    await rerender(row(260));
    await waitForBox(
      'clamped',
      { width: 260, height: box!.height },
      'the narrower parent'
    );
    await settle();
    await pressBothEnds('clamped', [
      'clamped:5',
      'clamped:0',
      'clamped:5',
      'clamped:0',
    ]);

    await rerender(row(224));
    await waitForBox(
      'clamped',
      { width: 224, height: box!.height },
      'the narrowest parent'
    );
    await settle();
    await pressBothEnds('clamped', [
      'clamped:5',
      'clamped:0',
      'clamped:5',
      'clamped:0',
      'clamped:5',
      'clamped:0',
    ]);
    unmount();
  });

  it('re-fits when the caller narrows the box under an over-wide row', async () => {
    // Fitted at 140, then the caller asks for 120. The row overruns both boxes, so
    // the fit has to be made again against the new width.
    const FOUR = ['January', 'February', 'March', 'April'];
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('narrowing')}
        testID="narrowing"
        style={{ width: 140 }}
        hybridRef={captureHybrid('narrowing')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('narrowing');
    const wide = boxOf('narrowing');
    expect(wide).not.toBeNull();
    await waitForMeasured('narrowing', 'four long options at 140');
    await settle();
    await pressBothEnds('narrowing', ['narrowing:3', 'narrowing:0']);

    await rerender(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('narrowing')}
        testID="narrowing"
        style={{ width: 120 }}
        hybridRef={captureHybrid('narrowing')}
      />
    );
    await waitForBox(
      'narrowing',
      { width: 120, height: wide!.height },
      'the narrower box'
    );
    await settle();
    await pressBothEnds('narrowing', [
      'narrowing:3',
      'narrowing:0',
      'narrowing:3',
      'narrowing:0',
    ]);
    unmount();
  });

  it('keeps an over-wide row fitted through a prop change', async () => {
    // The tint repaints without resizing: it is not in the sizing key, so the box
    // does not move and Fabric does not measure this host again. The row has to
    // stay fitted anyway.
    const FOUR = ['January', 'February', 'March', 'April'];
    const tint = processColor('#7C4DFF') as number;
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('tinted')}
        testID="tinted"
        style={{ width: 140 }}
        tintColor={null}
        hybridRef={captureHybrid('tinted')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('tinted');
    await waitForMeasured('tinted', 'four long options at 140');
    await settle();
    await pressBothEnds('tinted', ['tinted:3', 'tinted:0']);

    await rerender(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('tinted')}
        testID="tinted"
        style={{ width: 140 }}
        tintColor="#7C4DFF"
        hybridRef={captureHybrid('tinted')}
      />
    );
    // The handle shows the prop arrived; the layout passes it causes are not
    // observable from JS, so a settle follows.
    await pollUntil(
      () => (handles.get('tinted')?.tintColor === tint ? true : null),
      () =>
        new Error(
          `testID "tinted" never reported the new tint - the handle says ` +
            `${String(handles.get('tinted')?.tintColor)}, expected ${String(tint)}.`
        ),
      5000
    );
    await settle(400);
    await pressBothEnds('tinted', [
      'tinted:3',
      'tinted:0',
      'tinted:3',
      'tinted:0',
    ]);
    unmount();
  });

  it('shows tintColor on the selected segment, on the screen and not next door', async () => {
    // `hybridRef.tintColor` only echoes the prop, so the screen is probed for the
    // colour. A second, untinted control checks the tint stays inside its own
    // control. Android paints `tintColor`; on iOS it has no effect, and both are
    // asserted. Magenta, because neither platform's theme draws it by itself.
    const TINT = processColor('#FF00A0') as number;
    const TINT_CSS = '#FF00A0';
    const RETINT = processColor('#00B8D4') as number;
    const OPTIONS = ['Left', 'Right'];

    const tree = (tint: string | null) => (
      <View style={rowStyle}>
        <SegmentedControl
          options={OPTIONS}
          onChange={recordChange('painted')}
          testID="painted"
          tintColor={tint}
          hybridRef={captureHybrid('painted')}
        />
        <SegmentedControl
          options={OPTIONS}
          onChange={recordChange('plain')}
          testID="plain"
          tintColor={null}
          hybridRef={captureHybrid('plain')}
        />
      </View>
    );

    const { rerender, unmount } = await render(tree(null), { timeout: 20000 });
    await waitForTestId('painted');
    await waitForMeasured('painted', 'two short options');
    await settle(400);

    // Before the tint is sent neither control shows the colour, so a later hit is new.
    expectPixels(
      await pixelProbe('painted', TINT, 'the control while untinted'),
      'absent',
      '"painted" while it still had no tintColor'
    );
    expectPixels(
      await pixelProbe('plain', TINT, 'the control that never asks for one'),
      'absent',
      '"plain", which has no tintColor'
    );

    await rerender(tree(TINT_CSS));
    await pollUntil(
      () => (handles.get('painted')?.tintColor === TINT ? true : null),
      () =>
        new Error(
          `"painted" never reported the new tint - the handle says ` +
            `${String(handles.get('painted')?.tintColor)}.`
        ),
      5000
    );
    // The handle agreeing is a prop echo; the settle covers the frame the colour needs.
    await settle(400);
    const painted = await pixelProbe('painted', TINT, 'the tinted control');
    console.log(`tint pixels (${Platform.OS}): ${painted}`);

    await tapSegment('painted', 1, OPTIONS.length);
    await settle(300);
    const afterTap = await pixelProbe(
      'painted',
      TINT,
      'the tinted control, after a tap'
    );

    await tapSegment('painted', 0, OPTIONS.length);
    await settle(300);
    const backAgain = await pixelProbe(
      'painted',
      TINT,
      'the tinted control, back on the first segment'
    );

    if (Platform.OS === 'android') {
      expectPixels(
        painted,
        'present',
        `"painted" after tintColor="${TINT_CSS}"`
      );
      expectPixels(
        afterTap,
        'present',
        '"painted" after the tap onto the 2nd segment'
      );
      expectPixels(
        backAgain,
        'present',
        '"painted" after the tap back to the 1st'
      );
      expectPixels(
        await pixelProbe('plain', TINT, 'the untinted neighbour'),
        'absent',
        '"plain" beside a tinted control - a tint must not reach its neighbour'
      );

      // A second colour, then none: a tint that stuck at whatever it first painted
      // would pass everything above.
      await rerender(tree('#00B8D4'));
      await settle(400);
      expectPixels(
        await pixelProbe('painted', RETINT, 'the control after a second tint'),
        'present',
        '"painted" after tintColor="#00B8D4"'
      );
      expectPixels(
        await pixelProbe('painted', TINT, 'the control after a second tint'),
        'absent',
        '"painted" after the colour changed - the first tint must be gone'
      );
      await rerender(tree(null));
      await settle(400);
      expectPixels(
        await pixelProbe(
          'painted',
          TINT,
          'the control after the tint was removed'
        ),
        'absent',
        '"painted" after tintColor went back to null'
      );
    } else {
      // iOS: `tintColor` has no effect, at every one of the three readings.
      expectPixels(
        painted,
        'absent',
        `"painted" after tintColor="${TINT_CSS}" (iOS)`
      );
      expectPixels(afterTap, 'absent', '"painted" after a tap (iOS)');
      expectPixels(backAgain, 'absent', '"painted" after tapping back (iOS)');
    }
    unmount();
  });

  it('reports one event per selection, and nothing when disabled', async () => {
    // A plain RN `Pressable` in the same row shows that harness taps arrive at all;
    // without it an empty event log would prove nothing.
    const rnPresses: string[] = [];
    const { unmount } = await render(
      <View style={rowStyle}>
        <Pressable
          testID="rn-barometer"
          onPress={(): void => {
            rnPresses.push('tap');
          }}
        >
          <Text>Barometer</Text>
        </Pressable>
        <SegmentedControl
          options={['1', '2', '3']}
          onChange={recordChange('tap')}
          testID="tap"
          hybridRef={captureHybrid('tap')}
        />
        <SegmentedControl
          options={['1', '2', '3']}
          disabled
          onChange={recordChange('tap-disabled')}
          testID="tap-disabled"
          hybridRef={captureHybrid('tap-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    const enabled = await waitForTestId('tap');
    const disabled = await waitForTestId('tap-disabled');
    const barometer = await waitForTestId('rn-barometer');

    await userEvent.press(barometer);
    await pollUntil(
      () => (rnPresses.length > 0 ? true : null),
      () =>
        new Error(
          'The harness tap reached neither the RN Pressable in this row nor ' +
            'anything else: this test cannot judge a segmented selection.'
        ),
      5000
    );

    // The disabled control first: an event from it could still be in flight here,
    // and the enabled control's event arriving later, alone, rules that out.
    await userEvent.press(disabled);
    await userEvent.press(disabled);
    expect(eventLog).toEqual([]);
    expect(handles.get('tap-disabled')?.disabled).toBe(true);

    // Three equal-width segments, so the middle of the control is the middle
    // segment on both platforms.
    await userEvent.press(enabled);
    const seen = await waitForEvents(1);
    expect(seen).toEqual(['tap:1']);
    // A tap on the segment that is already selected reports nothing.
    await userEvent.press(enabled);
    await settle(250);
    expect(eventLog).toEqual(['tap:1']);
    console.log(
      `taps: harness taps to the control = ${String(eventLog.length)}, ` +
        `barometer ${String(rnPresses.length)}`
    );
    unmount();
  });

  it('snaps back a selection React does not accept', async () => {
    // `Rejected` never moves `selectedIndex`, so native has to put the old segment
    // back after each tap. A tap on an already selected segment reports nothing, so
    // two events for two taps show the selection came back. `Advanced` accepts the
    // selection, and its second tap must report nothing.
    function Rejected() {
      const [index] = useState(0);
      return (
        <SegmentedControl
          options={['1', '2', '3']}
          selectedIndex={index}
          onChange={recordChange('rejected')}
          testID="rejected"
          hybridRef={captureHybrid('rejected')}
        />
      );
    }
    function Advanced() {
      const [index, setIndex] = useState(0);
      return (
        <SegmentedControl
          options={['1', '2', '3']}
          selectedIndex={index}
          onChange={(event): void => {
            recordChange('accepted')(event);
            setIndex(event.index);
          }}
          testID="accepted"
          hybridRef={captureHybrid('accepted')}
        />
      );
    }

    const { unmount } = await render(
      <View style={rowStyle}>
        <Rejected />
        <Advanced />
      </View>,
      { timeout: 20000 }
    );
    const rejected = await waitForTestId('rejected');
    const accepted = await waitForTestId('accepted');

    await userEvent.press(rejected);
    const first = await waitForEvents(1);
    expect(first).toEqual(['rejected:1']);
    await pollUntil(
      () =>
        (handles.get('rejected')?.mostRecentEventCount ?? 0) >= 1 ? true : null,
      () =>
        new Error(
          `The echo never reached native: mostRecentEventCount is ` +
            `${String(handles.get('rejected')?.mostRecentEventCount)}.`
        )
    );

    await userEvent.press(rejected);
    const second = await waitForEvents(2);
    expect(second).toEqual(['rejected:1', 'rejected:1']);

    await userEvent.press(accepted);
    const both = await waitForEvents(3);
    expect(both).toEqual(['rejected:1', 'rejected:1', 'accepted:1']);
    await pollUntil(
      () => (handles.get('accepted')?.selectedIndex === 1 ? true : null),
      () =>
        new Error(
          `An accepted selection never reached the control: selectedIndex is ` +
            `${String(handles.get('accepted')?.selectedIndex)}.`
        )
    );
    // Accepted, so a second tap on that segment is a tap on the selected one.
    await userEvent.press(accepted);
    await settle(250);
    expect(eventLog).toEqual(['rejected:1', 'rejected:1', 'accepted:1']);
    unmount();
  });

  it('sizes 200 option lists, each at its own size', async () => {
    // No two rows share an option list, and the number of segments varies too.
    const lists: string[][] = Array.from({ length: 200 }, (_row, index) =>
      Array.from(
        { length: 1 + (index % 3) },
        (_label, part) => `R${String(index + 1)}${'ab'[part] ?? ''}`
      )
    );
    poisonConfigurations(lists.slice(0, 20).map(sizingKey));
    const before = stats();
    await render(
      <View style={rowStyle}>
        {lists.map((options, index) => (
          <SegmentedControl
            key={`row-${String(index)}`}
            options={options}
            testID={`many-${String(index)}`}
            hybridRef={captureHybrid(`many-${String(index)}`)}
          />
        ))}
      </View>,
      { timeout: 30000 }
    );
    // Every configuration is cold, so all 200 are laid out wrong on their first
    // frame and corrected afterwards. Wait for the corrections, then check each box.
    const findWrong = (): string[] => {
      const wrong: string[] = [];
      for (let index = 0; index < lists.length; index += 1) {
        const testId = `many-${String(index)}`;
        const box = sizeOf(testId);
        const content = handles.get(testId)?.measureContent() ?? null;
        if (!sameSize(box, content)) {
          wrong.push(
            `${testId}: box ${describeSize(box)} vs measured ${describeSize(content)}`
          );
        }
        if (sameSize(box, WRONG_SIZE)) {
          wrong.push(`${testId}: still poisoned`);
        }
      }
      return wrong;
    };
    const wrong = await pollUntil(
      () => {
        const found = findWrong();
        return found.length === 0 ? [] : null;
      },
      () => {
        const found = findWrong();
        const d = delta(before, stats());
        return new Error(
          `${String(found.length)}/200 still wrong after the wait: ` +
            `${found.slice(0, 2).join(' | ')} - corrections ` +
            `${String(d.corrections)}, cached ${String(d.cachedSizes)}`
        );
      },
      25000
    );
    const d = delta(before, stats());
    console.log(
      `200 controls: corrections=${String(d.corrections)} ` +
        `immediate=${String(d.immediate)} cached=${String(d.cachedSizes)}`
    );
    expect(wrong).toEqual([]);
    // Fewer cache entries than lists would mean two lists share one size.
    expect(d.corrections).toBeGreaterThanOrEqual(200);
    expect(d.cachedSizes).toBeGreaterThanOrEqual(200);
  });

  it('survives remounts with the size and seed of each mount', async () => {
    const cases: { options: string[]; defaultSelectedIndex: number }[] = [
      { options: ['First'], defaultSelectedIndex: 0 },
      { options: ['Second', 'with a longer label'], defaultSelectedIndex: 1 },
      { options: ['Go'], defaultSelectedIndex: 0 },
    ];
    for (const [index, testCase] of cases.entries()) {
      const key = sizingKey(testCase.options);
      if (index === 0) {
        poisonConfigurations([key]);
      }
      const testId = `remount-${testCase.options[0]}`;
      const { unmount } = await render(
        <SegmentedControl
          options={testCase.options}
          defaultSelectedIndex={testCase.defaultSelectedIndex}
          testID={testId}
          hybridRef={captureHybrid(testId)}
        />,
        { timeout: 20000 }
      );
      await waitForTestId(testId);
      const size = await waitForMeasured(testId, `mount ${String(index)}`);
      await waitForBox(testId, size, `mount ${String(index)}`);
      expect(sameSize(sizeOf(testId), WRONG_SIZE)).toBe(false);
      expect(handles.get(testId)?.options).toEqual(testCase.options);
      expect(handles.get(testId)?.selectedIndex).toBeNull();
      unmount();
      await settle(100);
    }

    // Whether a remount applies its own `defaultSelectedIndex` is checked by taps,
    // because a tap on the selected segment reports nothing. `remount-proof` seeds
    // 0, so a press on its middle segment must report index 1, which shows taps
    // arrive. `remount-kept` seeds 1, so the same press on it must report nothing.
    const seedPair = () => (
      <View style={rowStyle}>
        <SegmentedControl
          options={['1', '2', '3']}
          defaultSelectedIndex={1}
          onChange={recordChange('remount-kept')}
          testID="remount-kept"
          hybridRef={captureHybrid('remount-kept')}
        />
        <SegmentedControl
          options={['1', '2', '3']}
          defaultSelectedIndex={0}
          onChange={recordChange('remount-proof')}
          testID="remount-proof"
          hybridRef={captureHybrid('remount-proof')}
        />
      </View>
    );

    const first = await render(seedPair(), { timeout: 20000 });
    await waitForTestId('remount-kept');
    await waitForTestId('remount-proof');
    first.unmount();
    await settle(150);

    const second = await render(seedPair(), { timeout: 20000 });
    const kept = await waitForTestId('remount-kept');
    const proof = await waitForTestId('remount-proof');

    await userEvent.press(proof);
    expect(await waitForEvents(1)).toEqual(['remount-proof:1']);

    await userEvent.press(kept);
    await settle(250);
    expect(eventLog).toEqual(['remount-proof:1']);
    second.unmount();
  });

  it('corrects a planted size that matches the current box (iOS measure signal)', async () => {
    // On iOS a bounds change is itself a reason to re-measure. Planting the current
    // box as the answer for the next option list removes that bounds change, so
    // only the component telling its host that the content may have changed size
    // can notice the longer labels.
    const SHORT = ['Run'];
    const LONG = ['Run', 'the', 'whole', 'build'];
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={SHORT}
        testID="pin"
        hybridRef={captureHybrid('pin')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('pin');
    const shortSize = await waitForMeasured('pin', 'the one-option list');
    await waitForBox('pin', shortSize, 'the one-option list');

    nitroUiCore.seedSizingSize(
      COMPONENT,
      sizingKey(LONG),
      shortSize.width,
      shortSize.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    await settle(200);
    const before = stats();

    await rerender(
      <SegmentedControl
        options={LONG}
        testID="pin"
        hybridRef={captureHybrid('pin')}
      />
    );
    await settle(600);
    const box = sizeOf('pin');
    const now = measured('pin');
    const after = delta(before, stats());
    console.log(
      `planted-equal-to-box (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(now)} delta=${JSON.stringify(after)}`
    );
    expect(now !== null && now.width > shortSize.width + 1).toBe(true);
    expect(sameSize(box, now)).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });
});
