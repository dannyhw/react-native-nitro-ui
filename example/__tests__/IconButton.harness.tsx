/**
 * On-device tests for the IconButton (task G23).
 *
 * An IconButton is Button's box and Chip's value, so this suite asks each of them's
 * questions, plus two the control has on its own.
 *
 * - **Button's**: is the laid-out box the size the control measured, for every
 *   configuration the sizing key names (`variant|size|width|systemImage|androidIcon`)?
 *   Every cold configuration is **poisoned** first (`seedSizingSize` with a size no
 *   icon button has, then an environment bump), so a correction that never arrives
 *   leaves a visible wrong box *and* costs a correction this file requires
 *   (`Button.harness.tsx` explains the precedent, and why the fallback being *exact*
 *   for the default rung does not weaken it: the poison is the wrong answer).
 * - **Chip's**: does the event-count handshake hold — a controlled selection both
 *   ways, a toggle JS refused reverting, a value written from JS applying?
 * - **Its own first**: the ladder. A rung here is one of Material's own
 *   `IconButtonDefaults` container tokens, and `width` costs width and never height —
 *   a control that ignored `width` would still measure *a* box, so the grid is
 *   asserted, not logged. And the 48 dp floor: Material will not publish a smaller
 *   touch target than `MinInteractiveComponentSize`, so the small rung's box is wider
 *   than the 28 dp token it is drawn from, and only a device says so.
 * - **Its own second**: the glyph is the whole control, so "is it drawn, in the
 *   control's content colour, at the size the rung asked for?" is the one drawing
 *   contract no prop echo answers. G19's pixel probe answers it, on the platform that
 *   draws a glyph at all.
 *
 * The readings: `harnessUi.queryByTestId` (the box Fabric gave the view),
 * `hybridRef.measureContent()` (the size the hosted control measured),
 * `nitroUiCore.sizingStats()` (what the engine did), the control's own
 * `nuiTestStateReport()` (what it is drawing, and on Android what its accessibility
 * node says) and `nuiTestPixelProbe`/`nuiTestPixelReport` (what it painted).
 */
