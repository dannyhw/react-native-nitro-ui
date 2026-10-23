/**
 * On-device tests for intrinsic sizing (task T11).
 *
 * These are the questions a JS test cannot answer: did the box a control was
 * laid out with come from the control, was the frame that got drawn already the
 * corrected one, how many Fabric state updates did a mount cost, and what did
 * 200 of them cost. The oracle is three things read together:
 *
 *  - `harnessUi.queryByTestId` - the frame Fabric gave the view (the box);
 *  - `hybridRef.measureContent()` - the size the hosted control measured;
 *  - `nitroUiCore.sizingStats()` / `drainSizingTrace()` - what the sizing engine
 *    decided, and the box each instance was actually drawn at.
 *
 * Counters are process-global and monotonic (the engine outlives a runtime
 * reset), so every assertion is a delta over a snapshot taken in the test.
 */
import { Modal, Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  nitroUiCore,
  Switch,
  type NitroUiSizingStats,
  type NitroUiSizingTraceEvent,
} from 'react-native-nitro-ui';

/** The Switch's Fabric name - the key the sizing engine files its sizes under. */
const COMPONENT = 'NitroUiSwitch';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type SwitchHandle = {
  readonly value: boolean | null;
  measureContent(): { width: number; height: number };
};

/**
 * The size this platform's control really is, written out rather than imported
 * (asserting a constant against itself proves nothing): iOS 26+ lays a SwiftUI
 * `Toggle(.switch)` out at 61x28 pt, earlier at 51x31, and a Material 3 Switch
 * is 52x48 dp. Under T11 these numbers must come out of the control, so the
 * point of most tests below is that the box, the measured size and this agree.
 */
const osVersion = (
  Platform.constants as { readonly osVersion?: string } | undefined
)?.osVersion;
const iosMajor = Number.parseInt(osVersion ?? String(Platform.Version), 10);
const expectedBox = Platform.select({
  android: { width: 52, height: 48 },
  default:
    Number.isFinite(iosMajor) && iosMajor >= 26
      ? { width: 61, height: 28 }
      : { width: 51, height: 31 },
});

/** A size is right when it is within what Yoga rounds to. */
function boxMatches(
  box: ViewInfo | null,
  size: { width: number; height: number }
) {
  return (
    box != null &&
    Math.abs(box.width - size.width) < 0.6 &&
    Math.abs(box.height - size.height) < 0.6
  );
}

function describeBox(box: ViewInfo | null) {
  return box == null
    ? 'null'
    : `${box.width.toFixed(2)}x${box.height.toFixed(2)}`;
}

