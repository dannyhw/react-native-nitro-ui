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
  /** How a test attributes a trace event to its own control. */
  readonly nuiSizingId?: number;
};

/**
 * The size this platform's control really is, written out rather than imported:
 * a SwiftUI `Toggle(.switch)` is 61x28 pt on iOS 26+ and 51x31 before, and a
 * Material 3 Switch is 52x48 dp.
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

/** The Slider fills its container's width and has a height of its own. */
const SLIDER_COMPONENT = 'NitroUiSlider';
const SLIDER_HEIGHT = Platform.select({ android: 48, default: 31 })!;
/** What the Slider declares on this platform, restored after poisoning it. */
const SLIDER_FALLBACK = Platform.select({
  android: { width: 328, height: 48 },
  default: { width: 351, height: 31 },
})!;
/** A height that belongs to no control, to make the next Slider cold-wrong. */
const WRONG_SLIDER = { width: 100, height: 13 };

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
 * A row whose `flex: 1` label swallows whatever width the control does not take,
 * so a control that loses its width shows up in the label's box too.
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
 * A `drew` event is sampled one runloop turn after the frame it describes, so a
 * read races the sample, and `drainSizingTrace` consumes the ring.
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

/**
 * `hybridRef` fires on a props turn after the mount that puts the view on screen,
 * so the handle is waited for rather than read straight after a render.
 */
async function handleArrived(what: string): Promise<SwitchHandle> {
  return pollUntil(
    () => hybrid,
    () =>
      new Error(
        `no hybridRef handle for ${what} — the control rendered, but never handed itself over.`
      )
  );
}

/**
 * What the hosted control measured, once it has measured. The host answers `0x0`
 * until its first layout pass has run, so this waits for a real size.
 */
async function measuredContent(what: string): Promise<Size> {
  const handle = await handleArrived(what);
  return pollUntil(
    () => {
      const size = handle.measureContent();
      return size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`${what}: measureContent() never reported a size.`)
  );
}

/** Enough to read a first frame: the drawn sample has arrived. */
const hasDrawnSample = (events: NitroUiSizingTraceEvent[]) =>
  events.some((event) => event.stage === 'drew');

let hybrid: SwitchHandle | null = null;
const captureHybrid = (view: SwitchHandle) => {
  hybrid = view;
};

/** Only `value` is read here. */
type SliderHandle = {
  readonly value: number | null;
};
let sliderHybrid: SliderHandle | null = null;
const captureSliderHybrid = (view: SliderHandle) => {
  sliderHybrid = view;
};

const stats = () => nitroUiCore.sizingStats();

/**
 * `after - before` for the counters a test asserts on. The counters are
 * process-global and monotonic, so every assertion is a delta.
 */
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
 * A size that is not this control's, seeded as the engine's guess before a cold
 * test. If a correction is lost the box stays at this; a guess equal to the real
 * size would pass even when no correction arrives.
 */
const WRONG_GUESS = { width: 40, height: 20 };

