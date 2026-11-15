import {
  PixelRatio,
  Platform,
  processColor,
  TurboModuleRegistry,
  View,
} from 'react-native';
import {
  afterEach,
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
 * Bounds of a rendered view. `screen.findByTestId` keeps only a native id, so
 * the raw `queryByTestId` is the only way to read the box Fabric laid out.
 */
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** Declared here: Hybrid View types are not part of the public API. */
type ProgressHandle = {
  readonly variant: string;
  /** `'flat'` or `'wavy'` - answered on iOS too, where nothing draws it. */
  readonly appearance: string;
  readonly contained: boolean;
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

/** The size each variant measures, in platform units. */
const LINEAR_HEIGHT = Platform.select({
  // Material 3's 4 dp track is 11 whole pixels at 420 dpi, reported as 4.19 dp.
  android: 4.19,
  // SwiftUI's `.linear` ProgressView is 4 pt tall.
  default: 4,
})!;
const CIRCULAR_SIZE = Platform.select({
  // Material 3's `CircularProgressIndicator` defaults to a 40 dp square.
  android: 40,
  // SwiftUI's circular `ProgressView` lays out a 20 pt ring.
  default: 20,
})!;

/** This component's key in the sizing engine (matches `Progress.tsx`). */
const COMPONENT = 'NitroUiProgress';
const LINEAR_KEY = '';
const CIRCULAR_KEY = 'circular';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a testID to exist and return its box. `screen.findByTestId` has no
 * timeout, and a hosted control is only queryable once it has mounted, laid
 * out and committed.
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
      // Thrown rather than `expect(...).toBe`: Jest shortens long strings.
      throw new Error(
        `Expected "${expected}" but the control reported "${shown}".`
      );
    }
    await sleep(25);
  }
}

/**
 * The `hybridRef` handles this test rendered, by `testID`. The capture function
 * is memoised per id: it is a callback prop, and a fresh closure per render
 * would re-apply the prop.
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

async function handleFor(testId: string): Promise<ProgressHandle> {
  return pollUntil(
    () => handles.get(testId) ?? null,
    () => new Error(`No hybrid handle for "${testId}" (did it render?).`)
  );
}

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

/**
 * The size each wavy or loading configuration measures, in platform units.
 * SwiftUI has neither a wavy indicator nor a loading one, so the iOS sizes are
 * the flat control's.
 */
const LINEAR_WAVY_HEIGHT = Platform.select({
  // 10 dp, the wave's own container height.
  android: 10,
  // iOS paints the flat bar whatever `appearance` says.
  default: 4,
})!;
const CIRCULAR_WAVY_SIZE = Platform.select({
  // Material's `CircularWavyProgressIndicator` is a 48 dp square.
  android: 48,
  default: 20,
})!;
const LOADING_SIZE = Platform.select({
  // `LoadingIndicator`'s container is 48 dp (its shape is 38 dp inside it).
  android: 48,
  // iOS answers `loading` with the same circular `ProgressView` as `circular`.
  default: 20,
})!;

/**
 * One configuration of the control. The sizing key is written out per row, not
 * built with the library's helper, so a helper that forgot an input shows up.
 */
type Configuration = {
  /** Also the `testID`, and the label in every failure message. */
  name: string;
  variant: 'linear' | 'circular' | 'loading';
  appearance?: 'flat' | 'wavy';
  contained?: boolean;
  key: string;
  /** `bar` is `fillWidth` (only the height is the control's); `square` is `intrinsic`. */
  policy: 'bar' | 'square';
  size: number;
};

const CONFIGURATIONS: ReadonlyArray<Configuration> = [
  {
    name: 'linear-flat',
    variant: 'linear',
    key: '',
    policy: 'bar',
    size: LINEAR_HEIGHT,
  },
  {
    name: 'linear-wavy',
    variant: 'linear',
    appearance: 'wavy',
    key: 'wavy',
    policy: 'bar',
    size: LINEAR_WAVY_HEIGHT,
  },
  {
    name: 'circular-flat',
    variant: 'circular',
    key: 'circular',
    policy: 'square',
    size: CIRCULAR_SIZE,
  },
  {
    name: 'circular-wavy',
    variant: 'circular',
    appearance: 'wavy',
    key: 'circular|wavy',
    policy: 'square',
    size: CIRCULAR_WAVY_SIZE,
  },
  {
    name: 'loading',
    variant: 'loading',
    key: 'loading',
    policy: 'square',
    size: LOADING_SIZE,
  },
  {
    name: 'loading-contained',
    variant: 'loading',
    contained: true,
    key: 'loading|contained',
    policy: 'square',
    size: LOADING_SIZE,
  },
];

