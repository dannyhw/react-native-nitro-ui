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
import { Modal, Platform, Text, TurboModuleRegistry, View } from 'react-native';
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
  Slider,
  Switch,
  type NitroUiSizingStats,
  type NitroUiSizingTraceEvent,
} from 'react-native-nitro-ui';
import { expectTimingBudget } from './timingGate';

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
  /**
   * Read through an optional member: v0.1 keeps the Hybrid View prop types off the
   * public surface (D14), so `@internal` `NitroUiSwitchHandle` does not name it.
   * The getter exists on both platforms, and it is how a test attributes a trace
   * event to *its* control instead of to whatever else is mounted (see the cold
   * test below). `null` here would make that test fail loudly.
   */
  readonly nuiSizingId?: number;
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

/**
 * The library's other self-sizing control, for the rule in FIX2: `fillWidth`, a
 * different host, and a height of its own (48 dp on Android, 31 pt on iOS -
 * D14, the same numbers `ColdSizing.harness.tsx` and `Slider.harness.tsx` use).
 */
const SLIDER_COMPONENT = 'NitroUiSlider';
const SLIDER_HEIGHT = Platform.select({ android: 48, default: 31 })!;
/** What the Slider declares on this platform, restored after poisoning it. */
const SLIDER_FALLBACK = Platform.select({
  android: { width: 328, height: 48 },
  default: { width: 351, height: 31 },
})!;
/** A height that belongs to no control, to make the next Slider cold-wrong. */
const WRONG_SLIDER = { width: 100, height: 13 };

/** Yoga's box, the size a host measured, or the size a test wants: all the same. */
type Size = { width: number; height: number };

/** A size is right when it is within what Yoga rounds to. */
function boxMatches(box: Size | null, size: Size) {
  return (
    box != null &&
    Math.abs(box.width - size.width) < 0.6 &&
    Math.abs(box.height - size.height) < 0.6
  );
}

/**
 * The row `example/src/SwitchScreen.tsx` puts a Switch in: a `flex: 1` label that
 * swallows whatever width the control does not take. That is what turns "the
 * control lost its measurement" into something a person can see (FIX2).
 */
const ROW_STYLE = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
} as const;
const ROW_LABEL = { flex: 1 } as const;

/** Whether two Yoga boxes are the same frame, position included. */
function sameFrame(a: ViewInfo | null, b: ViewInfo | null) {
  if (a == null || b == null) {
    return a === b;
  }
  return (
    Math.abs(a.x - b.x) < 0.6 &&
    Math.abs(a.y - b.y) < 0.6 &&
    boxMatches(a, { width: b.width, height: b.height })
  );
}

function describeBox(box: Size | null) {
  return box == null
    ? 'null'
    : `${box.width.toFixed(2)}x${box.height.toFixed(2)}`;
}

/**
 * One trace event as a short label, for the line a failing run prints.
 */
