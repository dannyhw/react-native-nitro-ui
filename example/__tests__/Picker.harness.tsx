// The harness dispatches input into the app's own window, and a picker's options
// live in a popup outside it: a tap here can reach the anchor but never a row.
import { useCallback, useState, useRef } from 'react';
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
  Picker,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

// The Fabric component name, which the sizing engine files sizes under.
const COMPONENT = 'NitroUiPicker';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

// What `hybridRef` hands back. Declared here: the library does not export it.
type PickerHandle = {
  readonly options: string[];
  readonly selectedIndex: number | null;
  readonly mostRecentEventCount: number;
  readonly variant: string;
  readonly label: string | null;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  // Selects `index` through the same native path a row press takes.
  nuiTestSelect(index: number): void;
  nuiTestMenuReport(): string;
};

function drawnOf(testId: string): string {
  const line = handles.get(testId)?.nuiTestMenuReport() ?? '';
  const field = line.split(';').find((part) => part.startsWith('drawn='));
  if (field == null) {
    throw new Error(`No "drawn" in picker report "${line}".`);
  }
  return field.slice('drawn='.length);
}

const handles = new Map<string, PickerHandle>();
const captureHybrid =
  (testId: string) =>
  (view: PickerHandle): void => {
    handles.set(testId, view);
  };

// Every `onChange` the app has reported, in order: `testID:index`.
const eventLog: string[] = [];
const recordChange =
  (testId: string) =>
  (event: { index: number }): void => {
    eventLog.push(`${testId}:${String(event.index)}`);
  };