/**
 * What {@link NitroUiProbe.paintedInk} answers: the control's box, and how much
 * of it is the colour that was asked for (`-1` on either axis when nothing
 * matched). Every number is in whole screen pixels, not dp.
 */
type Ink = {
  width: number;
  height: number;
  inkCount: number;
  inkWidth: number;
  inkHeight: number;
  attempts: number;
  /** Pixels in the box that drew anything at all - a black copy reads as zero ink. */
  opaqueCount: number;
  /** The most frequent of those, unsigned ARGB, and how many pixels it is. */
  topColor: number;
  topColorCount: number;
};
type ProbeModule = {
  paintedInk(
    testTag: string,
    colorArgb: number,
    tolerance: number
  ): Promise<Ink>;
  /** Take one control out of its parent, and put it back where it came from. */
  detachTaggedView(testTag: string): Promise<string>;
  attachTaggedView(testTag: string): Promise<string>;
};

let probe: ProbeModule | null = null;

/**
 * Android-only and fetched lazily: `TurboModuleRegistry.getEnforcing` throws on
 * iOS, where the module does not exist and this file still has to load.
 */
async function probeModule(): Promise<ProbeModule> {
  if (probe == null) {
    probe = TurboModuleRegistry.getEnforcing(
      'NitroUiProbe'
    ) as unknown as ProbeModule;
  }
  return probe;
}

/**
 * The pixels of one control's box that are `colorArgb`, within a channel
 * tolerance wide enough for the antialiased edges of a stroke.
 */
async function probeInk(testId: string, colorArgb: number): Promise<Ink> {
  const inkModule = await probeModule();
  const box = await waitForBox(testId);
  // Settle first: the frame just composited may be the one before the props
  // landed.
  await sleep(250);
  const ink = await inkModule.paintedInk(testId, colorArgb, 26);
  // The tree reports dp and the window pixels: check the probe read the same
  // rectangle.
  const px = PixelRatio.get();
  expect(
    Math.abs(ink.width - box.width * px),
    `${testId} is ${box.width}x${box.height} dp in the tree and ` +
      `${ink.width}x${ink.height} px on screen at ${px} px/dp`
  ).toBeLessThanOrEqual(2);
  return ink;
}