/**
 * Make the engine's next cold layout start from `size`: invalidating drops the
 * cached answers and keeps the component's last known size as the guess. The
 * guess is process-global, so every test that depends on it seeds its own.
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
 * How many of the drawn samples were a size that is not the control's. There is
 * one sample per mounted instance: the first frame its host commits, which may
 * legitimately be the guess.
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

/** `nuiTestWidth` is the only size-affecting prop a Switch has. */
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
    // controller / composition) here, so every number below is a steady-state
    // mount and not the app's first.
    const { unmount } = await render(
      <Switch defaultValue testID="size-warm-up" />,
      {
        timeout: 20000,
      }
    );
    unmount();
  });

  it('lays a cold Switch out at the size the control measures', async () => {
    // The guess is deliberately wrong, so the box can only be right through a
    // correction.
    seedWrongGuess();
    nitroUiCore.setSizingTraceEnabled(true);
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="cold" hybridRef={captureHybrid} />
    );
    const box = await waitForTestId('cold');
    const content = await measuredContent('the cold Switch');
    const trace = await collectTrace(hasDrawnSample);

    console.log(
      `cold: box=${describeBox(box)} content=${JSON.stringify(content)} ` +
        `trace=${JSON.stringify(trace.map((e) => `${e.stage}:${e.width.toFixed(1)}x${e.height.toFixed(1)}`))} ` +
        `d=${JSON.stringify(delta(before, stats()))}`
    );

    expect(boxMatches(box, expectedBox!)).toBe(true);
    expect(Math.abs(content.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content.height - expectedBox!.height)).toBeLessThan(1.5);
    // The invariant that holds in every environment: the box is the control.
    expect(Math.abs(box!.width - content.width)).toBeLessThan(0.6);
    expect(Math.abs(box!.height - content.height)).toBeLessThan(0.6);

    // Asserted on this instance's own trace events, not on the process's counters:
    // the counters and the seeded guess are process-global, so another Switch that
    // measures in the same window both moves the delta and repairs the guess.
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
      // Started from the wrong guess: exactly one push, to the control's own size.
      expect(corrected.length).toBe(1);
      expect(boxMatches(corrected[0]!, expectedBox!)).toBe(true);
    } else {
      // Another Switch in the process repaired the guess first: nothing to correct.
      expect(boxMatches(laidOut[0]!, expectedBox!)).toBe(true);
      expect(corrected.length).toBe(0);
    }
    // With a wrong guess the platforms differ: Android's pre-draw listener cancels
    // the draw whose layout was stale, iOS can commit one frame before a natively
    // measured size exists. Neither may draw a third size.
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
    // Same epoch, same configuration: the cache has the answer, so the report is
    // dropped instead of queued.
    const before = stats();
    const { unmount } = await render(
      <Switch defaultValue testID="warm" hybridRef={captureHybrid} />
    );
    const box = await waitForTestId('warm');
    const content = await measuredContent('the warm Switch');
    const d = delta(before, stats());

    console.log(`warm: box=${describeBox(box)} d=${JSON.stringify(d)}`);
    expect(boxMatches(box, expectedBox!)).toBe(true);
    expect(Math.abs(content.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(d.corrections).toBe(0);
    expect(d.dropped).toBeGreaterThan(0);
    unmount();
  });

  it('pre-warms from the declared size so the first mount is exact', async () => {
    // `prewarmSizing` seeds from the component's declared size, which
    // `seedSizingSize` overwrites, so this test declares the right one first.
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
    // The first instance is laid out from the cache, so there is nothing to push.
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
      // The default render wait is one second; 200 hosted controls need more.
      { timeout: 25000 }
    );
    await waitForTestId(`${prefix}-${count - 1}`, 20000);
    return { mountedIn: nitroUiCore.now() - startedAt, unmount };
  }

  /**
   * Wait until every row of a mounted batch is laid out at `size`. A flush pushes
   * only a few corrections synchronously, so the rest of a cold batch reaches its
   * size on a later frame than the one that mounted it.
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
    // One configuration, one cached size: 200 instances cost no state updates.
    // Pre-warming is only free when the declared size is the control's own.
    seedRightGuess();
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.prewarmSizing([COMPONENT]);
    const before = stats();
    const { mountedIn, unmount } = await mountMany(200, 'many-warm');
    const d = delta(before, stats());

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
    // The instances share a configuration, so the first report corrects every one
    // and the other 199 reports are dropped. What must stay bounded is how many of
    // those updates are synchronous, because each can force a same-turn commit.
    seedWrongGuess();
    const before = stats();
    const { mountedIn, unmount } = await mountMany(200, 'many-cold');
    const d = delta(before, stats());

    await waitForAllBoxes('many-cold', 200, expectedBox!);
    // The flush this batch caused, sampled while it is still the most recent one.
    const flushMs = stats().lastFlushMs;
    console.log(
      `200 cold: mounted in ${mountedIn.toFixed(1)}ms corrections=${d.corrections} ` +
        `immediate=${d.immediate} batched=${d.batched} flushes=${d.flushes} ` +
        `changedFlushes=${d.changedFlushes} flushMs=${flushMs.toFixed(3)} ` +
        `maxFlushMs=${d.maxFlushMs.toFixed(3)}`
    );
    // Synchronous updates allowed per flush: iOS flushes at the end of a turn whose
    // commit has not happened yet, Android inside the pre-draw pass it is about to
    // cancel.
    const immediateBudget = Platform.OS === 'android' ? 1 : 2;
    expect(d.corrections).toBe(200);
    expect(d.immediate).toBeLessThanOrEqual(
      immediateBudget * Math.max(d.flushes, 1)
    );
    // At least one: the instance that reported is corrected inside the frame this
    // flush cancels.
    expect(d.immediate).toBeGreaterThanOrEqual(1);
    expect(d.batched).toBe(d.corrections - d.immediate);
    unmount();
  });

  it('keeps an explicit width, height and flex in charge', async () => {
    // The base style is a default, applied before the caller's, so anything the
    // caller decides still wins.
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
    // `flex: 1` grows the main axis; the wrapper's `alignSelf: 'flex-start'` base
    // style keeps the cross axis at the measured size.
    expect(Math.abs(flexed!.width - 300)).toBeLessThan(0.6);
    expect(Math.abs(flexed!.height - expectedBox!.height)).toBeLessThan(0.6);
    expect(Math.abs(stretched!.width - 300)).toBeLessThan(0.6);
    expect(Math.abs(stretched!.height - expectedBox!.height)).toBeLessThan(0.6);
    unmount();
  });

  it('corrects a wrong guess before the user sees it', async () => {
    // Both phases seed after the epoch they are about: a measured size overwrites
    // the component's fallback, so one correction repairs the guess for the next
    // epoch.
    const wrong = { width: 120, height: 90 };
    nitroUiCore.invalidateSizingEnvironment();
    nitroUiCore.seedSizingSize(COMPONENT, '', wrong.width, wrong.height);
    const cold = stats().environmentEpoch;
    const before = stats();
    const first = await render(
      <Switch defaultValue testID="poisoned" hybridRef={captureHybrid} />
    );
    await waitForTestId('poisoned');
    // A seeded size is a guess, not an answer, so the first instance corrects it.
    expect(delta(before, stats()).corrections).toBe(1);
    expect(boxMatches(harnessUi.queryByTestId('poisoned'), expectedBox!)).toBe(
      true
    );
    first.unmount();

    // The environment moves, as a trait or configuration change does: the cached
    // answer is gone and the guess left behind is wrong.
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
    const stages = trace.map((e: NitroUiSizingTraceEvent) => e.stage);
    expect(stages).toContain('laidOut');
    expect(stages).toContain('corrected');
    // A natively measured size cannot arrive before the control is laid out, so the
    // stale layout can be committed first: iOS draws it for one frame, Android
    // cancels the draw (`changedFlushes`). Either way no third size appears.
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
    // Android gets no stale frame. iOS gets at most one: a correction can also land
    // inside the turn that mounted the view, and then there is none.
    expect(staleFrames).toBeLessThanOrEqual(Platform.OS === 'android' ? 0 : 1);
    console.log(
      `poison frames: drawn=${String(drawn.length)} stale=${String(staleFrames)} ` +
        `changedFlushes=${String(d.changedFlushes)}`
    );
    second.unmount();

    // The real size is cached now, so a third mount is clean.
    const afterRepair = stats();
    const third = await render(<Switch defaultValue testID="after-repair" />);
    expect(boxMatches(await waitForTestId('after-repair'), expectedBox!)).toBe(
      true
    );
    expect(delta(afterRepair, stats()).corrections).toBe(0);
    third.unmount();
  });

  it('sizes a control inside a Modal', async () => {
    // RN's `Modal` is a second window that stops scheduling draws once the dialog is
    // presented, and Android's flush runs in a pre-draw listener, so a queued
    // correction has to request a draw as well. The harness cannot query a testID
    // inside that window, so the size and the trace are read from the control.
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
    // `corrected` is recorded when a flush pushes the correction into this
    // instance's Fabric state, so a report left queued never satisfies the wait.
    const trace = await collectTrace(
      (events) =>
        events.some(
          (event) =>
            event.instanceId === instanceId && event.stage === 'corrected'
        ),
      8000
    );
    const content = await measuredContent('the Switch inside the Modal');
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

    // The dialog mounted from the wrong guess, and the control's own measurement
    // outranked it.
    expect(laidOut.length).toBeGreaterThan(0);
    expect(Math.abs(laidOut[0]!.width - WRONG_GUESS.width)).toBeLessThan(1.5);
    expect(Math.abs(laidOut[0]!.height - WRONG_GUESS.height)).toBeLessThan(1.5);
    expect(corrected.length).toBeGreaterThan(0);
    expect(Math.abs(content.width - expectedBox!.width)).toBeLessThan(1.5);
    expect(Math.abs(content.height - expectedBox!.height)).toBeLessThan(1.5);
    for (const event of corrected) {
      expect(Math.abs(event.width - content.width)).toBeLessThan(0.6);
      expect(Math.abs(event.height - content.height)).toBeLessThan(0.6);
    }
    // The dialog is the only window doing work, so the flush is this mount's.
    expect(cold.flushes).toBeGreaterThan(0);
    // A `drew` sample may not exist for a dialog host; any that does is the guess
    // or the control's size.
    expect(drawnFrames(own, content!, WRONG_GUESS).everySampleExplained).toBe(
      true
    );

    // A size that arrives after the dialog has been presented, drawn and gone quiet:
    // the wide configuration is cold, and only a traversal of a window with no
    // reason left to draw can apply its correction.
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
    // Read directly: `measuredContent` waits only for "a size", and this handle
    // already holds the narrow one.
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
    // None of these turns changes a size. The colour prop is there because it is
    // processed natively every turn.
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
    // One turn per `rerender`: the harness waits for its render callback per turn,
    // so several renders queued in one JS turn would time out.

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
    // Nothing here changed a size: no state updates and no new cache entry.
    expect(d.corrections).toBe(0);
    expect(stats().cachedSizes).toBe(cached);
    unmount();
  });

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
   * A `fillWidth` control's width belongs to its container, so its height is the
   * half a test can name.
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

  // Starts from a wrong guess, because the box is only at risk on an instance the
  // engine had to correct: React's own revision can still carry the superseded box.
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
    // The sibling too: Yoga gives the row's other child any width the control loses.
    expect(boxMatches(box, expectedBox!)).toBe(true);
    expect(sameFrame(box, startSwitch)).toBe(true);
    expect(sameFrame(label, startLabel)).toBe(true);
    // The turn must cost no state update.
    expect(d.corrections).toBe(0);
    unmount();
  });

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
    // Seeding overwrites the declared size for this process, so the accurate one
    // goes back on the way out.
    nitroUiCore.seedSizingSize(
      SLIDER_COMPONENT,
      '',
      SLIDER_FALLBACK.width,
      SLIDER_FALLBACK.height
    );
  });

  /**
   * A correction is asynchronous (the native measure has to happen first), so the
   * box is waited for, never read once.
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
    // Both configurations are warm when the key moves, so the new size has to come
    // out of the measure pass, at no state update. The guess is the real size: with
    // a wrong one every mount below would pay a correction of its own.
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
    // The measure pass answered it: no state update, and no new cache entry.
    expect(d.corrections).toBe(0);
    expect(stats().cachedSizes).toBe(cached);
    unmount();
  });

  it('measures the width that arrived with the first commit', async () => {
    // The guess is the accurate declared size on purpose. A wrong guess makes the box
    // move on the first correction, and on iOS a box move triggers a re-measure that
    // finds the real content, which would hide a first measure of stale content.
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
    const measured = await measuredContent('the first-commit wide Switch');
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
    // The control's own number, which is what gets cached for the configuration.
    expect(boxMatches(measured, wideBox)).toBe(true);
    // One state update: this configuration had never been measured. Zero would
    // mean the wide control was never asked.
    expect(d.corrections).toBe(1);
    // At most one frame at the declared size, and no third size.
    const frames = drawnFrames(trace, wideBox, expectedBox!);
    expect(frames.everySampleExplained).toBe(true);
    expect(frames.stale).toBeLessThanOrEqual(Platform.OS === 'android' ? 0 : 1);
    wide.unmount();

    // RN recycles views, so the plain Switch below very likely inherits the host
    // that just measured a 100-wide control. Its configuration is cached, so the
    // correct outcome costs nothing; a leaked size would cost a correction.
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
    // A Switch does not move with the text size, so the environment is moved under
    // a mounted control and the control is then asked for a new size. The guess is
    // the real size, so every correction counted below belongs to that change.
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
    expect(mounted.ledgerEntries).toBeGreaterThan(0);
    expect(mounted.registryEntries).toBeGreaterThan(0);
    expect(delta(mounted, mounted).corrections).toBe(0);

    nitroUiCore.invalidateSizingEnvironment();
    expect(stats().environmentEpoch).toBe(epoch + 1);
    await settle();
    const bump = delta(mounted, stats());
    console.log(`env change while mounted: d=${JSON.stringify(bump)}`);
    // The bump commits nothing by itself, and it does not forget the instance.
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
    // The control was already on screen in the new epoch with no cached size, and
    // its own measure corrected it without a remount.
    expect(boxMatches(box, wideBox)).toBe(true);
    expect(d.corrections).toBe(1);
    unmount();
  });

  /**
   * The same `Switch`, optionally hidden with `display: 'none'` and optionally
   * given a different `nuiTestWidth`. A sizing id is minted per React mount, so on
   * iOS a hide that tears the native view down leaves an id that comes back on a
   * new native view. Every prop is passed on every render (nitro#1184).
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
   * Assert which `display: none` path a run took, and describe it. iOS Fabric
   * creates no native view for a hidden node, so hiding is a teardown and the
   * engine forgets the instance; Android keeps the view as `INVISIBLE`. On iOS the
   * drop arrives with the deallocation, so the fall is waited for.
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

    const { rerender, unmount } = await render(reShownSwitch(false, null));
    await waitForBoxWidth(
      'reshown',
      expectedBox.width,
      'the control before it was hidden'
    );
    await settle(300);
    const mounted = stats();
    expect(mounted.ledgerEntries).toBeGreaterThan(0);

    // Hidden, with its size-affecting prop moved while it is hidden.
    await rerender(reShownSwitch(true, TEST_WIDTH));
    const hidePath = await expectHidePath(
      mounted.ledgerEntries,
      Platform.OS === 'ios' ? 'torn-down' : 'kept-alive'
    );

    // Shown again with no further change: the re-shown view's own layout is the
    // first thing the engine sees for this configuration.
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
    // Exactly one across the whole hide and show: correcting while hidden and again
    // afterwards would pay for one change twice.
    expect(d.corrections).toBe(1);

    // The entry that came back is released on unmount.
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
    // marked inexact, and an instance with no entry is not in that walk.
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
    // An app can pre-warm the declared size while the control it hosts is another
    // size (`UIDesignRequiresCompatibility` gives a 51x31 Switch on iOS 26). The
    // harness cannot boot in that mode, so it makes the declared size wrong instead.
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

    // A first cycle to reach steady state; the second must not grow the engine.
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
    // The guess is wrong for every instance, and each batch is torn down before its
    // corrections have landed.
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
    // Nothing here changes a size. The declared size is the control's real one, so
    // a row can be checked the moment it is queried instead of mid-correction.
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
    expect(drawn).toBe(shrunk);
    expect(d.corrections).toBe(0);
    expect(stats().cachedSizes).toBe(cached);
    unmount();
  });
});
