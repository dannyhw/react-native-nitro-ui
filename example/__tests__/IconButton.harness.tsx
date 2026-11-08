/**
 * On-device tests for the IconButton (task G23).
 *
 * An IconButton is Button's box and Chip's value, so this suite asks each of them's
 * questions, plus two the control has on its own.
 *
 * - **Button's**: is the laid-out box the size the control measured, for every
 *   configuration the sizing key names
 *   (`variant|size|width|form|systemImage|androidIcon`)?
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
 *   asserted, not logged. Asserted against the artifact's own numbers
 *   (`MATERIAL_LADDER`), floored where Material floors it: the 48 dp
 *   `MinInteractiveComponentSize` is part of the box, which is why the two bottom
 *   rungs share one height on Android and why the box is not the token. On iOS the
 *   same ladder is the *glyph*'s — iOS has no icon-button containers, so the rung sets
 *   the symbol's point size and the button style's padding does the rest.
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

/**
 * The parents' *form* setters, by testID — how a test takes the toggle form away.
 * `IconButton.tsx` derives the form from which props the caller passed, so the only
 * way to change it is to re-render with a different set of them.
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

/**
 * The iOS control's `control=` field: what the glyph measured **before** the 44 pt
 * touch-target floor widened the control, as a `Size`.
 *
 * iOS-only — the field exists because iOS floors the *target* and Android floors the
 * *container*, so only iOS loses the laid-out box as evidence that the rung moved the
 * artwork. Android's box already is `max(token, 48)`, and the ladder above reads it
 * directly.
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
  form: 'press' | 'toggle',
  systemImage: string,
  androidIcon: string
): string {
  return [variant, size, width, form, systemImage, androidIcon].join('|');
}

/** A size that is no icon button's, planted as the engine's answer before a mount. */
const WRONG_SIZE = { width: 17.5, height: 63.5 };

/**
 * Material's own container ladder for this control, in dp.
 *
 * `IconButtonDefaults.{extraSmall…extraLarge}ContainerSize(option)` returns
 * `DpSize(iconSize + 2 × the option's leading space, the rung's height)` and the five
 * glyph tokens are 20 / 24 / 24 / 32 / 40 — the constants read out of the
 * `material3` artifact's bytecode (`icon + 2 × 4|6|10` for XS, `+ 4|8|14` for S,
 * `+ 12|16|24` for M, `+ 16|32|48` for L, `+ 32|48|72` for XL, with heights
 * 32 / 40 / 56 / 96 / 136), and the same table `Q9` C4 predicted from the spec.
 *
 * Nothing here is this file's number, which is the point: the Android assertions are
 * `max(token, MIN_TARGET)` of this table, so a build that stops asking for the rung,
 * or asks for it somewhere Material's own `smallContainerSize` can clamp it, is red
 * against Material rather than against a copy of what the device happened to say.
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

/**
 * Apple's minimum tappable region, in points — the floor under every iOS rung, and
 * the same rule one platform over. `HybridNitroUiIconButton.swift` keeps it as
 * `IconButtonContent.minimumTouchTarget`; this is the harness's own copy, spelled here
 * for the same reason `MIN_TARGET` is: the assertion is against the platform's number,
 * not against a second reading of what the device said.
 */