describe('Progress', () => {
  // No `beforeAll` warm-up: it would hide the cold first-mount path from every
  // test. The first test mounts the process's first hosted control and carries
  // its own longer timeout instead.
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
      </View>,
      { timeout: 20000 }
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

    // The bar: the width is the parent's, the height is the control's.
    expect(Math.abs(linearBox.width - 300)).toBeLessThan(1);
    expect(Math.abs(linearBox.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(linearMeasured.height - LINEAR_HEIGHT)).toBeLessThan(1);
    // The width the control drew, not only its box: Material 3's indicator has
    // a 240 dp default width of its own.
    expect(Math.abs(linearMeasured.width - 300)).toBeLessThan(1);

    // The ring: its own square, which a stretching parent must not widen.
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

    // The string is written where the control is drawn (the SwiftUI body, the
    // Composable), so each match is a redraw and not a prop echo.
    for (const [sent, shown] of [
      [0.25, 'displayed=0.25'],
      [0.5, 'displayed=0.5'],
      [1, 'displayed=1.0'],
      // Out of range clamps to the nearer end, and `NaN` draws empty.
      [1.7, 'displayed=1.0'],
      [-0.4, 'displayed=0.0'],
      [Number.NaN, 'displayed=0.0'],
    ] as [number, string][]) {
      await rerender(
        <Progress value={sent} testID="value" hybridRef={captureFor('value')} />
      );
      await waitForDisplayed(handle, shown);
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
    expect(handle.nuiTestIsAnimating()).toBe(true);
    expect(handle.value).toBe(null);

    await rerender(
      <Progress value={0.25} testID="mode" hybridRef={captureFor('mode')} />
    );
    await waitForDisplayed(handle, 'displayed=0.25');
    expect(handle.nuiTestIsAnimating()).toBe(false);

    // A `variant` change remounts the native view, and the old handle goes on
    // answering for the dropped one. Drop the entry so `handleFor` waits for the
    // view that is on screen.
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
    // A `value` change must cost a repaint and nothing else: no re-measure, no
    // correction, no box that moves.
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
      // Awaited every time: the harness waits one render per `rerender`, and
      // unawaited ones fail with "Element did not update within 1000ms".
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
    // Seed, then invalidate: invalidating clears the exact answers and keeps each
    // last known size as the guess. Seeding afterwards would store the wrong
    // size as an exact answer.
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
    // A correction takes a frame, so the box is polled until it agrees with what
    // the control measured: read once, it can still be the poisoned guess.
    const linearBox = await pollUntil(
      () => {
        const box = harnessUi.queryByTestId('poisoned-linear');
        // The bar's width is the parent's, so only the height is comparable.
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

    // Two claims: the box became what the control measured, and what it measured
    // is the control's real size.
    expect(Math.abs(linearMeasured.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(circularMeasured.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(circularMeasured.height - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(linearBox.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(circularBox.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(
      stats.correctionsImmediate + stats.correctionsBatched
    ).toBeGreaterThan(before.correctionsImmediate + before.correctionsBatched);

    // Both measurements are cached now, so a second mount of either
    // configuration costs no correction.
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
    // A `variant` change remounts the native view: Android fixes how a control
    // is sized when its composition is built.
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
    // A remount must not lose the value.
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

  it('re-measures a variant change that starts from a poisoned guess', async () => {
    // A `variant` change remounts, and the dropped view forgets its sizing id on
    // the way out. A new mount that reused the id would lose its own sizing
    // entry and could never be corrected, so the circular key is poisoned here
    // to make a correction the only way to the right box.
    const wrong = { width: 137, height: 23 };
    nitroUiCore.seedSizingSize(
      COMPONENT,
      CIRCULAR_KEY,
      wrong.width,
      wrong.height
    );
    nitroUiCore.invalidateSizingEnvironment();

    const { rerender } = await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.6}
          testID="variant-poison"
          hybridRef={captureFor('variant-poison')}
        />
      </View>,
      { timeout: 20000 }
    );
    const asLinear = await waitForBox('variant-poison');
    await handleFor('variant-poison');
    expect(Math.abs(asLinear.height - LINEAR_HEIGHT)).toBeLessThan(1);

    // A dropped view does not revoke its handle: drop the linear one, or the
    // poll below would measure the view that is going away.
    handles.delete('variant-poison');
    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          variant="circular"
          value={0.6}
          testID="variant-poison"
          hybridRef={captureFor('variant-poison')}
        />
      </View>
    );
    const handle = await handleFor('variant-poison');
    expect(handle.variant).toBe('circular');
    const measured = await measuredOf(handle);
    // Polled, not read once: the correction takes a frame.
    const box = await pollUntil(
      () => {
        const found = harnessUi.queryByTestId('variant-poison');
        return found !== null &&
          Math.abs(found.width - measured.width) < 1 &&
          Math.abs(found.height - measured.height) < 1
          ? found
          : null;
      },
      () =>
        new Error(
          `The ring never corrected the poisoned guess: box=${describeBox(
            harnessUi.queryByTestId('variant-poison')
          )} measured=${describeBox(measured)} guess=${String(
            wrong.width
          )}x${String(wrong.height)} (a dropped view's forget() likely wiped the new mount's ledger entry).`
        )
    );
    console.log(
      `variant poison: linear=${describeBox(asLinear)} box=${describeBox(
        box
      )} measured=${describeBox(measured)} guess=${wrong.width}x${wrong.height}`
    );
    expect(Math.abs(measured.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(measured.height - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(box.width - CIRCULAR_SIZE)).toBeLessThan(1);
    expect(Math.abs(box.height - CIRCULAR_SIZE)).toBeLessThan(1);
    await waitForDisplayed(handle, 'displayed=0.6');
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
    // The control keeps its own size inside the box the caller fixed.
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
    // The label is set on the hosted control. iOS exposes it as an accessibility
    // element the harness can find; Compose publishes semantics nodes that are
    // not Views, so on Android only the handle can be checked.
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
    const first = await render(
      <Progress testID="spinning" hybridRef={captureFor('spinning')} />
    );
    await waitForBox('spinning');
    const spinning = await handleFor('spinning');
    await waitForDisplayed(spinning, 'displayed=indeterminate');
    await waitFor(() => expect(spinning.nuiTestIsAnimating()).toBe(true));

    first.unmount();
    await waitFor(() => expect(spinning.nuiTestIsAnimating()).toBe(false));

    // iOS recycles the dropped native view, so the next owner can be the same
    // object and must not inherit "animating".
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
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const configuration = CONFIGURATIONS[cycle % CONFIGURATIONS.length]!;
      const { unmount } = await render(
        <Progress
          {...configurationProps(configuration)}
          value={cycle % 2 === 0 ? null : cycle / 40}
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
    // Nothing of the last cycle's configuration is left on a recycled view.
    expect(handle.variant).toBe('linear');
    expect(handle.appearance).toBe('flat');
    expect(handle.contained).toBe(false);
    unmount();
  });

  it('commits once per update at 60 Hz', async () => {
    // Native marks `propsApplied` once per commit, so 20 awaited writes are 20
    // marks: not one per prop, and none coalesced away.
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

      // `drainPerf()` consumes the buffer, so every poll keeps what it read.
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
      const readMarks = () => {
        for (const event of nitroUiCore.drainPerf()) {
          if (event.instanceId === instanceId) {
            if (event.kind === 'propsApplied') applied.push(event.instanceId);
            if (event.kind === 'firstFrame') firstFrames.push(event.instanceId);
          }
        }
      };
      // Settle first, count after: a poll that stops at the first sight of 20
      // marks cannot fail on 21.
      await waitFor(
        () => {
          readMarks();
          expect(applied.length).toBeGreaterThanOrEqual(updates);
        },
        { timeout: 5000 }
      );
      // Grace for a path that commits twice per update: the extra mark is at
      // most a frame behind the real one.
      await sleep(500);
      readMarks();
      expect(applied.length).toBe(updates);
      console.log(
        `perf: updates=${updates} propsApplied=${applied.length} firstFrame=${firstFrames.length}`
      );
      // The mount's `firstFrame` was consumed by the first poll, so the count is
      // the union of both polls.
      const firstFrameCount =
        kinds.filter((kind) => kind === 'firstFrame').length +
        firstFrames.length;
      expect(firstFrameCount).toBe(1);
      unmount();

      // A dropped view stops marking. Wait for a different instance's marks
      // first, so that the dropped one's silence means something.
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

  /* `variant="loading"` and `appearance="wavy"` */

  it('lays every configuration out at the size it measures', async () => {
    // The component declares one fallback size for all six configurations, so
    // each row is checked against its own size, from a guess no Progress has.
    const before = nitroUiCore.sizingStats();
    const wrong = { width: 137, height: 23 };
    for (const configuration of CONFIGURATIONS) {
      nitroUiCore.seedSizingSize(
        COMPONENT,
        configuration.key,
        wrong.width,
        wrong.height
      );
    }
    nitroUiCore.invalidateSizingEnvironment();
    expect(nitroUiCore.sizingStats().environmentEpoch).toBe(
      before.environmentEpoch + 1
    );
    const correctionsBefore =
      before.correctionsImmediate + before.correctionsBatched;

    await render(
      <View style={{ width: 300 }}>
        {CONFIGURATIONS.map((configuration) => (
          <Progress
            key={configuration.name}
            {...configurationProps(configuration)}
            value={0.4}
            testID={configuration.name}
            hybridRef={captureFor(configuration.name)}
          />
        ))}
      </View>
    );

    for (const configuration of CONFIGURATIONS) {
      const handle = await handleFor(configuration.name);
      const measured = await measuredOf(handle);
      expect(
        Math.abs(measured.height - configuration.size),
        `${configuration.name} height`
      ).toBeLessThan(1);
      if (configuration.policy === 'square') {
        expect(
          Math.abs(measured.width - configuration.size),
          `${configuration.name} width`
        ).toBeLessThan(1);
      }
      // Polled, not read once: a cold configuration's correction takes a frame.
      const box = await pollUntil(
        () => {
          const candidate = harnessUi.queryByTestId(configuration.name);
          if (candidate == null) {
            return null;
          }
          if (Math.abs(candidate.height - measured.height) >= 1) {
            return null;
          }
          return configuration.policy === 'square' &&
            Math.abs(candidate.width - measured.width) >= 1
            ? null
            : candidate;
        },
        () =>
          new Error(
            `${configuration.name}'s box never became ${describeBox(
              measured
            )} (last=${describeBox(
              harnessUi.queryByTestId(configuration.name)
            )}, guess was ${wrong.width}x${wrong.height}).`
          )
      );
      expect(handle.variant).toBe(configuration.variant);
      expect(handle.appearance).toBe(configuration.appearance ?? 'flat');
      expect(handle.contained).toBe(configuration.contained ?? false);
      await waitForDisplayed(handle, 'displayed=0.4');
      console.log(
        `configuration ${configuration.name}: key="${configuration.key}" ` +
          `measured=${describeBox(measured)} box=${describeBox(box)} ` +
          `expected=${configuration.size}`
      );
    }

    const after = nitroUiCore.sizingStats();
    expect(
      after.correctionsImmediate + after.correctionsBatched
    ).toBeGreaterThan(correctionsBefore);

    // Every measurement is cached now, so a second mount of each configuration
    // costs no correction.
    await render(
      <View style={{ width: 300 }}>
        {CONFIGURATIONS.map((configuration) => (
          <Progress
            key={configuration.name}
            {...configurationProps(configuration)}
            value={0.4}
            testID={`warm-${configuration.name}`}
          />
        ))}
      </View>
    );
    const warmCorrectionsBefore =
      nitroUiCore.sizingStats().correctionsImmediate +
      nitroUiCore.sizingStats().correctionsBatched;
    for (const configuration of CONFIGURATIONS) {
      const box = await waitForBox(`warm-${configuration.name}`);
      if (configuration.policy === 'square') {
        expect(Math.abs(box.width - configuration.size)).toBeLessThan(1);
      }
      expect(Math.abs(box.height - configuration.size)).toBeLessThan(1);
    }
    const warm = nitroUiCore.sizingStats();
    expect(
      warm.correctionsImmediate +
        warm.correctionsBatched -
        warmCorrectionsBefore
    ).toBe(0);
  });

  it('re-measures an appearance change on the same view', async () => {
    // `appearance` changes the size without a remount: the bar still fills its
    // parent's width, so the new height has to arrive on the same native view.
    const { rerender } = await render(
      <View style={{ width: 300 }}>
        <Progress
          value={0.5}
          testID="appearance"
          hybridRef={captureFor('appearance')}
        />
      </View>
    );
    const flatBox = await waitForBox('appearance');
    const handle = await handleFor('appearance');
    const flatMeasured = await measuredOf(handle);
    expect(Math.abs(flatBox.height - LINEAR_HEIGHT)).toBeLessThan(1);
    expect(handle.appearance).toBe('flat');
    // An earlier test left the `wavy` entry exact, so it is poisoned to make the
    // re-measure cost a correction. 71 is neither the flat bar's height nor the
    // wave's.
    nitroUiCore.seedSizingSize(COMPONENT, keyOf('linear-wavy'), 137, 71);
    const before =
      nitroUiCore.sizingStats().correctionsImmediate +
      nitroUiCore.sizingStats().correctionsBatched;

    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          value={0.5}
          appearance="wavy"
          testID="appearance"
          hybridRef={captureFor('appearance')}
        />
      </View>
    );
    // The same handle answers the wavy height, so the view was not remounted.
    const wavyMeasured = await pollUntil(
      () => {
        const size = handle.measureContent();
        return Math.abs(size.height - LINEAR_WAVY_HEIGHT) < 1 ? size : null;
      },
      () =>
        new Error(
          `The wavy bar never measured ${LINEAR_WAVY_HEIGHT} tall (last=${describeBox(
            handle.measureContent()
          )}, flat was ${describeBox(flatMeasured)}).`
        )
    );
    const wavyBox = await pollUntil(
      () => {
        const box = harnessUi.queryByTestId('appearance');
        return box !== null && Math.abs(box.height - wavyMeasured.height) < 1
          ? box
          : null;
      },
      () =>
        new Error(
          `The bar's box never became ${describeBox(
            wavyMeasured
          )} tall (last=${describeBox(harnessUi.queryByTestId('appearance'))}).`
        )
    );
    expect(handle.appearance).toBe('wavy');
    await waitForDisplayed(handle, 'displayed=0.5');
    const after =
      nitroUiCore.sizingStats().correctionsImmediate +
      nitroUiCore.sizingStats().correctionsBatched;
    console.log(
      `appearance: flat=${describeBox(flatMeasured)} ` +
        `wavy=${describeBox(wavyMeasured)} box=${describeBox(wavyBox)} ` +
        `sameHandle=${handles.get('appearance') === handle} ` +
        `corrections=${after - before}`
    );
    expect(after).toBeGreaterThan(before);

    // And back to the flat bar.
    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          value={0.5}
          testID="appearance"
          hybridRef={captureFor('appearance')}
        />
      </View>
    );
    await waitFor(
      async () => {
        const box = harnessUi.queryByTestId('appearance');
        expect(box).not.toBeNull();
        expect(Math.abs(box!.height - LINEAR_HEIGHT)).toBeLessThan(1);
      },
      { timeout: 5000 }
    );
    expect(handle.appearance).toBe('flat');
  });

  it('gives a contained loading indicator its own cache entry', async () => {
    // The two loading configurations measure the same square, so no size can
    // show that `contained` is in the sizing key. The correction count can: the
    // plain one is mounted first and becomes exact, so the contained one has to
    // miss the cache and pay for a correction.
    const { rerender } = await render(
      <View style={{ width: 300 }}>
        <Progress
          variant="loading"
          value={0.4}
          testID="contained"
          hybridRef={captureFor('contained')}
        />
      </View>
    );
    const plain = await waitForBox('contained');
    const handle = await handleFor('contained');
    const measured = await measuredOf(handle);
    expect(Math.abs(measured.width - LOADING_SIZE)).toBeLessThan(1);
    expect(Math.abs(plain.height - LOADING_SIZE)).toBeLessThan(1);
    expect(handle.contained).toBe(false);

    // With `contained` in the key this mount misses the plain entry, is laid out
    // at the poisoned size and has to correct back.
    nitroUiCore.seedSizingSize(COMPONENT, keyOf('loading-contained'), 61, 37);
    const before =
      nitroUiCore.sizingStats().correctionsImmediate +
      nitroUiCore.sizingStats().correctionsBatched;
    await rerender(
      <View style={{ width: 300 }}>
        <Progress
          variant="loading"
          contained
          value={0.4}
          testID="contained"
          hybridRef={captureFor('contained')}
        />
      </View>
    );
    await waitFor(
      async () => {
        const box = harnessUi.queryByTestId('contained');
        expect(box).not.toBeNull();
        expect(Math.abs(box!.width - measured.width)).toBeLessThan(1);
        expect(Math.abs(box!.height - measured.height)).toBeLessThan(1);
      },
      { timeout: 5000 }
    );
    const after =
      nitroUiCore.sizingStats().correctionsImmediate +
      nitroUiCore.sizingStats().correctionsBatched;
    console.log(
      `contained: box=${describeBox(plain)}->` +
        `${describeBox(harnessUi.queryByTestId('contained'))} ` +
        `corrections=${after - before} flag=${String(handle.contained)}`
    );
    expect(handle.contained).toBe(true);
    expect(after).toBeGreaterThan(before);
    await waitForDisplayed(handle, 'displayed=0.4');
  });

  it('animates every new configuration while it is on screen and stops when it is gone', async () => {
    // Each row is mounted indeterminate, the case every configuration animates
    // for. (A determinate wavy bar animates too: Material's wave travels.)
    for (const configuration of CONFIGURATIONS.filter(
      (candidate) =>
        candidate.variant === 'loading' || candidate.appearance === 'wavy'
    )) {
      const testId = `anim-${configuration.name}`;
      const { unmount } = await render(
        <Progress
          {...configurationProps(configuration)}
          value={null}
          testID={testId}
          hybridRef={captureFor(testId)}
        />
      );
      await waitForBox(testId);
      const handle = await handleFor(testId);
      await waitForDisplayed(handle, 'displayed=indeterminate');
      await waitFor(() => expect(handle.nuiTestIsAnimating()).toBe(true), {
        timeout: 5000,
      });

      unmount();
      await waitFor(() => expect(handle.nuiTestIsAnimating()).toBe(false), {
        timeout: 5000,
      });
      console.log(`animate ${configuration.name}: mounted=true dropped=false`);
      cleanup();
    }
  });

  if (Platform.OS === 'android') {
    it('paints the wavy and loading shapes it was asked for', async () => {
      // A wavy ring and `variant="loading"` measure the same box and answer the
      // same `displayed=`, so this reads the window: `paintedInk` copies the
      // control's rectangle out of the compositor and counts the pixels that are
      // the tint asked for. The assertions are about shape, not exact pixels.
      //
      // `Progress` runs `processColor` itself, so the props take the source
      // strings and only the probe takes the processed number.
      const TINT = '#e03131';
      const CONTAINER = '#1864ab';
      const tint = processColor(TINT) as number;
      const container = processColor(CONTAINER) as number;
      const green = processColor('#00ff00') as number;
      await render(
        <View style={{ width: 300 }}>
          <View
            style={{ width: 60, height: 60, backgroundColor: '#00ff00' }}
            testID="ink-control-green"
          />
          <Progress
            value={0.8}
            tintColor={TINT}
            testID="ink-bar-flat"
            hybridRef={captureFor('ink-bar-flat')}
          />
          <Progress
            value={0.8}
            appearance="wavy"
            tintColor={TINT}
            testID="ink-bar-wavy"
            hybridRef={captureFor('ink-bar-wavy')}
          />
          <Progress
            value={0.8}
            variant="circular"
            tintColor={TINT}
            testID="ink-ring-flat"
            hybridRef={captureFor('ink-ring-flat')}
          />
          <Progress
            value={0.8}
            variant="circular"
            appearance="wavy"
            tintColor={TINT}
            testID="ink-ring-wavy"
            hybridRef={captureFor('ink-ring-wavy')}
          />
          <Progress
            value={0.2}
            variant="loading"
            tintColor={TINT}
            testID="ink-loading"
            hybridRef={captureFor('ink-loading')}
          />
          <Progress
            value={0.2}
            variant="loading"
            contained
            tintColor={TINT}
            trackColor={CONTAINER}
            testID="ink-loading-contained"
            hybridRef={captureFor('ink-loading-contained')}
          />
        </View>
      );
      for (const row of [
        { name: 'ink-bar-flat', shown: 'displayed=0.8' },
        { name: 'ink-bar-wavy', shown: 'displayed=0.8' },
        { name: 'ink-ring-flat', shown: 'displayed=0.8' },
        { name: 'ink-ring-wavy', shown: 'displayed=0.8' },
        { name: 'ink-loading', shown: 'displayed=0.2' },
        { name: 'ink-loading-contained', shown: 'displayed=0.2' },
      ]) {
        await waitForDisplayed(await handleFor(row.name), row.shown);
      }

      const barFlat = await probeInk('ink-bar-flat', tint);
      const barWavy = await probeInk('ink-bar-wavy', tint);
      const ringFlat = await probeInk('ink-ring-flat', tint);
      const ringWavy = await probeInk('ink-ring-wavy', tint);
      const loading = await probeInk('ink-loading', tint);
      const contained = await probeInk('ink-loading-contained', tint);
      // The same `trackColor` asked of the two loading shapes: painted on the
      // contained one, absent from the plain one.
      const containerOnPlain = await probeInk('ink-loading', container);
      const containerOnContained = await probeInk(
        'ink-loading-contained',
        container
      );
      for (const [name, box] of [
        ['bar-flat', barFlat],
        ['bar-wavy', barWavy],
        ['ring-flat', ringFlat],
        ['ring-wavy', ringWavy],
        ['loading', loading],
        ['loading-contained', contained],
      ] as const) {
        console.log(
          `ink ${name}: box=${describeBox(box)} count=${String(box.inkCount)} ` +
            `ink=${Math.round(box.inkWidth)}x${Math.round(box.inkHeight)} ` +
            `density=${(
              box.inkCount / Math.max(1, box.inkWidth * box.inkHeight)
            ).toFixed(2)}`
        );
      }
      console.log(
        `ink container: plain=${String(containerOnPlain.inkCount)} ` +
          `contained=${String(containerOnContained.inkCount)}`
      );

      const density = (box: Ink) =>
        box.inkCount / Math.max(1, box.inkWidth * box.inkHeight);

      // A black bitmap from PixelCopy reads as zero ink, which would look like a
      // wrong shape. The summary names what each box did draw.
      const probeRows = [
        ['bar-flat', barFlat],
        ['bar-wavy', barWavy],
        ['ring-flat', ringFlat],
        ['ring-wavy', ringWavy],
        ['loading', loading],
        ['loading-contained', contained],
      ] as const;
      const probeSummary = probeRows
        .map(
          ([name, box]) =>
            `${name} ${box.width}x${box.height}px ink=${box.inkCount} ` +
            `opaque=${box.opaqueCount} top=0x${box.topColor
              .toString(16)
              .padStart(8, '0')}x${box.topColorCount}`
        )
        .join(' | ');
      const control = await probeInk('ink-control-green', green);
      // The plain green View first: a probe that cannot see a known colour has
      // no answer to give about any of the shapes below.
      expect(control.inkCount).toBeGreaterThan(
        control.width * control.height * 0.9
      );
      if (probeRows.some(([, box]) => box.inkCount === 0)) {
        throw new Error(`no ink: ${probeSummary}`);
      }

      const px = PixelRatio.get();
      // A flat bar is its 4 dp stroke: antialiasing adds at most a row each side.
      expect(barFlat.inkHeight).toBeGreaterThan(LINEAR_HEIGHT * px * 0.7);
      expect(barFlat.inkHeight).toBeLessThan(LINEAR_HEIGHT * px * 1.6);
      // The wavy bar is Material's 10 dp of stroke and amplitude, well over twice
      // the flat band.
      expect(barWavy.inkHeight).toBeGreaterThan(LINEAR_WAVY_HEIGHT * px * 0.7);
      expect(barWavy.inkHeight).toBeGreaterThan(barFlat.inkHeight * 1.6);
      expect(barWavy.inkWidth).toBeGreaterThan(barFlat.inkWidth * 0.9);

      // A wavy ring is 48 dp across against the flat ring's 40 dp.
      expect(ringWavy.inkWidth).toBeGreaterThan(ringFlat.inkWidth * 1.1);

      // Loading is a filled shape and a ring is a 4 dp stroke, so fill density
      // separates them.
      expect(density(ringFlat)).toBeLessThan(0.45);
      expect(density(loading)).toBeGreaterThan(0.55);
      expect(density(loading)).toBeGreaterThan(density(ringFlat) * 1.5);

      // `contained` paints the container in `trackColor`, and the plain
      // configuration paints that colour nowhere.
      expect(containerOnPlain.inkCount).toBe(0);
      expect(containerOnContained.inkCount).toBeGreaterThan(500);
      // The container's ink spans the control's whole square.
      expect(containerOnContained.inkWidth).toBeGreaterThan(
        LOADING_SIZE * px * 0.75
      );
      expect(containerOnContained.inkHeight).toBeGreaterThan(
        LOADING_SIZE * px * 0.75
      );
      expect(contained.inkCount).toBeGreaterThan(0);
      cleanup();
    });

    it('stops the travelling wave when the control leaves the window', async () => {
      // Unmounting only exercises the drop. This takes the view out of its parent
      // and puts it back, which keeps the mount and its composition alive, as a
      // scrolling list does. A determinate wavy bar animates while attached
      // (Material's wave travels) and must stop while detached.
      const testId = 'anim-detach-wavy';
      const { unmount } = await render(
        <Progress
          appearance="wavy"
          value={0.4}
          testID={testId}
          hybridRef={captureFor(testId)}
        />
      );
      await waitForBox(testId);
      const handle = await handleFor(testId);
      await waitForDisplayed(handle, 'displayed=0.4');
      const viewProbe = await probeModule();
      await waitFor(() => expect(handle.nuiTestIsAnimating()).toBe(true), {
        timeout: 5000,
      });

      const detached = await viewProbe.detachTaggedView(testId);
      console.log(`detach ${testId}: ${detached}`);
      // No wait: the animation stops inside `onDetachedFromWindow`.
      expect(handle.nuiTestIsAnimating()).toBe(false);

      const reattached = await viewProbe.attachTaggedView(testId);
      console.log(`attach ${testId}: ${reattached}`);
      // A control that answered `false` because it was destroyed fails here.
      await waitFor(() => expect(handle.nuiTestIsAnimating()).toBe(true), {
        timeout: 5000,
      });
      expect(handle.nuiTestDisplayedValue()).toBe('displayed=0.4');
      unmount();
      cleanup();
    });
  }
});

function keyOf(name: string): string {
  const found = CONFIGURATIONS.find(
    (configuration) => configuration.name === name
  );
  if (found === undefined) {
    throw new Error(`No configuration named "${name}".`);
  }
  return found.key;
}

function configurationProps(configuration: Configuration): {
  variant: Configuration['variant'];
  appearance: Configuration['appearance'];
  contained: boolean;
} {
  return {
    variant: configuration.variant,
    appearance: configuration.appearance ?? 'flat',
    contained: configuration.contained ?? false,
  };
}
