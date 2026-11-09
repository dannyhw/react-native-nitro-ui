/**
 * On-device tests for the Stepper (task G25).
 *
 * A Stepper is Slider's value rules wearing IconButton's body, so this suite asks
 * each sibling's questions and then the two the control has on its own.
 *
 * - **Slider's**: does the event-count handshake hold - a controlled value both
 *   ways, a step JS refused snapping back, a value written from JS applying, and a
 *   `0.1` step arriving as `0.3` rather than `0.3000…4`? Those are
 *   `NitroUiSliderValue.quantize` answers, and the Stepper imports them rather than
 *   copying them, which is the point the digit assertions here protect.
 * - **IconButton's**: is the box the size the control measured, and on Android is
 *   the artwork actually painted? The glyph question has an extra twist here: a
 *   Stepper has no `tintColor` to probe for, because its content colour is the
 *   scheme's own `onSurfaceVariant` - a *dynamic* colour no JS constant knows. So
 *   the probe is self-referential: ask for black, ask for white, find which of the
 *   two extremes the control paints the most of (its container) and which the least
 *   (its ink), then insist the ink exists, is a minority of the box, and is **not**
 *   the sampler's own mid-grey backdrop. A stepper whose glyph slots came back
 *   empty has nothing in it darker (light scheme) or lighter (dark scheme) than that
 *   backdrop, and goes red on that line.
 * - **its own first**: the bounds. Each half is disabled at its own end of the range
 *   - iOS by SwiftUI's own doing, Android by the same `canStep` answer its buttons
 *   are given - and a half that is disabled produces **no event at all**, which is
 *   what makes "a tap at a bound does nothing" one rule rather than two platform
 *   habits. The control reports the two halves' enabled state from where it draws
 *   them, so this file asserts the button, not a re-computed guess.
 * - **its own second**: a reader meets **one** adjustable control, not two buttons.
 *   iOS vends an `.adjustable` element with the value in it; Android merges the row
 *   into one node with `ProgressBarRangeInfo` and clears the buttons' own semantics.
 *   Both are read through the *reader's* action - `accessibilityIncrement` on the
 *   element UIKit was handed, `SetProgress` on the merged semantics node - because a
 *   control whose own step works while its published action does nothing is the bug
 *   only that path can see.
 *
 * The readings: `harnessUi.queryByTestId` (the box Fabric gave the view),
 * `hybridRef.measureContent()` (the size the hosted control measured),
 * `nitroUiCore.sizingStats()` (what the sizing engine did), the control's own
 * `nuiTestStateReport()` (the value it is drawing, which half is live, and what its
 * accessibility node says), `nuiTestAccessibilityStepReport()` (what a reader's
 * action did) and `nuiTestPixelProbe`/`nuiTestPixelReport` (what it painted).
 */
