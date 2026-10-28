/**
 * On-device tests for the SegmentedControl (task G4).
 *
 * SegmentedControl is the second control whose *size comes from its props*, and
 * the first whose size comes from a *list*: the labels are the width, so the
 * option list is the whole size configuration. That makes this suite the R3 test
 * DECISIONS D16 gives it - does an `options` change move the box Yoga was told -
 * plus the controlled-value story the Switch suite started: a tap paints at once
 * and a change React refuses has to snap back.
 *
 * Three readings, as in the Button suite:
 *  - `harnessUi.queryByTestId` - the box Fabric gave the view;
 *  - `hybridRef.measureContent()` - the size the hosted control measured;
 *  - `nitroUiCore.sizingStats()` / `drainSizingTrace()` - what the engine did.
 *
 * Two things make these tests able to fail (AGENTS.md, "Every new test or gate
 * must be shown to fail"):
 *  - every cold configuration is **poisoned** first (`seedSizingSize` with a size
 *    no segmented control has, then an environment bump), so a correction that
 *    never arrives leaves a visible wrong box *and* costs a correction the test
 *    requires;
 *  - the warm assertions require **zero** corrections, which on a second pass
 *    leaves the measure pass as the only road to the new size.
 *
 * Deliberately absent: a `beforeAll` that mounts a control to "warm the process",
 * which hides the process-local first-instance behaviour D17 is about.
 */
import { useState } from 'react';
import {
  Platform,
  Pressable,
  Text,
  TurboModuleRegistry,
  View,
  processColor,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';
import {
  SegmentedControl,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiSegmentedControl';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back - declared, not imported (DECISIONS D14 keeps
 * Hybrid View types off the public surface). Read-only on purpose.
 */
type SegmentedHandle = {
  readonly options: string[];
  /** The index as React sent it, normalised against `options`; null if uncontrolled. */
  readonly selectedIndex: number | null;
  readonly mostRecentEventCount: number;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  /**
   * Declared optional: a callback prop is not part of what the wrapper
   * advertises (D14), and the runtime object has it. Reading it is how the iOS
   * half of the event contract is asserted where a synthesised tap cannot reach
   * a hosted SwiftUI control - see the Button suite for the measurement.
   */
  readonly onValueChange?: unknown;
  measureContent(): { width: number; height: number };
  /**
   * Ask the platform what this control actually drew, and read the answer back
   * (`nuiTestPixelProbe` is fire-and-forget on the UI thread, so the report arrives
   * on a later read). Declared, not imported: D14 keeps Hybrid View types off the
   * public surface.
   */
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
};

/** Handles by testID, so a test can ask each control what it holds. */
const handles = new Map<string, SegmentedHandle>();
const captureHybrid =
  (testId: string) =>
  (view: SegmentedHandle): void => {
    handles.set(testId, view);
  };

/**
 * Every `onChange` the app has reported, in order: `testID:index`.
 *
 * A selection is the one thing a geometry query cannot see, and re-rendering to
 * show one would spend a render on the measurement. Native holds the callback, so
 * this array is what the event actually reached.
 */
const eventLog: string[] = [];
const recordChange =
  (testId: string) =>
  (event: { index: number }): void => {
    eventLog.push(`${testId}:${String(event.index)}`);
  };

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

/** `after - before` for the counters a test asserts on. */
function delta(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return {
    corrections:
      after.correctionsImmediate -
      before.correctionsImmediate +
      (after.correctionsBatched - before.correctionsBatched),
    immediate: after.correctionsImmediate - before.correctionsImmediate,
    flushes: after.flushes - before.flushes,
    measurements: after.measurements - before.measurements,
    epoch: after.environmentEpoch - before.environmentEpoch,
    cachedSizes: after.cachedSizes - before.cachedSizes,
  };
}

type Size = { width: number; height: number };

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

function sizeOf(testId: string): Size | null {
  return harnessUi.queryByTestId(testId);
}

/**
 * The same box with its position, for a test that taps at an edge of it.
 *
 * `sizeOf` answers with a `Size` because that is all a sizing assertion reads; the
 * coordinates are screen dp, the unit `userEvent.pressAt` takes.
 */
function boxOf(testId: string): ViewInfo | null {
  return harnessUi.queryByTestId(testId);
}

function measured(testId: string): Size | null {
  return handles.get(testId)?.measureContent() ?? null;
}

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

/** Poll until the box of `testId` is `size`, i.e. until a size has really arrived. */
async function waitForBox(testId: string, size: Size, what: string) {
  return await pollUntil(
    () => (sameSize(sizeOf(testId), size) ? sizeOf(testId) : null),
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached ` +
          `${size.width.toFixed(2)}x${size.height.toFixed(2)} - last box ` +
          `${describeSize(sizeOf(testId))}, control measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/**
 * Poll until the control reports a size that is *not* `previous`.
 *
 * `measureContent()` answers with the size the hosted control last measured, and
 * on Android that is still the old one for the frame in which the new option list
 * landed: Compose recomposes and re-measures on the UI thread. Waiting for "a
 * size" would return the pre-change number, so the wait is for a *different* one
 * (see `waitForRemeasure` in the Button suite, which found this first).
 */
async function waitForRemeasure(
  testId: string,
  previous: Size,
  what: string
): Promise<Size> {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && !sameSize(size, previous) ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) still measures ${describeSize(previous)} ` +
          `after the change - control now measures ` +
          `${describeSize(measured(testId))}, so it never re-measured.`
      )
  );
}

/** Poll until the control reports a size (a host measures after its first commit). */
async function waitForMeasured(testId: string, what: string) {
  return await pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () => new Error(`"${testId}" (${what}) never reported a measured size.`)
  );
}

/** Wait for `eventLog` to hold at least `count` entries. */
async function waitForEvents(count: number) {
  return await pollUntil(
    () => (eventLog.length >= count ? eventLog.slice() : null),
    () =>
      new Error(
        `Only ${String(eventLog.length)} of ${String(count)} change events ` +
          `arrived: ${JSON.stringify(eventLog)}.`
      )
  );
}

/**
 * The key `SegmentedControl.tsx` builds: `optionCount|label|label|...`, each label
 * escaped so a `|` or a `\` inside one cannot forge a separator.
 *
 * Written out here rather than imported - a harness that poisoned the cache
 * through the library's own helper could not catch the helper being wrong, and a
 * missing input in that key is precisely the R3 bug class (every later option list
 * inherits the first one's size).
 */
function sizingKey(options: readonly string[]): string {
  return `${String(options.length)}|${options
    .map((label) => label.replace(/[\\|]/g, '\\$&'))
    .join('|')}`;
}

/**
 * A size that is *not* any segmented control's size, planted as the engine's
 * answer for a configuration before it is first mounted.
 *
 * The declared fallback is deliberately close to the truth (D17), which on its own
 * would make every "the box was right" assertion pass even if no correction ever
 * arrived. A poisoned entry is provisional, so it lays the first frame out and
 * then *must* be replaced: the test requires both the right final box and at least
 * one correction.
 */
const WRONG_SIZE = { width: 13.25, height: 66.5 };

/** Plant a wrong answer for several configurations, then drop the cache once. */
function poisonConfigurations(keys: readonly string[]): void {
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

/** Let queued work land before reading counters that only move on a later turn. */
async function settle(ms = 250): Promise<void> {
  await sleep(ms);
}

/**
 * Ask `testId`'s control what colour it drew, and wait for that probe's own answer.
 *
 * `nuiTestPixelProbe` is fire-and-forget: reading pixels needs the UI thread and a
 * Nitro method may not block for it, so the result arrives on a later read of
 * `nuiTestPixelReport`. Each report is numbered (`n=3 …`) precisely so this can wait
 * for *this* probe rather than for the previous one to have gone stale - the same
 * reason Slider's `accessibilityStepReport` helper polls on change.
 */
async function pixelProbe(
  testId: string,
  color: number,
  what: string
): Promise<string> {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(
      `testID "${testId}" has no handle - it was never rendered.`
    );
  }
  const before = handle.nuiTestPixelReport();
  handle.nuiTestPixelProbe(color);
  const report = await pollUntil(
    () => {
      const next = handle.nuiTestPixelReport();
      return next === before || next === '' ? null : next;
    },
    () =>
      new Error(
        `the pixel probe for "${testId}" (${what}) never reported. Last report: ` +
          `"${handle.nuiTestPixelReport()}".`
      ),
    8000
  );
  // A report that sampled nothing means the control drew nothing at all - a view that
  // is not on screen, or a host whose layer is empty. Waiting on that would make every
  // later assertion pass for the wrong reason, so it fails here, where it reads.
  if (/no pixels|no image|no context|no colour|size=0x/.test(report)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) sampled nothing: ${report}`
    );
  }
  // The report's own shape, checked on every probe rather than trusted. Both
  // platforms composite over a backdrop and average the whole control into `mean`, and
  // an average is exactly where an arithmetic slip hides: iOS's first version weighted
  // each channel by the pixel's alpha - always 255 once composited - and divided by the
  // pixel count, so every channel came out 255x too large and the sum spilled out of
  // the six digits it prints into (`mean=#8FAFB6EB`). A malformed `mean` is not only
  // unreadable, it is a field a later round was invited to assert on, so a platform that
  // starts overrunning it has to fail here rather than read as a colour nobody expected.
  if (!/ mean=#[0-9A-F]{6}( |$)/.test(report)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) reported a mean that is not six ` +
        `hex digits: ${report}`
    );
  }
  return report;
}