function sizingEventLabel(event: NitroUiSizingTraceEvent) {
  return `${event.stage}:${event.instanceId}:${event.width.toFixed(1)}x${event.height.toFixed(1)}`;
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

/** Only `value` is read here; see `NitroUiSliderHandle` for the rest. */
type SliderHandle = {
  readonly value: number | null;
};
let sliderHybrid: SliderHandle | null = null;
const captureSliderHybrid = (view: SliderHandle) => {
  sliderHybrid = view;
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

/** Whether a size (a drawn sample, a Yoga box, a measure) is `size` or null. */
function sameSize<T extends Size>(candidate: T | null, size: Size): T | null {
  return candidate != null &&
    Math.abs(candidate.width - size.width) < 0.6 &&
    Math.abs(candidate.height - size.height) < 0.6
    ? candidate
    : null;
}

/**
 * How many of the drawn samples were a size that is not the control's.
 *
 * A first frame can legitimately be the guess - that is the whole iOS/Android
 * difference in `docs/architecture/sizing.md` §3 - so a stale sample is counted
 * against each platform's own bar rather than forbidden outright, and every
 * sample must still be either the guess or the real size. There is one sample per
 * mounted instance - `markFirstFrameIfNeeded` samples the frame a host first
 * commits and disarms until its next recycle - so for a cold first instance this
 * counts the one frame D17 allows to be the declared fallback. A correction that
 * never arrives shows up in the box a test asserts, not in a second sample that
 * was never going to exist.
 */
function drawnFrames(
  trace: NitroUiSizingTraceEvent[],
  real: Size,
  guess: Size
) {
  const drawn = trace.filter(
    (event: NitroUiSizingTraceEvent) => event.stage === 'drew'
  );
  const isReal = (event: NitroUiSizingTraceEvent) =>
    sameSize(event, real) != null;
  const isGuess = (event: NitroUiSizingTraceEvent) =>
    sameSize(event, guess) != null;
  return {
    drawn: drawn.length,
    stale: drawn.filter((event: NitroUiSizingTraceEvent) => !isReal(event))
      .length,
    everySampleExplained: drawn.every(
      (event: NitroUiSizingTraceEvent) => isReal(event) || isGuess(event)
    ),
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
  sliderHybrid = null;
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
    // shadow tree has to learn the size it will keep handing out - asserted on
    // *this instance's* trace events rather than on the process's counters.
    //
    // `toBe(1)` on the global delta was the flake (`corrections=0`, measured on
    // iOS; the same shape as the Android `sizes a control inside a Modal` flake in
    // docs/tasks/FOLLOWUPS.md, which G1 could not reproduce either). Both counters
    // and the seeded guess are process-global, so the delta is this mount's
    // correction *plus* every other Switch in the process that measured in the
    // same window - a control an earlier test left mounted, or one of this file's
    // own, since the runtime is reset between files while the engine is not. And
    // because the guess is shared, whoever measures first also repairs it: when
    // that was not this instance it mounted from the right size with nothing left
    // to correct, and a second control's correction breaks the assertion from the
    // other side. (G1's other suspect for the Android case is the `wrongGuess`
    // test that runs immediately before it - docs/tasks/G1-slider.report.md.)
    //
    // What a lost correction cannot survive is the box assertions above - a Switch
    // that was never corrected stays 40x20 (review S8) - and what a *second*
    // correction cannot survive is this: at most one push for this instance, and
    // if it did start from the wrong guess then it paid that push.
    const mine = trace.filter(
      (event: NitroUiSizingTraceEvent) =>
        event.instanceId === (hybrid?.nuiSizingId ?? -1)
    );
    const laidOut = mine.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'laidOut'
    );
    const corrected = mine.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'corrected'
    );
    expect(laidOut.length).toBeGreaterThan(0);
    expect(corrected.length).toBeLessThanOrEqual(1);
    if (boxMatches(laidOut[0]!, WRONG_GUESS)) {
      // Started from the poison: it must have been outranked, by exactly one push,
      // with the control's own size as the result.
      expect(corrected.length).toBe(1);
      expect(boxMatches(corrected[0]!, expectedBox!)).toBe(true);
    } else {
      // Or its guess was already right when it mounted (another Switch in the
      // process consumed the poison first) - then the only sizes it ever knew are
      // the two real ones.
      expect(boxMatches(laidOut[0]!, expectedBox!)).toBe(true);
      expect(corrected.length).toBe(0);
    }
    // What reached a frame. The guess here is deliberately wrong, so this is the
    // case that separates the platforms (`docs/architecture/sizing.md` §3):
    // Android's pre-draw listener cancels the draw whose layout was stale, iOS
    // commits one frame before a size measured natively can exist. What both must
    // guarantee is that no *third* size appears, and that at most the one frame
    // D17 allows carries the declared fallback (DECISIONS D17). Whether even that
    // frame appears is a race this harness cannot decide: the correction is issued
    // in the same turn, and whether UIKit committed before or after it is not
    // observable from here - so the count is the assertion, and the box above is
    // what proves the correction arrived.
    const frames = drawnFrames(trace, expectedBox!, WRONG_GUESS);
    expect(frames.drawn).toBeGreaterThan(0);
    expect(frames.everySampleExplained).toBe(true);
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
    // `prewarmSizing` seeds from the component's *declared* number - the one D14
    // says must be accurate per OS - and `seedSizingSize` writes that same declared
    // number, so a test that pre-warms has to declare one instead of inheriting the
    // last test's poisoned guess. An accurate declaration is the library's own case;
    // a wrong one is what `corrects a wrong guess before the user sees it` covers.
    seedRightGuess();
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

  /**
   * Wait until every row of a mounted batch is laid out at `size`.
   *
   * A batch that has *mounted* is not a batch that has been corrected: a flush
   * may push only two synchronous updates (D17), so the rest of a cold batch
   * reaches its control's size on a later frame than the one that mounted it.
   * The last view appearing therefore says nothing about the other 199, and
   * sweeping their boxes the moment it does is a race that loses on a loaded
   * machine - while still asserting, in the end, that all of them are right.
   */
  async function waitForAllBoxes(prefix: string, count: number, size: Size) {
    const wrongRows = () => {
      const wrong: string[] = [];
      for (let row = 0; row < count; row += 1) {
        const box = harnessUi.queryByTestId(`${prefix}-${row}`);
        if (!boxMatches(box, size)) {
          wrong.push(`${prefix}-${row}=${describeBox(box)}`);
        }
      }
      return wrong;
    };
    return await pollUntil(
      () => {
        const wrong = wrongRows();
        return wrong.length === 0 ? wrong : null;
      },
      () => {
        const wrong = wrongRows();
        return new Error(
          `${String(wrong.length)} of ${String(count)} boxes never reached ` +
            `${describeBox(size)} - ${wrong.slice(0, 6).join(', ')}` +
            `${wrong.length > 6 ? ', ...' : ''}.`
        );
      },
      20000
    );
  }

  it('mounts 200 at the measured size with nothing to correct', async () => {
    // The pre-warmed batch (R4 answered the easy way): one configuration, one
    // cached size, so 200 instances cost 200 layouts and no state updates. Declared
    // first, for the same reason: pre-warming is only the zero-cost case when the
    // declared number is the control's own.
    seedRightGuess();
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

    // Every one of the 200, once the batch has settled: the guess was wrong for
    // all of them, so a correction that was dropped shows up here as a box that
    // never moves off it.
    await waitForAllBoxes('many-cold', 200, expectedBox!);
    // The flush this batch caused, sampled while it is still the most recent one.
    const flushMs = stats().lastFlushMs;
    console.log(
      `200 cold: mounted in ${mountedIn.toFixed(1)}ms corrections=${d.corrections} ` +
        `immediate=${d.immediate} batched=${d.batched} flushes=${d.flushes} ` +
        `changedFlushes=${d.changedFlushes} flushMs=${flushMs.toFixed(3)} ` +
        `maxFlushMs=${d.maxFlushMs.toFixed(3)}`
    );
    // One update per instance, and never more synchronous ones than the platform
    // is allowed to spend per flush: 2 on iOS, where `flush` runs at the end of a
    // turn whose commit has not happened yet (T11 measured 8.5ms for this batch),
    // and 1 on Android, whose flush runs inside the pre-draw pass it is about to
    // cancel. One is the floor D17 asks for, not a known way to correct a whole
    // batch: the synchronous push clones one family, so the other 199 keep the
    // measurement they cached until their own update arrives. What T12 measured at
    // budget 1 is that this batch drew `stale=0` on one device (the test below logs
    // it and does not assert it). A second push buys nothing measured: first batch
    // in a process, 38.80ms with two pushes against 36.76ms with one; median of
    // three rounds, 18.88ms against 12.84ms - and at 500 rows 42.51ms against
    // 26.77ms (-32% / -37%).
    const immediateBudget = Platform.OS === 'android' ? 1 : 2;
    expect(d.corrections).toBe(200);
    expect(d.immediate).toBeLessThanOrEqual(
      immediateBudget * Math.max(d.flushes, 1)
    );
    // At least one: the instance that reported must be corrected inside the frame
    // this flush cancels, which is the Android half of D17 (`stale=0` for a single
    // cold control is asserted by the cold-Switch test above).
    expect(d.immediate).toBeGreaterThanOrEqual(1);
    expect(d.batched).toBe(d.corrections - d.immediate);
    // The engine's work must stay small next to the mount, and must not be 200
    // synchronous commits. One report corrects every instance that shares the
    // configuration, so the batch costs one flush. Cap-ing corrections per flush is
    // not the knob it looks like: T12 phase 2 found the whole cost is the one
    // synchronous commit, so spending it on fewer instances would keep the ms and
    // lose the correction. The knob is the budget above - how many commits, not how
    // many instances per commit.
    //
    // `maxFlushMs` cannot carry this assertion: it is a process-wide high-water
    // mark, so it also reports every other test's flushes - a test that never
    // flushed at all reads back the slowest flush of the run. `lastFlushMs` is
    // this batch's own. Measured here, debug build: 8.5ms on iOS. On Android it is
    // the re-layout the synchronous push triggers inside the pre-draw pass, which
    // is the same pass that cancels the wrong-size frame (D17) - the frame it
    // spends is the frame it replaces. T12 phase 2 attributed that re-layout: it is
    // the single Fabric commit, and the engine's own work around it (200 reports,
    // one correction, 199 async enqueues) is 0.09ms. One commit of a 200-host tree
    // cost 38.80ms as the first batch in a process and 14.08-18.88ms in the rounds
    // after it, and T11 measured 84-125ms for the same batch on a loaded one, so
    // this is the load-bound number, not a target: the bar stays where T11 put it
    // because it cannot be tightened without turning this test red on a busy
    // machine. The structural guarantee - not N synchronous commits - is carried by
    // the `immediate` gate above, not by milliseconds.
    // Both bars are on a duration, so both are D21 gates: reported on every
    // run, judged only under `HARNESS_TIMING=1` on a quiet machine. The
    // structural guarantee this test is really about - one correction per
    // instance, one flush for the batch - is gated above, on every run.
    await expectTimingBudget({
      label: 'cold batch of 200: one correction flush',
      measuredMs: flushMs,
      limitMs: mountedIn * 0.1,
      note: 'the batch may not cost more than a tenth of its own mount',
    });
    await expectTimingBudget({
      label: 'cold batch of 200: one correction flush',
      measuredMs: flushMs,
      limitMs: Platform.OS === 'android' ? 250 : 40,
      note: 'bar placed by T11; T12 attributed the Android half to the pre-draw re-layout',
    });
    unmount();
  });

  it('counts how many boxes of a cold batch reached a frame wrong', async () => {
    /**
     * The number review S6 asked for, and the one the round-1 report did not have.
     *
     * A flush cancels the frame whose layout it is about to fix on Android, but
     * only the platform's budget of them is issued synchronously - 1 on Android
     * since T12, 2 on iOS - and one synchronous push clones one family, so an
     * untouched sibling is not corrected by it at all. The rest are `Asynchronous`
     * state updates that reach the JS thread some time later. So "Android never
     * shows a wrong box" is guaranteed only for the instance that reported, and for
     * the rest it is a question of when the batch's commits land relative to the
     * redraw. T12 measured `stale=0` for this batch at budget 1 on `nitroui_t02`,
     * against `stale=100` at budget 0 - a timing result on one device, not a
     * property of the budget, which is why the count below stays a log.
     *
     * This test measures it instead of arguing about it: 100 instances
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
    // R6, for sizing. RN's `Modal` is a second window with its own
    // `ViewTreeObserver`, which stops scheduling draws once the dialog has been
    // presented. That makes it the shape of test that asks whether a queued
    // correction lands on its own: Android's flush is a pre-draw listener, and a
    // pre-draw listener is a request to be consulted at the next draw, not a
    // request for one. `scheduleSizingFlush` therefore requests the draw as well
    // (`postInvalidateOnAnimation`), and the poisoned fallback below is what makes
    // the cold mount in it about more than the happy path.
    //
    // Being exact about what this can prove, because the review asked for a red: a
    // correction is only ever *produced* by a native measure (Compose's `Layout`
    // block is the only caller of `reportToSizingEngine`), so a report always
    // arrives inside a traversal - and an RN dialog does not stop at that
    // traversal. Instrumented on `nitroui_t01`, the dialog traversed again 4 ms and
    // 11 ms after the report, and with the draw request removed this test passed 9
    // runs out of 9. The round-0 flake that started this (one run in three,
    // `queued=1, flushes=0`) is the rare ordering where the composition's
    // invalidations and Fabric's layout pass collapse into a single traversal, and
    // no JS-side arrangement of mounts, re-renders, hidden wrappers or settled
    // dialogs reproduced it. So the drain cannot be forced from JS, and the
    // mechanism is guarded where a guard can see it:
    // `scripts/check-sizing-flush-draw-request.sh`, which is red without the
    // request and runs inside `bun run check`. What is asserted here is the
    // behaviour that depends on it - in both shapes the dialog offers: the cold
    // mount below, and a size that changes while the dialog is already presented
    // and quiet, where there is no presenting draw left to hide behind.
    //
    // The harness cannot query a testID inside that window (H9, H10), so both
    // oracles are read from inside the host: the size the control measured, and
    // this instance's own trace events - not the process's counters, and not any
    // instance's `drew` sample, which stops on the wrong side of a race.
    seedWrongGuess();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { rerender, unmount } = await render(
      <Modal visible animationType="none">
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Switch defaultValue testID="modal-size" hybridRef={captureHybrid} />
        </View>
      </Modal>
    );

    const instanceId = await pollUntil(
      () => {
        const id = hybrid?.nuiSizingId ?? 0;
        return id > 0 ? id : null;
      },
      () =>
        new Error(
          `Modal host never reported a nuiSizingId (handle keys: ${String(
            Object.keys(hybrid ?? {}).join(',') || 'none'
          )}).`
        ),
      15000
    );
    // This instance's own `corrected`, and nothing less: it is recorded when a
    // flush pushes the correction into this instance's Fabric state, so a report
    // left queued in a window nobody redraws fails right here.
    const trace = await collectTrace(
      (events) =>
        events.some(
          (event) =>
            event.instanceId === instanceId && event.stage === 'corrected'
        ),
      8000
    );
    const content = hybrid?.measureContent() ?? null;
    const cold = delta(before, stats());
    const own = trace.filter(
      (event: NitroUiSizingTraceEvent) => event.instanceId === instanceId
    );
    const laidOut = own.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'laidOut'
    );
    const corrected = own.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'corrected'
    );
    console.log(
      `modal cold: id=${String(instanceId)} content=${describeBox(content)} ` +
        `trace=${String(JSON.stringify(own.map(sizingEventLabel)))} d=${JSON.stringify(cold)}`
    );

    expect(content).not.toBeNull();
    // The dialog mounted from the poisoned guess (the wait above proves a report
    // reached the engine, and `laidOut` names the box the first measure answered
    // with), so `corrected` is the control's own measurement outranking it - and
    // it can only be that instance's own.
    expect(laidOut.length).toBeGreaterThan(0);
    expect(Math.abs(laidOut[0]!.width - WRONG_GUESS.width)).toBeLessThan(1.5);
    expect(Math.abs(laidOut[0]!.height - WRONG_GUESS.height)).toBeLessThan(1.5);
    expect(corrected.length).toBeGreaterThan(0);
    expect(Math.abs(content!.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content!.height - expectedBox!.height)).toBeLessThan(1.5);
    for (const event of corrected) {
      expect(Math.abs(event.width - content!.width)).toBeLessThan(0.6);
      expect(Math.abs(event.height - content!.height)).toBeLessThan(0.6);
    }
    // The dialog is the only window doing work, so the flush that pushed this
    // correction is this mount's.
    expect(cold.flushes).toBeGreaterThan(0);
    // And no third box: whatever the dialog drew (a `drew` sample may or may not
    // exist for a dialog host - RN mounts its tree on the second surface
    // separately, so the sample can miss the sizing id), every sample is the guess
    // or the control's size.
    expect(drawnFrames(own, content!, WRONG_GUESS).everySampleExplained).toBe(
      true
    );

    // A size that arrives *after* the dialog has been presented, drawn, and gone
    // quiet. The wide configuration is cold, so this control is laid out at the
    // component's guess and has to be corrected to the wide size - and the only
    // thing that can apply that correction is a traversal of a dialog window that
    // has no reason left to draw. This is the shape `postInvalidateOnAnimation`
    // exists for, and the phase that would fail first if the request were dropped
    // on a device slow enough to miss the redraw the composition itself causes.
    nitroUiCore.drainSizingTrace();
    const beforeWide = stats();
    await rerender(
      <Modal visible animationType="none">
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Switch
            defaultValue
            nuiTestWidth={TEST_WIDTH}
            testID="modal-size"
            hybridRef={captureHybrid}
          />
        </View>
      </Modal>
    );
    const lateTrace = await collectTrace(
      (events) =>
        events.some(
          (event) =>
            event.instanceId === instanceId && event.stage === 'corrected'
        ),
      8000
    );
    const late = delta(beforeWide, stats());
    const lateOwn = lateTrace.filter(
      (event: NitroUiSizingTraceEvent) => event.instanceId === instanceId
    );
    const lateCorrected = lateOwn.filter(
      (event: NitroUiSizingTraceEvent) => event.stage === 'corrected'
    );
    const wideContent = hybrid?.measureContent() ?? null;
    console.log(
      `modal late: content=${describeBox(wideContent)} ` +
        `trace=${String(JSON.stringify(lateOwn.map(sizingEventLabel)))} ` +
        `d=${JSON.stringify(late)}`
    );
    expect(boxMatches(wideContent, wideBox)).toBe(true);
    expect(lateCorrected.length).toBeGreaterThan(0);
    expect(late.flushes).toBeGreaterThan(0);
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
   * Wait for the box of `testID` to be `size`, so a size is asserted once the
   * correction has actually reached the layout.
   */
  async function waitForBoxSize(testId: string, size: Size, what: string) {
    return await pollUntil(
      () => {
        const box = harnessUi.queryByTestId(testId);
        return boxMatches(box, size) ? box : null;
      },
      () =>
        new Error(
          `testID "${testId}" (${what}) never reached ${String(
            size.width
          )}x${String(size.height)} - last box ${describeBox(
            harnessUi.queryByTestId(testId)
          )}.`
        ),
      8000
    );
  }

  /**
   * Wait for the box of `testID` to be `height` tall. A `fillWidth` control's
   * width belongs to its container, so its height is the half a test can name.
   */
  async function waitForBoxHeight(
    testId: string,
    height: number,
    what: string
  ) {
    return await pollUntil(
      () => {
        const box = harnessUi.queryByTestId(testId);
        return box != null && Math.abs(box.height - height) < 0.6 ? box : null;
      },
      () =>
        new Error(
          `testID "${testId}" (${what}) never reached ${String(
            height
          )} tall - last box ${describeBox(harnessUi.queryByTestId(testId))}.`
        ),
      8000
    );
  }

  /**
   * FIX2 (found by T15's real-input runner, and it reproduces with no touch).
   *
   * A controlled `Switch` re-rendered with a new `value` was laid out as though it
   * had no width at all: the row's label grew by exactly the Switch's 61 pt, and
   * SwiftUI drew the `Toggle` at its intrinsic size past the right edge of the
   * window, out of the accessibility tree. `value` changes no size, so the turn may
   * cost no measure of the control and no state update - the box has to stay the
   * one the control already earned.
   *
   * It starts from `seedWrongGuess`, because that is the state the bug needs: an
   * instance the engine had to *correct*. That is an ordinary cold mount (a first
   * answer that is not the control's size - the pre-T14 first frame, a control
   * whose real size differs from the number it declares, the first mount after an
   * environment change), and it is the only state in which React's own revision can
   * still be carrying the superseded box - its Yoga cache and `layoutMetrics_` both
   * predate the correction, and nothing re-dirties them (D20): with the
   * bug the box below comes back 40x20, the seeded guess, and stays there for the
   * rest of the mount, because `measureContent` is never reached again to notice.
   * Mounting a second Switch heals it - that correction is for every instance of
   * the configuration - which is how T15 saw a box that only broke once.
   */
  it('keeps a mounted Switch laid out when only its value changes', async () => {
    seedWrongGuess();
    const row = (value: boolean) => (
      <View style={ROW_STYLE}>
        <Text style={ROW_LABEL} testID="value-label">
          Label
        </Text>
        <Switch value={value} testID="value-switch" hybridRef={captureHybrid} />
      </View>
    );
    const { rerender, unmount } = await render(row(false));
    // The correction has to have landed first, or this box is just the guess.
    const startSwitch = await waitForBoxSize(
      'value-switch',
      expectedBox!,
      'the controlled Switch after its correction'
    );
    const startLabel = harnessUi.queryByTestId('value-label');
    expect(startLabel).not.toBeNull();
    const before = stats();

    await rerender(row(true));
    await settle();

    // The turn must actually have reached the control: an update that never
    // happened would keep every box below green for the wrong reason.
    expect(hybrid?.value).toBe(true);
    const box = harnessUi.queryByTestId('value-switch');
    const label = harnessUi.queryByTestId('value-label');
    const d = delta(before, stats());
    console.log(
      `value change: switch=${describeBox(box)} at x=${String(
        (box?.x ?? 0).toFixed(1)
      )} label=${describeBox(label)} measured=${describeBox(
        hybrid?.measureContent() ?? null
      )} d=${String(JSON.stringify(d))}`
    );
    // Both halves: the control's own box is the bug, and the sibling's is what a
    // person sees - Yoga gave the row's other child the width that went missing.
    expect(boxMatches(box, expectedBox!)).toBe(true);
    expect(sameFrame(box, startSwitch)).toBe(true);
    expect(sameFrame(label, startLabel)).toBe(true);
    // The turn costs a re-ask, not another commit: fixing this by pushing state on
    // every prop change would show up here.
    expect(d.corrections).toBe(0);
    unmount();
  });

  /**
   * The same turn for the other self-sizing control, so the rule is tested as a
   * rule and not as a Switch workaround: `fillWidth`, a different host, and a
   * sibling stacked above it instead of beside it. A Slider's `value` never moves
   * its size, so its box and its sibling's both have to stand still - and, as for
   * the Switch, without a state update to make them.
   */
  it('keeps a mounted Slider laid out when only its value changes', async () => {
    nitroUiCore.seedSizingSize(
      SLIDER_COMPONENT,
      '',
      WRONG_SLIDER.width,
      WRONG_SLIDER.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    const column = (value: number) => (
      <View>
        <Text testID="value-slider-label">Slider label</Text>
        <Slider
          value={value}
          testID="value-slider"
          hybridRef={captureSliderHybrid}
        />
      </View>
    );
    const { rerender, unmount } = await render(column(0.5));
    const startSlider = await waitForBoxHeight(
      'value-slider',
      SLIDER_HEIGHT,
      'the controlled Slider after its correction'
    );
    const startLabel = harnessUi.queryByTestId('value-slider-label');
    expect(startLabel).not.toBeNull();
    const before = stats();

    await rerender(column(0.75));
    await settle();

    expect(sliderHybrid?.value).toBe(0.75);
    const box = harnessUi.queryByTestId('value-slider');
    const label = harnessUi.queryByTestId('value-slider-label');
    const d = delta(before, stats());
    console.log(
      `slider value change: box=${describeBox(box)} label=${describeBox(
        label
      )} d=${String(JSON.stringify(d))}`
    );
    expect(sameFrame(box, startSlider)).toBe(true);
    expect(sameFrame(label, startLabel)).toBe(true);
    expect(d.corrections).toBe(0);
    unmount();
    // Seeding overwrites the declaration for this process, so the accurate one
    // goes back on the way out (the rule `ColdSizing.harness.tsx` follows).
    nitroUiCore.seedSizingSize(
      SLIDER_COMPONENT,
      '',
      SLIDER_FALLBACK.width,
      SLIDER_FALLBACK.height
    );
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

  it('measures the width that arrived with the first commit', async () => {
    // The mount-time half of the review S1 rule, and round 3's root cause:
    // `commit()` measured in the same turn as `model.objectWillChange.send()`, and
    // `send()` only *invalidates* SwiftUI's graph - the body is re-evaluated in a
    // later update pass. The first measure therefore numbered the content the props
    // had just replaced (the plain Switch), and the engine filed that as this
    // configuration's size and stopped asking: 61x28 handed to a control that is
    // 100 wide, believed exact, and never corrected again.
    //
    // The fixture starts from the *accurate* declared size (D14), and that choice
    // is the test. A poisoned guess is the reflex and is wrong here: it makes the
    // box move on the first correction, and on iOS a box move is what triggers the
    // re-measure that then finds the real content - the stale number survives one
    // frame and the test passes anyway. Starting at the declared 61x28, the stale
    // number agrees with the guess, the box never moves, and nothing but a measure
    // of the actual content can reach 100. This is also the case a real control
    // hits: its declared fallback is right for the library and wrong for it.
    seedRightGuess();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const wide = await render(
      <Switch
        defaultValue
        nuiTestWidth={TEST_WIDTH}
        testID="first-commit-wide"
        hybridRef={captureHybrid}
      />,
      { timeout: 20000 }
    );
    const box = await waitForBoxWidth(
      'first-commit-wide',
      TEST_WIDTH,
      'a control whose width arrived with its first props'
    );
    const measured = hybrid?.measureContent() ?? null;
    const d = delta(before, stats());
    const trace = await collectTrace(hasDrawnSample);
    console.log(
      `first commit wide: box=${describeBox(box)} measured=${describeBox(
        measured
      )} d=${JSON.stringify(d)} trace=${JSON.stringify(
        trace.map(
          (e) => `${e.stage}:${e.width.toFixed(1)}x${e.height.toFixed(1)}`
        )
      )}`
    );
    expect(boxMatches(box, wideBox)).toBe(true);
    // The control's own number rather than Yoga's box: this is what gets cached as
    // the configuration's size, and it was 61x28 while the model asked for 100.
    expect(boxMatches(measured, wideBox)).toBe(true);
    // One state update, because this configuration had never been measured: the
    // declared number it started from was provisional and the control outranks it
    // (review B2). Zero here would mean the wide control was never asked.
    expect(d.corrections).toBe(1);
    // Frames: at most the declared size for one frame (D17), and no third size -
    // in particular not a size belonging to another instance of this host.
    const frames = drawnFrames(trace, wideBox, expectedBox!);
    expect(frames.everySampleExplained).toBe(true);
    expect(frames.stale).toBeLessThanOrEqual(Platform.OS === 'android' ? 0 : 1);
    wide.unmount();

    // ...and the number a host measured must stay with the instance it measured.
    // RN recycles views, so the plain Switch below very likely inherits the host
    // that just numbered a 100-wide control. Its own configuration is already
    // answered, so the correct outcome costs nothing; a leaked 100x28 would
    // outrank the cache, cost a correction, and leave the control 100 wide.
    const recycled = stats();
    const plain = await render(
      <Switch defaultValue testID="after-recycle" hybridRef={captureHybrid} />,
      { timeout: 20000 }
    );
    const plainBox = await waitForBoxWidth(
      'after-recycle',
      expectedBox!.width,
      'a plain control mounted on a host that measured a wider one'
    );
    const recycledDelta = delta(recycled, stats());
    console.log(
      `after recycle: box=${describeBox(plainBox)} measured=${describeBox(
        hybrid?.measureContent() ?? null
      )} d=${JSON.stringify(recycledDelta)}`
    );
    expect(boxMatches(plainBox, expectedBox!)).toBe(true);
    expect(boxMatches(hybrid?.measureContent() ?? null, expectedBox!)).toBe(
      true
    );
    expect(recycledDelta.corrections).toBe(0);
    plain.unmount();
  });

  it('corrects a control that is already mounted when the environment moves', async () => {
    // Review S2: `invalidateEnvironment` used to clear the ledger, so the next
    // report of a mounted control was answered "nothing ever laid out" and it kept
    // its old size until it remounted. A Switch does not move with the text size,
    // so the environment is moved under a mounted control and the control is then
    // asked for a genuinely new size.
    //
    // What this proves on device is what a host test cannot: the bump keeps a
    // mounted instance alive and commits nothing for a size that did not move, and
    // a control that really does change size afterwards is still corrected in the
    // new epoch. What it does *not* pin is S2 itself - the `nuiTestWidth` re-render
    // changes the sizing key, which dirties the measurement, and the resulting
    // `measure` rebuilds the very ledger entry a dropping bump would have deleted,
    // so round 1's code passes here too (round-2 review F1/F2 found this). The gate
    // for the dropping bug is `testEnvironmentChangeCorrectsAReportWithNoMeasure`
    // in `scripts/native-tests/sizing.test.cpp`, which reports after a bump with no
    // re-measure - the order a real trait change happens in.
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
    // The control was already on screen, in the new epoch, with no cached size -
    // and its own measure still reached the instance that had to be corrected, so
    // the new size arrived rather than waiting for a remount. Read together with
    // the note at the top of this test: this is the correction working, not the
    // gate for a dropped report (a host test owns that one).
    expect(boxMatches(box, wideBox)).toBe(true);
    expect(d.corrections).toBe(1);
    unmount();
  });

  /**
   * The control the two cases below drive: the same `Switch`, optionally hidden with
   * `display: 'none'`, and optionally given a different `nuiTestWidth` — the only
   * size-affecting prop a Switch has (`SwitchProps.nuiTestWidth`, TEMPORARY per S1).
   *
   * Round 1's forgotten-id guard refused to file a layout for an id the engine had
   * finished, on the assumption that an id which mounts again is a new id. It is not:
   * `useSizingId` mints one per **React** mount (`src/core/useSizingId.ts`), so on iOS a
   * hide that tears the native view down (`onDropView` → `host.drop()` → `forget(id)`)
   * without ending the React mount leaves an id that comes back later attached to a
   * brand-new native view — laid out one step *before* the mount transaction re-binds it.
   * Round 1 refused that layout, the bind then cleared the mark, and the instance was
   * left bound with no ledger entry: `report` returns at its first line without one, and
   * `invalidateSizingEnvironment` re-keys `ledger_` and so cannot reach it. The control
   * kept the size it was laid out at for the rest of its life — one lost correction per
   * hide/show, and a `sizingKey` change made while hidden was the visible case.
   *
   * Both cases therefore move the size *while hidden* and then re-show, with a guess
   * seeded to a size that is not the control's (review S8), so a correction that never
   * arrives leaves the box visibly at 40x20 instead of passing quietly. Every prop is
   * passed on every render, `nuiTestWidth` included (nitro#1184); `null` is that prop's
   * own default, i.e. the control's normal configuration.
   */
  const reShownSwitch = (hidden: boolean, width: number | null) => (
    <Switch
      defaultValue
      nuiTestWidth={width}
      testID="reshown"
      accessibilityLabel="Sizing re-shown switch"
      hybridRef={captureHybrid}
      {...(hidden ? { style: { display: 'none' } } : {})}
    />
  );

  /**
   * Assert which of the two `display: none` paths a run actually took, and describe it.
   *
   * The property is platform-divergent, and the difference is the whole point of the two
   * cases below. iOS Fabric creates **no native view** for a hidden node, so hiding one is
   * a real teardown and the engine forgets the instance (`ledgerEntries` falls) — the
   * re-show path the forgotten-id rule exists for. Android reaches the view as `INVISIBLE`
   * (`NitroComposeHost.kt:424`), so nothing is torn down, nothing is forgotten, and its
   * "re-show" is a visibility flip that cannot lose a correction.
   *
   * Asserted rather than printed, because `console.log` from a harness file reaches
   * neither the gate log nor the report (X4 round 2 found that for this suite's own
   * findings): a note about which path ran is worth nothing if nobody can read it. And
   * asserted in both directions — if iOS ever starts leaving a hidden view alive, these
   * cases would pass for the same reason Android's does, and the regression guard would
   * be gone with no red anywhere to notice. Measured, not assumed: `1→0` on iOS and
   * `1→1` on Android, both read from runs of this case.
   *
   * On iOS the drop arrives with the transaction that removes the view and the
   * deallocation with it, so the fall is waited for rather than read once — the same
   * reason `Conformance`'s leak rule waits for its drops instead of assuming unmount is
   * synchronous.
   */
  async function expectHidePath(
    mountedLedger: number,
    expected: 'torn-down' | 'kept-alive'
  ) {
    if (expected === 'torn-down') {
      const after = await pollUntil(
        () => {
          const now = stats().ledgerEntries;
          return now < mountedLedger ? now : null;
        },
        () =>
          new Error(
            `display:none did not tear the hidden view down on iOS (ledger stayed at ` +
              `${String(mountedLedger)}), so this run never exercised the re-show path ` +
              'this case exists to guard: it would have passed for Android’s reason.'
          ),
        4000
      );
      return `tore the hidden view down (ledger ${String(mountedLedger)}→${String(
        after
      )}): the re-show path`;
    }
    const now = stats().ledgerEntries;
    if (now < mountedLedger) {
      throw new Error(
        `display:none tore the view down on Android (ledger ${String(
          mountedLedger
        )}→${String(now)}), which is not what \`NitroComposeHost.kt:424\` says happens ` +
          '(RN’s `display: none` reaches a view as INVISIBLE). If that changed, this ' +
          'suite has a second platform on the re-show path and the expectation here ' +
          'needs updating deliberately, not by a green run.'
      );
    }
    return `left the hidden view alive (ledger ${String(mountedLedger)}→${String(
      now
    )}): the visibility-flip path`;
  }

  it('corrects a control hidden with display:none when it is shown again', async () => {
    seedWrongGuess();
    const before = stats();

    // Mounted and correct.
    const { rerender, unmount } = await render(reShownSwitch(false, null));
    await waitForBoxWidth(
      'reshown',
      expectedBox.width,
      'the control before it was hidden'
    );
    await settle(300);
    const mounted = stats();
    expect(mounted.ledgerEntries).toBeGreaterThan(0);

    // Hidden, with its size-affecting prop moved while it is hidden — the case the
    // reviewer reproduced, where the new configuration has never been laid out.
    await rerender(reShownSwitch(true, TEST_WIDTH));
    const hidePath = await expectHidePath(
      mounted.ledgerEntries,
      Platform.OS === 'ios' ? 'torn-down' : 'kept-alive'
    );

    // Shown again with no further change: the re-shown view's own layout is the first
    // thing the engine sees for this configuration, and round 1 refused to file it.
    await rerender(reShownSwitch(false, TEST_WIDTH));
    const box = await waitForBoxWidth(
      'reshown',
      TEST_WIDTH,
      'the control after it was shown again'
    );
    const d = delta(mounted, stats());
    console.log(
      `  hide ${hidePath}; re-show box=${describeBox(box)} ` +
        `corrections=${String(d.corrections)}`
    );
    expect(boxMatches(box, wideBox)).toBe(true);
    // Exactly one, counted across the whole hide→show window: correcting the size while
    // hidden and again afterwards is paying for one change twice.
    expect(d.corrections).toBe(1);

    // And the entry that came back left nothing on hold for the rest of the run.
    unmount();
    await settle(600);
    const dropped = stats();
    expect(dropped.ledgerEntries).toBeLessThanOrEqual(before.ledgerEntries);
    expect(dropped.registryEntries).toBeLessThanOrEqual(before.registryEntries);
  });

  it('corrects a control shown again after the environment moved while it was hidden', async () => {
    seedWrongGuess();
    const before = stats();
    const epoch = stats().environmentEpoch;

    const { rerender, unmount } = await render(reShownSwitch(false, null));
    await waitForBoxWidth(
      'reshown',
      expectedBox.width,
      'the control before it was hidden'
    );
    await settle(300);
    const mounted = stats();

    await rerender(reShownSwitch(true, TEST_WIDTH));
    const hidePath = await expectHidePath(
      mounted.ledgerEntries,
      Platform.OS === 'ios' ? 'torn-down' : 'kept-alive'
    );

    // The environment moves while it is hidden: every ledger entry is re-keyed and
    // marked inexact so that its next report is a correction (`invalidateEnvironment`,
    // review S2). An instance with no entry is not in that walk at all — the second way
    // round 1 lost a correction, and the one no later re-measure repairs.
    nitroUiCore.invalidateSizingEnvironment();
    await settle(300);
    expect(stats().environmentEpoch).toBe(epoch + 1);

    await rerender(reShownSwitch(false, TEST_WIDTH));
    const box = await waitForBoxWidth(
      'reshown',
      TEST_WIDTH,
      'the control after it was shown again, in the new environment'
    );
    const d = delta(mounted, stats());
    console.log(
      `  hide ${hidePath}; re-show after an environment change ` +
        `box=${describeBox(box)} corrections=${String(d.corrections)}`
    );
    expect(boxMatches(box, wideBox)).toBe(true);
    expect(d.corrections).toBe(1);

    unmount();
    await settle(600);
    expect(stats().ledgerEntries).toBeLessThanOrEqual(before.ledgerEntries);
    expect(stats().registryEntries).toBeLessThanOrEqual(before.registryEntries);
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
    // and the rows that stay must still be laid out at the control's size - so the
    // declaration here is the control's real size, which lets a row be checked the
    // moment it is queried instead of mid-correction.
    seedRightGuess();
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
        await expectTimingBudget({
          label: `bench: mount a batch of ${String(count)}`,
          measuredMs: row.mountedIn,
          limitMs: count > 1 ? 12000 : 4000,
          note: 'the batch below it, whatever the starting guess',
        });
      }
    }
  });
});