import { useCallback, useState } from 'react';
import {
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
} from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import {
  Stepper,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

import { waitForHandle } from './handles';

/** The Stepper's Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiStepper';

type Size = { width: number; height: number };
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back - declared, not imported (DECISIONS D14).
 *
 * The same shape `src/components/Stepper/Stepper.tsx` documents on its own
 * `hybridRef` prop, and the test-only seams are gone from that documentation the day
 * the harness can read pixels itself.
 */
type StepperHandle = {
  readonly value: number | null;
  readonly mostRecentEventCount: number;
  readonly minimumValue: number;
  readonly maximumValue: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly accessibilityLabel: string | null;
  measureContent(): Size;
  nuiTestStep(direction: number): void;
  nuiTestAccessibilityStep(direction: number): void;
  nuiTestAccessibilityStepReport(): string;
  nuiTestProbeAccessibility(): void;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
  nuiTestStateReport(): string;
};

/**
 * The size this control declares for itself, in points / dp.
 *
 * Read off the two component sources - `HybridNitroUiStepper.kt`'s
 * `FALLBACK_WIDTH_DP`/`FALLBACK_HEIGHT_DP` and `HybridNitroUiStepper.swift`'s
 * `declaresFallback` - and mirrored by `DECLARED_FALLBACKS.NitroUiStepper` in
 * `scripts/conformance-core.mjs`, which `check` insists agrees. It is *measured*
 * here, not asserted as a premise: an `intrinsic` control whose first frame is laid
 * out at a number it then contradicts costs every cold mount a correction (D17), so
 * "the box we guessed is the box we draw" is the claim worth a device.
 */
const DECLARED: Size =
  Platform.OS === 'android'
    ? { width: 104, height: 48 }
    : { width: 94, height: 32 };

/* ------------------------------- the fixtures ------------------------------- */

const handles = new Map<string, StepperHandle>();
const captureHybrid =
  (testId: string) =>
  (view: StepperHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app was told, in order, as `testID:value`. */
const events: string[] = [];

/** The parents' `value` setters, by testID - how a test writes a value from JS. */
const setters = new Map<string, (next: number) => void>();

type OwnerProps = {
  testId: string;
  /** Omit for an uncontrolled Stepper, which is the only way to see `defaultValue`. */
  value?: number;
  defaultValue?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  /**
   * Keep the app's own value no matter what the control asks for - the refused
   * change, which is the half of the handshake that needs an app willing to say no.
   */
  refuse?: boolean;
};

/**
 * One Stepper with an app behind it.
 *
 * Controlled when `value` is passed, uncontrolled when it is not: `Stepper.tsx`
 * decides the mode by whether the prop is `undefined`, so this is the only way a
 * harness fixture can be genuinely uncontrolled (and therefore the only way to see
 * that a step costs no React render).
 */
function StepperOwner({
  testId,
  value,
  defaultValue,
  minimumValue,
  maximumValue,
  step,
  disabled,
  accessibilityLabel,
  refuse,
}: OwnerProps) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(value ?? defaultValue ?? 0);
  // Always `own`, never the prop: a controlled fixture that rendered its own prop could
  // never adopt the step it was just told about, so every "the app adopted it" claim
  // below would describe a fixture that refuses everything. `own` starts at the prop,
  // and the refusal case is the one that does not write it.
  const shown = own;
  if (controlled) {
    setters.set(testId, setOwn);
  }
  const onValueChange = useCallback(
    (next: number) => {
      events.push(`${testId}:${String(next)}`);
      // Controlled: adopt the value unless this fixture exists to refuse it. The
      // write has to land in the same commit as the hook's echo of the event count,
      // which is why a refusal is a *missing* write rather than another prop.
      //
      // Uncontrolled: write **nothing**. Native owns the displayed value, so an app
      // that keeps no state is the fixture that proves it - if the control snapped
      // back to the value JS never stored, the "keeps its own value" test below is
      // the one that says so.
      if (controlled && !refuse) setOwn(next);
    },
    [controlled, refuse, testId]
  );
  return (
    <Stepper
      accessibilityLabel={accessibilityLabel}
      defaultValue={defaultValue}
      disabled={disabled}
      hybridRef={captureHybrid(testId)}
      maximumValue={maximumValue}
      minimumValue={minimumValue}
      onValueChange={onValueChange}
      step={step}
      testID={testId}
      value={controlled ? shown : undefined}
    />
  );
}

/* --------------------------------- plumbing --------------------------------- */

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

function corrections(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return (
    after.correctionsImmediate -
    before.correctionsImmediate +
    (after.correctionsBatched - before.correctionsBatched)
  );
}

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

const sizeOf = (testId: string): Size | null => harnessUi.queryByTestId(testId);
const measured = (testId: string): Size | null =>
  handles.get(testId)?.measureContent() ?? null;

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

async function handleOf(testId: string): Promise<StepperHandle> {
  return waitForHandle(() => handles.get(testId), { what: `"${testId}"` });
}

/** Poll until the control reports a size. */
async function waitForMeasured(testId: string, what: string): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

/** The stepper's own report, as `key -> value`. */
function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/**
 * Poll until the control is drawing `displayed`.
 *
 * `displayed` is written where the control is drawn (the SwiftUI body / the
 * composable), so it is a reading of the hosted control. `hybridRef`'s `value`
 * answers what *React* sent and cannot see any of this.
 */
async function waitForDrawn(testId: string, displayed: string): Promise<void> {
  await pollUntil(
    () => (reportOf(testId).displayed === displayed ? true : null),
    () =>
      new Error(
        `"${testId}" never drew displayed=${displayed} - it reports ` +
          `"${handles.get(testId)?.nuiTestStateReport() ?? 'no handle'}".`
      )
  );
}

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/**
 * Wait until the app has been told exactly `wanted`, then hand back everything.
 *
 * The quiet period is Chip's G12 lesson and it matters more here than anywhere: a
 * Stepper's failure mode is *two* events for one tap, which a count-only wait
 * passes - the surplus arrives after the count is reached. Every caller here
 * compares the whole list, and several assert it is empty.
 */
async function waitForEvents(from: number, wanted: readonly string[]) {
  await pollUntil(
    () => {
      const seen = events.slice(from);
      return seen.length >= wanted.length ? seen : null;
    },
    () =>
      new Error(
        `expected events ${JSON.stringify(wanted)}, saw ` +
          JSON.stringify(events.slice(from))
      )
  );
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** Ask for nothing to arrive for a beat, then say what did. */
async function eventsAfterQuiet(from: number): Promise<string[]> {
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** One step through the tap's own path, on the platform that owns the view. */
async function stepStepper(testId: string, direction: number): Promise<void> {
  const handle = await handleOf(testId);
  handle.nuiTestStep(direction);
}

/**
 * Perform the *reader's* action and wait for its report.
 *
 * Snapshot-before-post, Slider's rule: the seam posts to the UI thread and returns,
 * so the only question a caller that posted it can ask is "has the report changed?",
 * and reading the old report after posting loses a race the runner wins when it is
 * loaded. Every report is numbered (`#$n`), so no answer can be byte-identical to
 * the one before it.
 */
async function accessibilityStepReport(
  testId: string,
  direction: number
): Promise<string> {
  const handle = await handleOf(testId);
  const before = handle.nuiTestAccessibilityStepReport();
  handle.nuiTestAccessibilityStep(direction);
  return pollUntil(
    () => {
      const report = handle.nuiTestAccessibilityStepReport();
      return report === before ? null : report;
    },
    () =>
      new Error(
        `the accessibility step probe for "${testId}" never reported (last: ` +
          `"${before === '' ? 'none' : before}").`
      ),
    8000
  );
}

/** Wait for the stepper's next accessibility probe, and return its `a11y` field. */
async function probeAccessibility(testId: string): Promise<string> {
  const handle = await handleOf(testId);
  const before = Number(reportOf(testId).probes ?? '0');
  handle.nuiTestProbeAccessibility();
  return pollUntil(
    () =>
      Number(reportOf(testId).probes ?? '0') > before
        ? (reportOf(testId).a11y ?? '')
        : null,
    () => new Error(`"${testId}" never answered an accessibility probe.`)
  );
}

/** `merged` - how many nodes a reader is offered. iOS answers `unavailable`. */
const mergedCount = (testId: string): string =>
  reportOf(testId).merged ?? 'none';

/**
 * The key `Stepper.tsx` builds.
 *
 * Written out rather than imported, so a wrong helper cannot poison and pass its own
 * test (Chip's rule) - and the emptiness *is* the claim: nothing a caller sends
 * changes a Stepper's box, so one cached size serves the whole app. `Sizing` below
 * is what makes an accidental change to that cost a red test rather than a silently
 * widening cache.
 */
function sizingKey(): string {
  return '';
}

/** A size that is no stepper's, planted as the engine's answer before a mount. */
const WRONG_SIZE = { width: 13.5, height: 61.5 };

function poison(keys: readonly string[]): void {
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

/* ------------------------------ the pixel probe ------------------------------ */

/**
 * Six digits everywhere on purpose: `processColor` reads an eight-digit literal as
 * `#RRGGBBAA`, so `#FF000000` is *red* to it, and the sampler compares the channels it
 * was handed. A constant written with a leading `FF` asks about the wrong colour.
 */
/** The sampler's own backdrop, from `NitroUiPixelProbe.kt` / iOS's twin. */
const BACKDROP = '#808080';
const BLACK = '#000000';
const WHITE = '#FFFFFF';

/** One probe's answer, parsed. */
type PixelReport = {
  raw: string;
  width: number;
  height: number;
  hits: number;
  mean: string;
  closest: string;
};

async function pixelProbe(
  testId: string,
  color: string,
  what: string
): Promise<PixelReport> {
  const handle = await handleOf(testId);
  const tint = processColor(color);
  if (typeof tint !== 'number') {
    throw new Error(`processColor("${color}") did not answer a number.`);
  }
  const before = handle.nuiTestPixelReport();
  handle.nuiTestPixelProbe(tint);
  const raw = await pollUntil(
    () => {
      const next = handle.nuiTestPixelReport();
      return next === '' || next === before ? null : next;
    },
    () =>
      new Error(
        `the pixel probe for "${testId}" (${what}) never reported. Last: ` +
          `"${handle.nuiTestPixelReport()}".`
      ),
    8000
  );
  if (!/ hits=\d+/.test(raw) && !/no pixels/.test(raw)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) answered a line that is neither a ` +
        `sample nor a refusal: ${raw}`
    );
  }
  const number = (name: string): number => {
    const found = new RegExp(` ${name}=(\\d+)x(\\d+)|${name}=(\\d+)`).exec(raw);
    const value = found?.[1] ?? found?.[3];
    return value == null ? NaN : Number(value);
  };
  const hex = (name: string): string =>
    new RegExp(`${name}=(#[0-9A-Fa-f]{6})`).exec(raw)?.[1]?.toUpperCase() ?? '';
  const size = / size=(\d+)x(\d+)/.exec(raw);
  return {
    raw,
    width: size == null ? NaN : Number(size[1]),
    height: size == null ? NaN : Number(size[2]),
    hits: number('hits'),
    mean: hex('mean'),
    closest: hex('closest'),
  };
}

/** Per-channel-sum distance between two `#RRGGBB` strings. */
function colourDistance(a: string, b: string): number {
  const parts = (value: string): number[] => {
    const digits = value.replace('#', '');
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  };
  const [redA = 0, greenA = 0, blueA = 0] = parts(a);
  const [redB = 0, greenB = 0, blueB = 0] = parts(b);
  return (
    Math.abs(redA - redB) + Math.abs(greenA - greenB) + Math.abs(blueA - blueB)
  );
}

afterEach(() => {
  cleanup();
  handles.clear();
  setters.clear();
  events.length = 0;
});

describe('Stepper', () => {
  it('hosts a control, keeps its own box, and draws the value it was given', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner accessibilityLabel="Live" testId="host-live" value={4} />
        <StepperOwner
          accessibilityLabel="Disabled"
          disabled
          testId="host-disabled"
          value={4}
        />
      </View>,
      { timeout: 20000 }
    );
    const ids = ['host-live', 'host-disabled'];
    for (const id of ids) {
      await waitForTestId(id);
    }
    for (const id of ids) {
      const control = await waitForMeasured(id, id);
      const box = sizeOf(id);
      expect(
        sameSize(box, control),
        `${id}: the box Fabric gave is ${describeSize(box)} but the control measured ` +
          `${describeSize(control)} - an intrinsic control's box is its own measure`
      ).toBe(true);
      // The claim D17 makes worth a device: the number this control declares is the
      // box it draws, so a cold mount is not laid out at a size it then contradicts.
      expect(
        sameSize(control, DECLARED),
        `${id}: measured ${describeSize(control)}, which is not the size the control ` +
          `declares (${describeSize(DECLARED)}). One of the two is stale - the ` +
          'component source, or `DECLARED` in this file and the conformance row'
      ).toBe(true);
    }
    expect(reportOf('host-live').displayed, 'the enabled stepper shows 4').toBe(
      '4'
    );
    expect(
      reportOf('host-disabled').displayed,
      'a disabled stepper still shows its value'
    ).toBe('4');
    view.unmount();
  });

  it('lays out at the declared fallback and corrects a poisoned cached size', async () => {
    // The poison is the whole point of this file's size assertions: a declared
    // fallback close to the truth would make every "the box was right" line above
    // pass even if the correction stopped arriving (Checkbox's note is the precedent).
    poison([sizingKey()]);
    const before = stats();
    const view = await render(
      <StepperOwner accessibilityLabel="Poisoned" testId="cold" value={1} />,
      { timeout: 20000 }
    );
    await waitForTestId('cold');
    const control = await waitForMeasured('cold', 'the cold mount');
    const after = stats();

    expect(
      corrections(before, after),
      `a mount whose cached size was planted at ${describeSize(WRONG_SIZE)} was ` +
        `corrected ${String(corrections(before, after))} times - the engine never ` +
        'gave up the wrong number, so every cold stepper would be laid out at it'
    ).toBeGreaterThanOrEqual(1);
    expect(
      sameSize(control, WRONG_SIZE),
      `"cold" measured ${describeSize(control)} - that is the planted size, so the ` +
        'control never measured itself'
    ).toBe(false);
    expect(
      sameSize(sizeOf('cold'), control),
      `"cold" was laid out at ${describeSize(sizeOf('cold'))} while the control ` +
        `measured ${describeSize(control)} - the correction never reached layout`
    ).toBe(true);
    view.unmount();

    // Then warm: the size the correction produced is now the cached answer, and a
    // second mount must not need another one.
    const warmBefore = stats();
    const second = await render(
      <StepperOwner accessibilityLabel="Warm" testId="warm" value={1} />,
      { timeout: 20000 }
    );
    await waitForTestId('warm');
    await waitForMeasured('warm', 'the warm mount');
    expect(
      corrections(warmBefore, stats()),
      'a warm mount still needed a correction, so the corrected size was never cached'
    ).toBe(0);
    second.unmount();
  });

  it('measures one box for every range, step and disabled state', async () => {
    // A Stepper's sizing variant is empty, and this is the assertion that keeps it
    // honest: the box is two fixed halves, so a range of 2 or of 2,000, a step of 1 or
    // of 0.5, and a disabled control all measure the same number. If a prop that moves
    // the box is ever added, `Stepper.tsx` has to start naming it in its variant - and
    // this test goes red first, because the boxes stop agreeing.
    poison([sizingKey()]);
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Tiny"
          maximumValue={2}
          testId="range-tiny"
          value={1}
        />
        <StepperOwner
          accessibilityLabel="Huge"
          maximumValue={2000}
          minimumValue={-500}
          testId="range-huge"
          value={0}
        />
        <StepperOwner
          accessibilityLabel="Halves"
          maximumValue={10}
          step={0.5}
          testId="step-half"
          value={2.5}
        />
        <StepperOwner
          accessibilityLabel="Off"
          disabled
          testId="disabled-box"
          value={1}
        />
      </View>,
      { timeout: 20000 }
    );
    const ids = ['range-tiny', 'range-huge', 'step-half', 'disabled-box'];
    const sizes = new Map<string, Size>();
    for (const id of ids) {
      await waitForTestId(id);
      sizes.set(id, await waitForMeasured(id, id));
    }
    const first = sizes.get('range-tiny');
    for (const id of ids) {
      expect(
        sameSize(sizes.get(id) ?? null, first ?? null),
        `"${id}" measures ${describeSize(sizes.get(id) ?? null)} while "range-tiny" ` +
          `measures ${describeSize(first ?? null)} - a Stepper's box is not supposed ` +
          'to depend on its range, step or enabled state, which is why it has one ' +
          'cached size for the whole app'
      ).toBe(true);
    }
    view.unmount();
  });

  it('steps one value and reports one event per step', async () => {
    const view = await render(
      <StepperOwner accessibilityLabel="Counter" testId="step" value={0} />,
      { timeout: 20000 }
    );
    await waitForTestId('step');
    await waitForDrawn('step', '0');

    await stepStepper('step', 1);
    expect(
      await waitForEvents(0, ['step:1']),
      'one step up reported one event'
    ).toEqual(['step:1']);
    await waitForDrawn('step', '1');

    await stepStepper('step', 1);
    expect(
      await waitForEvents(1, ['step:2']),
      'the second step up reported one event'
    ).toEqual(['step:2']);
    await waitForDrawn('step', '2');

    await stepStepper('step', -1);
    expect(
      await waitForEvents(2, ['step:1']),
      'one step down reported one event'
    ).toEqual(['step:1']);
    await waitForDrawn('step', '1');

    // Both halves report their state from where they are drawn, so a step is
    // asserted against the buttons as well as against the value.
    expect(
      `${reportOf('step').up}/${reportOf('step').down}`,
      'mid-range, both halves are live'
    ).toBe('1/1');
    view.unmount();
  });

  it('disables the half at a bound and reports nothing from it', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="At the floor"
          maximumValue={2}
          minimumValue={0}
          testId="at-min"
          value={0}
        />
        <StepperOwner
          accessibilityLabel="Barrier"
          maximumValue={10}
          testId="bounds-barrier"
          value={0}
        />
        <StepperOwner
          accessibilityLabel="At the ceiling"
          maximumValue={2}
          minimumValue={0}
          testId="at-max"
          value={2}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('at-min');
    await waitForTestId('at-max');
    await waitForDrawn('at-min', '0');
    await waitForDrawn('at-max', '2');

    expect(
      `${reportOf('at-min').up}/${reportOf('at-min').down}`,
      'at the minimum the decrement half is disabled and the increment half is live'
    ).toBe('1/0');
    expect(
      `${reportOf('at-max').up}/${reportOf('at-max').down}`,
      'at the maximum it is the other half round'
    ).toBe('0/1');

    // The non-event needs a barrier (core.md §9): an empty list only means "nothing
    // arrived" once something else has proved the callback pipeline flushed. A live
    // stepper, stepped in the same turn as the two bound ones, is that proof - and
    // the equality below then says both halves at once: the barrier's event arrived,
    // and nothing else did.
    await waitForTestId('bounds-barrier');
    const before = events.length;
    await stepStepper('at-min', -1);
    await stepStepper('at-max', 1);
    await stepStepper('bounds-barrier', 1);
    expect(
      await waitForEvents(before, ['bounds-barrier:1']),
      'a half that is disabled at a bound must produce no event at all - neither ' +
        'the harness seam nor a finger may invent one the control could not make'
    ).toEqual(['bounds-barrier:1']);
    expect(
      await eventsAfterQuiet(before),
      'a bound half reported after the pipeline settled'
    ).toEqual(['bounds-barrier:1']);
    expect(reportOf('at-min').displayed, 'the floor stayed at 0').toBe('0');
    expect(reportOf('at-max').displayed, 'the ceiling stayed at 2').toBe('2');

    // And the live half at each end still works, so the silence above is a bound and
    // not a control that stopped listening. From the *settled* list onward: the
    // barrier's own event sits in front of these two, so a window opened at
    // `before` would report three events where two happened.
    const afterBarrier = events.length;
    await stepStepper('at-min', 1);
    expect(await waitForEvents(afterBarrier, ['at-min:1'])).toEqual([
      'at-min:1',
    ]);
    await stepStepper('at-max', -1);
    expect(await waitForEvents(afterBarrier + 1, ['at-max:1'])).toEqual([
      'at-max:1',
    ]);
    view.unmount();
  });

  it('steps 0.1 without float drift, and reaches the maximum', async () => {
    const view = await render(
      <StepperOwner
        accessibilityLabel="Tenths"
        maximumValue={0.3}
        minimumValue={0}
        step={0.1}
        testId="tenths"
        value={0}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('tenths');
    await waitForDrawn('tenths', '0');
    const before = events.length;
    for (let index = 0; index < 3; index += 1) {
      await stepStepper('tenths', 1);
      // Awaited one step at a time: the point is the *digits* of each step, and a
      // burst would let one drifted value hide behind the next correction.
      await waitForEvents(before + index, [
        `tenths:${['0.1', '0.2', '0.3'][index]}`,
      ]);
    }
    expect(
      events.slice(before),
      'three steps of 0.1 from 0 - the values must arrive through ' +
        '`NitroUiSliderValue.quantize`, not as 0.30000000000000004'
    ).toEqual(['tenths:0.1', 'tenths:0.2', 'tenths:0.3']);
    expect(reportOf('tenths').displayed, 'the last step is the maximum').toBe(
      '0.3'
    );
    expect(
      reportOf('tenths').up,
      'the maximum is a stop of this grid, so the increment half is disabled at it'
    ).toBe('0');
    view.unmount();
  });

  it('reverts a change the app refused, and shows a value the app wrote', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Refusing"
          maximumValue={10}
          refuse
          testId="refused"
          value={2}
        />
        <StepperOwner
          accessibilityLabel="Following"
          maximumValue={10}
          testId="written"
          value={2}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('refused');
    await waitForTestId('written');
    await waitForDrawn('refused', '2');
    await waitForDrawn('written', '2');

    const before = events.length;
    await stepStepper('refused', 1);
    expect(await waitForEvents(before, ['refused:3'])).toEqual(['refused:3']);
    // The app never adopted 3. Its echo still advanced `mostRecentEventCount`, which
    // is what lets native accept the still-current `value={2}` and put the control
    // back - the refused half of the handshake (§4), and the half a control without
    // an echo would get wrong forever.
    await waitForDrawn('refused', '2');
    expect(
      reportOf('refused').displayed,
      'a refused step snapped back to the app’s value'
    ).toBe('2');

    // The other direction, same handshake: a value the app writes is displayed.
    setters.get('written')?.(7);
    await waitForDrawn('written', '7');
    // And from there the user can step again, so the write was accepted rather than
    // parked as stale.
    const next = events.length;
    await stepStepper('written', 1);
    expect(await waitForEvents(next, ['written:8'])).toEqual(['written:8']);
    view.unmount();
  });

  it('sends nothing while disabled, and follows the flag back', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Disabled"
          disabled
          maximumValue={10}
          testId="off"
          value={5}
        />
        <StepperOwner
          accessibilityLabel="Barrier"
          maximumValue={10}
          testId="off-barrier"
          value={5}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('off');
    await waitForTestId('off-barrier');
    await waitForDrawn('off', '5');

    // The same barrier discipline as the bounds test: step the live one alongside the
    // disabled one, so silence means "nothing arrived", not "nothing arrived yet".
    const before = events.length;
    await stepStepper('off', 1);
    await stepStepper('off', -1);
    await stepStepper('off-barrier', 1);
    expect(
      await waitForEvents(before, ['off-barrier:6']),
      'a disabled stepper reports nothing in either direction'
    ).toEqual(['off-barrier:6']);
    expect(
      await eventsAfterQuiet(before),
      'a disabled stepper reported after the pipeline settled'
    ).toEqual(['off-barrier:6']);
    expect(
      reportOf('off').displayed,
      'and shows the same value as before'
    ).toBe('5');
    expect(
      `${reportOf('off').up}/${reportOf('off').down}`,
      'a disabled stepper has no live half at all'
    ).toBe('0/0');

    // A reader is told the same thing the screen shows.
    const a11y = await probeAccessibility('off');
    expect(
      a11y,
      'a disabled stepper announces itself as disabled - otherwise VoiceOver and ' +
        'TalkBack offer an inert control as a live one'
    ).toContain('disabled=true');

    view.unmount();
    // Re-mounted enabled under the same testID: the flag arriving as `false` is the
    // other half of "follows the flag back".
    const second = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Re-enabled"
          maximumValue={10}
          testId="off"
          value={5}
        />
        <StepperOwner
          accessibilityLabel="Barrier"
          maximumValue={10}
          testId="off-barrier"
          value={5}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('off');
    await waitForDrawn('off', '5');
    const after = events.length;
    await stepStepper('off', 1);
    expect(await waitForEvents(after, ['off:6'])).toEqual(['off:6']);
    second.unmount();
  });

  it('keeps its own value when uncontrolled, and seeds it from the range', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Seeded"
          defaultValue={3}
          maximumValue={10}
          testId="seeded"
        />
        <StepperOwner
          accessibilityLabel="Floor"
          maximumValue={100}
          minimumValue={20}
          testId="floored"
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('seeded');
    await waitForTestId('floored');
    await waitForDrawn('seeded', '3');
    // An uncontrolled Stepper with no `defaultValue` starts at the bottom of its own
    // range: `<Stepper minimumValue={20} />` showing 0 would display a value the
    // control cannot legally hold.
    await waitForDrawn('floored', '20');

    const before = events.length;
    await stepStepper('seeded', 1);
    expect(await waitForEvents(before, ['seeded:4'])).toEqual(['seeded:4']);
    await waitForDrawn('seeded', '4');
    // Native owns the value, so the app being silent about it changes nothing: a
    // second step continues from 4 rather than snapping back to the 3 it never saw.
    const again = events.length;
    await stepStepper('seeded', 1);
    expect(await waitForEvents(again, ['seeded:5'])).toEqual(['seeded:5']);
    await waitForDrawn('seeded', '5');
    view.unmount();
  });

  it('snaps a value outside the range back into it', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Too high"
          maximumValue={5}
          minimumValue={0}
          testId="over"
          value={9}
        />
        <StepperOwner
          accessibilityLabel="Too low"
          maximumValue={5}
          minimumValue={0}
          testId="under"
          value={-4}
        />
        <StepperOwner
          accessibilityLabel="Off the grid"
          maximumValue={10}
          minimumValue={0}
          step={3}
          testId="offgrid"
          value={7}
        />
      </View>,
      { timeout: 20000 }
    );
    const ids = ['over', 'under', 'offgrid'];
    for (const id of ids) {
      await waitForTestId(id);
    }
    await waitForDrawn('over', '5');
    await waitForDrawn('under', '0');
    // A value that is inside the range but not on the grid goes to the grid
    // (`quantize`), not to the nearest bound. The fixture is deliberately *not* a tie:
    // the shared quantizer breaks ties away from zero, so a half-step value would pin
    // that tie-break here as well, and this test is about the grid.
    await waitForDrawn('offgrid', '6');

    const before = events.length;
    // From the clamped value the control can still step, and the first step is a
    // legal one - a control that stored 9 and clamped only for display would step to
    // 10, off the end of the range.
    await stepStepper('over', -1);
    expect(await waitForEvents(before, ['over:4'])).toEqual(['over:4']);
    await stepStepper('under', 1);
    expect(await waitForEvents(before + 1, ['under:1'])).toEqual(['under:1']);
    await stepStepper('offgrid', 1);
    expect(await waitForEvents(before + 2, ['offgrid:9'])).toEqual([
      'offgrid:9',
    ]);
    view.unmount();
  });

  it('presents one adjustable control to a reader', async () => {
    const view = await render(
      <StepperOwner
        accessibilityLabel="Quantity"
        maximumValue={10}
        minimumValue={0}
        step={2}
        testId="a11y"
        value={4}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('a11y');
    await waitForDrawn('a11y', '4');
    const detail = await probeAccessibility('a11y');
    console.log(
      `stepper a11y: ${JSON.stringify({ detail, merged: mergedCount('a11y') })}`
    );

    expect(detail, 'the control is named').toContain('Quantity');
    // The *value* is the control's own half of the announcement, spelled without a
    // float's noise (`4`, not `4.0`), and both platforms have to spell it alike or
    // the two readings of this line would disagree.
    expect(detail, 'the control carries its value').toContain('4');

    if (Platform.OS === 'ios') {
      // `.adjustable` is the trait VoiceOver needs to offer a swipe-adjustable element
      // at all. The control answers it as a bool computed by UIKit, because the raw mask
      // beside it is UIKit's own numbering: an element UIKit agrees is adjustable
      // reports `traits=4096` on the OS this ran on, which is not the bit the pre-26
      // headers list, so a test that hard-coded one would be a premise everywhere else.
      const traits = /traits=(\d+)/.exec(detail)?.[1] ?? '';
      expect(traits.length, `no traits in "${detail}"`).toBeGreaterThan(0);
      expect(
        detail,
        `the element is not adjustable: "${detail}"`
      ).toContain('adjustable=true');
    } else {
      // Android's claim has two halves: the one node with range info, and the two
      // buttons being *out* of the tree beside it.
      expect(
        mergedCount('a11y'),
        `a reader is not offered exactly one merged node (report: "${detail}")`
      ).toBe('1');
      expect(
        /range=0\.\.10@4\/steps=4/.test(detail),
        `the merged node does not publish this control's grid: "${detail}" - ` +
          '`steps` is the count of stops *between* the ends, from the same grid the ' +
          'buttons step along'
      ).toBe(true);
      expect(
        /clickable=0/.test(detail),
        `a reader is offered a clickable node: "${detail}" - the two halves have to ` +
          'clear their own semantics, or TalkBack gets two focus stops with a click ' +
          'on each and no adjustable value at all'
      ).toBe(true);
    }
    view.unmount();
  });

  it('steps once when a reader asks, and not at all at a bound', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Reader"
          maximumValue={10}
          minimumValue={0}
          step={2}
          testId="reader"
          value={4}
        />
        <StepperOwner
          accessibilityLabel="At the ceiling"
          maximumValue={10}
          minimumValue={0}
          testId="reader-at-max"
          value={10}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('reader');
    await waitForTestId('reader-at-max');
    await waitForDrawn('reader', '4');
    await waitForDrawn('reader-at-max', '10');

    const before = events.length;
    const report = await accessibilityStepReport('reader', 1);
    console.log(`stepper reader step up: ${report}`);
    expect(
      report,
      'the reader’s own action did not perform a step - with no adjustable element ' +
        '(iOS) or no node publishing SetProgress (Android) the probe does nothing ' +
        'and says so, and falling back to the model would prove nothing'
    ).toContain('4->6');
    expect(await waitForEvents(before, ['reader:6'])).toEqual(['reader:6']);

    const back = events.length;
    const down = await accessibilityStepReport('reader', -1);
    console.log(`stepper reader step down: ${down}`);
    expect(down, 'and back down again').toContain('6->4');
    expect(await waitForEvents(back, ['reader:4'])).toEqual(['reader:4']);

    // At the ceiling the *reader's* action has nothing to do. The two platforms word
    // this differently - iOS performs the call on a `.notEnabled` element that
    // refuses, Android's delegate clamps its own target - so what both have to agree
    // on is the outcome: no event, and no value.
    const bound = events.length;
    const atBound = await accessibilityStepReport('reader-at-max', 1);
    // The live stepper is the barrier for this non-event: its own reader step lands
    // in the same window, so its event is what makes the empty list mean anything.
    const barrier = await accessibilityStepReport('reader', 1);
    console.log(`stepper reader at the ceiling: ${atBound}`);
    expect(atBound, 'the probe reported what it found').toContain('10');
    expect(
      await waitForEvents(bound, ['reader:6']),
      `a reader asking past the maximum produced an event: ${JSON.stringify(
        events.slice(bound)
      )} (${atBound})`
    ).toEqual(['reader:6']);
    expect(barrier, 'and the barrier’s own step moved one step').toContain(
      '4->6'
    );
    expect(reportOf('reader-at-max').displayed).toBe('10');
    view.unmount();
  });

  it('draws the two Material Symbols glyphs on Android', async () => {
    const view = await render(
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        <StepperOwner
          accessibilityLabel="Probe"
          maximumValue={10}
          testId="pixels"
          value={5}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('pixels');
    await waitForDrawn('pixels', '5');

    if (Platform.OS === 'ios') {
      // iOS has no Android artwork to sample and says so, in the same line shape
      // IconButton's answers with, so one test reads both platforms.
      const refusal = await pixelProbe('pixels', BLACK, 'the iOS refusal');
      expect(refusal.raw, `iOS answered "${refusal.raw}"`).toContain(
        'no pixels'
      );
      view.unmount();
      return;
    }

    const dark = await pixelProbe('pixels', BLACK, 'the darkest thing drawn');
    const light = await pixelProbe('pixels', WHITE, 'the lightest thing drawn');
    console.log(
      `stepper pixel probes: ${JSON.stringify([dark.raw, light.raw])}`
    );

    const area = dark.width * dark.height;
    expect(area, `the probe did not answer a box: ${dark.raw}`).toBeGreaterThan(
      0
    );

    // Black and white are not colours this control paints - they are the two ends of
    // the scale used to *find* the two it does: each probe answers the nearest thing on
    // screen to its own end. One of those is the container, the other the ink. Whether
    // the scheme paints dark ink on a mid container or light ink on a dark one is then
    // decided by the pixels rather than by a JS constant, so both spellings pass.
    const darkColour = dark.closest;
    const lightColour = light.closest;
    expect(darkColour.length, `no closest colour in "${dark.raw}"`).toBe(7);
    expect(lightColour.length, `no closest colour in "${light.raw}"`).toBe(7);

    const darkPaint = await pixelProbe(
      'pixels',
      darkColour,
      'the darkest colour present'
    );
    const lightPaint = await pixelProbe(
      'pixels',
      lightColour,
      'the lightest colour present'
    );
    // The marks are thin strokes over a solid fill, so the extreme covering *fewer*
    // pixels is the ink and the other one is the surface it sits on.
    const ink = darkPaint.hits <= lightPaint.hits ? darkPaint : lightPaint;
    const surface = darkPaint.hits <= lightPaint.hits ? lightPaint : darkPaint;
    console.log(
      `stepper ink=${ink.closest} hits=${String(ink.hits)} ` +
        `surface=${surface.closest} hits=${String(surface.hits)}`
    );

    expect(
      ink.hits,
      `the colour this control paints its marks in (${ink.closest}) is not on ` +
        `screen at all: ${ink.raw}`
    ).toBeGreaterThan(0);
    expect(
      colourDistance(ink.closest, surface.closest),
      `the "ink" is barely a different colour from the surface it sits on ` +
        `(${ink.closest} vs ${surface.closest}, ${String(
          colourDistance(ink.closest, surface.closest)
        )} apart on the sampler's own scale) - nothing is being drawn on top of it`
    ).toBeGreaterThan(60);
    // The line a stepper with empty glyph slots cannot cross. With nothing painted,
    // the two extremes are the container and the sampler's own mid-grey backdrop
    // showing through the box - about 37 apart and near-equal in area - so this and the
    // distance above collapse together rather than one of them quietly surviving.
    expect(
      surface.hits > ink.hits * 2,
      `the surface (${surface.closest}, ${String(
        surface.hits
      )} px) is not the dominant painting of this box; ink is ${String(
        ink.hits
      )} px: ${surface.raw}`
    ).toBe(true);
    expect(
      colourDistance(ink.closest, BACKDROP),
      `the "ink" is the probe's own backdrop (${ink.closest}, ` +
        `${String(colourDistance(ink.closest, BACKDROP))} from ${BACKDROP}) - ` +
        'the glyph slots drew nothing, so the only dark/light thing here is the ' +
        `canvas: ${dark.raw}`
    ).toBeGreaterThan(30);
    // And ink that covers the box is a filled block, not a glyph.
    expect(
      ink.hits < area * 0.5,
      `${ink.closest} covers ${String(ink.hits)} of ${String(
        area
      )} pixels - that is a filled block, not a glyph on a container: ${ink.raw}`
    ).toBe(true);
    view.unmount();
  });

  it('resets the value, the range and the name when its view is recycled', async () => {
    // `Recycling.harness.tsx` proves the pool is real; Conformance's residue probe
    // proves the reset clears the value. What this file pins is the pair the Stepper
    // adds: a recycled control must also forget its previous owner's **range**, or a
    // 0…2 stepper becomes a 0…100 stepper wearing the new owner's name - a wrong
    // bound no prop re-sends until the app happens to send one.
    const first = await render(
      <StepperOwner
        accessibilityLabel="First owner"
        defaultValue={1}
        maximumValue={2}
        minimumValue={0}
        testId="recycled"
      />,
      { timeout: 20000 }
    );
    await waitForTestId('recycled');
    await waitForDrawn('recycled', '1');
    const before = events.length;
    await stepStepper('recycled', 1);
    expect(await waitForEvents(before, ['recycled:2'])).toEqual(['recycled:2']);
    await waitForDrawn('recycled', '2');
    first.unmount();
    // Long enough for the drop to run and the instance to reach the pool.
    await sleep(500);

    const second = await render(
      <StepperOwner
        accessibilityLabel="Second owner"
        defaultValue={40}
        maximumValue={100}
        minimumValue={30}
        testId="recycled"
      />,
      { timeout: 20000 }
    );
    await waitForTestId('recycled');
    await waitForDrawn('recycled', '40');
    expect(
      handles.get('recycled')?.accessibilityLabel,
      'the recycled control answers to its new owner'
    ).toBe('Second owner');
    expect(
      handles.get('recycled')?.maximumValue,
      'the recycled control lost the previous owner’s range'
    ).toBe(100);

    // And the one-shot that applies a default was re-armed: 40 is neither the residue
    // (2) nor what a reset alone leaves (0), so only a re-applied default can draw it.
    const after = events.length;
    await stepStepper('recycled', -1);
    expect(await waitForEvents(after, ['recycled:39'])).toEqual([
      'recycled:39',
    ]);
    second.unmount();
  });

  it('survives mounting and unmounting repeatedly, and many instances at once', async () => {
    for (let round = 0; round < 30; round += 1) {
      const view = await render(
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <StepperOwner
            accessibilityLabel={`Churn ${String(round)}`}
            testId="churn"
            value={round % 5}
          />
        </View>,
        { timeout: 20000 }
      );
      await waitForTestId('churn');
      view.unmount();
      handles.delete('churn');
    }
    const many = Array.from({ length: 40 }, (_, index) => index);
    const view = await render(
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {many.map((index) => (
          <StepperOwner
            accessibilityLabel={`Instance ${String(index)}`}
            key={index}
            maximumValue={index + 1}
            testId={`many-${String(index)}`}
            value={0}
          />
        ))}
      </View>,
      { timeout: 20000 }
    );
    for (const index of many) {
      await waitForTestId(`many-${String(index)}`);
    }
    // One cached size for all forty, and every control answers for itself.
    const sizes = new Map<string, Size>();
    for (const index of many) {
      const id = `many-${String(index)}`;
      sizes.set(id, await waitForMeasured(id, id));
    }
    for (const index of many) {
      const id = `many-${String(index)}`;
      expect(
        sameSize(sizes.get(id) ?? null, DECLARED),
        `${id} measures ${describeSize(sizes.get(id) ?? null)}, not ` +
          `${describeSize(DECLARED)} - a range of 0…${String(index + 1)} does not ` +
          'move a Stepper’s box'
      ).toBe(true);
    }
    const before = events.length;
    await stepStepper('many-7', 1);
    expect(await waitForEvents(before, ['many-7:1'])).toEqual(['many-7:1']);
    view.unmount();
  });
});
