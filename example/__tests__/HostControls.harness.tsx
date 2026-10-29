/**
 * On-device tests for the controls task H2a added to `<Host>`: **Slider, Progress and
 * Button** (H1 shipped Switch, and `Host.harness.tsx` stays the owner of the Switch and
 * of the geometry rules that do not depend on which control is inside).
 *
 * Three jobs, in this file's order.
 *
 * 1. **A hosted control is still that control.** Each of the three gets what its own
 *    unhosted suite gives it, but inside somebody else's composition: the Slider's
 *    controlled handshake (a drag JS refuses snaps back, and the *next* drag starting
 *    from the old value is the evidence, because `nuiTestDrag` begins on what the
 *    control displays), the Progress's drawn value (`nuiTestDisplayedValue` is written
 *    by the drawing code, so it reads the pixels rather than echoing a prop) and its
 *    animation gate, and the Button's `onPress`. Where a claim needs a witness, the
 *    witness is a pair: an enabled control beside the disabled one that was just
 *    pressed, an indeterminate indicator beside a determinate one. A Host that composed
 *    nothing would answer "no event" and "displayed=0" forever, and the pairs are what
 *    stop those answers reading green.
 * 2. **D24, per control.** `docs/architecture/sizing.md` §10 now states what each
 *    control's sizing policy means inside a Host's `Column`, and the cases below
 *    measure it: a hosted Slider's track spans the **Host's** inner width — proved by
 *    the *value* one absolute offset produces in a wide Host versus a narrow one, not by
 *    a pixel count — and a hosted Button stays **its own width** at the column's leading
 *    edge, proved by a short title and a long one answering different x offsets in the
 *    same 260 dp Host. A hosted child's own `style` appears in neither answer, which the
 *    third pair pins down.
 * 3. **N4 (H1's review).** A hosted child builds no composition of its own, so it must
 *    arm neither a lifecycle observer nor a first-frame pre-draw listener for one.
 *    `nuiTestArmedGuards()` is read from a hosted Switch and an unhosted one in the same
 *    render, because the comparison is the claim.
 *
 * The mixed cases (four kinds of control, one Host) run on **both** platforms: on iOS a
 * Host is the documented passthrough `View`, so this file is also the iOS regression
 * proving that adding three controls to the allowlist changed nothing there.
 */
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

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back, per control. Declared here rather than imported:
 * DECISIONS D14 keeps Hybrid View types off the public surface, and the only reason to
 * read one is a test seam — what a *hosted* control displays, and what its own view has
 * armed.
 */
