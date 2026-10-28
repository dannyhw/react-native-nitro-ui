/**
 * On-device tests for the Slider (task G1).
 *
 * These run inside the app, so they exercise what no JS test can: SwiftUI `Slider`
 * and Compose Material 3 `Slider` really hosted, the frame coalescer really
 * ticking against real display frames, the event-count handshake really applied to
 * a *continuous* value, and an abandoned drag really not resuming.
 *
 * Two oracles carry most of this suite, because a Slider's contract is about what
 * native displays and no query reads that back:
 *
 * - **the value a drag starts from.** `nuiTestDrag` begins on the displayed value,
 *   so the `onSlidingStart` argument *is* a reading of what the control was
 *   showing. That is what makes a rejected change, an uncontrolled value and a
 *   JS-side write all observable: the next drag reports them.
 * - **how many `onValueChange` events one gesture produced.** With every move
 *   queued inside a single main-thread turn, the coalescer must answer exactly one
 *   event; spread over frames, it must answer several. Both are asserted, so the
 *   first cannot pass because events stopped flowing.
 */
import { useCallback, useState } from 'react';
import {
  Platform,
  processColor,
  ScrollView,
  TurboModuleRegistry,
  View,
} from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import { Slider, nitroUiCore } from 'react-native-nitro-ui';
import { expectTimingBudget } from './timingGate';

/**
 * Bounds of a rendered view, read straight from the harness native module.
 *
 * Same reason Switch has this: `screen.findByTestId` keeps only a native id, and
 * the only way to measure what Fabric laid out is the raw `queryByTestId`.
 */
type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back (see `NitroUiSliderHandle`).
 *
 * Declared here rather than imported: DECISIONS D14 keeps Hybrid View types off
 * the public surface in v0.1, and `nuiTestDrag` is a test seam, not app API.
 */
type SliderHandle = {
  readonly value: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
  /** Perform the platform's a11y increment (>0) / decrement (<0). */
  nuiTestAccessibilityStep(direction: number): void;
  /** What the last accessibility step did, one line. */
  nuiTestAccessibilityStepReport(): string;
  /** Whether the control's frame pump is still armed. */
  nuiTestFramePumpArmed(): boolean;
};

/** Wait for the queued a11y action to have run, then read its report. */
async function accessibilityStepReport(
  handle: SliderHandle,
  direction: number
): Promise<string> {
  handle.nuiTestAccessibilityStep(direction);
  // The action runs in a turn of the UI thread's queue and the report is a plain
  // field written there, so this waits for the report to change rather than for a
  // guessed pause.
  const before = handle.nuiTestAccessibilityStepReport();
  return pollUntil(
    () => {
      const report = handle.nuiTestAccessibilityStepReport();
      return report === before ? null : report;
    },
    () => new Error('The accessibility step probe never reported.'),
    5000
  );
}

/** The report must say the platform's own action ran, not that we gave up. */
function expectPerformed(report: string, what: string): void {
  if (!report.includes('performed ')) {
    // Thrown rather than `expect(...).toMatch`: Jest shortens a long string in a
    // matcher failure, and what the probe walked is the whole diagnosis.
    throw new Error(`${what}: ${report}`);
  }
}

/**
 * The `hybridRef` handles this test rendered, by `testID`.
 *
 * Keyed rather than one module-level variable: a test that renders three Sliders
 * (the step cases) or a control plus a barrier (the disabled case) overwrites a
 * single variable in mount order, and the test then drives whichever control
 * mounted last while asserting on the first one's events. The capture function is
 * memoised per id because it is a callback prop: a fresh closure per render would
 * re-apply the prop (`docs/architecture/core.md` §3).
 */
const handles = new Map<string, SliderHandle>();
const captures = new Map<string, (view: SliderHandle) => void>();

function captureFor(testId: string): (view: SliderHandle) => void {
  const known = captures.get(testId);
  if (known !== undefined) {
    return known;
  }
  const capture = (view: SliderHandle) => {
    handles.set(testId, view);
  };
  captures.set(testId, capture);
  return capture;
}

/** The handle for `testId`, once the view has mounted and handed it over. */
async function handleFor(testId: string): Promise<SliderHandle> {
  return pollUntil(
    () => handles.get(testId) ?? null,
    () => new Error(`No hybrid handle for "${testId}" (did it render?).`)
  );
}

/**
 * The height a Slider is supposed to occupy, per platform (DECISIONS D14).
 *
 * Measured on the devices this task owns, not read out of a spec: the control's
 * own `measureContent()` height and the box Yoga gave it, both platforms, which is
 * also the number the component declares as its sizing fallback. A fixture equal to
 * the declared fallback proves nothing on its own, which is why the sizing test
 * poisons the *cache* with a deliberately wrong height and asserts the correction.
 */
const EXPECTED_HEIGHT = Platform.select({
  // Material 3's `Slider` measures 48 dp tall here. The visible track is a few dp
  // of that; the rest is `minimumInteractiveComponentSize`, the 48 dp touch target
  // Material includes in the control's own box.
  android: 48,
  // SwiftUI's `Slider` on the iOS 26/27 control set, measured on both runtimes.
  default: 31,
})!;

/** This component's key in the sizing engine (matches `Slider.tsx`). */
const COMPONENT = 'NitroUiSlider';
const SIZING_KEY = '';

/**
 * What this platform's `Slider` declares as its width (`FALLBACK_WIDTH_DP` on
 * Android, `fallbackWidth` on iOS), written out rather than read from the engine so
 * a test that seeded over the declaration has to put the real one back.
 *
 * For a `fillWidth` control this is the one declared number that reaches the screen
 * only under an unbounded parent - see `docs/architecture/sizing.md` §5 and row 10
 * of `docs/tasks/FOLLOWUPS.md`. The height side of the declaration is
 * `EXPECTED_HEIGHT` above.
 */
const DECLARED_WIDTH = Platform.select({ android: 328, default: 351 })!;

/** One drag's worth of callback arguments, in the order they arrived. */
type SlideEvents = {
  start: number[];
  change: number[];
  complete: number[];
};

function newEvents(): SlideEvents {
  return { start: [], change: [], complete: [] };
}

/** Wait for a frame or two, without a magic sleep in the middle of an assertion. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a testID to exist and return its box.
 *
 * The Switch suite's reason, unchanged: `screen.findByTestId` has no timeout and a
 * hosted control only becomes queryable after it has mounted, laid out and
 * committed. The deadline is one frame clock (`nitroUiCore.now()`, DECISIONS D1) so
 * every wait in this suite shares the base the native marks use.
 */
async function waitForBox(
  testId: string,
  timeoutMs = 10000
): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
      // Hand back the harness' own reference too, for the press/screenshot helpers.
      await screen.findByTestId(testId);
      return box;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${timeoutMs}ms.`
      );
    }
    await sleep(50);
  }
}

function describeBox(box: ViewInfo | { width: number; height: number } | null) {
  if (box == null) {
    return 'null';
  }
  return `${box.width.toFixed(2)}x${box.height.toFixed(2)}`;
}

/** Wait until `read` answers non-null, or fail with the caller's message. */
async function pollUntil<T>(
  read: () => T | null,
  explain: () => Error,
  timeoutMs = 5000
): Promise<T> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) {
      return value;
    }
    if (nitroUiCore.now() > deadline) {
      throw explain();
    }
    await sleep(25);
  }
}

/**
/**
 * Drive a drag and wait for it to finish.
 *
 * `steps` moves over `msPerStep` each, then release; the seam adds one interval
 * after the last move before it reports the end, so waiting for the complete event
 * (plus a frame) is waiting for the whole gesture.
 *
 * The timeout reports what the gesture produced rather than only "timed out": a
 * drag that emitted changes but no release and a drag that emitted nothing at all
 * are different bugs, and the failure has to tell them apart.
 */
async function drag(
  handle: SliderHandle,
  events: SlideEvents,
  to: number,
  steps: number,
  msPerStep: number
): Promise<void> {
  const completed = events.complete.length;
  const budget = Math.max(3000, msPerStep * (steps + 2) + 1500);
  const deadline = nitroUiCore.now() + budget;
  handle.nuiTestDrag(to, steps, msPerStep);
  for (;;) {
    if (events.complete.length > completed) {
      break;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Drag to ${String(to)} produced no onSlidingComplete in ${String(
          budget
        )}ms (start=${JSON.stringify(events.start)} change=${JSON.stringify(
          events.change
        )} complete=${JSON.stringify(events.complete)}).`
      );
    }
    await sleep(25);
  }
  // One frame past the release, so a late coalesced change (it is emitted before
  // the complete event, but on JS's clock) has had its turn.
  await sleep(60);
}

