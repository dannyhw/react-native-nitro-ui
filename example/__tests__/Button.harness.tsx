/**
 * On-device tests for the Button (task G2).
 *
 * Button is the library's first control whose *size comes from its props*, so
 * this suite is the R3 test DECISIONS D16 assigns to it: does a `title`, `size`
 * or `variant` change move the box Yoga was told, on both platforms, without a
 * frame showing the old size beyond what `docs/architecture/sizing.md` allows?
 *
 * Three readings, as in the sizing suite:
 *  - `harnessUi.queryByTestId` - the box Fabric gave the view;
 *  - `hybridRef.measureContent()` - the size the hosted control measured;
 *  - `nitroUiCore.sizingStats()` / `drainSizingTrace()` - what the engine did.
 *
 * Two things make these tests able to fail (AGENTS.md, "Every new test or gate
 * must be shown to fail"):
 *  - every cold configuration is **poisoned** first (`seedSizingSize` with a size
 *    that is not the control's, then an environment bump), so a correction that
 *    never arrives leaves a visible wrong box *and* costs a correction the test
 *    requires;
 *  - the warm assertions require **zero** corrections: with both configurations
 *    already measured, the only road to the new size is the measure pass, which is
 *    what a node that fails to dirty its measurement cannot do.
 *
 * Deliberately absent: a `beforeAll` that mounts a Button to "warm the process".
 * It would hide exactly the process-local behaviour above (first mount of a
 * component in a process), which G1 found the hard way on another suite.
 */
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

/**
 * What `hybridRef` hands back - declared, not imported (DECISIONS D14 keeps
 * Hybrid View types off the public surface). Read-only on purpose.
 */
type ButtonHandle = {
  readonly title: string;
  /** The normalised drawable name React sent, or `null` (G19). */
  readonly androidIcon: string | null;
  readonly variant: string;
  readonly size: string;
  /** The resolved corner (`'round'` for anything the wrapper does not recognise). */
  readonly shape: string;
  readonly disabled: boolean;
  /**
   * The callback the wrapper installed on the native side. Declared optional:
   * the library's `hybridRef` type does not list it (a callback prop is not part
   * of what the wrapper advertises, D14), and the runtime object does have it -
   * the press test reads it, and reading a prop React never sent would be
   * `undefined`, which is exactly as informative.
   */
  readonly onPress?: unknown;
  measureContent(): { width: number; height: number };
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
};

/** Handles by testID, so a test can ask each control what it measured. */
const handles = new Map<string, ButtonHandle>();
const captureHybrid =
  (testId: string) =>
  (view: ButtonHandle): void => {
    handles.set(testId, view);
  };

/**
 * Every `onPress` the app has reported, in order, tagged with the control's id.
 *
 * A press is the one thing a geometry query cannot see, and re-rendering to show
 * a counter would spend a render on the measurement. Native holds the callback,
 * so this array is what the event actually reached.
 */
