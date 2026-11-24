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

/**
 * The parents' form setters, by testID. The form follows which props the caller
 * passed, so the only way to change it is to re-render with a different set of them.
 */
const formSetters = new Map<string, (next: 'press' | 'toggle') => void>();

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

// Waits until each id's laid-out box equals what its own control measured, so a box
// still standing at a planted size cannot pass.
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

function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/**
 * The iOS report's `control=` field: what the glyph measured before the 44 pt
 * touch-target floor widened the control.
 */
function artworkOf(testId: string): Size | null {
  const field = reportOf(testId).control;
  const box = /^([\d.]+)x([\d.]+)$/.exec(field ?? '');
  return box == null ? null : { width: Number(box[1]), height: Number(box[2]) };
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
  // Then a quiet period, so a control that fires twice per tap is seen.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

// The harness's iOS tap is a `UITouch` with no HID event behind it, which SwiftUI's
// button gesture ignores, so iOS presses through the control's `nuiTestPress()`.
async function pressButton(testId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await userEvent.press(await waitForTestId(testId));
    return;
  }
  handleOf(testId).nuiTestPress();
}

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

function probeHits(report: string): number {
  const hits = / hits=(\d+)/.exec(report);
  return hits == null ? 0 : Number(hits[1]);
}

/** The nearest colour the sampler found on screen, or `''` for a refusal line. */
function closestOf(report: string): string {
  return / closest=(#[0-9A-Fa-f]{6})/.exec(report)?.[1]?.toUpperCase() ?? '';
}

/** How many pixels the sampled control covers, from the same report line. */
function sampledArea(report: string): number {
  const size = / size=(\d+)x(\d+)/.exec(report);
  return size == null ? 0 : Number(size[1]) * Number(size[2]);
}

/** The sampler's own scale: the summed per-channel difference. */
function colourDistance(a: string, b: string): number {
  const channels = (value: string): number[] => {
    const digits = value.replace('#', '');
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  };
  const left = channels(a);
  const right = channels(b);
  return left.reduce(
    (sum, value, index) => sum + Math.abs(value - (right[index] ?? 0)),
    0
  );
}

// Must match the sizing key `IconButton.tsx` builds. Written out rather than
// imported, so a wrong key helper cannot pass its own test.
function sizingKey(
  variant: IconButtonVariant,
  size: IconButtonSize,
  width: IconButtonWidth,
  form: 'press' | 'toggle',
  systemImage: string,
  androidIcon: string
): string {
  return [variant, size, width, form, systemImage, androidIcon].join('|');
}

/** A size that is no icon button's, planted as the engine's answer before a mount. */
const WRONG_SIZE = { width: 17.5, height: 63.5 };

/**
 * Material's `IconButtonDefaults` container sizes for each rung and width option,
 * and each rung's glyph size, in dp. These are Material's own numbers, not readings
 * from a device.
 */
const MATERIAL_LADDER: Record<
  IconButtonSize,
  {
    narrow: number;
    uniform: number;
    wide: number;
    height: number;
    glyph: number;
  }
> = {
  small: { narrow: 28, uniform: 32, wide: 40, height: 32, glyph: 20 },
  medium: { narrow: 32, uniform: 40, wide: 52, height: 40, glyph: 24 },
  large: { narrow: 48, uniform: 56, wide: 72, height: 56, glyph: 24 },
  xlarge: { narrow: 64, uniform: 96, wide: 128, height: 96, glyph: 32 },
  xxlarge: { narrow: 104, uniform: 136, wide: 184, height: 136, glyph: 40 },
};

/** Material's `MinInteractiveComponentSize`, in dp — the floor under every rung. */
const MIN_TARGET = 48;

/** Apple's minimum tappable region, in points — the floor under every iOS rung. */
const IOS_MIN_TARGET = 44;

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
  formSetters.clear();
  events.length = 0;
});

