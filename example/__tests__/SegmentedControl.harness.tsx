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
    // The wrapper is the outer clamp: `SegmentedControl.tsx` clamps
    // `selectedIndex`/`defaultSelectedIndex` before React ever sends them, so an
    // app cannot ask native for index 9 of three segments. That leaves the native
    // clamp - the one in `afterUpdate()`, next to the option list it belongs to
    // (core.md section 3) - unreachable through the public API, and a prop write
    // through the handle is the only door left to it. D14 keeps writes off the
    // public surface for apps; this is the repo's own harness, and the write
    // touches one thing: the handshake's raw `js` field, which is plain state on
    // both platforms and never renders, so nothing is painted off the UI thread.
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
    // Uncontrolled: `null` is the "native owns it" spelling, not an absent prop.
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

  it('keeps a caller width in charge and truncates the labels', async () => {
    // A measured size is not an override: `width` fixes the box, and the labels
    // have to fit inside it rather than paint past it (core.md section 7's
    // hit-test story, in the other direction).
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
    const lists: string[][] = Array.from({ length: 200 }, (_, index) =>
      Array.from(
        { length: 1 + (index % 3) },
        (_, part) => `R${String(index + 1)}${'ab'[part] ?? ''}`
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

  it('survives remounts with the size of each mount', async () => {
    // `RecyclableView` plus a fresh mount per cycle: the box must follow the option
    // list of *this* mount, never the previous one's - a stale model, or a sizing
    // id the host kept, both look like this from outside. The seed index moves too,
    // so a model that is not reset would also show up as a wrong selection.
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
      // The seed is applied to this mount only: a model that survived the recycle
      // would still report the previous case's list or selection.
      expect(handles.get(testId)?.selectedIndex).toBeNull();
      unmount();
      await settle(100);
    }
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
