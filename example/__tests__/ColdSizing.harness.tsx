/**
 * On-device tests for T14 — a declared sizing fallback must be in the engine
 * *before* an instance's first measure, not registered by that instance's own
 * first view.
 *
 * Fabric measures a shadow node before it creates the view, so a fallback that
 * waits for the view arrives one measure too late: the first instance of a
 * configuration is measured with no fallback at all, which is `0 x 0` for
 * anything (`cpp/NitroUiSizingEngine.cpp` has no engine default size) — a cold
 * first Slider 0 tall, a cold first Switch with no box, for one frame (D17).
 * `NitroUiDeclaredFallbacks` (Swift/Kotlin) registers the table at startup; the
 * oracle here is the first `laidOut` event the engine records for an instance,
 * because that event *is* the size the first measure answered with.
 * ## ORDERING CONTRACT — the cold tests need a process this file started
 *
 * A declared fallback is process-global and outlives a runtime reset
 * (`resetEnvironmentBetweenTestFiles: 'runtime'`), so "the first instance ever"
 * cannot be manufactured once a component has had a view: a warm component's
 * fallback is in the engine either way and the cold assertions pass on the bug.
 * (Measured on `main`: with another suite allowed to run first, this file's cold
 * Slider came back `402x31` — warm — while the cold Switch, whose suite had not
 * run, came back `0x0` — the bug. Same file, same build, opposite verdicts.)
 *
 * Jest does not run this file first (it sequences the largest file first, which
 * is `Slider.harness.tsx`), so the cold tests *check* for the condition instead
 * of assuming it: `measurements` is the engine's cumulative count of the sizes it
 * has handed out, and the harness does not mount the example app's own screens, so
 * `0` witnesses that nothing has been measured in this process yet. It is a
 * running total that never resets, and this file's own first test measures a
 * control, so the witness is read exactly once - in that first test, before
 * anything here has mounted - and both cold tests assert against that one value
 * (`coldOnEntry` below). Reading it again in a later test proves nothing but
 * "a test in this file ran before it".
 *
 *  - `bun run harness:cold:ios` / `harness:cold:android` run this file alone, so
 *    that value is `true` there and the two cold tests assert their full claim:
 *    first frame at the *declared* size. That is the invocation that goes red on
 *    `main` (`0 x 0` in both cases) and the one the T14 report cites.
 *  - In a whole-suite run the guard logs `NOT COLD`, the two cold tests drop to
 *    the weaker claim that still holds there (the first frame is *some* size,
 *    never 0), and the two poisoned tests go on asserting that a wrong fallback is
 *    outranked by the control.
 *
 * Everything from test 2 on poisons deliberately and re-seeds the accurate
 * declaration on the way out, the way `Sizing.harness.tsx` does, so the suites
 * that run after this one inherit a sane fallback table.
 */
import { Platform, TurboModuleRegistry } from 'react-native';
import {
  afterEach,
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
  type NitroUiSizingTraceEvent,
} from 'react-native-nitro-ui';

const SLIDER = 'NitroUiSlider';
const SWITCH = 'NitroUiSwitch';
/** Both components have one configuration, so both send the empty variant. */
const SIZING_KEY = '';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What the two Hybrid Views hand back, narrowed to what this file reads.
 *
 * `nuiSizingId` is the handle on the trace: every sizing event is filed under the
 * instance that caused it, so an event can be attributed to a control rather than
 * to "something that happened while this test ran" - the app's own Switches are
 * on screen the whole time.
 */
type Handle = {
  /**
   * Read through an optional member because v0.1 keeps the Hybrid View prop types
   * off the public surface (D14), and `@internal` `NitroUiSwitchHandle` /
   * `NitroUiSliderHandle` therefore do not name it. The getter is there on both
   * platforms (`HybridNitroUiSwitch.nuiSizingId`, `HybridNitroUiSlider.nuiSizingId`),
   * and `sizingIdOf` below fails loudly if this ever stops being true.
   */
  readonly nuiSizingId?: number;
  measureContent(): { width: number; height: number };
};

/**
 * The sizes the two components declare, written out rather than imported so a
 * component that stops declaring them cannot make this file agree with itself.
 *
 * They are the numbers in `HybridNitroUiSwitch`/`HybridNitroUiSlider` on each
 * platform (D14: measured per OS, not read out of a spec), and - for a Slider on
 * Android and a Switch on both - also the size the control really is. That
 * coincidence is exactly why the correction tests below poison the declaration:
 * asserting "laid out at the fallback" against a fallback that equals the answer
 * would not notice a correction that never arrives (review B1).
 */
