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
 * Read the trace until `done` is satisfied, keeping every event read on the way.
 *
 * A `drew` event is sampled one runloop turn after the frame it describes (that
 * is the only way to read a box the platform has actually committed), and a frame
 * only happens when the platform has drawn something - inside a `Modal`, that is
 * after the dialog has been presented. So reading the trace races the sample, and
 * `drainSizingTrace` consumes the ring, which is why the events have to be
 * accumulated across reads (the T10 suite reads the perf ring the same way).
 */
async function collectTrace(
  done: (events: NitroUiSizingTraceEvent[]) => boolean,
  timeoutMs = 5000
) {
  const events: NitroUiSizingTraceEvent[] = [];
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    events.push(...nitroUiCore.drainSizingTrace());
    if (done(events) || nitroUiCore.now() > deadline) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Enough to read a first frame: the drawn sample has arrived. */
const hasDrawnSample = (events: NitroUiSizingTraceEvent[]) =>
  events.some((event) => event.stage === 'drew');

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
    confirmed: after.reportsConfirmed - before.reportsConfirmed,
    changedFlushes: after.changedFlushes - before.changedFlushes,
    maxFlushMs: after.maxFlushMs,
    epoch: after.environmentEpoch,
  };
}

/**
 * A size that is *not* this control's size, seeded as the engine's guess before a
 * cold test so those tests can fail (review S8): if a correction is lost, the box
 * stays at this and every "the box was right all along" assertion below catches
 * it. With a guess equal to the real size - which is what the declared fallback
 * is - the same tests pass even when no correction ever arrives, which is how
 * review B1 got through. Provisional since B2, so this is a guess and not an
 * answer, which is exactly what a cold mount starts from.
 */
const WRONG_GUESS = { width: 40, height: 20 };

/**
 * Make the engine's next cold layout wrong: seed, then drop the answers.
 *
 * `invalidateSizingEnvironment` drops cached answers and keeps the component's
 * last known size as the guess - which the seed just made this one. Every test
 * that cares which guess it starts from declares one: the fallback is
 * process-global and self-heals to whatever was last corrected, so a test that
 * inherits it from its neighbour silently changes what it measures.
 */
function seedGuess(size: { width: number; height: number }) {
  nitroUiCore.seedSizingSize(COMPONENT, '', size.width, size.height);
  nitroUiCore.invalidateSizingEnvironment();
}

const seedWrongGuess = () => seedGuess(WRONG_GUESS);

/** The guess a warm suite ends up with: this platform's real control size. */
const seedRightGuess = () => seedGuess(expectedBox!);

/**
 * How many of the drawn samples were a size that is not the control's.
 *
 * A first frame can legitimately be the guess - that is the whole iOS/Android
 * difference in `docs/architecture/sizing.md` §3 - so a stale sample is counted
 * against each platform's own bar rather than forbidden outright, and every
 * sample must still be either the guess or the real size. A correction that
 * never arrives leaves the *last* sample wrong, which `lastDrawnIsRight` catches.
 */
function drawnFrames(
  trace: NitroUiSizingTraceEvent[],
  real: { width: number; height: number },
  guess: { width: number; height: number }
) {
  const drawn = trace.filter(
    (event: NitroUiSizingTraceEvent) => event.stage === 'drew'
  );
  const isReal = (event: NitroUiSizingTraceEvent) =>
    Math.abs(event.width - real.width) < 0.6 &&
    Math.abs(event.height - real.height) < 0.6;
  const isGuess = (event: NitroUiSizingTraceEvent) =>
    Math.abs(event.width - guess.width) < 0.6 &&
    Math.abs(event.height - guess.height) < 0.6;
  return {
    drawn: drawn.length,
    stale: drawn.filter((event: NitroUiSizingTraceEvent) => !isReal(event))
      .length,
    everySampleExplained: drawn.every(
      (event: NitroUiSizingTraceEvent) => isReal(event) || isGuess(event)
    ),
    lastSampleIsRight: (() => {
      const last = drawn[drawn.length - 1];
      return last == null || isReal(last);
    })(),
  };
}

