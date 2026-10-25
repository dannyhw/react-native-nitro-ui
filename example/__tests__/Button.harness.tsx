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
  Platform,
  Pressable,
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
  readonly variant: string;
  readonly size: string;
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
 * The key `Button.tsx` builds for a configuration: `variant|size|systemImage|title`.
 *
 * Written out here rather than imported - a harness that poisoned the cache
 * through the library's own helper could not catch the helper being wrong, and a
 * missing input in that key is precisely the R3 bug class (every later instance of
 * a different configuration inherits the first one's size).
 */
function sizingKey(
  variant: string,
  size: string,
  title: string,
  systemImage = ''
): string {
  return `${variant}|${size}|${systemImage}|${title}`;
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