type SliderHandle = {
  readonly value: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
  nuiTestAccessibilityStep(direction: number): void;
  nuiTestAccessibilityStepReport(): string;
  nuiTestFramePumpArmed(): boolean;
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
/**
 * The three H2b controls, as far as these mixed cases need them: enough to say each one
 * is *live* inside a Host of seven, and — for the two that open windows — enough to read
 * the process-wide count that says nothing was left behind.
 */
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
   *
   * One list rather than one per control because a press has to answer for *all* of
   * them: two entries for one press is two hosted controls claiming one touch.
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
   * Disable one date row by id.
   *
   * The only lever an app has for taking a dialog it opened back off the screen:
   * `nuiTestPresent()` presents, like the field's press does, and a harness press cannot
   * reach the dialog's own window. A disabled control does not keep a window open
   * (`HybridNitroUiDatePicker.afterUpdate`), which is the rule this suite relies on to
   * leave the process-wide count clean for the next case.
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
 * box. RN stretches a childless-axis `View` to its parent instead, which would report
 * the screen (`Host.harness` has the same helper for the same reason).
 */
const HUG: ViewStyle = { alignSelf: 'flex-start' };

function settle(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll for a `testID` and hand back its box. `screen.findByTestId` has no timeout, and a
 * hosted control mounts through the Host's composition — slower than the single pass the
 * harness makes, on a loaded machine.
 */
async function boxOf(testId: string, timeoutMs = 15000): Promise<ViewInfo> {
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
    await settle(50);
  }
}

async function mount(ui: Parameters<typeof render>[0], timeoutMs = 30000) {
  return await render(ui, { timeout: timeoutMs });
}

/**
 * Press at an absolute point and report which control answered, or `null`.
 *
 * "Answered" is an event reaching JS from one of `allowed`. On Android a hosted control
 * declines to measure, so *at mount* its own view is laid out at `0 x 0` and is neither a
 * hit target nor visible-to-user: the only way an answer can arrive is through the Host's
 * composition, which is the property under test rather than an assumption. Mount is the
 * whole sentence, though - a later layout pass over that child writes its Yoga frame into
 * the view, and that frame is never the rect Compose drew (`docs/components/host.md`,
 * F8), so a press aimed at a hosted child's own box is aimed at a rectangle drawn around
 * the drawing rather than at the drawing. Two answers for one press fails on its own
 * (overlapping hit areas between hosted children).
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
 * Where the first row of a Host is pressable on each platform.
 *
 * Android: inside the Host at the column's leading edge, so the press travels through
 * the Host's `AndroidComposeView`. iOS: the passthrough lays children out as RN views,
 * so the control's own box is the honest target — and its *centre*, because the RN
 * instance stretches across the Host while the SwiftUI control inside it is intrinsic and
 * centred. (Measured on the iOS simulator with a `12 dp`-from-the-left press: a hosted Switch,
 * whose instance hugs the control at 61 x 28, answered; a hosted Button, whose instance
 * stretches and whose button does not, answered for nothing.) Two answers, one question,
 * and the difference is the documented behaviour (`Host.harness` explains the same split).
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
 * Wait for the drawing to say `expected`.
 *
 * `nuiTestDisplayedValue` starts at `displayed=none` and is written by the drawing
 * code, so polling it is the only way to see a commit reach the pixels. Progress.harness
 * polls the same seam for the same reason; a single read after a fixed sleep would
 * measure the machine rather than the control.
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
 * A controlled Slider the test drives, wired to the log.
 *
 * It holds its own state, so a JS write is a real React state change and a refused drag
 * is a real refusal. `accept: false` is the snap-back fixture: the event reaches JS, the
 * state does not move, and native has to put the thumb back.
 */
/**
 * Poll a hosted DatePicker's report until `ready` is happy, and hand back what it saw.
 *
 * Field 1 of the report is `presented` and field 4 is `livePresentations`. Both, not the
 * first: `presented` is model state and lands with the props batch, while the dialog's
 * window goes when Compose disposes it, a frame or two later. Reading the count the
 * moment the flag lands measures a window that is already on its way out - measured in
 * `HostPopups.harness.tsx`, where the same pair is waited on the same way.
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
    // One answer per gesture, counted on the event that opens it. A Slider's contract is
    // start -> change* -> complete, so counting both ends would report two answers for
    // one press, and `probeAt` reads two answers as two controls claiming one touch.
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
      hybridRef={(view: SliderHandle) => {
        log.sliders[id] = view;
      }}
      onSlidingStart={record('start')}
      onValueChange={record('change')}
      onSlidingComplete={(next) => {
        record('complete')(next);
        if (accept) {
          // Only an accepted value is recorded as accepted: the snap-back fixture is
          // the same component with `accept: false`, and "the app never agreed" has to
          // be visible in the log as an absence.
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
      hybridRef={(view: ProgressHandle) => {
        log.bars[id] = view;
      }}
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
      hybridRef={(view: ButtonHandle) => {
        log.buttons[id] = view;
      }}
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
 * A wrapper whose `View` the test can make layout-only after mount.
 *
 * RN collapses a layout-only `View` out of the native tree and attaches its children to
 * the nearest view-owning ancestor, so what the *Host* sees as its child changes when
 * the wrapper starts or stops owning a view - and RN's differ moves the control's own
 * view between the two parents, same instance, without JS remounting anything. JS cannot
 * see the flip (the Host's child is a component either way), which is what makes this the
 * ordinary way an app moves a *mounted* control into or out of a Host (review S2).
 *
 * Measured, because "it has a style" is not enough: a wrapper with only a
 * `backgroundColor` stayed flattened (the control inside it was hosted from the first
 * frame), while a wrapper that also clips and sizes itself owns a view (the control
 * inside it armed its own guards). Both halves of the flip were read on the device
 * before this fixture was relied on.
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

/** A hosted (or plain) Switch, as `Host.harness` wires one, plus the N4 probe. */
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
      hybridRef={(view: SwitchHandle) => {
        log.switches[id] = view;
      }}
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
      hybridRef={(view: SegmentHandle) => {
        log.segments[id] = view;
      }}
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
      hybridRef={(view: PickerHandle) => {
        log.pickers[id] = view;
      }}
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
      hybridRef={(view: DateHandle) => {
        log.dates[id] = view;
      }}
      onChange={setDate}
    />
  );
}