const osVersion = (
  Platform.constants as { readonly osVersion?: string } | undefined
)?.osVersion;
const iosMajor = Number.parseInt(osVersion ?? String(Platform.Version), 10);

/** The height a Slider declares, and the height its control really is. */
const SLIDER_HEIGHT = Platform.select({ android: 48, default: 31 })!;

/**
 * The box a Slider's startup declaration carries. A `fillWidth` control's
 * declared width never reaches a real layout, but the tests re-seed the
 * declaration after poisoning it, and that seed must restore what the platform
 * actually declares (D14: Android 328, iOS 351) - not Android's number on both.
 */
const SLIDER_FALLBACK = Platform.select({
  android: { width: 328, height: 48 },
  default: { width: 351, height: 31 },
})!;

/** The box a Switch declares, which is also the box its control really is. */
const SWITCH_BOX = Platform.select({
  android: { width: 52, height: 48 },
  default:
    Number.isFinite(iosMajor) && iosMajor >= 26
      ? { width: 61, height: 28 }
      : { width: 51, height: 31 },
})!;

/** A declared size that belongs to neither control, used to poison one. */
const WRONG_SLIDER = { width: 100, height: 13 };
const WRONG_SWITCH = { width: 40, height: 20 };

function describeBox(box: Size | null) {
  return box == null
    ? 'null'
    : `${box.width.toFixed(2)}x${box.height.toFixed(2)}`;
}

type Size = { width: number; height: number };

function near(candidate: number, size: number) {
  return Math.abs(candidate - size) < 0.6;
}

function describeEvents(events: NitroUiSizingTraceEvent[]) {
  return JSON.stringify(
    events.map(
      (event) =>
        `${event.stage}:${event.instanceId}:${event.width.toFixed(1)}x${event.height.toFixed(1)}`
    )
  );
}

/**
 * Is this a process in which the cold tests may claim "first instance ever"? See
 * the ordering contract above. `measurements` counts every size the engine has
 * handed out since the process started, so 0 is the only witness that no earlier
 * suite has already registered a fallback by mounting one - and it has to be read
 * before this file's own tests have measured anything, because the counter never
 * goes back down. Captured on the first call (which the first cold test makes
 * before it mounts), and `coldOnEntry` is what the cold assertions use.
 */
let coldOnEntry: boolean | null = null;

function coldProcessStats() {
  const stats = nitroUiCore.sizingStats();
  if (coldOnEntry === null) {
    coldOnEntry = stats.measurements === 0;
  }
  console.log(
    `t14 ${coldOnEntry ? 'COLD' : 'NOT COLD'} process (on entry): ` +
      `measurements=${String(stats.measurements)}`
  );
  return stats;
}

/** Start from an empty ring: `drainSizingTrace` consumes what it returns. */
function startTrace() {
  nitroUiCore.setSizingTraceEnabled(true);
  nitroUiCore.drainSizingTrace();
}

/**
 * Read the ring until this instance has a `laidOut` event, keeping everything
 * read on the way (the ring is shared and `drain` consumes, so events have to be
 * accumulated across reads - `Sizing.harness.tsx`'s `collectTrace` for the why).
 */
