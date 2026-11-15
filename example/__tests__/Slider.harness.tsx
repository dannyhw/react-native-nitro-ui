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
import { screen, userEvent } from '@react-native-harness/ui';
import { Slider, nitroUiCore } from 'react-native-nitro-ui';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
  queryByAccessibilityLabel(label: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type SliderHandle = {
  readonly value: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  /**
   * Simulate a drag from the displayed value: `steps` moves `msPerStep` apart, then
   * a release one interval later. `onSlidingStart` reports the displayed value, which
   * is how these tests read what the control was showing.
   */
  nuiTestDrag(to: number, steps: number, msPerStep: number): void;
  /** Perform the platform's a11y increment (>0) / decrement (<0). */
  nuiTestAccessibilityStep(direction: number): void;
  /** What the last accessibility step did, one line. */
  nuiTestAccessibilityStepReport(): string;
  /** Whether the control's frame pump is still armed. */
  nuiTestFramePumpArmed(): boolean;
  /** Inject a canned pointer stream (Android only). */
  nuiTestPointerStream(mode: number): void;
  /** What the last injected stream did, one line. */
  nuiTestPointerStreamReport(): string;
};

/**
 * Inject pointer stream `mode` and wait for the platform view to have taken it. The
 * old report is read before posting: the probe runs on the UI thread and can answer
 * before a later read, and its reports are numbered, so a new one always differs.
 */
async function injectPointerStream(
  handle: SliderHandle,
  mode: number
): Promise<string> {
  const before = handle.nuiTestPointerStreamReport();
  handle.nuiTestPointerStream(mode);
  const report = await pollUntil(
    () => {
      const next = handle.nuiTestPointerStreamReport();
      return next === before ? null : next;
    },
    () => new Error(`The pointer stream probe never reported (mode=${mode}).`),
    8000
  );
  if (!report.includes('dispatched ')) {
    // A stream that reached no laid-out view must not read as a quiet control.
    throw new Error(`pointer stream mode=${mode}: ${report}`);
  }
  return report;
}

/** Wait for the queued a11y action to have run, then read its report. */
async function accessibilityStepReport(
  handle: SliderHandle,
  direction: number
): Promise<string> {
  // The old report is read before posting the step: the probe runs on the UI thread
  // and can answer before a later read. Reports are numbered, so a new one differs.
  const before = handle.nuiTestAccessibilityStepReport();
  handle.nuiTestAccessibilityStep(direction);
  return pollUntil(
    () => {
      const report = handle.nuiTestAccessibilityStepReport();
      return report === before ? null : report;
    },
    () =>
      new Error(
        `The accessibility step probe never reported (last report: ${
          before === '' ? 'none' : `"${before}"`
        }).`
      ),
    5000
  );
}

/** The report must say the platform's own action ran, not that we gave up. */
function expectPerformed(report: string, what: string): void {
  if (!report.includes('performed ')) {
    // Thrown, because a matcher failure shortens the report.
    throw new Error(`${what}: ${report}`);
  }
}

/**
 * The `hybridRef` handles this test rendered, by `testID`. The capture function is
 * memoised per id: a fresh closure per render would re-apply the callback prop.
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

/** The height a Slider occupies, per platform. */
const EXPECTED_HEIGHT = Platform.select({
  // Material 3 includes its 48 dp minimum touch target in the control's own box.
  android: 48,
  default: 31,
})!;

/** This component's key in the sizing engine (matches `Slider.tsx`). */
const COMPONENT = 'NitroUiSlider';
const SIZING_KEY = '';

/**
 * The width this platform's `Slider` declares as its fallback, written out so a test
 * that seeds over the declaration can put the real one back.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a testID to exist and return its box. `screen.findByTestId` has no
 * timeout, and a hosted control is only queryable once it has mounted and laid out.
 */
async function waitForBox(
  testId: string,
  timeoutMs = 10000
): Promise<ViewInfo> {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    const box = harnessUi.queryByTestId(testId);
    if (box != null) {
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

/** Wait until `events` holds `completions` gestures' worth of releases. */
async function dragCompleted(
  events: SlideEvents,
  completions: number,
  budgetMs: number
): Promise<void> {
  const deadline = nitroUiCore.now() + budgetMs;
  for (;;) {
    if (events.complete.length >= completions) {
      return;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `Wanted ${String(completions)} onSlidingComplete(s), have ` +
          `${String(events.complete.length)} after ${String(budgetMs)}ms ` +
          `(start=${JSON.stringify(events.start)} change=${JSON.stringify(
            events.change
          )} complete=${JSON.stringify(events.complete)}).`
      );
    }
    await sleep(25);
  }
}

/** Drive a drag of `steps` moves, `msPerStep` apart, and wait for its release. */
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
  // One frame past the release, so a late coalesced change has had its turn.
  await sleep(60);
}

/** Press the middle of a control's own height, at `fraction` of its width. */
async function pressInBox(
  box: ViewInfo,
  fraction: number,
  durationMs?: number
): Promise<void> {
  const x = box.x + box.width * fraction;
  const y = box.y + box.height / 2;
  if (durationMs == null) {
    await userEvent.pressAt(x, y);
  } else {
    await userEvent.longPressAt(x, y, durationMs);
  }
}

/**
 * Wait for the callback stream to hold still, so a count asserted after it cannot
 * have been read while a late event was still on its way.
 */
async function settleEvents(events: SlideEvents, ms = 400): Promise<void> {
  const seen = () =>
    events.start.length + events.change.length + events.complete.length;
  let quietSince = nitroUiCore.now();
  let last = seen();
  for (;;) {
    await sleep(50);
    const now = seen();
    if (now !== last) {
      last = now;
      quietSince = nitroUiCore.now();
    } else if (nitroUiCore.now() - quietSince >= ms) {
      return;
    }
  }
}

afterEach(() => {
  cleanup();
  handles.clear();
});

describe('Slider', () => {
  beforeAll(async () => {
    // The first hosted control of a process pays one-time costs that can exceed the
    // harness' mount timeout on a cold emulator.
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

    // The width is the parent's, the height is the control's.
    expect(Math.abs(box.width - 300)).toBeLessThan(1);
    expect(Math.abs(box.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(content.height - box.height)).toBeLessThan(1);
    expect(Math.abs(content.width - box.width)).toBeLessThan(1);
  });

  it('answers its own height at any width, and ignores a box height that is wrong', async () => {
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

    // Each instance is measured and unmounted before the next is rendered: on
    // Android a second `render()` leaves the first control's host unmeasurable.
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

    expect(Math.abs(wideBox.width - 300)).toBeLessThan(1);
    expect(Math.abs(narrowBox.width - 180)).toBeLessThan(1);
    expect(Math.abs(narrowBox.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(Math.abs(narrowContent.height - wideContent.height)).toBeLessThan(
      0.5
    );
    // The reported width is this instance's box, not the first instance's.
    expect(Math.abs(narrowContent.width - narrowBox.width)).toBeLessThan(1);

    // A box that is wrong about the height: the user's style keeps the box at 12,
    // and the control must still report its own height.
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
    // A measure that waited for the box to have a height would never run: the
    // control's report is what gives the box one.
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
    expect(Math.abs(content.width - 180)).toBeLessThan(1);
  });

  it('hands an unbounded parent its declared width, not another instance\u2019s box', async () => {
    // A horizontal `ScrollView` measures its children with no finite width, the one
    // case where a `fillWidth` control is drawn at its declared width. Seeding
    // 240x12 replaces the declaration, so the unbounded Slider must come out 240
    // wide: not the 200 of the bounded instance mounted before it, and not the
    // width the platform really declares.
    const GUESSED_WIDTH = 240;
    const BOX_WIDTH = 200;
    // Seed first, then bump the epoch: seeding afterwards would file 240x12 as an
    // exact answer instead of the guess a cold mount has to correct.
    const before = nitroUiCore.sizingStats();
    nitroUiCore.seedSizingSize(COMPONENT, SIZING_KEY, GUESSED_WIDTH, 12);
    nitroUiCore.invalidateSizingEnvironment();
    expect(nitroUiCore.sizingStats().environmentEpoch).toBe(
      before.environmentEpoch + 1
    );

    // try/finally, so a failure cannot leave the seeded declaration in place for
    // every later Slider test.
    try {
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
      // Read while this tree is still live: on Android a second `render()` leaves an
      // earlier host unmeasurable.
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
      expect(Math.abs(seedBox.width - BOX_WIDTH)).toBeLessThan(1);

      // The same configuration, in a parent with no width to give.
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
      // Only the width is waited for: on Android a horizontal scroller stretches its
      // children along the cross axis, so the box's height is the scroller's.
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

      expect(Math.abs(unboundedBox.width - GUESSED_WIDTH)).toBeLessThan(1);
      expect(Math.abs(unboundedBox.width - BOX_WIDTH)).toBeGreaterThanOrEqual(
        1
      );
    } finally {
      // A seed stays the declaration for the rest of the process, so the real one
      // is put back.
      nitroUiCore.seedSizingSize(
        COMPONENT,
        SIZING_KEY,
        DECLARED_WIDTH,
        EXPECTED_HEIGHT
      );
      nitroUiCore.invalidateSizingEnvironment();
    }
  });

  it('honours an explicit size instead of the measured height', async () => {
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

    expect(events.start).toEqual([0.25]);
    expect(events.complete).toEqual([0.75]);
    expect(events.change.length).toBeGreaterThanOrEqual(1);
    expect(events.change[events.change.length - 1]).toBe(0.75);
    // Uncontrolled, so React wrote no value.
    expect(handle.value).toBeNull();
    // A finished drag has to stop its frame callback, and it has to stay stopped.
    const delivered = events.change.length;
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
    await sleep(150);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
    expect(events.change.length).toBe(delivered);
  });

  if (Platform.OS === 'android') {
    // Android only: the harness' iOS touch has no HID event behind it, and SwiftUI's
    // gestures refuse it. With `0..4 step 1`, Material 3 snaps a touch to the nearest
    // tick before deciding whether the value changed, so a press on the thumb's own
    // tick moves nothing.
    it('reports a gesture for a touch that never moves the thumb, in drag order', async () => {
      const events = newEvents();
      // `s`, `v`, `c` in arrival order, with one `v` per run of changes.
      const order: string[] = [];
      await render(
        <Slider
          minimumValue={0}
          maximumValue={4}
          step={1}
          defaultValue={2}
          onValueChange={(value) => {
            events.change.push(value);
            if (order[order.length - 1] !== 'v') order.push('v');
          }}
          onSlidingStart={(value) => {
            events.start.push(value);
            order.push('s');
          }}
          onSlidingComplete={(value) => {
            events.complete.push(value);
            order.push('c');
          }}
          testID="press-order"
          hybridRef={captureFor('press-order')}
        />
      );
      const box = await waitForBox('press-order');
      const handle = await handleFor('press-order');
      console.log(`press-order: box=${describeBox(box)}`);

      // 1. Dead centre, on the thumb's own tick: a start and a complete, no change.
      await pressInBox(box, 0.5);
      await settleEvents(events);
      expect(order).toEqual(['s', 'c']);
      expect(events.start).toEqual([2]);
      expect(events.complete).toEqual([2]);
      expect(events.change).toEqual([]);

      // 2. A quarter of the way along: the value moves, so all three arrive in order.
      await pressInBox(box, 0.25);
      await settleEvents(events);
      expect(order).toEqual(['s', 'c', 's', 'v', 'c']);
      expect(events.start).toEqual([2, 2]);
      expect(events.change).toEqual([1]);
      expect(events.complete).toEqual([2, 1]);

      // 3. The same press again, where nothing moves: it still reports a gesture.
      await pressInBox(box, 0.25);
      await settleEvents(events);
      expect(order).toEqual(['s', 'c', 's', 'v', 'c', 's', 'c']);
      expect(events.start).toEqual([2, 2, 1]);
      expect(events.complete).toEqual([2, 1, 1]);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
      await sleep(150);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
      expect(order.length).toBe(7);
    });

    it('reconciles a write from JS while a real finger is down', async () => {
      // Material 3 applies a tap when the finger lifts, so a held press is an open
      // gesture that has selected nothing yet. The write lands inside it.
      const events = newEvents();
      const order: string[] = [];
      const held = (value: number) => (
        <Slider
          value={value}
          step={0.1}
          onValueChange={(v) => {
            events.change.push(v);
            if (order[order.length - 1] !== 'v') order.push('v');
          }}
          onSlidingStart={(v) => {
            events.start.push(v);
            order.push('s');
          }}
          onSlidingComplete={(v) => {
            events.complete.push(v);
            order.push('c');
          }}
          testID="held-write"
          hybridRef={captureFor('held-write')}
        />
      );
      const { rerender } = await render(held(0.2));
      const box = await waitForBox('held-write');
      const handle = await handleFor('held-write');

      // Held dead centre: Material 3 insets the track by half a thumb at each end, so
      // the middle is the one point where a fraction of the box is the same fraction
      // of the track. 2500 ms leaves room to write mid-press on a busy emulator.
      const holding = pressInBox(box, 0.5, 2500);
      try {
        await pollUntil(
          () => (events.start.length > 0 ? true : null),
          () =>
            new Error(
              'a touch-down reported no onSlidingStart (order=' +
                `${order.join('')}).`
            ),
          3000
        );
        // Let anything this touch has already produced reach JS before the write.
        await sleep(250);
        expect(order).toEqual(['s']);
        expect(events.start).toEqual([0.2]);
        expect(events.complete).toEqual([]);

        await rerender(held(0.9));
        // The write has to reach the control inside the gesture. Polled, because on
        // Android a commit lands a moment after `rerender` resolves.
        await waitFor(() => expect(handle.value).toBe(0.9));
        // A write is not a gesture: no change comes back, and the finger's gesture
        // stays open.
        await sleep(250);
        expect(order).toEqual(['s']);
        expect(events.change).toEqual([]);
        expect(events.complete).toEqual([]);
      } finally {
        // Always wait for the release: a throw above would otherwise leave the finger
        // down, and its release would land in the next test.
        await holding;
      }
      await settleEvents(events);
      console.log(
        `held-write: order=${order.join('')} ` +
          `start=${JSON.stringify(events.start)} ` +
          `change=${JSON.stringify(events.change)} ` +
          `complete=${JSON.stringify(events.complete)}`
      );
      // One gesture: the 0.5 under the finger wins over the 0.9 the app wrote, and the
      // app is told so with a change before the complete.
      expect(order).toEqual(['s', 'v', 'c']);
      expect(events.start).toEqual([0.2]);
      expect(events.change).toEqual([0.5]);
      expect(events.complete).toEqual([0.5]);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
      await sleep(150);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);

      // The next gesture reports itself exactly once. Counted, not read for value: a
      // write refused mid-gesture can still land afterwards and move the thumb.
      const startsAfter = events.start.length;
      const completesAfter = events.complete.length;
      await pressInBox(box, 0.5);
      await settleEvents(events);
      expect(events.start.length).toBe(startsAfter + 1);
      expect(events.complete.length).toBe(completesAfter + 1);
    });

    // Injects an event batch carrying more than one pointer event, which a real
    // finger produces and the harness' press cannot. Compose applies a drag's values
    // from a coroutine after the pass that read the release, so the last value of a
    // gesture can arrive after its release was seen.
    async function streamOrder(
      testId: string,
      mode: number
    ): Promise<{
      events: SlideEvents;
      order: string[];
      handle: SliderHandle;
    }> {
      // This helper runs more than once inside one `it`, so the previous tree is
      // removed first.
      cleanup();
      const events = newEvents();
      const order: string[] = [];
      await render(
        <Slider
          defaultValue={0.2}
          onValueChange={(value) => {
            events.change.push(value);
            if (order[order.length - 1] !== 'v') order.push('v');
          }}
          onSlidingStart={(value) => {
            events.start.push(value);
            order.push('s');
          }}
          onSlidingComplete={(value) => {
            events.complete.push(value);
            order.push('c');
          }}
          testID={testId}
          hybridRef={captureFor(testId)}
        />
      );
      await waitForBox(testId);
      const handle = await handleFor(testId);
      await injectPointerStream(handle, mode);
      await settleEvents(events);
      return { events, order, handle };
    }

    it('reports one gesture when the release shares a batch with the last move', async () => {
      // Mode 0 crosses the touch slop a turn before the release, so the drag is under
      // way when the release arrives. Mode 3 crosses it in the batch that carries
      // the release.
      for (const mode of [0, 3]) {
        const { events, order, handle } = await streamOrder(
          `batched-${String(mode)}`,
          mode
        );
        console.log(
          `batched-${String(mode)}: order=${order.join('')} ` +
            `start=${JSON.stringify(events.start)} ` +
            `change=${JSON.stringify(events.change)} ` +
            `complete=${JSON.stringify(events.complete)}`
        );
        // One gesture, and its complete reports the value the last move landed on.
        expect(order).toEqual(['s', 'v', 'c']);
        expect(events.start.length).toBe(1);
        expect(events.complete.length).toBe(1);
        expect(events.complete[0]).toBe(
          events.change[events.change.length - 1]
        );
        expect(handle.nuiTestFramePumpArmed()).toBe(false);
        await sleep(150);
        expect(handle.nuiTestFramePumpArmed()).toBe(false);
      }
    });

    it('closes a stream that is taken over, and one shared by two fingers', async () => {
      // Mode 1: `ACTION_CANCEL`, which is what a parent taking over the stream looks
      // like to this control. The app was told a start, so it is owed the complete.
      const cancelled = await streamOrder('stream-cancel', 1);
      console.log(
        `stream-cancel: order=${cancelled.order.join('')} ` +
          `start=${JSON.stringify(cancelled.events.start)} ` +
          `complete=${JSON.stringify(cancelled.events.complete)}`
      );
      expect(cancelled.order).toEqual(['s', 'c']);
      expect(cancelled.events.complete).toEqual(cancelled.events.start);
      expect(cancelled.handle.nuiTestFramePumpArmed()).toBe(false);

      // Mode 2: a second finger joins and leaves mid-gesture. Still one start and one
      // complete.
      const shared = await streamOrder('stream-two-pointers', 2);
      console.log(
        `stream-two-pointers: order=${shared.order.join('')} ` +
          `start=${JSON.stringify(shared.events.start)} ` +
          `complete=${JSON.stringify(shared.events.complete)}`
      );
      expect(shared.order[0]).toBe('s');
      expect(shared.order[shared.order.length - 1]).toBe('c');
      expect(shared.events.start.length).toBe(1);
      expect(shared.events.complete.length).toBe(1);
      expect(shared.handle.nuiTestFramePumpArmed()).toBe(false);
    });

    it('closes the drag when the control goes inert mid-press', async () => {
      // Disabling a control removes its pointer modifiers, and Compose cancels their
      // loops without delivering a release. The component has to close the open
      // gesture itself.
      const events = newEvents();
      const order: string[] = [];
      const held = (disabled: boolean) => (
        <Slider
          value={0.2}
          disabled={disabled}
          onValueChange={(value) => {
            events.change.push(value);
            if (order[order.length - 1] !== 'v') order.push('v');
          }}
          onSlidingStart={(value) => {
            events.start.push(value);
            order.push('s');
          }}
          onSlidingComplete={(value) => {
            events.complete.push(value);
            order.push('c');
          }}
          testID="inert-mid-press"
          hybridRef={captureFor('inert-mid-press')}
        />
      );
      const { rerender } = await render(held(false));
      let box = await waitForBox('inert-mid-press');
      const handle = await handleFor('inert-mid-press');

      const holding = pressInBox(box, 0.5, 2500);
      try {
        await pollUntil(
          () => (order.length > 0 ? true : null),
          () =>
            new Error(
              'a touch-down reported no onSlidingStart (order=' +
                `${order.join('')}).`
            ),
          3000
        );
        expect(order).toEqual(['s']);

        await rerender(held(true));
        await waitFor(() => expect(handle.disabled).toBe(true));
        await sleep(250);
        expect(order).toEqual(['s', 'c']);
        expect(events.complete).toEqual([0.2]);
        expect(handle.nuiTestFramePumpArmed()).toBe(false);
      } finally {
        await holding;
      }
      await settleEvents(events);
      // The finger's later release reports nothing further.
      expect(order).toEqual(['s', 'c']);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);

      // Enabled again, the next press opens and closes its own gesture.
      await rerender(held(false));
      await waitFor(() => expect(handle.disabled).toBe(false));
      box = await waitForBox('inert-mid-press');
      await pressInBox(box, 0.5);
      await settleEvents(events);
      console.log(
        `inert-mid-press: order=${order.join('')} ` +
          `start=${JSON.stringify(events.start)} ` +
          `change=${JSON.stringify(events.change)} ` +
          `complete=${JSON.stringify(events.complete)}`
      );
      expect(events.start.length).toBe(2);
      expect(events.complete.length).toBe(2);
      expect(order[order.length - 1]).toBe('c');
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
    });
  }

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

    // Eight moves queued inside one main-thread turn: no frame can pass between
    // them, so exactly one event.
    await drag(handle, events, 0.9, 8, 0);
    console.log(
      `coalesce: same-turn moves=8 events=${String(events.change.length)}`
    );
    expect(events.change.length).toBe(1);
    expect(events.change[0]).toBe(0.9);

    // Five moves spread over frames must produce several events, or the single
    // event above would only show that events stopped flowing.
    const before = events.change.length;
    await drag(handle, events, 0.2, 5, 70);
    const emitted = events.change.length - before;
    console.log(`coalesce: spread moves=5 events=${String(emitted)}`);
    expect(emitted).toBeGreaterThanOrEqual(2);
    expect(emitted).toBeLessThanOrEqual(5);
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

    // 0.33 is not a legal value at step 0.1: every event is a multiple of the step.
    let handle = await handleFor('step-tenths');
    await drag(handle, stepped, 0.33, 6, 0);
    console.log(`quantise tenths: ${JSON.stringify(stepped.change)}`);
    expect(stepped.complete).toEqual([0.3]);
    for (const value of stepped.change) {
      expect(Math.abs(value * 10 - Math.round(value * 10))).toBeLessThan(1e-9);
    }

    // The range does not end on a step, and its top must still be reachable.
    await waitForBox('step-thirds');
    handle = await handleFor('step-thirds');
    await drag(handle, uneven, 0.95, 6, 0);
    console.log(`quantise thirds: ${JSON.stringify(uneven.change)}`);
    expect(uneven.complete).toEqual([1]);

    // A negative range: steps are counted from the Slider's own minimum.
    await waitForBox('step-negative');
    handle = await handleFor('step-negative');
    await drag(handle, negative, -2.6, 6, 0);
    console.log(`quantise negatives: ${JSON.stringify(negative.change)}`);
    expect(negative.complete).toEqual([-3]);
  });

  it('reverts a change JS rejected', async () => {
    // The handler never updates state, so `value` stays 0.2 after native displayed
    // 0.8. The next drag starting from 0.2 shows the thumb was put back.
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
    await waitFor(() =>
      expect(handle.mostRecentEventCount).toBeGreaterThanOrEqual(1)
    );

    await drag(handle, events, 0.4, 5, 0);
    console.log(`rejected: starts=${JSON.stringify(events.start)}`);
    expect(events.start).toEqual([0.2, 0.2]);
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

    // Awaited: the props only reach native in the commit `rerender` resolves on.
    await rerender(
      <Slider
        value={0.6}
        onValueChange={(value) => events.change.push(value)}
        onSlidingStart={(value) => events.start.push(value)}
        onSlidingComplete={(value) => events.complete.push(value)}
        testID="from-js"
        hybridRef={captureFor('from-js')}
      />
    );
    // Wait for the write to land before dragging. `handle.value` is the prop native
    // was given; the drag's start value is what it displays.
    await waitFor(() => expect(handle.value).toBe(0.6));
    await drag(handle, events, 0.9, 5, 0);
    console.log(`from JS: starts=${JSON.stringify(events.start)}`);
    expect(events.start).toEqual([0.6]);
  });

  it('finishes a drag that a write from JS lands inside', async () => {
    // A write that lands inside a drag has three legitimate outcomes: it is refused
    // while a sample is pending, and the release reports the drag; it arrives with
    // nothing pending and wins, and the release reports the app's value; or it is
    // refused and lands after the release. So this asserts what holds in all three:
    // one complete per start, start and end values that some participant really
    // held, every change on the step, and the frame pump stopped.
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
      // The write is injected at a different offset into the drag each round.
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
      expect(events.complete.length).toBe(before + 1);
      const release = events.complete[before]!;
      releases.push(release);
      expect(events.start.length).toBe(events.complete.length);
      // The gesture began from the value the last one reported, or from the app's
      // write. The first gesture begins before any write exists.
      const atStart = attempt === 0 ? [mounted] : [beganFrom, written];
      expect(atStart).toContain(events.start[before]);
      // It stopped on the drag's target or on the value React had committed. In the
      // first round that can still be the mounted value.
      const atEnd =
        attempt === 0 ? [target, written, mounted] : [target, written];
      expect(atEnd).toContain(release);
      for (const value of events.change) {
        const offGrid = Math.abs(value * 10 - Math.round(value * 10));
        expect(offGrid).toBeLessThan(1e-9);
      }
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
    }
    console.log(
      `mid-drag write: 5 attempts, release values=${JSON.stringify(releases)} ` +
        `(wrote ${written}, dragged to ${target})`
    );
    // A clean drag afterwards begins from one of the two values the last round could
    // have left on the thumb, and ends where it was dragged to.
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
    // The second drag began where the first ended.
    expect(events.start).toEqual([0.4, 0.7]);
    expect(events.complete).toEqual([0.7, 0.15]);
  });

  it('keeps the thumb ahead of a slow JS handler', async () => {
    // The handler burns 100 ms of JS time per event, so JS falls far behind the
    // finger.
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

    // Six moves 50 ms apart, each in its own frame at any refresh rate, so the upper
    // bound on events is the number of moves.
    await drag(handle, events, 0.95, 6, 50);
    const duringDrag = events.change.length;
    console.log(
      `slow JS: events=${String(duringDrag)} for 6 moves over ~300ms`
    );
    expect(events.complete).toEqual([0.95]);
    expect(duringDrag).toBeGreaterThanOrEqual(1);
    expect(duringDrag).toBeLessThanOrEqual(6);

    // The next drag starts at 0.95: native displayed it without waiting for JS.
    await drag(handle, events, 0.3, 4, 0);
    expect(events.start[1]).toBe(0.95);
  });

  it('ignores a drag while disabled, and follows the flag back', async () => {
    // Both controls are in one tree: the harness' `render` replaces whatever is
    // rendered, so a second `render()` would unmount the control under test.
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
    // A barrier: a complete gesture from another control shows the event pipeline
    // flushed, so the empty arrays below mean nothing arrived, not nothing yet.
    await waitForBox('barrier');
    const barrierHandle = await handleFor('barrier');
    await drag(barrierHandle, barrierEvents, 0.6, 3, 0);
    expect(barrierEvents.complete).toEqual([0.6]);
    expect(barrierEvents.change.length).toBeGreaterThan(0);
    expect(events.start).toEqual([]);
    expect(events.change).toEqual([]);
    expect(events.complete).toEqual([]);
    expect(handle.mostRecentEventCount).toBe(0);
    // The probe reads the real accessibility tree, so this is what a screen reader
    // is told.
    expect(await accessibilityStepReport(handle, 1)).toContain('disabled=true');

    // Same instance, new flag: interaction returns without a remount.
    await rerender(tree(false));
    expect(handles.get('off-limits')).toBe(handle);
    await waitFor(() => expect(handle.disabled).toBe(false));
    await drag(handle, events, 0.9, 4, 0);
    expect(events.start).toEqual([0.6]);
    expect(events.complete).toEqual([0.9]);
    expect(await accessibilityStepReport(handle, 1)).toContain(
      'disabled=false'
    );
  });

  it('follows a new range and tint on the same instance', async () => {
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
    // `processColor` is unsigned on iOS and signed on Android, so the expected number
    // is computed on this platform.
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
    // The removed tint shows this commit landed. `handle.value` cannot: the control
    // is uncontrolled, so it answers `null` before and after.
    await waitFor(() => expect(handle.tintColor).toBeNull());
    await drag(handle, events, 42, 5, 0);
    console.log(
      `range change: starts=${JSON.stringify(events.start)} complete=${JSON.stringify(events.complete)}`
    );
    expect(handle.tintColor).toBeNull();
    // 0.5 is inside 0...100 but not on step 5, so the displayed value moved onto the
    // new grid.
    expect(events.start).toEqual([0]);
    expect(events.complete).toEqual([40]);
  });

  it('does not resume an abandoned drag after its view is gone', async () => {
    // The moves of a simulated drag are queued on the main thread, so some are still
    // pending when the view is dropped. A reused instance must not receive them.
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
    // The gesture really is in flight: its frame callback is live.
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
    expect(abandonedHandle.nuiTestFramePumpArmed()).toBe(false);
    expect(second.change).toEqual([]);
    expect(second.start).toEqual([]);
    expect(second.complete).toEqual([]);
    expect(nextHandle.mostRecentEventCount).toBe(0);
    // Whether the instance was reused is asserted too. On iOS Fabric's pool hands
    // the same Hybrid View to the next Slider, so the checks above are about one
    // control with two owners. On Android an unmount and mount at the root gets a
    // fresh instance.
    console.log(
      `abandoned drag: reused=${String(nextHandle === abandonedHandle)}`
    );
    if (Platform.OS === 'ios') {
      expect(nextHandle).toBe(abandonedHandle);
    } else {
      expect(nextHandle).not.toBe(abandonedHandle);
    }

    // Its own drag starts from its own seed, not from where the abandoned one got to.
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
    // The label is on the hosted control, not on the container. The harness' query
    // finds it on iOS. On Android it matches `View.contentDescription`, and Compose
    // semantics are not Views, so the query answers null there whatever the
    // component does.
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
    // The probe performs the platform's own action: VoiceOver's
    // `accessibilityIncrement`, or the Compose `SetProgress` action TalkBack
    // invokes. `0…12 step 3` ends on a step; `0…10 step 3` does not, and its top
    // must still be reachable.
    const aligned = newEvents();
    const uneven = newEvents();
    const atTheTop = newEvents();
    // What each control displays before a reader touches it.
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

    // Each step reports one gesture's worth of callbacks, like a thumb release.
    const walkTo = async (
      what: string,
      handle: SliderHandle,
      events: SlideEvents,
      direction: number,
      expected: number[]
    ) => {
      const seed = seeds.get(events)!;
      // Counted before the press: its callbacks reach JS asynchronously, so its
      // release can still be queued when the probe has already answered.
      const press = events.complete.length;
      const report = await accessibilityStepReport(handle, direction);
      console.log(`a11y step ${what}: ${report}`);
      expectPerformed(report, what);
      await dragCompleted(events, press + 1, 5000);
      expect(events.complete).toEqual(expected.slice(0, press + 1));
      // Each step starts from the control's seed or from the previous value.
      expect(events.start[press]).toEqual(
        press === 0 ? seed : expected[press - 1]
      );
      expect(events.start.length).toBe(events.complete.length);
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
    };

    await walkTo('aligned +3', alignedHandle, aligned, 1, [3]);
    await walkTo('aligned +6', alignedHandle, aligned, 1, [3, 6]);
    await walkTo('aligned +9', alignedHandle, aligned, 1, [3, 6, 9]);
    await walkTo('aligned +12', alignedHandle, aligned, 1, [3, 6, 9, 12]);
    // At the top there is no next value, and no callbacks.
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

    // 0…10 step 3: the grid is 0, 3, 6, 9, and the bound 10 stays reachable.
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

    // A thumb drag after the steps still starts from where the reader left the value.
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

  it('steps up twice when a reader presses again before the a11y tree catches up', async () => {
    // On Android a reader's step arrives as a target computed from the progress the
    // control last published, and the published progress can be a frame behind the
    // model. Both presses are posted before the UI thread runs either, so the second
    // aims from the stale progress and must still move up. iOS is handed a direction
    // instead of a target.
    const events = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={0}
          maximumValue={12}
          step={3}
          defaultValue={0}
          onValueChange={(v) => events.change.push(v)}
          onSlidingStart={(v) => events.start.push(v)}
          onSlidingComplete={(v) => events.complete.push(v)}
          testID="a11y-double-press"
          hybridRef={captureFor('a11y-double-press')}
        />
      </View>
    );
    await waitForBox('a11y-double-press');
    const handle = await handleFor('a11y-double-press');

    handle.nuiTestAccessibilityStep(1);
    handle.nuiTestAccessibilityStep(1);

    await dragCompleted(events, 2, 5000);
    console.log(
      `a11y double press: start=${JSON.stringify(events.start)} ` +
        `change=${JSON.stringify(events.change)} ` +
        `complete=${JSON.stringify(events.complete)}`
    );
    expect(events.start).toEqual([0, 3]);
    expect(events.change).toEqual([3, 6]);
    expect(events.complete).toEqual([3, 6]);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('steps up three times when a reader presses twice more before the a11y tree catches up', async () => {
    // All three presses are posted in one JS turn, so all three aim from the progress
    // published before any of them ran.
    const events = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={0}
          maximumValue={12}
          step={3}
          defaultValue={0}
          onValueChange={(v) => events.change.push(v)}
          onSlidingStart={(v) => events.start.push(v)}
          onSlidingComplete={(v) => events.complete.push(v)}
          testID="a11y-triple-press"
          hybridRef={captureFor('a11y-triple-press')}
        />
      </View>
    );
    await waitForBox('a11y-triple-press');
    const handle = await handleFor('a11y-triple-press');

    handle.nuiTestAccessibilityStep(1);
    handle.nuiTestAccessibilityStep(1);
    handle.nuiTestAccessibilityStep(1);

    await dragCompleted(events, 3, 5000);
    console.log(
      `a11y triple press (press 3): ${handle.nuiTestAccessibilityStepReport()}`
    );
    expect(events.start).toEqual([0, 3, 6]);
    expect(events.change).toEqual([3, 6, 9]);
    expect(events.complete).toEqual([3, 6, 9]);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('steps a tenths grid the way the node publishes it', async () => {
    // The semantics node carries the progress as a `Float`: 0.3 comes back slightly
    // above the model's `Double` and 0.7 slightly below. Each press still has to move
    // exactly one grid stop on a grid that is nowhere exact in binary.
    const events = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={0}
          maximumValue={1}
          step={0.1}
          defaultValue={0.1}
          onValueChange={(v) => events.change.push(v)}
          onSlidingStart={(v) => events.start.push(v)}
          onSlidingComplete={(v) => events.complete.push(v)}
          testID="a11y-tenths"
          hybridRef={captureFor('a11y-tenths')}
        />
      </View>
    );
    await waitForBox('a11y-tenths');
    const handle = await handleFor('a11y-tenths');

    const directions = [1, 1, 1, 1, -1];
    const destinations = [0.2, 0.3, 0.4, 0.5, 0.4];
    const beginnings = [0.1, 0.2, 0.3, 0.4, 0.5];
    for (const [index, direction] of directions.entries()) {
      const report = await accessibilityStepReport(handle, direction);
      console.log(
        `a11y tenths press ${String(index + 1)} (${
          direction > 0 ? 'up' : 'down'
        }): ${report}`
      );
      expectPerformed(report, `tenths press ${String(index + 1)}`);
      await dragCompleted(events, index + 1, 5000);
      expect(events.complete).toEqual(destinations.slice(0, index + 1));
      expect(events.start).toEqual(beginnings.slice(0, index + 1));
      expect(handle.nuiTestFramePumpArmed()).toBe(false);
    }
    expect(events.change).toEqual(destinations);
  });

  it('does not step when a reader asks for the value it was shown', async () => {
    // A narrow window over a large offset, such as epoch milliseconds. Adjacent
    // `Float`s at 1e9 are 64 apart, so the node publishes `1000000000` for
    // `1000000010`, and the target Android computes for a step is that same
    // published progress. Such a target is not a direction, so nothing moves. iOS is
    // handed a direction instead of a number, so the press steps there.
    const narrow = newEvents();
    const wide = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={1000000000}
          maximumValue={1000000200}
          step={10}
          defaultValue={1000000010}
          onValueChange={(v) => narrow.change.push(v)}
          onSlidingStart={(v) => narrow.start.push(v)}
          onSlidingComplete={(v) => narrow.complete.push(v)}
          testID="a11y-offset-narrow"
          hybridRef={captureFor('a11y-offset-narrow')}
        />
        <Slider
          minimumValue={1000000000}
          maximumValue={1000100000}
          step={20000}
          defaultValue={1000020000}
          onValueChange={(v) => wide.change.push(v)}
          onSlidingStart={(v) => wide.start.push(v)}
          onSlidingComplete={(v) => wide.complete.push(v)}
          testID="a11y-offset-wide"
          hybridRef={captureFor('a11y-offset-wide')}
        />
      </View>
    );
    await waitForBox('a11y-offset-narrow');
    const narrowHandle = await handleFor('a11y-offset-narrow');
    const wideHandle = await handleFor('a11y-offset-wide');
    const shown = 1000000010;

    const report = await accessibilityStepReport(narrowHandle, 1);
    console.log(`a11y offset (narrow, up): ${report}`);
    expectPerformed(
      report,
      'a11y press on a narrow window over a large offset'
    );

    if (Platform.OS === 'android') {
      // The fixture's premise: the published progress differs from the model's value,
      // and the computed target equals the published progress.
      const published = /@(-?[0-9.Ee+]+)/.exec(report);
      const target = /SetProgress\((-?[0-9.Ee+]+)\)/.exec(report);
      expect(published).not.toBeNull();
      expect(target).not.toBeNull();
      const publishedValue = Number(published?.[1]);
      const targetValue = Number(target?.[1]);
      expect(publishedValue).toBe(1000000000);
      expect(targetValue).toBe(publishedValue);
      // Compared with the model's `Double`, this target would read as a decrement.
      expect(targetValue).toBeLessThan(shown);
      expect(narrow.start).toEqual([]);
      expect(narrow.change).toEqual([]);
      expect(narrow.complete).toEqual([]);
      expect(narrowHandle.nuiTestFramePumpArmed()).toBe(false);
    } else {
      await dragCompleted(narrow, 1, 5000);
      expect(narrow.complete).toEqual([1000000020]);
    }

    // The same magnitude with a window a `Float` can stride still steps, on both
    // platforms. Its `step` is coarse so Material 3 has few tick marks to draw.
    const wideReport = await accessibilityStepReport(wideHandle, 1);
    console.log(`a11y offset (wide, up): ${wideReport}`);
    expectPerformed(wideReport, 'a11y press on a window the float can stride');
    await dragCompleted(wide, 1, 5000);
    expect(wide.complete).toEqual([1000040000]);
    expect(wideHandle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('folds a screen reader step into a drag the finger has not released', async () => {
    // A screen reader step inside a finger's drag must not open or close a gesture
    // of its own. Both test methods post to the main thread in call order, so the
    // step lands after the drag has opened and before its first queued move.
    const events = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={0}
          maximumValue={12}
          step={3}
          defaultValue={0}
          onValueChange={(v) => events.change.push(v)}
          onSlidingStart={(v) => events.start.push(v)}
          onSlidingComplete={(v) => events.complete.push(v)}
          testID="step-in-drag"
          hybridRef={captureFor('step-in-drag')}
        />
      </View>
    );
    await waitForBox('step-in-drag');
    const handle = await handleFor('step-in-drag');

    // Three moves 200 ms apart keep the drag open for about 650 ms.
    handle.nuiTestDrag(9, 3, 200);
    const report = await accessibilityStepReport(handle, 1);
    console.log(`step in drag: ${report}`);
    expectPerformed(report, 'a11y step inside a finger drag');

    // Wait out the whole gesture: an early complete would be the wrong one.
    await dragCompleted(events, 1, 4000);
    await sleep(1200);
    console.log(
      `step in drag: starts=${JSON.stringify(events.start)} ` +
        `change=${JSON.stringify(events.change)} ` +
        `complete=${JSON.stringify(events.complete)}`
    );
    expect(events.start).toEqual([0]);
    expect(events.complete).toEqual([9]);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('renders a range whose two ends are the wrong way round', async () => {
    // Swift's `ClosedRange` traps when its lower bound is above its upper, and
    // Kotlin's `coerceIn` throws. An inverted range is treated as a one-value range
    // whose value is `minimumValue`.
    const events = newEvents();
    await render(
      <View style={{ width: 300 }}>
        <Slider
          minimumValue={5}
          maximumValue={1}
          defaultValue={5}
          onValueChange={(v) => events.change.push(v)}
          onSlidingStart={(v) => events.start.push(v)}
          onSlidingComplete={(v) => events.complete.push(v)}
          testID="inverted-range"
          hybridRef={captureFor('inverted-range')}
        />
      </View>
    );
    const box = await waitForBox('inverted-range');
    const handle = await handleFor('inverted-range');
    expect(Math.abs(box.height - EXPECTED_HEIGHT)).toBeLessThan(1);
    expect(box.width).toBeGreaterThan(100);

    await drag(handle, events, 3, 6, 0);
    console.log(
      `inverted range: starts=${JSON.stringify(events.start)} ` +
        `change=${JSON.stringify(events.change)} ` +
        `complete=${JSON.stringify(events.complete)}`
    );
    expect(events.start).toEqual([5]);
    expect(events.complete).toEqual([5]);
    expect(events.change.every((value) => value === 5)).toBe(true);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);

    // A screen reader's step has no other value to go to.
    expectPerformed(
      await accessibilityStepReport(handle, 1),
      'inverted range, forward'
    );
    expectPerformed(
      await accessibilityStepReport(handle, -1),
      'inverted range, back'
    );
    expect(events.complete).toEqual([5]);
    expect(handle.nuiTestFramePumpArmed()).toBe(false);
  });

  it('renders a range whose two ends are the same value', async () => {
    // Compose's slider does not accept an empty range, so the control is given a
    // widened span. It has to lay out without throwing.
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
});