/**
 * One Host whose children are named by `ids`, each id's *suffix* choosing the control.
 *
 * An id is `mix-<kind>-<n>`: `sw` a Switch, `btn` a Button, `sl` a Slider, `pr` a
 * Progress, and — since H2b — `seg` a SegmentedControl, `pk` a Picker, `dp` a DatePicker.
 * Naming the control in the id is what lets an order assertion say what the app asked for
 * rather than what a fixture happened to build, and lets a reordering test move children
 * without moving kinds.
 *
 * Only the Switch and the Button answer a *press* on both platforms (a Progress has no
 * press target, and a Slider needs a tap that lands on its track), so the order sweeps
 * below read the Switch/Button bands and leave the rest to their own cases.
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
    log.sliders[id]?.nuiTestDrag(to, steps, msPerStep);
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
    expect(log.sliders['slide-0']).toBeDefined();

    await drag('slide-0', 0.75);
    const kinds = kindsFor('slide-0');
    // One start, one complete, at least one change between them, in that order: the
    // three-callback contract of `docs/architecture/core.md` §11, inside a composition
    // this control does not own.
    expect(kinds[0]).toBe('start');
    expect(kinds[kinds.length - 1]).toBe('complete');
    expect(kinds.filter((kind) => kind === 'start')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'complete')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'change').length).toBeGreaterThan(0);
    expect(slidesFor('slide-0')[0]?.value).toBeCloseTo(0, 5);
    expect(log.acceptedSliders['slide-0']).toBeCloseTo(0.75, 2);
    expect(log.sliders['slide-0']?.value).toBeCloseTo(0.75, 2);
    // A drag that ended must not leave its frame pump running: nothing else can see a
    // pump that outlived its drag, and inside a shared composition it would be burning
    // frames for a control nobody is touching.
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

    // The model's own account of what it shows: `runTestDrag` starts from
    // `model.displayed`, which is the field the drawing is driven from rather than a
    // reading of the drawing (review M3). A hosted Slider whose model had kept 0.8 would
    // start this drag at 0.8, and that is all this can show — whether the *composition*
    // snapped its thumb back is gated by a tap, in the D24 suite below.
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
    log.writeSlider['write-slide-0']?.(0.4);
    await settle(500);
    // A handle is the model's last JS prop, not what is drawn: a Host whose composition
    // never recomposed would read 0.4 here too. The next drag narrows it to the model's
    // displayed value — still a model field, not the drawing (review M3), which is what
    // the tap case in the D24 suite below is for.
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
    expect(log.sliders['disabled-slide-0']?.disabled).toBe(true);
    await drag('disabled-slide-0', 0.6);
    expect(log.slides).toHaveLength(0);

    // The witness: the same seam, the same drag, one prop different. Without this, "no
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
    const handle = log.bars['bar-0'];
    expect(handle).toBeDefined();
    // The mount write reached the drawing (this is the witness that the reader reads
    // *something* — a control that never drew would answer `displayed=none` forever).
    await waitForDisplayed(handle!, 'displayed=0.25');

    log.writeProgress['bar-0']?.(0.75);
    await waitForDisplayed(handle!, 'displayed=0.75');
    // The handle agrees, and that is the weak half kept only to say the two readings
    // are of one control: the report above is what the drawing wrote, the prop below is
    // what JS last sent. A commit that stored without repainting fails the line above.
    expect(handle!.value).toBe(0.75);
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
    const spinning = log.bars['anim-indeterminate'];
    const still = log.bars['anim-determinate'];
    expect(spinning).toBeDefined();
    expect(still).toBeDefined();
    // The pair is in one Host: the same composition keeps one indicator animating and
    // does not animate the other, so "the animation gate survived hosting" cannot be a
    // reading of a composition that never started.
    expect(spinning!.nuiTestIsAnimating()).toBe(true);
    expect(still!.nuiTestIsAnimating()).toBe(false);
    await waitForDisplayed(spinning!, 'displayed=indeterminate');

    // Same instance, one prop different: giving the spinning bar a value has to stop it,
    // which is the animation gate answering inside the shared composition rather than
    // only at its own view's attach.
    log.writeProgress['anim-indeterminate']?.(0.2);
    await waitForDisplayed(spinning!, 'displayed=0.2');
    expect(spinning!.nuiTestIsAnimating()).toBe(false);
    unmount();
  });

  it('leaves a hosted circular Progress alone to size itself', async () => {
    // The variant that is `intrinsic` both ways: it has no width to fill, so the Host
    // must not stretch it. The measurement of that is the accessibility tree (the
    // `hosted-mixed` case in `scripts/real-input/android.mjs`), because a Progress has
    // no press target to aim a probe at; what this case can prove on the harness side is
    // that the variant that fills and the variant that does not coexist in one
    // composition and both draw.
    const { unmount } = await mount(
      <View testID="circle-host" style={HUG}>
        <Host style={{ width: 260, height: 140 }}>
          <Bar id="circle-0" log={log} variant="circular" initialValue={0.5} />
          <Bar id="circle-1" log={log} variant="linear" initialValue={0.5} />
        </Host>
      </View>
    );
    await boxOf('circle-1');
    await waitForDisplayed(log.bars['circle-0']!, 'displayed=0.5');
    await waitForDisplayed(log.bars['circle-1']!, 'displayed=0.5');
    unmount();
  });
});

/**
 * A hosted Button's press, where a harness tap can reach one.
 *
 * `Button.harness` documents the asymmetry (G2, `docs/tasks/G2-button.report.md`): the
 * harness synthesises a `UITouch` with no HID event behind it, RN's own touch handler and
 * SwiftUI's `Toggle` both accept that, and SwiftUI's `Button` gesture environment refuses
 * it - on iOS, for every button style, hosted or not. So three cases run on Android, and
 * the case below keeps the iOS half honest; the real tap on a hosted Button is proved by
 * the real-input suite (`hosted-button`), where the input is injected at HID level.
 */