const IOS_MIN_TARGET = 44;

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
  formSetters.clear();
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

    // 2. Android: every one of the fifteen boxes *is* Material's token, floored at
    //    Material's own minimum interactive size. Asserted against the artifact's
    //    numbers rather than against a ladder this file invented, because the claim on
    //    the docs page is "a rung here is one of Material's own tokens". Two failures
    //    land here, and the first device run hit exactly the first one:
    //
    //      - the rung asked for on the control's *content* instead of its modifier is
    //        measured under each composable's own `smallContainerSize()` and coerced
    //        into it, which is how fifteen different configurations came back
    //        `48.00x48.00` here;
    //      - dropping `minimumInteractiveComponentSize()` gives the 28 dp `small`
    //        token its own box, three dp off the floor, which is the second line.
    //
    //    That floor is also why the ladder is not strictly increasing on Android:
    //    `small` (32) and `medium` (40) are both raised to 48, which is Material's
    //    design for those two rungs and what `Button.harness.tsx` ("the top of the
    //    ladder") already asserts for the same reason. `docs/components/icon-button.md`
    //    prints the same two-column truth — token and box — rather than the token
    //    alone, which is what made the first version of this table read as a promise.
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
      // The floor itself, spelled as its own failure: the two rungs whose tokens are
      // below 48 dp are the ones that can lose it.
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
      // `width` costs width and never height — in Material's own order, and strictly
      // only where the 48 dp floor does not hide the difference. Below the floor the
      // three options are legitimately one box (`small`'s 28/32/40 are all under it),
      // which is the same fact the grid above asserts and the docs page prints; from
      // `medium` up the options separate, and `large`/`xlarge`/`xxlarge` separate all
      // three. Dropping `width` from the container ask makes every one of these
      // strict lines red.
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

      // iOS has no icon-button containers: what the rung sizes is the *glyph*, and
      // the box is that glyph plus the button style's own padding (`.controlSize`
      // alone measured two boxes for five rungs here — 15.33 x 15.00 and 17.67 x
      // 16.00 — which is the reason the rung sets the symbol's font directly).
      //
      // Since `HybridNitroUiIconButton` floors the box at Apple's 44 pt touch target
      // — the counterpart of the 48 dp floor asserted for Android above — the glyph's
      // own box is no longer visible in the laid-out one at the bottom of the ladder:
      // every `standard` rung's glyph measures under 44 pt (20.33 x 19 up to 40.67 x
      // 38), so every one of them is laid out at 44 x 44. That is the point of the
      // floor, not a hole in the test, so the ladder is asserted in two halves, from
      // the two different fields each half can actually see:
      //
      //   1. the **glyph ladder**, from the control's own `control=` read-out: the
      //      artwork grows on every step where Material's glyph token grows, and
      //      stays level across `medium` -> `large`, where the token is 24 both. Pin
      //      the symbol to one point size and these lines go red even though every
      //      box stays a correct 44 x 44.
      //   2. the **floor**, from the laid-out box: it is `max(glyph, 44)` on each
      //      axis, so the target never shrinks below 44 and the box never grows past
      //      a glyph that is itself bigger than the target. Remove the floor and the
      //      first four rungs are red; make it 60 and all five are.
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
        // The glyph really did grow at all: a `medium` rung drawing a 20 pt symbol
        // would be caught by the per-step lines below but not by the floor.
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
            // The one step where Material's token repeats is allowed to be one box —
            // and only that one, which is what makes the line above bite.
            expect(now).toBeGreaterThanOrEqual(was);
          }
        }
      });
    }
  });

  it('keys the Android-only width option, so a narrow control cannot inherit the uniform box', async () => {
    // C4's red proof for the key: drop `width` from it and the `narrow` control below
    // is served the `uniform` size the engine was *told* about, and every assertion in
    // the ladder test above still passes because both are real boxes. So this test
    // plants the uniform rung's own size under the narrow key and requires the narrow
    // control to disagree with it.
    //
    // `xlarge`, not the default `medium`, because the two options have to be two
    // *different numbers* for a planted size to be a lie: Material's `small` rung is
    // 28/32/40 dp wide and its `medium` rung 32/40/52, and the 48 dp floor raises all
    // but the last of those to 48 — on the two bottom rungs `narrow` and `uniform`
    // genuinely are one box, and a planted size the control agrees with would prove
    // nothing. At `xlarge` the narrow and uniform containers are 64 and 96 dp, both
    // above the floor, so Android must disagree and iOS — which ignores `width` — must
    // still agree.
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
    //
    // What is *in* the key is the form, not the value: on iOS the press form is a
    // `Button` and the toggle form a `Toggle(.button)`, and their styles pad
    // differently — the first device run measured `tonal`/`large` at 31.67 x 30.00 pt
    // for the first and 41.67 x 30.00 pt for the second. One cached size cannot be
    // both, so `state-press` was laid out at the toggles' box and never converged —
    // which is what the `press` field in `sizingKey` exists for.
    //
    // `xxlarge`, not `large`: since iOS floors the box at its 44 pt touch target
    // (`IOS_MIN_TARGET`), the two `large` boxes above are both *under* the floor and
    // come back one 44 x 44 pt box — correct, and useless as evidence that the form
    // is in the key. At the top rung the glyph is 40 pt, both forms measure past 44,
    // and the two configurations are two numbers again.
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
    // Native took the flip optimistically and the echo that carried the event count
    // also carried `checked={false}` again, so the control is back on the app's value.
    //
    // The optimistic frame itself is deliberately not polled. Between the flip and the
    // reverting commit there is one JS round trip — the event, the echo, one render,
    // one shadow-tree batch — and `waitForEvents` above has already waited a 400 ms
    // quiet period to be sure no second event arrived, so by the time a poll could look
    // the revert has landed. `DatePicker.harness.tsx` reached the same conclusion
    // ("a polling test cannot see the round trip") and Chip's refusal test asserts what
    // this one asserts instead: the value the control settles on, and — below, the part
    // that cannot be faked — the next press asking for `true` again. A control that had
    // kept the refused change would ask for `false`, and a control whose handshake
    // refused every write would never leave `displayed=0` to begin with.
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
    expect(handleOf('refusing').mostRecentEventCount).toBeGreaterThanOrEqual(2);
  });

  it('becomes a press button again when the app stops using the toggle form', async () => {
    // The form is a *prop*, not a decision the control gets to keep.
    //
    // `IconButton.tsx` derives it from which props the caller passed
    // (`checked`/`defaultChecked`/`onCheckedChange` any one of them), so the only way
    // to take a toggle form away is to re-render the same control with a different set
    // of them. Native's signal for it is `defaultChecked` being non-null, which goes
    // back to null on exactly that re-render — so `afterUpdate()` can read the form
    // every batch and does. A setter that *latched* `isToggle = true` could only ever
    // answer "still a toggle", and the control would go on drawing a Toggle that
    // nobody asked for: `onPress` never fires, `displayed` keeps reporting a value,
    // and on iOS the toggle's box is published under the press configuration's key,
    // because the key is built in JS from the props that are there now.
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
          {/* The same configuration, press form from the first frame. iOS's box for a
              control is what its own style measures, so "the switch-back draws a
              Button" is only visible as this control's number. */}
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

    // Still a toggle: the tap flips a value, and `onPress` is not the form's event.
    await pressButton('form-off');
    await waitForEvents(0, ['form-off:true']);

    formSetters.get('form-off')?.('press');
    // The value belongs to the form, so it goes: `none` is "not drawing a selection",
    // which is what a Toggle never reports. Red with the latch: the report stays a
    // `0`/`1` because the control is still a Toggle.
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
    // Exactly one `onPress`, and no `onCheckedChange` left over from the old form.
    expect(seen).toEqual(['form-off:press']);
    expect(handleOf('form-off').checked).toBeNull();

    // The control now measures what a press button of the same configuration
    // measures. Read from each control's own hosted measurement, not from the laid-out
    // box: once the forms agree the two share a size configuration, and the box is
    // that shared answer — `measureContent()` per control is the number that says
    // which view is actually being drawn. On Android the two forms come from one
    // container, so the same line is the weaker statement there (the events above are
    // that platform's evidence); on iOS a `Toggle(.button)` pads wider than the
    // `Button` beside it, which is what goes red with the latch put back.
    //
    // Polled, because a form flip is a re-measure and not a re-paint: the size the
    // hosted view reports follows the new SwiftUI view by a layout pass.
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
    //
    // All five rungs are probed, not the two ends. "The top rung paints more than the
    // middle one" is a statement about two numbers, and a slot pinned to one size can
    // still satisfy it — if the pin is the bigger one. Asking for every pair of
    // neighbours turns it into the ladder, which is what `iconSize()` promises.
    // Material's glyph token is 20 / 24 / 24 / 32 / 40 dp, so four steps of the ladder
    // must grow the ink and exactly one — `medium` -> `large`, where Material's own
    // token repeats — must hold it level.
    //
    // The last-but-two control is the glyph a caller hands over as a *file*: the
    // `require('…/share_24px.xml')` road D43 opened, which has to reach the same probe
    // counter as a resource name. That it loads at all is G19's coverage
    // (`Button.harness.tsx`'s "draws the imported icon, and does not move the box when
    // the bytes arrive", whose release-build half is the `sharp-name` / `sharp-metro`
    // pair beside it); that it draws **in this control's content colour** is this
    // control's, and no road an app can name an icon by should be able to opt out.
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
    // The imported drawable is the one glyph that arrives rather than being there: in
    // development Metro serves the `require`'d file and the control loads it, so the
    // first probe can be earlier than the ink. Wait for the **file**, not for the
    // colour — the assertion below still reads the colour, and this only stops
    // "not yet" being read as "never" (Button's `probeUntilDrawn` is the same helper,
    // for the same reason, and `ms` is the same reading of D43's round trip).
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
      // Every rung paints *something* in the content colour. A rung whose slot came
      // back empty — a glyph that never resolved, a tint that never reached the painter
      // — is invisible to every box assertion in this file.
      for (const size of RUNGS) {
        expect(
          hitsOf(rungId(size)),
          `${size}: nothing was painted in the tint, so the glyph never reached the ` +
            'screen'
        ).toBeGreaterThan(0);
      }

      // A name the app does not have draws nothing, and keeps the box it would have
      // had: the glyph is sized by the ladder, never by the file (D43).
      expect(hitsOf('probe-missing')).toBe(0);
      // Material repaints disabled content at 38%, so the *pure* tint is no longer on
      // screen. A glyph tinted with a constant instead of the control's content colour
      // keeps its exact colour here and fails this line — C4's red proof for the tint.
      expect(hitsOf('probe-disabled')).toBe(0);
      // The file road draws too, in the same colour the name road does.
      expect(
        hitsOf('probe-asset'),
        'an `androidIcon` the app `require`s drew nothing in the content colour, so ' +
          "the imported artwork never reached this control's painter"
      ).toBeGreaterThan(0);

      // The rung sizes the art: the top rung's glyph is 40 dp against the medium
      // rung's 24, so the same colour covers more pixels. This line is asserted first
      // on purpose. A slot pinned to one point size makes the span 1, and this is the
      // line that says so — not the step loop below arriving at the same verdict one
      // rung earlier. Both reds are recorded: pinned, this line is red and the loop is
      // never reached; with one rung flattened to its neighbour's token, the span is
      // still over 1.5 and only the loop goes red.
      const span = hitsOf(rungId('xxlarge')) / hitsOf(rungId('medium'));
      console.log(`glyph grows with the rung: span=${span.toFixed(2)}`);
      expect(span).toBeGreaterThan(1.5);

      // The ladder, one step at a time, in Material's own token order.
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
          // The rung Material separates with its *container* (40 -> 56 dp) and not
          // with its glyph: level here, and two different boxes in the ladder test.
          expect(
            Math.abs(ratio - 1),
            `${previous} -> ${size}: the glyph token is ` +
              `${MATERIAL_LADDER[size].glyph} dp for both, so the ink must not move`
          ).toBeLessThan(0.15);
        }
      });
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
        boxes.get(rungId('medium')) ?? null
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
