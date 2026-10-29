/**
 * On-device tests for the Picker (task G6).
 *
 * Picker is the third control whose size comes from its props, and the first
 * whose size comes from the *title it is currently showing*: a `menu` picker is a
 * button, and a button is as wide as its label. So the sizing configuration is
 * `variant + options + selected title + label`, and the R3 question this suite
 * asks is wider than SegmentedControl's: an `options` change, a *selection*
 * change and a `variant` change all move the box, and a selection change does it
 * while showing a different word.
 *
 * Three readings, as in the G2/G4 suites:
 *  - `harnessUi.queryByTestId` - the box Fabric gave the view;
 *  - `hybridRef.measureContent()` - the size the hosted control measured;
 *  - `nitroUiCore.sizingStats()` - what the engine did.
 *
 * Two things make these tests able to fail (AGENTS.md, "Every new test or gate
 * must be shown to fail"):
 *  - every cold configuration is **poisoned** first (`seedSizingSize` with a size
 *    no picker has, then an environment bump), so a correction that never arrives
 *    leaves a visible wrong box *and* costs a correction the test requires;
 *  - the warm assertions require *no* new cache entry, which on a second pass
 *    leaves the measure pass as the only road to the new size.
 *
 * What is deliberately NOT here, and where it went: a picker's options live in a
 * popup, and the harness dispatches input into the app's own window
 * (`@react-native-harness/ui`'s Android helper presses on
 * `activity.window.decorView`), so a tap can reach the anchor but never a row in
 * the popup. Selecting an option, a rejected controlled choice snapping back, the
 * popup dismissing on back/outside-tap, what a screen reader hears, and the
 * `menu` box following a title chosen *without* a React render are therefore
 * real-input cases with platform UI evidence
 * (`scripts/real-input/android.mjs`, `NitroUiExampleUITests/RealInputTests.swift`),
 * not assertions that could quietly pass without ever opening a menu.
 *
 * Deliberately absent: a `beforeAll` that mounts a picker to "warm the process",
 * which hides the process-local first-instance behaviour D17 is about.
 */
import { Platform, TurboModuleRegistry, View } from 'react-native';
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
  Picker,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The Fabric name - what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiPicker';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * What `hybridRef` hands back - declared, not imported (DECISIONS D14 keeps
 * Hybrid View types off the public surface). Read-only on purpose, and there is
 * no `expanded`: a SwiftUI `Picker` keeps its menu's open state to itself, so an
 * `isExpanded` here would be a question Android could answer and iOS could not.
 */
type PickerHandle = {
  readonly options: string[];
  /** The index as React sent it, normalised against `options`; null if uncontrolled. */
  readonly selectedIndex: number | null;
  readonly mostRecentEventCount: number;
  readonly variant: string;
  readonly label: string | null;
  readonly disabled: boolean;
  readonly tintColor: number | null;
  readonly accessibilityLabel: string | null;
  measureContent(): { width: number; height: number };
  /**
   * Test-only (`@internal`, D14): press the row for `index` through the same path a
   * real row press takes - clamp, no-op guard, optimistic paint, event. The harness
   * cannot reach a row in a popup (the popup is not in the app's window), so this is
   * how a *real* pick gets tested here; see `scripts/real-input/` for the same pick
   * done with a real tap.
   */
  nuiTestSelect(index: number): void;
};

/** Handles by testID, so a test can ask each control what it holds. */
const handles = new Map<string, PickerHandle>();
const captureHybrid =
  (testId: string) =>
  (view: PickerHandle): void => {
    handles.set(testId, view);
  };

/**
 * Every `onChange` the app has reported, in order: `testID:index`.
 *
 * Here it is the negative oracle: opening a menu must not look like a choice, and
 * a selection React never accepted must not be reported twice. The positive half
 * (a choice *does* report) is a real-input case, because choosing needs the popup.
 */
const eventLog: string[] = [];
const recordChange =
  (testId: string) =>
  (event: { index: number }): void => {
    eventLog.push(`${testId}:${String(event.index)}`);
  };

/**
 * `recordChange` plus a busy JS thread: the handler spins for `ms` before returning,
 * so the render a choice causes - and with it the props batch that carries the new
 * sizing key - lands long after the control has painted and laid out its new title.
 *
 * That ordering is the only one a pick-time measure is wrong for, and a harness that
 * asks for a pick and then waits does not reliably produce it: on a debug JS thread a
 * props batch can just as easily win the race against the control's next frame, which
 * would make the guard below look inert when it is only untested. Real apps do block
 * JS like this (a dispatch, a synchronous read, a heavy render), so this is the real
 * timing with the window the bug needs, not a fake.
 */