describe('Host · a hosted Button still presses', () => {
  let log: Log;
  beforeEach(() => {
    log = newLog();
  });

  /**
   * What a hosted Button keeps even where no harness touch can reach it: its props.
   *
   * The drawing is Compose's/SwiftUI's, but the state a hosted control answers with has to
   * come from JS - so a `disabled` flip and the title have to arrive with no view of its
   * own to store them in. A Host that composed the child once and stopped would show a
   * stale `disabled` here, which is a Button that fires `onPress` when the app said not to.
   */
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
    expect(log.buttons['props-press-0']?.title).toBe('Deploy');
    expect(log.buttons['props-press-0']?.disabled).toBe(true);

    log.setButtonDisabled?.(false);
    await settle(500);
    expect(log.buttons['props-press-0']?.disabled).toBe(false);
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
      expect(log.buttons['off-press-0']?.disabled).toBe(true);
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
      // Two rows, two Buttons, each answering for its own band, in mount order. `probeAt`
      // already fails the run if any single tap produced two events, so what this line
      // adds is that both bands exist and neither swallowed the other.
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
    // Every child is mounted *and hosted*: `boxOf` throws if an id resolves to nothing,
    // and on Android a hosted child's own box is `0 x 0`, so the four queries below are
    // also the statement that all four are inside the Host rather than beside it.
    for (const id of MIXED) {
      await boxOf(id);
    }

    // Switch: a real press, answered.
    expect(await pressRow(host, 'mix-sw-0', log)).toBe('mix-sw-0');
    expect(log.acceptedSwitches['mix-sw-0']).toBe(true);

    // Slider: a drag through the interaction pipeline, answered with a value.
    log.sliders['mix-sl-2']?.nuiTestDrag(0.6, 4, 0);
    await settle(700);
    expect(log.acceptedSliders['mix-sl-2']).toBeCloseTo(0.6, 2);

    // Progress: the drawing reports the value JS set.
    await waitForDisplayed(log.bars['mix-pr-3']!, 'displayed=0.25');

    // Button: a real press, answered — and it has to be *reachable*, not merely
    // pressable-in-principle. Android aims inside the Host at the rows Compose placed;
    // iOS aims at the child's own centre, which is where the passthrough draws it.
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
      // And every answer came from a control in this Host: a stray press reaching a
      // fixture another test left mounted would show up here.
      expect(new Set(seen).size).toBeGreaterThan(0);
      for (const hit of seen) {
        expect(MIXED).toContain(hit);
      }
    } else {
      // iOS reaches no SwiftUI `Button` with a harness touch (`Button.harness`, G2), so
      // this half of the mixed batch is read where it can be: the Button's props arrived
      // at the control the Host is drawing. The press is `hosted-button`'s job.
      expect(log.buttons['mix-btn-1']?.title).toBe('Go 1');
      expect(log.buttons['mix-btn-1']?.disabled).toBe(false);
    }
    unmount();
  });

  if (Platform.OS === 'android') {
    /**
     * Sweep the Host's column and report which pressable child answered each band.
     *
     * Sequential within one mount, one press per offset, and the answer list collapses
     * repeats: the row pitch is Compose's business, so the claim is "the first pressable
     * child is answered before the second", not a y coordinate.
     */
    async function sweepOrder(box: ViewInfo, ids: string[]) {
      const allowed = [
        ...tappableOf(ids),
        ...ids.filter((id) => id.includes('-sl-')),
      ];
      const seen: string[] = [];
      // 16 dp leaves every row of a 320 dp column reachable (the shortest row here is a
      // Progress track, comfortably taller than the stride) while keeping a sweep to two
      // dozen presses — four sweeps of the old 8 dp stride did not fit the 30 s budget.
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

      // Reorder: the Button moves above the Switch, the Slider and Progress stay where
      // they are relative to it. On Android this is the per-child `key(child)` scope in
      // the Host's Column, so the drawing has to follow the child list, not the mount.
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
      // first answer must be it (a Host that kept the old composition answers `mix-sw-0`).
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
      // D24's other half for the three new controls. `Host.harness` proves it for eight
      // Switches; Slider and Progress are the controls that *would* be a different story
      // — both are `fillWidth`, so an implementation that let a hosted child measure its
      // own box would report a size here and the counters would move.
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

      // Same four controls, no Host: the positive control that these counters could
      // have moved at all.
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
      // What hosting does *not* change: Fabric still asks each child's Yoga node once,
      // hosted or not, so four children is four measure calls either way. "Hosted
      // controls never measure" is a sentence about content, and this is the line
      // between that claim and a false one.
      expect(hostedDelta.measurements).toBe(MIXED.length);
      // Unhosted is "at least one each", not the same number: a `fillWidth` control can
      // be asked twice when its honest answer overruns the box (the second pass in
      // `docs/architecture/sizing.md`), and this batch holds two of them. What the pair
      // has to show is that hosting asks no *fewer* questions.
      expect(plainDelta.measurements).toBeGreaterThanOrEqual(MIXED.length);
      // And the witness that the reporting counters were live to be moved.
      expect(plainDelta.reports).toBeGreaterThan(0);
    });
  }
});

