import {
  NativeModules,
  Platform,
  Pressable,
  processColor,
  Text,
  TurboModuleRegistry,
  View,
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
  Button,
  type ButtonShape,
  nitroUiCore,
  type NitroUiSizingStats,
  type NitroUiSizingTraceEvent,
} from 'react-native-nitro-ui';

/** The Button's Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiButton';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type ButtonHandle = {
  readonly title: string;
  /** The normalised drawable name React sent, or `null`. */
  readonly androidIcon: string | null;
  readonly variant: string;
  readonly size: string;
  /** The resolved corner (`'round'` for anything the wrapper does not recognise). */
  readonly shape: string;
  readonly disabled: boolean;
  /**
   * The callback the wrapper installed on the native side. Optional because the
   * library's `hybridRef` type does not list it, though the runtime object has
   * it.
   */
  readonly onPress?: unknown;
  measureContent(): { width: number; height: number };
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
};

const handles = new Map<string, ButtonHandle>();
const captureHybrid =
  (testId: string) =>
  (view: ButtonHandle): void => {
    handles.set(testId, view);
  };

/**
 * Every `onPress` the app has reported, in order, tagged with the control's id.
 */
const pressLog: string[] = [];
const recordPress = (testId: string) => (): void => {
  pressLog.push(testId);
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

/**
 * Poll until the control reports a size that is not `previous`. On Android
 * `measureContent()` still answers the old size for the frame in which a
 * `title`, `size` or `variant` landed, because Compose re-lays out on the UI
 * thread.
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

async function waitForMeasured(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

async function waitForPresses(count: number) {
  return await pollUntil(
    () => (pressLog.length >= count ? pressLog.slice() : null),
    () =>
      new Error(
        `Only ${String(pressLog.length)} of ${String(count)} presses arrived.`
      )
  );
}

/** `drainSizingTrace` consumes the ring, so a read must keep what it took. */
async function collectTrace(
  done: (events: NitroUiSizingTraceEvent[]) => boolean,
  timeoutMs = 3000
) {
  const events: NitroUiSizingTraceEvent[] = [];
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    events.push(...nitroUiCore.drainSizingTrace());
    if (done(events) || nitroUiCore.now() > deadline) {
      return events;
    }
    await sleep(25);
  }
}

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
        `the pixel probe for "${testId}" (${what}) never reported. Last report: ` +
          `"${handle.nuiTestPixelReport()}".`
      ),
    8000
  );
  if (
    !/ hits=\d+ mean=#[0-9A-F]{6}/.test(report) &&
    !/no pixels/.test(report)
  ) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) reported a line that is neither a ` +
        `sample nor a refusal: ${report}`
    );
  }
  return report;
}

function probeHits(report: string): number {
  const hits = / hits=(\d+)/.exec(report);
  return hits == null ? 0 : Number(hits[1]);
}

/**
 * The key `Button.tsx` builds for a configuration:
 * `variant|size|systemImage|androidIcon|title`. Written out rather than
 * imported, so a wrong helper in the library cannot poison and pass its own
 * test; it has to be edited in step with the wrapper.
 */
function sizingKey(
  variant: string,
  size: string,
  title: string,
  systemImage = '',
  androidIcon = ''
): string {
  return `${variant}|${size}|${systemImage}|${androidIcon}|${title}`;
}

/**
 * A size that is no Button's, planted as the engine's answer for a
 * configuration before it is first mounted. The declared fallback is close to
 * the truth, so without this a missing correction would be invisible.
 */
const WRONG_SIZE = { width: 12.5, height: 71.5 };

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

const rowStyle: StyleProp<ViewStyle> = { gap: 6 };

afterEach(() => {
  cleanup();
  handles.clear();
  pressLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('Button · G2', () => {
  it('lays each variant out at the size the control measured', async () => {
    poisonConfigurations(
      ['filled', 'tonal', 'outlined', 'text', 'elevated'].map((variant) =>
        sizingKey(variant, 'medium', 'Variant')
      )
    );
    const before = stats();
    await render(
      <View style={rowStyle}>
        {(['filled', 'tonal', 'outlined', 'text', 'elevated'] as const).map(
          (variant) => (
            <Button
              key={variant}
              title="Variant"
              variant={variant}
              testID={`variant-${variant}`}
              hybridRef={captureHybrid(`variant-${variant}`)}
            />
          )
        )}
      </View>,
      { timeout: 20000 }
    );
    const widths: string[] = [];
    for (const variant of ['filled', 'tonal', 'outlined', 'text', 'elevated']) {
      const testId = `variant-${variant}`;
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, variant);
      const box = await waitForBox(testId, content, variant);
      widths.push(`${variant}=${describeSize(box)}`);
      expect(box).not.toBeNull();
      expect(sameSize(content, WRONG_SIZE)).toBe(false);
    }
    const d = delta(before, stats());
    console.log(
      `variants: ${widths.join(' ')} corrections=${String(d.corrections)} ` +
        `immediate=${String(d.immediate)} cached=${String(d.cachedSizes)}`
    );
    // Five cold, poisoned configurations: each has to be corrected, or the box
    // above came from the planted size.
    expect(d.corrections).toBeGreaterThanOrEqual(5);
  });

  it('fires onPress once per tap and nothing when disabled', async () => {
    // The plain RN `Pressable` in the same row shows whether the harness's tap
    // arrived at all. On iOS `userEvent.press` synthesises a `UITouch` with no
    // HID event behind it: RN's touch handler reads it, but SwiftUI's `Button`
    // gesture rejects it, so on iOS the callback native holds is invoked
    // directly.
    const rnPresses: string[] = [];
    await render(
      <View style={rowStyle}>
        <Pressable
          testID="rn-barometer"
          onPress={(): void => {
            rnPresses.push('tap');
          }}
        >
          <Text>Save</Text>
        </Pressable>
        <Button
          title="Press me"
          onPress={recordPress('press-me')}
          testID="press-me"
          hybridRef={captureHybrid('press-me')}
        />
        <Button
          title="Disabled"
          disabled
          onPress={recordPress('disabled')}
          testID="disabled"
          hybridRef={captureHybrid('disabled')}
        />
      </View>
    );
    const enabled = await waitForTestId('press-me');
    const disabled = await waitForTestId('disabled');
    const barometer = await waitForTestId('rn-barometer');

    await userEvent.press(barometer);
    await pollUntil(
      () => (rnPresses.length > 0 ? true : null),
      () =>
        new Error(
          'The harness tap reached neither the RN Pressable in this row nor ' +
            'anything else: this test cannot judge a Button press.'
        ),
      5000
    );

    // Press the disabled one first: the enabled control's event is the barrier
    // that says the pipeline delivered.
    await userEvent.press(disabled);
    await userEvent.press(disabled);

    if (Platform.OS === 'android') {
      await userEvent.press(enabled);
      const seen = await waitForPresses(1);
      expect(seen).toEqual(['press-me']);

      await userEvent.press(enabled);
      const twice = await waitForPresses(2);
      console.log(`presses after three enabled taps: ${JSON.stringify(twice)}`);
      expect(twice).toEqual(['press-me', 'press-me']);
    } else {
      const handle = handles.get('press-me');
      expect(typeof handle?.onPress).toBe('function');
      (handle?.onPress as (() => void) | undefined)?.();
      const seen = await waitForPresses(1);
      console.log(
        `iOS: harness taps delivered to the Button = ${String(pressLog.length)} ` +
          `(barometer ${String(rnPresses.length)}); native-held onPress invoked once`
      );
      expect(seen).toEqual(['press-me']);
      expect(pressLog.length).toBe(1);
    }

    expect(handles.get('disabled')?.disabled).toBe(true);
    expect(pressLog.filter((id) => id === 'disabled')).toEqual([]);
  });

  it('re-measures when the title changes (R3)', async () => {
    const SHORT = 'Run';
    const LONG = 'Run the whole build';
    poisonConfigurations([
      sizingKey('filled', 'medium', SHORT),
      sizingKey('filled', 'medium', LONG),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Button
        title={SHORT}
        testID="title"
        hybridRef={captureHybrid('title')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('title');
    const shortSize = await waitForMeasured('title', 'the short title');
    await waitForBox('title', shortSize, 'the short title');
    const cold = delta(before, stats());
    expect(sameSize(sizeOf('title'), WRONG_SIZE)).toBe(false);
    expect(cold.corrections).toBeGreaterThanOrEqual(1);

    await rerender(
      <Button title={LONG} testID="title" hybridRef={captureHybrid('title')} />
    );
    const longSize = await waitForRemeasure(
      'title',
      shortSize,
      'the long title'
    );
    await waitForBox('title', longSize, 'the long title');
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);

    await rerender(
      <Button title={SHORT} testID="title" hybridRef={captureHybrid('title')} />
    );
    await waitForBox('title', shortSize, 'the short title again');

    // Warm from here: both configurations have been measured, so a turn that
    // moves the size must cost no correction. The first long title is outside
    // this window, because its provisional entry is consumed in the turn that
    // first measures it.
    await settle(150);
    const warmBefore = stats();
    await rerender(
      <Button title={LONG} testID="title" hybridRef={captureHybrid('title')} />
    );
    await waitForRemeasure('title', shortSize, 'the long title, warm');
    await waitForBox('title', longSize, 'the long title, warm');

    await rerender(
      <Button title={SHORT} testID="title" hybridRef={captureHybrid('title')} />
    );
    await waitForBox('title', shortSize, 'the short title again, warm');
    const warm = delta(warmBefore, stats());
    console.log(
      `title R3: short=${describeSize(shortSize)} long=${describeSize(longSize)} ` +
        `warm=${JSON.stringify(warm)}`
    );
    expect(warm.corrections).toBe(0);
    expect(warm.cachedSizes).toBe(0);
    // Zero corrections with zero measurements would mean nothing happened, not
    // that nothing was needed.
    expect(warm.measurements).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('re-measures when the size changes (R3)', async () => {
    poisonConfigurations([
      sizingKey('filled', 'small', 'Sized'),
      sizingKey('filled', 'large', 'Sized'),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Button
        title="Sized"
        size="small"
        testID="size"
        hybridRef={captureHybrid('size')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('size');
    const smallSize = await waitForMeasured('size', 'the small control');
    await waitForBox('size', smallSize, 'the small control');
    expect(sameSize(sizeOf('size'), WRONG_SIZE)).toBe(false);
    expect(delta(before, stats()).corrections).toBeGreaterThanOrEqual(1);

    await rerender(
      <Button
        title="Sized"
        size="large"
        testID="size"
        hybridRef={captureHybrid('size')}
      />
    );
    const largeSize = await waitForRemeasure(
      'size',
      smallSize,
      'the large control'
    );
    await waitForBox('size', largeSize, 'the large control');
    expect(largeSize.width).toBeGreaterThan(smallSize.width);

    await rerender(
      <Button
        title="Sized"
        size="small"
        testID="size"
        hybridRef={captureHybrid('size')}
      />
    );
    await waitForBox('size', smallSize, 'the small control again');

    await settle(150);
    const warmBefore = stats();
    await rerender(
      <Button
        title="Sized"
        size="large"
        testID="size"
        hybridRef={captureHybrid('size')}
      />
    );
    await waitForRemeasure('size', smallSize, 'the large control, warm');
    await waitForBox('size', largeSize, 'the large control, warm');

    await rerender(
      <Button
        title="Sized"
        size="small"
        testID="size"
        hybridRef={captureHybrid('size')}
      />
    );
    await waitForBox('size', smallSize, 'the small control again, warm');
    const warm = delta(warmBefore, stats());
    console.log(
      `size R3: small=${describeSize(smallSize)} large=${describeSize(largeSize)} ` +
        `warm=${JSON.stringify(warm)}`
    );
    expect(warm.corrections).toBe(0);
    expect(warm.cachedSizes).toBe(0);
    expect(warm.measurements).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('re-reports a key change that keeps the size (R3)', async () => {
    // The new configuration measures what the old one did, and each host skips
    // a report within 0.5 of the size it reported last, so the key change
    // itself has to be re-reported. iOS: `filled` and `elevated` are the same
    // control. Android: `systemImage` is in the key and never rendered.
    poisonConfigurations([
      sizingKey('filled', 'medium', 'Sticky'),
      sizingKey('elevated', 'medium', 'Sticky'),
      sizingKey('filled', 'medium', 'Sticky', 'star'),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Button
        title="Sticky"
        testID="sticky"
        hybridRef={captureHybrid('sticky')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('sticky');
    const size = await waitForMeasured('sticky', 'the first configuration');
    await waitForBox('sticky', size, 'the first configuration');
    expect(sameSize(sizeOf('sticky'), WRONG_SIZE)).toBe(false);
    expect(delta(before, stats()).corrections).toBeGreaterThanOrEqual(1);

    await settle(150);
    const changed = stats();
    await rerender(
      Platform.OS === 'ios' ? (
        <Button
          title="Sticky"
          variant="elevated"
          testID="sticky"
          hybridRef={captureHybrid('sticky')}
        />
      ) : (
        <Button
          title="Sticky"
          systemImage="star"
          testID="sticky"
          hybridRef={captureHybrid('sticky')}
        />
      )
    );
    // No `waitForRemeasure` here: the control still measures `size`. The settle
    // gives the correction, its flush and the re-layout a turn to land.
    await settle(500);
    const box = sizeOf('sticky');
    const after = delta(changed, stats());
    console.log(
      `same-size key change (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(measured('sticky'))} delta=${JSON.stringify(after)}`
    );
    expect(sameSize(box, WRONG_SIZE)).toBe(false);
    expect(sameSize(box, size)).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('re-measures a title change the engine has an answer for already', async () => {
    // The size the control already has is planted as the answer for the title
    // it is about to get, so the engine answers the change with the box it is
    // already at: no state update, no resize, no `layoutSubviews`. Only the
    // measure a size-affecting setter asks for can report the new size.
    const SHORT = 'Run';
    const LONG = 'Run the whole build';
    const { rerender, unmount } = await render(
      <Button
        title={SHORT}
        testID="notify"
        hybridRef={captureHybrid('notify')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('notify');
    const shortSize = await waitForMeasured('notify', 'the short title');
    await waitForBox('notify', shortSize, 'the short title');

    nitroUiCore.seedSizingSize(
      COMPONENT,
      sizingKey('filled', 'medium', LONG),
      shortSize.width,
      shortSize.height
    );

    const before = stats();
    await rerender(
      <Button
        title={LONG}
        testID="notify"
        hybridRef={captureHybrid('notify')}
      />
    );
    const longSize = await waitForRemeasure(
      'notify',
      shortSize,
      'the long title'
    );
    await waitForBox('notify', longSize, 'the long title');
    const d = delta(before, stats());
    console.log(
      `notify: short=${describeSize(shortSize)} long=${describeSize(longSize)} ` +
        `d=${JSON.stringify(d)}`
    );
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);
    expect(sameSize(sizeOf('notify'), shortSize)).toBe(false);
    expect(d.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('gives two titles in one row two different widths', async () => {
    // Two instances share a cached size when their keys match, so a
    // size-affecting prop missing from the key would give both the same box.
    // Both start poisoned so neither can inherit the other's answer.
    poisonConfigurations([
      sizingKey('filled', 'medium', 'OK'),
      sizingKey('filled', 'medium', 'Cancel and keep editing'),
    ]);
    const before = stats();
    await render(
      <View style={rowStyle}>
        <Button
          title="OK"
          testID="key-short"
          hybridRef={captureHybrid('key-short')}
        />
        <Button
          title="Cancel and keep editing"
          testID="key-long"
          hybridRef={captureHybrid('key-long')}
        />
        <Button
          title="OK"
          variant="tonal"
          testID="key-short-tonal"
          hybridRef={captureHybrid('key-short-tonal')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('key-short');
    const shortMeasured = await waitForMeasured('key-short', 'OK');
    const shortBox = await waitForBox('key-short', shortMeasured, 'OK');
    const longMeasured = await waitForMeasured('key-long', 'the long title');
    await waitForBox('key-long', longMeasured, 'the long title');
    const tonalMeasured = await waitForMeasured('key-short-tonal', 'OK, tonal');
    await waitForBox('key-short-tonal', tonalMeasured, 'OK, tonal');

    const longBox = sizeOf('key-long');
    console.log(
      `cache key: OK=${describeSize(shortBox)} long=` +
        `${describeSize(longBox)} tonal=${describeSize(sizeOf('key-short-tonal'))}`
    );
    expect(longBox!.width).toBeGreaterThan(shortBox.width + 1);
    expect(delta(before, stats()).corrections).toBeGreaterThanOrEqual(3);
  });

  it('re-measures after an environment change, mounted or fresh', async () => {
    // `invalidateSizingEnvironment` is the entry point
    // `traitCollectionDidChange` / `onConfigurationChanged` call, with the
    // signature check bypassed: the cache is dropped, and the mounted instance
    // must be corrected.
    poisonConfigurations([sizingKey('filled', 'medium', 'Environment')]);
    const { rerender, unmount } = await render(
      <Button
        title="Environment"
        testID="env"
        hybridRef={captureHybrid('env')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('env');
    const first = await waitForMeasured('env', 'the mounted control');
    await waitForBox('env', first, 'the mounted control');
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    nitroUiCore.invalidateSizingEnvironment();
    expect(stats().environmentEpoch).toBe(before.environmentEpoch + 1);
    await settle();
    // The engine keeps each configuration's last size as the next guess, so an
    // environment change that did not move this control leaves the box.
    expect(sameSize(sizeOf('env'), first)).toBe(true);

    const afterEpoch = stats();
    await rerender(
      <Button
        title="Environment, now much longer"
        testID="env"
        hybridRef={captureHybrid('env')}
      />
    );
    const second = await waitForRemeasure('env', first, 'the retitled control');
    await waitForBox('env', second, 'the retitled control');
    const trace = await collectTrace((events) =>
      events.some((event) => event.stage === 'drew')
    );
    const drawn = trace.filter((event) => event.stage === 'drew');
    const d = delta(afterEpoch, stats());
    console.log(
      `epoch: first=${describeSize(first)} second=${describeSize(second)} ` +
        `d=${JSON.stringify(d)} drawn=${JSON.stringify(drawn.map((e) => `${e.width.toFixed(1)}x${e.height.toFixed(1)}`))}`
    );
    expect(second.width).toBeGreaterThan(first.width);
    expect(sameSize(sizeOf('env'), WRONG_SIZE)).toBe(false);
    // The retitled control is cold in the new epoch, so a real report after the
    // bump must cost a correction.
    expect(d.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('keeps a caller width in charge and truncates the label', async () => {
    // The truncated label is inside the hosting view and cannot be read here.
    // What is asserted: the box is the caller's 120 while `measureContent()` is
    // still the title's intrinsic width, and on Android the tap still lands.
    const rnPresses: string[] = [];
    const { unmount } = await render(
      <View style={rowStyle}>
        <Pressable
          testID="capped-barometer"
          onPress={(): void => {
            rnPresses.push('tap');
          }}
        >
          <Text>Barometer</Text>
        </Pressable>
        <Button
          title="A title far too long for the box it was given"
          onPress={recordPress('capped')}
          testID="capped"
          style={{ width: 120 }}
          hybridRef={captureHybrid('capped')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('capped');
    const box = sizeOf('capped');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 120) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('capped', 'a long title');
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);

    await userEvent.press(await waitForTestId('capped-barometer'));
    await pollUntil(
      () => (rnPresses.length > 0 ? true : null),
      () =>
        new Error(
          'The harness tap reached neither the RN Pressable in this row nor ' +
            'anything else: this test cannot judge a button press.'
        ),
      5000
    );
    if (Platform.OS === 'android') {
      await userEvent.press(await waitForTestId('capped'));
      expect(await waitForPresses(1)).toEqual(['capped']);
    } else {
      // No harness tap reaches a hosted SwiftUI Button: the synthesised touch
      // carries no HID event.
      console.log(
        `iOS: harness taps delivered to the Button = ${String(pressLog.length)} ` +
          `(barometer ${String(rnPresses.length)}); not deliverable to a hosted ` +
          'SwiftUI Button, so this asserts the box and the reported size only'
      );
    }
    unmount();
  });

  it('sizes 200 distinct titles, each at its own size', async () => {
    const titles = Array.from(
      { length: 200 },
      (_, index) => `Row ${String(index + 1)}`
    );
    poisonConfigurations(
      titles.slice(0, 20).map((title) => sizingKey('filled', 'medium', title))
    );
    const before = stats();
    await render(
      <View style={rowStyle}>
        {titles.map((title) => (
          <Button
            key={title}
            title={title}
            testID={`many-${title}`}
            hybridRef={captureHybrid(`many-${title}`)}
          />
        ))}
      </View>,
      { timeout: 30000 }
    );
    // All 200 configurations are cold and arrive wrong on their first frame, so
    // this waits for the corrections and then judges: a box still wrong
    // afterwards is a row that got a neighbour's size.
    const findWrong = (): string[] => {
      const wrong: string[] = [];
      for (const title of titles) {
        const testId = `many-${title}`;
        const box = sizeOf(testId);
        const content = handles.get(testId)?.measureContent() ?? null;
        if (!sameSize(box, content)) {
          wrong.push(
            `box ${describeSize(box)} vs measured ${describeSize(content)}`
          );
        }
        if (sameSize(box, WRONG_SIZE)) {
          wrong.push('still poisoned');
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
      `200 buttons: corrections=${String(d.corrections)} ` +
        `immediate=${String(d.immediate)} cached=${String(d.cachedSizes)}`
    );
    expect(wrong).toEqual([]);
    expect(d.corrections).toBeGreaterThanOrEqual(200);
    // One cache entry per title: a size-affecting input missing from the key
    // would collapse them into one.
    expect(d.cachedSizes).toBeGreaterThanOrEqual(200);
  });

  it('survives remounts with the size of each mount', async () => {
    for (const [index, title] of [
      'First',
      'Second with a longer label',
      'Go',
    ].entries()) {
      const key = sizingKey('filled', 'medium', title);
      if (index === 0) {
        poisonConfigurations([key]);
      }
      const { unmount } = await render(
        <Button
          title={title}
          testID="cycle"
          hybridRef={captureHybrid('cycle')}
        />,
        { timeout: 20000 }
      );
      await waitForTestId('cycle');
      const content = await waitForMeasured('cycle', title);
      await waitForBox('cycle', content, title);
      expect(sameSize(sizeOf('cycle'), WRONG_SIZE)).toBe(false);
      handles.delete('cycle');
      unmount();
      await settle(80);
    }
  });

  it('reports the drawn box of a button, not a stale one', async () => {
    // A `drew` sample is the box the platform put on screen. For a first mount
    // whose configuration is poisoned it must be the planted guess or the real
    // size, never a third number.
    poisonConfigurations([sizingKey('filled', 'medium', 'Traced')]);
    nitroUiCore.setSizingTraceEnabled(true);
    await render(
      <Button
        title="Traced"
        testID="traced"
        hybridRef={captureHybrid('traced')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('traced');
    const content = await waitForMeasured('traced', 'the control');
    await waitForBox('traced', content, 'the control');
    const trace = await collectTrace((events) =>
      events.some((event) => event.stage === 'drew')
    );
    const drawn = trace.filter((event) => event.stage === 'drew');
    const explained = drawn.every(
      (event) => sameSize(event, content) || sameSize(event, WRONG_SIZE)
    );
    console.log(
      `trace: drawn=${JSON.stringify(drawn.map((e) => `${e.width.toFixed(1)}x${e.height.toFixed(1)}`))} real=${describeSize(content)}`
    );
    expect(explained).toBe(true);
  });
});

/**
 * `shape` is a paint, not a size: it is absent from the sizing key, so a corner
 * change must not open a new configuration, be corrected, or move the box.
 */
describe('shape · the corner (E1)', () => {
  it('reaches the control, and resolves anything else to round', async () => {
    render(
      <View style={rowStyle}>
        <Button
          title="Save"
          testID="shape-default"
          hybridRef={captureHybrid('shape-default')}
        />
        <Button
          title="Save"
          shape="square"
          testID="shape-square"
          hybridRef={captureHybrid('shape-square')}
        />
        <Button
          title="Save"
          shape={'pill' as ButtonShape}
          testID="shape-junk"
          hybridRef={captureHybrid('shape-junk')}
        />
        <Button
          title="Save"
          size="small"
          shape="square"
          testID="shape-small"
          hybridRef={captureHybrid('shape-small')}
        />
        <Button
          title="Save"
          size="large"
          shape="square"
          testID="shape-large"
          hybridRef={captureHybrid('shape-large')}
        />
      </View>
    );

    await waitForTestId('shape-default');
    await waitForMeasured('shape-default', 'the default Button to measure');
    await waitForBox(
      'shape-square',
      sizeOf('shape-default')!,
      'the square Button'
    );
    await waitForMeasured('shape-small', 'the small Button to measure');
    await waitForMeasured('shape-large', 'the large Button to measure');

    expect(handles.get('shape-default')?.shape).toBe('round');
    expect(handles.get('shape-square')?.shape).toBe('square');
    // The same rule `variant` and `size` follow: an unknown name is the default,
    // not a crash and not an empty corner.
    expect(handles.get('shape-junk')?.shape).toBe('round');

    console.log(
      `shape ladder (square corners): small=${describeSize(
        measured('shape-small')
      )} medium=${describeSize(measured('shape-default'))} ` +
        `large=${describeSize(measured('shape-large'))}`
    );

    const round = measured('shape-default');
    const square = measured('shape-square');
    expect(
      sameSize(round, square),
      `a square corner resized the control: ${describeSize(round)} -> ${describeSize(
        square
      )}`
    ).toBe(true);
  });

  it('repaints a mounted corner without opening a new configuration', async () => {
    render(
      <View style={rowStyle}>
        <Button
          title="Resize me"
          testID="shape-flip"
          hybridRef={captureHybrid('shape-flip')}
        />
      </View>
    );
    await waitForMeasured('shape-flip', 'the Button to measure');
    const box = sizeOf('shape-flip');
    const size = measured('shape-flip');
    expect(box).not.toBeNull();
    expect(size).not.toBeNull();

    const before = stats();
    render(
      <View style={rowStyle}>
        <Button
          title="Resize me"
          shape="square"
          testID="shape-flip"
          hybridRef={captureHybrid('shape-flip')}
        />
      </View>
    );
    await settle();

    expect(handles.get('shape-flip')?.shape).toBe('square');
    const after = delta(before, stats());
    const still =
      sameSize(box, sizeOf('shape-flip')) &&
      sameSize(size, measured('shape-flip'));
    expect(
      still,
      `the corner moved the box: ${describeSize(box)} -> ${describeSize(sizeOf('shape-flip'))}`
    ).toBe(true);
    expect(
      after.corrections,
      `a corner change cost ${String(after.corrections)} size correction(s)`
    ).toBe(0);
    expect(
      after.cachedSizes,
      `a corner change opened ${String(after.cachedSizes)} new size configuration(s)`
    ).toBe(0);

    // `null` means the platform's own corner, which resolves back to `round`.
    render(
      <View style={rowStyle}>
        <Button
          title="Resize me"
          shape={null}
          testID="shape-flip"
          hybridRef={captureHybrid('shape-flip')}
        />
      </View>
    );
    await settle();

    expect(handles.get('shape-flip')?.shape).toBe('round');
    const back = delta(before, stats());
    expect(
      sameSize(box, sizeOf('shape-flip')) &&
        sameSize(size, measured('shape-flip')),
      `the corner going back to null moved the box: ${describeSize(
        box
      )} -> ${describeSize(sizeOf('shape-flip'))}`
    ).toBe(true);
    expect(
      back.corrections,
      `two corner changes cost ${String(back.corrections)} size correction(s)`
    ).toBe(0);
    expect(
      back.cachedSizes,
      `two corner changes opened ${String(back.cachedSizes)} new size configuration(s)`
    ).toBe(0);
  });
});

/**
 * `androidIcon` names a drawable the app ships. A name that does not resolve is
 * exactly the no-icon control, and the slot's size comes from Material's size
 * ladder, not the artwork. iOS accepts the prop and never draws it.
 */
describe('androidIcon · the drawable the app ships (G19)', () => {
  const SHIPPED = 'nitroui_test_star';
  const WIDE_SHIPPED = 'nitroui_test_wide';
  const NOT_SHIPPED = 'nitroui_test_never_built';
  /** Resolves, but has no intrinsic size, so it cannot be rasterised. */
  const NO_ICON_SIZE = 'nitroui_test_shape';

  const configurations = [
    ['plain', undefined],
    ['star', SHIPPED],
    ['wide', WIDE_SHIPPED],
    ['missing', NOT_SHIPPED],
    ['shape', NO_ICON_SIZE],
  ] as const;

  it('takes the icon slot for a name that resolves, and no slot for one that does not', async () => {
    poisonConfigurations(
      configurations.map(([, icon]) =>
        sizingKey('filled', 'medium', 'Share', '', icon ?? '')
      )
    );
    const before = stats();
    await render(
      <View style={rowStyle}>
        {configurations.map(([name, icon]) => (
          <Button
            key={name}
            title="Share"
            androidIcon={icon}
            testID={`slot-${name}`}
            hybridRef={captureHybrid(`slot-${name}`)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );

    const boxes = new Map<string, Size>();
    const boxOf = (name: string): Size => {
      const size = boxes.get(name);
      if (size == null) {
        throw new Error(`"${name}" never produced a box.`);
      }
      return size;
    };
    for (const [name] of configurations) {
      const testId = `slot-${name}`;
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, `the ${name} Button`);
      await waitForBox(testId, content, `the ${name} Button`);
      boxes.set(name, content);
    }
    const d = delta(before, stats());
    console.log(
      `androidIcon boxes: ` +
        configurations
          .map(([name]) => `${name}=${describeSize(boxOf(name))}`)
          .join(' ') +
        ` corrections=${String(d.corrections)}`
    );

    expect(d.corrections).toBeGreaterThanOrEqual(5);

    if (Platform.OS === 'android') {
      const plain = boxOf('plain');
      const star = boxOf('star');
      // Wider than its no-icon self by Material's icon size plus spacing. Not a
      // constant: the two controls are each other's oracle.
      expect(star.width).toBeGreaterThan(plain.width + 0.6);
      expect(Math.abs(star.height - plain.height)).toBeLessThan(0.6);
      // The 32 x 12 slab fits the same square slot, so it must land on the same
      // width.
      expect(Math.abs(boxOf('wide').width - star.width)).toBeLessThan(0.6);
      expect(sameSize(boxOf('missing'), plain)).toBe(true);
      expect(sameSize(boxOf('shape'), plain)).toBe(true);
    } else {
      // iOS draws `systemImage` and no `androidIcon`, so none of the five keys
      // may move the box.
      for (const [name] of configurations) {
        expect(
          sameSize(boxOf(name), boxOf('plain')),
          `iOS drew an Android icon: ${name}=${describeSize(boxOf(name))} vs plain=${describeSize(boxOf('plain'))}`
        ).toBe(true);
      }
    }
  });

  it('draws the glyph in the control content colour, and nothing at all without it', async () => {
    // A `text` Button with no title: the variant has no container and no
    // border, so only the glyph can carry the content colour.
    const tint = processColor('#FF00A0') as number;
    const TINT_CSS = '#FF00A0';
    // Android gets the empty title; iOS cannot. A `.borderless` label with
    // nothing in it measures zero wide on iOS, so there would be no box to
    // sample.
    const PROBE_TITLE = Platform.OS === 'android' ? '' : 'Share';
    await render(
      <View style={rowStyle}>
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={SHIPPED}
          testID="probe-icon"
          hybridRef={captureHybrid('probe-icon')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={NOT_SHIPPED}
          testID="probe-missing"
          hybridRef={captureHybrid('probe-missing')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={NO_ICON_SIZE}
          testID="probe-shape"
          hybridRef={captureHybrid('probe-shape')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          testID="probe-bare"
          hybridRef={captureHybrid('probe-bare')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          disabled
          tintColor={TINT_CSS}
          androidIcon={SHIPPED}
          testID="probe-disabled"
          hybridRef={captureHybrid('probe-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const id of [
      'probe-icon',
      'probe-missing',
      'probe-shape',
      'probe-bare',
      'probe-disabled',
    ]) {
      await waitForTestId(id);
      const content = await waitForMeasured(id, id);
      await waitForBox(id, content, id);
    }

    const reports = new Map<string, string>();
    for (const id of [
      'probe-icon',
      'probe-missing',
      'probe-shape',
      'probe-bare',
      'probe-disabled',
    ]) {
      reports.set(id, await pixelProbe(id, tint, id));
    }
    console.log(`androidIcon probes: ${JSON.stringify([...reports])}`);
    const hitsOf = (id: string): number => {
      const report = reports.get(id);
      if (report == null) {
        throw new Error(`"${id}" never produced a probe report.`);
      }
      return probeHits(report);
    };

    if (Platform.OS === 'android') {
      expect(hitsOf('probe-icon')).toBeGreaterThan(0);
      expect(hitsOf('probe-missing')).toBe(0);
      expect(hitsOf('probe-shape')).toBe(0);
      expect(hitsOf('probe-bare')).toBe(0);
      // Disabled: Material repaints the content at 38%, so the pure tint is no
      // longer on screen.
      expect(hitsOf('probe-disabled')).toBe(0);
    } else {
      // iOS has no glyph to sample, and the probe says `no pixels`.
      expect(reports.get('probe-icon') ?? '').toContain('no pixels');
    }
  });

  it('is the key the wrapper sends, not one this file invented', async () => {
    // Poisons a key built here and requires the engine's first `laidOut` event
    // to carry the planted number, which happens only if the wrapper asked for
    // exactly this key.
    const key = sizingKey('filled', 'medium', 'TracedKey', '', SHIPPED);
    poisonConfigurations([key]);
    nitroUiCore.setSizingTraceEnabled(true);
    await render(
      <Button
        title="TracedKey"
        androidIcon={SHIPPED}
        testID="traced-key"
        hybridRef={captureHybrid('traced-key')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('traced-key');
    const content = await waitForMeasured('traced-key', 'the control');
    await waitForBox('traced-key', content, 'the control');
    const trace = await collectTrace((events) =>
      events.some((event) => event.stage === 'laidOut')
    );
    const laidOut = trace.filter((event) => event.stage === 'laidOut');
    console.log(
      `key trace: key="${key}" laidOut=${JSON.stringify(
        laidOut.map((e) => `${e.width.toFixed(1)}x${e.height.toFixed(1)}`)
      )} real=${describeSize(content)}`
    );
    expect(laidOut.length).toBeGreaterThan(0);
    expect(
      laidOut.some((event) => sameSize(event, WRONG_SIZE)),
      `the engine never asked for the key this file poisoned (${key}): the first ` +
        `layout was ${laidOut.map((e) => describeSize(e)).join(', ')}, so ` +
        `Button.tsx's key and this file's copy have drifted apart`
    ).toBe(true);
  });
});

/**
 * Material floors a control at its 48 dp minimum interactive size, so the token
 * a rung reads is not the box it produces: `small` and `medium` are the same
 * height.
 */
describe('the top of the ladder (D42 item 4)', () => {
  const RUNGS = ['small', 'medium', 'large', 'xlarge', 'xxlarge'] as const;

  it('lays the five rungs out in order, and never below the touch target', async () => {
    poisonConfigurations(
      RUNGS.map((size) => sizingKey('filled', size, 'Rung'))
    );
    await render(
      <View style={rowStyle}>
        {RUNGS.map((size) => (
          <Button
            key={size}
            title="Rung"
            size={size}
            testID={`rung-${size}`}
            hybridRef={captureHybrid(`rung-${size}`)}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );

    const heights = new Map<string, number>();
    const heightOf = (size: string): number => {
      const height = heights.get(size);
      if (height == null) {
        throw new Error(`"${size}" never produced a height.`);
      }
      return height;
    };
    const logged: string[] = [];
    for (const size of RUNGS) {
      const testId = `rung-${size}`;
      await waitForTestId(testId);
      const content = await waitForMeasured(testId, `the ${size} Button`);
      await waitForBox(testId, content, `the ${size} Button`);
      heights.set(size, content.height);
      logged.push(`${size}=${describeSize(content)}`);
    }
    console.log(`rung boxes: ${logged.join(' ')}`);

    if (Platform.OS === 'android') {
      // `small` and `medium` share a box because the 48 dp touch target floors
      // both.
      expect(heightOf('medium')).toBeLessThan(heightOf('large'));
      expect(heightOf('large')).toBeLessThan(heightOf('xlarge'));
      expect(heightOf('xlarge')).toBeLessThan(heightOf('xxlarge'));
      for (const size of RUNGS) {
        expect(
          heightOf(size),
          `${size} is laid out below Material's 48 dp minimum interactive size`
        ).toBeGreaterThanOrEqual(47.5);
      }
    } else {
      // iOS draws four `.controlSize` values against five rungs, so the top two
      // are the same control there.
      expect(heightOf('large')).toBeLessThanOrEqual(heightOf('xlarge'));
      expect(Math.abs(heightOf('xlarge') - heightOf('xxlarge'))).toBeLessThan(
        0.6
      );
    }
  });
});