const recordChangeThenBlock =
  (testId: string, ms = 250) =>
  (event: { index: number }): void => {
    eventLog.push(`${testId}:${String(event.index)}`);
    const deadline = nitroUiCore.now() + ms;
    while (nitroUiCore.now() < deadline) {
      // Deliberately busy: the point is that JS cannot render.
    }
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
 * on Android that is still the old one for the frame in which the new title
 * landed: Compose recomposes and re-measures on the UI thread. Waiting for "a
 * size" would return the pre-change number, so the wait is for a *different* one.
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

/**
 * Poll until the control reports a size that could only have come from after the
 * rerender.
 *
 * `waitForRemeasure` asks only that the number differ from the one before the
 * change. A variant change is a remount (`Picker.tsx` keys the native view on
 * `variantKey`), and four answers that all mean "not done" satisfy it: the new
 * host has not measured yet (`measureContent()` is the host cache, 0 when empty),
 * the old host was dropped (`drop()` nils the cached size) while `handles` still
 * points at it - `hybridRef` fires only on the new view's first props batch - or
 * no handle is there at all. Zero then *ends* the wait, because 0x0 is not the
 * previous size, and the box assertion below it compares a real box with nothing:
 * that is the `wheel=0.00x0.00` red X3 saw at load 35.6-57.2.
 *
 * So this refuses all four: no handle, a zero (absence, never a verdict), and the
 * size from before the rerender (Android re-measures on the UI thread, so the old
 * number is what the first frames answer with - the reason `waitForRemeasure`
 * waits for a difference at all). `waitForMeasured` already refused zero; it had
 * just never learned about the mount.
 *
 * The witness is the *size*, not the handle object. It cannot be the object: on
 * iOS the same hybrid answers for both mounts of a keyed rerender (measured - the
 * handle captured before the rerender is still what `handles` holds, reporting the
 * new variant's 330.00x216.00), so requiring a different one fails a run that
 * succeeded. Refusing a missing handle and a zero covers the dropped-old-host
 * state, because a dropped host reports nothing but zero.
 */
async function waitForFreshMeasure(
  testId: string,
  stale: Size | null,
  what: string,
  timeoutMs = 12000
): Promise<Size> {
  return await pollUntil(
    () => {
      const size = measured(testId);
      if (size == null) return null; // no mount to ask yet
      if (size.width <= 0 || size.height <= 0) return null; // 0x0 is absence
      return stale != null && sameSize(size, stale) ? null : size;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never reported a size of its new mount - ` +
          `measureContent() says ${describeSize(measured(testId))}, was ` +
          `${describeSize(stale)} before the rerender, box ` +
          `${describeSize(sizeOf(testId))}.`
      ),
    timeoutMs
  );
}

/*
 * No `waitForEvents` helper here, unlike the G2/G4 suites: every positive change
 * event this control makes comes from a popup row the harness cannot press, so the
 * log is only ever read to require that it is *empty* (opening a menu is not a
 * choice), and an empty log needs no polling.
 */

/**
 * The key `Picker.tsx` builds:
 * `variant|optionCount|label|...|sel:<selected title>|lbl:<label>`, each piece
 * escaped so a `|` or a `\` inside one cannot forge a separator.
 *
 * Written out here rather than imported - a harness that poisoned the cache
 * through the library's own helper could not catch the helper being wrong, and a
 * missing input in that key is precisely the R3 bug class: leave `sel:` out and
 * every selection a picker shows inherits the first title's width.
 */
function sizingKey(
  options: readonly string[],
  selectedIndex: number,
  label: string | null,
  variant: string
): string {
  const escape = (value: string) => value.replace(/[\\|]/g, '\\$&');
  return [
    variant,
    String(options.length),
    ...options.map(escape),
    `sel:${escape(options[selectedIndex] ?? '')}`,
    `lbl:${escape(label ?? '')}`,
  ].join('|');
}

/**
 * A size that is *not* any picker's size, planted as the engine's answer for a
 * configuration before it is first mounted.
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

/** Press the middle of a control's box - its anchor, for a picker. */
async function pressAnchor(testId: string): Promise<void> {
  const box = boxOf(testId);
  expect(box).not.toBeNull();
  await userEvent.pressAt(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

/**
 * Choose an option the way a row press does, through the native selection path.
 *
 * `nuiTestSelect` is the `@internal` hook the component adds for exactly this: the
 * harness dispatches input into the app's own window, and a Material 3 popup (or a
 * SwiftUI menu) lives outside it, so no `userEvent` can reach a row. What the hook
 * runs is the *same* code a row runs - the model's selection path, on the UI thread -
 * which is what makes the sizing assertions below about a pick rather than about a
 * prop write. `settle` covers the hop to the UI thread and back.
 */
async function pickRow(testId: string, index: number): Promise<void> {
  const handle = handles.get(testId);
  expect(handle).not.toBeNull();
  handle?.nuiTestSelect(index);
  await settle(150);
}

/** Every size the engine laid `testId`'s instances out with, oldest first. */
function laidOutSizes(): { width: number; height: number }[] {
  return nitroUiCore
    .drainSizingTrace()
    .filter((event) => event.stage === 'laidOut')
    .map((event) => ({ width: event.width, height: event.height }));
}

/**
 * The component's *declared* fallback, per platform (`NitroUiDeclaredFallbacks`):
 * iOS 72 x 35 pt, Android 280 x 56 dp. Used to catch a box that was laid out at
 * the fallback for a frame - the flash D17 is about.
 */
const DECLARED_FALLBACK =
  Platform.OS === 'ios'
    ? { width: 72, height: 35 }
    : { width: 280, height: 56 };

const columnStyle = { gap: 8 } as const;

/**
 * A title wide enough to be unmistakably wider than a short one on *both*
 * platforms, which the width assertions below need to say anything at all.
 *
 * The reason it has to be this wide is a measured platform difference: Material 3's
 * text field has a 280 dp minimum width (`MinTextFieldWidth` in Material's
 * `TextField.kt`), so on Android every menu picker whose title is roughly up to
 * 30 characters is the same 280 x 56 dp, whatever the title says. iOS's SwiftUI
 * menu sizes to its title instead ('Go' is 70 x 34.67 pt on iPhone 17). Two short
 * titles therefore differ by ~160 pt on iOS and by exactly nothing on Android, and
 * a fixture built from short titles tests iOS and passes Android by accident.
 * `docs/components/picker.md` has both tables.
 *
 * It is 40 characters, which is a ceiling as well as a floor: at 50 characters this
 * title measured 432.33 pt, wider than the iPhone 17's 402 pt window, and Yoga
 * clamped the *box* to the screen - so the same fixture that is a claim on Android
 * stops being one on iOS, in the other direction. 40 characters lands between the
 * two: ~355 pt and ~340 dp, each inside its own window.
 */
const LONG_TITLE = 'A considerably longer colour name indeed';

/** The reference configuration for the declared fallback (see test 1). */
const REFERENCE = ['One', 'Two', 'Three'];

afterEach(() => {
  cleanup();
  handles.clear();
  eventLog.length = 0;
  nitroUiCore.setSizingTraceEnabled(false);
});

/** Arm the trace and empty the ring, so a test reads only its own events. */
function armTrace(): void {
  nitroUiCore.setSizingTraceEnabled(true);
  nitroUiCore.drainSizingTrace();
}

describe('Picker · G6', () => {
  it('lays each option list out at the size its own title gives it', async () => {
    // The base R3 claim for this component, and the one that says the sizing key
    // has the options in it at all: three option lists in one column must get
    // three boxes, each the width of the title *that* picker shows.
    const SHORT = ['Go'];
    // The reference configuration for the declared fallback: the default variant,
    // the default selection, no label. `docs/components/picker.md` and the two
    // `NitroUiDeclaredFallbacks` tables take these numbers from a run of this test.
    const MIDDLE = REFERENCE;
    // One long title, which is what makes a *menu* wide: the list plays no part in
    // the width beyond deciding which title is shown (see `LONG_TITLE` for why the
    // fixture has to be this long to be a claim on both platforms).
    const LONG = [LONG_TITLE];
    poisonConfigurations([
      sizingKey(SHORT, 0, null, 'menu'),
      sizingKey(MIDDLE, 0, null, 'menu'),
      sizingKey(LONG, 0, null, 'menu'),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={SHORT}
          testID="short"
          hybridRef={captureHybrid('short')}
        />
        <Picker
          options={MIDDLE}
          testID="middle"
          hybridRef={captureHybrid('middle')}
        />
        <Picker
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
        `middle(REFERENCE)=${describeSize(middleSize)} ` +
        `long=${describeSize(longSize)} cold=${JSON.stringify(cold)} ` +
        `(load: menu, uncontrolled, no label)`
    );
    // Three configurations, all poisoned, so three corrections - and three cache
    // entries. One entry shared by two of them is the missing-input bug, and it
    // would also make two of these widths equal.
    expect(cold.corrections).toBeGreaterThanOrEqual(3);
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(3);
    // Only the widest is compared: on Android `Go` and `One/Two/Three` are both at
    // Material's 280 dp floor, which is a true fact about the control, not a sizing
    // bug - three separate cache entries and three corrections above is what says
    // the option list is in the key.
    expect(longSize.width).toBeGreaterThan(shortSize.width + 20);
    // The height is the platform's control height and does not move with the
    // labels - if it did, the fallback (one number per component) would be wrong
    // for every option list but one.
    expect(
      sameSize(shortSize, { width: shortSize.width, height: longSize.height })
    ).toBe(true);
    unmount();
  });

  it('sizes a menu by the title it shows, not by the longest option', async () => {
    // The input that makes this control's key different from SegmentedControl's:
    // a segmented row is as wide as *all* its segments, a menu button is as wide
    // as the one label it is showing. Same `options`, different selection, so a
    // key without `sel:` in it gives both pickers the first one's width - and
    // here that is a box that is visibly too narrow for its own title.
    const OPTIONS = ['Red', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 1, null, 'menu'),
    ]);
    const before = stats();
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={0}
          testID="sel-first"
          hybridRef={captureHybrid('sel-first')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={1}
          testID="sel-last"
          hybridRef={captureHybrid('sel-last')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('sel-first');
    const firstSize = await waitForMeasured('sel-first', 'the short title');
    await waitForBox('sel-first', firstSize, 'the short title');
    const lastSize = await waitForMeasured('sel-last', 'the long title');
    await waitForBox('sel-last', lastSize, 'the long title');
    const cold = delta(before, stats());
    console.log(
      `same options, other title: first=${describeSize(firstSize)} ` +
        `last=${describeSize(lastSize)} cold=${JSON.stringify(cold)}`
    );
    expect(lastSize.width).toBeGreaterThan(firstSize.width + 20);
    // Two keys, so two entries: one shared entry is the `sel:`-less key.
    expect(cold.cachedSizes).toBeGreaterThanOrEqual(2);
    expect(cold.corrections).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('takes the box width as a wheel and its own width as a menu', async () => {
    // The two sizing policies in one screen, which is also the `variant` input in
    // the key: a `wheel` fills the box (`fillWidth`, so the width is Yoga's and
    // `alignSelf: 'stretch'` is what hands it over), a `menu` measures its own
    // (sizing.md sections 5 and 6). A key without `variant` would let a wheel read
    // a menu's size, and the widths below are the difference.
    const OPTIONS = ['Small', 'Medium', 'Large'];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 0, null, 'wheel'),
    ]);
    // 330, not 260: a menu on Android is 280 dp wide at the field's own minimum, so
    // a 260 dp parent would clamp it (C1) and the two policies would be
    // indistinguishable from here.
    const { unmount } = await render(
      <View style={{ width: 330 }}>
        <Picker
          options={OPTIONS}
          testID="as-menu"
          hybridRef={captureHybrid('as-menu')}
        />
        <Picker
          options={OPTIONS}
          variant="wheel"
          testID="as-wheel"
          hybridRef={captureHybrid('as-wheel')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('as-menu');
    const menuSize = await waitForMeasured('as-menu', 'the menu');
    await waitForBox('as-menu', menuSize, 'the menu');
    const wheelSize = await waitForMeasured('as-wheel', 'the wheel');
    const wheelBox = await waitForBox('as-wheel', wheelSize, 'the wheel');
    console.log(
      `policies (${Platform.OS}): menu=${describeSize(menuSize)} box=${describeSize(sizeOf('as-menu'))} ` +
        `| wheel=${describeSize(wheelSize)} box=${describeSize(wheelBox)}`
    );
    // `intrinsic`: the box is the control's own width, and it is not the parent's.
    expect(menuSize.width).toBeLessThan(330 - 20);
    // `fillWidth`: the width the *control* reports is the box's, not its own -
    // the engine overrides it (sizing.md section 5), and the wheel draws into it.
    expect(Math.abs(wheelSize.width - 330)).toBeLessThan(1);
    expect(Math.abs(wheelBox.width - 330)).toBeLessThan(1);
    // The two variants are different configurations: a wheel that measured the
    // same box as a menu here has a key without `variant` in it.
    expect(sameSize(menuSize, wheelSize)).toBe(false);
    if (Platform.OS === 'ios') {
      // Only iOS has a wheel, and it is a tall one. Android renders the menu for
      // both variants (`docs/components/picker.md`), so asserting a height there
      // would assert something the platform does not do.
      expect(wheelSize.height).toBeGreaterThan(menuSize.height + 20);
    }
    unmount();
  });

  it('re-measures when the options change (R3)', async () => {
    // A menu's width is the title it shows, so this fixture changes the *first*
    // option too: `SHORT` and `LONG` selected 0 would otherwise be the same word,
    // and a control that correctly stayed 70 wide would look like a missing
    // re-measure. (That a menu is sized by its title and not by its list is the
    // claim of the over-wide and read-back cases; measured numbers are in
    // `docs/components/picker.md`.)
    const SHORT = ['Run'];
    const LONG = [LONG_TITLE, 'the', 'whole', 'build'];
    poisonConfigurations([
      sizingKey(SHORT, 0, null, 'menu'),
      sizingKey(LONG, 0, null, 'menu'),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Picker
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

    await rerender(
      <Picker options={LONG} testID="opts" hybridRef={captureHybrid('opts')} />
    );
    const longSize = await waitForRemeasure(
      'opts',
      shortSize,
      'the longer list'
    );
    await waitForBox('opts', longSize, 'the longer list');
    const warm = delta(before, stats());
    console.log(
      `options change: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} cold=${JSON.stringify(cold)} ` +
        `warm=${JSON.stringify(warm)}`
    );
    expect(longSize.width).toBeGreaterThan(shortSize.width + 1);
    // One new configuration, so exactly one more cache entry than the first mount
    // needed - the first one's entry is reused, not relearned.
    expect(warm.cachedSizes - cold.cachedSizes).toBe(1);
    expect(warm.corrections - cold.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('re-reports a key change that keeps the size (R3)', async () => {
    // The input that makes Picker's key different from a segmented row's, and the
    // one a caller can change without moving the control at all: a menu shows *one*
    // title, so an `options` change that leaves the selected title alone measures
    // exactly what it did before (measured: `['Red', 'Blue']` and
    // `['Red', 'Blue', 'Green']` selected 0 are the same box on both platforms).
    // The key still changes - the list is in it - so the engine has no answer for
    // the new configuration and lays the frame out at the poisoned guess, and each
    // host skips a report within 0.5 of the size it reported last. That makes the
    // only report that could move the box the one the dedupe would swallow, unless
    // the key change itself resets that memory (`noteSizingKeyChanged`, review F1).
    const FIRST = ['Red', 'Blue'];
    const SECOND = ['Red', 'Blue', 'Green'];
    poisonConfigurations([
      sizingKey(FIRST, 0, null, 'menu'),
      sizingKey(SECOND, 0, null, 'menu'),
    ]);
    const before = stats();
    const { rerender, unmount } = await render(
      <Picker
        options={FIRST}
        selectedIndex={0}
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
      <Picker
        options={SECOND}
        selectedIndex={0}
        testID="same"
        hybridRef={captureHybrid('same')}
      />
    );
    // Deliberately no `waitForRemeasure`: staying at `size` is the correct answer
    // here, so the box and the counters are the only readings that can show the fix.
    await settle(500);
    const box = sizeOf('same');
    const after = delta(changed, stats());
    console.log(
      `same-size key change (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(measured('same'))} delta=${JSON.stringify(after)}`
    );
    // The visible bug first: without the reset the box would still be the guess.
    expect(sameSize(box, WRONG_SIZE)).toBe(false);
    // ...and the box agrees with what the control measures, whatever that is.
    expect(sameSize(box, measured('same'))).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('re-measures when the selection moves to a longer title', async () => {
    // The same R3 path driven by the *selection*: React moves `selectedIndex`, the
    // title the button shows changes, and the box has to follow the new word. This
    // is the controlled half; the half where native picks the title with no render
    // at all is the real-input case `menu box follows a picked title`.
    const OPTIONS = [
      'Red',
      'Greenish blue',
      'A considerably longer colour name',
    ];
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="title"
        hybridRef={captureHybrid('title')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('title');
    const first = await waitForMeasured('title', 'the first title');
    await waitForBox('title', first, 'the first title');
    const before = stats();

    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        testID="title"
        hybridRef={captureHybrid('title')}
      />
    );
    const widest = await waitForRemeasure('title', first, 'the longest title');
    await waitForBox('title', widest, 'the longest title');
    const after = delta(before, stats());
    console.log(
      `selection change: first=${describeSize(first)} ` +
        `widest=${describeSize(widest)} delta=${JSON.stringify(after)}`
    );
    expect(widest.width).toBeGreaterThan(first.width + 20);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    expect(handles.get('title')?.selectedIndex).toBe(2);
    unmount();
  });

  it('corrects a planted size that matches the current box (iOS measure signal)', async () => {
    // The R3 tests above all move the box, and on iOS a bounds change is itself a
    // measure point (`NitroSwiftUIHost`: bounds change, trait change, first commit,
    // or a component that said so). That hides the fourth signal - and here it is
    // the only one that can work: the new title's configuration is planted with the
    // box the control is *already* in, so the switch costs no bounds change at all,
    // and D20's re-dirty only re-reads the host's cache. What is left is the
    // `options` setter's `noteContentSizeMayHaveChanged()` - which is what this
    // test fails without (iOS). Android needs no such call and must still correct:
    // Compose recomposes, and D20's re-dirty runs the host's own measure.
    // Again a wider *title* for the second configuration - see the R3 test above.
    const SHORT = ['Run'];
    const LONG = [LONG_TITLE, 'the', 'whole', 'build'];
    const { rerender, unmount } = await render(
      <Picker options={SHORT} testID="pin" hybridRef={captureHybrid('pin')} />,
      { timeout: 20000 }
    );
    await waitForTestId('pin');
    const shortSize = await waitForMeasured('pin', 'the one-option list');
    await waitForBox('pin', shortSize, 'the one-option list');

    // The answer the engine will give for the *next* configuration: today's box.
    // Provisional by construction (`seedSize`), so it lays the frame out and is
    // still owed a correction.
    nitroUiCore.seedSizingSize(
      COMPONENT,
      sizingKey(LONG, 0, null, 'menu'),
      shortSize.width,
      shortSize.height
    );
    nitroUiCore.invalidateSizingEnvironment();
    await settle(200);
    const before = stats();

    await rerender(
      <Picker options={LONG} testID="pin" hybridRef={captureHybrid('pin')} />
    );
    await settle(600);
    const box = sizeOf('pin');
    const now = measured('pin');
    const after = delta(before, stats());
    console.log(
      `planted-equal-to-box (${Platform.OS}): box=${describeSize(box)} ` +
        `measured=${describeSize(now)} delta=${JSON.stringify(after)}`
    );
    // The control measures the longer title whatever the engine was told, so the
    // planted size is provably the wrong answer for this configuration.
    expect(now !== null && now.width > shortSize.width + 1).toBe(true);
    // ...and the box followed it, rather than staying where the guess put it.
    expect(sameSize(box, now)).toBe(true);
    expect(after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('clamps a selection the caller sends out of range', async () => {
    // The clamp rules are SegmentedControl's, and they have a sizing consequence
    // here that they do not have on a row: the index decides the *title*, so an
    // out-of-range index that JS failed to clamp would ask native for a title that
    // does not exist and size the button for nothing. The oracle is a second picker
    // that was asked for the clamped index honestly: same title, same key, so any
    // disagreement shows up as two different boxes for one title.
    // The ends have to be *visibly* different widths, which on Android means the
    // last option cannot be 'Three' (see `LONG_TITLE`).
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={99}
          testID="past"
          hybridRef={captureHybrid('past')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={2}
          testID="honest"
          hybridRef={captureHybrid('honest')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={Number.NaN}
          testID="junk"
          hybridRef={captureHybrid('junk')}
        />
        <Picker
          options={OPTIONS}
          selectedIndex={-4}
          testID="first"
          hybridRef={captureHybrid('first')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('past');
    const pastSize = await waitForMeasured('past', 'index 99');
    await waitForBox('past', pastSize, 'index 99');
    const honestSize = await waitForMeasured('honest', 'index 2');
    await waitForBox('honest', honestSize, 'index 2');
    const junkSize = await waitForMeasured('junk', 'NaN');
    await waitForBox('junk', junkSize, 'NaN');
    const firstSize = await waitForMeasured('first', 'index -4');
    await waitForBox('first', firstSize, 'index -4');
    console.log(
      `clamps: 99=${describeSize(pastSize)} 2=${describeSize(honestSize)} ` +
        `NaN=${describeSize(junkSize)} -4=${describeSize(firstSize)}`
    );
    // Past the end becomes the last one: same title, so same box.
    expect(handles.get('past')?.selectedIndex).toBe(2);
    expect(sameSize(pastSize, honestSize)).toBe(true);
    // Junk and negatives become the first one.
    expect(handles.get('junk')?.selectedIndex).toBe(0);
    expect(handles.get('first')?.selectedIndex).toBe(0);
    expect(sameSize(junkSize, firstSize)).toBe(true);
    // And the two ends are not the same box, or the clamp would be untestable here.
    expect(sameSize(pastSize, firstSize)).toBe(false);
    unmount();
  });

  it('clamps an index written straight to native', async () => {
    // What this covers, exactly: the `selectedIndex` **getter's** clamp on both
    // platforms (Swift's `PickerModel` getter, Kotlin's clamp in the setter that
    // answers the read). The wrapper clamps before React sends anything, so an app
    // cannot ask native for index 9 of three options and the handle is the only
    // door left - which makes this the only test that can see the native half of
    // the clamp at all, and the one that goes red when it is removed (report proof).
    //
    // For this control the getter is not bookkeeping: the index it answers is the
    // title the button paints and the title the sizing key names, so an unclamped
    // read would be a button showing a word that is not in `options`.
    //
    // The write is to the handshake's raw `js` field, which is plain state on both
    // platforms and never renders, so nothing is painted off the UI thread (D14
    // keeps writes like this off the app surface; this is the repo's own harness).
    const { unmount } = await render(
      <Picker
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
    expect(handles.get('raw')?.selectedIndex).toBe(2);

    raw.selectedIndex = -3;
    expect(handles.get('raw')?.selectedIndex).toBe(0);

    // A prop write is not an interaction: it must not emit a change event.
    expect(eventLog).toEqual([]);
    unmount();
  });

  it('clamps the selection and re-measures when the options shrink', async () => {
    // The third clamp rule, and the one with a size attached: the index is still
    // 3 but the list is two long, so the title has to move to the last remaining
    // option - which is a different word, so the button has to resize as well as
    // re-seed. A host that clamped only the paint, or only the key, leaves either
    // a title that is not in the list or a box sized for a title it no longer has.
    const WIDE = ['Red', 'Green', 'Blue', LONG_TITLE];
    const NARROW = ['Red', 'Green'];
    const { rerender, unmount } = await render(
      <Picker
        options={WIDE}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('shrink');
    const wide = await waitForMeasured('shrink', 'four options');
    await waitForBox('shrink', wide, 'four options');
    const before = stats();

    await rerender(
      <Picker
        options={NARROW}
        selectedIndex={3}
        testID="shrink"
        hybridRef={captureHybrid('shrink')}
      />
    );
    const narrow = await waitForRemeasure('shrink', wide, 'the shorter list');
    await waitForBox('shrink', narrow, 'the shorter list');
    const after = delta(before, stats());
    console.log(
      `shrink: wide=${describeSize(wide)} narrow=${describeSize(narrow)} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(handles.get('shrink')?.selectedIndex).toBe(1);
    expect(handles.get('shrink')?.options).toEqual(NARROW);
    expect(narrow.width).toBeLessThan(wide.width - 20);
    // The engine was told a *new* size for a configuration it had never seen
    // (`cachedSizes`), and something measured it. Which of the two counters that
    // costs is a platform difference worth naming: iOS reports after SwiftUI
    // commits, so the box moves and costs a correction; Android's shadow node is
    // measured during the layout pass in which the new props land, so it can settle
    // the configuration before the frame and cost none (measured: shrink on
    // `nitroui_t01` gives `corrections: 0, measurements: 1, cachedSizes: 1` with the
    // box going 384.76 -> 280, while iPhone 17 gives `corrections: 1`). Requiring a
    // correction on Android would be requiring a wasted frame.
    expect(after.cachedSizes).toBeGreaterThanOrEqual(1);
    expect(after.measurements + after.corrections).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('reads back what React sent', async () => {
    // One mount, every prop: what the wrapper promised to send and what native
    // kept. This is also the only place the suite can see `variant`, `label` and
    // `disabled` arriving at all, since none of them has a geometry the harness can
    // reach (a `label` shows on Android's field and iOS's menu title, and neither
    // is queryable from inside the app).
    const OPTIONS = ['One', 'Two', 'Three'];
    const { unmount } = await render(
      <View style={columnStyle}>
        <Picker
          options={OPTIONS}
          selectedIndex={1}
          label="Size"
          tintColor="#c837ab"
          accessibilityLabel="Choose a size"
          testID="read-back"
          hybridRef={captureHybrid('read-back')}
        />
        <Picker
          options={OPTIONS}
          variant="wheel"
          disabled
          testID="read-back-wheel"
          hybridRef={captureHybrid('read-back-wheel')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('read-back');
    await waitForMeasured('read-back', 'the menu');
    await waitForMeasured('read-back-wheel', 'the wheel');
    const menu = handles.get('read-back');
    const wheel = handles.get('read-back-wheel');
    expect(menu).toBeDefined();
    expect(wheel).toBeDefined();
    console.log(
      `read back: variant=${String(menu?.variant)}/${String(wheel?.variant)} ` +
        `selected=${String(menu?.selectedIndex)} ` +
        `eventCount=${String(menu?.mostRecentEventCount)} ` +
        `label=${String(menu?.label)} tint=${String(menu?.tintColor)} ` +
        `disabled=${String(menu?.disabled)}/${String(wheel?.disabled)}`
    );
    expect(menu?.options).toEqual(OPTIONS);
    expect(menu?.selectedIndex).toBe(1);
    expect(menu?.mostRecentEventCount).toBe(0);
    expect(menu?.variant).toBe('menu');
    expect(menu?.label).toBe('Size');
    expect(menu?.accessibilityLabel).toBe('Choose a size');
    expect(menu?.disabled).toBe(false);
    // `processColor` on both platforms, so a hex string arrives as a number and
    // `undefined` as null - the sentinel rule of core.md section 3, not a colour.
    expect(typeof menu?.tintColor).toBe('number');
    expect(wheel?.variant).toBe('wheel');
    expect(wheel?.disabled).toBe(true);
    expect(wheel?.label).toBeNull();
    expect(wheel?.tintColor).toBeNull();
    unmount();
  });

  it('keeps a caller width in charge, and its own size in the cache', async () => {
    // The half of sizing the caller decides: `style.width` wins over what the
    // control measured, and the box must be exactly that. The second half is the
    // one that bites later: the *cache* must still hold the control's own width,
    // because a 240 dp box filed under this title means every later picker with
    // the same title gets 240 dp (the pre-T11 bug in sizing.md section 3). So the
    // same configuration is mounted again afterwards, with no width, and has to
    // come back at the intrinsic size it reported - not at 240, and not by
    // learning a new size (which would mean the entry was never there).
    const OPTIONS = ['January', 'February', 'March'];
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        testID="fixed"
        style={{ width: 240 }}
        hybridRef={captureHybrid('fixed')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('fixed');
    const box = boxOf('fixed');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 240) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('fixed', 'three month titles');
    // The control measured its own width; it did not adopt the box it was given.
    expect(intrinsic.width).not.toBeCloseTo(240, 0);
    await settle(300);

    // Same options, same title, same variant: one configuration, no width.
    await rerender(
      <Picker
        options={OPTIONS}
        testID="fixed"
        hybridRef={captureHybrid('fixed')}
      />
    );
    await settle(400);
    const after = sizeOf('fixed');
    console.log(
      `caller width: box=240 measured=${describeSize(intrinsic)} ` +
        `then no width: box=${describeSize(after)}`
    );
    expect(sameSize(after, intrinsic)).toBe(true);
    unmount();
  });

  it('fits an over-wide menu into the box the caller gave it', async () => {
    // C1, menu edition: the *title* wants ~230 dp and the box is 180, so the button
    // has to be a 180 dp button that truncates its own title. Before the host asked
    // for a *placement* measure with the box's constraints, Android drew the field
    // at its intrinsic width inside the box and cut it off, and the popup was
    // anchored to a field that was not where the box was.
    //
    // Note what makes a menu over-wide at all: one long selected title, not a long
    // list - a `January` in `['January', 'February', …]` is 101 wide whatever the
    // rest of the list holds, which is what a menu does differently from a
    // segmented row.
    //
    // The reported size is asserted in the same breath, because placement must not
    // become the report: 180 filed under this title would size every later picker
    // with this title at 180.
    const OPTIONS = [LONG_TITLE, 'Red'];
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        testID="overwide"
        style={{ width: 180 }}
        hybridRef={captureHybrid('overwide')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('overwide');
    const box = boxOf('overwide');
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 180) < 0.6).toBe(true);
    const intrinsic = await waitForMeasured('overwide', 'four month titles');
    console.log(
      `over-wide: box=${describeSize(box)} measured=${describeSize(intrinsic)}`
    );
    expect(intrinsic.width).toBeGreaterThan(box!.width + 20);
    unmount();
  });

  it('re-fits when the caller narrows the box under an over-wide menu', async () => {
    // The same box moving: a flex parent narrowing on rotation is this path. An
    // arming is a fact about one content at one box, so each move retires it, and
    // the measure at the new box has to discover the overrun and ask for its own
    // placement measure. A host that reads an expired arming as "already placed at
    // the box" answers 150 with a field drawn at 230 dp, cut off, with a popup
    // anchored somewhere the button is not.
    const OPTIONS = [LONG_TITLE, 'Red'];
    const row = (width: number) => (
      <View style={{ width }}>
        <Picker
          options={OPTIONS}
          testID="refit"
          hybridRef={captureHybrid('refit')}
        />
      </View>
    );
    // Wide enough to be over-wide at every box below, and the box comes from the
    // parent, not from a `width` on the control: that is what a rotation does.
    const { rerender, unmount } = await render(row(200), { timeout: 20000 });
    await waitForTestId('refit');
    const intrinsic = await waitForMeasured('refit', 'the long title');
    expect(intrinsic.width).toBeGreaterThan(200 + 20);
    const first = boxOf('refit');
    expect(first).not.toBeNull();
    expect(Math.abs(first!.width - 200) < 0.6).toBe(true);

    await rerender(row(168));
    await waitForBox(
      'refit',
      { width: 168, height: first!.height },
      'the narrower parent'
    );
    expect(intrinsic.width).toBeGreaterThan(168 + 20);
    // The report is still the control's own width, not the box it was fitted into.
    expect(sameSize(measured('refit'), intrinsic)).toBe(true);

    await rerender(row(140));
    await waitForBox(
      'refit',
      { width: 140, height: first!.height },
      'the narrowest parent'
    );
    expect(sameSize(measured('refit'), intrinsic)).toBe(true);
    console.log(
      `refit: measured=${describeSize(intrinsic)} boxes=200/168/140 ` +
        `final=${describeSize(sizeOf('refit'))}`
    );
    unmount();
  });

  it('survives remounts with the size and seed of each mount', async () => {
    // Recycle, in the sense a list does it: the same testID, several lifetimes, each
    // with a different option list and a different starting title. Two things are
    // under test. Sizing: a recycled host that keeps answering with the *previous*
    // mount's measurement leaves the next mount laid out for a title it is not
    // showing. And state: `prepareForRecycle` has to drop the popup's open flag and
    // the optimistic title, or a mount that never asked for a title starts with one.
    const FIRST = ['One', 'Two', 'Three'];
    const SECOND = ['A considerably longer colour name', 'Red'];
    const THIRD = ['Go'];
    const { rerender, unmount } = await render(
      <Picker
        options={FIRST}
        testID="remount"
        hybridRef={captureHybrid('remount')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('remount');
    const first = await waitForMeasured('remount', 'the first list');
    await waitForBox('remount', first, 'the first list');

    for (const [index, options] of [SECOND, THIRD, SECOND].entries()) {
      const handleId = `remount-${String(index)}`;
      // Unmount, then mount something else under the same testID.
      rerender(<View key={`gap-${String(index)}`} />);
      await settle(150);
      await rerender(
        <Picker
          options={options}
          defaultSelectedIndex={index % 2}
          testID="remount"
          hybridRef={captureHybrid(handleId)}
        />
      );
      // The element keeps the one testID - that is the recycle. The handle is
      // captured per mount, because `hybridRef` runs once per mount (D14) and the
      // old handle belongs to a view that is gone.
      await waitForTestId('remount');
      const size = await waitForMeasured(handleId, `mount ${String(index)}`);
      await waitForBox('remount', size, `mount ${String(index)}`);
      expect(sameSize(size, WRONG_SIZE)).toBe(false);
      expect(handles.get(handleId)?.options).toEqual(options);
      console.log(
        `remount ${String(index)}: ${String(options.length)} options ` +
          `seed=${String(index % 2)} measured=${describeSize(size)}`
      );
    }
    // Each mount reported its own size: the first list's box is not the answer for
    // a list of one option.
    const last = measured('remount-2');
    expect(last !== null && last.width > first.width + 20).toBe(true);
    unmount();
  });

  // MARK: - M1: a pick must re-key the size it reports

  it('files a real pick under the key of the title the pick shows', async () => {
    // The sizing key names the selected title, so a pick is a change of *size
    // configuration* - and the rule that keeps the cache honest is that a report
    // may only be filed under a key that names the title being painted. A native
    // pick paints a new title a whole round trip before React sends the key that
    // names it, so the host must not answer in between: measuring there files the
    // new title's width under the old title's key.
    //
    // Both configurations are poisoned, so every layout the engine does is a
    // visible event in the trace, and the pick is required to cost exactly one
    // correction - the new key's own cold answer. Two means something was filed
    // under the *old* key first: the width of the title the pick painted, written
    // against the key of the title it replaced.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        onChange={recordChange('pick-key')}
        testID="pick-key"
        hybridRef={captureHybrid('pick-key')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('pick-key');
    const shortSize = await waitForMeasured('pick-key', 'the short title');
    await waitForBox('pick-key', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    // The pick itself, and the app accepting it - what an `onChange` that calls
    // `setState` does. The order is the real one: native chooses, emits, and the
    // props batch that names the new title arrives after the echo.
    await pickRow('pick-key', 2);
    // The choice is real (a row's path, not a prop write), and it is reported once.
    expect(eventLog).toEqual(['pick-key:2']);
    // Let the choice's own paint-and-measure land before the echo, the way it does
    // in an app: an `onChange` that calls `setState` costs a render and a bridge
    // round trip, while the control repaints on its next frame. The invariant this
    // test is about only exists for that ordering - a report filed while the old
    // key is still the one the engine has.
    await settle(200);
    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        onChange={recordChange('pick-key')}
        testID="pick-key"
        hybridRef={captureHybrid('pick-key')}
      />
    );
    // Native painted the new title on its own; the box follows in the batch that
    // names it, and the test asks for that size rather than assuming a frame.
    const painted = await waitForRemeasure(
      'pick-key',
      shortSize,
      'the long title, painted by the pick'
    );
    expect(painted.width).toBeGreaterThan(shortSize.width + 20);
    const widest = sizeOf('pick-key');
    await waitForBox('pick-key', painted, 'the long title');
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `pick re-keys: short=${describeSize(shortSize)} ` +
        `long=${describeSize(painted)} box=${describeSize(widest)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)} events=${JSON.stringify(eventLog)}`
    );
    // One choice, one event, and it is the one the wrapper reports.
    expect(eventLog).toEqual(['pick-key:2']);
    // Exactly the new configuration's own cold correction - no more.
    expect(after.corrections).toBe(1);
    // And no frame of it was laid out at the declared fallback: the engine is
    // answering the poisoned (i.e. simply *other*) sizes here, and a fallback-sized
    // box in the middle of a pick is the flash D17 says a warm configuration must
    // not pay.
    expect(laidOut.some((size) => sameSize(size, DECLARED_FALLBACK))).toBe(
      false
    );
    expect(sameSize(sizeOf('pick-key'), painted)).toBe(true);
    unmount();
  });

  it('leaves the width of each title in the cache after a pick', async () => {
    // The damage a pick-time measure does is not the one frame the user sees, it is
    // what it leaves in the process-wide cache: `sel:One` ends up holding the long
    // title's width and is marked exact, so every later picker showing `One` is laid
    // out at 360 pt / 385 dp and corrects back (D17: an exact entry lays the first
    // frame out exact, 0 stale). This reads the cache back by mounting a fresh picker
    // in the configuration the pick *started* from - warm, so it must cost no
    // correction and no stale frame at all.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const first = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="poison"
        hybridRef={captureHybrid('poison')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('poison');
    const shortSize = await waitForMeasured('poison', 'the short title');
    await waitForBox('poison', shortSize, 'the short title');
    await settle(200);

    await pickRow('poison', 2);
    // The ordering note from the pick test above applies here too: the control has
    // painted and measured the new title before this batch arrives.
    await settle(200);
    await first.rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        testID="poison"
        hybridRef={captureHybrid('poison')}
      />
    );
    const longSize = await waitForRemeasure(
      'poison',
      shortSize,
      'the long title, painted by the pick'
    );
    await waitForBox('poison', longSize, 'the long title');
    first.unmount();
    handles.delete('poison');
    await settle(300);

    armTrace();
    const before = stats();
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="again"
        hybridRef={captureHybrid('again')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('again');
    await settle(400);
    const box = sizeOf('again');
    const measuredAgain = measured('again');
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `cache after a pick: startedAt=${describeSize(shortSize)} ` +
        `picked=${describeSize(longSize)} freshMountBox=${describeSize(box)} ` +
        `measured=${describeSize(measuredAgain)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)}`
    );
    // The box the fresh mount was laid out with is the size of the title it shows,
    // on its first read - not the title the previous picker picked.
    expect(sameSize(box, shortSize)).toBe(true);
    expect(sameSize(box, measuredAgain)).toBe(true);
    // Warm means no correction, and the trace says no other box was ever drawn.
    expect(after.corrections).toBe(0);
    expect(laidOut.every((size) => sameSize(size, shortSize))).toBe(true);
    unmount();
  });

  it('re-keys the size of an uncontrolled pick, with no render to ask for it', async () => {
    // The uncontrolled twin, which is the case the whole mechanism exists for: no
    // React render is coming, so nothing else can tell the engine that the title -
    // and with it the size configuration - moved. The wrapper tracks the index the
    // native side reported (one render per choice, which is what a discrete control
    // costs everywhere else) so the key follows the shown title, and the host holds
    // its reports until that batch arrives.
    //
    // This is also the case the real-input suite proves from outside (the box grows
    // after a tap); here it is the same claim with the counters beside it.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChange('unc')}
        testID="unc"
        hybridRef={captureHybrid('unc')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('unc');
    const shortSize = await waitForMeasured('unc', 'the short title');
    await waitForBox('unc', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    // The choice is real and it is reported once - native chose, and JS was told.
    await pickRow('unc', 2);
    expect(eventLog).toEqual(['unc:2']);
    // Still uncontrolled: JS never sends an index. So the only thing that can move
    // the size configuration is the wrapper noticing what native showed it, and the
    // key it sends has to name the title now on screen. Before that, every width
    // this instance reports - and the cache entry it lands in - belongs to a title
    // that is no longer drawn.
    expect(handles.get('unc')?.selectedIndex).toBe(null);
    const sentKey = (handles.get('unc') as unknown as { nuiSizingKey?: string })
      ?.nuiSizingKey;
    expect(sentKey).toBe(sizingKey(OPTIONS, 2, null, 'menu'));
    const longSize = await waitForRemeasure(
      'unc',
      shortSize,
      'the long title, chosen without a render'
    );
    await waitForBox('unc', longSize, 'the long title');
    await settle(300);
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `uncontrolled pick: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)} events=${JSON.stringify(eventLog)}`
    );
    // One choice, one correction: the new configuration's own cold answer, and no
    // frame of it laid out at the declared fallback.
    expect(after.corrections).toBe(1);
    expect(laidOut.some((size) => sameSize(size, DECLARED_FALLBACK))).toBe(
      false
    );
    unmount();
    handles.delete('unc');
    await settle(300);

    // And the damage a pick-time report does is the part nobody sees: the cache
    // entry of the title the pick *replaced* would hold this title's width and be
    // marked exact, so the next picker showing `One` is laid out at the long width
    // and corrects back. A warm configuration must cost a fresh mount nothing.
    armTrace();
    const cacheBefore = stats();
    const second = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        testID="unc-again"
        hybridRef={captureHybrid('unc-again')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('unc-again');
    await settle(400);
    const boxAgain = sizeOf('unc-again');
    const measuredAgain = measured('unc-again');
    const cacheAfter = delta(cacheBefore, stats());
    const laidOutAgain = laidOutSizes();
    console.log(
      `uncontrolled cache: freshMountBox=${describeSize(boxAgain)} ` +
        `measured=${describeSize(measuredAgain)} ` +
        `laidOut=${laidOutAgain.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(cacheAfter)}`
    );
    expect(sameSize(boxAgain, shortSize)).toBe(true);
    expect(sameSize(boxAgain, measuredAgain)).toBe(true);
    expect(cacheAfter.corrections).toBe(0);
    expect(laidOutAgain.every((size) => sameSize(size, shortSize))).toBe(true);
    second.unmount();
  });

  it("holds a pick's report until the batch that names the title", async () => {
    // The host's hold only matters inside one window: between the pick and the props
    // batch that re-keys. So the fixture makes that window real - an `onChange` that
    // keeps JS busy, the way a dispatch or a heavy render does in an app - which lets
    // the control paint and lay out its new title *first*. A host that measures on its
    // own then files the new title's width under the key of the title it replaced,
    // which is the cache damage M1 is about.
    //
    // With the hold, the first box drawn after the pick is the new key's own cold
    // answer (the poisoned size) and the pick costs exactly one correction. Without
    // it, the first box is the long title's width, filed under `sel:One`, and the pick
    // costs two.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    poisonConfigurations([
      sizingKey(OPTIONS, 0, null, 'menu'),
      sizingKey(OPTIONS, 2, null, 'menu'),
    ]);
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChangeThenBlock('slow-echo')}
        testID="slow-echo"
        hybridRef={captureHybrid('slow-echo')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('slow-echo');
    const shortSize = await waitForMeasured('slow-echo', 'the short title');
    await waitForBox('slow-echo', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    // The choice runs the row's own path; its event handler is the spin above, so the
    // control repaints and lays out while JS is still inside the choice.
    await pickRow('slow-echo', 2);
    expect(eventLog).toEqual(['slow-echo:2']);
    const longSize = await waitForRemeasure(
      'slow-echo',
      shortSize,
      'the long title, chosen behind a busy JS thread'
    );
    await waitForBox('slow-echo', longSize, 'the long title');
    await settle(300);
    const after = delta(before, stats());
    const laidOut = laidOutSizes();
    console.log(
      `busy-echo pick: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} ` +
        `laidOut=${laidOut.map((s) => describeSize(s)).join(',')} ` +
        `delta=${JSON.stringify(after)}`
    );
    // One correction for one pick, and it belongs to the new key: the first box the
    // engine drew after the pick is the poisoned size for `sel:<long>`. If the pick
    // answered for itself, that first box is the long title's width instead and there
    // is a correction more.
    expect(after.corrections).toBe(1);
    expect(sameSize(laidOut[0] ?? null, WRONG_SIZE)).toBe(true);
    expect(laidOut.some((size) => sameSize(size, DECLARED_FALLBACK))).toBe(
      false
    );
    expect(sameSize(sizeOf('slow-echo'), longSize)).toBe(true);
    unmount();
  });

  it('grows an unpoisoned pick whose new configuration starts at the fallback', async () => {
    // The pick tests above poison every configuration, which is what makes a
    // missing correction visible - and, as G6's real-input run found, what let one
    // bug hide: a poisoned key answers with the poisoned size, so the box *moves*,
    // and a host that is waiting for a box change to ask its next measure gets
    // asked. With a cold key the engine's first answer is the declared fallback,
    // which for a title growing inside a box that is already at the fallback width
    // is the box it has - nothing moves, nothing asks, and the control is left
    // painting an ellipsised title for the rest of the mount.
    //
    // This is real-input step 4 as a gate: no poison, no trace, just the box the
    // user ends up with after choosing a longer title from an uncontrolled picker.
    // The fixture is the real-input screen's own options.
    const OPTIONS = ['Onyx', 'Quartz', 'A considerably longer mineral name'];
    const { unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChange('plain-unc')}
        testID="plain-unc"
        hybridRef={captureHybrid('plain-unc')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('plain-unc');
    const shortSize = await waitForMeasured('plain-unc', 'the short title');
    await waitForBox('plain-unc', shortSize, 'the short title');
    await settle(200);
    const before = stats();

    await pickRow('plain-unc', 2);
    expect(eventLog).toEqual(['plain-unc:2']);
    const longSize = await waitForRemeasure(
      'plain-unc',
      shortSize,
      'the longer title the pick painted'
    );
    expect(longSize.width).toBeGreaterThan(shortSize.width + 20);
    // The claim real-input makes from outside, made here with the box reading.
    await waitForBox(
      'plain-unc',
      longSize,
      'the box following the picked title'
    );
    const after = delta(before, stats());
    console.log(
      `unpoisoned pick: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} box=${describeSize(sizeOf('plain-unc'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(sameSize(sizeOf('plain-unc'), longSize)).toBe(true);
    unmount();
  });

  it('goes on reporting its size after a re-tap of the row already shown', async () => {
    // The same rule on the ordinary path: a refused press leaves no hold behind, so an
    // app that then changes something about the control's content still gets its size
    // reported. Nothing here needs the pick's window - which is what makes this the
    // case an app actually hits.
    const SHORT = ['One', 'Two', 'Three'];
    const LONG = [LONG_TITLE, 'Two', 'Three'];
    poisonConfigurations([
      sizingKey(SHORT, 0, null, 'menu'),
      sizingKey(LONG, 0, null, 'menu'),
    ]);
    const { rerender, unmount } = await render(
      <Picker
        options={SHORT}
        onChange={recordChange('re-tap')}
        testID="re-tap"
        hybridRef={captureHybrid('re-tap')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('re-tap');
    const shortSize = await waitForMeasured('re-tap', 'the short title');
    await waitForBox('re-tap', shortSize, 'the short title');
    await settle(200);
    armTrace();
    const before = stats();

    // Press the row that is already shown: the list closes, nothing is emitted, and no
    // batch follows - so nothing may be held back on its account.
    await pickRow('re-tap', 0);
    expect(eventLog).toEqual([]);
    expect(sameSize(sizeOf('re-tap'), shortSize)).toBe(true);

    // Now the size really does move, and the engine has to hear about it.
    await rerender(
      <Picker
        options={LONG}
        onChange={recordChange('re-tap')}
        testID="re-tap"
        hybridRef={captureHybrid('re-tap')}
      />
    );
    const longSize = await waitForRemeasure(
      're-tap',
      shortSize,
      'the long title the new options brought'
    );
    await waitForBox('re-tap', longSize, 'the box following the new title');
    await settle(300);
    const after = delta(before, stats());
    console.log(
      `re-tap then resize: short=${describeSize(shortSize)} ` +
        `long=${describeSize(longSize)} box=${describeSize(sizeOf('re-tap'))} ` +
        `delta=${JSON.stringify(after)}`
    );
    expect(after.corrections).toBeGreaterThan(0);
    expect(sameSize(sizeOf('re-tap'), longSize)).toBe(true);
    unmount();
  });

  // MARK: - M2: a variant change is a different control, not a repaint

  it('asks a wheel the box question after a variant change', async () => {
    // Both variants of Progress's two-policy switch live here, and Android builds
    // the question when the composition is built: `NitroUiMeasuredRoot` is handed
    // `unbounded = sizingPolicy == POLICY_INTRINSIC` once, and reads no state that
    // changes. So a `menu` that becomes a `wheel` at runtime goes on being asked
    // the unbounded question - and `fillMaxWidth()` under infinite constraints is a
    // no-op, which leaves the field reporting its own 280 dp inside a box the caller
    // made 330 wide. Progress solves this by keying the native view on the variant;
    // a rerender of the same instance is the only thing that can show it.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const BOX = { width: 330, height: 60 };
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        variant="menu"
        testID="var-w"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-w')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('var-w');
    const asMenu = await waitForMeasured('var-w', 'a menu of the short title');
    // The caller's width is in charge, so the box is 330 whatever the menu measured.
    expect(Math.abs(boxOf('var-w')!.width - BOX.width) < 0.6).toBe(true);
    expect(asMenu.width).not.toBeCloseTo(BOX.width, 0);
    await settle(200);

    // What this mount measures before the rerender, so the wait after it can
    // refuse the pre-change number and a zero.
    const staleWheel = asMenu;
    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={0}
        variant="wheel"
        testID="var-w"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-w')}
      />
    );
    const asWheel = await waitForFreshMeasure(
      'var-w',
      staleWheel,
      'the wheel after the remount'
    );
    await settle(300);
    console.log(
      `variant menu->wheel: menu=${describeSize(asMenu)} ` +
        `wheel=${describeSize(asWheel)} box=${describeSize(boxOf('var-w'))}`
    );
    // A wheel is as wide as its box, whatever the menu before it measured.
    expect(Math.abs(asWheel.width - BOX.width) < 1).toBe(true);
    unmount();
  });

  it('asks a menu the unbounded question after a variant change', async () => {
    // The other direction, and the one that poisons the cache: a `wheel` that
    // becomes a `menu` goes on being asked the *bounded* question, so a 40-character
    // title offered a 330 box measures 330, agrees with the box, and is confirmed -
    // the field stays truncated for the life of the mount and `cache[menu|...]`
    // records the box's width as the title's own.
    const OPTIONS = ['One', 'Two', LONG_TITLE];
    const BOX = { width: 330, height: 60 };
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        variant="wheel"
        testID="var-m"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-m')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('var-m');
    const asWheel = await waitForMeasured('var-m', 'a wheel of the long title');
    expect(Math.abs(asWheel.width - BOX.width) < 1).toBe(true);
    await settle(200);

    // What this mount measures before the rerender, so the wait after it can
    // refuse the pre-change number and a zero.
    const staleMenu = asWheel;
    await rerender(
      <Picker
        options={OPTIONS}
        selectedIndex={2}
        variant="menu"
        testID="var-m"
        style={{ width: BOX.width, height: BOX.height }}
        hybridRef={captureHybrid('var-m')}
      />
    );
    const asMenu = await waitForFreshMeasure(
      'var-m',
      staleMenu,
      'the menu after the remount'
    );
    await settle(300);
    console.log(
      `variant wheel->menu: wheel=${describeSize(asWheel)} ` +
        `menu=${describeSize(asMenu)} box=${describeSize(boxOf('var-m'))}`
    );
    // The menu reports the title's own width - wider than the box it sits in, which
    // is the C1 over-wide story - rather than the box's width back as a verdict.
    expect(asMenu.width).toBeGreaterThan(BOX.width + 1);
    unmount();
  });

  it('does not treat opening as a choice, and the next mount sizes normally after going away mid-menu', async () => {
    // A press on the anchor is the only interaction the harness can deliver,
    // because the anchor is in the app's window and the popup it opens is not.
    // That leaves two honest claims, both of which need a real tap:
    //
    //  1. Opening the list is not a selection. A host that reported a change when
    //     the menu opened would give an app a phantom `onChange` on every press, so
    //     the log has to stay empty - and the title has not moved either, which the
    //     unchanged box says as much as the read-back does.
    //  2. Going away while the list is open must not take the app with it. The
    //     popup belongs to a window of its own, and B1's rule is that nothing a
    //     mount attaches may outlive it: a popup dismissed by nothing is exactly
    //     the leak that pattern is about. Whether the popup is *actually* gone is
    //     counted from outside in the real-input case (`dumpsys window` /
    //     `app.windows`), which is also where the open state is visible at all;
    //     what this can assert from in here is that the next screen mounts, sizes
    //     and measures normally after the one that went away mid-menu.
    const OPTIONS = ['One', 'Two', 'Three'];
    const { rerender, unmount } = await render(
      <Picker
        options={OPTIONS}
        onChange={recordChange('press-me')}
        testID="press-me"
        hybridRef={captureHybrid('press-me')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('press-me');
    const size = await waitForMeasured('press-me', 'three options');
    await waitForBox('press-me', size, 'three options');

    await pressAnchor('press-me');
    await settle(400);
    expect(eventLog).toEqual([]);
    expect(handles.get('press-me')?.mostRecentEventCount).toBe(0);
    // The box did not move when the list opened: a menu is an overlay, not a
    // relayout, and a host that resized on open would push the whole screen down.
    expect(sameSize(sizeOf('press-me'), size)).toBe(true);

    // Now drop the screen with the list open, and mount a different one.
    rerender(<View testID="after-drop" style={{ height: 40 }} />);
    await settle(300);
    const { unmount: unmountSecond } = await render(
      <Picker
        options={['After the drop']}
        testID="after-drop"
        hybridRef={captureHybrid('after-drop')}
      />,
      { timeout: 20000 }
    );
    await waitForTestId('after-drop');
    const afterSize = await waitForMeasured('after-drop', 'one option');
    await waitForBox('after-drop', afterSize, 'one option');
    expect(sameSize(afterSize, WRONG_SIZE)).toBe(false);
    console.log(
      `open-then-drop: menu=${describeSize(size)} after=${describeSize(afterSize)} ` +
        `events=${JSON.stringify(eventLog)}`
    );
    unmountSecond();
    unmount();
  });
});