/**
 * Every control the library ships, in one Host (H2b).
 *
 * H2a's mixed cases above sweep presses down a four-control column, which is the right
 * instrument for press *order* and the wrong one for the two controls that open a window:
 * a menu opened mid-sweep puts a second window in front of the rows the sweep is aiming
 * at. So this case asks each of the seven what its own suite asks it — a drag, a drawn
 * value, a press, a choice, an open window — and the popup rows contribute that they
 * recompose with the rest and leave nothing behind. The popup geometry itself, and the
 * remove/reorder/drop-the-Host-while-a-window-is-open cases, are
 * `HostPopups.harness.tsx`'s.
 *
 * Runs on both platforms: on iOS a Host is the passthrough, so this is also the
 * regression that says adding three controls to the allowlist changed nothing there.
 */
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
    // All seven are mounted, and on Android all seven are *hosted*: a hosted child
    // declines to measure, so its own view is `0 x 0`. One left out of the allowlist
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
    log.sliders['mix-sl-1']?.nuiTestDrag(0.6, 4, 0);
    await settle(700);
    expect(log.acceptedSliders['mix-sl-1']).toBeCloseTo(0.6, 2);

    // Progress: the drawing reports the value JS set (0.25 is this Bar's own seed).
    await waitForDisplayed(log.bars['mix-pr-2']!, 'displayed=0.25');

    // Button: its props are on the control the Host is drawing.
    expect(log.buttons['mix-btn-3']?.title).toBe('Go 3');

    // SegmentedControl: the value React holds is on the hosted control.
    expect(log.segments['mix-seg-4']?.selectedIndex).toBe(0);
    expect(log.segments['mix-seg-4']?.options.length).toBe(3);
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
    expect(log.pickers['mix-pk-5']?.options.length).toBe(3);
    expect(log.dates['mix-dp-6']?.mode).toBe('date');
    if (Platform.OS !== 'android') {
      // A SwiftUI `Picker` keeps its menu in the system's own presentation and reports
      // nothing about it, and the dialog below is Material 3's, so there is no window to
      // read on the platform where a Host is a passthrough anyway (D23).
      return;
    }
    // Picker: a choice reaches JS from inside somebody else's composition, and the
    // process-wide menu count is back at 0 because no window of this mount is open.
    const picker = log.pickers['mix-pk-5'];
    expect(picker).toBeDefined();
    picker?.nuiTestSelect(2);
    await settle(500);
    expect(log.acceptedPickers['mix-pk-5']).toBe(2);
    expect(picker?.nuiTestMenuReport()).toContain('live=0');

    // DatePicker: it presents a dialog from the Host's composition, and an app-side
    // write takes it down again. Pressing the field is an open and never a close - the
    // harness hook goes through the same entry, so it cannot dismiss the dialog either -
    // which leaves disabling the control as the way to prove the window is the Host's to
    // lose. Read as a pair (`presented` and `livePresentations`) for the reason on
    // `waitDate`, and left at zero so the next case does not read this one as a leak.
    const date = log.dates['mix-dp-6'];
    expect(date).toBeDefined();
    date!.nuiTestPresent();
    const shown = await waitDate(
      date!,
      (r) => r.presented && r.live === 1,
      "the dialog composed by the Host's composition"
    );
    expect(shown.presented).toBe(true);
    log.disableDate['mix-dp-6']?.(true);
    const hidden = await waitDate(
      date!,
      (r) => !r.presented && r.live === 0,
      'the dialog taken down by disabling the control'
    );
    expect(hidden.presented).toBe(false);
    log.disableDate['mix-dp-6']?.(false);
  });
});