describe('IconButton · G23', () => {
  it('lays every rung and width out at the size the control measured', async () => {
    // Each configuration is seeded with a wrong size first, so a box that stays at the
    // planted size fails.
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
            'press',
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

    // iOS ignores `width`, so its three widths per rung are one configuration and it
    // owes five corrections where Android owes fifteen.
    expect(made).toBeGreaterThanOrEqual(
      Platform.OS === 'android' ? ids.length : RUNGS.length
    );
    for (const testId of ids) {
      const box = boxes.get(testId) ?? null;
      expect(sameSize(box, WRONG_SIZE)).toBe(false);
    }

    // Android: every box is Material's token, floored at Material's 48 dp minimum
    // interactive size. The floor raises `small` (32) and `medium` (40) to 48, so the
    // ladder is not strictly increasing.
    if (Platform.OS === 'android') {
      for (const size of RUNGS) {
        for (const width of WIDTHS) {
          const box = boxes.get(`rung-${size}-${width}`) ?? null;
          const token = MATERIAL_LADDER[size];
          const expected = {
            width: Math.max(token[width], MIN_TARGET),
            height: Math.max(token.height, MIN_TARGET),
          };
          expect(
            sameSize(box, expected),
            `${size}/${width}: Material's token is ` +
              `${token[width]}x${token.height} dp, so the laid-out box is ` +
              `${describeSize(expected)} and not ${describeSize(box)}`
          ).toBe(true);
        }
      }
      for (const size of RUNGS) {
        for (const width of WIDTHS) {
          const box = boxes.get(`rung-${size}-${width}`);
          expect(
            (box?.width ?? 0) >= MIN_TARGET - 0.6,
            `${size}/${width} is laid out below Material's ${MIN_TARGET} dp ` +
              'minimum interactive size'
          ).toBe(true);
          expect((box?.height ?? 0) >= MIN_TARGET - 0.6).toBe(true);
        }
      }
      // `width` changes width and never height. Below the 48 dp floor the three
      // options are legitimately one box (`small`'s 28/32/40 are all under it).
      for (const size of RUNGS) {
        const token = MATERIAL_LADDER[size];
        const floored = (dp: number): number => Math.max(dp, MIN_TARGET);
        const narrow = boxes.get(`rung-${size}-narrow`)?.width ?? 0;
        const uniform = boxes.get(`rung-${size}-uniform`)?.width ?? 0;
        const wide = boxes.get(`rung-${size}-wide`)?.width ?? 0;
        expect(wide).toBeGreaterThanOrEqual(uniform);
        expect(uniform).toBeGreaterThanOrEqual(narrow);
        if (floored(token.wide) > floored(token.narrow)) {
          expect(
            wide,
            `${size}: Material's narrow and wide containers are ${token.narrow} and ` +
              `${token.wide} dp, both above the ${MIN_TARGET} dp floor, so two ` +
              'configurations cannot be one box'
          ).toBeGreaterThan(narrow);
        }
        expect(boxes.get(`rung-${size}-narrow`)?.height).toBe(
          boxes.get(`rung-${size}-wide`)?.height
        );
      }
    } else {
      // iOS ignores `width`, so the three controls of a rung must be the same box.
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

      // iOS has no icon-button containers: the rung sizes the glyph. Every `standard`
      // glyph measures under the 44 pt touch-target floor, so every box is 44 x 44;
      // the glyph ladder is read from the report's `control=` field instead.
      const glyphAt = (size: IconButtonSize): Size =>
        artworkOf(`rung-${size}-uniform`) as Size;
      const rungGrid = RUNGS.map((size) => {
        const glyph = glyphAt(size);
        const box = boxes.get(`rung-${size}-uniform`) ?? null;
        return `${size} glyph=${describeSize(glyph)} box=${describeSize(box)}`;
      }).join('\n  ');
      console.log(
        `iOS ladder (target floor ${IOS_MIN_TARGET} pt):\n  ${rungGrid}`
      );

      for (const size of RUNGS) {
        const glyph = glyphAt(size);
        expect(
          glyph,
          `"${size}" never reported what its glyph measures — the control's report ` +
            `is "${handleOf(`rung-${size}-uniform`).nuiTestStateReport()}"`
        ).not.toBeNull();
        expect(glyph.width).toBeGreaterThan(0);
        expect(glyph.height).toBeGreaterThan(0);

        const box = boxes.get(`rung-${size}-uniform`) ?? null;
        const floored = {
          width: Math.max(glyph.width, IOS_MIN_TARGET),
          height: Math.max(glyph.height, IOS_MIN_TARGET),
        };
        expect(
          sameSize(box, floored),
          `${size}: the glyph measures ${describeSize(glyph)} and the touch target ` +
            `floors at ${IOS_MIN_TARGET} pt, so the box is ${describeSize(floored)} ` +
            `and not ${describeSize(box)}`
        ).toBe(true);
      }

      RUNGS.forEach((size, index) => {
        const previous = index === 0 ? undefined : RUNGS[index - 1];
        if (previous == null) {
          return;
        }
        const grows =
          MATERIAL_LADDER[size].glyph > MATERIAL_LADDER[previous].glyph;
        for (const axis of ['width', 'height'] as const) {
          const now = glyphAt(size)[axis];
          const was = glyphAt(previous)[axis];
          if (grows) {
            expect(
              now,
              `${previous} -> ${size}: Material's glyph token grows from ` +
                `${MATERIAL_LADDER[previous].glyph} to ${MATERIAL_LADDER[size].glyph}, ` +
                `so the ${axis} of the glyph must grow with it (${was} -> ${now})`
            ).toBeGreaterThan(was);
          } else {
            // Material's glyph token repeats on this step, so it may be one box.
            expect(now).toBeGreaterThanOrEqual(was);
          }
        }
      });
    }
  });

  it('keys the Android-only width option, so a narrow control cannot inherit the uniform box', async () => {
    // Plants the uniform size under the narrow key and requires the narrow control to
    // disagree with it. `xlarge` because its narrow and uniform containers (64 and
    // 96 dp) are both above the 48 dp floor; on the two bottom rungs they are one box.
    const uniform = 'standard|xlarge|uniform|press|xmark|nitroui_test_star';
    const narrow = 'standard|xlarge|narrow|press|xmark|nitroui_test_star';
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Uniform"
          androidIcon={DEFAULT_GLYPH.androidIcon}
          size="xlarge"
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
          size="xlarge"
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
      expect(sameSize(narrowSize, uniformSize)).toBe(false);
      expect(made).toBeGreaterThanOrEqual(1);
    } else {
      // iOS ignores `width`, so the planted size is the right size and nothing is
      // corrected.
      expect(sameSize(narrowSize, uniformSize)).toBe(true);
    }
  });

  it('keeps one box across the toggle states, and needs no correction for a state change', async () => {
    // The form, not the value, is in the sizing key: on iOS the press form is a
    // `Button` and the toggle form a `Toggle(.button)`, and their styles pad
    // differently. `xxlarge` because on smaller rungs both forms fall under the 44 pt
    // floor on iOS and come back as one box.
    const keyFor = (icon: string) =>
      sizingKey(
        'tonal',
        'xxlarge',
        'uniform',
        'toggle',
        DEFAULT_GLYPH.systemImage,
        icon
      );
    poison([keyFor(SHIPPED)]);
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Press form"
          androidIcon={SHIPPED}
          onPress={() => {}}
          size="xxlarge"
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
          size="xxlarge"
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
          size="xxlarge"
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
    // Android's press and toggle composables share their tokens; SwiftUI's toggle
    // style brings its own padding.
    if (Platform.OS === 'android') {
      expect(sameSize(press, off)).toBe(true);
    }

    // A fresh control of the same configuration, mounted after a toggled one has
    // drawn, must need no correction.
    nitroUiCore.invalidateSizingEnvironment();
    const before = stats();
    await render(
      <View style={rowStyle}>
        <IconButton
          accessibilityLabel="Fresh tonal"
          checked
          androidIcon={SHIPPED}
          size="xxlarge"
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
    // The app keeps `checked={false}`, so every press must ask for `true` again. A
    // control that kept a refused change would ask for `false` on the second press.
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
    // The optimistic frame is not polled: the revert lands one JS round trip after
    // the flip, well inside the quiet period `waitForEvents` has already waited.
    await waitForDisplayed('refusing', '0');
    const afterFirst = events.length;

    await pressButton('refusing');
    const seen = await waitForEvents(afterFirst, ['refusing:true']);
    console.log(
      `refused toggle: events=${JSON.stringify(seen)} ` +
        `report=${handleOf('refusing').nuiTestStateReport()}`
    );
    expect(seen).toEqual(['refusing:true']);
    await waitForDisplayed('refusing', '0');
    expect(handleOf('refusing').mostRecentEventCount).toBeGreaterThanOrEqual(2);
  });

  it('becomes a press button again when the app stops using the toggle form', async () => {
    const SWITCHED = 'Toggle that becomes a button';

    function Switching() {
      const [form, setForm] = useState<'toggle' | 'press'>('toggle');
      formSetters.set('form-off', setForm);
      return (
        <View style={rowStyle}>
          <IconButton
            accessibilityLabel={SWITCHED}
            androidIcon={SHIPPED}
            defaultChecked={form === 'toggle' ? false : undefined}
            onCheckedChange={
              form === 'toggle' ? recordChecked('form-off') : undefined
            }
            onPress={form === 'press' ? recordPress('form-off') : undefined}
            size="xxlarge"
            systemImage={DEFAULT_GLYPH.systemImage}
            testID="form-off"
            variant="tonal"
            hybridRef={captureHybrid('form-off')}
          />
          {/* The same configuration in press form from the first frame: the size the
              switched control has to end up measuring. */}
          <IconButton
            accessibilityLabel="Always a button"
            androidIcon={SHIPPED}
            onPress={recordPress('form-fresh')}
            size="xxlarge"
            systemImage={DEFAULT_GLYPH.systemImage}
            testID="form-fresh"
            variant="tonal"
            hybridRef={captureHybrid('form-fresh')}
          />
        </View>
      );
    }

    await render(<Switching />, { timeout: 20000 });
    await settleEach(['form-off', 'form-fresh']);
    await waitForDisplayed('form-off', '0');

    await pressButton('form-off');
    await waitForEvents(0, ['form-off:true']);

    formSetters.get('form-off')?.('press');
    // `none` means "not drawing a selection", which a toggle never reports.
    await waitForDisplayed('form-off', 'none');
    const switched = events.length;

    await pressButton('form-off');
    const seen = await waitForEvents(switched, ['form-off:press']);
    console.log(
      `form switch-off: events=${JSON.stringify(seen)} ` +
        `report=${handleOf('form-off').nuiTestStateReport()} ` +
        `measured=${describeSize(measured('form-off'))} ` +
        `fresh=${describeSize(measured('form-fresh'))}`
    );
    expect(seen).toEqual(['form-off:press']);
    expect(handleOf('form-off').checked).toBeNull();

    // Compared through each control's own `measureContent()`, not the laid-out box:
    // once the forms agree the two share a sizing key, and the box is that shared
    // answer. Polled, because the measured size follows the new view by a layout pass.
    await pollUntil(
      () =>
        sameSize(measured('form-off'), measured('form-fresh')) ? true : null,
      () =>
        new Error(
          `a control that stopped being a toggle should measure the press box ` +
            `${describeSize(measured('form-fresh'))}, and measures ` +
            `${describeSize(measured('form-off'))} — report ` +
            `"${handleOf('form-off').nuiTestStateReport()}".`
        )
    );
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
      // An IconButton has no text, so `label` is the control's only name.
      expect(off).toContain('label=Bookmark this');
      expect(off).toContain('toggle=Off');
      expect(on).toContain('toggle=On');
      expect(on).toContain('label=Bookmark this');
      expect(disabled).toContain('label=Share this');
      expect(disabled).toContain('disabled=true');
      expect(off).toContain('disabled=false');
    } else {
      // iOS has nothing to read in-process, so the probe must answer `unavailable`.
      for (const report of [off, on, disabled]) {
        expect(report).toBe('unavailable');
      }
    }
  });

  it('draws the glyph in the control content colour, at the size the rung asked for', async () => {
    // A `standard` control has no container and no border, so only the glyph can
    // carry the tint. Material's glyph token is 20 / 24 / 24 / 32 / 40 dp: four steps
    // of the ladder grow the ink and `medium` -> `large` holds it level.
    const tint = processColor('#FF00A0') as number;
    const TINT_CSS = '#FF00A0';
    const SHARE_ASSET = require('../src/assets/icons/share_24px.xml');
    const rungId = (size: IconButtonSize): string => `probe-${size}`;
    const ids = [
      ...RUNGS.map(rungId),
      'probe-asset',
      'probe-missing',
      'probe-disabled',
    ];
    await render(
      <View style={rowStyle}>
        {RUNGS.map((size) => (
          <IconButton
            key={size}
            accessibilityLabel={`${size} glyph`}
            androidIcon={SHIPPED}
            size={size}
            systemImage={DEFAULT_GLYPH.systemImage}
            testID={rungId(size)}
            tintColor={TINT_CSS}
            hybridRef={captureHybrid(rungId(size))}
          />
        ))}
        <IconButton
          accessibilityLabel="Imported glyph"
          androidIcon={SHARE_ASSET}
          size="large"
          systemImage={DEFAULT_GLYPH.systemImage}
          testID="probe-asset"
          tintColor={TINT_CSS}
          hybridRef={captureHybrid('probe-asset')}
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
    // In development Metro serves the `require`d file and the control loads it
    // asynchronously, so the first probe can be earlier than the ink.
    if (Platform.OS === 'android') {
      const started = nitroUiCore.now();
      while (
        probeHits(reports.get('probe-asset') ?? '') === 0 &&
        nitroUiCore.now() < started + 15000
      ) {
        await sleep(50);
        reports.set(
          'probe-asset',
          await pixelProbe('probe-asset', tint, 'the imported glyph')
        );
      }
      console.log(
        `imported glyph: drew=${probeHits(reports.get('probe-asset') ?? '') > 0} ` +
          `after=${nitroUiCore.now() - started}ms`
      );
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
      for (const size of RUNGS) {
        expect(
          hitsOf(rungId(size)),
          `${size}: nothing was painted in the tint, so the glyph never reached the ` +
            'screen'
        ).toBeGreaterThan(0);
      }

      expect(hitsOf('probe-missing')).toBe(0);
      // Material repaints disabled content at 38%, so the pure tint is no longer on
      // screen.
      expect(hitsOf('probe-disabled')).toBe(0);
      expect(
        hitsOf('probe-asset'),
        'an `androidIcon` the app `require`s drew nothing in the content colour, so ' +
          "the imported artwork never reached this control's painter"
      ).toBeGreaterThan(0);

      // The top rung's glyph is 40 dp against the medium rung's 24, so the same colour
      // covers more pixels.
      const span = hitsOf(rungId('xxlarge')) / hitsOf(rungId('medium'));
      console.log(`glyph grows with the rung: span=${span.toFixed(2)}`);
      expect(span).toBeGreaterThan(1.5);

      RUNGS.forEach((size, index) => {
        const previous = RUNGS[index - 1];
        if (previous == null) {
          return;
        }
        const now = hitsOf(rungId(size));
        const was = hitsOf(rungId(previous));
        const ratio = now / was;
        console.log(
          `glyph ${previous} (${MATERIAL_LADDER[previous].glyph} dp) -> ` +
            `${size} (${MATERIAL_LADDER[size].glyph} dp): ratio=${ratio.toFixed(3)}`
        );
        if (MATERIAL_LADDER[size].glyph > MATERIAL_LADDER[previous].glyph) {
          expect(
            ratio,
            `${previous} -> ${size}: Material's glyph token grows from ` +
              `${MATERIAL_LADDER[previous].glyph} to ${MATERIAL_LADDER[size].glyph} dp, ` +
              `so the tint must cover more pixels (${was} -> ${now})`
          ).toBeGreaterThan(1.05);
        } else {
          // Material separates these two rungs by container (40 -> 56 dp), not by
          // glyph, so the ink stays level.
          expect(
            Math.abs(ratio - 1),
            `${previous} -> ${size}: the glyph token is ` +
              `${MATERIAL_LADDER[size].glyph} dp for both, so the ink must not move`
          ).toBeLessThan(0.15);
        }
      });
    } else {
      // iOS draws `systemImage` and has no Android glyph to sample, so the probe
      // refuses.
      for (const id of ids) {
        expect(reports.get(id) ?? '').toContain('no pixels');
      }
    }
    // A glyph the app does not have keeps its box: the rung sizes it, never the file.
    expect(
      sameSize(
        boxes.get('probe-missing') ?? null,
        boxes.get(rungId('medium')) ?? null
      )
    ).toBe(true);
  });

  it('draws a tinted outlined border in the tint, dimmed while disabled, and not at all when checked', async () => {
    // The `outlined` variant puts a `tintColor` in the content colour, so a glyph that
    // drew would answer the probe next to the border. A glyph the app does not have
    // draws nothing, which leaves the border as the only ink these controls own: what the
    // probe counts here is the border.
    const TINT = '#FF00A0';
    const tint = processColor(TINT) as number;
    // The mid-grey the native sampler paints behind the control it draws, which is what
    // a translucent border blends with.
    const BACKDROP = '#808080';
    // Without a `tintColor` the control keeps Material's own ring, in the content colour the
    // host leaves it with, so these four are read against each other and not against a colour.
    const INK = '#000000';
    const ink = processColor(INK) as number;
    const tintedIds = [
      'outline-enabled',
      'outline-disabled',
      'outline-toggle-off',
      'outline-toggle-on',
    ];
    const plainIds = [
      'plain-enabled',
      'plain-disabled',
      'plain-toggle-off',
      'plain-toggle-on',
    ];
    const ids = [...tintedIds, ...plainIds];
    const outlineProps = {
      androidIcon: NOT_SHIPPED,
      size: 'large' as const,
      systemImage: DEFAULT_GLYPH.systemImage,
      variant: 'outlined' as const,
    };
    const tintedProps = {
      ...outlineProps,
      tintColor: TINT,
    };
    function OutlinedRow() {
      return (
        <View style={rowStyle}>
          <IconButton
            {...tintedProps}
            accessibilityLabel="Enabled outline"
            hybridRef={captureHybrid('outline-enabled')}
            testID="outline-enabled"
          />
          <IconButton
            {...tintedProps}
            accessibilityLabel="Disabled outline"
            disabled
            hybridRef={captureHybrid('outline-disabled')}
            testID="outline-disabled"
          />
          <IconButton
            {...tintedProps}
            accessibilityLabel="Toggle that is off"
            checked={false}
            hybridRef={captureHybrid('outline-toggle-off')}
            onCheckedChange={recordChecked('outline-toggle-off')}
            testID="outline-toggle-off"
          />
          <IconButton
            {...tintedProps}
            accessibilityLabel="Toggle that is on"
            checked
            hybridRef={captureHybrid('outline-toggle-on')}
            onCheckedChange={recordChecked('outline-toggle-on')}
            testID="outline-toggle-on"
          />
          <IconButton
            {...outlineProps}
            accessibilityLabel="Enabled outline, no tint"
            hybridRef={captureHybrid('plain-enabled')}
            testID="plain-enabled"
          />
          <IconButton
            {...outlineProps}
            accessibilityLabel="Disabled outline, no tint"
            disabled
            hybridRef={captureHybrid('plain-disabled')}
            testID="plain-disabled"
          />
          <IconButton
            {...outlineProps}
            accessibilityLabel="Toggle that is off, no tint"
            checked={false}
            hybridRef={captureHybrid('plain-toggle-off')}
            onCheckedChange={recordChecked('plain-toggle-off')}
            testID="plain-toggle-off"
          />
          <IconButton
            {...outlineProps}
            accessibilityLabel="Toggle that is on, no tint"
            checked
            hybridRef={captureHybrid('plain-toggle-on')}
            onCheckedChange={recordChecked('plain-toggle-on')}
            testID="plain-toggle-on"
          />
        </View>
      );
    }
    await render(<OutlinedRow />, { timeout: 20000 });
    const boxes = await settleEach(ids);
    await waitForDisplayed('outline-toggle-off', '0');
    await waitForDisplayed('outline-toggle-on', '1');
    const reports = new Map<string, string>();
    for (const id of tintedIds) {
      reports.set(id, await pixelProbe(id, tint, id));
    }
    for (const id of plainIds) {
      reports.set(id, await pixelProbe(id, ink, id));
    }
    console.log(`outlined border probes: ${JSON.stringify([...reports])}`);
    const lineOf = (id: string): string => {
      const report = reports.get(id);
      if (report == null) {
        throw new Error(`"${id}" never produced a probe report.`);
      }
      return report;
    };

    if (Platform.OS === 'android') {
      expect(
        probeHits(lineOf('outline-enabled')),
        `an enabled tinted outlined button has no ink in ${TINT}, so its border never ` +
          `reached the screen: ${lineOf('outline-enabled')}`
      ).toBeGreaterThan(0);

      // Material dims a disabled outline rather than dropping it: the full tint is no
      // longer on screen, and the ink that is there sits nearer the sampler's grey than
      // the tint itself.
      const disabled = lineOf('outline-disabled');
      expect(
        probeHits(disabled),
        `a disabled tinted outlined button is still drawn in the full ${TINT}, so its ` +
          `border reads as enabled: ${disabled}`
      ).toBe(0);
      const dim = closestOf(disabled);
      expect(
        dim.length,
        `no colour could be read from a disabled outlined button: ${disabled}`
      ).toBe(7);
      expect(
        colourDistance(dim, BACKDROP),
        `the disabled control drew nothing but the sampler's own backdrop (${dim}), so ` +
          `its border was dropped rather than dimmed: ${disabled}`
      ).toBeGreaterThan(30);
      expect(
        colourDistance(dim, BACKDROP) < colourDistance(dim, TINT),
        `the disabled border (${dim}) is nearer the tint than the backdrop, so it is not ` +
          `drawn at Material's disabled strength: ${disabled}`
      ).toBe(true);
      const dimLine = await pixelProbe(
        'outline-disabled',
        processColor(dim) as number,
        'the dimmed border'
      );
      const dimHits = probeHits(dimLine);
      expect(
        dimHits,
        `the colour this disabled border is drawn in (${dim}) is not on screen at all: ` +
          `${dimLine}`
      ).toBeGreaterThan(0);
      expect(
        dimHits < sampledArea(disabled) * 0.5,
        `${dim} covers ${String(dimHits)} of ${String(
          sampledArea(disabled)
        )} pixels - that is a filled box, not an outline: ${dimLine}`
      ).toBe(true);
      // The same ring, only weaker: a border that thinned itself away would cover a
      // fraction of what the enabled one does.
      expect(
        dimHits > probeHits(lineOf('outline-enabled')) * 0.3,
        `the disabled border (${String(dimHits)} px) is a fraction of the enabled one ` +
          `(${String(probeHits(lineOf('outline-enabled')))} px): ${dimLine}`
      ).toBe(true);

      // Material draws no outline on a toggle that is on, so a tinted one draws none.
      expect(
        probeHits(lineOf('outline-toggle-off')),
        `an unchecked tinted outlined toggle has no ink in ${TINT}, so its border never ` +
          `reached the screen: ${lineOf('outline-toggle-off')}`
      ).toBeGreaterThan(0);
      const checked = lineOf('outline-toggle-on');
      expect(
        probeHits(checked),
        `a tinted outlined toggle that is on is still drawn in the full ${TINT}, so it ` +
          `wears an outline Material's own toggle does not draw: ${checked}`
      ).toBe(0);
      // A checked outlined toggle owns no ink of its own beyond its container, so the
      // answer above says "no border" rather than "nothing drawn" only because the two
      // toggles differ in `checked` alone: the same control, in the same box, drew the
      // ring one step earlier, and this one reports the value it was told.
      expect(
        sameSize(
          boxes.get('outline-toggle-on') ?? null,
          boxes.get('outline-toggle-off') ?? null
        ),
        `the toggle that is on (${describeSize(
          boxes.get('outline-toggle-on') ?? null
        )}) is not the box the unchecked one has (${describeSize(
          boxes.get('outline-toggle-off') ?? null
        )}), so the two reads are not the same control in two states`
      ).toBe(true);

      // Without a tint the control keeps Material's own ring, so the states are read against
      // each other: whichever colour the enabled ring is drawn in is absent from the disabled
      // one, and the ring's ink sits further from the sampler's grey while enabled.
      const plainEnabled = lineOf('plain-enabled');
      const plainDisabled = lineOf('plain-disabled');
      expect(
        probeHits(plainEnabled),
        `an enabled outlined button with no tint has no ring in its content colour ` +
          `(${INK}), so the ring Material owns never reached the screen: ${plainEnabled}`
      ).toBeGreaterThan(0);
      expect(
        probeHits(plainDisabled),
        `a disabled outlined button with no tint is still drawn in the full ${INK}, so its ` +
          `ring reads as enabled: ${plainDisabled}`
      ).toBe(0);
      const plainRing = closestOf(plainEnabled);
      const plainDim = closestOf(plainDisabled);
      expect(
        colourDistance(plainRing, BACKDROP) >
          colourDistance(plainDim, BACKDROP),
        `the enabled ring (${plainRing}) is no further from the sampler's grey than the ` +
          `disabled one (${plainDim}), so disabling the control did not weaken it: ` +
          `${plainEnabled} / ${plainDisabled}`
      ).toBe(true);
      expect(
        colourDistance(plainDim, BACKDROP),
        `the disabled control drew nothing but the sampler's own backdrop (${plainDim}), so ` +
          `its ring was dropped rather than dimmed: ${plainDisabled}`
      ).toBeGreaterThan(30);

      // The same two answers for the toggle form, which is where Material draws no ring at all.
      expect(
        probeHits(lineOf('plain-toggle-off')),
        `an unchecked outlined toggle with no tint has no ring in its content colour ` +
          `(${INK}): ${lineOf('plain-toggle-off')}`
      ).toBeGreaterThan(0);
      expect(
        probeHits(lineOf('plain-toggle-on')),
        `an outlined toggle that is on with no tint is still drawn in the full ${INK}, so it ` +
          `wears a ring Material's own toggle does not draw: ${lineOf('plain-toggle-on')}`
      ).toBe(0);
    } else {
      // iOS has no Android glyph to sample, so the probe refuses.
      for (const id of ids) {
        expect(reports.get(id) ?? '').toContain('no pixels');
      }
    }
  });

  it('takes no press while disabled, on either form', async () => {
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
