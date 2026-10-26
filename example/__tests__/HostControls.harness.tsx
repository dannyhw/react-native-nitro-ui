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
  Host,
  Progress,
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
  /** JS-side writes, so a test can move a control with no touch at all. */
  writeSlider: Record<string, (next: number) => void>;
  writeProgress: Record<string, (next: number | null) => void>;
  writeSwitch: Record<string, (next: boolean) => void>;
  setSliderDisabled?: (next: boolean) => void;
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
 * declines to measure, so its own view is laid out at `0 x 0` and is neither a hit
 * target nor visible-to-user: the only way an answer can arrive is through the Host's
 * composition, which is the property under test rather than an assumption. Two answers
 * for one press fails on its own (overlapping hit areas between hosted children).
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
 * centred. (Measured on iPhone Air with a `12 dp`-from-the-left press: a hosted Switch,
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

/**
 * One Host whose children are named by `ids`, each id's *suffix* choosing the control.
 *
 * An id is `mix-<kind>-<n>`: `sw` a Switch, `btn` a Button, `sl` a Slider, `pr` a
 * Progress. Naming the control in the id is what lets an order assertion say what the app
 * asked for rather than what a fixture happened to build, and lets a reordering test move
 * children without moving kinds.
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

    // The oracle Slider.harness uses, and the only one that does not trust a handle:
    // `nuiTestDrag` begins on the value the control *displays*, so the value this drag
    // starts from is a reading of what Compose drew. A hosted Slider that had shown
    // 0.8 would start this drag at 0.8.
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
    // never recomposed would read 0.4 here too. The next drag is the witness, because
    // it starts from the displayed value.
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
    // must not stretch it. The measurement of that is the accessibility tree (a
    // `hosted-progress` case in `scripts/real-input/android.mjs`), because a Progress has
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

      const read = (ids: string[]) =>
        ids.map((id) => log.switches[id]?.nuiTestArmedGuards());
      // The claim: nothing armed for a control the Host draws.
      expect(read(hostedIds)).toEqual(['', '', '']);
      // The witness that the probe reads a field that really gets written: the same
      // control, mounted beside the Host, armed both of them. The answer is about the
      // mount rather than about this instant on purpose — the first-frame listener
      // unregisters itself once it has marked, so a live-only probe would read `""` for
      // a hosted child whether or not the guard that stops it arming is there. Round 1's
      // mutation proved exactly that: with the guard deleted the test stayed green.
      expect(read(aloneIds)).toEqual([
        'strategy,preDraw',
        'strategy,preDraw',
      ]);

      // And it stays nothing after the control is used: a recomposition of a hosted child
      // must not lazily arm what its attach declined to arm.
      // The press goes to the first row of the column, which is where the Host put
      // `n4-hosted-0`.
      expect(await pressRow(host, 'n4-hosted-0', log)).toBe('n4-hosted-0');
      await settle(300);
      expect(read(hostedIds)).toEqual(['', '', '']);
      expect(log.acceptedSwitches['n4-hosted-0']).toBe(true);
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