/**
 * The width `nuiTestWidth` asks the control for. TEMPORARY (review S1): it is the
 * only size-affecting prop a Switch has until the G2 Button lands, and it is
 * deleted with that task's test (DECISIONS D16).
 */
const TEST_WIDTH = 100;
const wideBox = { width: TEST_WIDTH, height: expectedBox.height };

/** Let queued work land before reading counters that only move on teardown. */
async function settle(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
    // The P1 headline: no style anywhere, and the box is the control. It starts
    // from a guess that is deliberately wrong, so "the box is the control" is only
    // reachable by a correction that actually happened (review S8).
    seedWrongGuess();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="cold" hybridRef={captureHybrid} />
    );
    const box = await waitForTestId('cold');
    const content = hybrid?.measureContent() ?? null;
    const trace = await collectTrace(hasDrawnSample);

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
    // What reached a frame. The guess here is deliberately wrong, so this is the
    // case that separates the platforms (`docs/architecture/sizing.md` §3):
    // Android's pre-draw listener cancels the draw whose layout was stale, iOS
    // commits one frame before a size measured natively can exist. What both must
    // guarantee is that no *third* size appears and that the frame which stays up
    // is the control's own - which is also what the box assertion above says.
    const frames = drawnFrames(trace, expectedBox!, WRONG_GUESS);
    expect(frames.drawn).toBeGreaterThan(0);
    expect(frames.everySampleExplained).toBe(true);
    expect(frames.lastSampleIsRight).toBe(true);
    expect(frames.stale).toBeLessThanOrEqual(Platform.OS === 'android' ? 0 : 1);
    console.log(
      `cold frames: drawn=${String(frames.drawn)} stale=${String(frames.stale)}`
    );
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
    const trace = await collectTrace(hasDrawnSample);
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

    // All 200, not a sample: a batch where only the first few got the cached size
    // is exactly the failure this suite must not sleep through (review S8).
    for (let row = 0; row < 200; row += 1) {
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
    seedWrongGuess();
    const before = stats();
    const { mountedIn, unmount } = await mountMany(200, 'many-cold');
    const d = delta(before, stats());

    // Every one of the 200, after the batch settled: the guess was wrong for all
    // of them, so a correction that was dropped shows up as a wrong box here.
    for (let row = 0; row < 200; row += 1) {
      const box = harnessUi.queryByTestId(`many-cold-${row}`);
      expect(boxMatches(box, expectedBox!)).toBe(true);
    }
    console.log(
      `200 cold: mounted in ${mountedIn.toFixed(1)}ms corrections=${d.corrections} ` +
        `immediate=${d.immediate} batched=${d.batched} flushes=${d.flushes} ` +
        `changedFlushes=${d.changedFlushes} maxFlushMs=${d.maxFlushMs.toFixed(3)}`
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

  it('counts how many boxes of a cold batch reached a frame wrong', async () => {
    /**
     * The number review S6 asked for, and the one the round-1 report did not have.
     *
     * A flush cancels the frame whose layout it is about to fix on Android, but
     * only `kImmediateBudgetPerTurn` (2) of a batch's corrections are issued
     * synchronously: the rest are `Asynchronous` state updates that reach the JS
     * thread after the cancelled frame has been redrawn. So "Android never shows a
     * wrong box" is true per instance whose correction was in budget, and false for
     * the batch. This test measures it instead of arguing about it: 100 instances
     * (few enough that the 512-event trace ring holds every stage: three events per
     * instance), all mounted from the same wrong guess in one turn.
     *
     * It asserts the invariants that must hold at any stale-frame count - no third
     * size, and every instance's final box is the control's - and logs the count.
     * The count itself is a measurement, not a gate: it is the platform difference
     * documented in `docs/architecture/sizing.md` §3, and a gate on it would only
     * record which side of that trade this machine was on today.
     */
    const batch = 100;
    seedWrongGuess();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { unmount } = await mountMany(batch, 'many-frames');
    await settle(600);
    const trace = await collectTrace(
      (events: NitroUiSizingTraceEvent[]) =>
        events.filter(
          (event: NitroUiSizingTraceEvent) => event.stage === 'drew'
        ).length >= batch || events.length >= batch * 3,
      4000
    );
    const d = delta(before, stats());
    const drawn = trace.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'drew'
    );
    const stale = drawn.filter(
      (event: NitroUiSizingTraceEvent) =>
        Math.abs(event.width - expectedBox!.width) >= 0.6 ||
        Math.abs(event.height - expectedBox!.height) >= 0.6
    );
    console.log(
      `cold batch frames: n=${batch} drew=${String(drawn.length)} ` +
        `stale=${String(stale.length)} corrections=${d.corrections} ` +
        `immediate=${d.immediate} batched=${d.batched} flushes=${d.flushes} ` +
        `traceDropped=${String(stats().traceDropped)}`
    );
    // No third size: every sample is the guess or the control's own box.
    for (const event of drawn) {
      const guessOrReal =
        (Math.abs(event.width - WRONG_GUESS.width) < 0.6 &&
          Math.abs(event.height - WRONG_GUESS.height) < 0.6) ||
        (Math.abs(event.width - expectedBox!.width) < 0.6 &&
          Math.abs(event.height - expectedBox!.height) < 0.6);
      expect(guessOrReal).toBe(true);
    }
    // And what stayed up, stayed up right.
    for (let row = 0; row < batch; row += 1) {
      expect(
        boxMatches(harnessUi.queryByTestId(`many-frames-${row}`), expectedBox!)
      ).toBe(true);
    }
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
    // one. What keeps the cross axis from filling is the wrapper's
    // `alignSelf: 'flex-start'` base style - a measured size never stops a
    // stretch, so the fill has to be asked for, below (review N6).
    expect(Math.abs(flexed!.width - 300)).toBeLessThan(0.6);
    expect(Math.abs(flexed!.height - expectedBox!.height)).toBeLessThan(0.6);
    // And stretch does what it says, on the axis it stretches.
    expect(Math.abs(stretched!.width - 300)).toBeLessThan(0.6);
    expect(Math.abs(stretched!.height - expectedBox!.height)).toBeLessThan(0.6);
    unmount();
  });

  it('corrects a wrong guess before the user sees it', async () => {
    // R2, the case the plan is actually about: a size the engine believes that is
    // not the control's size. The box must become the control's real size, and the
    // frames in between must not show the wrong one.
    //
    // Both phases seed *after* the epoch they are about (a measured size also
    // overwrites the component's fallback, so one correction self-heals the guess
    // for the next epoch) - which is what an app does when it pre-warms a number
    // for an environment that has since moved.
    const wrong = { width: 120, height: 90 };
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.seedSizingSize(COMPONENT, '', wrong.width, wrong.height);
    const cold = stats().environmentEpoch;
    const before = stats();
    const first = await render(
      <Switch defaultValue testID="poisoned" hybridRef={captureHybrid} />
    );
    await waitForTestId('poisoned');
    // Review B2: a seeded size is a *guess*, not an answer, so the very first
    // instance corrects it instead of being told to stay wrong. It used to cost
    // nothing here - which was the bug, because the wrong size then outlived every
    // later report for that configuration, and a box that is the wrong size is how
    // T10's paint-outside-and-dead-touch bug reached a screen.
    expect(delta(before, stats()).corrections).toBe(1);
    expect(boxMatches(harnessUi.queryByTestId('poisoned'), expectedBox!)).toBe(
      true
    );
    first.unmount();

    // The environment moves (what `traitCollectionDidChange` and
    // `onConfigurationChanged` do for real): the cached answer is gone, and the
    // guess left behind belongs to a control that is no longer that size.
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.seedSizingSize(COMPONENT, '', wrong.width, wrong.height);
    expect(stats().environmentEpoch).toBe(cold + 1);
    nitroUiCore.setSizingTraceEnabled(true);
    const mid = stats();
    const second = await render(
      <Switch defaultValue testID="repaired" hybridRef={captureHybrid} />
    );
    const repairedBox = await waitForTestId('repaired');
    const trace = await collectTrace(hasDrawnSample);
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
    // `changedFlushes` counts; iOS flushes below Core Animation's commit
    // observer, so its stale layout is never committed.
    const stages = trace.map((e: NitroUiSizingTraceEvent) => e.stage);
    expect(stages).toContain('laidOut');
    expect(stages).toContain('corrected');
    // What reached a frame. A size measured natively cannot arrive before the
    // native side has laid the control out, so the turn a stale guess is laid out
    // in can be committed before the correction exists: iOS commits it (one
    // frame), Android cancels the draw (`changedFlushes`). Either way no
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
    // The platforms differ here, and each is asserted at its own bar (review S6):
    // Android's pre-draw flush cancels the draw whose layout was stale, so a
    // correction inside the per-turn budget paints nothing wrong - 0 stale frames,
    // and an Android regression to 1 has to fail this test rather than pass it.
    // iOS flushes below Core Animation's commit observer, which fixes a correction
    // that arrives within the turn but not one that can only exist in the next -
    // and a natively measured size can. So iOS gets at most one stale frame. No
    // third size appears on either, and what stays on screen is the box asserted
    // above, which is the control's own. A correction *past* the per-turn budget
    // is not covered by this case; the cold-batch test above measures that, and
    // `docs/architecture/sizing.md` states the honest number for it.
    // iOS is `<= 1` rather than `= 1` on purpose: with the first-commit measure
    // (review S5) a correction can land inside the turn that mounted the view, in
    // which case 0 is the right answer there too. Tightened to what the run
    // measures; Android is pinned at 0 either way.
    expect(staleFrames).toBeLessThanOrEqual(Platform.OS === 'android' ? 0 : 1);
    console.log(
      `poison frames: drawn=${String(drawn.length)} stale=${String(staleFrames)} ` +
        `changedFlushes=${String(d.changedFlushes)}`
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
    // The guess has to be wrong or nothing has to be corrected, and a test that
    // requires a correction is the one that notices when a control on the second
    // surface cannot be reached.
    seedWrongGuess();
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
    const trace = await collectTrace(hasDrawnSample, 2000);
    const d = delta(before, stats());
    console.log(
      `modal: content=${content.width.toFixed(2)}x${content.height.toFixed(2)} ` +
        `trace=${String(JSON.stringify(trace.map((e) => `${e.stage}:${e.instanceId}:${e.width.toFixed(1)}x${e.height.toFixed(1)}`)))} ` +
        `d=${JSON.stringify(d)}`
    );

    expect(Math.abs(content.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content.height - expectedBox!.height)).toBeLessThan(1.5);
    // The engine works across the second surface: a cold configuration in a dialog
    // is laid out, corrected and drawn there like any other, and the box Fabric ends
    // up with is the one the control measured - inside RN's second window, where the
    // harness can query neither.
    const stages = trace.map((event: NitroUiSizingTraceEvent) => event.stage);
    expect(stages).toEqual(expect.arrayContaining(['laidOut', 'corrected']));
    // ...and the correction is the control's own size, not a second guess.
    const corrected = trace.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'corrected'
    );
    for (const event of corrected) {
      expect(Math.abs(event.width - content.width)).toBeLessThan(0.6);
      expect(Math.abs(event.height - content.height)).toBeLessThan(0.6);
    }
    console.log(
      `modal correction: ${String(corrected.length)} of guess ${String(
        WRONG_GUESS.width
      )}x${String(WRONG_GUESS.height)} d=${JSON.stringify(delta(before, stats()))}`
    );
    // A `drew` sample is taken once, at the host's first frame, and attributed to
    // the instance the host has at that moment. RN's Modal mounts its tree on the
    // second surface separately, so a dialog host can paint before its sizing id
    // arrives and then have no sample to give: measured on iOS, the same build
    // produced one in one run and none in another. The trace is a diagnostic, so
    // the sample is checked when it exists and its absence costs nothing here.
    // And when it exists it is either the seeded guess (the frame before the
    // correction) or the control's size - never a third box. Whether that one
    // sample lands before or after the correction depends on when the dialog is
    // presented, so the *last* sample is not required to be the corrected one
    // here; the correction itself is asserted above, and the box the dialog ends
    // up with cannot be queried from the harness (H9, H10).
    const frames = drawnFrames(trace, content, WRONG_GUESS);
    expect(frames.everySampleExplained).toBe(true);
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

  /**
   * Wait for the box of `testID` to be `width` wide, so a size is asserted once it
   * has actually reached the layout rather than at the moment the props were sent.
   * A correction is asynchronous by nature (the native measure has to happen
   * first), so "the box is right" is always a wait, never an instant read - the
   * message names the configuration that failed to arrive, with the box it did.
   */
  async function waitForBoxWidth(testId: string, width: number, what: string) {
    return await pollUntil(
      () => {
        const box = harnessUi.queryByTestId(testId);
        return box != null && Math.abs(box.width - width) < 0.6 ? box : null;
      },
      () =>
        new Error(
          `testID "${testId}" (${what}) never reached ${String(
            width
          )} wide - last box ${describeBox(harnessUi.queryByTestId(testId))}.`
        ),
      8000
    );
  }

  it('re-measures when a size-affecting prop changes the configuration', async () => {
    // Review S1: `shouldNewRevisionDirtyMeasurement` compared a node with itself,
    // so a `nuiSizingKey` change never dirtied Yoga's measurement and the instance
    // kept its old size forever. The discriminator is that both configurations are
    // already *warm* when the key moves: then the new size has to come out of the
    // measure pass, and the turn must cost no state update. With the bug the node
    // keeps the old measurement, and the only road to the new size is a correction
    // - which is exactly what the zero below refuses to accept.
    // The guess is this platform's real size: with a wrong one every mount below
    // would pay a correction of its own and the zero would be measuring the wrong
    // thing.
    seedRightGuess();
    const warm = await render(
      <View>
        <Switch defaultValue testID="key-warm-default" />
        <Switch defaultValue nuiTestWidth={TEST_WIDTH} testID="key-warm-wide" />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('key-warm-default');
    await waitForTestId('key-warm-wide');
    await settle();
    expect(
      boxMatches(harnessUi.queryByTestId('key-warm-default'), expectedBox!)
    ).toBe(true);
    expect(boxMatches(harnessUi.queryByTestId('key-warm-wide'), wideBox)).toBe(
      true
    );
    warm.unmount();

    const before = stats();
    const cached = before.cachedSizes;
    const { rerender, unmount } = await render(
      <Switch defaultValue testID="key-change" hybridRef={captureHybrid} />
    );
    const startBox = await waitForBoxWidth(
      'key-change',
      expectedBox!.width,
      'the default configuration'
    );
    console.log(`key change start: box=${describeBox(startBox)}`);

    await rerender(
      <Switch
        defaultValue
        nuiTestWidth={TEST_WIDTH}
        testID="key-change"
        hybridRef={captureHybrid}
      />
    );
    const box = await waitForBoxWidth(
      'key-change',
      TEST_WIDTH,
      `the ${String(TEST_WIDTH)} wide configuration`
    );
    const d = delta(before, stats());
    console.log(
      `key change: box=${describeBox(box)} want=${String(TEST_WIDTH)}x${String(
        wideBox.height
      )} d=${JSON.stringify(d)}`
    );
    expect(boxMatches(box, wideBox)).toBe(true);
    // The measure pass answered it: no Fabric state update was needed, and no new
    // configuration appeared - the key that moved was already measured.
    expect(d.corrections).toBe(0);
    expect(stats().cachedSizes).toBe(cached);
    unmount();
  });

  it('corrects a control that is already mounted when the environment moves', async () => {
    // Review S2: `invalidateEnvironment` used to clear the ledger, so the next
    // report of a mounted control was answered "nothing ever laid out" and it kept
    // its old size until it remounted. A Switch does not move with the text size,
    // so the environment is moved under a mounted control and the control is then
    // asked for a genuinely new size: if the invalidation dropped the instance,
    // that second correction never arrives, and this test times out.
    //
    // The guess is this platform's real size so the mount itself costs nothing:
    // every correction counted below belongs to the environment change.
    seedRightGuess();
    const epoch = stats().environmentEpoch;
    const { rerender, unmount } = await render(
      <Switch defaultValue testID="env-mounted" hybridRef={captureHybrid} />
    );
    await waitForBoxWidth(
      'env-mounted',
      expectedBox!.width,
      'the mounted control before the environment moved'
    );
    const mounted = stats();
    expect(mounted.environmentEpoch).toBe(epoch);
    // Mounted, laid out, and the engine knows it: this is the entry the bump used
    // to delete.
    expect(mounted.ledgerEntries).toBeGreaterThan(0);
    expect(mounted.registryEntries).toBeGreaterThan(0);
    expect(delta(mounted, mounted).corrections).toBe(0);

    nitroUiCore.invalidateSizingEnvironment();
    expect(stats().environmentEpoch).toBe(epoch + 1);
    await settle();
    const bump = delta(mounted, stats());
    console.log(`env change while mounted: d=${JSON.stringify(bump)}`);
    // The bump commits nothing by itself, and it did not forget the instance: a
    // control whose size did not move is not pushed a size it already has.
    expect(bump.corrections).toBe(0);
    expect(stats().ledgerEntries).toBeGreaterThan(0);
    expect(stats().registryEntries).toBeGreaterThan(0);
    expect(
      boxMatches(harnessUi.queryByTestId('env-mounted'), expectedBox!)
    ).toBe(true);

    const mid = stats();
    await rerender(
      <Switch
        defaultValue
        nuiTestWidth={TEST_WIDTH}
        testID="env-mounted"
        hybridRef={captureHybrid}
      />
    );
    const box = await waitForBoxWidth(
      'env-mounted',
      TEST_WIDTH,
      'the mounted control after the environment moved'
    );
    const d = delta(mid, stats());
    console.log(`env change then a real size change: d=${JSON.stringify(d)}`);
    // This is the proof the report was not dropped: the control was already on
    // screen, in the new epoch, with no cached size - and its own measure still
    // reached the instance that had to be corrected. Round 1's code answered it
    // "nothing ever laid out", and the box above is where that would show.
    expect(boxMatches(box, wideBox)).toBe(true);
    expect(d.corrections).toBe(1);
    unmount();
  });

  it('never lets a pre-warmed size outlive the control that contradicts it', async () => {
    // Review B2, the case DECISIONS D16 was written for: an app pre-warms the
    // library's declared number at startup - on iOS 26 the 61x28 SwiftUI Switch -
    // while the control it really hosts is another size, which is what
    // `UIDesignRequiresCompatibility` does (a 51x31 control). The harness cannot
    // boot in compat mode, so it makes the declared number wrong the same way and
    // asserts the control wins: a wrong pre-warm may cost at most the correction a
    // cold mount pays, and must not survive into the next mount.
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.seedSizingSize(
      COMPONENT,
      '',
      WRONG_GUESS.width,
      WRONG_GUESS.height
    );
    expect(nitroUiCore.prewarmSizing([COMPONENT])).toBe(1);
    const before = stats();
    const first = await render(<Switch defaultValue testID="prewarm-wrong" />);
    await waitForTestId('prewarm-wrong');
    const d = delta(before, stats());
    console.log(`pre-warm wrong: d=${JSON.stringify(d)}`);
    expect(
      boxMatches(harnessUi.queryByTestId('prewarm-wrong'), expectedBox!)
    ).toBe(true);
    // Exactly what a cold mount would have cost - no more.
    expect(d.corrections).toBe(1);
    first.unmount();

    const after = stats();
    const second = await render(<Switch defaultValue testID="prewarm-next" />);
    await waitForTestId('prewarm-next');
    const d2 = delta(after, stats());
    expect(
      boxMatches(harnessUi.queryByTestId('prewarm-next'), expectedBox!)
    ).toBe(true);
    // The guess was replaced, not defended: the next mount is already right.
    expect(d2.corrections).toBe(0);
    second.unmount();
  });

  it('keeps the engine flat while views mount and unmount', async () => {
    // Review S3: entries used to leave only when a report happened to find a dead
    // state, so every instance a session ever mounted stayed in the ledger and the
    // registry. A list that scrolls is exactly this, for the life of the app.
    const cycle = async (prefix: string, count: number) => {
      for (let index = 0; index < count; index += 1) {
        const { unmount } = await render(
          <Switch defaultValue testID={`${prefix}-${index}`} />
        );
        await waitForTestId(`${prefix}-${index}`);
        unmount();
      }
      // Teardown is not synchronous: the drop arrives with the deallocation.
      await settle(600);
    };

    // A first cycle to reach steady state, then two identical cycles compared with
    // each other - what must not grow is what a cycle costs, not what the engine
    // happens to hold when the test starts.
    await cycle('churn-warm', 8);
    const before = stats();
    await cycle('churn-measured', 8);
    const after = stats();
    console.log(
      `churn: ledger=${String(before.ledgerEntries)}->${String(
        after.ledgerEntries
      )} registry=${String(before.registryEntries)}->${String(
        after.registryEntries
      )} cached=${String(before.cachedSizes)}->${String(after.cachedSizes)}`
    );
    // One of slack: the instance the last render handed back can still be on its
    // way out when the counters are read.
    expect(after.ledgerEntries - before.ledgerEntries).toBeLessThanOrEqual(1);
    expect(after.registryEntries - before.registryEntries).toBeLessThanOrEqual(
      1
    );
    expect(after.cachedSizes).toBe(before.cachedSizes);
  });

  it('survives unmounting a batch while its corrections are in flight', async () => {
    // A missing scenario from review S8: the guess is wrong for every instance
    // below, and each batch is torn down before its corrections have landed. What
    // is under test is that a correction is never applied to a view that is gone
    // (a host forgets its instance on drop) and that the engine still works after.
    for (let round = 0; round < 3; round += 1) {
      seedWrongGuess();
      const { unmount } = await render(
        <View>
          {Array.from({ length: 40 }, (_, index) => index).map((row) => (
            <Switch key={row} defaultValue testID={`drop-${round}-${row}`} />
          ))}
        </View>,
        { timeout: 25000 }
      );
      unmount();
      await settle(150);
    }
    await settle(600);
    const storm = stats();
    console.log(
      `drop storm: ledger=${String(storm.ledgerEntries)} registry=${String(
        storm.registryEntries
      )} flushes=${String(storm.flushes)}`
    );

    // Still healthy: a cold mount from a wrong guess corrects itself normally.
    seedWrongGuess();
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="after-drops" />
    );
    await waitForTestId('after-drops');
    expect(
      boxMatches(harnessUi.queryByTestId('after-drops'), expectedBox!)
    ).toBe(true);
    expect(delta(before, stats()).corrections).toBe(1);
    unmount();
  });

  it('takes rapid prop changes across a list and half its unmounts', async () => {
    // The other missing scenario from review S8: a list whose rows keep changing
    // while rows disappear. None of it changes a size, so nothing may be pushed -
    // and the rows that stay must still be laid out at the control's size.
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.prewarmSizing([COMPONENT]);
    const rows = 12;
    // The list shrinks to this on every third turn, so the survivors are a known
    // set: the first `shrunk` keys, which are the ones asserted below.
    const shrunk = rows - 5;
    const list = (count: number, value: boolean, tint: string) => (
      <View>
        {Array.from({ length: count }, (_, index) => index).map((row) => (
          <Switch
            key={row}
            value={value}
            tintColor={tint}
            testID={`storm-list-${row}`}
          />
        ))}
      </View>
    );

    const before = stats();
    const cached = before.cachedSizes;
    const { rerender, unmount } = await render(list(rows, false, '#7C4DFF'), {
      timeout: 20000,
    });
    await waitForTestId(`storm-list-${rows - 1}`, 20000);

    let value = false;
    for (let turn = 0; turn < 12; turn += 1) {
      value = !value;
      await rerender(
        list(
          turn % 3 === 2 ? shrunk : rows,
          value,
          turn % 2 === 0 ? '#7C4DFF' : '#FF4081'
        )
      );
    }
    await settle();

    let drawn = 0;
    for (let row = 0; row < shrunk; row += 1) {
      const box = harnessUi.queryByTestId(`storm-list-${row}`);
      if (box == null) {
        continue;
      }
      drawn += 1;
      expect(boxMatches(box, expectedBox!)).toBe(true);
    }
    // The rows the last turn removed are gone, not merely unqueried.
    expect(harnessUi.queryByTestId(`storm-list-${rows - 1}`)).toBeNull();
    const d = delta(before, stats());
    console.log(
      `storm list: survivors=${String(drawn)} of ${String(shrunk)} ` +
        `d=${JSON.stringify(d)}`
    );
    // Five of twelve rows were removed on the last turns; every survivor is laid
    // out at the control's size, and none of this cost a state update - a row that
    // disappeared mid-turn is the easy way to lose an instance's size or to push a
    // correction into a view that is already gone.
    expect(drawn).toBe(shrunk);
    expect(d.corrections).toBe(0);
    expect(stats().cachedSizes).toBe(cached);
    unmount();
  });

  type BenchRow = {
    count: number;
    guess: BenchGuess;
    mountedIn: number;
    perInstance: number;
    corrections: number;
    confirmed: number;
    flushes: number;
    maxFlushMs: number;
  };

  /**
   * The three things a first mount can start from. Named rather than inferred,
   * because which one a test runs decides what its correction count means:
   *
   * - `provisional` - `prewarm`, i.e. a declared size adopted as this environment's
   *   guess. Nothing is known about the control yet, so the first report promotes
   *   the entry (a confirmation) rather than correcting it.
   * - `rightGuess` - no cached size, and the component's declared fallback happens
   *   to be this platform's real size. The control measures what the layout already
   *   says, so the report confirms and nothing is pushed.
   * - `wrongGuess` - no cached size and a wrong fallback: the cold path that still
   *   costs one state update per instance, and the one whose timings matter.
   */
  type BenchGuess = 'provisional' | 'rightGuess' | 'wrongGuess';

  async function bench(count: number, prefix: string, guess: BenchGuess) {
    if (guess === 'wrongGuess') {
      seedWrongGuess();
    } else {
      seedRightGuess();
    }
    if (guess === 'provisional') {
      nitroUiCore.prewarmSizing([COMPONENT]);
    }
    const before = stats();
    const { mountedIn, unmount } = await mountMany(count, prefix);
    const d = delta(before, stats());
    unmount();
    return {
      count,
      guess,
      mountedIn,
      perInstance: mountedIn / count,
      corrections: d.corrections,
      confirmed: d.confirmed,
      flushes: d.flushes,
      maxFlushMs: d.maxFlushMs,
    } satisfies BenchRow;
  }

  it('mounts the same batch from every starting guess, at the right size', async () => {
    // The T11 mount numbers. T02's bench tooling is not merged, so this is the
    // core perf clock (`nitroUiCore.now()`, D1) around a render rather than the T02
    // harness: enough to compare the starting guesses against each other and to keep
    // the engine honest on a device, not enough to be a published benchmark. The
    // N=200 timings are logged by the two batch tests above, which is where 200
    // instances are also asserted to be correct. Budgets are deliberately generous -
    // a debug build on a simulator says nothing about release timings. What matters
    // is that only a *wrong* guess costs a state update, and every path ends at the
    // control's size.
    const guesses: BenchGuess[] = ['provisional', 'rightGuess', 'wrongGuess'];
    const rows: BenchRow[] = [];
    for (const count of [1, 50]) {
      for (const guess of guesses) {
        rows.push(await bench(count, `bench-${guess}-${count}`, guess));
      }
    }
    for (const row of rows) {
      console.log(
        `bench: ${row.guess} n=${row.count} ` +
          `${row.mountedIn.toFixed(1)}ms (${row.perInstance.toFixed(2)}ms each) ` +
          `corrections=${row.corrections} confirmed=${row.confirmed} ` +
          `flushes=${row.flushes} ` +
          `maxFlushMs=${row.maxFlushMs.toFixed(3)}`
      );
    }
    for (const count of [1, 50]) {
      for (const guess of guesses) {
        const row = rows.find(
          (candidate) => candidate.guess === guess && candidate.count === count
        )!;
        // A guess that agrees with the control costs nothing to confirm; a wrong
        // one costs exactly one update per instance, and no more.
        expect(row.corrections).toBe(guess === 'wrongGuess' ? count : 0);
        expect(row.confirmed).toBe(guess === 'wrongGuess' ? 0 : count);
        expect(row.mountedIn).toBeLessThan(count > 1 ? 12000 : 4000);
      }
    }
  });
});