// MARK: - Android: what hosting costs, and what D24 means per control

if (Platform.OS === 'android') {
  /**
   * N4 (H1's review): a hosted child arms nothing for a composition it never builds.
   *
   * `NitroComposeHost` arms two things for a control that owns its composition — a
   * `ViewCompositionStrategy` (which installs an observer on the activity's
   * `LifecycleRegistry`) and a first-frame `OnPreDrawListener`. Both are keyed to *this*
   * view's composition. A hosted child has none, so arming them bought nothing and cost
   * one `LifecycleRegistry` registration per child per mount — which is what a list of
   * hosted controls is made of.
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
      }
      await settle(400);

      /** Split the probe's answer into its `ever` and `live` halves. */
      const read = (ids: string[]) =>
        ids.map((id) => {
          const line = log.switches[id]?.nuiTestArmedGuards() ?? '';
          const [ever = '', live = ''] = line.split('|live:');
          return { ever, live };
        });
      // The claim: nothing armed, and nothing installed, for a control the Host draws.
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
      // The witness that the probe reads a field that really gets written: the same
      // control, mounted beside the Host, armed both of them. The `ever` half is about
      // the mount rather than about this instant on purpose — the first-frame listener
      // unregisters itself once it has marked, so a live-only probe would read `""` for
      // a hosted child whether or not the guard that stops it arming is there. Round 1's
      // mutation proved exactly that: with the guard deleted the test stayed green.
      expect(read(aloneIds).map((guards) => guards.ever)).toEqual([
        'strategy,preDraw',
        'strategy,preDraw',
      ]);

      // And it stays nothing after the control is used: a recomposition of a hosted child
      // must not lazily arm what its attach declined to arm.
      // The press goes to the first row of the column, which is where the Host put
      // `n4-hosted-0`.
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
     * The other half of N4: a control that *moves* into a Host gives back what its
     * unhosted mount armed (`NitroComposeHost.releaseOwnCompositionGuards`), and takes it
     * back again when it moves out.
     *
     * The case above gates `armCompositionStrategy` declining for a child that arrives
     * hosted. This is the transition that finds the guards already armed — reachable
     * without an app doing anything exotic, because RN's flattening (not the app) decides
     * who the Host's native child is, and a wrapper that starts or stops owning a view
     * flips that decision (`Reparenter`).
     *
     * The `ever` half cannot see this release: an arming that was given back still
     * happened. So this reads the `live` half, which is the only witness the release path
     * has — deleting that call is what turns this red (review S2).
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
      // Step 1 — the wrapper owns a view, so the Switch is a control like any other: it
      // armed both guards for its own composition, and still holds the strategy that its
      // composition is installed against. (Measured here: a real 52 x 48 box, and a press
      // that answers.)
      await boxOf(id);
      await settle(600);
      expect(guards().ever).toBe('strategy,preDraw');
      expect(guards().live).toBe('strategy');
      expect(await pressRow(await boxOf('move-wrap'), id, log)).toBe(id);
      expect(log.acceptedSwitches[id]).toBe(true);

      // Step 2 — make the wrapper layout-only and RN's differ reparents the Switch's view
      // into the Host's group, which composes it. Its own composition is disposed, and the
      // strategy — the activity `LifecycleRegistry` observer — has to go with it, or a
      // control that once lived outside a Host keeps an observer for a composition that no
      // longer exists. The `ever` half says the arming happened; the `live` half is what
      // `releaseOwnCompositionGuards()` answers, and is the only witness that path has.
      log.setWrapperDraws?.(false);
      await settle(900);
      expect(guards().ever).toBe('strategy,preDraw');
      expect(guards().live).toBe('');

      // And it is a control in its new home, not a corpse with tidy bookkeeping: the Host's
      // composition draws it, so the column's first row answers — a second time, which says
      // the press reached the same instance rather than a stale handle.
      expect(await pressRow(await boxOf('move-wrap'), id, log)).toBe(id);
      expect(log.acceptedSwitches[id]).toBe(false);

      // Step 3 — the way back. Un-flattening the wrapper moves the control out again, and
      // the arm a hosted attach declined has to run: `strategyArmed` is false, so this is
      // the re-arm. (`watchForFirstFrame` stays declined for this mount, which has already
      // marked a frame.)
      log.setWrapperDraws?.(true);
      await settle(900);
      expect(guards().live).toBe('strategy');
      expect(await pressRow(await boxOf('move-wrap'), id, log)).toBe(id);
      expect(log.acceptedSwitches[id]).toBe(true);
      unmount();
    });

    /**
     * A hosted Slider answers the platform's own adjustable action.
     *
     * The seam (`nuiTestAccessibilityStep`) searches for the semantics node that
     * publishes `SetProgress` — and for a hosted control that node lives in the
     * **Host's** Compose view, so the probe starts there. Two things fail without the
     * work this covers: the search would answer "no Compose root" for a control that is
     * composed perfectly well, and the announcement Compose sends for the semantics
     * change leaves through the *Host's* view, which is where the accessibility-off
     * guard now sits — without it the platform answers
     * `IllegalStateException: Accessibility off. Did you forget to check that?` and the
     * app dies with a hosted Slider in it.
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
      const handle = log.sliders['a11y-slide'];
      expect(handle).toBeDefined();

      handle!.nuiTestAccessibilityStep(1);
      await settle(700);
      const report = handle!.nuiTestAccessibilityStepReport();
      // Performed on the real node, not synthesised by us: the report says which action
      // it found and where it landed.
      expect(report).toContain('performed SetProgress');
      // And the rule under test is the library's, not M3's: one stride up from 3 on
      // `0…12 step 3` is 6.
      expect(log.acceptedSliders['a11y-slide']).toBe(6);
      expect(handle!.value).toBe(6);
      unmount();
    });
  });

  /**
   * D24 per control, measured.
   *
   * `docs/architecture/sizing.md` §10 states the rule; these are the numbers. Each case
   * mounts one fixture, probes it, and unmounts before the next — two fixtures sharing
   * the screen share coordinates, so a press would answer for whichever Compose view is
   * on top rather than for the style under test.
   */
  describe('Host · sizing rules per control (D24)', () => {
    let log: Log;
    beforeEach(() => {
      log = newLog();
    });

    /**
     * Mount one `Slide` in a Host, tap the track at an x offset, and report the value
     * the tap produced (or `null` for nothing answering).
     *
     * The value is the instrument, not a pixel: M3 turns the tap's position into a
     * fraction of *the width it was laid out at*, so the same absolute offset is worth
     * different values in a wide Host and a narrow one. That is the `fillWidth` rule read
     * through the event stream, with no second layout implementation in the test.
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
      // 50 dp is a small fraction of a 260 dp track and about half of a 100 dp one. How
      // large exactly is M3's business (thumb inset), so the assertion is the ordering
      // and a margin far wider than that inset, not two expected numbers.
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

      // And the child's own style is decorative for a `fillWidth` control too: no style
      // at all answers the same value at the same offset in the same Host.
      const unstyled = await tapSlider({
        testId: 'wide-slider-unstyled',
        hostStyle: { width: 260, height: 120 },
        offsetX: 50,
      });
      expect(Math.round(unstyled.value! * 10)).toBe(
        Math.round(wide.value! * 10)
      );
    });

    /**
     * A hosted Slider's `disabled` and its snap-back, read out of the composition.
     *
     * `nuiTestDrag` drives `SliderModel` directly: it refuses on `model.enabled` before
     * Compose is involved and starts from `model.displayed`, a model field rather than the
     * drawing. So the Slider suite's versions of these two cases say the model behaved;
     * they cannot say the Host's shared composition received the `enabled` recomposition
     * or redrew the old value (review M3/S1). A tap can, because M3 turns a press on the
     * track into a value *inside* that composition — or refuses it there.
     */
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
      // 200 dp along the track, twice over: a disabled M3 Slider refuses the press, and
      // the refusal has to be the control's rather than the Host drawing nothing, so the
      // same press at the same offset answers as soon as one prop changes.
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
      // child's own style width (D24) and not a value the test injected.
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
      // Neither reaches 250 dp of a 260 dp Host: a Button does not stretch to fill,
      // which is the `intrinsic` half of the rule.
      expect(short.answered).not.toContain(250);
      expect(long.answered).not.toContain(250);
      // The width comes from the *content*: the long title answers for offsets the short
      // one cannot reach, and reaches everything the short one does.
      expect(short.answered.length).toBeGreaterThan(0);
      expect(long.answered.length).toBeGreaterThan(short.answered.length);
      for (const offset of short.answered) {
        expect(long.answered).toContain(offset);
      }
      // And a child's own RN frame is decorative, exactly as it is for a Switch: 220 dp
      // of `width` and 120 dp of `height` on the child change nothing about the drawing.
      expect(styled.answered).toEqual(short.answered);
    });
  });
}
