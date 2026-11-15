import { useState } from 'react';
import {
  Platform,
  TurboModuleRegistry,
  View,
  type ViewStyle,
} from 'react-native';
import {
  afterEach,
  beforeAll,
  beforeEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { userEvent } from '@react-native-harness/ui';
import {
  Button,
  DatePicker,
  Host,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
  nitroUiCore,
} from 'react-native-nitro-ui';
import {
  forgetPromisedHandles,
  handleOf,
  handleRef,
  waitForPromisedHandle,
} from './handles';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back, per control: the test seams these cases read. */
type SliderHandle = {
  readonly value: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
  nuiTestAccessibilityStep(direction: number): void;
  nuiTestAccessibilityStepReport(): string;
  nuiTestFramePumpArmed(): boolean;
  nuiTestPointerStream(mode: number): void;
  nuiTestPointerStreamReport(): string;
};
type ProgressHandle = {
  readonly variant: string;
  readonly value: number | null;
  nuiTestDisplayedValue(): string;
  nuiTestIsAnimating(): boolean;
};
type ButtonHandle = {
  readonly title: string;
  readonly disabled: boolean;
};
type SwitchHandle = {
  readonly value: boolean | null;
  nuiTestArmedGuards(): string;
};
type SegmentHandle = {
  readonly options: readonly string[];
  readonly selectedIndex: number | null;
};
type PickerHandle = {
  readonly options: readonly string[];
  readonly selectedIndex: number | null;
  nuiTestSelect(index: number): void;
  nuiTestMenuReport(): string;
};
type DateHandle = {
  readonly mode: string;
  nuiTestPresent(): void;
  nuiTestStateReport(): string;
};

/** One entry in a Slider's event log, with the value that came with it. */
type SlideEvent = {
  id: string;
  kind: 'start' | 'change' | 'complete';
  value: number;
};

type Log = {
  /**
   * Every event that says "a control answered this press", in order, named by `testID`.
   * One list for all controls: two entries for one press is two hosted controls claiming
   * one touch.
   */
  taps: string[];
  /** The Slider's three callbacks, with values, so the handshake is auditable. */
  slides: SlideEvent[];
  /** Values the app agreed to. Absent means refused, which is what a snap-back is. */
  acceptedSliders: Record<string, number>;
  acceptedSwitches: Record<string, boolean>;
  sliders: Record<string, SliderHandle>;
  bars: Record<string, ProgressHandle>;
  buttons: Record<string, ButtonHandle>;
  switches: Record<string, SwitchHandle>;
  segments: Record<string, SegmentHandle>;
  pickers: Record<string, PickerHandle>;
  dates: Record<string, DateHandle>;
  /** The accepted index of a hosted SegmentedControl / Picker, by id. */
  acceptedSegments: Record<string, number>;
  acceptedPickers: Record<string, number>;
  /**
   * Disable one date row by id. A harness press cannot reach the dialog's own window,
   * and a disabled control does not keep a window open, so this is how a case takes a
   * dialog it opened back off the screen.
   */
  disableDate: Record<string, (disabled: boolean) => void>;
  /** JS-side writes, so a test can move a control with no touch at all. */
  writeSlider: Record<string, (next: number) => void>;
  writeProgress: Record<string, (next: number | null) => void>;
  writeSwitch: Record<string, (next: boolean) => void>;
  setSliderDisabled?: (next: boolean) => void;
  /** Make a wrapper `View` draw, so its child moves out of a Host's view group. */
  setWrapperDraws?: (next: boolean) => void;
  setButtonDisabled?: (next: boolean) => void;
  setProgressValue?: (next: number | null) => void;
  setIds?: (ids: string[]) => void;
};

const newLog = (): Log => ({
  taps: [],
  slides: [],
  acceptedSliders: {},
  acceptedSwitches: {},
  sliders: {},
  bars: {},
  buttons: {},
  switches: {},
  segments: {},
  pickers: {},
  dates: {},
  acceptedSegments: {},
  acceptedPickers: {},
  disableDate: {},
  writeSlider: {},
  writeProgress: {},
  writeSwitch: {},
});

/**
 * A wrapper that takes its child's size, so `queryByTestId` on it reports the Host's
 * box. RN stretches a `View` to its parent otherwise, which would report the screen.
 */
const HUG: ViewStyle = { alignSelf: 'flex-start' };

function settle(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll for a `testID` and hand back its box. `screen.findByTestId` has no timeout, and a
 * hosted control mounts through the Host's composition, which is slower. A control wired
 * with `handleRef` is handed back only once its handle has landed too: the box exists
 * before the `hybridRef` callback has run.
 */
async function boxOf(testId: string, timeoutMs = 15000): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
      // At least the handle helper's own 5 s, and the rest of this call's budget
      // when that is longer, so a slow mount is not judged twice as harshly.
      await waitForPromisedHandle(
        testId,
        Math.max(5000, deadline - nitroUiCore.now())
      );
      return box;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${String(timeoutMs)}ms.`
      );
    }
    await settle(50);
  }
}

async function mount(ui: Parameters<typeof render>[0], timeoutMs = 30000) {
  return await render(ui, { timeout: timeoutMs });
}

/**
 * Press at an absolute point and report which control answered, or `null`. "Answered" is
 * an event reaching JS from one of `allowed`. On Android a hosted child's own box is not
 * the rect Compose drew, so presses are aimed through the Host, never at that box. Two
 * answers for one press fails.
 */
async function probeAt(
  x: number,
  y: number,
  allowed: string[],
  log: Log
): Promise<string | null> {
  const before = log.taps.length;
  await userEvent.pressAt(x, y);
  await settle(240);
  const hit = log.taps.slice(before);
  expect(hit.length).toBeLessThanOrEqual(1);
  const last = hit[hit.length - 1];
  if (last == null) {
    return null;
  }
  expect(allowed).toContain(last);
  return last;
}

/** Press an offset inside a box. */
function probeIn(
  box: ViewInfo,
  offsetX: number,
  offsetY: number,
  allowed: string[],
  log: Log
) {
  return probeAt(box.x + offsetX, box.y + offsetY, allowed, log);
}

/**
 * Where the first row of a Host is pressable on each platform. Android: inside the Host
 * at the column's leading edge, so the press travels through the Host's
 * `AndroidComposeView`. iOS: the Host lays children out as RN views, so the target is
 * the control's own box, at its centre, because the RN instance can stretch across the
 * Host while the SwiftUI control inside it stays intrinsic and centred.
 */
async function pressRow(
  hostBox: ViewInfo,
  childId: string,
  log: Log,
  offsetY = 24
): Promise<string | null> {
  if (Platform.OS === 'android') {
    return await probeIn(hostBox, 12, offsetY, [childId], log);
  }
  const child = await boxOf(childId);
  return await probeAt(
    child.x + child.width / 2,
    child.y + child.height / 2,
    [childId],
    log
  );
}

/**
 * Wait for the drawing to say `expected`. `nuiTestDisplayedValue` starts at
 * `displayed=none` and is written by the drawing code, so polling it is how a commit is
 * seen to reach the pixels.
 */
async function waitForDisplayed(
  handle: ProgressHandle,
  expected: string,
  timeoutMs = 12000
) {
  const deadline = nitroUiCore.now() + timeoutMs;
  let seen = 'never read';
  for (;;) {
    seen = handle.nuiTestDisplayedValue();
    if (seen === expected) {
      return seen;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Expected "${expected}" drawn within ${String(timeoutMs)}ms; last read "${seen}".`
      );
    }
    await settle(50);
  }
}