import { useState } from 'react';
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
import { screen, userEvent } from '@react-native-harness/ui';
import {
  IconButton,
  nitroUiCore,
  type IconButtonSize,
  type IconButtonVariant,
  type IconButtonWidth,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The IconButton's Fabric name — what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiIconButton';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back — declared, not imported (DECISIONS D14). */
type IconButtonHandle = {
  readonly accessibilityLabel: string;
  readonly systemImage: string | null;
  readonly androidIcon: string | null;
  readonly variant: string;
  readonly size: string;
  readonly width: string;
  readonly shape: string;
  readonly disabled: boolean;
  readonly checked: boolean | null;
  readonly mostRecentEventCount: number;
  measureContent(): { width: number; height: number };
  nuiTestPress(): void;
  nuiTestProbeAccessibility(): void;
  nuiTestStateReport(): string;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
};

const handles = new Map<string, IconButtonHandle>();
const captureHybrid =
  (testId: string) =>
  (view: IconButtonHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app was told, in order, as `testID:value`. */
const events: string[] = [];
const recordChecked =
  (testId: string) =>
  (checked: boolean): void => {
    events.push(`${testId}:${String(checked)}`);
  };
const recordPress = (testId: string) => (): void => {
  events.push(`${testId}:press`);
};

/** The parents' `checked` setters, by testID — how a test writes a value from JS. */
const setters = new Map<string, (next: boolean) => void>();

/** A glyph the example app ships in `res/drawable/`, and one it does not. */
const SHIPPED = 'nitroui_test_star';
const NOT_SHIPPED = 'nitroui_test_never_built';

const RUNGS: readonly IconButtonSize[] = [
  'small',
  'medium',
  'large',
  'xlarge',
  'xxlarge',
];
const WIDTHS: readonly IconButtonWidth[] = ['narrow', 'uniform', 'wide'];

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

function corrections(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return (
    after.correctionsImmediate -
    before.correctionsImmediate +
    (after.correctionsBatched - before.correctionsBatched)
  );
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

function handleOf(testId: string): IconButtonHandle {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(`"${testId}" never handed back a hybridRef handle.`);
  }
  return handle;
}

async function waitForMeasured(testId: string, what: string): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never reported a measured size from the hosted ` +
          `control. Box: ${describeSize(sizeOf(testId))}.`
      )
  );
}

/** Poll until the box of `testId` is `size`, i.e. until a size has really arrived. */
async function waitForBox(testId: string, size: Size, what: string) {
  return pollUntil(
    () => (sameSize(sizeOf(testId), size) ? sizeOf(testId) : null),
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached ${describeSize(size)} - ` +
          `last box ${describeSize(sizeOf(testId))}, control measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/**
 * Mount each id, then wait until each one's *laid-out* box equals what its own control
 * measured. Every assertion in this file sits behind this: a box still standing at the
 * planted size would make "it corrected" and "it never corrected" read the same.
 */
async function settleEach(
  testIds: readonly string[]
): Promise<Map<string, Size>> {
  const sizes = new Map<string, Size>();
  for (const testId of testIds) {
    await waitForTestId(testId);
    const content = await waitForMeasured(testId, testId);
    await waitForBox(testId, content, testId);
    sizes.set(testId, content);
  }
  return sizes;
}

/** The control's own report, as `key -> value`. */
function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/** Poll until the control is drawing `displayed` (`1`, `0` or `none`). */
async function waitForDisplayed(testId: string, displayed: string) {
  return pollUntil(
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

/** Wait until the app has been told exactly `wanted` since `from`. */
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
  // Then a quiet period, and everything that arrived — Chip's rule: returning the
  // moment the count is reached let a surplus event through, and a control that fires
  // twice per tap is exactly what this suite has to be able to see.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/**
 * Press an icon button the way this platform's harness can.
 *
 * Android: a harness tap, which Compose takes like any touch. iOS: the control's own
 * `nuiTestPress()`, which runs the tap's path. The harness's iOS tap is a `UITouch`
 * with no HID event behind it and SwiftUI's button gesture refuses it — measured for
 * `Button` (G2), for `Chip` (G12) and for `Checkbox` (G15), all of which are the same
 * element an iOS icon button is. The real tap is `real-input:ios`'s, which is where
 * SwiftUI's own gesture is proved, once per tap.
 */
async function pressButton(testId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await userEvent.press(await waitForTestId(testId));
    return;
  }
  handleOf(testId).nuiTestPress();
}

/** Wait for the next accessibility probe, and return its `a11y` field. */
async function probeAccessibility(testId: string): Promise<string> {
  const handle = handleOf(testId);
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

/** Ask what colour is on screen, and wait for the answer. */
async function pixelProbe(
  testId: string,
  color: number,
  what: string
): Promise<string> {
  const handle = handleOf(testId);
  const before = handle.nuiTestPixelReport();
  handle.nuiTestPixelProbe(color);
  const report = await pollUntil(
    () => {
      const next = handle.nuiTestPixelReport();
      return next === '' || next === before ? null : next;
    },
    () =>
      new Error(
        `the pixel probe for "${testId}" (${what}) never reported. Last report: ` +
          `"${handle.nuiTestPixelReport()}".`
      ),
    8000
  );
  if (!/ hits=\d+/.test(report) && !/no pixels/.test(report)) {
    throw new Error(
      `the pixel probe for "${testId}" (${what}) reported a line that is neither a ` +
        `sample nor a refusal: ${report}`
    );
  }
  return report;
}

/** The `hits=` count of a probe line. */
function probeHits(report: string): number {
  const hits = / hits=(\d+)/.exec(report);
  return hits == null ? 0 : Number(hits[1]);
}

/**
 * The key `IconButton.tsx` builds: `variant|size|width|systemImage|androidIcon`.
 * Written out rather than imported, so a wrong helper cannot poison and pass its own
 * test (`Button.harness.tsx` and `Chip.harness.tsx` each carry the same rule).
 */
function sizingKey(
  variant: IconButtonVariant,
  size: IconButtonSize,
  width: IconButtonWidth,
  systemImage: string,
  androidIcon: string
): string {
  return [variant, size, width, systemImage, androidIcon].join('|');
}

/** A size that is no icon button's, planted as the engine's answer before a mount. */
const WRONG_SIZE = { width: 17.5, height: 63.5 };

/**
 * The default control's own numbers, spelled once.
 *
 * `standard`/`medium`/`uniform` with this glyph is the configuration
 * `scripts/conformance-core.mjs`'s fallback row claims, and the one
 * `Conformance.harness.tsx` mounts — so the two files read one definition rather than
 * each keeping its own copy of "the default".
 */
const DEFAULT_GLYPH = { systemImage: 'xmark', androidIcon: SHIPPED };

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

const rowStyle = { gap: 8, alignItems: 'flex-start' } as const;

afterEach(() => {
  cleanup();
  handles.clear();
  setters.clear();
  events.length = 0;
});

describe('IconButton · G23', () => {
  it('lays every rung and width out at the size the control measured', async () => {
    // One control per rung × width — fifteen on Android, five on iOS, where Material's
    // width option has no counterpart and the platform's own box follows the symbol.
    // Each configuration is poisoned first, so a box that came back at the planted
    // size is a visible failure rather than a passing one.
    const ids: string[] = [];
    for (const size of RUNGS) {
      for (const width of WIDTHS) {
        ids.push(`rung-${size}-${width}`);
      }
    }
    poison(
      RUNGS.flatMap((size) =>
        WIDTHS.map((width) =>
          sizingKey(
            'standard',
            size,
            width,
            DEFAULT_GLYPH.systemImage,
            DEFAULT_GLYPH.androidIcon
          )
        )
      )
    );
    const before = stats();
    await render(
      <View style={rowStyle}>
        {RUNGS.map((size) => (
          <View key={size} style={rowStyle}>
            {WIDTHS.map((width) => (
              <IconButton
                key={width}
                accessibilityLabel={`${size} ${width}`}
                androidIcon={DEFAULT_GLYPH.androidIcon}
                size={size}
                systemImage={DEFAULT_GLYPH.systemImage}
                testID={`rung-${size}-${width}`}
                width={width}
                hybridRef={captureHybrid(`rung-${size}-${width}`)}
              />
            ))}
          </View>
        ))}
      </View>,
      { timeout: 20000 }
    );
    const boxes = await settleEach(ids);
    const made = corrections(before, stats());

    const grid = RUNGS.map((size) =>
      [
        size,
        ...WIDTHS.map(
          (width) =>
            `${width}=${describeSize(boxes.get(`rung-${size}-${width}`) ?? null)}`
        ),
      ].join(' ')
    ).join('\n  ');
    console.log(`icon-button ladder:\n  ${grid}\n  corrections=${made}`);

    // 15 cold configurations, and each owes its own correction. Fifteen is the floor
    // rather than the expectation: iOS folds the three widths into one configuration,
    // so it pays five, and the count is asserted per platform below.
    expect(made).toBeGreaterThanOrEqual(
      Platform.OS === 'android' ? ids.length : RUNGS.length
    );
    for (const testId of ids) {
      const box = boxes.get(testId) ?? null;
      expect(sameSize(box, WRONG_SIZE)).toBe(false);
    }

    // 2. The ladder is a ladder. A control that ignored `size` would still measure a
    //    box and pass everything above, so the rungs are compared with each other.
    const heightAt = (size: IconButtonSize): number =>
      boxes.get(`rung-${size}-uniform`)?.height ?? 0;
    const widthAt = (size: IconButtonSize, width: IconButtonWidth): number =>
      boxes.get(`rung-${size}-${width}`)?.width ?? 0;
    let previousHeight = -1;
    RUNGS.forEach((size, index) => {
      const height = heightAt(size);
      if (index > 0) {
        expect(height).toBeGreaterThan(previousHeight);
      }
      previousHeight = height;
    });

    if (Platform.OS === 'android') {
      // 3. `width` costs width and never height, and the three options are three
      //    boxes. The rung where Material's narrow option is *smaller* than the
      //    height (XS: 28 against 32) is the touch-target case below; from `medium`
      //    up the order is the token order.
      for (const size of RUNGS) {
        expect(widthAt(size, 'wide')).toBeGreaterThan(widthAt(size, 'narrow'));
        expect(heightAt(size)).toBeGreaterThan(0);
      }
      // 4. Material's 48 dp floor: no rung is laid out below the minimum interactive
      //    size, whatever its container token says. The `small` rung's token is 28 dp
      //    wide, so a build that dropped `minimumInteractiveComponentSize()` would
      //    measure 28 here — Button's ladder has the same floor for the same reason.
      for (const size of RUNGS) {
        for (const width of WIDTHS) {
          const box = boxes.get(`rung-${size}-${width}`);
          expect((box?.height ?? 0) >= 48).toBe(true);
          expect((box?.width ?? 0) >= 48).toBe(true);
        }
      }
    } else {
      // iOS ignores `width`, so the three controls of a rung are one configuration and
      // must be the same box — the sentence `docs/components/icon-button.md` prints.
      for (const size of RUNGS) {
        const forRung = WIDTHS.map((width) => ({
          width,
          box: boxes.get(`rung-${size}-${width}`) ?? null,
        }));
        const uniform = forRung.find((entry) => entry.width === 'uniform');
        for (const entry of forRung) {
          expect(sameSize(entry.box, uniform?.box ?? null)).toBe(true);
        }
      }
    }
  });

  it('keys the Android-only width option, so a narrow control cannot inherit the uniform box', async () => {
    // C4's red proof for the key: drop `width` from it and the `narrow` control below
    // is served the `uniform` size the engine was *told* about, and every assertion in
    // the ladder test above still passes because both are real boxes. So this test
    // plants the uniform rung's own size under the narrow key and requires the narrow
    // control to disagree with it.
    const uniform = 'standard|medium|uniform|xmark|nitroui_test_star';
    const narrow = 'standard|medium|narrow|xmark|nitroui_test_star';
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Uniform"
          androidIcon={DEFAULT_GLYPH.androidIcon}
          size="medium"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="key-uniform"
          width="uniform"
          hybridRef={captureHybrid('key-uniform')}
        />
      </View>,
      { timeout: 20000 }
    );
    const warm = await settleEach(['key-uniform']);
    const uniformSize = warm.get('key-uniform') as Size;

    // Plant *the other option's answer* under the narrow key, warm-cache the rest.
    nitroUiCore.seedSizingSize(
      COMPONENT,
      narrow,
      uniformSize.width,
      uniformSize.height
    );
    nitroUiCore.invalidateSizingEnvironment();

    const before = stats();
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Narrow"
          androidIcon={DEFAULT_GLYPH.androidIcon}
          size="medium"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="key-narrow"
          width="narrow"
          hybridRef={captureHybrid('key-narrow')}
        />
      </View>,
      { timeout: 20000 }
    );
    const narrowSize = (await settleEach(['key-narrow'])).get(
      'key-narrow'
    ) as Size;
    const made = corrections(before, stats());
    console.log(
      `width key: ${uniform}=${describeSize(uniformSize)} ` +
        `${narrow}=${describeSize(narrowSize)} corrections=${made}`
    );

    if (Platform.OS === 'android') {
      // The planted size has to be corrected away: `width` is in the key, so the
      // narrow control asks for its own configuration and the engine's answer for it
      // was a lie.
      expect(sameSize(narrowSize, uniformSize)).toBe(false);
      expect(made).toBeGreaterThanOrEqual(1);
    } else {
      // On iOS the two options are one configuration by design, so the planted size is
      // the *right* size and there is nothing to correct. Asserting a correction here
      // would be asserting the platform has an option it does not.
      expect(sameSize(narrowSize, uniformSize)).toBe(true);
    }
  });

  it('keeps one box across the toggle states, and needs no correction for a state change', async () => {
    // A toggle repaints — its colours, its corner, maybe a border — and resizes
    // nothing, on either platform. `Chip.harness.tsx` measures the Android filter chip
    // whose selection *does* move the box; this control is not that control, and the
    // difference is what lets `checked` stay out of the sizing key.
    const keyFor = (icon: string) =>
      sizingKey('tonal', 'large', 'uniform', DEFAULT_GLYPH.systemImage, icon);
    poison([keyFor(SHIPPED)]);
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Press form"
          androidIcon={SHIPPED}
          onPress={() => {}}
          size="large"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="state-press"
          variant="tonal"
          hybridRef={captureHybrid('state-press')}
        />
        <IconButton
          accessibilityLabel="Toggle off"
          checked={false}
          androidIcon={SHIPPED}
          onCheckedChange={recordChecked('state-off')}
          size="large"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="state-off"
          variant="tonal"
          hybridRef={captureHybrid('state-off')}
        />
        <IconButton
          accessibilityLabel="Toggle on"
          checked
          androidIcon={SHIPPED}
          onCheckedChange={recordChecked('state-on')}
          size="large"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="state-on"
          variant="tonal"
          hybridRef={captureHybrid('state-on')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = await settleEach(['state-press', 'state-off', 'state-on']);
    await waitForDisplayed('state-off', '0');
    await waitForDisplayed('state-on', '1');
    const press = boxes.get('state-press') as Size;
    const off = boxes.get('state-off') as Size;
    const on = boxes.get('state-on') as Size;
    console.log(
      `toggle states: press=${describeSize(press)} off=${describeSize(off)} ` +
        `on=${describeSize(on)}`
    );
    expect(sameSize(off, on)).toBe(true);
    // The press form too, on the platform whose press and toggle are different
    // composables with the same tokens. Android composes `IconButton` vs
    // `IconToggleButton`; iOS composes a `Button` vs a `Toggle(.button)`, and
    // SwiftUI's toggle style brings its own padding — the difference
    // `docs/components/icon-button.md` prints instead of hiding.
    if (Platform.OS === 'android') {
      expect(sameSize(press, off)).toBe(true);
    }

    // A state change must not open a new configuration either: a *fresh* control of
    // the same configuration after a toggled one has drawn still needs zero
    // corrections, which is what "one box" means to the engine.
    nitroUiCore.invalidateSizingEnvironment();
    const before = stats();
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Fresh tonal"
          checked
          androidIcon={SHIPPED}
          size="large"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="state-fresh"
          variant="tonal"
          hybridRef={captureHybrid('state-fresh')}
        />
      </View>,
      { timeout: 20000 }
    );
    const fresh = (await settleEach(['state-fresh'])).get(
      'state-fresh'
    ) as Size;
    const made = corrections(before, stats());
    console.log(`fresh control: ${describeSize(fresh)} corrections=${made}`);
    expect(made).toBe(0);
    expect(sameSize(fresh, on)).toBe(true);
  });

  it('follows a controlled selection in both directions', async () => {
    const CONTROLLED = 'Controlled icon toggle';

    function Controlled() {
      const [checked, setLocal] = useState(false);
      setters.set('controlled', setLocal);
      return (
        <IconButton
          accessibilityLabel={CONTROLLED}
          androidIcon={SHIPPED}
          checked={checked}
          onCheckedChange={recordChecked('controlled')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="controlled"
          hybridRef={captureHybrid('controlled')}
        />
      );
    }

    await render(<Controlled />, { timeout: 20000 });
    await settleEach(['controlled']);
    await waitForDisplayed('controlled', '0');

    setters.get('controlled')?.(true);
    await waitForDisplayed('controlled', '1');
    expect(handleOf('controlled').checked).toBe(true);
    console.log(
      `controlled on: report=${handleOf('controlled').nuiTestStateReport()}`
    );

    setters.get('controlled')?.(false);
    await waitForDisplayed('controlled', '0');
    expect(handleOf('controlled').checked).toBe(false);
  });

  it('reverts a toggle JS refused, and shows the value JS wrote', async () => {
    // The refused half: the app keeps `checked={false}`, so every press asks for
    // `true` again — Chip's and SegmentedControl's oracle. A control that had kept a
    // refused change would ask for `false` on the second press.
    const REFUSING = 'Refusing icon toggle';
    function Refusing() {
      return (
        <IconButton
          accessibilityLabel={REFUSING}
          androidIcon={SHIPPED}
          checked={false}
          onCheckedChange={recordChecked('refusing')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="refusing"
          hybridRef={captureHybrid('refusing')}
        />
      );
    }
    await render(<Refusing />, { timeout: 20000 });
    await settleEach(['refusing']);
    await waitForDisplayed('refusing', '0');

    await pressButton('refusing');
    await waitForEvents(0, ['refusing:true']);
    // Optimistic: native paints the flip before React has pushed the refusal down…
    await waitForDisplayed('refusing', '1');
    // …and then the app's own value wins, because the write is accepted once native
    // has seen its own event count.
    await waitForDisplayed('refusing', '0');
    const afterFirst = events.length;

    await pressButton('refusing');
    const seen = await waitForEvents(afterFirst, ['refusing:true']);
    console.log(
      `refused toggle: events=${JSON.stringify(seen)} ` +
        `report=${handleOf('refusing').nuiTestStateReport()}`
    );
    // Both presses asked for `true`. `false` on the second is a control that kept the
    // change the app refused.
    expect(seen).toEqual(['refusing:true']);
    await waitForDisplayed('refusing', '0');
  });

  it('presses once per tap, and takes none while disabled', async () => {
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Press me"
          androidIcon={SHIPPED}
          onPress={recordPress('press-once')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="press-once"
          hybridRef={captureHybrid('press-once')}
        />
        <IconButton
          accessibilityLabel="Not me"
          androidIcon={SHIPPED}
          disabled
          onPress={recordPress('press-disabled')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="press-disabled"
          hybridRef={captureHybrid('press-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    await settleEach(['press-once', 'press-disabled']);

    await pressButton('press-once');
    await waitForEvents(0, ['press-once:press']);
    await pressButton('press-once');
    const seen = await waitForEvents(0, [
      'press-once:press',
      'press-once:press',
    ]);
    console.log(`presses: ${JSON.stringify(seen)}`);

    await pressButton('press-disabled');
    await sleep(EVENT_QUIET_MS);
    expect(events).toEqual(['press-once:press', 'press-once:press']);
  });

  it('names the control, and a toggle says whether it is checked', async () => {
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Bookmark this"
          androidIcon={SHIPPED}
          onCheckedChange={recordChecked('a11y-toggle')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="a11y-toggle"
          hybridRef={captureHybrid('a11y-toggle')}
        />
        <IconButton
          accessibilityLabel="Share this"
          androidIcon={SHIPPED}
          disabled
          onPress={recordPress('a11y-disabled')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="a11y-disabled"
          hybridRef={captureHybrid('a11y-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    await settleEach(['a11y-toggle', 'a11y-disabled']);

    const off = await probeAccessibility('a11y-toggle');
    await pressButton('a11y-toggle');
    await waitForEvents(0, ['a11y-toggle:true']);
    await waitForDisplayed('a11y-toggle', '1');
    const on = await probeAccessibility('a11y-toggle');
    const disabled = await probeAccessibility('a11y-disabled');
    console.log(
      `icon-button a11y: off=[${off}] on=[${on}] disabled=[${disabled}]`
    );

    if (Platform.OS === 'android') {
      // The merged node a reader is handed. `label` is the control's only name — an
      // IconButton has no text — so a missing `contentDescription` here is a button
      // TalkBack announces as "button", which is the whole failure this line is for.
      expect(off).toContain('label=Bookmark this');
      expect(off).toContain('toggle=Off');
      expect(on).toContain('toggle=On');
      expect(on).toContain('label=Bookmark this');
      expect(disabled).toContain('label=Share this');
      expect(disabled).toContain('disabled=true');
      expect(off).toContain('disabled=false');
    } else {
      // Nothing to read in-process (the spec says why); the name and the toggle state
      // are XCUITest's in `real-input:ios`, which reads the element's `value` 1/0
      // after a real tap. Asserting the refusal is the point: a probe here that
      // started answering from a copied prop would be a fake, and this line is where
      // it would show up.
      for (const report of [off, on, disabled]) {
        expect(report).toBe('unavailable');
      }
    }
  });

  it('draws the glyph in the control content colour, at the size the rung asked for', async () => {
    // A `standard` control has no container and no border, so the glyph is the only
    // thing that can carry the tint: `hits` then means "the icon is painted in the
    // content colour", not "something pink is somewhere on screen".
    const tint = processColor('#FF00A0') as number;
    const TINT_CSS = '#FF00A0';
    const ids = [
      'probe-medium',
      'probe-xxlarge',
      'probe-missing',
      'probe-disabled',
    ];
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Medium glyph"
          androidIcon={SHIPPED}
          size="medium"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="probe-medium"
          tintColor={TINT_CSS}
          hybridRef={captureHybrid('probe-medium')}
        />
        <IconButton
          accessibilityLabel="Top rung glyph"
          androidIcon={SHIPPED}
          size="xxlarge"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="probe-xxlarge"
          tintColor={TINT_CSS}
          hybridRef={captureHybrid('probe-xxlarge')}
        />
        <IconButton
          accessibilityLabel="Missing glyph"
          androidIcon={NOT_SHIPPED}
          size="medium"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="probe-missing"
          tintColor={TINT_CSS}
          hybridRef={captureHybrid('probe-missing')}
        />
        <IconButton
          accessibilityLabel="Disabled glyph"
          androidIcon={SHIPPED}
          disabled
          size="medium"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="probe-disabled"
          tintColor={TINT_CSS}
          hybridRef={captureHybrid('probe-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = await settleEach(ids);
    const reports = new Map<string, string>();
    for (const id of ids) {
      reports.set(id, await pixelProbe(id, tint, id));
    }
    console.log(`icon-button probes: ${JSON.stringify([...reports])}`);
    const hitsOf = (id: string): number => {
      const report = reports.get(id);
      if (report == null) {
        throw new Error(`"${id}" never produced a probe report.`);
      }
      return probeHits(report);
    };

    if (Platform.OS === 'android') {
      expect(hitsOf('probe-medium')).toBeGreaterThan(0);
      // A name the app does not have draws nothing, and keeps the box it would have
      // had: the glyph is sized by the ladder, never by the file (D43).
      expect(hitsOf('probe-missing')).toBe(0);
      // Material repaints disabled content at 38%, so the *pure* tint is no longer on
      // screen. A glyph tinted with a constant instead of the control's content colour
      // keeps its exact colour here and fails this line — C4's red proof for the tint.
      expect(hitsOf('probe-disabled')).toBe(0);
      // The rung sizes the art: the top rung's glyph is 40 dp against the medium
      // rung's 24, so the same colour covers more pixels. A slot pinned to one size
      // makes this ratio 1 and goes red.
      const ratio = hitsOf('probe-xxlarge') / hitsOf('probe-medium');
      console.log(`glyph grows with the rung: ratio=${ratio.toFixed(2)}`);
      expect(ratio).toBeGreaterThan(1.5);
    } else {
      // iOS draws `systemImage` and has no Android glyph to sample: it refuses in the
      // shape the probe helper refuses to read as an answer.
      for (const id of ids) {
        expect(reports.get(id) ?? '').toContain('no pixels');
      }
    }
    // The missing glyph and the drawn one are the same box, on both platforms.
    expect(
      sameSize(
        boxes.get('probe-missing') ?? null,
        boxes.get('probe-medium') ?? null
      )
    ).toBe(true);
  });

  it('takes no press while disabled, on either form', async () => {
    // The toggle form gets its own disabled control: M3 refuses the tap inside the
    // toggleable modifier, and `press()` refuses it here — two doors, one answer.
    const DISABLED_TOGGLE = 'Disabled icon toggle';
    function DisabledToggle() {
      return (
        <IconButton
          accessibilityLabel={DISABLED_TOGGLE}
          androidIcon={SHIPPED}
          checked={false}
          disabled
          onCheckedChange={recordChecked('disabled-toggle')}
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="disabled-toggle"
          hybridRef={captureHybrid('disabled-toggle')}
        />
      );
    }
    await render(<DisabledToggle />, { timeout: 20000 });
    await settleEach(['disabled-toggle']);
    await waitForDisplayed('disabled-toggle', '0');

    await pressButton('disabled-toggle');
    await sleep(EVENT_QUIET_MS);
    expect(events).toEqual([]);
    await waitForDisplayed('disabled-toggle', '0');
  });
});