const pressLog: string[] = [];
const recordPress = (testId: string) => (): void => {
  pressLog.push(testId);
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
 * Poll until the control reports a size that is *not* `previous`.
 *
 * `measureContent()` answers with the size the hosted control last measured, and
 * on Android that is still the old one for the frame in which a `title`, `size`
 * or `variant` landed: Compose recomposes and re-lays out on the UI thread, so a
 * plain "has a size" poll would return the pre-change number and the box check
 * below would then wait forever for a size the control has already moved past
 * (measured: Android reports the short title's width, then the long one's). The
 * new size is what the test has to wait for, because it is what the box has to
 * reach.
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

/** Wait for `pressLog` to hold at least `count` entries. */
async function waitForPresses(count: number) {
  return await pollUntil(
    () => (pressLog.length >= count ? pressLog.slice() : null),
    () =>
      new Error(
        `Only ${String(pressLog.length)} of ${String(count)} presses arrived.`
      )
  );
}

/**
 * The trace, accumulated. `drainSizingTrace` consumes the ring, so a read must
 * keep what it took (the T10/T11 suites read the perf ring the same way).
 */
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

/**
 * Ask `testId`'s Button what its pixels say about `color`, and wait for that
 * probe's own answer.
 *
 * SegmentedControl's helper of the same name, copied rather than shared because
 * the two files run in separate suites and a harness util module would be a third
 * thing to keep in step; the report format both sides accept is asserted below
 * rather than trusted, for the reason that helper gives (a mean that overruns its
 * six digits is unreadable *and* assertable).
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

/** The `hits=` count of a probe line. */
function probeHits(report: string): number {
  const hits = / hits=(\d+)/.exec(report);
  return hits == null ? 0 : Number(hits[1]);
}

/**
 * The key `Button.tsx` builds for a configuration:
 * `variant|size|systemImage|androidIcon|title`.
 *
 * Written out here rather than imported - a harness that poisoned the cache
 * through the library's own helper could not catch the helper being wrong, and a
 * missing input in that key is precisely the R3 bug class (every later instance of
 * a different configuration inherits the first one's size).
 *
 * The cost of that choice is that this copy has to be edited in step with the
 * wrapper, and a copy that falls behind is worse than a missing field: the seed
 * lands under a key nothing ever asks for, every later "it was corrected, so the
 * planted size cannot have answered it" assertion passes for the wrong reason, and
 * nothing says so. G19's `androidIcon` is the fifth field, and the test at the end
 * of this file is what keeps the two copies honest - it poisons a key built here
 * and requires the engine's first `laidOut` event for that mount to carry *this*
 * file's poisoned number, which only happens if the wrapper asked for this key.
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
 * A size that is *not* any Button's size, planted as the engine's answer for a
 * configuration before it is first mounted.
 *
 * The declared fallback is deliberately close to the truth (D17), which on its own
 * would make every "the box was right" assertion pass even if no correction ever
 * arrived. A poisoned entry is provisional, so it lays the first frame out and
 * then *must* be replaced: the test requires both the right final box and at least
 * one correction.
 */
const WRONG_SIZE = { width: 12.5, height: 71.5 };

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

const rowStyle: StyleProp<ViewStyle> = { gap: 6 };

afterEach(() => {
  cleanup();
  handles.clear();
  pressLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('Button · G2', () => {
  it('lays each variant out at the size the control measured', async () => {
    // The baseline the R3 tests below compare against: with no style and no
    // parent stretch, the box Yoga gives a Button is the box SwiftUI/Compose
    // asked for. Nothing here is a constant - the control is its own oracle.
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
    // Five cold configurations, each poisoned: every one of them has to be
    // corrected, or the box above came from the planted size and the test proved
    // nothing.
    expect(d.corrections).toBeGreaterThanOrEqual(5);
  });

  it('fires onPress once per tap and nothing when disabled', async () => {
    // A press is the one requirement a geometry query cannot see, so this test
    // needs a reading that cannot lie. It comes from a plain RN `Pressable` in
    // the same row - the *barometer*. If the harness's tap does not reach that,
    // an empty Button log below measures the test, not the control.
    //
    // On iOS it does not reach a hosted SwiftUI Button, and that is the
    // harness, not this component. `userEvent.press` synthesises a `UITouch`
    // (`@react-native-harness/ui/ios/HarnessUI.mm`: `_touchesEvent`, `setPhase`,
    // `setTimestamp`, `_setLocationInWindow`, `sendEvent`) with `_setHIDEvent:NULL`
    // on it. RN's `RCTTouchHandler` reads touches directly, so the barometer
    // fires, and the hosted SwiftUI `Toggle` of the Switch suite fires; SwiftUI's
    // own `Button` gesture environment rejects a touch with no HID event behind
    // it, so none of the four styles this component uses (`borderedProminent`,
    // `bordered`, `bordered` + stroke, `borderless`) ever receives one. Measured:
    // every variant, at the element's centre and at its own coordinates, with the
    // barometer in the same tree firing on the same call. `simulatePress` is the
    // same synthesis. So on iOS the button's half of the contract is asserted
    // where the harness can reach it. A real (HID-level) tap is not available
    // here either: `agent-device` 0.21.18 presses by ref, by `testID` and by
    // coordinate against the example app on iPhone 17 left both the RN tab
    // `Pressable` and the hosted SwiftUI `Toggle` untouched, so no tap this
    // environment can inject reaches a button. That leaves the manual tap
    // confirmation open - see "Known issues" in
    // `docs/tasks/G2-button.report.md`.
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

    // Press the disabled one first: an empty log at that moment would prove
    // nothing on its own, because an event can still be in flight. The enabled
    // control's event is the barrier that says the pipeline delivered.
    await userEvent.press(disabled);
    await userEvent.press(disabled);

    if (Platform.OS === 'android') {
      await userEvent.press(enabled);
      const seen = await waitForPresses(1);
      expect(seen).toEqual(['press-me']);

      await userEvent.press(enabled);
      const twice = await waitForPresses(2);
      console.log(`presses after three enabled taps: ${JSON.stringify(twice)}`);
      // One event per tap - not two, and the disabled control contributed nothing.
      expect(twice).toEqual(['press-me', 'press-me']);
    } else {
      const handle = handles.get('press-me');
      // React's callback is installed on the native side...
      expect(typeof handle?.onPress).toBe('function');
      // ...and invoking what native holds reaches JS exactly once, which is the
      // half of "fires once per tap" that survives the tap being undeliverable:
      // the gesture -> action edge is SwiftUI's own, and the disabled edge below
      // is `.disabled(true)` on the SwiftUI control.
      (handle?.onPress as (() => void) | undefined)?.();
      const seen = await waitForPresses(1);
      console.log(
        `iOS: harness taps delivered to the Button = ${String(pressLog.length)} ` +
          `(barometer ${String(rnPresses.length)}); native-held onPress invoked once`
      );
      expect(seen).toEqual(['press-me']);
      expect(pressLog.length).toBe(1);
    }

    // Nothing was ever logged for the disabled control, on either platform, and
    // the flag that drives `.disabled` / `enabled = false` really is set.
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
    // The cold half of the proof: a poisoned configuration has to be corrected.
    expect(cold.corrections).toBeGreaterThanOrEqual(1);

    await rerender(
      <Button title={LONG} testID="title" hybridRef={captureHybrid('title')} />
    );
    // `measureContent()` still answers with the short title for the frame in
    // which the new string landed, so the wait is for a *different* size, not for
    // "a size" - see `waitForRemeasure`.
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

    // Warm *now*: both configurations have been measured, so from here a turn
    // that moves the size must cost no state update at all (D17: an instance
    // whose configuration is exact in the cache lays out exact). The first
    // LONG above could not be part of this window - its provisional entry is
    // consumed exactly once, inside the turn that first measures it, and a
    // sampled window that contains that measurement is measuring the cold rule,
    // not the warm one. A node that fails to dirty its measurement after a
    // `nuiSizingKey` change has only corrections to reach the new size with, and
    // the zero below refuses them.
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
    // ...while the control did re-measure, twice. Zero corrections with zero
    // measurements would mean nothing happened, not that nothing was needed.
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

    // Both configurations measured: the warm rule, as in the title test above.
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
    // Review F1: the third R3 shape, where the size does *not* move. Every test
    // above changes a size, so each one is corrected by a report the host's
    // epsilon lets through. Here the new configuration measures what the old one
    // did, and each host skips a report within 0.5 of the size it reported last
    // (`NitroSwiftUIHost.swift:385-391`, `NitroComposeHost.kt:480-486`). The engine
    // has no answer for the new key, so the box goes to the poisoned guess, and
    // the only thing that can move it back is the very report that gets skipped:
    // the instance stays at `12.5x71.5` with the real control centred inside it.
    //
    // Both repros keep the *size* and change only the configuration, which is what
    // makes the dedupe apply:
    //  - iOS: `filled` and `elevated` are the same control (both
    //    `.borderedProminent`, `HybridNitroUiButton.swift:90-91`/`:113`), so the
    //    new key measures the size the host already reported;
    //  - Android: `systemImage` is in the key and never rendered, and its setter
    //    does not even mark the host dirty (`HybridNitroUiButton.kt:575-583`), so
    //    the control cannot change size and nothing asks Compose to measure.
    // The second is the reviewer's Android repro; the variant change works there
    // too (`filled` -> `tonal` shares its padding and minimums), which is the other
    // half of what the review listed.
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
    // No `waitForRemeasure` here: the control still measures `size`, so the box and
    // the engine's counters are the only readings that can show the fix. The settle
    // gives the correction, its flush and the re-layout one turn to land.
    await settle(500);
    const box = sizeOf('sticky');
    const after = delta(changed, stats());
    console.log(
      `same-size key change (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(measured('sticky'))} delta=${JSON.stringify(after)}`
    );
    // The visible bug first: the box is the guess, not the control.
    expect(sameSize(box, WRONG_SIZE)).toBe(false);
    expect(sameSize(box, size)).toBe(true);
    // ...and the round-trip that has to have happened to get there.
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('re-measures a title change the engine has an answer for already', async () => {
    // The `noteContentSizeMayHaveChanged()` test, and the only one that can see
    // it. The other R3 tests re-measure through a different door: their poisoned
    // entry makes Yoga resize the view, and `NitroSwiftUIHost.layoutSubviews`
    // asks for a fitting size whenever *its* frame moves — so they stay green even
    // with the size-affecting-prop notification deleted (broken and checked:
    // 10/10 green on iOS without it). So this test removes the second door by
    // planting the size the control already has as the answer for the title it is
    // about to get. The engine then answers the change with the number the box is
    // already at: no state update, no resize, no `layoutSubviews`. What is left is
    // sizing.md §5's failure verbatim — "the control re-renders at its new size
    // inside a box that still belongs to the old one, and nothing ever reports the
    // difference" — a long title painted inside a short title's box for the life of
    // the view. The only thing that can tell the engine the truth is the measure a
    // size-affecting setter asks for, so that is what the wait below waits for.
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

    // The engine's answer for the *new* configuration is the current box, to the
    // point. Provisional, so it still owes a correction — but a correction needs a
    // report, and a report needs a measure.
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
    // Nothing else can move this number: the box is not going to change, so a host
    // that was never asked for a size keeps reporting the old one.
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
    // The planted size is gone from the box, and the engine took the report: a
    // provisional entry that nothing confirmed would leave the correction queued
    // forever.
    expect(sameSize(sizeOf('notify'), shortSize)).toBe(false);
    expect(d.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('gives two titles in one row two different widths', async () => {
    // The cache-key half of R3: two instances of one component share a cached
    // size when their keys match, so a size-affecting prop left out of the key
    // makes the second control wear the first one's box. `OK` and `Cancel` differ
    // by enough that a shared size cannot be a rounding artefact, and both start
    // poisoned so neither can inherit the other's answer silently.
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
    // The environment epoch is what a Dynamic Type or density change goes
    // through: the cache is dropped, and the *mounted* instance must be corrected
    // rather than keep the box it had under the old environment (round 1 dropped
    // the ledger here, so a mounted control kept an old-environment box until it
    // remounted). `invalidateSizingEnvironment` is the same entry point
    // `traitCollectionDidChange` / `onConfigurationChanged` call, with the
    // signature check bypassed.
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
    // The box survives an environment change that did not move this control: the
    // engine keeps each configuration's own last size as the next guess, and the
    // ledger survives too, marked inexact.
    expect(sameSize(sizeOf('env'), first)).toBe(true);

    // And a size-affecting change *after* the bump still re-measures: the instance
    // is live in the new epoch, not orphaned.
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
    // The retitled control is cold in the new epoch — the cache went with the old
    // environment — so it has to be corrected; and the bump re-queued the
    // *mounted* instance as inexact (dropping the ledger there was the round-1
    // bug). Either way a real report after the bump must cost a correction, and
    // zero here would mean the engine stopped listening to this instance.
    expect(d.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('keeps a caller width in charge and truncates the label', async () => {
    // A measured size is not an override: `width` fixes the box, and the title has
    // to truncate inside it rather than paint outside (core.md §7's hit-test
    // story, in the other direction).
    //
    // What this can *assert* is the two ends of that rule, because the truncated
    // label itself is not readable from here - Compose's `Text` and SwiftUI's
    // label are both inside their hosting view, and `queryByTestId` only answers
    // for real Views:
    //  - the box is the caller's 120, and `measureContent()` is still the title's
    //    intrinsic width. A host that starts reporting the *placement* size (the way
    //    Android's did before T11 measured unbounded) puts 120 in the cache under
    //    this title, and that is the failure worth a test: every later Button with
    //    this title is 120 dp wide forever;
    //  - on Android the tap still lands. Truncation must not shrink the button out
    //    of its own box, and a barometer `Pressable` next to it says whether an
    //    empty log would mean the control or the tap.
    // Whether the label ends with an ellipsis or with a cut is what the screenshots
    // in `docs/tasks/C1-android-overwide/` show.
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
      // No harness tap reaches a hosted SwiftUI Button, for the reason written out
      // in `fires onPress once per tap and nothing when disabled`: the synthesised
      // touch carries no HID event, and SwiftUI's button gesture environment
      // refuses it. So the "still tappable once truncated" half of this contract
      // can only be asserted from here on Android; on iOS it stays with the manual
      // tap that `docs/tasks/G2-button.report.md` still has open.
      console.log(
        `iOS: harness taps delivered to the Button = ${String(pressLog.length)} ` +
          `(barometer ${String(rnPresses.length)}); not deliverable to a hosted ` +
          'SwiftUI Button, so this asserts the box and the reported size only'
      );
    }
    unmount();
  });

  it('sizes 200 distinct titles, each at its own size', async () => {
    // The list case: 200 configurations at once is what a cache-key or
    // per-instance-ledger bug looks like from the outside - a row that got a
    // neighbour's box. Titles differ by their number, so no two share a key.
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
    // Every configuration here is cold - the cache was dropped by the poison and
    // the 180 titles that were never seeded guess the component's declared
    // number, which the poison made the wrong one too - so all 200 arrive wrong
    // on their first frame and are corrected on the way. That is D17's rule, not
    // a failure: the *batch's* stale count is deliberately not gated (sizing.md
    // §3), only the synchronous-push count and the never-stale exact-cache case.
    // So the test waits for the corrections to arrive and then judges: a box that
    // is still wrong after the corrections had every chance to land is a row that
    // got a neighbour's size, which is the bug this test is for.
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
    // 200 distinct configurations, all cold: every one of them owes a correction.
    expect(d.corrections).toBeGreaterThanOrEqual(200);
    // ...and 200 cache entries, one per title. A size-affecting input missing
    // from `nuiSizingKey` collapses these into one entry and one width, which is
    // the same bug the row test above looks for at N=2.
    expect(d.cachedSizes).toBeGreaterThanOrEqual(200);
  });

  it('survives remounts with the size of each mount', async () => {
    // `RecyclableView` plus a fresh mount per cycle: the box must follow the title
    // of *this* mount, never the previous one's (a stale model, or a sizing id the
    // host kept, both look like this from outside).
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
    // A `drew` sample is the box the platform actually put on screen, so it is the
    // only reading that can show a *frame* that was wrong. Android cancels a stale
    // frame and iOS corrects inside the turn, so for a first mount whose
    // configuration is poisoned the sample must be either the planted guess (the
    // one frame D17 allows) or the real size - never a third number.
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

/* -------------------------------------------------------------------------------------
 */

/**
 * The `shape` prop (E1).
 *
 * Two claims, and they are different ones. That the corner *arrives* is a plumbing
 * claim, and the handle answers it on both platforms. That the corner is **not a
 * size** is the claim the sizing engine cares about: `shape` is deliberately absent
 * from `nuiSizingKey`, so a Button that changes corner must not open a new
 * configuration, must not be corrected, and must not move the box Yoga was told -
 * the R3 failure mode in the other direction (a prop in the key that does not
 * resize anything, which fragments the cache and spends a correction per repaint).
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

    // The heights the new size ladder actually draws, for the table in
    // `docs/components/button.md` - the small/large rungs are the two that moved.
    console.log(
      `shape ladder (square corners): small=${describeSize(
        measured('shape-small')
      )} medium=${describeSize(measured('shape-default'))} ` +
        `large=${describeSize(measured('shape-large'))}`
    );

    // And the corner is a paint: two buttons that differ only in it are the same
    // box, which is what lets `shape` stay out of the size configuration.
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

    // `null` is how a caller says "the platform's own", and it is the same paint:
    // the corner resolves back to `round` and neither change moves the box the
    // sizing engine was told about.
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

/* -------------------------------------------------------------------------------------
 */

/**
 * The `androidIcon` prop (G19): the drawable the *app* ships, named from JS.
 *
 * Three things have to be true and only one of them is a prop echo:
 *
 *  - the glyph is **drawn** in the control's content colour, not stored on the
 *    model and not drawn in something hard-coded — the pixel probe answers that
 *    one, and it is the only reading that can (G4 F1 was a colour that arrived as
 *    a prop and never reached the screen);
 *  - a name that does not resolve is **exactly the no-icon control**: no glyph, no
 *    slot, no padding change — which is the contract iOS already keeps for an SF
 *    Symbol that does not exist, and the opposite of a layout bug that only shows
 *    up in a release build where nothing warns;
 *  - the artwork does not decide the box: Material's ladder does, so a 24 dp star
 *    and a 32 x 12 slab widen the control by the same amount.
 *
 * iOS is tested here too, from the other side: `androidIcon` is a prop it accepts
 * and must never draw (`docs/components/button.md`), so on iOS every icon
 * configuration has to measure what the no-icon control measures.
 */
describe('androidIcon · the drawable the app ships (G19)', () => {
  /** Names that exist in the example app, and two that draw nothing. */
  const SHIPPED = 'nitroui_test_star';
  const WIDE_SHIPPED = 'nitroui_test_wide';
  const NOT_SHIPPED = 'nitroui_test_never_built';
  /** Resolves, but has no intrinsic size, so it cannot be rasterised (see the fixture). */
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
    /** A box that exists: a missing entry is a failed render, not an `undefined` to assert on. */
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

    // Five configurations, five poisoned keys, five corrections - the engine has to
    // have been *asked* about each one, which is also the only way this file's copy
    // of the key can be shown to still match the wrapper's.
    expect(d.corrections).toBeGreaterThanOrEqual(5);

    if (Platform.OS === 'android') {
      const plain = boxOf('plain');
      const star = boxOf('star');
      // The slot is the ladder's, so the control is wider than its no-icon self by
      // Material's icon size plus its spacing. Deliberately not a constant: the two
      // controls are each other's oracle, and a fixed expectation here would be a
      // second copy of `iconSizeFor` to go stale.
      expect(star.width).toBeGreaterThan(plain.width + 0.6);
      expect(Math.abs(star.height - plain.height)).toBeLessThan(0.6);
      // The 32 x 12 slab fits the same square slot, so it must land on the *same*
      // width. A fix that reserved the drawable's intrinsic box instead of the
      // token would pass the line above and fail here.
      expect(Math.abs(boxOf('wide').width - star.width)).toBeLessThan(0.6);
      // An unresolvable name, and a name that resolves to something with no
      // intrinsic size, are both "no icon": the same box as the control that never
      // asked, not a narrower one and not a crashed one.
      expect(sameSize(boxOf('missing'), plain)).toBe(true);
      expect(sameSize(boxOf('shape'), plain)).toBe(true);
    } else {
      // iOS draws `systemImage` and no `androidIcon`, so none of the five keys may
      // move the box. They are five keys because the platforms read one key, and
      // the engine is allowed to hold five identical answers.
      for (const [name] of configurations) {
        expect(
          sameSize(boxOf(name), boxOf('plain')),
          `iOS drew an Android icon: ${name}=${describeSize(boxOf(name))} vs plain=${describeSize(boxOf('plain'))}`
        ).toBe(true);
      }
    }
  });

  it('draws the glyph in the control content colour, and nothing at all without it', async () => {
    // A `text` Button with no title, so the *only* thing on the control that can
    // carry the content colour is the glyph: the variant has no container and no
    // border, and an empty title draws no label. That is what makes `hits` mean
    // "the icon is painted" rather than "something of this colour is somewhere".
    const tint = processColor('#FF00A0') as number;
    const TINT_CSS = '#FF00A0';
    // Android gets the empty title; iOS cannot. A `.borderless` label with nothing
    // in it measures zero wide on iOS, so there is no box to sample and the probe
    // never gets an answer to read — the harness would time out waiting for a
    // measured size, which is a broken test rather than a finding. The iOS branch
    // only ever asserts that iOS *refuses* to sample, and a titled control refuses
    // the same way, so the label costs the assertion nothing there.
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
      // The three controls that must not draw a glyph: a name that is not in the
      // app, one that is in the app but cannot be an icon, and no name at all.
      expect(hitsOf('probe-missing')).toBe(0);
      expect(hitsOf('probe-shape')).toBe(0);
      expect(hitsOf('probe-bare')).toBe(0);
      // Disabled: Material repaints the content at 38%, so the *pure* tint is no
      // longer on screen. A glyph tinted with a constant instead of the control's
      // content colour keeps its exact colour here and fails this line.
      expect(hitsOf('probe-disabled')).toBe(0);
    } else {
      // iOS has no glyph to sample, and says so in the shape the probe helper
      // refuses to read as an answer - a test that probed here was the wrong test.
      expect(reports.get('probe-icon') ?? '').toContain('no pixels');
    }
  });

  it('is the key the wrapper sends, not one this file invented', async () => {
    // The poisoned-fallback trick only works while this file's `sizingKey` matches
    // `Button.tsx`'s, and nothing but the engine can say so: a seed planted under a
    // stale key is simply never read, and every "it was corrected" assertion below
    // then passes on the declared fallback instead of on the planted size.
    //
    // So: poison a key built *here*, for a configuration with an `androidIcon`, and
    // require the engine's first `laidOut` event to carry the planted number. That
    // happens only if the wrapper asked for exactly this key - drop `androidIcon`
    // from the wrapper's key, or reorder its fields, and the first layout comes back
    // at the declared fallback and this goes red.
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
 * The two rungs D42 item 4 added.
 *
 * The JVM test in `android/src/test` pins which Material token each rung reads;
 * what only a device can say is what box that produces, because the token is not
 * the box - Material floors a control at its 48 dp minimum interactive size, which
 * is why `small` and `medium` are the same height and `xxlarge` is 136 dp and not
 * a rumour. These are also the numbers `docs/components/button.md` prints, so the
 * line the test logs is the line the docs copy.
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
    /** A rung that produced a height: a missing entry is a failed render, not `undefined`. */
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
      // Four rungs of a five-rung ladder must be strictly taller than the one
      // below - `small` and `medium` share a box because the 48 dp touch target
      // floors both, which is the one place the ladder is allowed to repeat.
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
      // are the same control there - documented, and asserted rather than assumed.
      expect(heightOf('large')).toBeLessThanOrEqual(heightOf('xlarge'));
      expect(Math.abs(heightOf('xlarge') - heightOf('xxlarge'))).toBeLessThan(
        0.6
      );
    }
  });
});

/* -------------------------------------------------------------------------------------
 */

/**
 * The `androidIcon` an app *imports* (G19 fix round 1, DECISIONS D43 item 2).
 *
 * Round 1's suite above covers the form that was already there: a drawable the app
 * ships in `res/drawable/`, named from JS, resolved by the resource table on the
 * thread that applies props. This covers the form D43 adds - the `.xml` the app
 * `require`s - and the two behave differently in one way that matters to a test:
 * a resource is there or it isn't, and a file arrives *later*. So:
 *
 *  - it **draws**: the glyph reached the screen through Metro, the parser and a
 *    `VectorPainter`, which the pixel probe is the only reading of;
 *  - the **box does not wait for it**: the slot's size comes from the size ladder,
 *    so the frame before the bytes arrive is the frame after them. Asserted from the
 *    sizing trace, not from a race - see the test for why;
 *  - a file that **is not there** draws nothing and leaves the no-icon box, which is
 *    round 1's rule for a name the resource table does not know, and the answer a
 *    404 has to give for the same reason: a slot for artwork that never comes is a
 *    layout bug the developer cannot dismiss.
 *
 * iOS runs through the same three tests and must do nothing in all of them: it draws
 * `systemImage`, ignores `androidIcon`, and this suite is where "ignores" is measured
 * for the new form too.
 */
describe('androidIcon · an icon the app imports (D43)', () => {
  /**
   * Google's Material Symbols, required the way an app requires them.
   *
   * `star_24px` is loaded by no other test in this file, deliberately: nitro-ui
   * caches a parsed file per URL for the process, so a second test asking for the
   * same URL would draw it in its first frame and quietly turn "the box did not wait
   * for the file" into a statement about a warm cache.
   */
  /** Round 1's form, for the control beside this one: a name, not a file. */
  const DRAWABLE_NAME = 'nitroui_test_star';

  /** The passing message of the box-set comparison, which doubles as its sentinel. */
  const SHARED_BOXES =
    'every box the imported icon published is one the named icon published too';
  const STAR_ASSET = require('../src/assets/icons/star_24px.xml');
  const SHARE_ASSET = require('../src/assets/icons/share_24px.xml');

  /**
   * A 2 dp diagonal stroke, and the same file compiled into the APK.
   *
   * `close` is loaded by no other test here, like `star` above, so its file still
   * arrives cold; and the two cases at the end of this suite are the only readers of
   * both, which is why the pair exists at all — one glyph, seen through each road an
   * app can name it by.
   */
  const CLOSE_ASSET = require('../src/assets/icons/close_24px.xml');
  const CLOSE_NAME = 'nitroui_test_close';

  /** A drawable that is not a vector, for the branch that keeps rasterising. */
  const RASTER_NAME = 'nitroui_test_raster';

  /**
   * The dev server this app's bundle was served from, as React Native sees it.
   *
   * The same `SourceCode.scriptURL` the wrapper reads (`src/iconSource.ts`), read
   * here rather than imported so that asking for a file Metro does not have does not
   * depend on the code under test to say where Metro is.
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

  /**
   * Probe until the glyph shows up, and say both whether it ever did and how long
   * the wait was.
   *
   * `ms` is the number the report quotes: the round trip from a Button mounting to
   * its glyph being on screen, which in development is Metro's response plus our
   * parse plus the frame - the whole cost of D43's dev-server load, and the only
   * reading of it anyone can take from a harness.
   */
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
   * Read the sizing trace until the engine goes quiet, not just until the buffer
   * happens to be empty.
   *
   * `collectTrace` returns on its predicate, which is right for "wait for a
   * correction" and wrong for "nothing else was published": an assertion that the
   * engine published exactly one box has to wait long enough to see a second one.
   * `quietMs` is that patience, `timeoutMs` the ceiling on it.
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
   * A `text` Button with no label, so the tint can only be on the glyph.
   *
   * Round 1's reason, unchanged: the variant has no container and no border, and an
   * empty title draws no label, so `hits` means "the icon is painted" rather than
   * "something this colour is on screen". iOS needs a label to sample at all, and
   * only ever asserts that it *refuses* to draw.
   */
  const TINT_CSS = '#FF00A0';
  const TINT = processColor(TINT_CSS) as number;
  const PROBE_TITLE = Platform.OS === 'android' ? '' : 'Share';

  /**
   * The imported icon draws, and the bytes arriving moves nothing.
   *
   * The sizing claim cannot be "this control published one box", and the first run
   * on a device is what said so: every Button in this repo publishes its declared
   * fallback on the cold mount and is corrected by the first measure, so two boxes
   * are normal and say nothing about the icon. What D43 promises is narrower and
   * comparative - **the file arriving changes nothing about what the engine
   * publishes** - so the control beside this one has the same icon by resource
   * name, which is never in flight, and the two must publish the same set of boxes.
   * A slot held only once the bytes land, or sized from the file's own viewport,
   * gives the Metro control a box the named control never had.
   */
  it('draws the imported icon, and does not move the box when the bytes arrive', async () => {
    nitroUiCore.setSizingTraceEnabled(true);
    // One global buffer, and the suite's earlier tests drain it only until their own
    // predicate is satisfied, so whatever they left behind would be read here as a
    // box these two Buttons published.
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

    // What crossed the bridge. In a development build this is a Metro URL with the
    // marker in front of it; the asset's numeric id would mean nothing to native,
    // and a bare name would be a resource lookup for a file that is not in the APK.
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
    // These two Buttons are the last two sizing ids allocated, and `render()` tears
    // the previous test's tree down while mounting them, so events for older ids are
    // in this window too and belong to controls this test never mounted.
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
      // 1. It drew. `hitsBefore` is the interesting half of the log line: when it is
      // 0, this test also watched the control *without* the glyph at the same box,
      // which is the in-flight state the sizing rule is about.
      expect(probeHits(drawn)).toBeGreaterThan(0);
      // 2. The box the control measured before the glyph and after it are one box.
      expect(sameSize(first, after)).toBe(true);
      // 3. Every box the imported icon published must be one the named icon published
      // too. Not "the same set": each Button starts on the component's declared
      // fallback and the engine corrects it, and how many steps that takes belongs to
      // the sizing cache's state, not to D43 - the named control here took one more
      // step than the imported one, on the same code. What must never happen is the
      // file adding a layout state of its own: a slot held only once the bytes land,
      // or sized from the file's viewport, publishes a box the resource form has
      // never published. One string, because this harness prints one line per failure.
      // Whose boxes are whose is not an assumption: the two ids are consecutive, in
      // the order this render mounted them - the imported icon's first - and each
      // published its own control's final box.
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
      // 4. And the one box both of them ended on is the ladder's, not the file's.
      expect(sameSize(named, first)).toBe(true);
    } else {
      // iOS draws no Android icon, at any size, from any source.
      expect(drawn).toContain('no pixels');
    }
  });

  it('widens the control by the ladder, not by the file it loaded', async () => {
    // Three controls, one row: an imported icon, a `res/drawable/` icon, and no
    // icon. The first two reach the same slot by different roads - one through
    // Metro and our parser, one through the resource table - and the ladder says
    // both are `iconSizeFor(scale)` wide, so they must be the same width as each
    // other. The third is what they both have to be wider than.
    //
    // `share_24px` is a second real file on purpose: its viewport is 960 units like
    // `star`'s and its path fills that box differently, so a slot sized from the
    // artwork would land on a different width for one of the two.
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
    // The Metro icon has to have actually arrived before the widths are compared:
    // an empty slot and a drawn one are the same size, which is the point of the
    // other test, and would let this one pass with nothing loading at all.
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
    // A 404 is the failure an app actually hits: the file was renamed, or Metro
    // restarted and the asset's hash moved with it. The answer has to be round 1's
    // answer for a name the resource table does not know - nothing drawn, nothing
    // reserved - because a slot held for a file that never arrives moves the label
    // for a bug that only exists while you are developing.
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
   * The ratio of tight-tolerance ink a 2 dp stroke loses when the artwork behind it
   * was rasterised at 24 dp and stretched into a 40 dp slot.
   *
   * Measured on the emulator, not reasoned out: the two cases below were run against
   * the round-1 loader, which rasterised every app drawable at the file's own size, and
   * the stretched glyph reported 0.50 of the ink the sharp one did. Fix round 2 routes
   * a `<vector>` resource through Compose's own vector loader, so both roads draw at
   * the size the slot asks for and the ratio goes to 1. `0.8` is the line between the
   * two measured states, with room for a rebuild or two to differ by a little.
   */
  const SHARP_RATIO = 0.8;

  it('draws the shipped drawable as sharply as the imported one, at the top rung', async () => {
    // One glyph, two roads, one box. Everything else in this file compares *boxes*,
    // and a box cannot see blur: round 1 rasterised a shipped `<vector>` at its own
    // 24 dp and let `ContentScale.Fit` stretch it to the 40 dp slot of `xxlarge`, so
    // every measurement passed while the release build drew a soft glyph and the
    // development build — which parses the same file as a vector — drew a sharp one.
    //
    // `close` is the fixture that tells them apart. A 2 dp diagonal has almost no
    // interior, so scaling its bitmap turns most of its pixels into a blend between the
    // glyph and the backdrop, and the probe counts only pixels that *are* the tint. The
    // control beside it asks for the same bytes over Metro, where they have always been
    // parsed and drawn at the slot's size: it is the reference, and no constant in this
    // file decides what sharp means.
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
      </View>,
      { timeout: 20000 }
    );
    for (const id of ['sharp-metro', 'sharp-name']) {
      await waitForTestId(id);
      const content = await waitForMeasured(id, id);
      await waitForBox(id, content, id);
    }
    const metro = await probeUntilDrawn('sharp-metro', TINT);
    const named = await probeUntilDrawn('sharp-name', TINT);
    const metroHits = probeHits(metro.report);
    const namedHits = probeHits(named.report);
    console.log(
      `sharp xxlarge: named=${named.report} metro=${metro.report} ` +
        `ratio=${(namedHits / Math.max(1, metroHits)).toFixed(3)}`
    );

    if (Platform.OS === 'android') {
      expect(namedHits).toBeGreaterThan(0);
      expect(metroHits).toBeGreaterThan(0);
      expect(
        namedHits >= SHARP_RATIO * metroHits
          ? 'both roads drew the glyph at the slot size'
          : `the shipped drawable drew ${namedHits} pixels of the tint and the ` +
              `imported one ${metroHits}: a stretched raster loses its thin strokes`
      ).toEqual('both roads drew the glyph at the slot size');
      // The same drawable at the rung it was authored for, measured again: 24 dp to
      // 40 dp is 2.78x the area, and a sharp glyph keeps its stroke proportions across
      // that. Round 1's answer grew the box and thinned the ink, which is the failure
      // a screenshot of one button cannot show you.
      const mediumHits = await inkAtMedium(TINT);
      expect(
        namedHits >= 2 * mediumHits
          ? 'the top rung carries its share of ink for a 40 dp slot'
          : `40 dp drew ${namedHits} pixels and 24 dp drew ${mediumHits}: ` +
              'expected at least double, and a stretched 24 dp raster is well under'
      ).toEqual('the top rung carries its share of ink for a 40 dp slot');
    } else {
      // iOS draws `systemImage`, and ignores `androidIcon` from either road — the
      // round-1 contract, restated for the new fixture pair.
      expect(named.report).toContain('no pixels');
      expect(metro.report).toContain('no pixels');
    }
  });

  /** The same shipped glyph, probed at the rung its file was authored at. */
  async function inkAtMedium(color: number): Promise<number> {
    await render(
      <View style={rowStyle}>
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
    await waitForTestId('sharp-medium');
    const content = await waitForMeasured('sharp-medium', 'sharp-medium');
    await waitForBox('sharp-medium', content, 'sharp-medium');
    const report = await probeUntilDrawn('sharp-medium', color);
    console.log(`sharp medium: ${report.report}`);
    return probeHits(report.report);
  }

  it('still draws a drawable that is not a vector, at the slot the ladder gives it', async () => {
    // The branch item 3 keeps. A `<vector>` is drawn; everything else — a PNG, a
    // layer-list, an `animated-vector` — is still rasterised at its intrinsic size and
    // tinted, and `docs/components/button.md` promises an app that names a bitmap gets
    // it drawn. Nothing on a device had ever checked that (round 1's three shipped
    // fixtures are two vectors and a sizeless shape), so a routing change that sent a
    // PNG down the vector road and back would have gone unnoticed.
    //
    // What is asserted is that it draws, and that it draws into the *same* box the
    // vector does: the slot comes from the ladder either way, which is the one rule an
    // artwork must not be able to bend.
    await render(
      <View style={rowStyle}>
        <Button
          title="Share"
          size="xxlarge"
          tintColor={TINT_CSS}
          androidIcon={RASTER_NAME}
          testID="raster-icon"
          hybridRef={captureHybrid('raster-icon')}
        />
        <Button
          title="Share"
          size="xxlarge"
          tintColor={TINT_CSS}
          androidIcon={CLOSE_NAME}
          testID="raster-vector"
          hybridRef={captureHybrid('raster-vector')}
        />
        <Button
          title="Share"
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
    // The tint the control was handed, which for a source this file owns is the only
    // colour worth asking about: `0` is what a drawable dropped on the way there says.
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
      // The ladder's box, not the file's: identical to the vector's, and wider than
      // the control with no icon at all.
      expect(sameSize(raster, vector)).toBe(true);
      expect(raster.width).toBeGreaterThan(plain.width + 1);
    } else {
      expect(sameSize(raster, plain)).toBe(true);
      expect(sameSize(raster, vector)).toBe(true);
    }
  });
});
