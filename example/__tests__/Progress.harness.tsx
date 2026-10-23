/**
 * On-device tests for the Progress (task G3).
 *
 * A Progress has no gestures, so a suite for it needs a different oracle from
 * Slider's "what value did the drag start at". Here it is `nuiTestDisplayedValue()`,
 * which both platforms write **where the control is drawn** - the SwiftUI body, the
 * Composable - so it reports what the drawing code was handed rather than echoing
 * the prop. A commit that stored a number without repainting the ring passes a prop
 * read and fails here.
 *
 * The other three things worth a device:
 *
 * - **the box does not move when `value` moves** - the scenario this component
 *   exists to be cheap at (60 Hz writes), and the one an iOS bug (T15 Finding 1:
 *   a hosted control re-laid out at 0 width after a `value` update) would show up
 *   in;
 * - **the animation gate**: an indeterminate indicator is the only thing in this
 *   library that draws itself forever, so `nuiTestIsAnimating()` has to say `false`
 *   for a view that is gone, and the CPU of a screen full of them is the claim
 *   behind it (`docs/components/progress.md`);
 * - **the two sizing policies**: `fillWidth` for a bar, `intrinsic` for a ring,
 *   both corrected from a poisoned cache, and a variant change that re-measures.
 */
import { Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import { Progress, nitroUiCore } from 'react-native-nitro-ui';

/**
 * Bounds of a rendered view, read straight from the harness native module.
 *
 * Same reason Switch and Slider have this: `screen.findByTestId` keeps only a
 * native id, and the only way to measure what Fabric laid out is the raw
 * `queryByTestId`.
 */
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back for a Progress.
 *
 * Declared here rather than imported: DECISIONS D14 keeps Hybrid View types off the
 * public surface in v0.1, and the two `nuiTest*` probes are a test seam, not app
 * API.
 */
type ProgressHandle = {
  readonly variant: string;
  readonly value: number | null;
  readonly tintColor: number | null;
  readonly trackColor: number | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  /** What the drawing code was handed: `displayed=<fraction>` or `=indeterminate`. */
  nuiTestDisplayedValue(): string;
  /** Whether this control is allowed to be animating right now. */
  nuiTestIsAnimating(): boolean;
};

/**
 * The box each variant is supposed to have, in platform units (DECISIONS D14).
 *
 * Measured on the two devices this task owns (`nitroui_t01` and the iPhone 17
 * simulator), from `measureContent()` and the Yoga box in the same run - which is
 * also what the component declares as its sizing fallback. A fixture that equalled
 * the declared fallback would prove nothing on its own, so the sizing test poisons
 * the *cache* with a wrong number and asserts the correction.
 * MEASURED-PLACEHOLDER: replaced with the measured numbers below.
 */
const LINEAR_HEIGHT = Platform.select({
  // MEASURED (nitroui_t01, API 35, 420 dpi): Material 3's 4 dp track is 11 whole
  // pixels there, i.e. 4.19 dp reported back - the same control iOS reports as 4.
  android: 4.19,
  // MEASURED (iPhone 17, iOS 27): SwiftUI's `.linear` ProgressView is 4 pt tall.
  default: 4,
})!;
const CIRCULAR_SIZE = Platform.select({
  // MEASURED (nitroui_t01, API 35): M3's `CircularProgressIndicator` default is a
  // 40 dp square.
  android: 40,
  // MEASURED (iPhone 17, iOS 27): SwiftUI's circular `ProgressView` lays out a
  // 20 pt ring here, not the 32 pt of a `.controlSize(.regular)` spinner.
  default: 20,
})!;

/** This component's key in the sizing engine (matches `Progress.tsx`). */
const COMPONENT = 'NitroUiProgress';
const LINEAR_KEY = '';
const CIRCULAR_KEY = 'circular';

/** Wait for a frame or two, without a magic sleep in the middle of an assertion. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a testID to exist and return its box.
 *
 * The Switch suite's reason, unchanged: `screen.findByTestId` has no timeout and a
 * hosted control only becomes queryable after it has mounted, laid out and
 * committed. The deadline is one frame clock (`nitroUiCore.now()`, DECISIONS D1) so
 * every wait in this suite shares the base the native marks use.
 */
async function waitForBox(
  testId: string,
  timeoutMs = 10000
): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
      await screen.findByTestId(testId);
      return box;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${timeoutMs}ms.`
      );
    }
    await sleep(50);
  }
}

function describeBox(box: ViewInfo | { width: number; height: number } | null) {
  if (box == null) {
    return 'null';
  }
  return `${box.width.toFixed(2)}x${box.height.toFixed(2)}`;
}

/** Wait until `read` answers non-null, or fail with the caller's message. */
async function pollUntil<T>(
  read: () => T | null,
  explain: () => Error,
  timeoutMs = 5000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) {
      return value;
    }
    if (nitroUiCore.now() > deadline) {
      throw explain();
    }
    await sleep(25);
  }
}

/** Wait until the control *displays* `expected`, or fail with what it does show. */
async function waitForDisplayed(
  handle: ProgressHandle,
  expected: string,
  timeoutMs = 5000
): Promise<void> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const shown = handle.nuiTestDisplayedValue();
    if (shown === expected) {
      return;
    }
    if (nitroUiCore.now() > deadline) {
      // Thrown rather than `expect(...).toBe`: Jest shortens long strings, and the
      // last line the drawing code wrote *is* the diagnosis.
      throw new Error(
        `Expected "${expected}" but the control reported "${shown}".`
      );
    }
    await sleep(25);
  }
}

/**
 * The `hybridRef` handles this test rendered, by `testID`.
 *
 * Keyed rather than one module-level variable (the Slider suite's reasoning): a test
 * that renders a bar and a ring would otherwise drive whichever mounted last. The
 * capture function is memoised per id because it is a callback prop - a fresh
 * closure per render would re-apply the prop (`docs/architecture/core.md` §3).
 */
const handles = new Map<string, ProgressHandle>();
const captures = new Map<string, (view: ProgressHandle) => void>();

function captureFor(testId: string): (view: ProgressHandle) => void {
  const known = captures.get(testId);
  if (known !== undefined) {
    return known;
  }
  const capture = (view: ProgressHandle) => {
    handles.set(testId, view);
  };
  captures.set(testId, capture);
  return capture;
}

/** The handle for `testId`, once the view has mounted and handed it over. */
async function handleFor(testId: string): Promise<ProgressHandle> {
  return pollUntil(
    () => handles.get(testId) ?? null,
    () => new Error(`No hybrid handle for "${testId}" (did it render?).`)
  );
}

/** The measured box of a control, once native has measured it. */
async function measuredOf(handle: ProgressHandle) {
  return pollUntil(
    () => {
      const size = handle.measureContent();
      return size.height > 0 ? size : null;
    },
    () =>
      new Error(
        `Progress never measured (last=${describeBox(handle.measureContent())}).`
      )
  );
}

afterEach(() => {
  cleanup();
  handles.clear();
});

describe('Progress', () => {
  beforeAll(async () => {
    // The Switch/Slider suite's warm-up, for the same reason: the first hosted
    // control of a process pays one-time costs (Nitro's first registry call, the
    // first `UIHostingController` / Compose composition) that exceed the harness'
    // mount timeout on a cold emulator. Every test below then measures a steady
    // state. Both variants warm up: they are two different view trees.
    const { unmount } = await render(
      <View>
        <Progress value={0.5} testID="warm-up-linear" />
        <Progress variant="circular" value={0.5} testID="warm-up-circular" />
      </View>,
      { timeout: 20000 }
    );
    unmount();
  });

  it('hosts each variant, fills the width for a bar and keeps a square for a ring', async () => {
    await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.4}
          testID="box-linear"
          hybridRef={captureFor('box-linear')}
        />
        <Progress
          variant="circular"
          value={0.4}
          testID="box-circular"
          hybridRef={captureFor('box-circular')}
        />
      </View>
    );
    const linearBox = await waitForBox('box-linear');
    const linear = await handleFor('box-linear');
    const linearMeasured = await measuredOf(linear);
    const circularBox = await waitForBox('box-circular');
    const circular = await handleFor('box-circular');
    const circularMeasured = await measuredOf(circular);
    console.log(
      `progress sizes: linearBox=${describeBox(linearBox)} ` +
        `linearMeasured=${describeBox(linearMeasured)} expectedHeight=${String(
          LINEAR_HEIGHT
        )} | circularBox=${describeBox(circularBox)} ` +
        `circularMeasured=${describeBox(circularMeasured)} expectedSize=${String(
          CIRCULAR_SIZE
        )}`
    );

    // The `fillWidth` contract for the bar: the width is the parent's, the height is
    // the control's (`docs/architecture/sizing.md` §5), and `alignSelf: 'stretch'`
    // is what hands the width over.
    expect(Math.abs(linearBox.width - 300)).toBeLessThan(1);
    expect(Math.abs(linearBox.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(linearMeasured.height - LINEAR_HEIGHT)).toBeLessThan(1);

    // The `intrinsic` contract for the ring: its own square, in a box that is its
    // own - `alignSelf: 'flex-start'` is what stops a parent's `alignItems:
    // 'stretch'` from widening it (sizing.md §6).
    expect(Math.abs(circularMeasured.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(circularMeasured.height - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(circularBox.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(circularBox.height - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(circularMeasured.width).toBeCloseTo(circularMeasured.height, 5);
  });

  it('draws the fraction it is given, including the ones an app gets wrong', async () => {
    const { rerender } = await render(
      <Progress value={0} testID="value" hybridRef={captureFor('value')} />
    );
    await waitForBox('value');
    const handle = await handleFor('value');
    await waitForDisplayed(handle, 'displayed=0.0');

    // Each of these is a *redraw* claim, not a prop echo: the string comes from the
    // SwiftUI body / the Composable.
    for (const [sent, shown] of [
      [0.25, 'displayed=0.25'],
      [0.5, 'displayed=0.5'],
      [1, 'displayed=1.0'],
      // Out of range clamps to the end it passed, and `NaN` - the unfinished
      // division - draws empty rather than propagating into a canvas.
      [1.7, 'displayed=1.0'],
      [-0.4, 'displayed=0.0'],
      [Number.NaN, 'displayed=0.0'],
    ] as [number, string][]) {
      await rerender(
        <Progress value={sent} testID="value" hybridRef={captureFor('value')} />
      );
      await waitForDisplayed(handle, shown);
      // The prop native was given, too - a round trip, so a wrong number in the
      // setter's getter is visible (`docs/architecture/core.md` §3).
      expect(
        handle.value === sent ||
          (Number.isNaN(sent) && Number.isNaN(handle.value))
      ).toBe(true);
    }
  });

  it('switches between a fraction and indeterminate', async () => {
    const { rerender } = await render(
      <Progress value={0.5} testID="mode" hybridRef={captureFor('mode')} />
    );
    await waitForBox('mode');
    const handle = await handleFor('mode');
    await waitForDisplayed(handle, 'displayed=0.5');
    expect(handle.nuiTestIsAnimating()).toBe(false);

    await rerender(
      <Progress value={null} testID="mode" hybridRef={captureFor('mode')} />
    );
    await waitForDisplayed(handle, 'displayed=indeterminate');
    // On screen and indeterminate: this is the one state in the library that is
    // allowed to animate, and the flag has to say so while it is true.
    expect(handle.nuiTestIsAnimating()).toBe(true);
    expect(handle.value).toBe(null);

    await rerender(
      <Progress value={0.25} testID="mode" hybridRef={captureFor('mode')} />
    );
    await waitForDisplayed(handle, 'displayed=0.25');
    expect(handle.nuiTestIsAnimating()).toBe(false);

    // And the ring switches the same way - the gate is in the shared
    // "what gets drawn" rule, not in one style's code path.
    //
    // `variant` is the sizing key, and a key change **remounts** the native view
    // (`Progress.tsx`), so the handle above is now the handle of a dropped view:
    // it answers with what that view last drew, forever. Drop the entry first so
    // `handleFor` waits for the view that is actually on screen rather than
    // returning the dead one that is still in the map.
    handles.delete('mode');
    await rerender(
      <Progress
        variant="circular"
        value={null}
        testID="mode"
        hybridRef={captureFor('mode')}
      />
    );
    const ring = await handleFor('mode');
    await waitForDisplayed(ring, 'displayed=indeterminate');
    expect(ring.nuiTestIsAnimating()).toBe(true);
    expect(ring.variant).toBe('circular');
  });

  it('keeps its box while the value changes 40 times', async () => {
    // The brief's 60 Hz requirement, as a layout claim: a Progress is meant to be
    // written on every frame, so a `value` change must cost a repaint and *nothing
    // else* - no re-measure, no correction, no box that moves under the app.
    //
    // This is the same shape as T15 Finding 1, where a hosted Switch came back at 0
    // width after a `value` update: it is a core-host bug, not a Progress bug, so if
    // iOS goes red here the fix is FIX2's (`docs/tasks/T15-real-input.report.md`),
    // not this component's.
    const renders = 40;
    const { rerender } = await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0}
          testID="steady-linear"
          hybridRef={captureFor('steady-linear')}
        />
        <Progress
          variant="circular"
          value={0}
          testID="steady-circular"
          hybridRef={captureFor('steady-circular')}
        />
      </View>
    );
    const linearBefore = await waitForBox('steady-linear');
    const circularBefore = await waitForBox('steady-circular');
    const linear = await handleFor('steady-linear');
    const circular = await handleFor('steady-circular');
    const linearMeasured = await measuredOf(linear);
    const circularMeasured = await measuredOf(circular);
    const statsBefore = nitroUiCore.sizingStats();

    for (let step = 1; step <= renders; step += 1) {
      const value = step === renders ? 0.5 : step / 100;
      // Awaited every time: the harness waits one render per `rerender`, and firing
      // them unawaited fails with "Element did not update within 1000ms"
      // (`docs/architecture/sizing.md` §6).
      await rerender(
        <View style={{ width: 300 }}>
          <Progress
            value={value}
            testID="steady-linear"
            hybridRef={captureFor('steady-linear')}
          />
          <Progress
            variant="circular"
            value={value}
            testID="steady-circular"
            hybridRef={captureFor('steady-circular')}
          />
        </View>
      );
    }

    await waitForDisplayed(linear, 'displayed=0.5');
    await waitForDisplayed(circular, 'displayed=0.5');

    const linearAfter = harnessUi.queryByTestId('steady-linear');
    const circularAfter = harnessUi.queryByTestId('steady-circular');
    const statsAfter = nitroUiCore.sizingStats();
    console.log(
      `60 Hz box: linear=${describeBox(linearBefore)}->${describeBox(
        linearAfter
      )} circular=${describeBox(circularBefore)}->${describeBox(circularAfter)} ` +
        `correctionsBefore=${String(
          statsBefore.correctionsImmediate + statsBefore.correctionsBatched
        )} correctionsAfter=${String(
          statsAfter.correctionsImmediate + statsAfter.correctionsBatched
        )}`
    );

    expect(linearAfter).not.toBeNull();
    expect(circularAfter).not.toBeNull();
    expect(describeBox(linearAfter)).toBe(describeBox(linearBefore));
    expect(describeBox(circularAfter)).toBe(describeBox(circularBefore));
    // The measured content did not move either, so a correction had nothing to
    // report - the box is stable *because* nothing re-measured, not by luck.
    expect(describeBox(linear.measureContent())).toBe(
      describeBox(linearMeasured)
    );
    expect(describeBox(circular.measureContent())).toBe(
      describeBox(circularMeasured)
    );
    expect(
      statsAfter.correctionsImmediate + statsAfter.correctionsBatched
    ).toBe(statsBefore.correctionsImmediate + statsBefore.correctionsBatched);
  });

  it('lays out at the declared guess and corrects a wrong cached size', async () => {
    // D17, both configurations at once. The poisoning order matters and is the
    // Slider suite's: `seedSizingSize` then `invalidateSizingEnvironment`, because
    // invalidating clears the epoch's answers and keeps each component's last known
    // size as the *guess*. Seeding afterwards would write the wrong number where it
    // reads as an exact answer instead of a guess to outrank.
    const before = nitroUiCore.sizingStats();
    const wrong = { width: 137, height: 23 };
    nitroUiCore.seedSizingSize(
      COMPONENT,
      LINEAR_KEY,
      wrong.width,
      wrong.height
    );
    nitroUiCore.seedSizingSize(
      COMPONENT,
      CIRCULAR_KEY,
      wrong.width,
      wrong.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    // The drop really happened, so both mounts below are cold.
    expect(nitroUiCore.sizingStats().environmentEpoch).toBe(
      before.environmentEpoch + 1
    );

    await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.4}
          testID="poisoned-linear"
          hybridRef={captureFor('poisoned-linear')}
        />
        <Progress
          variant="circular"
          value={0.4}
          testID="poisoned-circular"
          hybridRef={captureFor('poisoned-circular')}
        />
      </View>
    );
    const linear = await handleFor('poisoned-linear');
    const circular = await handleFor('poisoned-circular');
    const linearMeasured = await measuredOf(linear);
    const circularMeasured = await measuredOf(circular);
    //
    // D17 gives a correction one frame, so the box is *polled* until it agrees with
    // what the control measured rather than read once: reading it the moment the
    // testID becomes queryable races the flush and sometimes reports the poisoned
    // 137x23 (which Android's first run did). The starting point of the poll is the
    // poisoned guess, so agreeing is the correction having happened.
    const linearBox = await pollUntil(
      () => {
        const box = harnessUi.queryByTestId('poisoned-linear');
        // A `fillWidth` control's width is Yoga's box, not the control's own
        // (sizing.md §5), so only the height is comparable here.
        return box !== null && Math.abs(box.height - linearMeasured.height) < 1
          ? box
          : null;
      },
      () =>
        new Error(
          `The bar's box never became ${describeBox(
            linearMeasured
          )} tall (last=${describeBox(
            harnessUi.queryByTestId('poisoned-linear')
          )}, guess was ${wrong.width}x${wrong.height}).`
        )
    );
    const circularBox = await pollUntil(
      () => {
        const box = harnessUi.queryByTestId('poisoned-circular');
        return box !== null &&
          Math.abs(box.width - circularMeasured.width) < 1 &&
          Math.abs(box.height - circularMeasured.height) < 1
          ? box
          : null;
      },
      () =>
        new Error(
          `The ring's box never became ${describeBox(
            circularMeasured
          )} (last=${describeBox(
            harnessUi.queryByTestId('poisoned-circular')
          )}, guess was ${wrong.width}x${wrong.height}).`
        )
    );
    const stats = nitroUiCore.sizingStats();
    console.log(
      `poison: guess=${wrong.width}x${wrong.height} ` +
        `linearBox=${describeBox(linearBox)} circularBox=${describeBox(circularBox)} ` +
        `linearMeasured=${describeBox(linear.measureContent())} ` +
        `circularMeasured=${describeBox(circular.measureContent())} ` +
        `epoch=${String(stats.environmentEpoch)}`
    );

    // The guess is a guess, not an answer: the control outranks it. A bar that never
    // corrected would be 23 tall here, and a ring that never corrected would be
    // 137x23 - the linear-shaped guess, which is exactly the one-frame case
    // `docs/components/progress.md` documents for a cold ring.
    // Two separate claims: the box became what the control measured (the
    // correction happened), and what it measured is the control's real size. The
    // first alone would pass for a control that measured itself wrongly.
    expect(Math.abs(linearMeasured.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(circularMeasured.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(circularMeasured.height - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(linearBox.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(circularBox.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(
      stats.correctionsImmediate + stats.correctionsBatched
    ).toBeGreaterThan(before.correctionsImmediate + before.correctionsBatched);

    // Self-healing: both measurements are the cache's now, so a second mount of
    // either configuration costs no correction at all.
    const after = nitroUiCore.sizingStats();
    await render(
      <View style={{ width: 300 }}>
        <Progress value={0.4} testID="repaired-linear" />
        <Progress variant="circular" value={0.4} testID="repaired-circular" />
      </View>
    );
    const repairedLinear = await waitForBox('repaired-linear');
    const repairedCircular = await waitForBox('repaired-circular');
    const next = nitroUiCore.sizingStats();
    console.log(
      `repaired: linear=${describeBox(repairedLinear)} circular=${describeBox(
        repairedCircular
      )}`
    );
    expect(Math.abs(repairedLinear.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(repairedCircular.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(
      next.correctionsImmediate +
        next.correctionsBatched -
        (after.correctionsImmediate + after.correctionsBatched)
    ).toBe(0);
  });

  it('re-measures when the variant changes', async () => {
    // `variant` is the only prop that changes a Progress's size, and it is the whole
    // sizing key - so the box has to follow it on both platforms. It also remounts
    // the native view (`Progress.tsx`), because Android fixes its sizing question
    // when the composition is built; what a caller sees is a control that becomes
    // the other shape.
    const { rerender } = await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.6}
          testID="variant"
          hybridRef={captureFor('variant')}
        />
      </View>
    );
    const asLinear = await waitForBox('variant');
    await handleFor('variant');
    expect(Math.abs(asLinear.height - LINEAR_HEIGHT)).toBeLessThan(1);

    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          variant="circular"
          value={0.6}
          testID="variant"
          hybridRef={captureFor('variant')}
        />
      </View>
    );
    const variantHandle = await handleFor('variant');
    const circularMeasured = await measuredOf(variantHandle);
    // The box the *new* configuration asks for, not the one the old one had.
    await waitFor(
      async () => {
        const box = harnessUi.queryByTestId('variant');
        expect(box).not.toBeNull();
        expect(Math.abs(box!.width - CIRCULAR_SIZE)).toBeLessThan(1);
        expect(Math.abs(box!.height - CIRCULAR_SIZE)).toBeLessThan(1);
      },
      { timeout: 5000 }
    );
    expect(variantHandle.variant).toBe('circular');
    // Still the same value, drawn by the new view - a remount must not lose the
    // fraction the app is on.
    await waitForDisplayed(variantHandle, 'displayed=0.6');
    console.log(
      `variant: linear=${describeBox(asLinear)} circularMeasured=${describeBox(
        circularMeasured
      )}`
    );

    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          value={0.6}
          testID="variant"
          hybridRef={captureFor('variant')}
        />
      </View>
    );
    const backToLinear = await waitForBox('variant');
    expect(Math.abs(backToLinear.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(backToLinear.width - 300)).toBeLessThan(1);
    await waitForDisplayed(await handleFor('variant'), 'displayed=0.6');
  });

  it('honours an explicit size instead of its own box', async () => {
    await render(
      <Progress
        value={0.5}
        style={{ width: 180, height: 60 }}
        testID="sized"
        hybridRef={captureFor('sized')}
      />
    );
    const box = await waitForBox('sized');
    const handle = await handleFor('sized');
    const measured = await measuredOf(handle);
    console.log(
      `user style: box=${describeBox(box)} measured=${describeBox(measured)}`
    );
    // A caller's `style` outranks the control's own box (sizing.md §6): 180x60
    // because they were fixed, and the control stays its own size inside them.
    expect(Math.abs(box.width - 180)).toBeLessThan(1);
    expect(Math.abs(box.height - 60)).toBeLessThan(1);
    expect(Math.abs(measured.height - LINEAR_HEIGHT)).toBeLessThan(1);
  });

  it('labels the control and states its value to a screen reader', async () => {
    const { rerender } = await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.25}
          accessibilityLabel="Upload"
          testID="labelled"
          hybridRef={captureFor('labelled')}
        />
      </View>
    );
    const box = await waitForBox('labelled');
    const handle = await handleFor('labelled');
    // The label belongs on the hosted control, never on the container
    // (`docs/architecture/core.md` §3), so how far the harness can *see* it depends
    // on what each platform's a11y tree is made of - the same asymmetry Slider
    // documented: iOS exposes UIElements with their `accessibilityLabel`, while
    // Compose publishes `SemanticsNode`s that are not Views, so the harness'
    // `View.contentDescription` walk finds nothing on Android no matter what the
    // component does. Asserting the label reached the control is the honest
    // strongest check there; `docs/components/progress.md` records what each
    // screen reader announces.
    const labelled = harnessUi.queryByAccessibilityLabel('Upload');
    console.log(
      `a11y: box=${describeBox(box)} labelBox=${describeBox(labelled)} ` +
        `handleLabel=${String(handle.accessibilityLabel)}`
    );
    expect(handle.accessibilityLabel).toBe('Upload');
    if (Platform.OS === 'ios') {
      expect(labelled).not.toBeNull();
      expect(Math.abs(labelled!.width - box.width)).toBeLessThan(2);
    }

    // The value travels with it: an indeterminate indicator has no percentage to
    // say, and a determinate one says the rounded whole (`ProgressModel.percent` on
    // both platforms).
    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          value={null}
          accessibilityLabel="Upload"
          testID="labelled"
          hybridRef={captureFor('labelled')}
        />
      </View>
    );
    await waitForDisplayed(handle, 'displayed=indeterminate');
    expect(handle.accessibilityLabel).toBe('Upload');
  });

  it('animates while it is on screen and stops when it is gone', async () => {
    // The CPU claim: an indeterminate indicator is the library's only self-drawing
    // control, and it must not keep asking for frames once nothing can see it.
    const first = await render(
      <Progress testID="spinning" hybridRef={captureFor('spinning')} />
    );
    await waitForBox('spinning');
    const spinning = await handleFor('spinning');
    await waitForDisplayed(spinning, 'displayed=indeterminate');
    await waitFor(() => expect(spinning.nuiTestIsAnimating()).toBe(true));

    first.unmount();
    // The gate closes on the way out, not on a timer: `onDropView` / the detach say
    // so before the composition or hosting controller goes away.
    await waitFor(() => expect(spinning.nuiTestIsAnimating()).toBe(false));

    // A dropped view must not stay "animating" for its next owner either. iOS
    // recycles the same Hybrid View here (measured in the Slider suite), so the
    // handle below can be the same object with the recycle in between - and a
    // `prepareForRecycle` that forgot the flag would show up as `true` on a control
    // whose next owner asked for a determinate bar.
    const { unmount } = await render(
      <Progress
        value={0.3}
        testID="next-owner"
        hybridRef={captureFor('next-owner')}
      />
    );
    await waitForBox('next-owner');
    const nextHandle = await handleFor('next-owner');
    await waitForDisplayed(nextHandle, 'displayed=0.3');
    console.log(
      `gate: reused=${String(nextHandle === spinning)} ` +
        `animating=${String(nextHandle.nuiTestIsAnimating())}`
    );
    expect(nextHandle.nuiTestIsAnimating()).toBe(false);
    unmount();
  });

  it('survives mounting and unmounting repeatedly', async () => {
    // Each cycle disposes a composition / hosting controller and builds a new one
    // through `onDropView`, the path a screen transition takes - and Progress adds
    // the animation gate to what has to be reset each time.
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const { unmount } = await render(
        <Progress
          value={cycle % 2 === 0 ? null : cycle / 40}
          variant={cycle % 3 === 0 ? 'circular' : 'linear'}
          testID={`cycle-${cycle}`}
        />
      );
      unmount();
    }

    const { unmount } = await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.75}
          testID="after-cycles"
          hybridRef={captureFor('after-cycles')}
        />
      </View>
    );
    const box = await waitForBox('after-cycles');
    const handle = await handleFor('after-cycles');
    await waitForDisplayed(handle, 'displayed=0.75');
    const measured = await measuredOf(handle);
    expect(Math.abs(box.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(measured.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(handle.nuiTestIsAnimating()).toBe(false);
    unmount();
  });

  it('mounts many instances at once', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => index);
    // 40 hosted controls, both variants and both modes mixed - the stress case, and
    // slower than the harness' 1000ms default: one `UIHostingController` / Compose
    // composition each has to be built, laid out and committed. Own timeout, and the
    // time is logged so the bench has a second opinion.
    const startedAt = nitroUiCore.now();
    const { unmount } = await render(
      <View>
        {rows.map((row) => (
          <Progress
            key={row}
            variant={row % 2 === 0 ? 'linear' : 'circular'}
            value={row % 3 === 0 ? null : row / 40}
            testID={`many-${row}`}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    for (const row of rows) {
      await waitForBox(`many-${row}`, 20000);
    }
    const elapsed = nitroUiCore.now() - startedAt;
    console.log(`40 instances: ${elapsed.toFixed(1)}ms`);
    // A budget an order of magnitude above what the platforms take (the T10 suite's
    // reasoning) - enough to catch a regression, loose enough not to be a bench.
    expect(elapsed).toBeLessThan(10000);
    unmount();
  });

  it('commits once per update at 60 Hz', async () => {
    // The perf contract, measured rather than asserted in a comment: `afterUpdate()`
    // is one `commit()` and nothing else, so 20 awaited writes cost 20 `propsApplied`
    // marks - not one per prop, and not zero because a write was coalesced away.
    // Both platforms mark every commit / `updateState` (`core.md` §8).
    const updates = 20;
    const instanceId = 41;
    nitroUiCore.setPerfEnabled(true);
    try {
      nitroUiCore.drainPerf();
      const { rerender, unmount } = await render(
        <Progress
          value={0}
          testID="marked"
          nuiPerfId={instanceId}
          hybridRef={captureFor('marked')}
        />
      );
      await waitForBox('marked');
      await handleFor('marked');

      // `drainPerf()` consumes the buffer, so every poll keeps what it read (the
      // Switch suite's trap: the first poll eats the marks it waits for).
      const kinds: string[] = [];
      await waitFor(
        () => {
          for (const event of nitroUiCore.drainPerf()) {
            if (event.instanceId === instanceId) {
              kinds.push(event.kind);
            }
          }
          expect(kinds).toEqual(
            expect.arrayContaining(['propsApplied', 'firstFrame'])
          );
        },
        { timeout: 3000 }
      );

      for (let step = 1; step <= updates; step += 1) {
        await rerender(
          <Progress
            value={step / updates}
            testID="marked"
            nuiPerfId={instanceId}
            hybridRef={captureFor('marked')}
          />
        );
      }
      const applied: number[] = [];
      const firstFrames: number[] = [];
      await waitFor(
        () => {
          for (const event of nitroUiCore.drainPerf()) {
            if (event.instanceId === instanceId) {
              if (event.kind === 'propsApplied') applied.push(event.instanceId);
              if (event.kind === 'firstFrame')
                firstFrames.push(event.instanceId);
            }
          }
          expect(applied.length).toBeGreaterThanOrEqual(updates);
        },
        { timeout: 5000 }
      );
      console.log(
        `perf: updates=${updates} propsApplied=${applied.length} firstFrame=${firstFrames.length}`
      );
      // One frame for one instance, however many writes followed it.
      //
      // `drainPerf()` *consumes*, so the mount's `firstFrame` was read by the poll
      // above and cannot be read again here: the count is the union of both polls.
      // Asserting only on this phase's reads would ask for a second first frame,
      // which the host deliberately does not send (`hasMarkedFirstFrame`).
      const firstFrameCount =
        kinds.filter((kind) => kind === 'firstFrame').length +
        firstFrames.length;
      expect(firstFrameCount).toBe(1);
      unmount();

      // And a dropped view stops marking: mount a *different* instance, wait for its
      // marks, and only then is it meaningful that the dropped one added none.
      nitroUiCore.drainPerf();
      const { unmount: unmountNext } = await render(
        <Progress value={0.5} testID="marked-next" nuiPerfId={42} />
      );
      await waitForBox('marked-next');
      const later: number[] = [];
      await waitFor(
        () => {
          for (const event of nitroUiCore.drainPerf()) {
            if (event.kind === 'propsApplied') later.push(event.instanceId);
          }
          expect(later).toEqual(expect.arrayContaining([42]));
        },
        { timeout: 3000 }
      );
      expect(later).not.toContain(instanceId);
      unmountNext();
    } finally {
      nitroUiCore.setPerfEnabled(false);
      nitroUiCore.drainPerf();
    }
  });
});