/**
 * Require the probe report to say the colour was, or was not, on the screen.
 *
 * Thrown rather than `expect(...).toMatch`, because the whole diagnosis is in the
 * report line - the size, how many pixels hit, the mean colour and the nearest one
 * found - and Jest shortens long strings in a matcher failure.
 */
function expectPixels(
  report: string,
  want: 'present' | 'absent',
  what: string
): void {
  const hits = /hits=(\d+)/.exec(report)?.[1];
  if (hits == null) {
    throw new Error(`${what}: the probe reported no hit count: ${report}`);
  }
  const found = Number(hits) > 0;
  if (found !== (want === 'present')) {
    throw new Error(
      `${what}: expected the probed colour to be ${want} on screen, and the ` +
        `platform said ${report}`
    );
  }
}

/**
 * Tap the middle of segment `index` of `testId` and require exactly one change event
 * for that index.
 *
 * `pressBothEnds` taps both ends and compares the whole log, which is what its own
 * test wants and what this one cannot use: the tint test taps one segment at a time and
 * needs to know which tap moved it. The centre is a fair target here because the row is
 * as wide as its labels - no over-wide fitting is involved, so no segment is off box.
 */
async function tapSegment(
  testId: string,
  index: number,
  optionCount: number
): Promise<void> {
  const box = boxOf(testId);
  expect(box).not.toBeNull();
  const before = eventLog.length;
  await userEvent.pressAt(
    box!.x + (box!.width * (2 * index + 1)) / (2 * optionCount),
    box!.y + box!.height / 2
  );
  await waitForEvents(before + 1);
  expect(eventLog.slice(before)).toEqual([`${testId}:${String(index)}`]);
}

/**
 * Tap both ends of a control's box and require `expected` to be the log after.
 *
 * The tap is the only honest oracle for where a hosted row's segments actually
 * are: the harness dispatches real MotionEvents from the window root, so Compose
 * hit-tests this the way a finger is hit-tested, while its segments are virtual
 * nodes that no geometry query can see. Both ends matter - content drawn wider
 * than its box is centred, so each end of the box shows a *different* neighbour's
 * segment - and the expected log is spelled out by the caller so a test that taps
 * twice reads as one sequence.
 */
async function pressBothEnds(
  testId: string,
  expected: readonly string[]
): Promise<void> {
  const box = boxOf(testId);
  expect(box).not.toBeNull();
  await userEvent.pressAt(box!.x + box!.width - 2, box!.y + box!.height / 2);
  await userEvent.pressAt(box!.x + 2, box!.y + box!.height / 2);
  // Joined, so a red run says which segment got the tap: the harness prints an
  // array diff abbreviated (`…(2)`), which hides exactly the fact under test.
  expect((await waitForEvents(expected.length)).join(',')).toEqual(
    [...expected].join(',')
  );
}

const rowStyle: StyleProp<ViewStyle> = { gap: 6 };