/**
 * An `androidIcon` the app `require`s arrives later than a resource: the file
 * is loaded through Metro and parsed. The slot's size comes from the size
 * ladder, so the box does not wait for the file, and a file that is not there
 * draws nothing and leaves the no-icon box. iOS ignores the prop.
 */
describe('androidIcon · an icon the app imports (D43)', () => {
  /**
   * `STAR_ASSET` is loaded by no other test in this file: a parsed file is
   * cached per URL for the process, so a second test asking for the same URL
   * would draw it in its first frame.
   */
  const DRAWABLE_NAME = 'nitroui_test_star';

  /** The passing message of the box-set comparison, which doubles as its sentinel. */
  const SHARED_BOXES =
    'every box the imported icon published is one the named icon published too';
  const STAR_ASSET = require('../src/assets/icons/star_24px.xml');
  const SHARE_ASSET = require('../src/assets/icons/share_24px.xml');

  /**
   * A 2 dp diagonal stroke, and the same file compiled into the APK. `close` is
   * loaded by no other test here, so its file still arrives cold.
   */
  const CLOSE_ASSET = require('../src/assets/icons/close_24px.xml');
  const CLOSE_NAME = 'nitroui_test_close';

  /** A drawable that is not a vector, for the branch that keeps rasterising. */
  const RASTER_NAME = 'nitroui_test_raster';

  /**
   * The dev server this app's bundle was served from. Read here rather than
   * imported from the library, so the test does not depend on the code under
   * test to say where Metro is.
   */
  const devServerOrigin = (): string => {
    const constants = (
      NativeModules as unknown as {
        SourceCode?: { getConstants?(): { scriptURL?: string } };
      }
    ).SourceCode;
    const scriptURL = constants?.getConstants?.()?.scriptURL ?? '';
    const match = scriptURL.match(/^https?:\/\/.*?\//);
    if (match == null) {
      throw new Error(
        `this suite needs a bundle served over http to ask a dev server for a ` +
          `missing file; scriptURL was "${scriptURL}".`
      );
    }
    return match[0];
  };

  async function probeUntilDrawn(
    testId: string,
    color: number,
    timeoutMs = 15000
  ): Promise<{ report: string; ms: number }> {
    const started = nitroUiCore.now();
    const deadline = started + timeoutMs;
    let report = '';
    for (;;) {
      report = await pixelProbe(testId, color, testId);
      if (probeHits(report) > 0 || nitroUiCore.now() > deadline) {
        return { report, ms: nitroUiCore.now() - started };
      }
      await sleep(50);
    }
  }

  /**
   * Reads the sizing trace until the engine goes quiet: an assertion that
   * nothing else was published has to wait long enough to see a second box.
   */
  async function collectTraceUntilQuiet(
    quietMs = 400,
    timeoutMs = 2000
  ): Promise<NitroUiSizingTraceEvent[]> {
    const started = nitroUiCore.now();
    const events: NitroUiSizingTraceEvent[] = [];
    let lastSeen = started;
    for (;;) {
      const drained = nitroUiCore.drainSizingTrace();
      if (drained.length > 0) {
        events.push(...drained);
        lastSeen = nitroUiCore.now();
      }
      const now = nitroUiCore.now();
      if (now - lastSeen >= quietMs || now - started >= timeoutMs) {
        return events;
      }
      await sleep(25);
    }
  }

  /**
   * A `text` Button with no label, so the tint can only be on the glyph. iOS
   * needs a label to sample at all.
   */
  const TINT_CSS = '#FF00A0';
  const TINT = processColor(TINT_CSS) as number;
  const PROBE_TITLE = Platform.OS === 'android' ? '' : 'Share';

  /**
   * Every Button publishes its declared fallback on a cold mount and is
   * corrected by the first measure, so the claim is comparative: the control
   * beside this one has the same icon by resource name, which is never in
   * flight, and the imported icon must publish no box the named one did not.
   */
  it('draws the imported icon, and does not move the box when the bytes arrive', async () => {
    nitroUiCore.setSizingTraceEnabled(true);
    // One global buffer: earlier tests drain it only until their own predicate
    // is satisfied.
    nitroUiCore.drainSizingTrace();
    const mountedAt = nitroUiCore.now();
    await render(
      <View style={rowStyle}>
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={STAR_ASSET}
          testID="metro-star"
          hybridRef={captureHybrid('metro-star')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={DRAWABLE_NAME}
          testID="name-star"
          hybridRef={captureHybrid('name-star')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('metro-star');
    const first = await waitForMeasured('metro-star', 'the imported icon');
    await waitForBox('metro-star', first, 'the imported icon');
    const named = await waitForMeasured('name-star', 'the named icon');
    await waitForBox('name-star', named, 'the named icon');

    const sent = handles.get('metro-star')?.androidIcon ?? '';
    console.log(`metro wire: ${sent}`);
    if (Platform.OS === 'android') {
      expect(sent.startsWith('url:')).toBe(true);
      expect(sent).toContain('star_24px.xml');
    }

    const before = await pixelProbe('metro-star', TINT, 'before the load');
    const glyph = await probeUntilDrawn('metro-star', TINT);
    const drawn = glyph.report;
    const after = await waitForMeasured('metro-star', 'the imported icon');
    const collected = await collectTraceUntilQuiet();
    // `render()` tears the previous test's tree down while mounting these, so
    // events for older ids are in this window too.
    const since = collected.filter((event) => event.time >= mountedAt);
    const ids = [...new Set(since.map((event) => event.instanceId))].sort(
      (a, b) => a - b
    );
    const ours = ids.slice(-2);
    const box = (size: { width: number; height: number }) =>
      `${size.width.toFixed(2)}x${size.height.toFixed(2)}`;
    const boxesOf = (id: number) =>
      [...new Set(since.filter((e) => e.instanceId === id).map(box))].sort();
    const [metroId, nameId] = ours;
    const metroBoxes = metroId === undefined ? [] : boxesOf(metroId);
    const nameBoxes = nameId === undefined ? [] : boxesOf(nameId);
    console.log(
      `metro: hitsBefore=${String(probeHits(before))} hitsAfter=${String(
        probeHits(drawn)
      )} drawnInMs=${String(glyph.ms)} first=${describeSize(first)} after=${describeSize(
        after
      )} named=${describeSize(named)} ids=${JSON.stringify(
        ours
      )} droppedForeign=${String(
        collected.length - since.length
      )} metroBoxes=${JSON.stringify(metroBoxes)} nameBoxes=${JSON.stringify(
        nameBoxes
      )}`
    );

    if (Platform.OS === 'android') {
      expect(probeHits(drawn)).toBeGreaterThan(0);
      expect(sameSize(first, after)).toBe(true);
      // Every box the imported icon published must be one the named icon
      // published too. Not the same set: how many correction steps each takes
      // belongs to the sizing cache's state. The two ids are consecutive, in
      // mount order, the imported icon's first.
      if (metroId === undefined || nameId === undefined) {
        throw new Error(
          `this render expected two Button sizing ids, saw ${JSON.stringify(ids)}`
        );
      }
      expect({ metroId, nameId, gap: nameId - metroId }).toEqual({
        metroId: nameId - 1,
        nameId,
        gap: 1,
      });
      expect(metroBoxes.includes(box(first))).toBe(true);
      expect(nameBoxes.includes(box(named))).toBe(true);
      const extra = metroBoxes.filter((b) => !nameBoxes.includes(b));
      expect(
        extra.length === 0
          ? SHARED_BOXES
          : `only the imported icon published ${extra.join(
              ', '
            )}; the named icon published ${nameBoxes.join(', ')}`
      ).toEqual(SHARED_BOXES);
      expect(sameSize(named, first)).toBe(true);
    } else {
      // iOS draws no Android icon, at any size, from any source.
      expect(drawn).toContain('no pixels');
    }
  });

  it('widens the control by the ladder, not by the file it loaded', async () => {
    // `share_24px` is a second real file on purpose: its path fills the
    // viewport differently from `star`'s, so a slot sized from the artwork
    // would land on a different width.
    await render(
      <View style={rowStyle}>
        <Button
          title="Share"
          androidIcon={SHARE_ASSET}
          testID="metro-width"
          hybridRef={captureHybrid('metro-width')}
        />
        <Button
          title="Share"
          androidIcon={DRAWABLE_NAME}
          testID="drawable-width"
          hybridRef={captureHybrid('drawable-width')}
        />
        <Button
          title="Share"
          testID="plain-width"
          hybridRef={captureHybrid('plain-width')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = new Map<string, Size>();
    for (const id of ['metro-width', 'drawable-width', 'plain-width']) {
      await waitForTestId(id);
      const content = await waitForMeasured(id, id);
      await waitForBox(id, content, id);
      boxes.set(id, content);
    }
    // The Metro icon has to have arrived before the widths are compared: an
    // empty slot and a drawn one are the same size.
    if (Platform.OS === 'android') {
      const glyph = await probeUntilDrawn(
        'metro-width',
        processColor('#000000') as number
      );
      console.log(
        `metro width probe: hits=${String(probeHits(glyph.report))} drawnInMs=${String(
          glyph.ms
        )}`
      );
    }
    const metro = boxes.get('metro-width') as Size;
    const drawable = boxes.get('drawable-width') as Size;
    const plain = boxes.get('plain-width') as Size;
    console.log(
      `widths: metro=${describeSize(metro)} drawable=${describeSize(
        drawable
      )} plain=${describeSize(plain)}`
    );

    if (Platform.OS === 'android') {
      expect(Math.abs(metro.width - drawable.width)).toBeLessThan(0.6);
      expect(Math.abs(metro.height - drawable.height)).toBeLessThan(0.6);
      expect(metro.width).toBeGreaterThan(plain.width + 0.6);
    } else {
      // iOS ignores both icon props, so all three are one box.
      expect(sameSize(metro, plain)).toBe(true);
      expect(sameSize(drawable, plain)).toBe(true);
    }
  });

  it('draws nothing for a file the dev server does not have, and keeps the no-icon box', async () => {
    const missing = {
      uri: `${devServerOrigin()}src/assets/icons/never-built_24px.xml?platform=android&hash=00000000`,
    };
    await render(
      <View style={rowStyle}>
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          androidIcon={missing}
          testID="missing-404"
          hybridRef={captureHybrid('missing-404')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          tintColor={TINT_CSS}
          testID="missing-plain"
          hybridRef={captureHybrid('missing-plain')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const id of ['missing-404', 'missing-plain']) {
      await waitForTestId(id);
      const content = await waitForMeasured(id, id);
      await waitForBox(id, content, id);
    }
    // Give a request that *did* start time to answer: the assertion is that nothing
    // ever arrives, and a probe taken too early cannot tell "no glyph yet" from
    // "no glyph ever".
    await settle(1500);
    const fourOhFour = await pixelProbe('missing-404', TINT, 'the 404 icon');
    const plain = await pixelProbe(
      'missing-plain',
      TINT,
      'the no-icon control'
    );
    const box404 = measured('missing-404') as Size;
    const boxPlain = measured('missing-plain') as Size;
    console.log(
      `404: hits=${String(probeHits(fourOhFour))} box=${describeSize(
        box404
      )} plainBox=${describeSize(boxPlain)} plainHits=${String(
        probeHits(plain)
      )}`
    );

    if (Platform.OS === 'android') {
      expect(probeHits(fourOhFour)).toBe(0);
      expect(sameSize(box404, boxPlain)).toBe(true);
    } else {
      expect(fourOhFour).toContain('no pixels');
      expect(sameSize(box404, boxPlain)).toBe(true);
    }
  });

  /**
   * A 2 dp stroke rasterised at 24 dp and stretched into a 40 dp slot shows
   * about 0.84 of the tint pixels the same file shows drawn as a vector; drawn
   * at the slot's size the ratio is 1. `0.95` sits between the two.
   */
  const SHARP_RATIO = 0.95;

  it('draws the shipped drawable as sharply as the imported one, at the top rung', async () => {
    // A box cannot see blur. `close` is a 2 dp diagonal with almost no
    // interior, so scaling its bitmap turns most of its pixels into a blend the
    // probe does not count. The control beside it loads the same file over
    // Metro, which is drawn at the slot's size, as the reference.
    await render(
      <View style={rowStyle}>
        <Button
          title={PROBE_TITLE}
          variant="text"
          size="xxlarge"
          tintColor={TINT_CSS}
          androidIcon={CLOSE_ASSET}
          testID="sharp-metro"
          hybridRef={captureHybrid('sharp-metro')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          size="xxlarge"
          tintColor={TINT_CSS}
          androidIcon={CLOSE_NAME}
          testID="sharp-name"
          hybridRef={captureHybrid('sharp-name')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          size="medium"
          tintColor={TINT_CSS}
          androidIcon={CLOSE_NAME}
          testID="sharp-medium"
          hybridRef={captureHybrid('sharp-medium')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const id of ['sharp-metro', 'sharp-name', 'sharp-medium']) {
      await waitForTestId(id);
      const content = await waitForMeasured(id, id);
      await waitForBox(id, content, id);
    }
    if (Platform.OS === 'android') {
      const metro = await probeUntilDrawn('sharp-metro', TINT);
      const named = await probeUntilDrawn('sharp-name', TINT);
      const medium = await probeUntilDrawn('sharp-medium', TINT);
      const metroHits = probeHits(metro.report);
      const namedHits = probeHits(named.report);
      const mediumHits = probeHits(medium.report);
      console.log(
        `sharp: named@xxlarge=${named.report} metro@xxlarge=${metro.report} ` +
          `named@medium=${medium.report} ` +
          `ratio=${(namedHits / Math.max(1, metroHits)).toFixed(3)}`
      );
      expect(namedHits).toBeGreaterThan(0);
      expect(metroHits).toBeGreaterThan(0);
      expect(
        namedHits >= SHARP_RATIO * metroHits
          ? 'both roads drew the glyph at the slot size'
          : `the shipped drawable drew ${namedHits} pixels of the tint and the ` +
              `imported one ${metroHits}: a stretched raster loses its thin strokes`
      ).toEqual('both roads drew the glyph at the slot size');
      // A floor, not the sharpness guard: the 40 dp slot must carry at least
      // double the ink of the 24 dp one.
      expect(
        namedHits >= 2 * mediumHits
          ? 'the top rung carries its share of ink for a 40 dp slot'
          : `40 dp drew ${namedHits} pixels and 24 dp drew ${mediumHits}: ` +
              'expected at least double, and a stretched 24 dp raster is well under'
      ).toEqual('the top rung carries its share of ink for a 40 dp slot');
    } else {
      // iOS ignores `androidIcon`. Probed once each, not through
      // `probeUntilDrawn`, which waits 15 s for ink iOS never paints.
      expect(
        await pixelProbe('sharp-name', TINT, 'the shipped glyph')
      ).toContain('no pixels');
      expect(
        await pixelProbe('sharp-metro', TINT, 'the imported glyph')
      ).toContain('no pixels');
      expect(
        sameSize(
          measured('sharp-name') as Size,
          measured('sharp-metro') as Size
        )
      ).toBe(true);
    }
  });

  it('still draws a drawable that is not a vector, at the slot the ladder gives it', async () => {
    // A drawable that is not a `<vector>` (a PNG, a layer-list) is rasterised
    // at its intrinsic size and tinted, into the same slot. The three are
    // `text` variants with the empty probe title: a `filled` Button paints its
    // container with `tintColor`, which the probe would count.
    await render(
      <View style={rowStyle}>
        <Button
          title={PROBE_TITLE}
          variant="text"
          size="xxlarge"
          tintColor={TINT_CSS}
          androidIcon={RASTER_NAME}
          testID="raster-icon"
          hybridRef={captureHybrid('raster-icon')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          size="xxlarge"
          tintColor={TINT_CSS}
          androidIcon={CLOSE_NAME}
          testID="raster-vector"
          hybridRef={captureHybrid('raster-vector')}
        />
        <Button
          title={PROBE_TITLE}
          variant="text"
          size="xxlarge"
          testID="raster-plain"
          hybridRef={captureHybrid('raster-plain')}
        />
      </View>,
      { timeout: 20000 }
    );
    for (const id of ['raster-icon', 'raster-vector', 'raster-plain']) {
      await waitForTestId(id);
      const content = await waitForMeasured(id, id);
      await waitForBox(id, content, id);
    }
    const raster = measured('raster-icon') as Size;
    const vector = measured('raster-vector') as Size;
    const plain = measured('raster-plain') as Size;
    const rasterHits =
      Platform.OS === 'android'
        ? probeHits(await pixelProbe('raster-icon', TINT, 'the raster icon'))
        : 0;
    console.log(
      `raster branch: raster=${describeSize(raster)} vector=${describeSize(
        vector
      )} plain=${describeSize(plain)} hits=${String(rasterHits)}`
    );

    if (Platform.OS === 'android') {
      expect(rasterHits).toBeGreaterThan(0);
      expect(sameSize(raster, vector)).toBe(true);
      expect(raster.width).toBeGreaterThan(plain.width + 1);
    } else {
      expect(sameSize(raster, plain)).toBe(true);
      expect(sameSize(raster, vector)).toBe(true);
    }
  });
});
