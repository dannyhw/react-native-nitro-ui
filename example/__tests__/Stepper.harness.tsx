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
import { Stepper, nitroUiCore } from 'react-native-nitro-ui';

import { waitForHandle } from './handles';

const COMPONENT = 'NitroUiStepper';

type Size = { width: number; height: number };
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

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
 * The fallback size the native Stepper declares, in points / dp. Must match the
 * native sources and `DECLARED_FALLBACKS.NitroUiStepper` in
 * `scripts/conformance-core.mjs`.
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

const setters = new Map<string, (next: number) => void>();

type OwnerProps = {
  testId: string;
  /** Omit for an uncontrolled Stepper. */
  value?: number;
  defaultValue?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Keep the app's own value whatever the control asks for. */
  refuse?: boolean;
};

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
  const shown = own;
  if (controlled) {
    setters.set(testId, setOwn);
  }
  const onValueChange = useCallback(
    (next: number) => {
      events.push(`${testId}:${String(next)}`);
      // Uncontrolled writes nothing: native owns the displayed value.
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

async function waitForMeasured(testId: string, what: string): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

function rawOf(testId: string): string {
  return handles.get(testId)?.nuiTestStateReport() ?? '';
}

function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

// `displayed` is written where the control is drawn; `hybridRef`'s `value` only
// answers what React sent.
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

const EVENT_QUIET_MS = 400;

// Waits a quiet period after the count is reached, so a surplus event (two for
// one tap) is in the list the caller compares.
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

async function eventsAfterQuiet(from: number): Promise<string[]> {
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/** One step through the same path a tap takes. */
async function stepStepper(testId: string, direction: number): Promise<void> {
  const handle = await handleOf(testId);
  handle.nuiTestStep(direction);
}

/**
 * Performs the screen reader's action and waits for its report. The old report is
 * read before the action is posted to the UI thread; reading it afterwards races.
 * Reports are numbered, so a new one always differs.
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

/** How many nodes a screen reader is offered. iOS answers `unavailable`. */
const mergedCount = (testId: string): string =>
  reportOf(testId).merged ?? 'none';

/**
 * Must match the sizing key `Stepper.tsx` builds. It is empty because no prop
 * changes a Stepper's box.
 */
function sizingKey(): string {
  return '';
}

// A size no Stepper has, seeded before a mount so that a missing size correction
// leaves a visibly wrong box.
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

// Six digits on purpose: `processColor` reads an eight-digit literal as
// `#RRGGBBAA`, so `#FF000000` is red to it.
/** The mid-grey the native pixel sampler draws behind the control. */
const BACKDROP = '#808080';
const BLACK = '#000000';
const WHITE = '#FFFFFF';

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

  it('measures one box for every range, step and disabled state', async () => {
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

    // The live stepper is stepped last: its event proves the callback pipeline
    // flushed, so the absence of the other two events means they never fired.
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
    await waitForDrawn('refused', '2');
    expect(
      reportOf('refused').displayed,
      'a refused step snapped back to the app’s value'
    ).toBe('2');

    setters.get('written')?.(7);
    await waitForDrawn('written', '7');
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

    // The live stepper's event proves the pipeline flushed.
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

    // SwiftUI's `Stepper` does not dim itself under `.disabled`, so the iOS control
    // applies its own opacity, and the report carries the value it drew with.
    if (Platform.OS === 'ios') {
      expect(
        reportOf('off').opacity,
        'a disabled iOS stepper is drawn dimmed - at full strength the screen offers a ' +
          `control that answers to nobody (${rawOf('off')})`
      ).toBe('0.50');
      expect(
        reportOf('off-barrier').opacity,
        `and the live stepper beside it is drawn at full strength (${rawOf(
          'off-barrier'
        )})`
      ).toBe('1.00');
    }

    const a11y = await probeAccessibility('off');
    expect(
      a11y,
      'a disabled stepper announces itself as disabled - otherwise VoiceOver and ' +
        'TalkBack offer an inert control as a live one'
    ).toContain('disabled=true');

    view.unmount();
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
    // With no `defaultValue`, an uncontrolled Stepper starts at its minimum.
    await waitForDrawn('floored', '20');

    const before = events.length;
    await stepStepper('seeded', 1);
    expect(await waitForEvents(before, ['seeded:4'])).toEqual(['seeded:4']);
    await waitForDrawn('seeded', '4');
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
    // 7 on a grid of 3 is not a tie, so this does not depend on how ties round.
    await waitForDrawn('offgrid', '6');

    const before = events.length;
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
    // `value=4`, not a bare `4`: other fields of the report also contain a 4.
    expect(detail, 'the control carries its value').toContain('value=4');

    if (Platform.OS === 'ios') {
      // The raw trait mask differs between iOS versions, so the test reads the
      // `adjustable` flag UIKit computed and not a bit.
      const traits = /traits=(\d+)/.exec(detail)?.[1] ?? '';
      expect(traits.length, `no traits in "${detail}"`).toBeGreaterThan(0);
      expect(detail, `the element is not adjustable: "${detail}"`).toContain(
        'adjustable=true'
      );
    } else {
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

    const bound = events.length;
    const atBound = await accessibilityStepReport('reader-at-max', 1);
    // The live stepper's event proves the pipeline flushed.
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

    // The glyph colour comes from the dynamic colour scheme and is unknown here, so
    // the probes ask for black and for white and take the closest colour to each:
    // one is the container, the other the ink.
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
    // The colour covering fewer pixels is the ink.
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
    // With no glyph painted, the two extremes would be the container and the
    // sampler's backdrop: close in colour and near-equal in area.
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
    expect(
      ink.hits < area * 0.5,
      `${ink.closest} covers ${String(ink.hits)} of ${String(
        area
      )} pixels - that is a filled block, not a glyph on a container: ${ink.raw}`
    ).toBe(true);
    view.unmount();
  });

  it('resets the value, the range and the name when its view is recycled', async () => {
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
    // Time for the dropped view to reach the recycle pool.
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