afterEach(() => {
  cleanup();
  handles.clear();
});

describe('Slider', () => {
  beforeAll(async () => {
    // The Switch suite's warm-up, for the same reason: the first hosted control of
    // a process pays one-time costs (Nitro's first registry call, the first
    // `UIHostingController` / Compose composition) that exceed the harness' mount
    // timeout on a cold emulator. Every test below then measures a steady state.
    const { unmount } = await render(
      <Slider defaultValue={0.5} testID="warm-up" />,
      { timeout: 20000 }
    );
    unmount();
  });

  it('hosts a control, fills the box it is given, and keeps its own height', async () => {
    await render(
      <View style={{ width: 300 }}>
        <Slider defaultValue={0.4} testID="box" hybridRef={captureFor('box')} />
      </View>
    );
    const box = await waitForBox('box');
    const handle = await handleFor('box');
    const content = await pollUntil(
      () => {
        const size = handle.measureContent();
        return size.height > 0 ? size : null;
      },
      () =>
        new Error(
          `Slider never measured (last=${describeBox(handle.measureContent())}).`
        )
    );
    console.log(
      `slider size: box=${describeBox(box)} measured=${describeBox(content)} expectedHeight=${String(EXPECTED_HEIGHT)}`
    );

    // The `fillWidth` contract: the width is the parent's, the height is the
    // control's (`docs/architecture/sizing.md` §5). 300 is what the wrapper asked
    // for and `alignSelf: 'stretch'` is what hands it over.
    expect(Math.abs(box.width - 300)).toBeLessThan(1);
    expect(Math.abs(box.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(content.height - box.height)).toBeLessThan(1);
    expect(Math.abs(content.width - box.width)).toBeLessThan(1);
  });

  it('answers its own height at any width, and ignores a box height that is wrong', async () => {
    // Two properties a `fillWidth` control must keep separate:
    //
    // - the **height does not move with the width** - one cached answer serves
    //   every parent, which is what makes `nuiSizingKey` the empty string and
    //   `prewarm(['NitroUiSlider'])` able to warm the whole component;
    // - the **box cannot contaminate the answer**. A box of the wrong height is
    //   the ordinary state of a first layout (the fallback, a stale cache, a
    //   correction still in flight). If the host measured under the box's height,
    //   the report would agree with the layout, the engine would never be told,
    //   and a wrong height would confirm itself forever - the bug that made the
    //   Android measure unbind its height maximum.
    const contentOf = async (testId: string) => {
      const handle = await handleFor(testId);
      return pollUntil(
        () => {
          const size = handle.measureContent();
          return size.height > 0 ? size : null;
        },
        () => new Error(`${testId} never measured.`)
      );
    };

    // One live tree per test: the first instance is measured and unmounted before
    // the second is rendered. `Sizing.harness.tsx` renders this way throughout,
    // and it is not a style choice - on Android a second `render()` inside one
    // test leaves the *first* control's host unmeasurable (`measureContent()`
    // answers 0x0 for as long as the test then asks it), while iOS happily keeps
    // both trees alive. A suite that compares two live instances therefore passes
    // on iOS and times out on Android. Measuring in sequence asks the same
    // question and answers it on both platforms.
    const wide = await render(
      <View style={{ width: 300 }}>
        <Slider
          defaultValue={0.4}
          testID="wide"
          hybridRef={captureFor('wide')}
        />
      </View>
    );
    const wideBox = await waitForBox('wide');
    const wideContent = await contentOf('wide');
    wide.unmount();

    const narrow = await render(
      <View style={{ width: 180 }}>
        <Slider
          defaultValue={0.4}
          testID="narrow"
          hybridRef={captureFor('narrow')}
        />
      </View>
    );
    const narrowBox = await waitForBox('narrow');
    const narrowContent = await contentOf('narrow');
    console.log(
      `height vs width: wide=${describeBox(wideBox)}/${describeBox(wideContent)} ` +
        `narrow=${describeBox(narrowBox)}/${describeBox(narrowContent)}`
    );
    narrow.unmount();

    // The width is the parent's, and it changed by 120 pt.
    expect(Math.abs(wideBox.width - 300)).toBeLessThan(1);
    expect(Math.abs(narrowBox.width - 180)).toBeLessThan(1);
    // The height is the control's, and it did not move.
    expect(Math.abs(narrowBox.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(narrowContent.height - wideContent.height)).toBeLessThan(
      0.5
    );
    // And the width the control reports for itself is the *new* box, not the one
    // the first instance of this configuration happened to be measured at: a
    // `fillWidth` cache entry's width is a restatement of a parent, so an answer
    // that carried one over would show up here (`sizing.md` §5).
    expect(Math.abs(narrowContent.width - narrowBox.width)).toBeLessThan(1);

    // Now a box that is *wrong* about the height: 12 against a control that is
    // 31/48. The user's style owns the layout, so the box stays 12 - but the
    // control's own answer must still be the truth, or the correction that
    // follows is measuring the box instead of the control.
    const squashed = await render(
      <View style={{ width: 180, height: 12 }}>
        <Slider
          defaultValue={0.4}
          testID="squashed"
          hybridRef={captureFor('squashed')}
        />
      </View>
    );
    const squashedBox = await waitForBox('squashed');
    const squashedContent = await contentOf('squashed');
    console.log(
      `squashed box: box=${describeBox(squashedBox)} ` +
        `measured=${describeBox(squashedContent)}`
    );
    squashed.unmount();

    expect(Math.abs(squashedBox.width - 180)).toBeLessThan(1);
    expect(Math.abs(squashedBox.height - 12)).toBeLessThan(1);
    expect(Math.abs(squashedContent.height - EXPECTED_HEIGHT)).toBeLessThan(1);
  });

  it('answers its own height even when the box has none', async () => {
    // The box can have no height for a perfectly ordinary reason: the caller
    // asked for one (`height: 0`, or a `maxHeight` squashed below the control).
    // Until T14 a cold first instance supplied its own zero as well, because the
    // declared fallback arrived with the view rather than before the first
    // measure. One frame at zero is survivable; what is not survivable is a
    // measure that refuses to *run* until the box has a height,
    // because the report is the only thing that gives the box one. That is a
    // closed loop, and on iOS it was a whole broken screen: every Slider on it
    // drew a ~28 pt thumb at the origin, because a `UIHostingController` whose
    // frame is still `.zero` paints only SwiftUI's minimum content - and the
    // first (zero) answer is what the instances below it were laid out from.
    //
    // So the box owns the layout and nothing else. A `fillWidth` measure needs
    // the box's *width* - the half it may not invent - and must answer the
    // height question whatever the height currently is.
    //
    // A user's `height: 0` reaches the same code, so this is written as the
    // general rule rather than as a cold-mount special case.
    await render(
      <View style={{ width: 180, height: 0 }}>
        <Slider
          defaultValue={0.4}
          testID="flat"
          hybridRef={captureFor('flat')}
        />
      </View>
    );
    const handle = await handleFor('flat');
    const content = await pollUntil(
      () => {
        const size = handle.measureContent();
        return size.height > 0 ? size : null;
      },
      () =>
        new Error(
          `a box with no height stopped the control measuring ` +
            `(last=${describeBox(handle.measureContent())}).`
        )
    );
    console.log(`zero-height box: measured=${describeBox(content)}`);

    expect(Math.abs(content.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    // The width still comes from the box it was given - the half of the
    // question the control may not answer for itself.
    expect(Math.abs(content.width - 180)).toBeLessThan(1);
  });

  it('hands an unbounded parent its declared width, not another instance\u2019s box', async () => {
    // `fillWidth` means the box owns the width, so for most mounts the width the
    // engine holds never reaches the screen - `measureContent` replaces it with the
    // box's (`cpp/NitroUiIntrinsic.hpp:208`). The guard on that replacement is
    // `isfinite`, so there is exactly one case where the cached number *is* what
    // draws: a node Yoga measured with no finite width. A horizontal `ScrollView`
    // is that parent, and it is ordinary app code - the horizontal card row whose
    // rows each carry a Slider.
    //
    // Until F3 the engine filed a report's width, so the first half of this test -
    // a Slider in a 200 dp box - put 200 into the one configuration the scroller
    // then read, and the scroller's Slider drew 200 wide: a width belonging to a
    // different control in a different parent, with nothing able to notice (the
    // unbounded instance's own report agrees by height, which is all the policy
    // compares, so it confirms the stale frame rather than correcting it).
    // `docs/tasks/FOLLOWUPS.md` row 10.
    //
    // The fixture is what makes a wrong fix as visible as the old bug. Seeding
    // 240x12 writes both the cold guess *and* the component's declaration
    // (`seedSizingSize` sets the fallback too), so the honest answer here is 240 -
    // while the bug answers 200 (the other instance's box) and 240 is neither of
    // the numbers the platform really declares (328 dp / 351 pt), so a fix that
    // reached for a hardcoded width goes red too. The 12-high guess is what makes
    // the bounded mount's correction observable at all.
    const GUESSED_WIDTH = 240;
    const BOX_WIDTH = 200;
    // Same poison-then-drop order as the correction test below: seed first, then
    // bump the epoch, so 240x12 is the *guess* a cold mount has to outrank rather
    // than an exact answer for the epoch being measured. Seeding also *is* the
    // component's declaration for the rest of this run, which is what makes the
    // number asserted at the end this test's own.
    const before = nitroUiCore.sizingStats();
    nitroUiCore.seedSizingSize(COMPONENT, SIZING_KEY, GUESSED_WIDTH, 12);
    nitroUiCore.invalidateSizingEnvironment();
    // The drop really happened, so the mounts below are cold and answer the seed.
    expect(nitroUiCore.sizingStats().environmentEpoch).toBe(
      before.environmentEpoch + 1
    );

    // Half one: a bounded instance measures, reports, and is the only thing that
    // could contaminate the configuration's width.
    const bounded = await render(
      <View style={{ width: BOX_WIDTH }}>
        <Slider
          defaultValue={0.4}
          testID="scroller-seed"
          hybridRef={captureFor('scroller-seed')}
        />
      </View>
    );
    const seedBox = await pollUntil(
      () => {
        const box = harnessUi.queryByTestId('scroller-seed');
        return box !== null && Math.abs(box.height - EXPECTED_HEIGHT) < 1
          ? box
          : null;
      },
      () =>
        new Error(
          `the bounded Slider's box never became ${String(
            EXPECTED_HEIGHT
          )} tall (last=${describeBox(
            harnessUi.queryByTestId('scroller-seed')
          )}, guess was ${String(GUESSED_WIDTH)}x12).`
        )
    );
    await handleFor('scroller-seed');
    // What that host measured, read while its tree is still live (Android leaves an
    // earlier `render()`'s host unmeasurable once a second one exists, so this is
    // the only point at which it can be read). It is the box's own 200 - the number
    // that used to land in the configuration the scroller then measured against.
    const seedMeasured = await pollUntil(
      () => {
        const size = handles.get('scroller-seed')!.measureContent();
        return size.height > 0 ? size : null;
      },
      () => new Error('the bounded Slider never measured.')
    );
    expect(Math.abs(seedMeasured.width - BOX_WIDTH)).toBeLessThan(1);
    console.log(
      `unbounded: bounded box=${describeBox(seedBox)} measured=${describeBox(
        seedMeasured
      )}`
    );
    bounded.unmount();
    // The box was 200 wide, so 200 is what the host measured and reported - the
    // number the fix keeps out of the configuration.
    expect(Math.abs(seedBox.width - BOX_WIDTH)).toBeLessThan(1);

    // Half two: the same configuration, in a parent with no width to give.
    await render(
      <ScrollView horizontal>
        <Slider
          defaultValue={0.4}
          testID="unbounded"
          hybridRef={captureFor('unbounded')}
        />
      </ScrollView>
    );
    const unboundedContent = await pollUntil(
      () => {
        const size = handles.get('unbounded')!.measureContent();
        return size.width > 0 && size.height > 0 ? size : null;
      },
      () => new Error('the unbounded Slider never measured.')
    );
    // The claim is only ever about the width, so the width is what is waited for;
    // the height travels with it, and the box is polled to agree rather than being
    // pinned. (Pinning it through the scroller's own style was tried first and does
    // not pin the child on Android: a horizontal scroller stretches its children
    // along the cross axis, and the box came back 923 tall - a true fact about
    // `ScrollView`, and nothing to do with the engine.)
    const unboundedBox = await pollUntil(
      () => {
        const box = harnessUi.queryByTestId('unbounded');
        return box !== null && Math.abs(box.width - GUESSED_WIDTH) < 1
          ? box
          : null;
      },
      () =>
        new Error(
          `the unbounded Slider's box never became ${String(
            GUESSED_WIDTH
          )} wide (last=${describeBox(
            harnessUi.queryByTestId('unbounded')
          )}, the other instance's box was ${String(BOX_WIDTH)}, the guess was ` +
            `${String(GUESSED_WIDTH)}x12).`
        )
    );
    console.log(
      `unbounded: bounded box=${describeBox(seedBox)} ` +
        `scroller box=${describeBox(unboundedBox)} ` +
        `measured=${describeBox(unboundedContent)} declared=${String(GUESSED_WIDTH)}`
    );

    // The width is the number this component declared for exactly this case. Against
    // the pre-F3 engine this reads 200: the *other* Slider's box, in a parent that
    // never had a width to give it, with nothing in the policy able to notice.
    expect(Math.abs(unboundedBox.width - GUESSED_WIDTH)).toBeLessThan(1);
    // Stated as the failure, because that is the sentence the bug is about.
    expect(Math.abs(unboundedBox.width - BOX_WIDTH)).toBeGreaterThanOrEqual(1);

    // Seeding *is* the declaration for the rest of this process
    // (`seedSizingSize` writes `fallbacks_`), so the real one goes back on the way
    // out and the epoch it was cached under goes with it - the same exit
    // `ColdSizing.harness.tsx` uses after poisoning a declaration.
    nitroUiCore.seedSizingSize(
      COMPONENT,
      SIZING_KEY,
      DECLARED_WIDTH,
      EXPECTED_HEIGHT
    );
    nitroUiCore.invalidateSizingEnvironment();
  });

  it('lays out at the declared fallback and corrects a wrong cached size', async () => {
    // D17: the first instance of a configuration may show the *declared* fallback
    // for one frame, and every configuration already answered exactly must lay out
    // exact. The declared fallback here equals the truth, so a correction failure
    // would be invisible - which is the trap AGENTS.md warns about. Poison the
    // cache with a height no control has, and the correction becomes observable.
    const wrong = { width: 200, height: 12 };
    const before = nitroUiCore.sizingStats();
    // Seed first, then drop the answers - the order `Sizing.harness.tsx`'s
    // `seedGuess` uses and for its reason: `invalidateSizingEnvironment` clears
    // the cached answers of the epoch and *keeps each component's last known
    // size as the guess*. Seeding afterwards would write the wrong number into
    // the epoch about to be measured, where it reads as an exact answer rather
    // than as the guess a cold mount has to outrank.
    nitroUiCore.seedSizingSize(
      COMPONENT,
      SIZING_KEY,
      wrong.width,
      wrong.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    // The drop really happened, so the mount below is cold (its guess is the
    // poisoned one) rather than a warm mount that was never at risk.
    expect(nitroUiCore.sizingStats().environmentEpoch).toBe(
      before.environmentEpoch + 1
    );

    await render(
      <View style={{ width: 300 }}>
        <Slider
          defaultValue={0.4}
          testID="poisoned"
          hybridRef={captureFor('poisoned')}
        />
      </View>
    );
    const box = await waitForBox('poisoned');
    const stats = nitroUiCore.sizingStats();
    const poisonedHandle = await handleFor('poisoned');
    console.log(
      `poison: guess=${String(wrong.width)}x${String(wrong.height)} box=${describeBox(box)} ` +
        `measured=${describeBox(poisonedHandle.measureContent())} epoch=${String(
          stats.environmentEpoch
        )}->${String(before.environmentEpoch)} ` +
        `corrections=${String(stats.correctionsImmediate - before.correctionsImmediate + (stats.correctionsBatched - before.correctionsBatched))}`
    );

    // The guess is a guess, not an answer: the control outranks it.
    expect(Math.abs(box.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(
      stats.correctionsImmediate + stats.correctionsBatched
    ).toBeGreaterThan(before.correctionsImmediate + before.correctionsBatched);

    // Self-healing: the measured height is the cache's now, so a second mount of
    // the same configuration costs no correction at all.
    const after = nitroUiCore.sizingStats();
    await render(
      <View style={{ width: 300 }}>
        <Slider defaultValue={0.4} testID="after-repair" />
      </View>
    );
    const repaired = await waitForBox('after-repair');
    const next = nitroUiCore.sizingStats();
    expect(Math.abs(repaired.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(
      next.correctionsImmediate +
        next.correctionsBatched -
        (after.correctionsImmediate + after.correctionsBatched)
    ).toBe(0);
  });

  it('honours an explicit size instead of the measured height', async () => {
    // A user `style` outranks the control's own box (sizing.md §6): the width is
    // 180 because it was fixed, and the height 60 because it was fixed.
    await render(
      <Slider
        defaultValue={0.3}
        style={{ width: 180, height: 60 }}
        testID="sized"
        hybridRef={captureFor('sized')}
      />
    );
    const box = await waitForBox('sized');
    const handle = await handleFor('sized');
    console.log(
      `user style: box=${describeBox(box)} measured=${describeBox(handle.measureContent())}`
    );
    expect(Math.abs(box.width - 180)).toBeLessThan(1);
    expect(Math.abs(box.height - 60)).toBeLessThan(1);
  });

  it('reports start, change and complete for one drag', async () => {
    const events = newEvents();
    await render(
      <Slider
        defaultValue={0.25}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="one-drag"
        hybridRef={captureFor('one-drag')}
      />
    );
    await waitForBox('one-drag');
    const handle = await handleFor('one-drag');
    await drag(handle, events, 0.75, 4, 0);

    // One start, one complete, and the complete is where the drag landed. The
    // start reports the value the drag *began* from, which is the seed - that
    // argument is this suite's reading of the displayed value.
    expect(events.start).toEqual([0.25]);
    expect(events.complete).toEqual([0.75]);
    expect(events.change.length).toBeGreaterThanOrEqual(1);
    expect(events.change[events.change.length - 1]).toBe(0.75);
    // Uncontrolled: JS never echoes, so nothing was written from React.
    expect(handle.value).toBeNull();
    // The frame pump is what carries a drag's samples, so a finished drag has to
    // give it back: on iOS a `CADisplayLink` that is not invalidated keeps
    // ticking a hosted view that is idle (and one that is recycled), and on
    // Android a `postFrameCallback` that is re-armed keeps a frame source alive
    // for a control nobody is touching. `false` after the release is the only
    // thing that says the callback is gone rather than merely quiet, and a few
    // frames later says it stays gone.
    const delivered = events.change.length;
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
    await sleep(150);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
    expect(events.change.length).toBe(delivered);
  });

  it('coalesces a drag to at most one onValueChange per frame', async () => {
    const events = newEvents();
    await render(
      <Slider
        defaultValue={0.1}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="coalesced"
        hybridRef={captureFor('coalesced')}
      />
    );
    await waitForBox('coalesced');
    const handle = await handleFor('coalesced');

    // Case 1: eight moves queued inside ONE main-thread turn. No frame can pass
    // between them, so a pipeline that emitted per move would report eight.
    await drag(handle, events, 0.9, 8, 0);
    console.log(
      `coalesce: same-turn moves=8 events=${String(events.change.length)}`
    );
    expect(events.change.length).toBe(1);
    expect(events.change[0]).toBe(0.9);

    // Case 2: five moves spread over five frames. The same pipeline must now
    // produce several events - otherwise case 1 would only be proving that
    // nothing is ever emitted. An upper bound of the number of moves keeps the
    // "at most one per frame" half of the contract asserted too.
    const before = events.change.length;
    await drag(handle, events, 0.2, 5, 70);
    const emitted = events.change.length - before;
    console.log(`coalesce: spread moves=5 events=${String(emitted)}`);
    expect(emitted).toBeGreaterThanOrEqual(2);
    expect(emitted).toBeLessThanOrEqual(5);
    // Every event carries a value the thumb was actually at, in order.
    for (const value of events.change) {
      expect(value).toBeGreaterThanOrEqual(0.1);
      expect(value).toBeLessThanOrEqual(0.9);
    }
  });

  it('quantises to the step, including the end of the range', async () => {
    const stepped = newEvents();
    const uneven = newEvents();
    const negative = newEvents();
    await render(
      <View>
        <Slider
          minimumValue={0}
          maximumValue={1}
          step={0.1}
          defaultValue={0}
          onValueChange={(value) => stepped.change.push(value)}
          onSlidingComplete={(value) => stepped.complete.push(value)}
          testID="step-tenths"
          hybridRef={captureFor('step-tenths')}
        />
        <Slider
          minimumValue={0}
          maximumValue={1}
          step={0.3}
          defaultValue={0}
          onValueChange={(value) => uneven.change.push(value)}
          onSlidingComplete={(value) => uneven.complete.push(value)}
          testID="step-thirds"
          hybridRef={captureFor('step-thirds')}
        />
        <Slider
          minimumValue={-5}
          maximumValue={5}
          step={1}
          defaultValue={0}
          onValueChange={(value) => negative.change.push(value)}
          onSlidingComplete={(value) => negative.complete.push(value)}
          testID="step-negative"
          hybridRef={captureFor('step-negative')}
        />
      </View>
    );
    await waitForBox('step-tenths');

    // 0.33 is not a legal value at step 0.1, and the value JS is told is the one
    // the thumb is showing (`docs/architecture/core.md` §11): every event is a
    // multiple of the step, and so is the release value.
    let handle = await handleFor('step-tenths');
    await drag(handle, stepped, 0.33, 6, 0);
    console.log(`quantise tenths: ${JSON.stringify(stepped.change)}`);
    expect(stepped.complete).toEqual([0.3]);
    for (const value of stepped.change) {
      expect(Math.abs(value * 10 - Math.round(value * 10))).toBeLessThan(1e-9);
    }

    // The range does not end on a step: 0.3, 0.6 - and 1 must still be reachable,
    // because a control whose top end cannot be reached is a bug with no
    // workaround from JS.
    await waitForBox('step-thirds');
    handle = await handleFor('step-thirds');
    await drag(handle, uneven, 0.95, 6, 0);
    console.log(`quantise thirds: ${JSON.stringify(uneven.change)}`);
    expect(uneven.complete).toEqual([1]);

    // A negative range: -2.6 is nearer -3 than -2, and the quantisation is in the
    // Slider's own units from its own minimum.
    await waitForBox('step-negative');
    handle = await handleFor('step-negative');
    await drag(handle, negative, -2.6, 6, 0);
    console.log(`quantise negatives: ${JSON.stringify(negative.change)}`);
    expect(negative.complete).toEqual([-3]);
  });

  it('reverts a change JS rejected', async () => {
    // The handler never updates state, so `value` stays 0.2 while native has
    // displayed 0.8. The event count is what still produces a commit, and the
    // commit is what puts the thumb back - so the *next* drag starting at 0.2 is
    // the evidence, and it is also the behaviour a user sees.
    const events = newEvents();
    await render(
      <Slider
        value={0.2}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="rejected"
        hybridRef={captureFor('rejected')}
      />
    );
    await waitForBox('rejected');
    const handle = await handleFor('rejected');

    await drag(handle, events, 0.8, 5, 0);
    expect(events.complete).toEqual([0.8]);
    // JS consumed the events, which is what allowed the revert.
    await waitFor(() =>
      expect(handle.mostRecentEventCount).toBeGreaterThanOrEqual(1)
    );

    await drag(handle, events, 0.4, 5, 0);
    console.log(`rejected: starts=${JSON.stringify(events.start)}`);
    expect(events.start).toEqual([0.2, 0.2]);
    // And the rejected value is gone rather than half-remembered.
    expect(events.complete[1]).toBe(0.4);
  });

  it('applies a value written from JS', async () => {
    const events = newEvents();
    const { rerender } = await render(
      <Slider
        value={0.2}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="from-js"
        hybridRef={captureFor('from-js')}
      />
    );
    await waitForBox('from-js');
    const handle = await handleFor('from-js');

    // Awaited, unlike a bare call: `rerender` resolves when the commit has
    // happened, and the props only reach native in that commit. Not awaiting it
    // passes on iOS by timing luck and fails on Android, where the same commit
    // takes longer to land (`Switch.harness.tsx` awaits for this reason).
    await rerender(
      <Slider
        value={0.6}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        // Every callback again, on every render: `drag` waits for the release
        // event, and a render that quietly drops one of the three would make
        // this measure a gesture whose end nobody was told about. (The wrapper
        // keeps all three props wired with one stable identity either way -
        // `Slider.tsx`'s `NO_SLIDE_HANDLER` - so passing them here is the
        // realistic app, not a favour to the test.)
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="from-js"
        hybridRef={captureFor('from-js')}
      />
    );
    // Wait for the write to land before dragging, or this would measure the old
    // value and pass for the wrong reason. `handle.value` is the prop native was
    // given; the drag's start value is what it displays.
    await waitFor(() => expect(handle.value).toBe(0.6));
    await drag(handle, events, 0.9, 5, 0);
    console.log(`from JS: starts=${JSON.stringify(events.start)}`);
    expect(events.start).toEqual([0.6]);
  });

  it('finishes a drag that a write from JS lands inside', async () => {
    // Review fix 1 asked for this case from JS, and the honest answer when it was
    // written is that the JS stream cannot see the bug. The race was: a parent
    // commit landing between a touch sample and the frame tick that emits it passed
    // the handshake (the counts it compares only advance on emit), so the app's
    // value was applied and then painted over by the dragged one - a one-frame snap
    // on the screen, and no callback that reports it either way.
    //
    // So this is a liveness check, and it has to assert what the contract actually
    // promises rather than one outcome of the race. The race has three legitimate
    // endings, all of them documented (`docs/architecture/core.md` §11, and pinned
    // where they are visible: `scripts/native-tests/handshake.test.swift:117-151`
    // and
    // `android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiControlledValueTest.kt:116-147`,
    // which both go red without the fix):
    //
    // - the write arrives while a sample is pending, is refused, and the release
    //   reports the drag;
    // - the write arrives with nothing pending and wins - §11's "the app takes the
    //   thumb" - so the release reports the app's number; and
    // - the write is refused mid-drag and then lands anyway, because a refused
    //   write is not dropped ("once the sample is emitted, the write is judged by
    //   the count alone"), so it can arrive *after* the release was reported.
    //
    // Measured on the iPhone Air and on `nitroui_t02` for this task: a gesture that
    // reported one value began the *next* gesture from the written value, and a
    // commit delivered after the release left the release reporting the value React
    // last committed. Both are the shapes above. What must survive every one of
    // them, five times over with the write dropped into a different part of the
    // drag each round, is: the gesture ends, with exactly one `onSlidingComplete`;
    // one start per end; the value a gesture began from and the value it stopped on
    // are each one of the values that could legitimately have been on the thumb at
    // that moment; every change is on the step; and the pump goes back to sleep.
    // A value outside those sets - or a gesture that never reports an end - is the
    // half-applied write, and still goes red here.
    const events = newEvents();
    const props = (value: number) => (
      <Slider
        value={value}
        step={0.1}
        onValueChange={(v) => events.change.push(v)}
        onSlidingStart={(v) => events.start.push(v)}
        onSlidingComplete={(v) => events.complete.push(v)}
        testID="mid-write"
        hybridRef={captureFor('mid-write')}
      />
    );
    const { rerender } = await render(props(0.2));
    await waitForBox('mid-write');
    const handle = await handleFor('mid-write');

    const mounted = 0.2;
    const written = 0.5;
    const target = 0.8;
    const releases: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = events.complete.length;
      const beganFrom = before === 0 ? mounted : events.complete[before - 1]!;
      // Eight moves ~55 ms apart, so one drag is eight frames of samples; the write
      // is injected at a different offset into that each round, which is the only
      // way to cross the pending-sample window more often than by luck.
      handle.nuiTestDrag(target, 8, 55);
      await sleep(30 + attempt * 60);
      await rerender(props(written));
      await pollUntil(
        () => (events.complete.length > before ? events.complete.length : null),
        () =>
          new Error(
            `Attempt ${String(attempt)}: no onSlidingComplete after a mid-drag ` +
              `write (start=${JSON.stringify(events.start)} ` +
              `change=${JSON.stringify(events.change)} ` +
              `complete=${JSON.stringify(events.complete)}).`
          ),
        6000
      );
      await sleep(60);
      // Whichever shape the race took, the gesture is over and it ended with one
      // release - not none, and not two.
      expect(events.complete.length).toBe(before + 1);
      const release = events.complete[before]!;
      releases.push(release);
      // One start per end.
      expect(events.start.length).toBe(events.complete.length);
      // What the control was showing when the gesture began, read back from
      // `onSlidingStart`: the value the last gesture reported, or the app's write
      // (the third shape above lands it after a release). The first gesture begins
      // before any write exists, so it has one answer. Anything else - a value no
      // participant ever had - is the half-applied write.
      const atStart = attempt === 0 ? [mounted] : [beganFrom, written];
      expect(atStart).toContain(events.start[before]);
      // Where the thumb stopped: the drag's own target, or the value React had
      // committed by then. In the first round a commit can arrive after the
      // release, and then the value React had committed is still the one it mounted
      // with; from the second round on, React's committed value is `written` and
      // `mounted` is no longer anybody's answer.
      const atEnd =
        attempt === 0 ? [target, written, mounted] : [target, written];
      expect(atEnd).toContain(release);
      for (const value of events.change) {
        // Every change is a value the thumb was showing, on the step.
        const offGrid = Math.abs(value * 10 - Math.round(value * 10));
        expect(offGrid).toBeLessThan(1e-9);
      }
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
    }
    console.log(
      `mid-drag write: 5 attempts, release values=${JSON.stringify(releases)} ` +
        `(wrote ${written}, dragged to ${target})`
    );
    // And the control is still an ordinary control afterwards: it begins from one
    // of the two values the last round could have left on the thumb, and a clean
    // drag - no write in it - ends where it was dragged to.
    await drag(handle, events, 0.3, 4, 0);
    expect([releases[4]!, written]).toContain(
      events.start[events.start.length - 1]
    );
    expect(events.complete[events.complete.length - 1]).toBe(0.3);
  });

  it('keeps its own value when uncontrolled', async () => {
    const events = newEvents();
    await render(
      <Slider
        defaultValue={0.4}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="free"
        hybridRef={captureFor('free')}
      />
    );
    await waitForBox('free');
    const handle = await handleFor('free');

    await drag(handle, events, 0.7, 4, 0);
    await drag(handle, events, 0.15, 4, 0);
    console.log(`uncontrolled: starts=${JSON.stringify(events.start)}`);
    // The second drag began where the first ended: native owns the displayed value,
    // and JS never rendered for either drag.
    expect(events.start).toEqual([0.4, 0.7]);
    expect(events.complete).toEqual([0.7, 0.15]);
  });

  it('keeps the thumb ahead of a slow JS handler', async () => {
    // The case frame coalescing exists for. The handler burns 100 ms of JS time per
    // event, so JS is years behind the finger; native must still report the value
    // the gesture settled on, must not queue one event per touch sample, and must
    // still be showing that value afterwards - which the next drag's start reports.
    const events = newEvents();
    function Slow() {
      const [, setBurn] = useState(0);
      const onChange = useCallback((value: number) => {
        events.change.push(value);
        const until = Date.now() + 100;
        while (Date.now() < until) {
          // Deliberately spinning: the point is that JS is unavailable to React.
        }
        setBurn((count) => count + 1);
      }, []);
      return (
        <Slider
          defaultValue={0.5}
          onValueChange={onChange}
          onSlidingStart={(value) => events.start.push(value)}
          onSlidingComplete={(value) => events.complete.push(value)}
          testID="slow"
          hybridRef={captureFor('slow')}
        />
      );
    }
    await render(<Slow />);
    await waitForBox('slow');
    const handle = await handleFor('slow');

    // Six moves, one per frame (50 ms apart is ~3 frames at 60 Hz and ~6 at
    // 120 Hz), so the honest upper bound on events here is the number of moves.
    // "At most one per frame" is gated by the coalescing test, which is
    // frame-rate independent because it queues eight samples inside a single
    // main-thread turn; bounding a frame-spaced drag by anything smaller than
    // its move count would measure the display's refresh rate, not the
    // coalescer, and would go red on a ProMotion device for the wrong reason.
    await drag(handle, events, 0.95, 6, 50);
    const duringDrag = events.change.length;
    console.log(
      `slow JS: events=${String(duringDrag)} for 6 moves over ~300ms`
    );
    // The final value arrives exactly once, through a JS thread that was
    // unavailable for ~100 ms per event.
    expect(events.complete).toEqual([0.95]);
    expect(duringDrag).toBeGreaterThanOrEqual(1);
    // No event per touch sample: JS was fed at most one event per move, and the
    // gesture was 6 moves. A pipeline that emitted per sample would report a
    // number set by the touch sampler instead.
    expect(duringDrag).toBeLessThanOrEqual(6);

    // The drag after the slow one starts at 0.95: native had it the whole time, so
    // nothing was waiting for a lagging JS to catch up before displaying it.
    await drag(handle, events, 0.3, 4, 0);
    expect(events.start[1]).toBe(0.95);
  });

  it('ignores a drag while disabled, and follows the flag back', async () => {
    // Both controls are in the *same* tree, and the `rerender` below re-renders
    // that tree. This is not stylistic: the harness' `render` replaces whatever is
    // rendered, so rendering the barrier as a second `render()` call would unmount
    // the control under test - and the `rerender` would then hand the new props to
    // whichever native view Fabric decided to reuse (measured on Android: the
    // barrier's view came back tagged `off-limits`, with a different hybrid
    // object), so the test would assert a flag on a control that no longer exists.
    // One tree, one rerender, and the instance under test stays the instance.
    const events = newEvents();
    const barrierEvents = newEvents();
    const tree = (offLimitsDisabled: boolean) => (
      <View>
        <Slider
          disabled={offLimitsDisabled}
          defaultValue={0.6}
          onValueChange={(value) => events.change.push(value)}
          onSlidingStart={(value) => events.start.push(value)}
          onSlidingComplete={(value) => events.complete.push(value)}
          testID="off-limits"
          hybridRef={captureFor('off-limits')}
        />
        <Slider
          defaultValue={0.1}
          onValueChange={(value) => barrierEvents.change.push(value)}
          onSlidingStart={(value) => barrierEvents.start.push(value)}
          onSlidingComplete={(value) => barrierEvents.complete.push(value)}
          testID="barrier"
          hybridRef={captureFor('barrier')}
        />
      </View>
    );

    const { rerender } = await render(tree(true));
    await waitForBox('off-limits');
    const handle = await handleFor('off-limits');
    expect(handle.disabled).toBe(true);

    handle.nuiTestDrag(0.9, 4, 0);
    // A barrier: an event from another control proves the pipeline flushed, so an
    // empty `events` below is "nothing arrived", not "nothing arrived yet".
    await waitForBox('barrier');
    const barrierHandle = await handleFor('barrier');
    await drag(barrierHandle, barrierEvents, 0.6, 3, 0);
    // The barrier's own gesture has to be *complete* before the empty arrays below
    // mean anything: a change event still travelling would let a leaking disabled
    // control look silent (`docs/architecture/core.md` §9, "assert a non-event with
    // a barrier").
    expect(barrierEvents.complete).toEqual([0.6]);
    expect(barrierEvents.change.length).toBeGreaterThan(0);
    expect(events.start).toEqual([]);
    expect(events.change).toEqual([]);
    expect(events.complete).toEqual([]);
    expect(handle.mostRecentEventCount).toBe(0);
    // Inert is not the same as announced. `clearAndSetSemantics` clears M3's
    // `sliderSemantics`, and `disabled()` lived there, so the merged node the
    // reader is handed only carries the flag if this control restates it. The probe
    // walks the real a11y tree, so `disabled=true` here is the thing TalkBack reads -
    // without it a disabled Slider is a live, adjustable control that does nothing.
    expect(await accessibilityStepReport(handle, 1)).toContain('disabled=true');

    // Same instance, new flag: interaction returns without a remount. Asserted by
    // identity as well as behaviour, because "the flag came back on the control
    // this test started with" is the whole claim.
    await rerender(tree(false));
    expect(handles.get('off-limits')).toBe(handle);
    await waitFor(() => expect(handle.disabled).toBe(false));
    await drag(handle, events, 0.9, 4, 0);
    expect(events.start).toEqual([0.6]);
    expect(events.complete).toEqual([0.9]);
    // The flag the reader sees follows the prop back off, on the same node.
    expect(await accessibilityStepReport(handle, 1)).toContain(
      'disabled=false'
    );
  });

  it('follows a new range and tint on the same instance', async () => {
    // The closest JS reaches to a recycled row: one instance, new props, no
    // remount. A range that moves under an existing value must also keep that value
    // legal, and the tint is a rendered prop that has to reach the control.
    const events = newEvents();
    const { rerender } = await render(
      <Slider
        defaultValue={0.5}
        tintColor="#7C4DFF"
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="repaint"
        hybridRef={captureFor('repaint')}
      />
    );
    await waitForBox('repaint');
    const handle = await handleFor('repaint');
    // The tint is the round-trip DECISIONS D10 is about: `processColor` is unsigned
    // on iOS and signed on Android, so the number native holds must be *this*
    // platform's bit pattern for `#7C4DFF`, not merely "some number".
    const tint = handle.tintColor;
    expect(tint).toBe(processColor('#7C4DFF'));

    await rerender(
      <Slider
        minimumValue={0}
        maximumValue={100}
        step={5}
        defaultValue={0.5}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="repaint"
        hybridRef={captureFor('repaint')}
      />
    );
    // The removed tint is the observable that says this commit landed: the tint is a
    // rendered prop, so its getter going back to `null` means the props batch was
    // applied (`core.md` §3). Waiting on `handle.value` would prove nothing - the
    // control is uncontrolled, so that getter answers `null` before *and* after.
    await waitFor(() => expect(handle.tintColor).toBeNull());
    await drag(handle, events, 42, 5, 0);
    console.log(
      `range change: starts=${JSON.stringify(events.start)} complete=${JSON.stringify(events.complete)}`
    );
    expect(handle.tintColor).toBeNull();
    // 0.5 is inside 0...100 but not on step 5, so `afterUpdate` must have moved the
    // *displayed* value onto the new grid. The next drag's start argument is that
    // value - the only way to read it back from JS.
    expect(events.start).toEqual([0]);
    // And 42 is not a multiple of 5 from 0 either; the range now travels 0...100.
    expect(events.complete).toEqual([40]);
  });

  it('does not resume an abandoned drag after its view is gone', async () => {
    // `prepareForRecycle`/`onDropView` cancel an in-flight drag. The moves of a
    // simulated drag are queued on the main looper, so they can still be travelling
    // when that happens - and if the instance is then reused, the next owner would
    // be handed somebody else's gesture: a drag that starts without a start event
    // and emits values nobody touched.
    const first = newEvents();
    const firstRender = await render(
      <Slider
        defaultValue={0.2}
        onValueChange={(value) => first.change.push(value)}
        onSlidingStart={(value) => first.start.push(value)}
        onSlidingComplete={(value) => first.complete.push(value)}
        testID="abandoned"
        hybridRef={captureFor('abandoned')}
      />
    );
    await waitForBox('abandoned');
    const abandonedHandle = await handleFor('abandoned');
    abandonedHandle.nuiTestDrag(0.95, 5, 60);
    await sleep(120); // a couple of moves in, several still queued
    // The gesture is genuinely in flight here - which is what makes the rest of
    // this test worth running at all. `nuiTestFramePumpArmed` is the proof: the
    // display link / Choreographer callback is live, so there is something for the
    // recycle to cancel.
    expect(abandonedHandle.nuiTestFramePumpArmed()).toBe(true);
    firstRender.unmount();

    const second = newEvents();
    await render(
      <Slider
        defaultValue={0.2}
        onValueChange={(value) => second.change.push(value)}
        onSlidingStart={(value) => second.start.push(value)}
        onSlidingComplete={(value) => second.complete.push(value)}
        testID="next-owner"
        hybridRef={captureFor('next-owner')}
      />
    );
    await waitForBox('next-owner');
    const nextHandle = await handleFor('next-owner');
    // Long enough for every queued move and the queued release to have fired.
    await sleep(500);
    // And the pump is gone with it: a cancelled drag that left its frame source
    // running is a callback ticking a control nobody owns until the next drag
    // adopts it.
    expect(abandonedHandle.nuiTestFramePumpArmed()).toBe(false);
    expect(second.change).toEqual([]);
    expect(second.start).toEqual([]);
    expect(second.complete).toEqual([]);
    expect(nextHandle.mostRecentEventCount).toBe(0);
    // Review fix 7: the assertions above would also pass if the dropped view were
    // simply never reused, which would make this a test of garbage collection - so
    // whether the instance came back is pinned, per platform, because the two do
    // different things with a dropped view and only one of them can make this test
    // mean what it looks like it means.
    //
    // iOS: Fabric's pool hands the same Hybrid View to the next `NitroUiSlider`, so
    // the handle below *is* the abandoned one, and the no-leak assertions are about
    // a control that really has two owners. That is the case `prepareForRecycle`
    // exists for.
    //
    // Android: measured on `nitroui_t01`, a plain unmount/mount in the root does
    // not go through the recycler (it is built for list children), so the new owner
    // gets a fresh instance and the reuse risk is not reachable from here. What
    // protects Android is `prepareForRecycle`'s cancel, and that is gated where it
    // can be gated deterministically - `SliderModelTest`'s "a reset cancels the
    // drag in flight" and "a late end after a cancel is silent", which go red
    // without the guard.
    console.log(
      `abandoned drag: reused=${String(nextHandle === abandonedHandle)}`
    );
    if (Platform.OS === 'ios') {
      expect(nextHandle).toBe(abandonedHandle);
    } else {
      expect(nextHandle).not.toBe(abandonedHandle);
    }

    // And the new instance is clean in the deeper sense: its own drag starts from
    // its own seed, not from somewhere the abandoned drag reached.
    await drag(nextHandle, second, 0.8, 4, 0);
    expect(second.start).toEqual([0.2]);
    expect(second.complete).toEqual([0.8]);
  });

  it('labels the control for a screen reader', async () => {
    await render(
      <View style={{ width: 300 }}>
        <Slider
          defaultValue={0.5}
          accessibilityLabel="Volume"
          testID="labelled"
          hybridRef={captureFor('labelled')}
        />
      </View>
    );
    const box = await waitForBox('labelled');
    const handle = await handleFor('labelled');
    // The label belongs on the hosted control, never on the container
    // (`docs/architecture/core.md` §3), so how far the harness can *see* it depends
    // on what each platform's a11y tree is made of:
    //
    // - iOS: VoiceOver's elements are UIElements, and the harness' query reads
    //   `accessibilityLabel` off them, so this reaches through the SwiftUI host and
    //   answers with the control's own box.
    // - Android: the harness matches `View.contentDescription` while walking real
    //   Views (`@react-native-harness/ui`'s `ViewQueryHelper.viewMatches`), and
    //   Compose semantics are not Views - M3's Slider publishes its label and its
    //   increase/decrease actions in the `SemanticsNode` tree, which TalkBack reads
    //   through `AndroidComposeView`'s virtual node provider. Nothing in the View
    //   tree carries it, so `labelled` is null here no matter what the component
    //   does. Mirroring the label onto the host View would make the query answer
    //   and give TalkBack a second focus stop, which is the bug core.md §3 forbids;
    //   so Android asserts the strongest thing that is honest to check - the label
    //   reached the control - and `docs/components/slider.md` records what
    //   TalkBack announces. The gap (a Compose-semantics query in the harness) is
    //   reported in `docs/tasks/G1-slider.report.md`.
    const labelled = harnessUi.queryByAccessibilityLabel('Volume');
    console.log(
      `a11y: box=${describeBox(box)} labelBox=${describeBox(labelled)} ` +
        `handleLabel=${String(handle.accessibilityLabel)}`
    );
    expect(handle.accessibilityLabel).toBe('Volume');
    if (Platform.OS === 'ios') {
      expect(labelled).not.toBeNull();
      expect(Math.abs(labelled!.width - box.width)).toBeLessThan(2);
    }
  });

  it('steps to the next legal value when a screen reader asks', async () => {
    // Review fix 3. The test that matters is not "the model can compute a next
    // value" - the native unit vectors cover that - it is what the *platform's*
    // adjust action does to this control, because that is the only path a screen
    // reader has: VoiceOver performs `accessibilityIncrement` on the focused
    // element, and TalkBack invokes the Compose `SetProgress` action on the focused
    // semantics node. Both probes below do exactly that (see
    // `nuiTestAccessibilityStep`), with no fallback: a control that does not
    // expose the action fails the test rather than being quietly stepped by us.
    //
    // Two ranges are needed. `0…12 step 3` ends on a step, so the platform can
    // stride its own track. `0…10 step 3` does not, and is the interesting one:
    // handing the platform a continuous track and quantising afterwards means its
    // increment lands on a fraction that snaps *back* to where it was - the reader
    // presses and nothing moves.
    const aligned = newEvents();
    const uneven = newEvents();
    const atTheTop = newEvents();
    // What each of the three controls displays before a reader touches it, so the
    // helper can check the first step's start argument.
    const seeds = new Map<SlideEvents, number>([
      [aligned, 0],
      [uneven, 0],
      [atTheTop, 12],
    ]);
    await render(
      <View>
        <Slider
          minimumValue={0}
          maximumValue={12}
          step={3}
          defaultValue={0}
          onValueChange={(v) => aligned.change.push(v)}
          onSlidingStart={(v) => aligned.start.push(v)}
          onSlidingComplete={(v) => aligned.complete.push(v)}
          testID="a11y-aligned"
          hybridRef={captureFor('a11y-aligned')}
        />
        <Slider
          minimumValue={0}
          maximumValue={10}
          step={3}
          defaultValue={0}
          onValueChange={(v) => uneven.change.push(v)}
          onSlidingStart={(v) => uneven.start.push(v)}
          onSlidingComplete={(v) => uneven.complete.push(v)}
          testID="a11y-uneven"
          hybridRef={captureFor('a11y-uneven')}
        />
        <Slider
          minimumValue={0}
          maximumValue={12}
          step={3}
          defaultValue={12}
          onValueChange={(v) => atTheTop.change.push(v)}
          onSlidingStart={(v) => atTheTop.start.push(v)}
          onSlidingComplete={(v) => atTheTop.complete.push(v)}
          testID="a11y-top"
          hybridRef={captureFor('a11y-top')}
        />
      </View>
    );
    await waitForBox('a11y-aligned');
    const alignedHandle = await handleFor('a11y-aligned');
    const unevenHandle = await handleFor('a11y-uneven');
    const topHandle = await handleFor('a11y-top');

    // One gesture's worth of callbacks per step: a screen reader's increment is an
    // interaction like a thumb release, and an app must not have to tell them
    // apart. It is also the guard on the other half of review fix 3 - a write that
    // opened a drag SwiftUI was never going to close would leave a start with no
    // end (and the pump running), and the arrays below would stop matching.
    const walkTo = async (
      what: string,
      handle: SliderHandle,
      events: SlideEvents,
      direction: number,
      expected: number[]
    ) => {
      const seed = seeds.get(events)!;
      const report = await accessibilityStepReport(handle, direction);
      if (events.complete.length === 1) {
        console.log(`a11y step: ${report}`);
      }
      expectPerformed(report, what);
      const index = events.complete.length - 1;
      expect(events.complete).toEqual(expected.slice(0, index + 1));
      // The start of each step is the value it began from: the control's seed for
      // the first, and each previously reported value after that. And never more
      // starts than ends - the drag that never ends would show up here.
      expect(events.start[index]).toEqual(
        index === 0 ? seed : expected[index - 1]
      );
      expect(events.start.length).toBe(events.complete.length);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
    };

    // 0…12 step 3: the grid is the platform's, and the top of the range is on it.
    await walkTo('aligned +3', alignedHandle, aligned, 1, [3]);
    await walkTo('aligned +6', alignedHandle, aligned, 1, [3, 6]);
    await walkTo('aligned +9', alignedHandle, aligned, 1, [3, 6, 9]);
    await walkTo('aligned +12', alignedHandle, aligned, 1, [3, 6, 9, 12]);
    // At the top there is no next value. Emitting a triple for a value that did not
    // move would report a gesture the reader never performed.
    expectPerformed(
      await accessibilityStepReport(alignedHandle, 1),
      'aligned past the top'
    );
    expect(aligned.complete).toEqual([3, 6, 9, 12]);
    await walkTo('aligned -9', alignedHandle, aligned, -1, [3, 6, 9, 12, 9]);
    await walkTo('aligned -3', alignedHandle, aligned, -1, [3, 6, 9, 12, 9, 6]);
    await walkTo(
      'aligned +0',
      alignedHandle,
      aligned,
      -1,
      [3, 6, 9, 12, 9, 6, 3]
    );
    await walkTo(
      'aligned to 0',
      alignedHandle,
      aligned,
      -1,
      [3, 6, 9, 12, 9, 6, 3, 0]
    );

    // 0…10 step 3: 0, 3, 6, 9 are the grid and 10 is the bound, which stays
    // reachable. A reader stepping this range must see 3, 6, 9, 10 - not three
    // presses and a fourth that does nothing.
    await walkTo('uneven +3', unevenHandle, uneven, 1, [3]);
    await walkTo('uneven +6', unevenHandle, uneven, 1, [3, 6]);
    await walkTo('uneven +9', unevenHandle, uneven, 1, [3, 6, 9]);
    await walkTo('uneven +10', unevenHandle, uneven, 1, [3, 6, 9, 10]);
    expectPerformed(
      await accessibilityStepReport(unevenHandle, 1),
      'uneven past the top'
    );
    expect(uneven.complete).toEqual([3, 6, 9, 10]);

    // Starting at the bound: forward does nothing, back steps.
    expectPerformed(
      await accessibilityStepReport(topHandle, 1),
      'at the top, forward'
    );
    expect(atTheTop.complete).toEqual([]);
    expect(atTheTop.start).toEqual([]);
    await walkTo('at the top, back', topHandle, atTheTop, -1, [9]);

    // A thumb drag after nine a11y steps still behaves like a drag: one start, one
    // end, starting from where the reader left the value. Nothing in the a11y path
    // may leave the gesture machine in a state a finger then has to clean up.
    console.log(
      `a11y walk: starts=${String(aligned.start.length)} ` +
        `complete=${String(aligned.complete.length)}`
    );
    expect(aligned.start.length).toBe(aligned.complete.length);
    await drag(alignedHandle, aligned, 6, 4, 0);
    expect(aligned.start[aligned.start.length - 1]).toBe(0);
    expect(aligned.complete[aligned.complete.length - 1]).toBe(6);
    expect(aligned.start.length).toBe(aligned.complete.length);
    expect(alignedHandle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('renders a range whose two ends are the same value', async () => {
    // Review fix 7: `min == max` was only ever covered by the native vectors, which
    // is exactly the kind of case that traps a platform control - `ClosedRange` is
    // fine with it and Compose's `FloatRange` is not, and the fix for one platform
    // (widening the span the control is given) is invisible to the other. On device
    // it also has to *lay out*: a control that throws here takes the whole tree with
    // it, and an app that computes a range from data can easily produce this.
    const events = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={5}
          maximumValue={5}
          defaultValue={5}
          onValueChange={(v) => events.change.push(v)}
          onSlidingStart={(v) => events.start.push(v)}
          onSlidingComplete={(v) => events.complete.push(v)}
          testID="flat-range"
          hybridRef={captureFor('flat-range')}
        />
      </View>
    );
    const box = await waitForBox('flat-range');
    const handle = await handleFor('flat-range');
    expect(Math.abs(box.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(box.width).toBeGreaterThan(100);

    // A drag across the whole track still reports the one value the range has, in
    // every callback, and closes itself.
    await drag(handle, events, 9, 4, 0);
    console.log(
      `flat range: starts=${JSON.stringify(events.start)} ` +
        `change=${JSON.stringify(events.change)} ` +
        `complete=${JSON.stringify(events.complete)}`
    );
    expect(events.start).toEqual([5]);
    expect(events.complete).toEqual([5]);
    expect(events.change.every((value) => value === 5)).toBe(true);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);

    // And so does the reader: there is no other value to go to.
    expectPerformed(
      await accessibilityStepReport(handle, 1),
      'flat range, forward'
    );
    expect(events.complete).toEqual([5]);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('survives mounting and unmounting repeatedly', async () => {
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const { unmount } = await render(
        <Slider defaultValue={0.5} testID={`cycle-${cycle}`} />
      );
      unmount();
    }

    const events = newEvents();
    await render(
      <Slider
        defaultValue={0.5}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="after-cycles"
        hybridRef={captureFor('after-cycles')}
      />
    );
    await waitForBox('after-cycles');
    await drag(await handleFor('after-cycles'), events, 0.9, 4, 0);
    expect(events.start).toEqual([0.5]);
    expect(events.change.length).toBeGreaterThan(0);
  });

  it('mounts many instances at once', async () => {
    // The stress case a list of settings rows is. 40 hosted controls means 40
    // hosting controllers / compositions, plus 40 measure passes reporting a height
    // and taking a width from the box - which is the `fillWidth` path under load.
    const rows = Array.from({ length: 40 }, (_, index) => index);
    const startedAt = nitroUiCore.now();
    await render(
      <View>
        {rows.map((row) => (
          <Slider
            key={row}
            defaultValue={(row % 11) / 10}
            testID={`many-${String(row)}`}
          />
        ))}
      </View>,
      { timeout: 30000 }
    );
    const mountedIn = nitroUiCore.now() - startedAt;
    const last = await waitForBox('many-39', 20000);
    console.log(
      `Slider stress: 40 hosted controls mounted in ${mountedIn.toFixed(1)}ms last=${describeBox(last)}`
    );
    // How long 40 hosted controls took is a duration, so D21 reports it here
    // and judges it only under `HARNESS_TIMING=1` on a quiet machine. What this
    // test gates on every run is that they all reached the right box.
    await expectTimingBudget({
      label: 'Slider stress: mount 40 instances',
      measuredMs: mountedIn,
      limitMs: 15000,
      note: 'the bar is headroom for a debug build, not a target',
    });
    expect(Math.abs(last.height - EXPECTED_HEIGHT)).toBeLessThan(1);
  });
});