// MARK: - Fixtures

/**
 * Poll a hosted DatePicker's report until `ready` is happy, and hand back what it saw.
 * Field 1 of the report is `presented` and field 4 is `livePresentations`. Both are
 * read: the flag lands with the props batch, while the dialog's window goes when Compose
 * disposes it, a frame or two later.
 */
async function waitDate(
  handle: DateHandle,
  ready: (report: { presented: boolean; live: number }) => boolean,
  what: string,
  timeoutMs = 12000
): Promise<{ presented: boolean; live: number }> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const line = handle.nuiTestStateReport();
    const parts = line.split('|');
    const report = { presented: parts[1] === '1', live: Number(parts[4]) };
    if (ready(report)) {
      return report;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Date report never showed ${what} within ${String(timeoutMs)}ms; last read "${line}".`
      );
    }
    await settle(50);
  }
}

function Slide({
  id,
  log,
  accept = true,
  defaultValue = 0,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  disabled,
  style,
  accessibilityLabel,
}: {
  id: string;
  log: Log;
  accept?: boolean;
  defaultValue?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  log.writeSlider[id] = setValue;
  const record = (kind: SlideEvent['kind']) => (next: number) => {
    log.slides.push({ id, kind, value: next });
    // One answer per gesture, counted on the event that opens it: a Slider reports
    // start -> change* -> complete, and `probeAt` reads two answers as two controls
    // claiming one touch.
    if (kind === 'start') {
      log.taps.push(id);
    }
  };
  return (
    <Slider
      testID={id}
      style={style}
      accessibilityLabel={accessibilityLabel ?? id}
      value={value}
      defaultValue={defaultValue}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      step={step}
      disabled={disabled}
      hybridRef={handleRef(log.sliders, id)}
      onSlidingStart={record('start')}
      onValueChange={record('change')}
      onSlidingComplete={(next) => {
        record('complete')(next);
        if (accept) {
          // Only an accepted value is recorded: a refusal shows as an absence.
          log.acceptedSliders[id] = next;
          setValue(next);
        }
      }}
    />
  );
}

/** A Progress whose value the test can write and read back off the drawing. */
function Bar({
  id,
  log,
  initialValue = 0.25,
  variant = 'linear',
  style,
}: {
  id: string;
  log: Log;
  initialValue?: number | null;
  variant?: 'linear' | 'circular';
  style?: ViewStyle;
}) {
  const [value, setValue] = useState<number | null>(initialValue);
  log.writeProgress[id] = setValue;
  log.setProgressValue = setValue;
  return (
    <Progress
      testID={id}
      style={style}
      variant={variant}
      accessibilityLabel={id}
      value={value}
      hybridRef={handleRef(log.bars, id)}
    />
  );
}

/** A Button the test can enable after mount. */
function Press({
  id,
  log,
  title,
  disabled,
  style,
}: {
  id: string;
  log: Log;
  title: string;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Button
      testID={id}
      style={style}
      title={title}
      accessibilityLabel={title}
      disabled={disabled}
      hybridRef={handleRef(log.buttons, id)}
      onPress={() => {
        log.taps.push(id);
      }}
    />
  );
}

/** A Button the test can enable after mount (the disabled pair's witness). */
function EnableableButton({
  id,
  log,
  title,
  initiallyDisabled,
}: {
  id: string;
  log: Log;
  title: string;
  initiallyDisabled: boolean;
}) {
  const [disabled, setDisabled] = useState(initiallyDisabled);
  log.setButtonDisabled = setDisabled;
  return <Press id={id} log={log} title={title} disabled={disabled} />;
}

/** A Slider the test can enable after mount (the disabled pair's witness). */
function EnableableSlide({
  id,
  log,
  initiallyDisabled,
}: {
  id: string;
  log: Log;
  initiallyDisabled: boolean;
}) {
  const [disabled, setDisabled] = useState(initiallyDisabled);
  log.setSliderDisabled = setDisabled;
  return <Slide id={id} log={log} disabled={disabled} />;
}

/**
 * A wrapper whose `View` the test can make layout-only after mount. RN collapses a
 * layout-only `View` out of the native tree and attaches its children to the nearest
 * view-owning ancestor, so the flip moves the control's own view into or out of the
 * Host, same instance, with no JS remount. A `backgroundColor` alone does not stop the
 * flattening; a wrapper that clips and sizes itself owns a view.
 */
function Reparenter({
  log,
  initiallyOwnsAView,
  children,
}: {
  log: Log;
  initiallyOwnsAView: boolean;
  children: React.ReactNode;
}) {
  const [ownsAView, setOwnsAView] = useState(initiallyOwnsAView);
  log.setWrapperDraws = setOwnsAView;
  return (
    <View
      style={
        ownsAView
          ? {
              backgroundColor: '#ffffff',
              overflow: 'hidden',
              width: 200,
              height: 48,
            }
          : undefined
      }
    >
      {children}
    </View>
  );
}

/** A hosted (or plain) Switch. */
function Toggle({
  id,
  log,
  style,
}: {
  id: string;
  log: Log;
  style?: ViewStyle;
}) {
  const [value, setValue] = useState(false);
  log.writeSwitch[id] = setValue;
  return (
    <Switch
      testID={id}
      style={style}
      accessibilityLabel={id}
      value={value}
      hybridRef={handleRef(log.switches, id)}
      onValueChange={(next) => {
        log.taps.push(id);
        log.acceptedSwitches[id] = next;
        setValue(next);
      }}
    />
  );
}

/** A SegmentedControl whose press is recorded in the shared taps log. */
function Segment({ id, log }: { id: string; log: Log }) {
  const [index, setIndex] = useState(0);
  return (
    <SegmentedControl
      testID={id}
      options={['One', 'Two', 'Three']}
      selectedIndex={index}
      accessibilityLabel={`Mixed segmented ${id.slice(-1)}`}
      hybridRef={handleRef(log.segments, id)}
      onChange={(event) => {
        log.taps.push(id);
        log.acceptedSegments[id] = event.index;
        setIndex(event.index);
      }}
    />
  );
}

/** A Picker whose choice is recorded, and whose popup can be read. */
function Pick({ id, log }: { id: string; log: Log }) {
  const [index, setIndex] = useState(0);
  return (
    <Picker
      testID={id}
      options={['Alpha', 'Beta', 'Gamma']}
      selectedIndex={index}
      label={`Pick ${id.slice(-1)}`}
      accessibilityLabel={`Mixed picker ${id.slice(-1)}`}
      hybridRef={handleRef(log.pickers, id)}
      onChange={(event) => {
        log.taps.push(id);
        log.acceptedPickers[id] = event.index;
        setIndex(event.index);
      }}
    />
  );
}

/** A DatePicker, compact, so it is the one that presents a dialog. */
function Dates({ id, log }: { id: string; log: Log }) {
  const [date, setDate] = useState(() => new Date(2026, 4, 17));
  const [off, setOff] = useState(false);
  log.disableDate[id] = setOff;
  return (
    <DatePicker
      testID={id}
      disabled={off}
      value={date}
      accessibilityLabel={`Mixed date picker ${id.slice(-1)}`}
      hybridRef={handleRef(log.dates, id)}
      onChange={setDate}
    />
  );
}

/**
 * One Host whose children are named by `ids`, each id's kind choosing the control. An id
 * is `mix-<kind>-<n>`: `sw` a Switch, `btn` a Button, `sl` a Slider, `pr` a Progress,
 * `seg` a SegmentedControl, `pk` a Picker, `dp` a DatePicker. Only the Switch and the
 * Button answer a press on both platforms, so the order sweeps read those two.
 */
function controlFor(id: string, log: Log) {
  const kind = id.split('-')[1];
  if (kind === 'sw') {
    return <Toggle key={id} id={id} log={log} />;
  }
  if (kind === 'btn') {
    return <Press key={id} id={id} log={log} title={`Go ${id.slice(-1)}`} />;
  }
  if (kind === 'sl') {
    return <Slide key={id} id={id} log={log} />;
  }
  if (kind === 'seg') {
    return <Segment id={id} log={log} />;
  }
  if (kind === 'pk') {
    return <Pick id={id} log={log} />;
  }
  if (kind === 'dp') {
    return <Dates id={id} log={log} />;
  }
  return <Bar key={id} id={id} log={log} />;
}

function MixedList({
  log,
  ids,
  hostStyle,
}: {
  log: Log;
  ids: string[];
  hostStyle?: ViewStyle;
}) {
  const [current, setCurrent] = useState(ids);
  log.setIds = setCurrent;
  return (
    <Host style={hostStyle}>{current.map((id) => controlFor(id, log))}</Host>
  );
}

const TAPPABLE_KINDS = ['sw', 'btn'];

/** The ids in `ids` a press can answer for, in the order the list has them. */
const tappableOf = (ids: string[]) =>
  ids.filter((id) => TAPPABLE_KINDS.includes(id.split('-')[1] ?? ''));

afterEach(() => {
  cleanup();
  forgetPromisedHandles();
});

beforeAll(async () => {
  // Pay the process-wide firsts (Nitro's first hybrid call, the first Compose
  // composition / UIHostingController commit) before anything is asserted.
  const { unmount } = await mount(
    <Switch defaultValue testID="controls-warm-up" />
  );
  unmount();
});

// MARK: - A hosted control is still that control

describe('Host · a hosted Slider is still a Slider', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  /**
   * Drive a drag and wait for the pipeline to drain.
   *
   * `nuiTestDrag` queues its moves on the main looper and `msPerStep: 0` lands them all
   * in one turn, so the wait is for delivery to JS rather than for the moves.
   */
  async function drag(id: string, to: number, steps = 4, msPerStep = 0) {
    const slider = await handleOf(() => log.sliders[id], id);
    slider.nuiTestDrag(to, steps, msPerStep);
    await settle(msPerStep > 0 ? msPerStep * steps + 500 : 700);
  }

  const slidesFor = (id: string) =>
    log.slides.filter((event) => event.id === id);
  const kindsFor = (id: string) => slidesFor(id).map((event) => event.kind);

  it('reports a hosted drag through all three callbacks', async () => {
    const { unmount } = await mount(
      <View testID="slide-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Slide id="slide-0" log={log} />
        </Host>
      </View>
    );
    await boxOf('slide-0');
    await handleOf(() => log.sliders['slide-0'], 'slide-0');

    await drag('slide-0', 0.75);
    const kinds = kindsFor('slide-0');
    // One start, one complete, at least one change between them, in that order.
    expect(kinds[0]).toBe('start');
    expect(kinds[kinds.length - 1]).toBe('complete');
    expect(kinds.filter((kind) => kind === 'start')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'complete')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'change').length).toBeGreaterThan(0);
    expect(slidesFor('slide-0')[0]?.value).toBeCloseTo(0, 5);
    expect(log.acceptedSliders['slide-0']).toBeCloseTo(0.75, 2);
    expect(log.sliders['slide-0']?.value).toBeCloseTo(0.75, 2);
    // A drag that ended must not leave its frame pump running.
    expect(log.sliders['slide-0']?.nuiTestFramePumpArmed()).toBe(false);
    unmount();
  });

  it('snaps a hosted Slider back when JS refuses the drag', async () => {
    const { unmount } = await mount(
      <View testID="refuse-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Slide id="refuse-0" log={log} accept={false} />
        </Host>
      </View>
    );
    await boxOf('refuse-0');
    await drag('refuse-0', 0.8);
    // JS was asked, and the app said no: the event stream moved, the state did not.
    expect(log.acceptedSliders['refuse-0']).toBeUndefined();
    expect(log.sliders['refuse-0']?.value).toBeCloseTo(0, 5);

    // The next drag starts from what the model displays, so a model that had kept 0.8
    // would start this drag at 0.8.
    log.slides.length = 0;
    await drag('refuse-0', 0.9);
    expect(slidesFor('refuse-0')[0]?.value).toBeCloseTo(0, 5);
    unmount();
  });

  it('shows a JS write on a hosted Slider with no touch at all', async () => {
    const { unmount } = await mount(
      <View testID="write-slide-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Slide id="write-slide-0" log={log} />
        </Host>
      </View>
    );
    await boxOf('write-slide-0');
    await handleOf(() => log.sliders['write-slide-0'], 'write-slide-0');
    log.writeSlider['write-slide-0']?.(0.4);
    await settle(500);
    // The handle is the model's last JS prop, not what is drawn. The next drag reads
    // the model's displayed value.
    expect(log.sliders['write-slide-0']?.value).toBeCloseTo(0.4, 5);
    expect(log.slides).toHaveLength(0);

    await drag('write-slide-0', 0.9);
    expect(slidesFor('write-slide-0')[0]?.value).toBeCloseTo(0.4, 2);
    unmount();
  });

  it('keeps a disabled hosted Slider inert, and the same drag answers once enabled', async () => {
    const { unmount } = await mount(
      <View testID="disabled-slide-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <EnableableSlide id="disabled-slide-0" log={log} initiallyDisabled />
        </Host>
      </View>
    );
    await boxOf('disabled-slide-0');
    const disabledSlider = await handleOf(
      () => log.sliders['disabled-slide-0'],
      'disabled-slide-0'
    );
    expect(disabledSlider.disabled).toBe(true);
    await drag('disabled-slide-0', 0.6);
    expect(log.slides).toHaveLength(0);

    // The same seam and the same drag with one prop different. Without this, "no
    // events" would be equally consistent with a Host that composed nothing.
    log.setSliderDisabled?.(false);
    await settle(500);
    await drag('disabled-slide-0', 0.6);
    expect(kindsFor('disabled-slide-0')).toEqual(
      expect.arrayContaining(['start', 'complete'])
    );
    expect(log.acceptedSliders['disabled-slide-0']).toBeCloseTo(0.6, 2);
    unmount();
  });
});

describe('Host · a hosted Progress still draws what JS sets', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  it('draws a JS write made while the control is hosted', async () => {
    const { unmount } = await mount(
      <View testID="bar-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <Bar id="bar-0" log={log} initialValue={0.25} />
        </Host>
      </View>
    );
    await boxOf('bar-0');
    const handle = await handleOf(() => log.bars['bar-0'], 'bar-0');
    // The mount write reached the drawing: a control that never drew would answer
    // `displayed=none` forever.
    await waitForDisplayed(handle, 'displayed=0.25');

    log.writeProgress['bar-0']?.(0.75);
    await waitForDisplayed(handle, 'displayed=0.75');
    // The handle is what JS last sent; the report above is what the drawing wrote.
    expect(handle.value).toBe(0.75);
    unmount();
  });

  it('animates a hosted indeterminate bar and stops at determinate', async () => {
    const { unmount } = await mount(
      <View testID="anim-host" style={HUG}>
        <Host style={{ width: 300, height: 160 }}>
          <Bar id="anim-indeterminate" log={log} initialValue={null} />
          <Bar id="anim-determinate" log={log} initialValue={0.5} />
        </Host>
      </View>
    );
    await boxOf('anim-determinate');
    const spinning = await handleOf(
      () => log.bars['anim-indeterminate'],
      'anim-indeterminate'
    );
    const still = await handleOf(
      () => log.bars['anim-determinate'],
      'anim-determinate'
    );
    // Both are in one Host, so one composition animates one indicator and not the other.
    expect(spinning.nuiTestIsAnimating()).toBe(true);
    expect(still.nuiTestIsAnimating()).toBe(false);
    await waitForDisplayed(spinning, 'displayed=indeterminate');

    // Giving the spinning bar a value has to stop it.
    log.writeProgress['anim-indeterminate']?.(0.2);
    await waitForDisplayed(spinning, 'displayed=0.2');
    expect(spinning.nuiTestIsAnimating()).toBe(false);
    unmount();
  });

  it('leaves a hosted circular Progress alone to size itself', async () => {
    // The circular variant has no width to fill, so the Host must not stretch it. A
    // Progress has no press target to probe, so this only shows that the variant that
    // fills and the one that does not both draw in one composition.
    const { unmount } = await mount(
      <View testID="circle-host" style={HUG}>
        <Host style={{ width: 260, height: 140 }}>
          <Bar id="circle-0" log={log} variant="circular" initialValue={0.5} />
          <Bar id="circle-1" log={log} variant="linear" initialValue={0.5} />
        </Host>
      </View>
    );
    await boxOf('circle-1');
    await waitForDisplayed(
      await handleOf(() => log.bars['circle-0'], 'circle-0'),
      'displayed=0.5'
    );
    await waitForDisplayed(
      await handleOf(() => log.bars['circle-1'], 'circle-1'),
      'displayed=0.5'
    );
    unmount();
  });
});

/**
 * A hosted Button's press, where a harness tap can reach one. The harness synthesises a
 * `UITouch` with no HID event behind it: RN's touch handler and SwiftUI's `Toggle`
 * accept that, and SwiftUI's `Button` refuses it, hosted or not. So three cases run on
 * Android only.
 */
describe('Host · a hosted Button still presses', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  // A hosted Button has no view of its own to store props in, so its `disabled` and
  // title have to stay live through the Host.
  it('keeps a hosted Button props live on both platforms', async () => {
    const { unmount } = await mount(
      <View testID="props-press-host" style={HUG}>
        <Host style={{ width: 300, height: 140 }}>
          <EnableableButton
            id="props-press-0"
            log={log}
            title="Deploy"
            initiallyDisabled
          />
        </Host>
      </View>
    );
    await boxOf('props-press-0');
    const button = await handleOf(
      () => log.buttons['props-press-0'],
      'props-press-0'
    );
    expect(button.title).toBe('Deploy');
    expect(button.disabled).toBe(true);

    log.setButtonDisabled?.(false);
    await settle(500);
    expect(button.disabled).toBe(false);
    unmount();
  });

  if (Platform.OS === 'android') {
    it('fires onPress for a real tap on a hosted Button', async () => {
      const { unmount } = await mount(
        <View testID="press-host" style={HUG}>
          <Host style={{ width: 300, height: 140 }}>
            <Press id="press-0" log={log} title="Deploy" />
          </Host>
        </View>
      );
      const host = await boxOf('press-host');
      expect([Math.round(host.width), Math.round(host.height)]).toEqual([
        300, 140,
      ]);
      expect(await pressRow(host, 'press-0', log)).toBe('press-0');
      expect(log.taps).toEqual(['press-0']);
      unmount();
    });

    it('keeps a disabled hosted Button inert, and the same tap answers once enabled', async () => {
      const { unmount } = await mount(
        <View testID="off-press-host" style={HUG}>
          <Host style={{ width: 300, height: 140 }}>
            <EnableableButton
              id="off-press-0"
              log={log}
              title="Deploy"
              initiallyDisabled
            />
          </Host>
        </View>
      );
      const host = await boxOf('off-press-host');
      const button = await handleOf(
        () => log.buttons['off-press-0'],
        'off-press-0'
      );
      expect(button.disabled).toBe(true);
      expect(await pressRow(host, 'off-press-0', log)).toBeNull();
      expect(log.taps).toEqual([]);

      log.setButtonDisabled?.(false);
      await settle(500);
      expect(await pressRow(host, 'off-press-0', log)).toBe('off-press-0');
      expect(log.taps).toEqual(['off-press-0']);
      unmount();
    });

    it('presses exactly one hosted Button per tap', async () => {
      const { unmount } = await mount(
        <View testID="pair-press-host" style={HUG}>
          <Host style={{ width: 300, height: 220 }}>
            <Press id="pair-a" log={log} title="Deploy" />
            <Press id="pair-b" log={log} title="Rollback" />
          </Host>
        </View>
      );
      const host = await boxOf('pair-press-host');
      const seen: string[] = [];
      for (let offset = 6; offset <= 180; offset += 8) {
        const hit = await probeIn(host, 12, offset, ['pair-a', 'pair-b'], log);
        if (hit != null && seen[seen.length - 1] !== hit) {
          seen.push(hit);
        }
      }
      // Two rows, two Buttons, each answering for its own band, in mount order.
      expect(seen).toEqual(['pair-a', 'pair-b']);
      unmount();
    });
  }
});

// MARK: - Mixed children, one Host

describe('Host · four kinds of control, one composition', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  const MIXED = ['mix-sw-0', 'mix-btn-1', 'mix-sl-2', 'mix-pr-3'];

  it('keeps every kind of control live in one Host', async () => {
    const { unmount } = await mount(
      <View testID="mixed-host" style={HUG}>
        <MixedList
          log={log}
          ids={MIXED}
          hostStyle={{ width: 300, height: 300 }}
        />
      </View>
    );
    const host = await boxOf('mixed-host');
    // `boxOf` throws if an id resolves to nothing, so this checks all four are mounted.
    for (const id of MIXED) {
      await boxOf(id);
    }

    // Switch: a real press, answered.
    expect(await pressRow(host, 'mix-sw-0', log)).toBe('mix-sw-0');
    expect(log.acceptedSwitches['mix-sw-0']).toBe(true);

    // Slider: a drag through the interaction pipeline, answered with a value.
    (await handleOf(() => log.sliders['mix-sl-2'], 'mix-sl-2')).nuiTestDrag(
      0.6,
      4,
      0
    );
    await settle(700);
    expect(log.acceptedSliders['mix-sl-2']).toBeCloseTo(0.6, 2);

    // Progress: the drawing reports the value JS set.
    await waitForDisplayed(
      await handleOf(() => log.bars['mix-pr-3'], 'mix-pr-3'),
      'displayed=0.25'
    );

    // Button: a real press. Android aims inside the Host at the rows Compose placed;
    // iOS aims at the child's own centre.
    if (Platform.OS === 'android') {
      const seen: string[] = [];
      for (let offset = 6; offset <= 260; offset += 8) {
        const hit = await probeIn(
          host,
          12,
          offset,
          [...tappableOf(MIXED), 'mix-sl-2'],
          log
        );
        if (hit != null && seen[seen.length - 1] !== hit) {
          seen.push(hit);
        }
      }
      expect(seen).toContain('mix-btn-1');
      // Every answer came from a control in this Host.
      expect(new Set(seen).size).toBeGreaterThan(0);
      for (const hit of seen) {
        expect(MIXED).toContain(hit);
      }
    } else {
      // A harness touch reaches no SwiftUI `Button` on iOS, so this half reads the
      // Button's props off the control the Host is drawing.
      const button = await handleOf(
        () => log.buttons['mix-btn-1'],
        'mix-btn-1'
      );
      expect(button.title).toBe('Go 1');
      expect(button.disabled).toBe(false);
    }
    unmount();
  });

  if (Platform.OS === 'android') {
    /**
     * Sweep the Host's column and report which pressable child answered each band. The
     * answer list collapses repeats: the row pitch is Compose's business, so the claim
     * is an order, not a y coordinate.
     */
    async function sweepOrder(box: ViewInfo, ids: string[]) {
      const allowed = [
        ...tappableOf(ids),
        ...ids.filter((id) => id.includes('-sl-')),
      ];
      const seen: string[] = [];
      // A 16 dp stride reaches every row of a 320 dp column and keeps a sweep to two
      // dozen presses, which fits the test's time budget.
      for (let offset = 6; offset <= 280; offset += 16) {
        const hit = await probeIn(box, 12, offset, allowed, log);
        if (hit != null && seen[seen.length - 1] !== hit) {
          seen.push(hit);
        }
      }
      return seen.filter((hit) =>
        TAPPABLE_KINDS.includes(hit.split('-')[1] ?? '')
      );
    }

    /** Mount the mixed Host once per test; the id list is what the test changes. */
    async function mountMixed(testId: string) {
      const mounted = await mount(
        <View testID={testId} style={HUG}>
          <MixedList
            log={log}
            ids={MIXED}
            hostStyle={{ width: 300, height: 320 }}
          />
        </View>
      );
      const host = await boxOf(testId);
      return { unmount: mounted.unmount, host };
    }

    it('follows mixed children that are reordered', async () => {
      const { unmount, host } = await mountMixed('order-mixed-host');
      expect(await sweepOrder(host, MIXED)).toEqual(['mix-sw-0', 'mix-btn-1']);

      // Reorder: the Button moves above the Switch.
      const swapped = ['mix-btn-1', 'mix-sl-2', 'mix-sw-0', 'mix-pr-3'];
      log.setIds?.(swapped);
      await settle(600);
      expect(await sweepOrder(host, swapped)).toEqual([
        'mix-btn-1',
        'mix-sw-0',
      ]);
      unmount();
    });

    it('follows mixed children that are removed and added', async () => {
      const { unmount, host } = await mountMixed('lifecycle-mixed-host');
      expect(await sweepOrder(host, MIXED)).toEqual(['mix-sw-0', 'mix-btn-1']);

      // Remove: the Switch goes, so the Button is the only pressable child left and the
      // first answer must be it.
      const minusSwitch = ['mix-btn-1', 'mix-sl-2', 'mix-pr-3'];
      log.setIds?.(minusSwitch);
      await settle(600);
      expect(await sweepOrder(host, minusSwitch)).toEqual(['mix-btn-1']);
      expect(harnessUi.queryByTestId('mix-sw-0')).toBeNull();

      // Add: a Switch that was never mounted joins at the *end*, so it answers last.
      const withNewSwitch = ['mix-btn-1', 'mix-sl-2', 'mix-sw-9', 'mix-pr-3'];
      log.setIds?.(withNewSwitch);
      await settle(700);
      expect(await sweepOrder(host, withNewSwitch)).toEqual([
        'mix-btn-1',
        'mix-sw-9',
      ]);
      unmount();
    });

    it('reports nothing to the sizing engine, mixed children included', async () => {
      // Slider and Progress are `fillWidth`: an implementation that let a hosted child
      // measure its own box would report a size here and the counters would move.
      nitroUiCore.invalidateSizingEnvironment();
      const before = nitroUiCore.sizingStats();
      const hosted = await mount(
        <Host style={{ width: 300, height: 320 }}>
          {MIXED.map((id) => controlFor(id, log))}
        </Host>
      );
      for (const id of MIXED) {
        await boxOf(id, 25000);
      }
      await settle(800);
      const afterHosted = nitroUiCore.sizingStats();
      hosted.unmount();
      await settle(400);

      // The same four controls with no Host, to show these counters can move at all.
      const plain = await mount(
        <View>{MIXED.map((id) => controlFor(id, log))}</View>
      );
      for (const id of MIXED) {
        await boxOf(id, 25000);
      }
      await settle(800);
      const afterPlain = nitroUiCore.sizingStats();
      plain.unmount();

      const delta = (
        from: ReturnType<typeof nitroUiCore.sizingStats>,
        to: ReturnType<typeof nitroUiCore.sizingStats>
      ) => ({
        measurements: to.measurements - from.measurements,
        reports:
          to.reportsQueued +
          to.reportsDropped +
          to.reportsConfirmed -
          (from.reportsQueued + from.reportsDropped + from.reportsConfirmed),
        cachedSizes: to.cachedSizes - from.cachedSizes,
        corrections:
          to.correctionsImmediate -
          from.correctionsImmediate +
          (to.correctionsBatched - from.correctionsBatched),
      });
      const hostedDelta = delta(before, afterHosted);
      const plainDelta = delta(afterHosted, afterPlain);
      // What a hosted control never does: report a size, or learn one.
      expect(hostedDelta.reports).toBe(0);
      expect(hostedDelta.cachedSizes).toBe(0);
      expect(hostedDelta.corrections).toBe(0);
      // Fabric still asks each child's Yoga node once, hosted or not, so four children
      // is four measure calls either way.
      expect(hostedDelta.measurements).toBe(MIXED.length);
      // Unhosted is "at least one each": a `fillWidth` control can be asked twice when
      // its answer overruns the box, and this batch holds two of them.
      expect(plainDelta.measurements).toBeGreaterThanOrEqual(MIXED.length);
      // The reporting counters did move without a Host.
      expect(plainDelta.reports).toBeGreaterThan(0);
    });
  }
});

// Every hostable control in one Host. A press sweep is the wrong instrument for the two
// controls that open a window, so each of the seven is asked what its own suite asks it.
describe('Host \u00b7 all seven kinds of control, one composition', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  const SEVEN = [
    'mix-sw-0',
    'mix-sl-1',
    'mix-pr-2',
    'mix-btn-3',
    'mix-seg-4',
    'mix-pk-5',
    'mix-dp-6',
  ];

  it('keeps every kind of control live in one Host', async () => {
    await mount(
      <View testID="seven-host" style={HUG}>
        <MixedList
          log={log}
          ids={SEVEN}
          hostStyle={{ width: 300, height: 420 }}
        />
      </View>
    );
    // On Android a hosted child's own view is `0 x 0`. One left out of the allowlist
    // draws nothing but keeps a real React Native frame, which is what this catches.
    for (const id of SEVEN) {
      const own = await boxOf(id, 25000);
      if (Platform.OS === 'android') {
        expect(own.width * own.height).toBe(0);
      }
    }

    const host = await boxOf('seven-host');
    // Switch and Button: a real press, answered, through the composition.
    expect(await pressRow(host, 'mix-sw-0', log)).toBe('mix-sw-0');
    expect(log.acceptedSwitches['mix-sw-0']).toBe(true);

    // Slider: a drag through the interaction pipeline.
    (await handleOf(() => log.sliders['mix-sl-1'], 'mix-sl-1')).nuiTestDrag(
      0.6,
      4,
      0
    );
    await settle(700);
    expect(log.acceptedSliders['mix-sl-1']).toBeCloseTo(0.6, 2);

    // Progress: the drawing reports the value JS set (0.25 is this Bar's own seed).
    await waitForDisplayed(
      await handleOf(() => log.bars['mix-pr-2'], 'mix-pr-2'),
      'displayed=0.25'
    );

    // Button: its props are on the control the Host is drawing.
    const button = await handleOf(() => log.buttons['mix-btn-3'], 'mix-btn-3');
    expect(button.title).toBe('Go 3');

    // SegmentedControl: the value React holds is on the hosted control.
    const segment = await handleOf(
      () => log.segments['mix-seg-4'],
      'mix-seg-4'
    );
    expect(segment.selectedIndex).toBe(0);
    expect(segment.options.length).toBe(3);
  });

  it('keeps the two window-opening controls live in the same Host', async () => {
    await mount(
      <MixedList
        log={log}
        ids={SEVEN}
        hostStyle={{ width: 300, height: 420 }}
      />
    );
    // Props land on both controls on either platform.
    const picker = await handleOf(() => log.pickers['mix-pk-5'], 'mix-pk-5');
    const date = await handleOf(() => log.dates['mix-dp-6'], 'mix-dp-6');
    expect(picker.options.length).toBe(3);
    expect(date.mode).toBe('date');
    if (Platform.OS !== 'android') {
      // A SwiftUI `Picker` keeps its menu in the system's own presentation and reports
      // nothing about it, and the dialog below is Material 3's, so there is no window
      // to read on iOS.
      return;
    }
    // Picker: a choice reaches JS, and the process-wide menu count is back at 0.
    picker.nuiTestSelect(2);
    await settle(500);
    expect(log.acceptedPickers['mix-pk-5']).toBe(2);
    expect(picker.nuiTestMenuReport()).toContain('live=0');

    // DatePicker: it presents a dialog from the Host's composition. Pressing the field
    // can only open one, so disabling the control is how the app takes the window down
    // again. Left at zero so the next case does not read this one as a leak.
    date.nuiTestPresent();
    const shown = await waitDate(
      date,
      (r) => r.presented && r.live === 1,
      "the dialog composed by the Host's composition"
    );
    expect(shown.presented).toBe(true);
    log.disableDate['mix-dp-6']?.(true);
    const hidden = await waitDate(
      date,
      (r) => !r.presented && r.live === 0,
      'the dialog taken down by disabling the control'
    );
    expect(hidden.presented).toBe(false);
    log.disableDate['mix-dp-6']?.(false);
  });
});

// MARK: - Android: what hosting costs, and the sizing rules per control

if (Platform.OS === 'android') {
  /**
   * A hosted child arms nothing for a composition it never builds. A control that owns
   * its composition arms a `ViewCompositionStrategy` (an observer on the activity's
   * `LifecycleRegistry`) and a first-frame `OnPreDrawListener`, both keyed to its own
   * view's composition.
   */
  describe('Host · a hosted control arms no composition guards (N4)', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    it('arms nothing for a hosted Switch and its own observer for the same Switch alone', async () => {
      const hostedIds = ['n4-hosted-0', 'n4-hosted-1', 'n4-hosted-2'];
      const aloneIds = ['n4-alone-0', 'n4-alone-1'];
      const { unmount } = await mount(
        <View style={{ width: 320 }}>
          <View testID="n4-wrap" style={HUG}>
            <Host style={{ width: 300, height: 200 }}>
              {hostedIds.map((id) => (
                <Toggle key={id} id={id} log={log} />
              ))}
            </Host>
          </View>
          {aloneIds.map((id) => (
            <Toggle key={id} id={id} log={log} />
          ))}
        </View>
      );
      const host = await boxOf('n4-wrap');
      for (const id of [...hostedIds, ...aloneIds]) {
        await boxOf(id);
        // `read` below turns a missing handle into `''`, which is the hosted answer, so
        // every handle has to be there before a probe is read.
        await handleOf(() => log.switches[id], id);
      }
      await settle(400);

      /** Split the probe's answer into its `ever` and `live` halves. */
      const read = (ids: string[]) =>
        ids.map((id) => {
          const line = log.switches[id]?.nuiTestArmedGuards() ?? '';
          const [ever = '', live = ''] = line.split('|live:');
          return { ever, live };
        });
      // Nothing armed, and nothing installed, for a control the Host draws.
      expect(read(hostedIds).map((guards) => guards.ever)).toEqual([
        '',
        '',
        '',
      ]);
      expect(read(hostedIds).map((guards) => guards.live)).toEqual([
        '',
        '',
        '',
      ]);
      // The same control mounted beside the Host armed both. `ever` is about the mount
      // rather than this instant: the first-frame listener unregisters itself once it
      // has marked, so a live-only probe would read empty either way.
      expect(read(aloneIds).map((guards) => guards.ever)).toEqual([
        'strategy,preDraw',
        'strategy,preDraw',
      ]);

      // It stays nothing after the control is used. The press goes to the first row of
      // the column, which is where the Host put `n4-hosted-0`.
      expect(await pressRow(host, 'n4-hosted-0', log)).toBe('n4-hosted-0');
      await settle(300);
      expect(read(hostedIds).map((guards) => guards.ever)).toEqual([
        '',
        '',
        '',
      ]);
      expect(log.acceptedSwitches['n4-hosted-0']).toBe(true);
      unmount();
    });

    /**
     * A control that moves into a Host gives back what its unhosted mount armed, and
     * takes it back when it moves out. RN's flattening decides who the Host's native
     * child is, so a wrapper that starts or stops owning a view moves the control
     * (`Reparenter`). Only the `live` half sees the release: an arming that was given
     * back still happened.
     */
    it('gives back its own guards when flattening moves a live control into a Host', async () => {
      const id = 'move-in-0';
      const { unmount } = await mount(
        <View style={{ width: 320 }}>
          <View testID="move-wrap" style={HUG}>
            <Host style={{ width: 300, height: 120 }}>
              <Reparenter log={log} initiallyOwnsAView>
                <Toggle id={id} log={log} />
              </Reparenter>
            </Host>
          </View>
        </View>
      );
      /** Split the probe's answer into its `ever` and `live` halves. */
      const guards = () => {
        const line = log.switches[id]?.nuiTestArmedGuards() ?? '';
        const [ever = '', live = ''] = line.split('|live:');
        return { ever, live };
      };
      // Step 1: the wrapper owns a view, so the Switch armed both guards for its own
      // composition and still holds the strategy.
      await boxOf(id);
      await handleOf(() => log.switches[id], id);
      await settle(600);
      expect(guards().ever).toBe('strategy,preDraw');
      expect(guards().live).toBe('strategy');
      expect(await pressRow(await boxOf('move-wrap'), id, log)).toBe(id);
      expect(log.acceptedSwitches[id]).toBe(true);

      // Step 2: make the wrapper layout-only and RN's differ reparents the Switch's
      // view into the Host's group, which composes it. Its own composition is disposed,
      // and the activity lifecycle observer has to go with it.
      log.setWrapperDraws?.(false);
      await settle(900);
      expect(guards().ever).toBe('strategy,preDraw');
      expect(guards().live).toBe('');

      // The Host's composition draws it now, so the column's first row answers.
      expect(await pressRow(await boxOf('move-wrap'), id, log)).toBe(id);
      expect(log.acceptedSwitches[id]).toBe(false);

      // Step 3: un-flattening the wrapper moves the control out again, and the strategy
      // has to be re-armed. The first-frame listener stays unarmed, because this mount
      // has already marked a frame.
      log.setWrapperDraws?.(true);
      await settle(900);
      expect(guards().live).toBe('strategy');
      expect(await pressRow(await boxOf('move-wrap'), id, log)).toBe(id);
      expect(log.acceptedSwitches[id]).toBe(true);
      unmount();
    });

    /**
     * A hosted Slider answers the platform's own adjustable action. The node that
     * publishes `SetProgress` lives in the Host's Compose view, so the probe starts
     * there. The announcement Compose sends for the change also leaves through the
     * Host's view, and the platform throws `IllegalStateException: Accessibility off`
     * if that is sent while accessibility is off.
     */
    it('lets a screen reader step a hosted Slider through the Host composition', async () => {
      const { unmount } = await mount(
        <View testID="a11y-slide-wrap" style={HUG}>
          <Host style={{ width: 300, height: 120 }}>
            <Slide
              id="a11y-slide"
              log={log}
              minimumValue={0}
              maximumValue={12}
              step={3}
              defaultValue={3}
            />
          </Host>
        </View>
      );
      await boxOf('a11y-slide');
      const handle = await handleOf(
        () => log.sliders['a11y-slide'],
        'a11y-slide'
      );

      handle.nuiTestAccessibilityStep(1);
      await settle(700);
      const report = handle.nuiTestAccessibilityStepReport();
      // Performed on the real node: the report says which action it found.
      expect(report).toContain('performed SetProgress');
      // One stride up from 3 on `0…12 step 3` is 6.
      expect(log.acceptedSliders['a11y-slide']).toBe(6);
      expect(handle.value).toBe(6);
      unmount();
    });
  });

  // Each case mounts one fixture, probes it, and unmounts before the next: two fixtures
  // sharing the screen share coordinates, so a press would answer for whichever Compose
  // view is on top.
  describe('Host · sizing rules per control (D24)', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    /**
     * Mount one `Slide` in a Host, tap the track at an x offset, and report the value
     * the tap produced (or `null` for nothing answering). M3 turns the tap's position
     * into a fraction of the width the track was laid out at, so the same offset is
     * worth different values in a wide Host and a narrow one.
     */
    async function tapSlider(options: {
      testId: string;
      hostStyle: ViewStyle;
      childStyle?: ViewStyle;
      offsetX: number;
      offsetY?: number;
    }) {
      const { testId, hostStyle, childStyle, offsetX } = options;
      const id = `${testId}-slide`;
      const { unmount } = await mount(
        <View testID={testId} style={HUG}>
          <Host style={hostStyle}>
            <Slide
              id={id}
              log={log}
              minimumValue={0}
              maximumValue={100}
              defaultValue={0}
              style={childStyle}
            />
          </Host>
        </View>
      );
      const box = await boxOf(testId);
      const answered = await probeIn(
        box,
        offsetX,
        options.offsetY ?? 24,
        [id],
        log
      );
      const value = answered == null ? null : (log.acceptedSliders[id] ?? null);
      unmount();
      return { box, value };
    }

    it('stretches a hosted Slider across the Host box, not its own style width', async () => {
      // Same child, same `width: 60`, two Host widths. A Slider that honoured its own
      // style would answer with the same value at the same offset in both.
      const wide = await tapSlider({
        testId: 'wide-slider',
        hostStyle: { width: 260, height: 120 },
        childStyle: { width: 60 },
        offsetX: 50,
      });
      const narrow = await tapSlider({
        testId: 'narrow-slider',
        hostStyle: { width: 100, height: 120 },
        childStyle: { width: 60 },
        offsetX: 50,
      });
      // Both taps landed on a track (a Host that drew nothing answers `null`).
      expect(wide.value).not.toBeNull();
      expect(narrow.value).not.toBeNull();
      expect([
        Math.round(wide.box.width),
        Math.round(narrow.box.width),
      ]).toEqual([260, 100]);
      // 50 dp is a small fraction of a 260 dp track and about half of a 100 dp one. The
      // exact value depends on M3's thumb inset, so only the ordering is asserted.
      expect(wide.value!).toBeLessThan(35);
      expect(narrow.value!).toBeGreaterThan(35);
      expect(narrow.value! - wide.value!).toBeGreaterThan(15);

      // The reach: 240 dp is inside a 260 dp Host and past where a 60 dp-wide control
      // would have ended long ago. A value near the maximum says the track runs the
      // Host's width.
      const far = await tapSlider({
        testId: 'wide-slider-far',
        hostStyle: { width: 260, height: 120 },
        childStyle: { width: 60 },
        offsetX: 240,
      });
      expect(far.value).not.toBeNull();
      expect(far.value!).toBeGreaterThan(90);

      // The child's own style does not matter: no style at all answers the same value
      // at the same offset in the same Host.
      const unstyled = await tapSlider({
        testId: 'wide-slider-unstyled',
        hostStyle: { width: 260, height: 120 },
        offsetX: 50,
      });
      expect(Math.round(unstyled.value! * 10)).toBe(
        Math.round(wide.value! * 10)
      );
    });

    // `nuiTestDrag` drives the Slider's model directly, so it cannot show that the
    // Host's composition received `enabled` or redrew the old value. A tap can: M3
    // turns a press on the track into a value inside that composition, or refuses it.
    it('asks the composition, not the model, whether a hosted Slider is enabled', async () => {
      const id = 'tap-slide-0';
      const { unmount } = await mount(
        <View testID="tap-slide-host" style={HUG}>
          <Host style={{ width: 300, height: 120 }}>
            <EnableableSlide id={id} log={log} initiallyDisabled />
          </Host>
        </View>
      );
      const box = await boxOf('tap-slide-host');
      // A disabled M3 Slider refuses the press. The same press at the same offset
      // answers once the prop changes, so the refusal was the control's and not a Host
      // drawing nothing.
      expect(await probeIn(box, 200, 24, [id], log)).toBeNull();
      expect(log.slides.filter((event) => event.id === id)).toHaveLength(0);

      log.setSliderDisabled?.(false);
      await settle(500);
      expect(await probeIn(box, 200, 24, [id], log)).toBe(id);
      const asked = log.slides
        .filter((event) => event.id === id)
        .map((event) => event.value);
      expect(asked.length).toBeGreaterThan(0);
      // 200 of a 300 dp Host: the value the composition was laid out to answer, not the
      // child's own style width.
      expect(Math.max(...asked)).toBeGreaterThan(0.3);
      expect(Math.max(...asked)).toBeLessThan(1);
      unmount();
    });

    it('redraws a refused hosted Slider, proven by the next tap on the track', async () => {
      const id = 'tap-refuse-slide';
      const { unmount } = await mount(
        <View testID="tap-refuse-slider-host" style={HUG}>
          <Host style={{ width: 300, height: 120 }}>
            <Slide
              id={id}
              log={log}
              accept={false}
              minimumValue={0}
              maximumValue={100}
              defaultValue={0}
            />
          </Host>
        </View>
      );
      const box = await boxOf('tap-refuse-slider-host');
      // First tap, near the right end: the app is asked for something near the maximum
      // and refuses, so the composition has to draw 0 again.
      expect(await probeIn(box, 270, 24, [id], log)).toBe(id);
      const first = log.slides.filter((event) => event.id === id);
      expect(first[0]?.kind).toBe('start');
      // The gesture opened at the value it was showing: 0.
      expect(first[0]?.value).toBeCloseTo(0, 1);
      const asked = first.map((event) => event.value);
      expect(Math.max(...asked)).toBeGreaterThan(60);
      expect(log.acceptedSliders[id]).toBeUndefined();

      // Second tap, further left. `onSlidingStart` reports what the control showed when
      // the gesture opened, which is the drawing's own answer to "did the refused value
      // go back?" — a composition still showing ~90 would open this gesture at ~90.
      log.slides.length = 0;
      expect(await probeIn(box, 60, 24, [id], log)).toBe(id);
      const second = log.slides.filter((event) => event.id === id);
      expect(second[0]?.kind).toBe('start');
      expect(second[0]?.value ?? 100).toBeLessThan(10);
      unmount();
    });

    /** Mount one `Press` in a 260 dp Host and report which x offsets answered. */
    async function sweepButton(options: {
      testId: string;
      title: string;
      childStyle?: ViewStyle;
      offsets: number[];
    }) {
      const { testId, title, childStyle, offsets } = options;
      const id = `${testId}-btn`;
      const { unmount } = await mount(
        <View testID={testId} style={HUG}>
          <Host style={{ width: 260, height: 120 }}>
            <Press id={id} log={log} title={title} style={childStyle} />
          </Host>
        </View>
      );
      const box = await boxOf(testId);
      const answered: number[] = [];
      for (const offset of offsets) {
        if ((await probeIn(box, offset, 22, [id], log)) != null) {
          answered.push(offset);
        }
      }
      unmount();
      return { box, answered };
    }

    it('keeps a hosted Button its own width at the column leading edge', async () => {
      const offsets = [12, 60, 120, 200, 250];
      const short = await sweepButton({
        testId: 'short-btn',
        title: 'Go',
        offsets,
      });
      const long = await sweepButton({
        testId: 'long-btn',
        title: 'Roll back the release',
        offsets,
      });
      const styled = await sweepButton({
        testId: 'styled-btn',
        title: 'Go',
        childStyle: { width: 220, height: 120 },
        offsets,
      });

      // Both start at the leading edge: the column puts an intrinsic control at its
      // leading edge, not centred in the Host's box.
      expect(short.answered[0]).toBe(12);
      expect(long.answered[0]).toBe(12);
      // Neither reaches 250 dp of a 260 dp Host: a Button does not stretch to fill.
      expect(short.answered).not.toContain(250);
      expect(long.answered).not.toContain(250);
      // The width comes from the *content*: the long title answers for offsets the short
      // one cannot reach, and reaches everything the short one does.
      expect(short.answered.length).toBeGreaterThan(0);
      expect(long.answered.length).toBeGreaterThan(short.answered.length);
      for (const offset of short.answered) {
        expect(long.answered).toContain(offset);
      }
      // A child's own RN frame does not matter: 220 dp of `width` and 120 dp of
      // `height` on the child change nothing about the drawing.
      expect(styled.answered).toEqual(short.answered);
    });
  });
}