// `recordChange` that then blocks the JS thread for `ms`, so the render a choice
// causes lands after the control has painted and laid out its new title.
const recordChangeThenBlock =
  (testId: string, ms = 250) =>
  (event: { index: number }): void => {
    eventLog.push(`${testId}:${String(event.index)}`);
    const deadline = nitroUiCore.now() + ms;
    while (nitroUiCore.now() < deadline) {
      // Deliberately busy: the point is that JS cannot render.
    }
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

// Equal within Yoga's rounding.
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

// Waits for a size that differs from `previous`: on Android `measureContent()` still
// answers with the old size for the frame in which the new title landed.
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

async function waitForMeasured(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

// For a rerender that remounts the native view (a variant change). Refuses a
// missing handle, a zero size (a dropped or not yet measured host) and the size
// from before the rerender. The size is the witness, not the handle: on iOS the
// same handle object answers for both mounts.
async function waitForFreshMeasure(
  testId: string,
  stale: Size | null,
  what: string,
  timeoutMs = 12000
): Promise<Size> {
  return await pollUntil(
    () => {
      const size = measured(testId);
      if (size == null) return null; // no mount to ask yet
      if (size.width <= 0 || size.height <= 0) return null; // 0x0 is absence
      return stale != null && sameSize(size, stale) ? null : size;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never reported a size of its new mount - ` +
          `measureContent() says ${describeSize(measured(testId))}, was ` +
          `${describeSize(stale)} before the rerender, box ` +
          `${describeSize(sizeOf(testId))}.`
      ),
    timeoutMs
  );
}

// Must match the sizing key `Picker.tsx` builds. Written out here, not imported,
// so a wrong key in the library fails these tests.
function sizingKey(
  options: readonly string[],
  selectedIndex: number,
  label: string | null,
  variant: string
): string {
  const escape = (value: string) => value.replace(/[\\|]/g, '\\$&');
  return [
    variant,
    String(options.length),
    ...options.map(escape),
    `sel:${escape(options[selectedIndex] ?? '')}`,
    `lbl:${escape(label ?? '')}`,
  ].join('|');
}

// A size no picker has, seeded as the engine's answer before a configuration
// first mounts: the declared fallback is close to the real size, so without this
// a correction that never arrived would go unnoticed.
const WRONG_SIZE = { width: 13.25, height: 66.5 };

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

async function settle(ms = 250): Promise<void> {
  await sleep(ms);
}

async function pressAnchor(testId: string): Promise<void> {
  const box = boxOf(testId);
  expect(box).not.toBeNull();
  await userEvent.pressAt(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

// Chooses an option through the native selection path: no `userEvent` can reach
// a row in the popup. The settle covers the hop to the UI thread and back.
async function pickRow(testId: string, index: number): Promise<void> {
  const handle = handles.get(testId);
  expect(handle).not.toBeNull();
  handle?.nuiTestSelect(index);
  await settle(150);
}

function laidOutSizes(): { width: number; height: number }[] {
  return nitroUiCore
    .drainSizingTrace()
    .filter((event) => event.stage === 'laidOut')
    .map((event) => ({ width: event.width, height: event.height }));
}

// Must match the Picker's declared fallback size on each platform.
const DECLARED_FALLBACK =
  Platform.OS === 'ios'
    ? { width: 72, height: 35 }
    : { width: 280, height: 56 };

const columnStyle = { gap: 8 } as const;

// Long enough to be wider than Material 3's 280 dp minimum text field width,
// below which every Android menu picker is the same size, and short enough to
// fit a 402 pt iPhone window, where Yoga would clamp the box.
const LONG_TITLE = 'A considerably longer colour name indeed';

// The configuration the declared fallback size was measured from.
const REFERENCE = ['One', 'Two', 'Three'];

afterEach(() => {
  cleanup();
  handles.clear();
  eventLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

function armTrace(): void {
  nitroUiCore.setSizingTraceEnabled(true);
  nitroUiCore.drainSizingTrace();
}

describe('Picker · G6', () => {
  it('lays each option list out at the size its own title gives it', async () => {
    const SHORT = ['Go'];
    const MIDDLE = REFERENCE;
    const LONG = [LONG_TITLE];
    poisonConfigurations([
      sizingKey(SHORT, 0, null, 'menu'),
      sizingKey(MIDDLE, 0, null, 'menu'),
      sizingKey(LONG, 0, null, 'menu'),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={SHORT}
          testID="short"
          hybridRef={captureHybrid('short')}
        />
        <Picker
          options={MIDDLE}
          testID="middle"
          hybridRef={captureHybrid('middle')}
        />
        <Picker
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
        `middle(REFERENCE)=${describeSize(middleSize)} ` +
        `long=${describeSize(longSize)} cold=${JSON.stringify(cold)} ` +
        `(load: menu, uncontrolled, no label)`
    );
    expect(cold.corrections).toBeGreaterThanOrEqual(3);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(3);
    // Only the widest is compared: on Android the two short lists are both at
    // Material's 280 dp minimum width.
    expect(longSize.width).toBeGreaterThan(shortSize.width + 20);
    expect(
      sameSize(shortSize, { width: shortSize.width, height: longSize.height })
    ).toBe(true);
    unmount();
  });

  it('sizes a menu by the title it shows, not by the longest option', async () => {
    const OPTIONS = ['Red', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 1, null, 'menu'),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={0}
          testID="sel-first"
          hybridRef={captureHybrid('sel-first')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={1}
          testID="sel-last"
          hybridRef={captureHybrid('sel-last')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('sel-first');
    const firstSize = await waitForMeasured('sel-first', 'the short title');
    await waitForBox('sel-first', firstSize, 'the short title');
    const lastSize = await waitForMeasured('sel-last', 'the long title');
    await waitForBox('sel-last', lastSize, 'the long title');
    const cold = delta(before, stats());
    console.log(
      `same options, other title: first=${describeSize(firstSize)} ` +
        `last=${describeSize(lastSize)} cold=${JSON.stringify(cold)}`
    );
    expect(lastSize.width).toBeGreaterThan(firstSize.width + 20);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(2);
    expect(cold.corrections).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('takes the box width as a wheel and its own width as a menu', async () => {
    const OPTIONS = ['Small', 'Medium', 'Large'];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 0, null, 'wheel'),
    ]);
    // 330 wide: an Android menu is 280 dp at its minimum, and a narrower parent would
    // clamp it.
    const { unmount } = await render(
      <View style={{ width: 330 }}>
        <Picker
          options={OPTIONS}
          testID="as-menu"
          hybridRef={captureHybrid('as-menu')}
        />
        <Picker
          options={OPTIONS}
          variant="wheel"
          testID="as-wheel"
          hybridRef={captureHybrid('as-wheel')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('as-menu');
    const menuSize = await waitForMeasured('as-menu', 'the menu');
    await waitForBox('as-menu', menuSize, 'the menu');
    const wheelSize = await waitForMeasured('as-wheel', 'the wheel');
    const wheelBox = await waitForBox('as-wheel', wheelSize, 'the wheel');
    console.log(
      `policies (${Platform.OS}): menu=${describeSize(menuSize)} box=${describeSize(sizeOf('as-menu'))} ` +
        `| wheel=${describeSize(wheelSize)} box=${describeSize(wheelBox)}`
    );
    // A menu takes its own width, not the parent's.
    expect(menuSize.width).toBeLessThan(330 - 20);
    // A wheel fills the box: the width it reports is the box's.
    expect(Math.abs(wheelSize.width - 330)).toBeLessThan(1);
    expect(Math.abs(wheelBox.width - 330)).toBeLessThan(1);
    expect(sameSize(menuSize, wheelSize)).toBe(false);
    if (Platform.OS === 'ios') {
      // Only iOS has a wheel. Android renders the menu for both variants.
      expect(wheelSize.height).toBeGreaterThan(menuSize.height + 20);
    }
    unmount();
  });

  it('re-measures when the options change (R3)', async () => {
    // The first option differs too: a menu is as wide as the title it shows, not as
    // its list.
    const SHORT = ['Run'];
    const LONG = [LONG_TITLE, 'the', 'whole', 'build'];
    poisonConfigurations([
      sizingKey(SHORT, 0, null, 'menu'),
      sizingKey(LONG, 0, null, 'menu'),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Picker
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

    await rerender(
      <Picker options={LONG} testID="opts" hybridRef={captureHybrid('opts')} />
    );
    const longSize = await waitForRemeasure(
      'opts',
      shortSize,
      'the longer list'
    );
    await waitForBox('opts', longSize, 'the longer list');
    const warm = delta(before, stats());
    console.log(
      `options change: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} cold=${JSON.stringify(cold)} ` +
        `warm=${JSON.stringify(warm)}`
    );
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);
    expect(warm.cachedSizes - cold.cachedSizes).toBe(1);
    expect(warm.corrections - cold.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('re-reports a key change that keeps the size (R3)', async () => {
    // Both lists show the same title and so measure the same, but their sizing keys
    // differ. The native host skips a report equal to its last one, so the key change
    // itself has to reset that memory.
    const FIRST = ['Red', 'Blue'];
    const SECOND = ['Red', 'Blue', 'Green'];
    poisonConfigurations([
      sizingKey(FIRST, 0, null, 'menu'),
      sizingKey(SECOND, 0, null, 'menu'),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Picker
        options={FIRST}
        selectedIndex={0}
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
      <Picker
        options={SECOND}
        selectedIndex={0}
        testID="same"
        hybridRef={captureHybrid('same')}
      />
    );
    // A fixed wait: the size is expected not to change, so there is no state to wait on.
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

  it('re-measures when the selection moves to a longer title', async () => {
    const OPTIONS = [
      'Red',
      'Greenish blue',
      'A considerably longer colour name',
    ];
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="title"
        hybridRef={captureHybrid('title')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('title');
    const first = await waitForMeasured('title', 'the first title');
    await waitForBox('title', first, 'the first title');
    const before = stats();

    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        testID="title"
        hybridRef={captureHybrid('title')}
      />
    );
    const widest = await waitForRemeasure('title', first, 'the longest title');
    await waitForBox('title', widest, 'the longest title');
    const after = delta(before, stats());
    console.log(
      `selection change: first=${describeSize(first)} ` +
        `widest=${describeSize(widest)} delta=${JSON.stringify(after)}`
    );
    expect(widest.width).toBeGreaterThan(first.width + 20);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    expect(handles.get('title')?.selectedIndex).toBe(2);
    unmount();
  });

  it('corrects a planted size that matches the current box (iOS measure signal)', async () => {
    // On iOS a bounds change triggers a measure by itself. Here the next configuration is
    // seeded with the box the control is already in, so no bounds change happens and
    // only the component's own "content size may have changed" signal can correct it.
    const SHORT = ['Run'];
    const LONG = [LONG_TITLE, 'the', 'whole', 'build'];
    const { rerender, unmount } = await render(
      <Picker options={SHORT} testID="pin" hybridRef={captureHybrid('pin')} />,
      { timeout: 20000 }
    );
    await waitForTestId('pin');
    const shortSize = await waitForMeasured('pin', 'the one-option list');
    await waitForBox('pin', shortSize, 'the one-option list');

    nitroUiCore.seedSizingSize(
      COMPONENT,
      sizingKey(LONG, 0, null, 'menu'),
      shortSize.width,
      shortSize.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    await settle(200);
    const before = stats();

    await rerender(
      <Picker options={LONG} testID="pin" hybridRef={captureHybrid('pin')} />
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

  it('clamps a selection the caller sends out of range', async () => {
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={99}
          testID="past"
          hybridRef={captureHybrid('past')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={2}
          testID="honest"
          hybridRef={captureHybrid('honest')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={Number.NaN}
          testID="junk"
          hybridRef={captureHybrid('junk')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={-4}
          testID="first"
          hybridRef={captureHybrid('first')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('past');
    const pastSize = await waitForMeasured('past', 'index 99');
    await waitForBox('past', pastSize, 'index 99');
    const honestSize = await waitForMeasured('honest', 'index 2');
    await waitForBox('honest', honestSize, 'index 2');
    const junkSize = await waitForMeasured('junk', 'NaN');
    await waitForBox('junk', junkSize, 'NaN');
    const firstSize = await waitForMeasured('first', 'index -4');
    await waitForBox('first', firstSize, 'index -4');
    console.log(
      `clamps: 99=${describeSize(pastSize)} 2=${describeSize(honestSize)} ` +
        `NaN=${describeSize(junkSize)} -4=${describeSize(firstSize)}`
    );
    expect(handles.get('past')?.selectedIndex).toBe(2);
    expect(sameSize(pastSize, honestSize)).toBe(true);
    expect(handles.get('junk')?.selectedIndex).toBe(0);
    expect(handles.get('first')?.selectedIndex).toBe(0);
    expect(sameSize(junkSize, firstSize)).toBe(true);
    expect(sameSize(pastSize, firstSize)).toBe(false);
    unmount();
  });

  it('clamps an index written straight to native', async () => {
    // The JS wrapper clamps before React sends anything, so writing through the handle
    // is the only way to reach the native clamp.
    const { unmount } = await render(
      <Picker
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
    expect(raw.selectedIndex).toBe(null);

    raw.selectedIndex = 9;
    expect(handles.get('raw')?.selectedIndex).toBe(2);

    raw.selectedIndex = -3;
    expect(handles.get('raw')?.selectedIndex).toBe(0);

    expect(eventLog).toEqual([]);
    unmount();
  });

  it('clamps the selection and re-measures when the options shrink', async () => {
    const WIDE = ['Red', 'Green', 'Blue', LONG_TITLE];
    const NARROW = ['Red', 'Green'];
    const { rerender, unmount } = await render(
      <Picker
        options={WIDE}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('shrink');
    const wide = await waitForMeasured('shrink', 'four options');
    await waitForBox('shrink', wide, 'four options');
    const before = stats();

    await rerender(
      <Picker
        options={NARROW}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />
    );
    const narrow = await waitForRemeasure('shrink', wide, 'the shorter list');
    await waitForBox('shrink', narrow, 'the shorter list');
    const after = delta(before, stats());
    console.log(
      `shrink: wide=${describeSize(wide)} narrow=${describeSize(narrow)} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(handles.get('shrink')?.selectedIndex).toBe(1);
    expect(handles.get('shrink')?.options).toEqual(NARROW);
    expect(narrow.width).toBeLessThan(wide.width - 20);
    // iOS reports a size after SwiftUI commits, which costs a correction. Android's
    // shadow node is measured in the layout pass the new props land in, and can settle
    // without one. So the sum is asserted.
    expect(after.cachedSizes).toBeGreaterThanOrEqual(1);
    expect(after.measurements + after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('reads back what React sent', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={1}
          label="Size"
          tintColor="#c837ab"
          accessibilityLabel="Choose a size"
          testID="read-back"
          hybridRef={captureHybrid('read-back')}
        />
        <Picker
          options={OPTIONS}
          variant="wheel"
          disabled
          testID="read-back-wheel"
          hybridRef={captureHybrid('read-back-wheel')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('read-back');
    await waitForMeasured('read-back', 'the menu');
    await waitForMeasured('read-back-wheel', 'the wheel');
    const menu = handles.get('read-back');
    const wheel = handles.get('read-back-wheel');
    expect(menu).toBeDefined();
    expect(wheel).toBeDefined();
    console.log(
      `read back: variant=${String(menu?.variant)}/${String(wheel?.variant)} ` +
        `selected=${String(menu?.selectedIndex)} ` +
        `eventCount=${String(menu?.mostRecentEventCount)} ` +
        `label=${String(menu?.label)} tint=${String(menu?.tintColor)} ` +
        `disabled=${String(menu?.disabled)}/${String(wheel?.disabled)}`
    );
    expect(menu?.options).toEqual(OPTIONS);
    expect(menu?.selectedIndex).toBe(1);
    expect(menu?.mostRecentEventCount).toBe(0);
    expect(menu?.variant).toBe('menu');
    expect(menu?.label).toBe('Size');
    expect(menu?.accessibilityLabel).toBe('Choose a size');
    expect(menu?.disabled).toBe(false);
    // `processColor` turns a hex string into a number, and `undefined` into null.
    expect(typeof menu?.tintColor).toBe('number');
    expect(wheel?.variant).toBe('wheel');
    expect(wheel?.disabled).toBe(true);
    expect(wheel?.label).toBeNull();
    expect(wheel?.tintColor).toBeNull();
    unmount();
  });

  it('keeps a caller width in charge, and its own size in the cache', async () => {
    // The size cache must hold the control's own width, not the 240 the caller gave the
    // box: the same configuration mounted again with no width has to come back at its
    // intrinsic size.
    const OPTIONS = ['January', 'February', 'March'];
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        testID="fixed"
        style={{ width: 240 }}
        hybridRef={captureHybrid('fixed')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('fixed');
    const box = boxOf('fixed');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 240) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('fixed', 'three month titles');
    expect(intrinsic.width).not.toBeCloseTo(240, 0);
    await settle(300);

    await rerender(
      <Picker
        options={OPTIONS}
        testID="fixed"
        hybridRef={captureHybrid('fixed')}
      />
    );
    await settle(400);
    const after = sizeOf('fixed');
    console.log(
      `caller width: box=240 measured=${describeSize(intrinsic)} ` +
        `then no width: box=${describeSize(after)}`
    );
    expect(sameSize(after, intrinsic)).toBe(true);
    unmount();
  });

  it('fits an over-wide menu into the box the caller gave it', async () => {
    // The box is 180 wide and the title wants more. The control is drawn at the box's
    // width, but the size it reports stays its own intrinsic width.
    const OPTIONS = [LONG_TITLE, 'Red'];
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        testID="overwide"
        style={{ width: 180 }}
        hybridRef={captureHybrid('overwide')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('overwide');
    const box = boxOf('overwide');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 180) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('overwide', 'four month titles');
    console.log(
      `over-wide: box=${describeSize(box)} measured=${describeSize(intrinsic)}`
    );
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);
    unmount();
  });

  it('re-fits when the caller narrows the box under an over-wide menu', async () => {
    const OPTIONS = [LONG_TITLE, 'Red'];
    const row = (width: number) => (
      <View style={{ width }}>
        <Picker
          options={OPTIONS}
          testID="refit"
          hybridRef={captureHybrid('refit')}
        />
      </View>
    );
    // The width comes from the parent, as it does when a flex parent narrows on rotation.
    const { rerender, unmount } = await render(row(200), { timeout: 20000 });
    await waitForTestId('refit');
    const intrinsic = await waitForMeasured('refit', 'the long title');
    expect(intrinsic.width).toBeGreaterThan(200 + 20);
    const first = boxOf('refit');
    expect(first).not.toBeNull();
    expect(Math.abs(first!.width - 200) < 0.6).toBe(true);

    await rerender(row(168));
    await waitForBox(
      'refit',
      { width: 168, height: first!.height },
      'the narrower parent'
    );
    expect(intrinsic.width).toBeGreaterThan(168 + 20);
    expect(sameSize(measured('refit'), intrinsic)).toBe(true);

    await rerender(row(140));
    await waitForBox(
      'refit',
      { width: 140, height: first!.height },
      'the narrowest parent'
    );
    expect(sameSize(measured('refit'), intrinsic)).toBe(true);
    console.log(
      `refit: measured=${describeSize(intrinsic)} boxes=200/168/140 ` +
        `final=${describeSize(sizeOf('refit'))}`
    );
    unmount();
  });

  it('survives remounts with the size and seed of each mount', async () => {
    const FIRST = ['One', 'Two', 'Three'];
    const SECOND = ['A considerably longer colour name', 'Red'];
    const THIRD = ['Go'];
    const { rerender, unmount } = await render(
      <Picker
        options={FIRST}
        testID="remount"
        hybridRef={captureHybrid('remount')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('remount');
    const first = await waitForMeasured('remount', 'the first list');
    await waitForBox('remount', first, 'the first list');

    for (const [index, options] of [SECOND, THIRD, SECOND].entries()) {
      const handleId = `remount-${String(index)}`;
      rerender(<View key={`gap-${String(index)}`} />);
      await settle(150);
      await rerender(
        <Picker
          options={options}
          defaultSelectedIndex={index % 2}
          testID="remount"
          hybridRef={captureHybrid(handleId)}
        />
      );
      // The handle is captured per mount: `hybridRef` runs once per mount, and the old
      // handle belongs to a view that is gone.
      await waitForTestId('remount');
      const size = await waitForMeasured(handleId, `mount ${String(index)}`);
      await waitForBox('remount', size, `mount ${String(index)}`);
      expect(sameSize(size, WRONG_SIZE)).toBe(false);
      expect(handles.get(handleId)?.options).toEqual(options);
      console.log(
        `remount ${String(index)}: ${String(options.length)} options ` +
          `seed=${String(index % 2)} measured=${describeSize(size)}`
      );
    }
    const last = measured('remount-2');
    expect(last !== null && last.width > first.width + 20).toBe(true);
    unmount();
  });

  // MARK: - A pick must re-key the size it reports

  it('files a real pick under the key of the title the pick shows', async () => {
    // A native pick paints the new title a round trip before React sends the sizing key
    // that names it. A size measured in between would be filed under the old title's
    // key, which would cost a second correction here.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        onChange={recordChange('pick-key')}
        testID="pick-key"
        hybridRef={captureHybrid('pick-key')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('pick-key');
    const shortSize = await waitForMeasured('pick-key', 'the short title');
    await waitForBox('pick-key', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    await pickRow('pick-key', 2);
    expect(eventLog).toEqual(['pick-key:2']);
    // Let the control paint and measure the new title before React's props arrive, the
    // order an app's `onChange` then `setState` produces.
    await settle(200);
    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        onChange={recordChange('pick-key')}
        testID="pick-key"
        hybridRef={captureHybrid('pick-key')}
      />
    );
    const painted = await waitForRemeasure(
      'pick-key',
      shortSize,
      'the long title, painted by the pick'
    );
    expect(painted.width).toBeGreaterThan(shortSize.width + 20);
    const widest = sizeOf('pick-key');
    await waitForBox('pick-key', painted, 'the long title');
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `pick re-keys: short=${describeSize(shortSize)} ` +
        `long=${describeSize(painted)} box=${describeSize(widest)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)} events=${JSON.stringify(eventLog)}`
    );
    expect(eventLog).toEqual(['pick-key:2']);
    expect(after.corrections).toBe(1);
    // No frame was laid out at the declared fallback.
    expect(laidOut.some((size) => sameSize(size, DECLARED_FALLBACK))).toBe(
      false
    );
    expect(sameSize(sizeOf('pick-key'), painted)).toBe(true);
    unmount();
  });

  it('leaves the width of each title in the cache after a pick', async () => {
    // Reads the process-wide size cache back by mounting a fresh picker in the
    // configuration the pick started from: it is warm, so it must cost no correction.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const first = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="poison"
        hybridRef={captureHybrid('poison')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('poison');
    const shortSize = await waitForMeasured('poison', 'the short title');
    await waitForBox('poison', shortSize, 'the short title');
    await settle(200);

    await pickRow('poison', 2);
    await settle(200);
    await first.rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        testID="poison"
        hybridRef={captureHybrid('poison')}
      />
    );
    const longSize = await waitForRemeasure(
      'poison',
      shortSize,
      'the long title, painted by the pick'
    );
    await waitForBox('poison', longSize, 'the long title');
    first.unmount();
    handles.delete('poison');
    await settle(300);

    armTrace();
    const before = stats();
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="again"
        hybridRef={captureHybrid('again')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('again');
    await settle(400);
    const box = sizeOf('again');
    const measuredAgain = measured('again');
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `cache after a pick: startedAt=${describeSize(shortSize)} ` +
        `picked=${describeSize(longSize)} freshMountBox=${describeSize(box)} ` +
        `measured=${describeSize(measuredAgain)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(sameSize(box, shortSize)).toBe(true);
    expect(sameSize(box, measuredAgain)).toBe(true);
    expect(after.corrections).toBe(0);
    expect(laidOut.every((size) => sameSize(size, shortSize))).toBe(true);
    unmount();
  });

  it('re-keys the size of an uncontrolled pick, with no render to ask for it', async () => {
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChange('unc')}
        testID="unc"
        hybridRef={captureHybrid('unc')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('unc');
    const shortSize = await waitForMeasured('unc', 'the short title');
    await waitForBox('unc', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    await pickRow('unc', 2);
    expect(eventLog).toEqual(['unc:2']);
    // Still uncontrolled: JS sends no index, but the sizing key it sends has to name the
    // title now on screen.
    expect(handles.get('unc')?.selectedIndex).toBe(null);
    const sentKey = (handles.get('unc') as unknown as { nuiSizingKey?: string })
      ?.nuiSizingKey;
    expect(sentKey).toBe(sizingKey(OPTIONS, 2, null, 'menu'));
    const longSize = await waitForRemeasure(
      'unc',
      shortSize,
      'the long title, chosen without a render'
    );
    await waitForBox('unc', longSize, 'the long title');
    await settle(300);
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `uncontrolled pick: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)} events=${JSON.stringify(eventLog)}`
    );
    expect(after.corrections).toBe(1);
    expect(laidOut.some((size) => sameSize(size, DECLARED_FALLBACK))).toBe(
      false
    );
    unmount();
    handles.delete('unc');
    await settle(300);

    // The cache entry of the title the pick replaced must still hold that title's
    // width: a fresh mount showing it costs no correction.
    armTrace();
    const cacheBefore = stats();
    const second = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="unc-again"
        hybridRef={captureHybrid('unc-again')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('unc-again');
    await settle(400);
    const boxAgain = sizeOf('unc-again');
    const measuredAgain = measured('unc-again');
    const cacheAfter = delta(cacheBefore, stats());
    const laidOutAgain = laidOutSizes();
    console.log(
      `uncontrolled cache: freshMountBox=${describeSize(boxAgain)} ` +
        `measured=${describeSize(measuredAgain)} ` +
        `laidOut=${laidOutAgain.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(cacheAfter)}`
    );
    expect(sameSize(boxAgain, shortSize)).toBe(true);
    expect(sameSize(boxAgain, measuredAgain)).toBe(true);
    expect(cacheAfter.corrections).toBe(0);
    expect(laidOutAgain.every((size) => sameSize(size, shortSize))).toBe(true);
    second.unmount();
  });

  it("holds a pick's report until the batch that names the title", async () => {
    // The `onChange` blocks JS, so the control paints and lays out its new title before
    // the props that re-key it arrive. The host must hold its size report until then.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChangeThenBlock('slow-echo')}
        testID="slow-echo"
        hybridRef={captureHybrid('slow-echo')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('slow-echo');
    const shortSize = await waitForMeasured('slow-echo', 'the short title');
    await waitForBox('slow-echo', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    await pickRow('slow-echo', 2);
    expect(eventLog).toEqual(['slow-echo:2']);
    const longSize = await waitForRemeasure(
      'slow-echo',
      shortSize,
      'the long title, chosen behind a busy JS thread'
    );
    await waitForBox('slow-echo', longSize, 'the long title');
    await settle(300);
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `busy-echo pick: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)}`
    );
    // The first box drawn after the pick is the new key's seeded size.
    expect(after.corrections).toBe(1);
    expect(sameSize(laidOut[0] ?? null, WRONG_SIZE)).toBe(true);
    expect(laidOut.some((size) => sameSize(size, DECLARED_FALLBACK))).toBe(
      false
    );
    expect(sameSize(sizeOf('slow-echo'), longSize)).toBe(true);
    unmount();
  });

  // MARK: - A batch that names a key the pick has left

  // Two quick picks: the render the first one causes reaches native after the second
  // pick, so that batch names the title the first pick painted while native shows the
  // second one's. Its size report must not be filed under a key the pick has left.
  async function filesNothingUnderALeftKey(controlled: boolean): Promise<void> {
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const spin = (ms: number) => {
      const until = nitroUiCore.now() + ms;
      while (nitroUiCore.now() < until) {
        // Deliberately busy: JS cannot render between the two picks.
      }
    };

    function TwoQuickPicks() {
      const [picks, setPicks] = useState(0);
      const [index, setIndex] = useState(0);
      const pickedAgain = useRef(false);
      const onChange = useCallback((event: { index: number }) => {
        eventLog.push(`twice:${String(event.index)}`);
        if (controlled) {
          setIndex(event.index);
        }
        spin(150);
        setPicks((count) => count + 1);
      }, []);
      if (picks === 1 && !pickedAgain.current) {
        // Posted from the render the first pick caused: the second pick is on screen
        // before that render's props are.
        pickedAgain.current = true;
        handles.get('twice')?.nuiTestSelect(0);
        spin(150);
      }
      return (
        <Picker
          options={OPTIONS}
          selectedIndex={controlled ? index : undefined}
          onChange={onChange}
          testID="twice"
          hybridRef={captureHybrid('twice')}
        />
      );
    }

    // The long configuration, measured by a picker that never picks - then gone, so
    // nothing mounted under that key can re-report its size after the picks.
    const { rerender } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={2}
          testID="reference"
          hybridRef={captureHybrid('reference')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('reference');
    const longSize = await waitForMeasured('reference', 'the long title');
    await waitForBox('reference', longSize, 'the long title');
    await rerender(
      <View style={columnStyle}>
        <TwoQuickPicks />
      </View>
    );
    await waitForTestId('twice');
    const shortSize = await waitForMeasured('twice', 'before the picks');
    await waitForBox('twice', shortSize, 'before the picks');
    await settle(250);
    armTrace();
    const before = stats();

    handles.get('twice')?.nuiTestSelect(2);
    await pollUntil(
      () => (eventLog.length >= 2 ? true : null),
      () => new Error(`two quick picks emitted ${JSON.stringify(eventLog)}.`),
      8000
    );
    await waitForBox(
      'twice',
      shortSize,
      "the picker, on its second pick's title"
    );
    await settle(400);
    const afterPicks = delta(before, stats());

    // Read the cache of the key the first pick's render carried back: a fresh picker
    // showing that title must find that title's own width there.
    armTrace();
    const cacheBefore = stats();
    await rerender(
      <View style={columnStyle}>
        <TwoQuickPicks />
        <Picker
          options={OPTIONS}
          selectedIndex={2}
          testID="fresh-long"
          hybridRef={captureHybrid('fresh-long')}
        />
      </View>
    );
    await waitForTestId('fresh-long');
    const firstBox = sizeOf('fresh-long');
    const fresh = await waitForMeasured('fresh-long', 'the long title again');
    await waitForBox('fresh-long', longSize, 'the fresh long picker');
    await settle(250);
    const cacheAfter = delta(cacheBefore, stats());
    console.log(
      `quick picks (${controlled ? 'controlled' : 'uncontrolled'}): ` +
        `short=${describeSize(shortSize)} long=${describeSize(longSize)} ` +
        `picksDelta=${JSON.stringify(afterPicks)} ` +
        `freshFirstBox=${describeSize(firstBox)} measured=${describeSize(fresh)} ` +
        `cacheDelta=${JSON.stringify(cacheAfter)} events=${JSON.stringify(eventLog)}`
    );
    expect(eventLog).toEqual(['twice:2', 'twice:0']);
    // The picker itself is sized for the title its second pick shows.
    expect(sameSize(sizeOf('twice'), shortSize)).toBe(true);
    expect(afterPicks.corrections).toBe(0);
    expect(sameSize(fresh, longSize)).toBe(true);
    expect(sameSize(firstBox, longSize)).toBe(true);
    expect(cacheAfter.corrections).toBe(0);
    // Otherwise the two keys hold the same width and the case could not fail.
    expect(longSize.width).toBeGreaterThan(shortSize.width + 8);
  }

  // Only Android's host holds a pick's size report until a batch can name what is on screen.
  // iOS files a measured size as soon as it is measured, so which key it lands under there is
  // decided by a path this case cannot speak for.
  const itHoldsPicks = Platform.OS === 'android' ? it : it.skip;

  itHoldsPicks(
    'files nothing under a key two uncontrolled picks have left',
    async () => {
      await filesNothingUnderALeftKey(false);
    }
  );

  itHoldsPicks(
    'files nothing under a key two controlled picks have left',
    async () => {
      await filesNothingUnderALeftKey(true);
    }
  );

  it('grows an unpoisoned pick whose new configuration starts at the fallback', async () => {
    // Nothing is seeded here: a cold key answers with the declared fallback, which can
    // equal the box the control is already in, so no box change prompts the next
    // measure.
    const OPTIONS = ['Onyx', 'Quartz', 'A considerably longer mineral name'];
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChange('plain-unc')}
        testID="plain-unc"
        hybridRef={captureHybrid('plain-unc')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('plain-unc');
    const shortSize = await waitForMeasured('plain-unc', 'the short title');
    await waitForBox('plain-unc', shortSize, 'the short title');
    await settle(200);
    const before = stats();

    await pickRow('plain-unc', 2);
    expect(eventLog).toEqual(['plain-unc:2']);
    const longSize = await waitForRemeasure(
      'plain-unc',
      shortSize,
      'the longer title the pick painted'
    );
    expect(longSize.width).toBeGreaterThan(shortSize.width + 20);
    await waitForBox(
      'plain-unc',
      longSize,
      'the box following the picked title'
    );
    const after = delta(before, stats());
    console.log(
      `unpoisoned pick: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} box=${describeSize(sizeOf('plain-unc'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(sameSize(sizeOf('plain-unc'), longSize)).toBe(true);
    unmount();
  });

  it('goes on reporting its size after a re-tap of the row already shown', async () => {
    const SHORT = ['One', 'Two', 'Three'];
    const LONG = [LONG_TITLE, 'Two', 'Three'];
    poisonConfigurations([
      sizingKey(SHORT, 0, null, 'menu'),
      sizingKey(LONG, 0, null, 'menu'),
    ]);
    const { rerender, unmount } = await render(
      <Picker
        options={SHORT}
        onChange={recordChange('re-tap')}
        testID="re-tap"
        hybridRef={captureHybrid('re-tap')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('re-tap');
    const shortSize = await waitForMeasured('re-tap', 'the short title');
    await waitForBox('re-tap', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    // Pressing the row already shown emits nothing, so no props follow it.
    await pickRow('re-tap', 0);
    expect(eventLog).toEqual([]);
    expect(sameSize(sizeOf('re-tap'), shortSize)).toBe(true);

    await rerender(
      <Picker
        options={LONG}
        onChange={recordChange('re-tap')}
        testID="re-tap"
        hybridRef={captureHybrid('re-tap')}
      />
    );
    const longSize = await waitForRemeasure(
      're-tap',
      shortSize,
      'the long title the new options brought'
    );
    await waitForBox('re-tap', longSize, 'the box following the new title');
    await settle(300);
    const after = delta(before, stats());
    console.log(
      `re-tap then resize: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} box=${describeSize(sizeOf('re-tap'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(after.corrections).toBeGreaterThan(0);
    expect(sameSize(sizeOf('re-tap'), longSize)).toBe(true);
    unmount();
  });

  // MARK: - A variant change is a different control, not a repaint

  it('asks a wheel the box question after a variant change', async () => {
    // On Android the composition fixes whether its content is measured unbounded when
    // it is built, so a variant change has to remount the native view.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const BOX = { width: 330, height: 60 };
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        variant="menu"
        testID="var-w"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-w')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('var-w');
    const asMenu = await waitForMeasured('var-w', 'a menu of the short title');
    expect(Math.abs(boxOf('var-w')!.width - BOX.width) < 0.6).toBe(true);
    expect(asMenu.width).not.toBeCloseTo(BOX.width, 0);
    await settle(200);

    const staleWheel = asMenu;
    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        variant="wheel"
        testID="var-w"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-w')}
      />
    );
    const asWheel = await waitForFreshMeasure(
      'var-w',
      staleWheel,
      'the wheel after the remount'
    );
    await settle(300);
    console.log(
      `variant menu->wheel: menu=${describeSize(asMenu)} ` +
        `wheel=${describeSize(asWheel)} box=${describeSize(boxOf('var-w'))}`
    );
    expect(Math.abs(asWheel.width - BOX.width) < 1).toBe(true);
    unmount();
  });

  it('asks a menu the unbounded question after a variant change', async () => {
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const BOX = { width: 330, height: 60 };
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        variant="wheel"
        testID="var-m"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-m')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('var-m');
    const asWheel = await waitForMeasured('var-m', 'a wheel of the long title');
    expect(Math.abs(asWheel.width - BOX.width) < 1).toBe(true);
    await settle(200);

    const staleMenu = asWheel;
    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        variant="menu"
        testID="var-m"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-m')}
      />
    );
    const asMenu = await waitForFreshMeasure(
      'var-m',
      staleMenu,
      'the menu after the remount'
    );
    await settle(300);
    console.log(
      `variant wheel->menu: wheel=${describeSize(asWheel)} ` +
        `menu=${describeSize(asMenu)} box=${describeSize(boxOf('var-m'))}`
    );
    // The menu reports the title's own width, wider than the box it sits in.
    expect(asMenu.width).toBeGreaterThan(BOX.width + 1);
    unmount();
  });

  it('draws the selected row as a selected row (E2)', async () => {
    await render(
      <Picker
        options={['Small', 'Medium', 'Large']}
        defaultSelectedIndex={1}
        onChange={recordChange('selected-row')}
        testID="selected-row"
        hybridRef={captureHybrid('selected-row')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('selected-row');
    await pollUntil(
      () => handles.get('selected-row') ?? null,
      () => new Error('"selected-row" never handed back a hybrid handle.')
    );
    // Nothing is drawn before the popup opens, and iOS has no popup of its own to read.
    expect(drawnOf('selected-row')).toBe('-1');
    if (Platform.OS !== 'android') {
      return;
    }
    // The report marks the row the popup's semantics tree says is selected with `+`.
    await pressAnchor('selected-row');
    const opened = await pollUntil(
      () => {
        const drawn = drawnOf('selected-row');
        return drawn === '-1' ? null : drawn;
      },
      () => new Error('The open picker never reported its rows.')
    );
    console.log(`selected row: drawn=${opened}`);
    expect(opened).toBe('Small,Medium+,Large');
    await pickRow('selected-row', 2);
    await waitForMeasured('selected-row', 'after the pick');
    await settle(300);
    await pressAnchor('selected-row');
    const moved = await pollUntil(
      () => {
        const drawn = drawnOf('selected-row');
        return drawn !== opened && drawn !== '-1' ? drawn : null;
      },
      () =>
        new Error(
          `The reopened picker still reports ${drawnOf('selected-row')}.`
        )
    );
    expect(moved).toBe('Small,Medium,Large+');
    expect(eventLog).toEqual(['selected-row:2']);
    await pickRow('selected-row', 2);
  });

  it('does not treat opening as a choice, and the next mount sizes normally after going away mid-menu', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChange('press-me')}
        testID="press-me"
        hybridRef={captureHybrid('press-me')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('press-me');
    const size = await waitForMeasured('press-me', 'three options');
    await waitForBox('press-me', size, 'three options');

    await pressAnchor('press-me');
    await settle(400);
    expect(eventLog).toEqual([]);
    expect(handles.get('press-me')?.mostRecentEventCount).toBe(0);
    expect(sameSize(sizeOf('press-me'), size)).toBe(true);

    // Drop the screen with the list open, and mount a different one.
    rerender(<View testID="after-drop" style={{ height: 40 }} />);
    await settle(300);
    const { unmount: unmountSecond } = await render(
      <Picker
        options={['After the drop']}
        testID="after-drop"
        hybridRef={captureHybrid('after-drop')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('after-drop');
    const afterSize = await waitForMeasured('after-drop', 'one option');
    await waitForBox('after-drop', afterSize, 'one option');
    expect(sameSize(afterSize, WRONG_SIZE)).toBe(false);
    console.log(
      `open-then-drop: menu=${describeSize(size)} after=${describeSize(afterSize)} ` +
        `events=${JSON.stringify(eventLog)}`
    );
    unmountSecond();
    unmount();
  });
});

// `variant="radio"`: on Android a radio group draws every option as a row in the
// app's own window, so its box depends on the options and not on the selection
// or the label. iOS has no radio style and renders the menu.

// Must match the sizing key `Picker.tsx` builds for the `radio` variant.
function radioSizingKey(
  options: readonly string[],
  selectedIndex: number,
  label: string | null = null
): string {
  if (Platform.OS !== 'android') {
    return sizingKey(options, selectedIndex, label, 'menu');
  }
  const escape = (value: string) => value.replace(/[\\|]/g, '\\$&');
  return ['radio', String(options.length), ...options.map(escape)].join('|');
}

// Material 3's minimum touch target, which is the height of one radio row.
const ROW_DP = 48;

describe('Picker · radio variant (G26)', () => {
  it('measures a radio group as its option count, one row per option', async () => {
    if (Platform.OS !== 'android') {
      console.log('radio geometry: Android only - iOS renders the menu');
      return;
    }
    const THREE = ['Small', 'Medium', 'Large'];
    const FIVE = ['One', 'Two', 'Three', 'Four', 'Five'];
    poisonConfigurations([radioSizingKey(THREE, 0), radioSizingKey(FIVE, 0)]);
    const before = stats();
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={THREE}
          variant="radio"
          testID="radio-three"
          hybridRef={captureHybrid('radio-three')}
        />
        <Picker
          options={FIVE}
          variant="radio"
          testID="radio-five"
          hybridRef={captureHybrid('radio-five')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('radio-three');
    const three = await waitForMeasured('radio-three', 'three rows');
    await waitForBox('radio-three', three, 'three rows');
    const five = await waitForMeasured('radio-five', 'five rows');
    await waitForBox('radio-five', five, 'five rows');
    console.log(
      `radio rows: three=${describeSize(three)} five=${describeSize(five)} ` +
        `cold=${JSON.stringify(delta(before, stats()))}`
    );
    expect(Math.abs(three.height - 3 * ROW_DP)).toBeLessThanOrEqual(1);
    expect(Math.abs(five.height - 5 * ROW_DP)).toBeLessThanOrEqual(1);
    expect(three.width).toBeGreaterThan(80);
    for (const testId of ['radio-three', 'radio-five']) {
      expect(sameSize(sizeOf(testId), WRONG_SIZE)).toBe(false);
    }
    const cold = delta(before, stats());
    expect(cold.corrections).toBeGreaterThanOrEqual(2);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('costs no correction when a pick moves the selection', async () => {
    if (Platform.OS !== 'android') {
      return;
    }
    const OPTIONS = ['Small', 'Medium', 'Large'];
    poisonConfigurations([radioSizingKey(OPTIONS, 0)]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="radio"
        onChange={recordChange('radio-warm')}
        testID="radio-warm"
        hybridRef={captureHybrid('radio-warm')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('radio-warm');
    const first = await waitForMeasured('radio-warm', 'the warm group');
    await waitForBox('radio-warm', first, 'the warm group');
    await settle(300);
    eventLog.length = 0;
    const warm = stats();
    await pickRow('radio-warm', 2);
    await settle(500);
    const after = delta(warm, stats());
    console.log(
      `radio pick: ${describeSize(first)} -> ${describeSize(
        measured('radio-warm')
      )} pick=${JSON.stringify(after)} events=${JSON.stringify(eventLog)}`
    );
    expect(eventLog).toEqual(['radio-warm:2']);
    // `mostRecentEventCount` is what JS sent. A pick is echoed whatever the variant,
    // because native holds a pick's size report until every pick is confirmed.
    expect(handles.get('radio-warm')?.mostRecentEventCount).toBe(1);
    expect(after.corrections).toBe(0);
    expect(after.cachedSizes).toBe(0);
    expect(sameSize(sizeOf('radio-warm'), first)).toBe(true);
    unmount();
  });

  it('costs no correction when the group is renamed', async () => {
    // On Android a radio group's `label` is its accessibility name and is not drawn.
    if (Platform.OS !== 'android') {
      return;
    }
    const OPTIONS = ['Small', 'Medium', 'Large'];
    poisonConfigurations([radioSizingKey(OPTIONS, 0, 'First')]);
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="radio"
        label="First"
        onChange={recordChange('radio-lbl')}
        testID="radio-lbl"
        hybridRef={captureHybrid('radio-lbl')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('radio-lbl');
    const first = await waitForMeasured('radio-lbl', 'the warm group');
    await waitForBox('radio-lbl', first, 'the warm group');
    await settle(300);
    const warm = stats();
    eventLog.length = 0;
    await rerender(
      <Picker
        options={OPTIONS}
        variant="radio"
        label="Renamed"
        onChange={recordChange('radio-lbl')}
        testID="radio-lbl"
        hybridRef={captureHybrid('radio-lbl')}
      />
    );
    await settle(500);
    const after = delta(warm, stats());
    console.log(
      `radio rename: ${describeSize(first)} -> ${describeSize(
        measured('radio-lbl')
      )} after=${JSON.stringify(after)} events=${JSON.stringify(eventLog)}`
    );
    expect(handles.get('radio-lbl')?.label).toBe('Renamed');
    expect(after.corrections).toBe(0);
    expect(after.cachedSizes).toBe(0);
    expect(eventLog).toEqual([]);
    expect(sameSize(sizeOf('radio-lbl'), first)).toBe(true);
    unmount();
  });

  it('picks a row through the selection path and rolls back a refused one', async () => {
    if (Platform.OS !== 'android') {
      console.log(
        'radio selection path: Android only - iOS picks a menu, and a menu resizes'
      );
      return;
    }
    // The second group's parent keeps sending 0. A second pick of the same row only
    // reports again if the refused first pick was rolled back.
    const OPTIONS = ['Red', 'Green', 'Blue'];
    poisonConfigurations([radioSizingKey(OPTIONS, 0)]);
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          variant="radio"
          onChange={recordChange('radio-pick')}
          testID="radio-pick"
          hybridRef={captureHybrid('radio-pick')}
        />
        <Picker
          options={OPTIONS}
          variant="radio"
          selectedIndex={0}
          onChange={recordChange('radio-refuse')}
          testID="radio-refuse"
          hybridRef={captureHybrid('radio-refuse')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('radio-pick');
    const picked = await waitForMeasured('radio-pick', 'uncontrolled group');
    await waitForBox('radio-pick', picked, 'uncontrolled group');
    await waitForMeasured('radio-refuse', 'controlled group');

    await pickRow('radio-pick', 2);
    expect(eventLog).toEqual(['radio-pick:2']);
    expect(sameSize(sizeOf('radio-pick'), picked)).toBe(true);

    eventLog.length = 0;
    await pickRow('radio-refuse', 2);
    expect(eventLog).toEqual(['radio-refuse:2']);
    await settle(300);
    await pickRow('radio-refuse', 2);
    expect(eventLog).toEqual(['radio-refuse:2', 'radio-refuse:2']);
    expect(handles.get('radio-refuse')?.selectedIndex).toBe(0);
    unmount();
  });

  it('reports nothing for the row already chosen, or for a disabled group', async () => {
    const OPTIONS = ['Red', 'Green', 'Blue'];
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          variant="radio"
          defaultSelectedIndex={0}
          onChange={recordChange('radio-noop')}
          testID="radio-noop"
          hybridRef={captureHybrid('radio-noop')}
        />
        <Picker
          options={OPTIONS}
          variant="radio"
          disabled
          onChange={recordChange('radio-disabled')}
          testID="radio-disabled"
          hybridRef={captureHybrid('radio-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('radio-noop');
    await waitForMeasured('radio-noop', 'the group');
    await waitForMeasured('radio-disabled', 'the disabled group');

    await pickRow('radio-noop', 0);
    await pickRow('radio-disabled', 1);
    await settle(300);
    console.log(`radio silence: events=${JSON.stringify(eventLog)}`);
    expect(eventLog).toEqual([]);
    await pickRow('radio-disabled', 2);
    await settle(200);
    expect(eventLog).toEqual([]);
    // A real choice on the same control, to show the log was recording.
    await pickRow('radio-noop', 1);
    await settle(200);
    console.log(`radio barrier: events=${JSON.stringify(eventLog)}`);
    expect(eventLog).toEqual(['radio-noop:1']);
    unmount();
  });

  it('answers menu on the platform with no radio group to render', async () => {
    // SwiftUI has no radio group picker style, so on iOS the variant renders the menu.
    const OPTIONS = ['One', 'Two', 'Three'];
    poisonConfigurations([radioSizingKey(OPTIONS, 0)]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="radio"
        testID="radio-platform"
        hybridRef={captureHybrid('radio-platform')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('radio-platform');
    const size = await waitForMeasured('radio-platform', 'variant="radio"');
    await waitForBox('radio-platform', size, 'variant="radio"');
    const reported = handles.get('radio-platform')?.variant;
    console.log(
      `radio platform: variant=${String(reported)} ${describeSize(size)}`
    );
    expect(reported).toBe(Platform.OS === 'android' ? 'radio' : 'menu');
    if (Platform.OS === 'android') {
      expect(Math.abs(size.height - 3 * ROW_DP)).toBeLessThanOrEqual(1);
    } else {
      // A menu is about 35 pt tall; a wheel would be 216.
      expect(size.height).toBeLessThan(60);
      expect(size.width).toBeGreaterThan(40);
    }
    unmount();
  });

  it('goes back to a menu when the variant changes, with no leftovers', async () => {
    // On Android the variant change remounts the native view. On iOS both variants are
    // the menu, so nothing may remount: a remount would re-seed the selection and
    // shrink the box back to the first title.
    const OPTIONS = ['Small', 'Medium', 'Large'];
    poisonConfigurations([radioSizingKey(OPTIONS, 0)]);
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="radio"
        onChange={recordChange('radio-switch')}
        testID="radio-switch"
        hybridRef={captureHybrid('radio-switch')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('radio-switch');
    const asGroup = await waitForMeasured('radio-switch', 'the group');
    await waitForBox('radio-switch', asGroup, 'the group');
    await pickRow('radio-switch', 2);
    eventLog.length = 0;
    // On iOS the pick moved the menu's title and with it the box, so the reference size
    // is the one after the pick.
    const beforeChange =
      Platform.OS === 'android'
        ? asGroup
        : await waitForRemeasure(
            'radio-switch',
            asGroup,
            'the picked title in the menu'
          );

    await rerender(
      <Picker
        options={OPTIONS}
        variant="menu"
        onChange={recordChange('radio-switch')}
        testID="radio-switch"
        hybridRef={captureHybrid('radio-switch')}
      />
    );
    if (Platform.OS !== 'android') {
      const same = await waitForMeasured('radio-switch', 'the same menu');
      await settle(300);
      console.log(
        `radio->menu (ios): ${describeSize(beforeChange)} -> ` +
          `${describeSize(same)} events=${JSON.stringify(eventLog)}`
      );
      expect(sameSize(same, beforeChange)).toBe(true);
      expect(handles.get('radio-switch')?.variant).toBe('menu');
      expect(eventLog).toEqual([]);
      unmount();
      return;
    }

    const asMenu = await waitForFreshMeasure(
      'radio-switch',
      asGroup,
      'the menu after the variant change'
    );
    await settle(300);
    console.log(
      `radio->menu (android): group=${describeSize(asGroup)} ` +
        `menu=${describeSize(asMenu)} events=${JSON.stringify(eventLog)}`
    );
    // A Material text field: 56 dp tall at its 280 dp minimum width.
    expect(Math.abs(asMenu.height - 56) < 1).toBe(true);
    expect(Math.abs(asMenu.width - 280) < 1).toBe(true);
    expect(sameSize(sizeOf('radio-switch'), asMenu)).toBe(true);
    expect(handles.get('radio-switch')?.variant).toBe('menu');
    expect(eventLog).toEqual([]);
    expect(drawnOf('radio-switch')).toBe('-1');
    unmount();
  });
});

// The Android `wheel` variant is Material 3's `ScrollField`. A wheel's pick is a
// scroll that comes to rest, and the row under the centre line changes many
// times on the way, so these tests wait for the rest and count events.

// Must match `ScrollFieldDefaults.ScrollFieldHeight`.
const WHEEL_DP = 200;

// The wheel fields of Android's `nuiTestMenuReport`: how many props batches
// reached the wheel, whether any landed while it was touched or turning, how many
// moved it (`seats`), how many tried and were refused, and the row it stands on
// (-1 before its first rest).
type WheelWitness = {
  batches: number;
  sawRolling: boolean;
  seats: number;
  refusals: number;
  row: number;
};

function wheelWitness(testId: string): WheelWitness {
  const line = handles.get(testId)?.nuiTestMenuReport() ?? '';
  const field = (name: string): string => {
    const found = line.split(';').find((part) => part.startsWith(`${name}=`));
    if (found == null) {
      throw new Error(`No "${name}" in the wheel witness "${line}".`);
    }
    return found.slice(name.length + 1);
  };
  return {
    batches: Number(field('batches')),
    sawRolling: field('sawRolling') === '1',
    seats: Number(field('seats')),
    refusals: Number(field('refusals')),
    row: Number(field('row')),
  };
}

// Rolls the wheel to `index`, waits for the first event (the animated scroll's
// length is the device's to choose), then for a quiet period so that a second
// event would be seen.
async function rollWheel(
  testId: string,
  index: number,
  expectEvent: boolean
): Promise<void> {
  const handle = handles.get(testId);
  expect(handle).not.toBeNull();
  const before = eventLog.length;
  handle?.nuiTestSelect(index);
  if (expectEvent) {
    await pollUntil(
      () => (eventLog.length > before ? true : null),
      () =>
        new Error(
          `"${testId}" never reported a choice after being rolled to row ${String(
            index
          )} - the log still holds ${JSON.stringify(eventLog)}.`
        ),
      10000
    );
  }
  // The quiet period, longer than the animation.
  await settle(600);
}

describe('Picker · wheel variant (G29)', () => {
  it('measures the drum from a poisoned fallback, at the box width', async () => {
    if (Platform.OS !== 'android') {
      console.log(
        'wheel geometry: Android-only case - iOS has had a wheel all along'
      );
      return;
    }
    const OPTIONS = ['Small', 'Medium', 'Large', 'Extra large'];
    poisonConfigurations([sizingKey(OPTIONS, 0, null, 'wheel')]);
    const before = stats();
    const BOX_WIDTH = 300;
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="wheel"
        testID="wheel-size"
        hybridRef={captureHybrid('wheel-size')}
        style={{ width: BOX_WIDTH }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-size');
    const size = await waitForMeasured('wheel-size', 'the drum');
    await waitForBox('wheel-size', size, 'the drum');
    const cold = delta(before, stats());
    console.log(
      `wheel box: ${describeSize(size)} in a ${String(BOX_WIDTH)} dp box ` +
        `cold=${JSON.stringify(cold)}`
    );
    expect(sameSize(sizeOf('wheel-size'), WRONG_SIZE)).toBe(false);
    expect(Math.abs(size.height - WHEEL_DP)).toBeLessThanOrEqual(1);
    // The wheel has no width of its own: it takes the box's.
    expect(Math.abs(size.width - BOX_WIDTH)).toBeLessThanOrEqual(1);
    expect(cold.corrections).toBeGreaterThanOrEqual(1);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('reports one event for a roll that passed several rows', async () => {
    // Rolling from row 0 to row 4 passes rows 1, 2 and 3, and
    // `ScrollFieldState.selectedOption` names each of them on the way.
    const OPTIONS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    poisonConfigurations([sizingKey(OPTIONS, 0, null, 'wheel')]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="wheel"
        onChange={recordChange('wheel-roll')}
        testID="wheel-roll"
        hybridRef={captureHybrid('wheel-roll')}
        style={{ width: 280 }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-roll');
    await waitForMeasured('wheel-roll', 'the drum');
    expect(eventLog).toEqual([]);

    await rollWheel('wheel-roll', 4, true);
    console.log(`wheel roll 0->4: events=${JSON.stringify(eventLog)}`);
    expect(eventLog).toEqual(['wheel-roll:4']);
    expect(handles.get('wheel-roll')?.selectedIndex).toBe(null);
    const settled = handles.get('wheel-roll');
    expect(settled).not.toBeUndefined();
    unmount();
  });

  it('rolls a refused pick back, and reports the next roll of it again', async () => {
    // The parent keeps sending 0, so the wheel has to scroll back to row 0. Left on row
    // 4, the second roll would ask for the row already shown and report nothing.
    const OPTIONS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    poisonConfigurations([sizingKey(OPTIONS, 0, null, 'wheel')]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="wheel"
        selectedIndex={0}
        onChange={recordChange('wheel-refuse')}
        testID="wheel-refuse"
        hybridRef={captureHybrid('wheel-refuse')}
        style={{ width: 280 }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-refuse');
    await waitForMeasured('wheel-refuse', 'the drum');

    await rollWheel('wheel-refuse', 4, true);
    expect(eventLog).toEqual(['wheel-refuse:4']);
    expect(handles.get('wheel-refuse')?.selectedIndex).toBe(0);
    await settle(300);
    // Only Android's report has the wheel fields.
    if (Platform.OS === 'android') {
      const home = wheelWitness('wheel-refuse');
      console.log(`wheel refused, drum home: witness=${JSON.stringify(home)}`);
      expect(home.row).toBe(0);
      expect(home.seats).toBe(1);
    }

    await rollWheel('wheel-refuse', 4, true);
    console.log(`wheel refused twice: events=${JSON.stringify(eventLog)}`);
    expect(eventLog).toEqual(['wheel-refuse:4', 'wheel-refuse:4']);
    unmount();
  });

  it('leaves a roll in flight alone when an unrelated prop changes', async () => {
    // Writing the wheel's page stops a scroll in progress, and a roll that never comes to
    // rest reports nothing. So a props batch that does not change the selection (here a
    // renamed `label`) must not write the page.
    if (Platform.OS !== 'android') {
      console.log(
        'mid-roll batch: Android case - the drum write is Android-only'
      );
      return;
    }
    // Twenty options and a roll to the last one, so the animation is long enough for
    // props batches to land during it.
    const OPTIONS = Array.from(
      { length: 20 },
      (_, i) => `Option ${String(i + 1)}`
    );
    poisonConfigurations([sizingKey(OPTIONS, 0, null, 'wheel')]);
    const tree = (label: string) => (
      <Picker
        options={OPTIONS}
        variant="wheel"
        label={label}
        onChange={recordChange('wheel-midroll')}
        testID="wheel-midroll"
        hybridRef={captureHybrid('wheel-midroll')}
        style={{ width: 280 }}
      />
    );
    const { rerender, unmount } = await render(tree('Drum'), {
      timeout: 20000,
    });
    await waitForTestId('wheel-midroll');
    await waitForMeasured('wheel-midroll', 'the drum');
    expect(eventLog).toEqual([]);

    handles.get('wheel-midroll')?.nuiTestSelect(19);
    // Send batches until the wheel reports one landed while it was turning: the
    // animation's length and the JS thread's latency vary by device, so a fixed number
    // of batches could all miss it.
    const LABELS = [
      'Drum A',
      'Drum B',
      'Drum C',
      'Drum D',
      'Drum E',
      'Drum F',
      'Drum G',
      'Drum H',
      'Drum I',
      'Drum J',
      'Drum K',
      'Drum L',
      'Drum M',
      'Drum N',
      'Drum O',
      'Drum P',
    ];
    let seen = false;
    for (const label of LABELS) {
      await settle(25);
      await rerender(tree(label));
      if (wheelWitness('wheel-midroll').sawRolling) {
        seen = true;
        await settle(25);
        await rerender(tree(`${label} +`));
        break;
      }
    }
    const during = wheelWitness('wheel-midroll');
    console.log(
      `mid-roll batches: witnessed=${String(seen)} witness=${JSON.stringify(during)} ` +
        `events=${JSON.stringify(eventLog)}`
    );
    // If no batch landed mid-roll the case tested nothing, so it fails.
    if (!during.sawRolling) {
      throw new Error(
        `none of the ${String(LABELS.length)} batches reached the drum's sync point while ` +
          `it was touched or turning (witness ${JSON.stringify(during)}, log ` +
          `${JSON.stringify(eventLog)}) - a mid-roll batch that never arrives mid-roll ` +
          `proves nothing, so this case refuses rather than passing.`
      );
    }
    expect(during.seats).toBe(0);

    await pollUntil(
      () => (eventLog.length > 0 ? true : null),
      () =>
        new Error(
          `a roll cancelled by an unrelated ${String(during.seats)} batch write ` +
            `reported nothing at all - the log holds ${JSON.stringify(eventLog)}.`
        ),
      10000
    );
    await settle(600);
    console.log(`mid-roll rest: events=${JSON.stringify(eventLog)}`);
    expect(eventLog).toEqual(['wheel-midroll:19']);
    const after = wheelWitness('wheel-midroll');
    expect(after.seats).toBe(0);
    expect(after.refusals).toBe(0);
    unmount();
  });

  it('reports nothing for the row already shown, or for a disabled wheel', async () => {
    const OPTIONS = ['One', 'Two', 'Three'];
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          variant="wheel"
          defaultSelectedIndex={0}
          onChange={recordChange('wheel-noop')}
          testID="wheel-noop"
          hybridRef={captureHybrid('wheel-noop')}
          style={{ width: 280 }}
        />
        <Picker
          options={OPTIONS}
          variant="wheel"
          disabled
          onChange={recordChange('wheel-disabled')}
          testID="wheel-disabled"
          hybridRef={captureHybrid('wheel-disabled')}
          style={{ width: 280 }}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-noop');
    await waitForMeasured('wheel-noop', 'the drum');
    await waitForMeasured('wheel-disabled', 'the disabled drum');
    // Covers the rest the mount itself can cause.
    await settle(400);
    expect(eventLog).toEqual([]);

    await rollWheel('wheel-noop', 0, false);
    await rollWheel('wheel-disabled', 2, false);
    console.log(`wheel silence: events=${JSON.stringify(eventLog)}`);
    expect(eventLog).toEqual([]);
    // Compared with the enabled wheel, not with `WHEEL_DP`: Material's wheel is 200 dp
    // tall and SwiftUI's is 216 pt.
    const disabledSize = measured('wheel-disabled');
    const enabledSize = measured('wheel-noop');
    console.log(
      `disabled drum (${Platform.OS}): enabled=${describeSize(enabledSize)} ` +
        `disabled=${describeSize(disabledSize)}`
    );
    expect(
      Math.abs((disabledSize?.height ?? 0) - (enabledSize?.height ?? 0))
    ).toBeLessThanOrEqual(1);
    unmount();
  });

  it('goes back to a menu and to a wheel, with nothing left behind', async () => {
    // A variant change remounts the view, possibly onto a recycled host. A fill-width
    // sizing policy left on that host would make a menu report the box's width as its
    // own.
    const OPTIONS = ['Small', 'Medium', 'Large'];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'wheel'),
      sizingKey(OPTIONS, 0, null, 'menu'),
    ]);
    const BOX = { width: 330, height: 260 };
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        variant="wheel"
        onChange={recordChange('wheel-switch')}
        testID="wheel-switch"
        hybridRef={captureHybrid('wheel-switch')}
        style={{ width: BOX.width, height: BOX.height }}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('wheel-switch');
    const asWheel = await waitForMeasured('wheel-switch', 'the drum');
    await settle(400);
    expect(eventLog).toEqual([]);

    const staleMenu = asWheel;
    await rerender(
      <Picker
        options={OPTIONS}
        variant="menu"
        onChange={recordChange('wheel-switch')}
        testID="wheel-switch"
        hybridRef={captureHybrid('wheel-switch')}
        style={{ width: BOX.width, height: BOX.height }}
      />
    );
    const asMenu = await waitForFreshMeasure(
      'wheel-switch',
      staleMenu,
      'the menu after the variant change'
    );
    await settle(300);
    // The absolute numbers are Material's text field: 56 dp tall at its 280 dp minimum
    // width. An iOS menu is smaller and sized to its title.
    expect(asMenu.width).toBeLessThan(BOX.width - 20);
    expect(asMenu.height).toBeLessThan(asWheel.height - 20);
    if (Platform.OS === 'android') {
      expect(Math.abs(asMenu.height - 56) < 1).toBe(true);
      expect(Math.abs(asMenu.width - 280) < 1).toBe(true);
    }
    expect(eventLog).toEqual([]);
    expect(drawnOf('wheel-switch')).toBe('-1');

    await rerender(
      <Picker
        options={OPTIONS}
        variant="wheel"
        onChange={recordChange('wheel-switch')}
        testID="wheel-switch"
        hybridRef={captureHybrid('wheel-switch')}
        style={{ width: BOX.width, height: BOX.height }}
      />
    );
    const asWheelAgain = await waitForFreshMeasure(
      'wheel-switch',
      asMenu,
      'the drum after the second variant change'
    );
    await settle(400);
    console.log(
      `wheel->menu->wheel (${Platform.OS}): wheel=${describeSize(asWheel)} ` +
        `menu=${describeSize(asMenu)} wheel2=${describeSize(asWheelAgain)} ` +
        `events=${JSON.stringify(eventLog)}`
    );
    expect(Math.abs(asWheelAgain.height - asWheel.height) < 1).toBe(true);
    expect(Math.abs(asWheelAgain.width - BOX.width) < 1).toBe(true);
    expect(handles.get('wheel-switch')?.variant).toBe('wheel');
    expect(eventLog).toEqual([]);
    unmount();
  });
});
