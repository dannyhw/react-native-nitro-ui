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
import { waitForHandle } from './handles';

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

type Handle = {
  /** The id sizing trace events are filed under for this instance. */
  readonly nuiSizingId?: number;
  measureContent(): { width: number; height: number };
};

const osVersion = (
  Platform.constants as { readonly osVersion?: string } | undefined
)?.osVersion;
const iosMajor = Number.parseInt(osVersion ?? String(Platform.Version), 10);

/** The height a Slider declares, and the height its control really is. */
const SLIDER_HEIGHT = Platform.select({ android: 48, default: 31 })!;

/** The box a Slider declares at startup, restored after a test poisons it. */
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
 * Whether this process had measured nothing when this file started. A declared
 * fallback is process-global and survives a runtime reset, so only then can the cold
 * tests claim "first instance ever". The counter never resets, so it is read once,
 * before this file's first mount.
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
 * Read the trace until this instance has an event of `stage`. The ring is shared
 * and `drain` consumes, so events are accumulated across reads.
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

/**
 * The handle for this testID, once the `hybridRef` callback has run: it lands on a
 * commit after `render()` resolves.
 */
async function handleFor(testId: string): Promise<Handle> {
  return waitForHandle(() => handles.get(testId), { what: `"${testId}"` });
}

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
  // The epoch must have moved, or the next mount is laid out from a cached answer
  // instead of the fallback.
  expect(nitroUiCore.sizingStats().environmentEpoch).toBe(beforeEpoch + 1);
}

afterEach(() => {
  cleanup();
  handles.clear();
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('Sizing · declared before the first measure (T14)', () => {
  it('has a declared height ready for the first Slider this process measures', async () => {
    // Nothing is seeded here: `seedSizingSize` writes the declared fallback, which is
    // the thing under test.
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
    const handle = await handleFor('t14-slider');
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
    expect(laidOut[0]!.height).toBeGreaterThan(0);
    if (coldOnEntry === true) {
      // Only a cold process can claim the first frame is the declared height.
      expect(near(laidOut[0]!.height, SLIDER_HEIGHT)).toBe(true);
    }
    expect(near(measured.height, SLIDER_HEIGHT)).toBe(true);
    expect(near(box.height, SLIDER_HEIGHT)).toBe(true);
    unmount();
  });

  it('still corrects a Slider whose declared height is wrong', async () => {
    // Seeding overwrites the declaration for the whole process, so the accurate one
    // is restored at the end.
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
    const handle = await handleFor('t14-slider-wrong');
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
    const handle = await handleFor('t14-switch');
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
    expect(laidOut[0]!.width).toBeGreaterThan(0);
    expect(laidOut[0]!.height).toBeGreaterThan(0);
    if (coldOnEntry === true) {
      // Only a cold process can claim the first frame is the declared box.
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
    const handle = await handleFor('t14-switch-wrong');
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