async function waitForTestId(testId: string, timeoutMs = 10000) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (harnessUi.queryByTestId(testId) != null) {
      return harnessUi.queryByTestId(testId) as ViewInfo;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${timeoutMs}ms.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Poll until `read()` returns something other than null, and hand it back. */
async function pollUntil<T>(
  read: () => T | null,
  failure: () => Error,
  timeoutMs = 5000
) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value != null) {
      return value;
    }
    if (nitroUiCore.now() > deadline) {
      throw failure();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Let the host's next main-queue drain happen before reading the trace.
 *
 * A `drew` event is sampled one runloop turn after the frame it describes (that
 * is the only way to read a box UIKit has actually committed), so it can arrive
 * after the measurement that triggered it. Reading the trace without settling
 * races the sample and finds nothing.
 */
async function settleForTrace() {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let hybrid: SwitchHandle | null = null;
const captureHybrid = (view: SwitchHandle) => {
  hybrid = view;
};

const stats = () => nitroUiCore.sizingStats();

/** `after - before` for the counters a test asserts on. */
function delta(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return {
    corrections:
      after.correctionsImmediate -
      before.correctionsImmediate +
      (after.correctionsBatched - before.correctionsBatched),
    immediate: after.correctionsImmediate - before.correctionsImmediate,
    batched: after.correctionsBatched - before.correctionsBatched,
    flushes: after.flushes - before.flushes,
    dropped: after.reportsDropped - before.reportsDropped,
    queued: after.reportsQueued - before.reportsQueued,
    measurements: after.measurements - before.measurements,
    staleFramesSkipped: after.staleFramesSkipped - before.staleFramesSkipped,
    maxFlushMs: after.maxFlushMs,
    epoch: after.environmentEpoch,
  };
}

afterEach(() => {
  cleanup();
  hybrid = null;
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('Sizing · intrinsic (T11)', () => {
  beforeAll(async () => {
    // Pay the one-time costs (Nitro's first hybrid call, the first hosting
    // controller / composition) here, as the T10 suite does, so every number
    // below is a steady-state mount and not the app's first.
    const { unmount } = await render(
      <Switch defaultValue testID="size-warm-up" />,
      {
        timeout: 20000,
      }
    );
    unmount();
  });

  it('lays a cold Switch out at the size the control measures', async () => {
    // The P1 headline: no style anywhere, and the box is the control.
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="cold" hybridRef={captureHybrid} />
    );
    const box = await waitForTestId('cold');
    const content = hybrid?.measureContent() ?? null;
    await settleForTrace();
    const trace = nitroUiCore.drainSizingTrace();

    console.log(
      `cold: box=${describeBox(box)} content=${JSON.stringify(content)} ` +
        `trace=${JSON.stringify(trace.map((e) => `${e.stage}:${e.width.toFixed(1)}x${e.height.toFixed(1)}`))} ` +
        `d=${JSON.stringify(delta(before, stats()))}`
    );

    expect(content).not.toBeNull();
    expect(boxMatches(box, expectedBox!)).toBe(true);
    expect(Math.abs(content!.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content!.height - expectedBox!.height)).toBeLessThan(1.5);
    // The invariant that holds in every environment: the box is the control.
    expect(Math.abs(box!.width - content!.width)).toBeLessThan(0.6);
    expect(Math.abs(box!.height - content!.height)).toBeLessThan(0.6);

    // The first instance of a configuration pays exactly one state update: the
    // shadow tree has to learn the size it will keep handing out.
    const d = delta(before, stats());
    expect(d.corrections).toBe(1);
    expect(d.immediate).toBe(1);
    // And every box that reached a frame was the real one.
    const drawn = trace.filter(
      (e: NitroUiSizingTraceEvent) => e.stage === 'drew'
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const event of drawn) {
      expect(Math.abs(event.width - expectedBox!.width)).toBeLessThan(0.6);
      expect(Math.abs(event.height - expectedBox!.height)).toBeLessThan(0.6);
    }
    unmount();
  });

  it('costs the next instance nothing at all', async () => {
    // Same epoch, same configuration: the cache has the answer, so the ledger
    // marks the instance exact and the report is dropped instead of queued.
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="warm" hybridRef={captureHybrid} />
    );
    const box = await waitForTestId('warm');
    const content = hybrid?.measureContent() ?? null;
    const d = delta(before, stats());

    console.log(`warm: box=${describeBox(box)} d=${JSON.stringify(d)}`);
    expect(boxMatches(box, expectedBox!)).toBe(true);
    expect(Math.abs(content!.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(d.corrections).toBe(0);
    expect(d.dropped).toBeGreaterThan(0);
    unmount();
  });

  it('pre-warms from the declared size so the first mount is exact', async () => {
    nitroUiCore.invalidateSizingEnvironment();
    expect(nitroUiCore.prewarmSizing(['NitroUiNoSuchComponent'])).toBe(0);
    expect(nitroUiCore.prewarmSizing([COMPONENT])).toBe(1);
    expect(stats().cachedSizes).toBeGreaterThan(0);

    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="prewarmed" hybridRef={captureHybrid} />
    );
    const box = await waitForTestId('prewarmed');
    await settleForTrace();
    const trace = nitroUiCore.drainSizingTrace();
    const d = delta(before, stats());

    console.log(
      `prewarmed: box=${describeBox(box)} d=${JSON.stringify(d)} ` +
        `trace=${JSON.stringify(trace.map((e) => `${e.stage}:${e.width.toFixed(1)}`))}`
    );
    expect(boxMatches(box, expectedBox!)).toBe(true);
    // Pre-warmed is the zero-correction case: the first instance is laid out
    // from the cache, so there is nothing to push.
    expect(d.corrections).toBe(0);
    expect(
      trace.filter((e: NitroUiSizingTraceEvent) => e.stage === 'corrected')
        .length
    ).toBe(0);
    unmount();
  });

  /** Mount `count` Switches, wait for the last, and hand back the mount time. */
  async function mountMany(count: number, prefix: string) {
    const startedAt = nitroUiCore.now();
    const { unmount } = await render(
      <View>
        {Array.from({ length: count }, (_, index) => index).map((row) => (
          <Switch
            key={row}
            defaultValue={row % 2 === 0}
            testID={`${prefix}-${row}`}
          />
        ))}
      </View>,
      // The default render wait is one second, which is a single control's
      // budget: 200 hosted controls - a Compose composition each on Android -
      // need more than that to mount.
      { timeout: 25000 }
    );
    await waitForTestId(`${prefix}-${count - 1}`, 20000);
    return { mountedIn: nitroUiCore.now() - startedAt, unmount };
  }

  it('mounts 200 at the measured size with nothing to correct', async () => {
    // The pre-warmed batch (R4 answered the easy way): one configuration, one
    // cached size, so 200 instances cost 200 layouts and no state updates.
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.prewarmSizing([COMPONENT]);
    const before = stats();
    const { mountedIn, unmount } = await mountMany(200, 'many-warm');
    const d = delta(before, stats());

    for (const row of [0, 1, 99, 198, 199]) {
      const box = harnessUi.queryByTestId(`many-warm-${row}`);
      expect(boxMatches(box, expectedBox!)).toBe(true);
    }
    console.log(
      `200 pre-warmed: mounted in ${mountedIn.toFixed(1)}ms ` +
        `(${(mountedIn / 200).toFixed(2)}ms each) d=${JSON.stringify(d)}`
    );
    expect(d.corrections).toBe(0);
    unmount();
  });

  it('corrects a cold batch of 200 with one correction each, few of them immediate', async () => {
    // R4: N instances missing the cache in one turn. They share a configuration,
    // so the first report corrects every instance that needs it and the other
    // 199 reports are dropped; what must stay bounded is how many of those
    // updates are synchronous (`unstable_Immediate`), because each one can force
    // a same-turn commit.
    nitroUiCore.invalidateSizingEnvironment();
    const before = stats();
    const { mountedIn, unmount } = await mountMany(200, 'many-cold');
    const d = delta(before, stats());

    for (const row of [0, 99, 199]) {
      const box = harnessUi.queryByTestId(`many-cold-${row}`);
      expect(boxMatches(box, expectedBox!)).toBe(true);
    }
    console.log(
      `200 cold: mounted in ${mountedIn.toFixed(1)}ms corrections=${d.corrections} ` +
        `immediate=${d.immediate} batched=${d.batched} flushes=${d.flushes} ` +
        `skipped=${d.staleFramesSkipped} maxFlushMs=${d.maxFlushMs.toFixed(3)}`
    );
    // One update per instance, and never more than the per-flush budget of two
    // synchronous ones.
    expect(d.corrections).toBe(200);
    expect(d.immediate).toBeLessThanOrEqual(2 * Math.max(d.flushes, 1));
    expect(d.immediate).toBeGreaterThanOrEqual(2);
    expect(d.batched).toBe(d.corrections - d.immediate);
    // The engine's own work must be small next to the mount. Measured in a debug
    // build: about 5ms on iOS and about 18ms on Android for all 200 corrections,
    // because one report corrects every instance that shares the configuration and
    // the pushes are issued in the one pre-draw pass that Android uses to skip the
    // wrong-size frame. So the cost of the batch is a fraction of a frame to a
    // frame and a half, not 200 synchronous commits - and it is bounded by the
    // instances in a turn, which is the knob (a per-flush instance cap) if a turn
    // ever carries more. Budget is four frames, generously: this is a debug build
    // on a shared machine, and the number that matters is logged.
    expect(d.maxFlushMs).toBeLessThan(64);
    unmount();
  });

  it('keeps an explicit width, height and flex in charge', async () => {
    // Acceptance: measured sizing must not take a user's layout away. The base
    // style is a default, applied before the caller's, so anything the caller
    // decides - including the stretch this base style avoids - still wins.
    const { unmount } = await render(
      <View style={{ width: 300 }}>
        <Switch
          defaultValue
          style={{ width: 120, height: 60 }}
          testID="sized-box"
        />
        <View style={{ flexDirection: 'row', width: 300, height: 60 }}>
          <Switch defaultValue style={{ flex: 1 }} testID="flexed" />
        </View>
        <Switch
          defaultValue
          style={{ alignSelf: 'stretch' }}
          testID="stretched"
        />
      </View>
    );
    const fixed = await waitForTestId('sized-box');
    const flexed = await waitForTestId('flexed');
    const stretched = await waitForTestId('stretched');
    console.log(
      `user styles: fixed=${describeBox(fixed)} flexed=${describeBox(flexed)} stretched=${describeBox(stretched)}`
    );
    expect(Math.abs(fixed!.width - 120)).toBeLessThan(0.6);
    expect(Math.abs(fixed!.height - 60)).toBeLessThan(0.6);
    // `flex: 1` grows the axis it applies to; the measured size keeps the other
    // one. A correction writes an explicit size into the node, and an explicit
    // size is what stops the parent's default `alignItems: 'stretch'` from
    // filling the cross axis - so the fill has to be asked for, below.
    expect(Math.abs(flexed!.width - 300)).toBeLessThan(0.6);
    expect(Math.abs(flexed!.height - expectedBox!.height)).toBeLessThan(0.6);
    // And stretch does what it says, on the axis it stretches.
    expect(Math.abs(stretched!.width - 300)).toBeLessThan(0.6);
    expect(Math.abs(stretched!.height - expectedBox!.height)).toBeLessThan(0.6);
    unmount();
  });

  it('corrects a wrong guess before the user sees it', async () => {
    // R2, the case the plan is actually about. A size that is wrong in the cache
    // is authoritative - that is what makes a warm mount cost nothing - so the
    // question is what happens when the environment moves and the guess is left
    // behind: the box must become the control's real size, and the frames in
    // between must not show the wrong one.
    const wrong = { width: 120, height: 90 };
    nitroUiCore.seedSizingSize(COMPONENT, '', wrong.width, wrong.height);
    const cold = stats().environmentEpoch;
    const before = stats();
    const first = await render(
      <Switch defaultValue testID="poisoned" hybridRef={captureHybrid} />
    );
    const poisonedBox = await waitForTestId('poisoned');
    expect(boxMatches(poisonedBox, wrong)).toBe(true);
    expect(delta(before, stats()).corrections).toBe(0);
    first.unmount();

    // Now the environment moves (what `traitCollectionDidChange` and
    // `onConfigurationChanged` do for real): the cached answer is gone, the
    // stale guess is all that is left, and the control has to correct it.
    nitroUiCore.invalidateSizingEnvironment();
    expect(stats().environmentEpoch).toBe(cold + 1);
    nitroUiCore.setSizingTraceEnabled(true);
    const mid = stats();
    const second = await render(
      <Switch defaultValue testID="repaired" hybridRef={captureHybrid} />
    );
    const repairedBox = await waitForTestId('repaired');
    await settleForTrace();
    const trace = nitroUiCore.drainSizingTrace();
    const d = delta(mid, stats());
    console.log(
      `poison: guess=${wrong.width}x${wrong.height} repaired=${describeBox(repairedBox)} ` +
        `d=${JSON.stringify(d)} trace=${JSON.stringify(trace.map((e) => `${e.stage}:${e.width.toFixed(1)}x${e.height.toFixed(1)}`))}`
    );

    expect(boxMatches(repairedBox, expectedBox!)).toBe(true);
    expect(d.corrections).toBe(1);
    expect(d.immediate).toBe(1);
    // The log of one correction: laid out at the stale size, corrected, and what
    // the platform reported drawing. On Android a frame whose layout was stale is
    // cancelled (`OnPreDrawListener` returns false), which is what
    // `staleFramesSkipped` counts; iOS flushes below Core Animation's commit
    // observer, so its stale layout is never committed.
    const stages = trace.map((e: NitroUiSizingTraceEvent) => e.stage);
    expect(stages).toContain('laidOut');
    expect(stages).toContain('corrected');
    // What reached a frame. A size measured natively cannot arrive before the
    // native side has laid the control out, so the turn a stale guess is laid out
    // in can be committed before the correction exists: iOS commits it (one
    // frame), Android cancels the draw (`staleFramesSkipped`). Either way no
    // third size appears, and the last frame drawn is the control's own.
    const drawn = trace.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'drew'
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const event of drawn) {
      const offsets = [
        Math.abs(event.width - expectedBox!.width),
        Math.abs(event.width - wrong.width),
      ];
      expect(Math.min(...offsets)).toBeLessThan(1.5);
    }
    const staleFrames = drawn.filter(
      (event: NitroUiSizingTraceEvent) =>
        Math.abs(event.width - expectedBox!.width) >= 1.5
    ).length;
    // The platforms differ here, and both are asserted: Android's pre-draw flush
    // cancels the draw whose layout was stale, so nothing wrong is ever painted
    // (`stale=0`); iOS flushes below Core Animation's commit observer, which fixes
    // a correction that arrives within the turn but not one that can only exist in
    // the next - and a natively measured size can. So iOS shows at most one stale
    // frame (`stale=1`), and no third size appears on either. What stays on screen
    // is the box asserted above, which is the control's own.
    expect(staleFrames).toBeLessThanOrEqual(1);
    console.log(
      `poison frames: drawn=${String(drawn.length)} stale=${String(staleFrames)} ` +
        `skipped=${String(d.staleFramesSkipped)}`
    );
    second.unmount();

    // Self-healing: the real size is the cache's now, so a third mount is clean.
    const afterRepair = stats();
    const third = await render(<Switch defaultValue testID="after-repair" />);
    expect(boxMatches(await waitForTestId('after-repair'), expectedBox!)).toBe(
      true
    );
    expect(delta(afterRepair, stats()).corrections).toBe(0);
    third.unmount();
  });

  it('sizes a control inside a Modal', async () => {
    // R6, for sizing. RN's `Modal` is a second window whose tree Fabric lays out
    // before the dialog has a window, which is where a size that never arrives
    // would show up. The harness cannot query a testID inside that window (H9,
    // H10), so both oracles are read from inside the host: what the control
    // measured, and the box the host recorded drawing on its first frame.
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { unmount } = await render(
      <Modal visible animationType="none">
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Switch defaultValue testID="modal-size" hybridRef={captureHybrid} />
        </View>
      </Modal>
    );

    const content = await pollUntil(
      () => {
        const size = hybrid?.measureContent() ?? null;
        return size !== null && size.width > 0 && size.height > 0 ? size : null;
      },
      () =>
        new Error(
          `Modal host never measured (last=${String(
            JSON.stringify(hybrid?.measureContent() ?? null)
          )}).`
        ),
      15000
    );
    await settleForTrace();
    const trace = nitroUiCore.drainSizingTrace();
    const drawn = trace.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'drew'
    );
    const d = delta(before, stats());
    console.log(
      `modal: content=${content.width.toFixed(2)}x${content.height.toFixed(2)} ` +
        `trace=${String(JSON.stringify(trace.map((e) => `${e.stage}:${e.instanceId}:${e.width.toFixed(1)}x${e.height.toFixed(1)}`)))} ` +
        `d=${JSON.stringify(d)}`
    );

    expect(Math.abs(content.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content.height - expectedBox!.height)).toBeLessThan(1.5);
    // The engine works across the second surface: a cold configuration in a dialog
    // is laid out, corrected and drawn there like any other, and the box the host
    // sampled is the one the control measured - inside RN's second window, where
    // the harness can query neither.
    expect(trace.map((event: NitroUiSizingTraceEvent) => event.stage)).toEqual(
      expect.arrayContaining(['laidOut', 'corrected', 'drew'])
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const event of drawn) {
      expect(Math.abs(event.width - content.width)).toBeLessThan(0.6);
      expect(Math.abs(event.height - content.height)).toBeLessThan(0.6);
    }
    unmount();
  });

  it('takes a storm of prop changes without re-sizing', async () => {
    // R9. Rapid props are what a drag, a slider or a keyboard does: many turns in
    // a row, none of which change a size. Every one of them runs the measure path,
    // so the questions are whether the engine re-reports a size it already got
    // right - each re-report being a Fabric state update and a possible re-render -
    // and whether the control's state and its box both still match the last props.
    // A colour prop is in there because it is processed natively every turn.
    nitroUiCore.invalidateSizingEnvironment();
    let value = false;
    const { rerender, unmount } = await render(
      <Switch value={value} testID="storm" hybridRef={captureHybrid} />
    );
    await waitForTestId('storm');
    const mid = stats();
    const cached = mid.cachedSizes;

    for (let turn = 0; turn < 30; turn += 1) {
      value = !value;
      await rerender(
        <Switch
          value={value}
          tintColor={turn % 2 === 0 ? '#7C4DFF' : '#FF4081'}
          testID="storm"
          hybridRef={captureHybrid}
        />
      );
    }
    // One turn per `rerender`, and nothing awaited between the render and the
    // read: ten renders queued in a single JS turn is not expressible here,
    // because the harness waits for its render callback per turn and the second
    // concurrent one times out ("Element did not update within 1000ms").

    const box = harnessUi.queryByTestId('storm');
    const d = delta(mid, stats());
    console.log(
      `storm: 30 turns corrections=${d.corrections} dropped=${d.dropped} ` +
        `measures=${d.measurements} queued=${d.queued} flushes=${d.flushes} ` +
        `newCacheEntries=${stats().cachedSizes - cached} ` +
        `value=${String(hybrid?.value)} box=${describeBox(box)}`
    );
    expect(hybrid?.value).toBe(value);
    expect(boxMatches(box, expectedBox!)).toBe(true);
    // Nothing here changed a size: zero state updates, and the variant key stayed
    // the one entry it was. How the turn got there is logged rather than asserted:
    // the engine is on the layout and native-measure paths, not on props, so a
    // prop turn does not even reach the report path - which is the cheap answer to
    // R9, and the log is where the counter that proves it can be read.
    expect(d.corrections).toBe(0);
    expect(stats().cachedSizes).toBe(cached);
    unmount();
  });

  type BenchRow = {
    count: number;
    warm: boolean;
    mountedIn: number;
    perInstance: number;
    corrections: number;
    flushes: number;
    maxFlushMs: number;
  };

  /** Cold or pre-warmed, mount `count` Switches and time it with core marks. */
  async function bench(count: number, prefix: string, warm: boolean) {
    nitroUiCore.invalidateSizingEnvironment();
    if (warm) {
      nitroUiCore.prewarmSizing([COMPONENT]);
    }
    const before = stats();
    const { mountedIn, unmount } = await mountMany(count, prefix);
    const d = delta(before, stats());
    unmount();
    return {
      count,
      warm,
      mountedIn,
      perInstance: mountedIn / count,
      corrections: d.corrections,
      flushes: d.flushes,
      maxFlushMs: d.maxFlushMs,
    } satisfies BenchRow;
  }

  it('mounts the same batch warm and cold, and both at the right size', async () => {
    // The T11 mount numbers. T02's bench tooling is not merged, so this is the
    // core perf clock (`nitroUiCore.now()`, D1) around a render rather than the T02
    // harness: enough to compare a cold cache against a warm one and to keep the
    // engine honest on a device, not enough to be a published benchmark. The N=200
    // timings are logged by the two batch tests above, which is where 200 instances
    // are also asserted to be correct. Budgets are deliberately generous - a debug
    // build on a simulator says nothing about release timings. What matters is that
    // the cold path is bounded, the warm path costs no state updates, and both end
    // at the control's size.
    const rows: BenchRow[] = [];
    for (const count of [1, 50]) {
      rows.push(await bench(count, `bench-warm-${count}`, true));
      rows.push(await bench(count, `bench-cold-${count}`, false));
    }
    for (const row of rows) {
      console.log(
        `bench: ${row.warm ? 'warm' : 'cold'} n=${row.count} ` +
          `${row.mountedIn.toFixed(1)}ms (${row.perInstance.toFixed(2)}ms each) ` +
          `corrections=${row.corrections} flushes=${row.flushes} ` +
          `maxFlushMs=${row.maxFlushMs.toFixed(3)}`
      );
    }
    for (const count of [1, 50]) {
      const warm = rows.find((row) => row.warm && row.count === count)!;
      const cold = rows.find((row) => !row.warm && row.count === count)!;
      // Pre-warmed: nothing to correct. Cold: exactly one update per instance.
      expect(warm.corrections).toBe(0);
      expect(cold.corrections).toBe(count);
      expect(warm.mountedIn).toBeLessThan(4000);
      expect(cold.mountedIn).toBeLessThan(12000);
    }
  });
});