async function collectEventsFor(
  instanceId: number,
  stage: NitroUiSizingTraceEvent['stage'],
  timeoutMs = 8000
) {
  const events: NitroUiSizingTraceEvent[] = [];
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    events.push(...nitroUiCore.drainSizingTrace());
    if (
      events.some(
        (event) => event.instanceId === instanceId && event.stage === stage
      ) ||
      nitroUiCore.now() > deadline
    ) {
      return events.filter((event) => event.instanceId === instanceId);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForBox(testId: string, timeoutMs = 15000) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
      return box;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${String(timeoutMs)}ms.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The id this instance reports, once it has one (props land before the box). */
async function sizingIdOf(handle: Handle) {
  const deadline = nitroUiCore.now() + 5000;
  for (;;) {
    const instanceId = handle.nuiSizingId ?? 0;
    if (instanceId > 0) {
      return instanceId;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `The view never reported a nuiSizingId (handle keys: ${String(
          Object.keys(handle).join(',') || 'none'
        )}).`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const handles = new Map<string, Handle>();
const captureFor =
  (testId: string) =>
  (handle: Handle): void => {
    handles.set(testId, handle);
  };

/** Seed a size for a component, then drop the answers so a mount is cold. */
function declareThenGoCold(
  componentName: string,
  size: Size | null,
  beforeEpoch: number
) {
  if (size != null) {
    nitroUiCore.seedSizingSize(
      componentName,
      SIZING_KEY,
      size.width,
      size.height
    );
  }
  nitroUiCore.invalidateSizingEnvironment();
  // Without this the mount below would not be cold, and a cold mount is the only
  // case where a fallback (rather than a cached answer) is what gets laid out.
  expect(nitroUiCore.sizingStats().environmentEpoch).toBe(beforeEpoch + 1);
}

afterEach(() => {
  cleanup();
  handles.clear();
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('Sizing · declared before the first measure (T14)', () => {
  it('has a declared height ready for the first Slider this process measures', async () => {
    // The T14 gate, and the `fillWidth` half of D17. No earlier suite has run, so
    // this is the first Slider this process will ever measure and the only size
    // its first measure can answer with is the one the startup table registered.
    // On `main` the table does not exist and the answer is 0 tall. Nothing is
    // seeded here on purpose - `seedSizingSize` *writes* the declared fallback,
    // which is the thing under test.

    // The ordering contract, checked first. `measurements` counts every
    // `measureContent` answer this process has given, so 0 here means this really
    // is the first control of any kind the engine has sized - which is what makes
    // "nothing but the startup table's fallback" the only thing the measure below
    // can answer from. (The harness does not mount the example app's screens, so
    // nothing upstream of this file measures either.)
    const entry = coldProcessStats();
    const epoch = entry.environmentEpoch;
    declareThenGoCold(SLIDER, null, epoch);
    startTrace();

    const { unmount } = await render(
      <Slider
        defaultValue={0.5}
        testID="t14-slider"
        hybridRef={captureFor('t14-slider')}
      />
    );
    const handle = handles.get('t14-slider')!;
    const instanceId = await sizingIdOf(handle);
    const box = await waitForBox('t14-slider');
    const events = await collectEventsFor(instanceId, 'laidOut');
    const laidOut = events.filter((event) => event.stage === 'laidOut');
    const measured = handle.measureContent();

    console.log(
      `t14 cold slider: id=${String(instanceId)} firstLaidOut=${describeBox(
        laidOut[0] ?? null
      )} declaredHeight=${String(SLIDER_HEIGHT)} box=${describeBox(
        box
      )} measured=${describeBox(measured)} events=${describeEvents(events)}`
    );

    expect(laidOut.length).toBeGreaterThan(0);
    // Never 0 tall - which is what a `fillWidth` control with no fallback does
    // (D17). This half of the claim holds in any process.
    expect(laidOut[0]!.height).toBeGreaterThan(0);
    if (coldOnEntry === true) {
      // And in a cold process, specifically the *declared* height: the frame the
      // first measure asked for is the one the startup table registered rather
      // than a cached answer or a guess left by an earlier mount. On `main` the
      // first frame here is 0 tall, which is the bug.
      expect(near(laidOut[0]!.height, SLIDER_HEIGHT)).toBe(true);
    }
    // And the control really is that tall, so the assertion above is not a
    // fixture that happens to equal the right answer: it is the declared number,
    // which on this platform is also the measured one.
    expect(near(measured.height, SLIDER_HEIGHT)).toBe(true);
    expect(near(box.height, SLIDER_HEIGHT)).toBe(true);
    unmount();
  });

  it('still corrects a Slider whose declared height is wrong', async () => {
    // The poisoned twin: a fallback that is wrong must still be outranked by the
    // control, or "laid out at the fallback" above would just mean "never
    // corrected". Seeding overwrites the declaration for this process, so the
    // accurate one goes back on the way out.
    const epoch = nitroUiCore.sizingStats().environmentEpoch;
    declareThenGoCold(SLIDER, WRONG_SLIDER, epoch);
    startTrace();

    const before = nitroUiCore.sizingStats();
    const { unmount } = await render(
      <Slider
        defaultValue={0.5}
        testID="t14-slider-wrong"
        hybridRef={captureFor('t14-slider-wrong')}
      />
    );
    const handle = handles.get('t14-slider-wrong')!;
    const instanceId = await sizingIdOf(handle);
    const box = await waitForBox('t14-slider-wrong');
    const events = await collectEventsFor(instanceId, 'corrected');
    const laidOut = events.filter((event) => event.stage === 'laidOut');
    const corrected = events.filter((event) => event.stage === 'corrected');
    const after = nitroUiCore.sizingStats();

    console.log(
      `t14 poisoned slider: declared=${String(
        WRONG_SLIDER.width
      )}x${String(WRONG_SLIDER.height)} firstLaidOut=${describeBox(
        laidOut[0] ?? null
      )} box=${describeBox(box)} events=${describeEvents(events)}`
    );

    expect(laidOut.length).toBeGreaterThan(0);
    expect(near(laidOut[0]!.height, WRONG_SLIDER.height)).toBe(true);
    expect(corrected.length).toBeGreaterThan(0);
    expect(near(corrected[corrected.length - 1]!.height, SLIDER_HEIGHT)).toBe(
      true
    );
    expect(
      after.correctionsImmediate +
        after.correctionsBatched -
        (before.correctionsImmediate + before.correctionsBatched)
    ).toBeGreaterThan(0);
    expect(near(box.height, SLIDER_HEIGHT)).toBe(true);

    unmount();
    declareThenGoCold(SLIDER, SLIDER_FALLBACK, after.environmentEpoch);
  });

  it('has a declared size ready for the first Switch this process measures', async () => {
    // The rule D17 states for an `intrinsic` control, and the second of the two
    // cold cases the brief asks for. Measured red on `main` as `0 x 0` on the
    // first frame (`laidOut:0.0x0.0`), corrected to 61x28 one event later.
    const entry = coldProcessStats();
    const epoch = entry.environmentEpoch;
    declareThenGoCold(SWITCH, null, epoch);
    startTrace();

    const { unmount } = await render(
      <Switch
        defaultValue
        testID="t14-switch"
        hybridRef={captureFor('t14-switch')}
      />
    );
    const handle = handles.get('t14-switch')!;
    const instanceId = await sizingIdOf(handle);
    const box = await waitForBox('t14-switch');
    const events = await collectEventsFor(instanceId, 'laidOut');
    const laidOut = events.filter((event) => event.stage === 'laidOut');

    console.log(
      `t14 cold switch: id=${String(instanceId)} firstLaidOut=${describeBox(
        laidOut[0] ?? null
      )} declared=${SWITCH_BOX.width}x${SWITCH_BOX.height} box=${describeBox(
        box
      )} events=${describeEvents(events)}`
    );

    expect(laidOut.length).toBeGreaterThan(0);
    // A `0 x 0` first frame is the bug, and it is the whole of what a process that
    // has already sized a Switch can still prove (see the ordering contract).
    expect(laidOut[0]!.width).toBeGreaterThan(0);
    expect(laidOut[0]!.height).toBeGreaterThan(0);
    if (coldOnEntry === true) {
      // In a cold process the first frame is the declared box, from the startup
      // table. On `main` it is `0 x 0` and the correction is what makes the box
      // right one event later.
      expect(near(laidOut[0]!.width, SWITCH_BOX.width)).toBe(true);
      expect(near(laidOut[0]!.height, SWITCH_BOX.height)).toBe(true);
    }
    expect(near(box.width, SWITCH_BOX.width)).toBe(true);
    expect(near(box.height, SWITCH_BOX.height)).toBe(true);
    unmount();
  });

  it('still corrects a Switch whose declared size is wrong', async () => {
    const epoch = nitroUiCore.sizingStats().environmentEpoch;
    declareThenGoCold(SWITCH, WRONG_SWITCH, epoch);
    startTrace();

    const before = nitroUiCore.sizingStats();
    const { unmount } = await render(
      <Switch
        defaultValue
        testID="t14-switch-wrong"
        hybridRef={captureFor('t14-switch-wrong')}
      />
    );
    const handle = handles.get('t14-switch-wrong')!;
    const instanceId = await sizingIdOf(handle);
    const box = await waitForBox('t14-switch-wrong');
    const events = await collectEventsFor(instanceId, 'corrected');
    const laidOut = events.filter((event) => event.stage === 'laidOut');
    const corrected = events.filter((event) => event.stage === 'corrected');
    const after = nitroUiCore.sizingStats();

    console.log(
      `t14 poisoned switch: declared=${String(WRONG_SWITCH.width)}x${String(
        WRONG_SWITCH.height
      )} firstLaidOut=${describeBox(
        laidOut[0] ?? null
      )} box=${describeBox(box)} events=${describeEvents(events)}`
    );

    expect(laidOut.length).toBeGreaterThan(0);
    expect(near(laidOut[0]!.width, WRONG_SWITCH.width)).toBe(true);
    expect(corrected.length).toBeGreaterThan(0);
    expect(near(corrected[corrected.length - 1]!.width, SWITCH_BOX.width)).toBe(
      true
    );
    expect(
      after.correctionsImmediate +
        after.correctionsBatched -
        (before.correctionsImmediate + before.correctionsBatched)
    ).toBeGreaterThan(0);
    expect(near(box.width, SWITCH_BOX.width)).toBe(true);

    unmount();
    declareThenGoCold(SWITCH, SWITCH_BOX, after.environmentEpoch);
  });
});