afterEach(() => {
  cleanup();
  handles.clear();
  eventLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

describe('SegmentedControl · G4', () => {
  it('lays each option list out at the size the control measured', async () => {
    // The base R3 claim for this component: the labels are the width, so three
    // option lists in one row must get three boxes. A missing `options` input in
    // the sizing key, or a host that never reports, both look like a row of
    // identical boxes from here.
    const SHORT = ['Go'];
    const MIDDLE = ['One', 'Two', 'Three'];
    // Four labels, wide enough to be a third distinct width and narrow enough to
    // fit either device's window. The first version of this list measured 417.14
    // dp on Android against a 411.43 dp screen, and Yoga clamped the box to the
    // window - a true fact about a caller's width winning, but not the claim this
    // test makes. (`['January', …]` is still what `waitForMeasured` reports; only
    // the laid-out box is clamped.)
    const LONG = ['North', 'South', 'East', 'West'];
    poisonConfigurations([
      sizingKey(SHORT),
      sizingKey(MIDDLE),
      sizingKey(LONG),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={rowStyle}>
        <SegmentedControl
          options={SHORT}
          testID="short"
          hybridRef={captureHybrid('short')}
        />
        <SegmentedControl
          options={MIDDLE}
          testID="middle"
          hybridRef={captureHybrid('middle')}
        />
        <SegmentedControl
          options={LONG}
          testID="long"
          hybridRef={captureHybrid('long')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('short');
    const shortSize = await waitForMeasured('short', 'one option');
    await waitForBox('short', shortSize, 'one option');
    const middleSize = await waitForMeasured('middle', 'three options');
    await waitForBox('middle', middleSize, 'three options');
    const longSize = await waitForMeasured('long', 'four options');
    await waitForBox('long', longSize, 'four options');
    for (const testId of ['short', 'middle', 'long']) {
      expect(sameSize(sizeOf(testId), WRONG_SIZE)).toBe(false);
    }
    const cold = delta(before, stats());
    console.log(
      `three lists: short=${describeSize(shortSize)} ` +
        `middle=${describeSize(middleSize)} long=${describeSize(longSize)} ` +
        `cold=${JSON.stringify(cold)}`
    );
    // Three configurations, all poisoned, so three corrections - and three cache
    // entries. One entry shared by two of them is the missing-input bug, and it
    // would also make two of these widths equal.
    expect(cold.corrections).toBeGreaterThanOrEqual(3);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(3);
    expect(middleSize.width).toBeGreaterThan(shortSize.width + 1);
    expect(longSize.width).toBeGreaterThan(middleSize.width + 1);
    // The height is the platform's control height and does not move with the
    // labels - if it did, the fallback (one number per component) would be wrong
    // for every option list but one.
    expect(
      sameSize(shortSize, { width: shortSize.width, height: longSize.height })
    ).toBe(true);
    unmount();
  });

  it('re-measures when the options change (R3)', async () => {
    const SHORT = ['Run'];
    const LONG = ['Run', 'the', 'whole', 'build'];
    poisonConfigurations([sizingKey(SHORT), sizingKey(LONG)]);
    const before = stats();
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={SHORT}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('opts');
    const shortSize = await waitForMeasured('opts', 'the one-option list');
    await waitForBox('opts', shortSize, 'the one-option list');
    const cold = delta(before, stats());
    expect(sameSize(sizeOf('opts'), WRONG_SIZE)).toBe(false);
    expect(cold.corrections).toBeGreaterThanOrEqual(1);

    await rerender(
      <SegmentedControl
        options={LONG}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    const longSize = await waitForRemeasure(
      'opts',
      shortSize,
      'the four-option list'
    );
    await waitForBox('opts', longSize, 'the four-option list');
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);

    await rerender(
      <SegmentedControl
        options={SHORT}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    await waitForBox('opts', shortSize, 'the one-option list again');

    // Warm *now*: both configurations are in the cache, so from here a turn that
    // moves the size must cost no state update (D17). A node that fails to dirty
    // its measurement after an `options` change has only corrections to reach the
    // new size with, and the zero below refuses them.
    await settle(150);
    const warmBefore = stats();
    await rerender(
      <SegmentedControl
        options={LONG}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    await waitForRemeasure('opts', shortSize, 'the four-option list, warm');
    await waitForBox('opts', longSize, 'the four-option list, warm');
    await rerender(
      <SegmentedControl
        options={SHORT}
        testID="opts"
        hybridRef={captureHybrid('opts')}
      />
    );
    await waitForBox('opts', shortSize, 'the one-option list again, warm');
    const warm = delta(warmBefore, stats());
    console.log(
      `options R3: short=${describeSize(shortSize)} long=${describeSize(longSize)} ` +
        `warm=${JSON.stringify(warm)}`
    );
    expect(warm.corrections).toBe(0);
    expect(warm.cachedSizes).toBe(0);
    // ...while the control did re-measure, twice. Zero corrections with zero
    // measurements would mean nothing happened, not that nothing was needed.
    expect(warm.measurements).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('re-reports a key change that keeps the size (R3)', async () => {
    // Review F1's shape, for this component: the option list changes, so the key
    // changes and the engine has no answer for it - but the new list measures what
    // the old one did. Each host skips a report within 0.5 of the size it reported
    // last, so the one report that could move the box off the poisoned guess is
    // the one the dedupe swallows, unless the key change itself resets the memory
    // (`noteSizingKeyChanged`).
    //
    // The same two labels, in the other order. Each platform's width is a sum
    // over segments (measured: `['Left', 'Right']` and `['Right', 'Left']` are
    // 164.95 dp on Android and 102.0 pt on iOS either way), so the two lists
    // measure alike while their keys differ - the one input a caller may really
    // change without moving the control at all.
    const FIRST = ['Left', 'Right'];
    const SECOND = ['Right', 'Left'];
    poisonConfigurations([sizingKey(FIRST), sizingKey(SECOND)]);
    const before = stats();
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={FIRST}
        testID="same"
        hybridRef={captureHybrid('same')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('same');
    const size = await waitForMeasured('same', 'the first list');
    await waitForBox('same', size, 'the first list');
    expect(sameSize(sizeOf('same'), WRONG_SIZE)).toBe(false);
    expect(delta(before, stats()).corrections).toBeGreaterThanOrEqual(1);

    await settle(150);
    const changed = stats();
    await rerender(
      <SegmentedControl
        options={SECOND}
        testID="same"
        hybridRef={captureHybrid('same')}
      />
    );
    // No `waitForRemeasure`: the control may still measure `size`, so the box and
    // the engine's counters are the only readings that can show the fix.
    await settle(500);
    const box = sizeOf('same');
    const after = delta(changed, stats());
    console.log(
      `same-size key change (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(measured('same'))} delta=${JSON.stringify(after)}`
    );
    // The visible bug first: the box would still be the guess.
    expect(sameSize(box, WRONG_SIZE)).toBe(false);
    // ...and the box agrees with what the control measures now, whatever that is.
    expect(sameSize(box, measured('same'))).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('keeps its size when the selection moves', async () => {
    // Material 3 puts a check mark on the *selected* segment by default, which
    // would make the row wider when a segment is chosen - and a size that moves
    // with the selection would have to put the selection in `nuiSizingKey`, which
    // is a cache fragmenter and a re-measure per tap. This component asks for
    // label-only segments; this test is what would notice if that ever changed,
    // on the platform where it would change (Android).
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={['Alpha', 'Beta', 'Gamma']}
        selectedIndex={0}
        testID="sel"
        hybridRef={captureHybrid('sel')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('sel');
    const size = await waitForMeasured('sel', 'the first selection');
    await waitForBox('sel', size, 'the first selection');
    await settle(150);

    const before = stats();
    for (const selectedIndex of [1, 2, 0]) {
      await rerender(
        <SegmentedControl
          options={['Alpha', 'Beta', 'Gamma']}
          selectedIndex={selectedIndex}
          testID="sel"
          hybridRef={captureHybrid('sel')}
        />
      );
      await settle(120);
    }
    const moved = delta(before, stats());
    console.log(`selection turns: ${JSON.stringify(moved)}`);
    expect(sameSize(sizeOf('sel'), size)).toBe(true);
    // Nothing had to be fixed: no correction, and no new cache entry. The
    // *measure* count is deliberately not gated - this instance was corrected on
    // its first frame (its configuration is cold), and D20 makes a corrected
    // instance re-dirty its measurement on every later props turn, so three
    // selections cost three measures here by design. The box is the claim.
    expect(moved.corrections).toBe(0);
    expect(moved.cachedSizes).toBe(0);
    unmount();
  });

  it('clamps a selection the caller sends out of range', async () => {
    // The documented rule (`docs/components/segmented-control.md`): an index is
    // clamped into `options`, never dropped and never left pointing past the end.
    // JS clamps too, so what the native side is asked for is already in range -
    // reading it back is what proves the native side clamps as well, which is the
    // half that matters when the two do not agree.
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={99}
        testID="high"
        hybridRef={captureHybrid('high')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('high');
    const wide = await waitForMeasured('high', 'three options');
    await waitForBox('high', wide, 'three options');
    await settle(150);
    const before = stats();
    expect(handles.get('high')?.selectedIndex).toBe(2);

    await rerender(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        selectedIndex={-4}
        testID="high"
        hybridRef={captureHybrid('high')}
      />
    );
    await settle(200);
    expect(handles.get('high')?.selectedIndex).toBe(0);
    // Clamping is a repaint: the control did not change size, so no correction is
    // owed and nothing new was cached. (Measures are not gated - see the note in
    // the selection test above about D20.)
    const clamped = delta(before, stats());
    expect(sameSize(sizeOf('high'), wide)).toBe(true);
    expect(clamped.corrections).toBe(0);
    expect(clamped.cachedSizes).toBe(0);
    unmount();
  });

  it('clamps an index written straight to native', async () => {
    // What this covers, exactly: the `selectedIndex` **getter's** clamp. Both
    // platforms normalise on read - Swift's `SegmentedControlModel.clamp(_:to:)` in
    // the getter, Kotlin's `model.clampToDouble` in the setter that answers the read -
    // and the handle is the only way to read the number back, so this is the test that
    // proves a read cannot answer with an index that has no segment.
    //
    // What it cannot cover: the idempotent clamp at the end of `afterUpdate()`
    // (`shown` on both platforms), which is what decides the *painted* segment. Nothing
    // here can see it - the handle only ever reads the getter (which clamps anyway),
    // the shrink test cannot either because the JS wrapper sends an already-clamped
    // index, and with both `afterUpdate()` clamps deleted this suite stayed green on
    // both platforms (proof 9 in the report). The one path that is purely native - an
    // uncontrolled selection under a shrinking `options` - has no test (follow-up).
    //
    // The write through the handle is still the point: the wrapper clamps
    // `selectedIndex`/`defaultSelectedIndex` before React sends them, so an app
    // cannot ask native for index 9 of three segments, and this is the only door
    // left. D14 keeps writes off the public surface for apps; this is the repo's own
    // harness, and the write touches one thing: the handshake's raw `js` field,
    // which is plain state on both platforms and never renders, so nothing is
    // painted off the UI thread.
    const { unmount } = await render(
      <SegmentedControl
        options={['One', 'Two', 'Three']}
        testID="raw"
        hybridRef={captureHybrid('raw')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('raw');
    await settle(150);
    // Cast away the `readonly` on purpose: the declared handle is read-only
    // because that is what apps get, not because the property is unsettable.
    const raw = handles.get('raw') as unknown as {
      selectedIndex: number | null;
    };
    // Uncontrolled, so native has no index of React's at all yet.
    expect(raw.selectedIndex).toBe(null);

    raw.selectedIndex = 9;
    // Read back through the same door: three options, so the answer is the last
    // one that exists - never 9, which would be a selection that draws nothing.
    expect(handles.get('raw')?.selectedIndex).toBe(2);

    raw.selectedIndex = -3;
    expect(handles.get('raw')?.selectedIndex).toBe(0);

    // A prop write is not an interaction: it must not emit a change event.
    expect(eventLog).toEqual([]);
    unmount();
  });

  it('clamps the selection and re-measures when the options shrink', async () => {
    // The rule that has no JS-only answer: `options` and the selection arrive in
    // one batch in no particular order, so the clamp belongs in `afterUpdate()`
    // (core.md section 3). Shrink four options to two with the last one selected
    // and the selection has to end up on the last remaining segment, at the new
    // width.
    const WIDE = ['One', 'Two', 'Three', 'Four'];
    const SMALL = ['One', 'Two'];
    poisonConfigurations([sizingKey(WIDE), sizingKey(SMALL)]);
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={WIDE}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('shrink');
    const wideSize = await waitForMeasured('shrink', 'four options');
    await waitForBox('shrink', wideSize, 'four options');
    expect(handles.get('shrink')?.selectedIndex).toBe(3);

    await rerender(
      <SegmentedControl
        options={SMALL}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />
    );
    const smallSize = await waitForRemeasure('shrink', wideSize, 'two options');
    await waitForBox('shrink', smallSize, 'two options');
    expect(smallSize.width).toBeLessThan(wideSize.width - 1);
    await settle(150);
    // The caller's index 3 does not exist any more; the last remaining one does.
    expect(handles.get('shrink')?.selectedIndex).toBe(1);
    expect(handles.get('shrink')?.options).toEqual(['One', 'Two']);
    unmount();
  });

  it('reads back what React sent', async () => {
    // The props are the contract, so each one is read back off the native side
    // (DECISIONS D14: reads are what `hybridRef` is for). The colour is the
    // platform's own `processColor` output - D10's bit pattern, which is why the
    // expected number is computed here rather than written down.
    const tint = processColor('#7C4DFF') as number;
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={['One', 'Two']}
        selectedIndex={1}
        disabled
        tintColor="#7C4DFF"
        accessibilityLabel="View mode"
        testID="props"
        hybridRef={captureHybrid('props')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('props');
    const handle = handles.get('props');
    expect(handle?.options).toEqual(['One', 'Two']);
    expect(handle?.selectedIndex).toBe(1);
    expect(handle?.disabled).toBe(true);
    expect(handle?.tintColor).toBe(tint);
    expect(handle?.accessibilityLabel).toBe('View mode');
    // Controlled, and no event has happened yet: `0` is "JS has echoed nothing",
    // the handshake's floor - not an absent prop (the wrapper always sends it).
    expect(handle?.mostRecentEventCount).toBe(0);

    await rerender(
      <SegmentedControl
        options={['One', 'Two']}
        selectedIndex={1}
        testID="props"
        hybridRef={captureHybrid('props')}
      />
    );
    await settle(150);
    expect(handles.get('props')?.disabled).toBe(false);
    expect(handles.get('props')?.tintColor).toBeNull();
    expect(handles.get('props')?.accessibilityLabel).toBeNull();
    unmount();
  });

  it('keeps a caller width in charge', async () => {
    // A measured size is not an override: a `width` from the caller fixes the box,
    // and this asserts the box - 140, not the ~330 the labels want.
    //
    // Both platforms then *draw* the box: iOS hands it to SwiftUI, whose segmented
    // `Picker` compresses the segments and truncates the labels, and Android
    // re-measures the row with it before placing it (`NitroUiMeasuredRoot`), which
    // is what the test below is about. What stays unobservable through the handle is
    // the *truncation itself* - Compose's segments are virtual nodes, so the honest
    // claim here is still the box, and the row inside it is the next test's job.
    const { unmount } = await render(
      <SegmentedControl
        options={['January', 'February', 'March', 'April']}
        testID="capped"
        style={{ width: 140 }}
        hybridRef={captureHybrid('capped')}
      />
    );
    await waitForTestId('capped');
    const box = sizeOf('capped');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 140) < 0.6).toBe(true);
    unmount();
  });

  it('fits an over-wide row into the box the caller gave it', async () => {
    // The other half of a caller's width. The labels want ~330 dp and the box is
    // 140, and what the user gets has to be a 140 dp row: four segments inside the
    // box, each one reachable. Before the host asked for a *placement* measure with
    // the box's constraints, Android drew the row at its intrinsic width centred in
    // the box and clipped both ends - the outer segments were cut off, and the part
    // of them that was visible was a neighbour's.
    //
    // The tap is the oracle because it cannot lie about which segment is where: the
    // two outer segments are the only things at the two edges of the box, and the
    // harness dispatches real MotionEvents from the window root, so Compose
    // hit-tests this the way a finger is hit-tested. The reported size is asserted
    // in the same breath - placement must not become the report, or 140 goes into
    // the cache under this option list and every later row with these labels is
    // laid out at 140 (the exact pre-T11 bug `docs/architecture/sizing.md` §3).
    const { unmount } = await render(
      <SegmentedControl
        options={['January', 'February', 'March', 'April']}
        onChange={recordChange('overwide')}
        testID="overwide"
        style={{ width: 140 }}
        hybridRef={captureHybrid('overwide')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('overwide');
    const box = boxOf('overwide');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 140) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('overwide', 'four long options');
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);

    // Uncontrolled, so native owns the result: the right edge is the last segment
    // and the left edge is the first, if the row was laid out at 140 dp.
    await userEvent.pressAt(box!.x + box!.width - 2, box!.y + box!.height / 2);
    expect(await waitForEvents(1)).toEqual(['overwide:3']);

    await userEvent.pressAt(box!.x + 2, box!.y + box!.height / 2);
    expect(await waitForEvents(2)).toEqual(['overwide:3', 'overwide:0']);
    unmount();
  });

  it('fits a row whose box comes from a narrow parent, not from a width', async () => {
    // The G4 F2 shape of the bug: *no* `width` on the control. The option list is one
    // this process has never seen, so the row's own report is what sizes it, and the
    // report (~600 dp of month names) is wider than the 300 dp parent - the engine
    // clamps it, so the box is the parent's and the row overruns it by a factor of
    // two. That is the brief's "narrow parent" fixture, and it is the one the caller
    // `width` test above cannot stand in for: here the box is whatever the parent has
    // left over, which is also what a rotation does to a flex row.
    //
    // The parent then narrows twice, and that second half is the point. At mount the
    // box moves once by itself (fallback, then the clamped report) but *when* that
    // move lands is not deterministic - a correction applied before the view is first
    // laid out leaves no trace at all - so the test moves the box itself and requires
    // the row to still fit it. An arming is a fact about one content at one box, so
    // each move retires it, and the measure at the new box has to discover the overrun
    // and ask for its own placement measure: a host that reads an expired arming as
    // "already placed at the box" answers 260 with the row drawn at its own width,
    // centred, cut off at both ends, with each end of the box showing a neighbour.
    //
    // Two moves, not one, is what makes this fail without the fix rather than
    // usually: at the first narrowing the row either ends up clipped (red there) or
    // it is genuinely placed at 260, which means an arming exists for 260 - and the
    // next narrowing retires exactly that. One move alone can land on a host that has
    // never armed yet, where the old one-shot arming still works.
    //
    // `alignItems: flex-start` is load-bearing: a stretched child is pinned to the
    // parent's width by Yoga from its first frame, and then the box is never the
    // row's reported width clamped to anything, which is the case under test.
    const COLD_SIX = ['January', 'February', 'March', 'April', 'May', 'June'];
    const row = (width: number) => (
      <View style={{ width, alignItems: 'flex-start' }}>
        <SegmentedControl
          options={COLD_SIX}
          onChange={recordChange('clamped')}
          testID="clamped"
          hybridRef={captureHybrid('clamped')}
        />
      </View>
    );
    const { rerender, unmount } = await render(row(300), { timeout: 20000 });
    await waitForTestId('clamped');
    const box = boxOf('clamped');
    expect(box).not.toBeNull();
    const intrinsic = await waitForMeasured('clamped', 'six month labels');
    // The clamp really happened, and the report stayed the row's own width: 300 is
    // the parent, ~600 is the row. Reporting 300 instead is the pre-T11 bug, which
    // is why this asserts both numbers as well as the taps.
    expect(Math.abs(box!.width - 300) < 0.6).toBe(true);
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);
    await pressBothEnds('clamped', ['clamped:5', 'clamped:0']);

    await rerender(row(260));
    await waitForBox(
      'clamped',
      { width: 260, height: box!.height },
      'the narrower parent'
    );
    await pressBothEnds('clamped', [
      'clamped:5',
      'clamped:0',
      'clamped:5',
      'clamped:0',
    ]);

    await rerender(row(224));
    await waitForBox(
      'clamped',
      { width: 224, height: box!.height },
      'the narrowest parent'
    );
    await pressBothEnds('clamped', [
      'clamped:5',
      'clamped:0',
      'clamped:5',
      'clamped:0',
      'clamped:5',
      'clamped:0',
    ]);
    unmount();
  });

  it('re-fits when the caller narrows the box under an over-wide row', async () => {
    // Fitted at 140, then the caller asks for 120 - a flex parent narrowing on
    // rotation is the same path. Both boxes are too narrow, so the row overruns
    // before and after; what has to change is that the arming is *made again*
    // against the new width. Fabric does measure this host for a new box, so the
    // danger is not that the pass never runs - it is that a host which has armed
    // once reasons that the pass it just ran must have been the bounded one, and
    // never asks again. From there the 120 box shows the middle of a row drawn at
    // its own width, and a tap at either end belongs to the neighbour again.
    const FOUR = ['January', 'February', 'March', 'April'];
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('narrowing')}
        testID="narrowing"
        style={{ width: 140 }}
        hybridRef={captureHybrid('narrowing')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('narrowing');
    const wide = boxOf('narrowing');
    expect(wide).not.toBeNull();
    await waitForMeasured('narrowing', 'four long options at 140');
    await pressBothEnds('narrowing', ['narrowing:3', 'narrowing:0']);

    await rerender(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('narrowing')}
        testID="narrowing"
        style={{ width: 120 }}
        hybridRef={captureHybrid('narrowing')}
      />
    );
    await waitForBox(
      'narrowing',
      { width: 120, height: wide!.height },
      'the narrower box'
    );
    await pressBothEnds('narrowing', [
      'narrowing:3',
      'narrowing:0',
      'narrowing:3',
      'narrowing:0',
    ]);
    unmount();
  });

  it('keeps an over-wide row fitted through a prop change', async () => {
    // Arm at 140, then change one prop that repaints without resizing: the tint. It
    // is not in the sizing key, so the box does not move, no sizing correction
    // follows, and nothing else will measure this host again - Fabric measures a
    // view when its spec changes, and this one did not. Content placed at its box's
    // width answers the box's width whatever it is, so the pass after the props land
    // has to ask the unbounded question again, and the pass that learns the row
    // still overruns has to be the one that asks for the placement measure.
    // Otherwise one `tintColor` sends the row back to the clipped drawing for the
    // rest of the mount, and the ends mis-tap again.
    const FOUR = ['January', 'February', 'March', 'April'];
    const tint = processColor('#7C4DFF') as number;
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('tinted')}
        testID="tinted"
        style={{ width: 140 }}
        tintColor={null}
        hybridRef={captureHybrid('tinted')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('tinted');
    await waitForMeasured('tinted', 'four long options at 140');
    await pressBothEnds('tinted', ['tinted:3', 'tinted:0']);

    await rerender(
      <SegmentedControl
        options={FOUR}
        onChange={recordChange('tinted')}
        testID="tinted"
        style={{ width: 140 }}
        tintColor="#7C4DFF"
        hybridRef={captureHybrid('tinted')}
      />
    );
    // The tint is the only observable half of "this prop was applied"; the passes it
    // causes are not observable from JS at all, so the settle covers the UI thread's
    // work rather than racing it.
    await pollUntil(
      () => (handles.get('tinted')?.tintColor === tint ? true : null),
      () =>
        new Error(
          `testID "tinted" never reported the new tint - the handle says ` +
            `${String(handles.get('tinted')?.tintColor)}, expected ${String(tint)}.`
        ),
      5000
    );
    await settle(400);
    await pressBothEnds('tinted', [
      'tinted:3',
      'tinted:0',
      'tinted:3',
      'tinted:0',
    ]);
    unmount();
  });

  it('shows tintColor on the selected segment, on the screen and not next door', async () => {
    // `tintColor` had a documented history of lying, because every reading this control
    // offered was a prop echo: `hybridRef.tintColor` reports what React sent on both
    // platforms, so it could not tell a tint that arrived from a tint the platform
    // dropped - which is how iOS ended up with docs claiming the colour painted the
    // selected segment while the screenshots showed the default one (G4 F1, and
    // `docs/tasks/Q4-followups-triage.md` row 27). So this asks the question that has an
    // answer: is the colour on the screen?
    //
    // Two controls are the test rather than one, because "the tint arrived" and "the
    // tint stayed inside its own control" are one requirement: a fix that reached the
    // neighbouring row would be a global restyle (that is why `UISegmentedControl
    // .appearance()` is banned in the iOS file), and asserting only the first half would
    // let it through.
    //
    // The expectation differs by platform, and that difference is the documented state of
    // the prop (`docs/components/segmented-control.md`, Limits) - what is new in F3 is
    // that it is now *asserted* instead of merely claimed: Android paints it, and iOS
    // does not, and neither is allowed to drift away from what the docs say without this
    // test failing. The iOS half is the regression guard the last two rounds did not
    // have; see `HybridNitroUiSegmentedControl.swift`'s `OptionalSegmentedTint` for the
    // measurements behind why it stays that way.
    //
    // Magenta, because neither platform draws it by itself: iOS uses the scheme's accent
    // and Android the scheme's `secondaryContainer` (both measured on the two devices
    // this suite runs on, and both shown in the report line a failure carries). A colour
    // the theme already owns would pass for nothing.
    const TINT = processColor('#FF00A0') as number;
    const TINT_CSS = '#FF00A0';
    const RETINT = processColor('#00B8D4') as number;
    const OPTIONS = ['Left', 'Right'];

    const tree = (tint: string | null) => (
      <View style={rowStyle}>
        <SegmentedControl
          options={OPTIONS}
          onChange={recordChange('painted')}
          testID="painted"
          tintColor={tint}
          hybridRef={captureHybrid('painted')}
        />
        <SegmentedControl
          options={OPTIONS}
          onChange={recordChange('plain')}
          testID="plain"
          tintColor={null}
          hybridRef={captureHybrid('plain')}
        />
      </View>
    );

    const { rerender, unmount } = await render(tree(null), { timeout: 20000 });
    await waitForTestId('painted');
    await waitForMeasured('painted', 'two short options');
    await settle(400);

    // Before anything is sent: neither control carries the colour, so a hit later cannot
    // be something that was already on screen. This also catches a probe that reports a
    // hit whatever it sees, which would make every assertion below meaningless.
    expectPixels(
      await pixelProbe('painted', TINT, 'the control while untinted'),
      'absent',
      '"painted" while it still had no tintColor'
    );
    expectPixels(
      await pixelProbe('plain', TINT, 'the control that never asks for one'),
      'absent',
      '"plain", which has no tintColor'
    );

    await rerender(tree(TINT_CSS));
    await pollUntil(
      () => (handles.get('painted')?.tintColor === TINT ? true : null),
      () =>
        new Error(
          `"painted" never reported the new tint - the handle says ` +
            `${String(handles.get('painted')?.tintColor)}.`
        ),
      5000
    );
    // The handle agreeing is a prop echo and proves nothing about pixels, so the settle
    // covers the frame the new colour needs. Then the whole sequence below is run on the
    // drawn result: applied, kept across a selection change, moved to a second colour,
    // and taken away again.
    await settle(400);
    const painted = await pixelProbe('painted', TINT, 'the tinted control');
    console.log(`tint pixels (${Platform.OS}): ${painted}`);

    await tapSegment('painted', 1, OPTIONS.length);
    await settle(300);
    const afterTap = await pixelProbe(
      'painted',
      TINT,
      'the tinted control, after a tap'
    );

    await tapSegment('painted', 0, OPTIONS.length);
    await settle(300);
    const backAgain = await pixelProbe(
      'painted',
      TINT,
      'the tinted control, back on the first segment'
    );

    if (Platform.OS === 'android') {
      expectPixels(
        painted,
        'present',
        `"painted" after tintColor="${TINT_CSS}"`
      );
      expectPixels(
        afterTap,
        'present',
        '"painted" after the tap onto the 2nd segment'
      );
      expectPixels(
        backAgain,
        'present',
        '"painted" after the tap back to the 1st'
      );
      expectPixels(
        await pixelProbe('plain', TINT, 'the untinted neighbour'),
        'absent',
        '"plain" beside a tinted control - a tint must not reach its neighbour'
      );

      // A second colour, because a tint that stuck at whatever it first painted would
      // pass everything above: the prop has to keep working, not have worked once. And
      // removing it has to give the row back to the scheme, which is the half that a
      // cached colour set or an appearance-style global would get wrong.
      await rerender(tree('#00B8D4'));
      await settle(400);
      expectPixels(
        await pixelProbe('painted', RETINT, 'the control after a second tint'),
        'present',
        '"painted" after tintColor="#00B8D4"'
      );
      expectPixels(
        await pixelProbe('painted', TINT, 'the control after a second tint'),
        'absent',
        '"painted" after the colour changed - the first tint must be gone'
      );
      await rerender(tree(null));
      await settle(400);
      expectPixels(
        await pixelProbe(
          'painted',
          TINT,
          'the control after the tint was removed'
        ),
        'absent',
        '"painted" after tintColor went back to null'
      );
    } else {
      // iOS: the documented no-op, asserted. Three readings, because the interesting part
      // is not that nothing happens once - it is that nothing happens *every* time, so
      // the prop cannot be half-applied, and no other row's colour can leak in.
      expectPixels(
        painted,
        'absent',
        `"painted" after tintColor="${TINT_CSS}" (iOS)`
      );
      expectPixels(afterTap, 'absent', '"painted" after a tap (iOS)');
      expectPixels(backAgain, 'absent', '"painted" after tapping back (iOS)');
    }
    unmount();
  });

  it('reports one event per selection, and nothing when disabled', async () => {
    // A selection is the one requirement a geometry query cannot see, so this
    // needs a reading that cannot lie: a plain RN `Pressable` in the same row is
    // the *barometer*. If the harness tap does not reach that, an empty log below
    // measures the test, not the control - the Button suite has the same guard and
    // found the reason there (a synthesised `UITouch` with no HID event behind it
    // is refused by SwiftUI's own gesture environment).
    const rnPresses: string[] = [];
    const { unmount } = await render(
      <View style={rowStyle}>
        <Pressable
          testID="rn-barometer"
          onPress={(): void => {
            rnPresses.push('tap');
          }}
        >
          <Text>Barometer</Text>
        </Pressable>
        <SegmentedControl
          options={['1', '2', '3']}
          onChange={recordChange('tap')}
          testID="tap"
          hybridRef={captureHybrid('tap')}
        />
        <SegmentedControl
          options={['1', '2', '3']}
          disabled
          onChange={recordChange('tap-disabled')}
          testID="tap-disabled"
          hybridRef={captureHybrid('tap-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    const enabled = await waitForTestId('tap');
    const disabled = await waitForTestId('tap-disabled');
    const barometer = await waitForTestId('rn-barometer');

    await userEvent.press(barometer);
    await pollUntil(
      () => (rnPresses.length > 0 ? true : null),
      () =>
        new Error(
          'The harness tap reached neither the RN Pressable in this row nor ' +
            'anything else: this test cannot judge a segmented selection.'
        ),
      5000
    );

    // The disabled one first: an empty log at that moment would prove nothing on
    // its own, because an event can still be in flight. The enabled control's
    // event is the barrier that says the pipeline delivered.
    await userEvent.press(disabled);
    await userEvent.press(disabled);
    expect(eventLog).toEqual([]);
    expect(handles.get('tap-disabled')?.disabled).toBe(true);

    // Three equal-width segments, so the middle of the control is the middle
    // segment on both platforms - and uncontrolled, so native owns the result.
    await userEvent.press(enabled);
    const seen = await waitForEvents(1);
    expect(seen).toEqual(['tap:1']);
    // The segment that is already selected reports nothing again, which is the
    // SwiftUI `Picker` binding's own rule (a write only happens when the value
    // moves) applied to Material 3's plain clickable segment.
    await userEvent.press(enabled);
    await settle(250);
    expect(eventLog).toEqual(['tap:1']);
    console.log(
      `taps: harness taps to the control = ${String(eventLog.length)}, ` +
        `barometer ${String(rnPresses.length)}`
    );
    unmount();
  });

  it('snaps back a selection React does not accept', async () => {
    // The controlled half of core.md section 4, with the tap-twice oracle the
    // Switch suite uses. `Rejected` never moves `selectedIndex`, so every event is
    // a change React refused: native must paint the tap, echo the count, and then
    // put the *old* segment back. If the revert never happened, the second tap
    // would land on a segment that is already selected and report nothing - so two
    // events for two taps is what proves the selection really came back.
    //
    // `Advanced` is the mirror, and the reason the first control's second tap
    // above is not simply a double report: once React accepts the selection, a
    // further tap on the same segment must report nothing.
    function Rejected() {
      const [index] = useState(0);
      return (
        <SegmentedControl
          options={['1', '2', '3']}
          selectedIndex={index}
          onChange={recordChange('rejected')}
          testID="rejected"
          hybridRef={captureHybrid('rejected')}
        />
      );
    }
    function Advanced() {
      const [index, setIndex] = useState(0);
      return (
        <SegmentedControl
          options={['1', '2', '3']}
          selectedIndex={index}
          onChange={(event): void => {
            recordChange('accepted')(event);
            setIndex(event.index);
          }}
          testID="accepted"
          hybridRef={captureHybrid('accepted')}
        />
      );
    }

    const { unmount } = await render(
      <View style={rowStyle}>
        <Rejected />
        <Advanced />
      </View>,
      { timeout: 20000 }
    );
    const rejected = await waitForTestId('rejected');
    const accepted = await waitForTestId('accepted');

    await userEvent.press(rejected);
    const first = await waitForEvents(1);
    expect(first).toEqual(['rejected:1']);
    // JS saw the event (that is what the echo is), and the value it sent back is
    // still the one it wanted.
    await pollUntil(
      () =>
        (handles.get('rejected')?.mostRecentEventCount ?? 0) >= 1 ? true : null,
      () =>
        new Error(
          `The echo never reached native: mostRecentEventCount is ` +
            `${String(handles.get('rejected')?.mostRecentEventCount)}.`
        )
    );

    await userEvent.press(rejected);
    const second = await waitForEvents(2);
    expect(second).toEqual(['rejected:1', 'rejected:1']);

    await userEvent.press(accepted);
    const both = await waitForEvents(3);
    expect(both).toEqual(['rejected:1', 'rejected:1', 'accepted:1']);
    await pollUntil(
      () => (handles.get('accepted')?.selectedIndex === 1 ? true : null),
      () =>
        new Error(
          `An accepted selection never reached the control: selectedIndex is ` +
            `${String(handles.get('accepted')?.selectedIndex)}.`
        )
    );
    // Accepted, so a second tap on that segment is a tap on the selected one.
    await userEvent.press(accepted);
    await settle(250);
    expect(eventLog).toEqual(['rejected:1', 'rejected:1', 'accepted:1']);
    unmount();
  });

  it('sizes 200 option lists, each at its own size', async () => {
    // The list case: 200 configurations at once is what a cache-key or
    // per-instance-ledger bug looks like from the outside - a row that got a
    // neighbour's box. Each row's option list differs by its number, so no two
    // share a key, and each row is one *different number of segments* as well
    // (1 + index % 3), which a key without the option count would collapse.
    const lists: string[][] = Array.from({ length: 200 }, (_row, index) =>
      Array.from(
        { length: 1 + (index % 3) },
        (_label, part) => `R${String(index + 1)}${'ab'[part] ?? ''}`
      )
    );
    poisonConfigurations(lists.slice(0, 20).map(sizingKey));
    const before = stats();
    await render(
      <View style={rowStyle}>
        {lists.map((options, index) => (
          <SegmentedControl
            key={`row-${String(index)}`}
            options={options}
            testID={`many-${String(index)}`}
            hybridRef={captureHybrid(`many-${String(index)}`)}
          />
        ))}
      </View>,
      { timeout: 30000 }
    );
    // Every configuration here is cold - the poison dropped the cache, and the 180
    // lists that were never seeded guess the component's declared number, which the
    // poison made the wrong one too - so all 200 arrive wrong on their first frame
    // and are corrected on the way. That is D17's rule, not a failure: the batch's
    // stale count is deliberately not gated (sizing.md section 3). So this waits for
    // the corrections to arrive, then judges whether any row kept a neighbour's box.
    const findWrong = (): string[] => {
      const wrong: string[] = [];
      for (let index = 0; index < lists.length; index += 1) {
        const testId = `many-${String(index)}`;
        const box = sizeOf(testId);
        const content = handles.get(testId)?.measureContent() ?? null;
        if (!sameSize(box, content)) {
          wrong.push(
            `${testId}: box ${describeSize(box)} vs measured ${describeSize(content)}`
          );
        }
        if (sameSize(box, WRONG_SIZE)) {
          wrong.push(`${testId}: still poisoned`);
        }
      }
      return wrong;
    };
    const wrong = await pollUntil(
      () => {
        const found = findWrong();
        return found.length === 0 ? [] : null;
      },
      () => {
        const found = findWrong();
        const d = delta(before, stats());
        return new Error(
          `${String(found.length)}/200 still wrong after the wait: ` +
            `${found.slice(0, 2).join(' | ')} - corrections ` +
            `${String(d.corrections)}, cached ${String(d.cachedSizes)}`
        );
      },
      25000
    );
    const d = delta(before, stats());
    console.log(
      `200 controls: corrections=${String(d.corrections)} ` +
        `immediate=${String(d.immediate)} cached=${String(d.cachedSizes)}`
    );
    expect(wrong).toEqual([]);
    // 200 distinct configurations, all cold: every one owes a correction, and 200
    // cache entries. Fewer entries than lists means two lists share one size - the
    // missing-input bug, at scale.
    expect(d.corrections).toBeGreaterThanOrEqual(200);
    expect(d.cachedSizes).toBeGreaterThanOrEqual(200);
  });

  it('survives remounts with the size and seed of each mount', async () => {
    // `RecyclableView` plus a fresh mount per cycle: the box must follow the option
    // list of *this* mount, never the previous one's - a stale model, or a sizing
    // id the host kept, both look like this from outside.
    //
    // The seed is the half no geometry query can see, and an uncontrolled control
    // hides it from the handle too (`selectedIndex` reads `null` because React never
    // sent one), so it gets its own oracle at the end of this test.
    const cases: { options: string[]; defaultSelectedIndex: number }[] = [
      { options: ['First'], defaultSelectedIndex: 0 },
      { options: ['Second', 'with a longer label'], defaultSelectedIndex: 1 },
      { options: ['Go'], defaultSelectedIndex: 0 },
    ];
    for (const [index, testCase] of cases.entries()) {
      const key = sizingKey(testCase.options);
      if (index === 0) {
        poisonConfigurations([key]);
      }
      const testId = `remount-${testCase.options[0]}`;
      const { unmount } = await render(
        <SegmentedControl
          options={testCase.options}
          defaultSelectedIndex={testCase.defaultSelectedIndex}
          testID={testId}
          hybridRef={captureHybrid(testId)}
        />,
        { timeout: 20000 }
      );
      await waitForTestId(testId);
      const size = await waitForMeasured(testId, `mount ${String(index)}`);
      await waitForBox(testId, size, `mount ${String(index)}`);
      expect(sameSize(sizeOf(testId), WRONG_SIZE)).toBe(false);
      expect(handles.get(testId)?.options).toEqual(testCase.options);
      // What the handle can say about the seed of an uncontrolled mount: React sent
      // no index, so there is nothing to read back. The seed itself is proven below.
      expect(handles.get(testId)?.selectedIndex).toBeNull();
      unmount();
      await settle(100);
    }

    // Does *this* mount apply its own `defaultSelectedIndex`, or is the model still
    // the previous mount's? A model whose `didApplyDefault` survived the recycle
    // never applies the seed again, and it shows up as the wrong segment painted -
    // invisible to the handle and to the box. The oracle is the tap-twice rule
    // (`Selection` in the docs page): a tap on the segment that is already selected
    // reports nothing, on both platforms.
    //
    // Two controls, mounted, unmounted and mounted again:
    //  - `remount-proof` seeds 0, so pressing its middle segment *must* report
    //    index 1. That is the witness that a harness tap reaches a segmented control
    //    in this row at all - without it, an empty log below would prove nothing.
    //  - `remount-kept` seeds 1, so pressing its middle segment must report
    //    *nothing*: the middle is already this mount's selection. A recycled model
    //    that skipped the seed is displaying segment 0, and that press reports one.
    const seedPair = () => (
      <View style={rowStyle}>
        <SegmentedControl
          options={['1', '2', '3']}
          defaultSelectedIndex={1}
          onChange={recordChange('remount-kept')}
          testID="remount-kept"
          hybridRef={captureHybrid('remount-kept')}
        />
        <SegmentedControl
          options={['1', '2', '3']}
          defaultSelectedIndex={0}
          onChange={recordChange('remount-proof')}
          testID="remount-proof"
          hybridRef={captureHybrid('remount-proof')}
        />
      </View>
    );

    const first = await render(seedPair(), { timeout: 20000 });
    await waitForTestId('remount-kept');
    await waitForTestId('remount-proof');
    first.unmount();
    await settle(150);

    const second = await render(seedPair(), { timeout: 20000 });
    const kept = await waitForTestId('remount-kept');
    const proof = await waitForTestId('remount-proof');

    await userEvent.press(proof);
    expect(await waitForEvents(1)).toEqual(['remount-proof:1']);

    await userEvent.press(kept);
    await settle(250);
    expect(eventLog).toEqual(['remount-proof:1']);
    second.unmount();
  });

  it('corrects a planted size that matches the current box (iOS measure signal)', async () => {
    // The R3 tests above all move the box: a new option list is a configuration the
    // engine has no exact answer for, so it is laid out at the fallback and the
    // *bounds change* is itself a measure point on iOS
    // (`NitroSwiftUIHost`: bounds change, trait change, first commit, or a component
    // that said so). That hides the fourth signal entirely - and on iOS nothing else
    // can produce a native re-measure after a props change: D20's re-dirty only
    // re-reads the host's cache, and `noteSizingKeyChanged()` only unlocks the
    // report, it never asks for one.
    //
    // So plant an answer for the second option list that is exactly the box the
    // control is already in. The switch then costs no bounds change at all, and the
    // only thing left that can notice the labels got longer is the setter's
    // `host.noteContentSizeMayHaveChanged()` - which is what this test fails without
    // (iOS). Android needs no such call and must still correct: Compose recomposes,
    // and D20's re-dirty runs the host's own measure.
    const SHORT = ['Run'];
    const LONG = ['Run', 'the', 'whole', 'build'];
    const { rerender, unmount } = await render(
      <SegmentedControl
        options={SHORT}
        testID="pin"
        hybridRef={captureHybrid('pin')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('pin');
    const shortSize = await waitForMeasured('pin', 'the one-option list');
    await waitForBox('pin', shortSize, 'the one-option list');

    // The answer the engine will give for the *next* configuration: today's box.
    // Provisional by construction (`seedSize`), so it lays the frame out and is
    // still owed a correction. `invalidateSizingEnvironment` keeps it as that
    // configuration's guess and drops the cache, like `poisonConfigurations`.
    nitroUiCore.seedSizingSize(
      COMPONENT,
      sizingKey(LONG),
      shortSize.width,
      shortSize.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    await settle(200);
    const before = stats();

    await rerender(
      <SegmentedControl
        options={LONG}
        testID="pin"
        hybridRef={captureHybrid('pin')}
      />
    );
    await settle(600);
    const box = sizeOf('pin');
    const now = measured('pin');
    const after = delta(before, stats());
    console.log(
      `planted-equal-to-box (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(now)} delta=${JSON.stringify(after)}`
    );
    // The control measures the longer row whatever the engine was told, so the
    // planted size is provably the wrong answer for this configuration.
    expect(now !== null && now.width > shortSize.width + 1).toBe(true);
    // ...and the box followed it, rather than staying where the guess put it.
    expect(sameSize(box, now)).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });
});
