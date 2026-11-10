/**
 * On-device tests for the ListItem (task G30).
 *
 * A ListItem is the row *content* of a list row, drawn by the platform's own row view —
 * UIKit's `UIListContentView` on iOS, Material 3's `ListItem` on Android (DECISIONS D46) —
 * and it has exactly one property that no other component in this library has: its height
 * is a function of **which slots are filled**, never of what was typed into them, because
 * every slot is capped to one line. That is what a `fillWidth` control must be able to
 * promise (`docs/architecture/sizing.md` §5), and it is what these tests hold:
 *
 * - **The ladder is the configuration, not the text.** Four configurations (title, plus
 *   subtitle, plus leading icon, plus both) are each poisoned with a size no row has, and
 *   each has to correct away from it; then every slot that costs no height — a different
 *   value, an accessory, a longer title — has to leave the box *where it was* and ask the
 *   engine for nothing. The second half is the expensive one: a key that folded text
 *   length in would resize on every keystroke of a search field and cost a correction per
 *   row of a list.
 * - **The leading glyph is a drawing contract.** `androidIcon` is G19's probe's reason for
 *   existing: every other reading of it is an echo of the prop. The row hands the harness
 *   the colour it tinted the glyph with, recorded where it tinted it, and the probe counts
 *   pixels of that colour. A filled 24 dp slab is the fixture, because its ink is
 *   *computable* — "the icon drew" and "the icon filled the slot" are then different
 *   assertions — and a missing drawable is the fixture that must not pass.
 * - **Inside a `Form.Row` the leaf is not the cell.** The row owns the insets, the shape
 *   and the press highlight (D46 item 2), so the item inside one reports `0,0` where the
 *   standalone one reports `16,16`, and paints nothing of its own where the standalone one
 *   paints its press. Both answers are read from the layout that drew and from the painter
 *   that was chosen, not off the `insideRow` prop.
 * - **A disabled row is inert.** A press is refused at the seam a tap uses, and no event
 *   reaches the app — the half that a prop echo can never answer, because `disabled` is
 *   also just a prop.
 *
 * The readings: `harnessUi.queryByTestId` (the box Fabric gave the view),
 * `hybridRef.measureContent()` (what the hosted row measured),
 * `nuiTestLayoutReport()` (where the row put its content, and who paints its press),
 * `nuiTestStateReport()` (what it drew, how many presses it took, what its accessibility
 * node says, and the colour it painted the glyph with), `nuiTestPixelProbe`/
 * `nuiTestPixelReport` (what it painted), `nuiTestLifetimeReport` (what the host object has
 * been through) and `nitroUiCore.sizingStats()` (what the engine did).
 */
import { useState } from 'react';
import { PixelRatio, Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { screen } from '@react-native-harness/ui';
import {
  Form,
  ListItem,
  nitroUiCore,
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The ListItem's Fabric name — what the sizing engine files sizes under. */
const COMPONENT = 'NitroUiListItem';

/** The glyph `HybridNitroUiListItem` is asked to draw on Android: a filled 24 dp square. */
const SLAB = 'nitroui_test_slab';
/** A drawable that is not in the APK, for the fixture that must *not* draw. */
const NOT_SHIPPED = 'nitroui_test_never_built';
/** The SF Symbol the same row is asked to draw on iOS. */
const SYMBOL = 'bell';

type ViewInfo = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** What `hybridRef` hands back — declared, not imported (DECISIONS D14). */
type ListItemHandle = {
  measureContent(): Size;
  nuiTestPress(): void;
  nuiTestProbeAccessibility(): void;
  nuiTestStateReport(): string;
  nuiTestLayoutReport(): string;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
  nuiTestLifetimeReport(): string;
};

const handles = new Map<string, ListItemHandle>();
const captureItem =
  (testId: string) =>
  (view: ListItemHandle): void => {
    handles.set(testId, view);
  };

/** Every press the app was told about, in order, as `testID:press`. */
const events: string[] = [];
const recordPress = (testId: string) => (): void => {
  events.push(`${testId}:press`);
};

/**
 * The four size configurations, spelled out here rather than read from
 * `ListItem.tsx`'s helper — `Button.harness.tsx`'s rule: a file that poisons the keys a
 * component derives through the helper it is testing cannot notice the helper moving,
 * which is the one failure the poison exists to catch.
 *
 * `s` is the subtitle (the only slot that costs height) and `i` the leading glyph; `value`
 * and `accessory` are measured not to cost anything on either platform and so are absent.
 */
const KEY_TITLE = '';
const KEY_SUBTITLE = 's';
const KEY_ICON = 'i';
const KEY_BOTH = 's|i';

/**
 * A size that is no list row's, planted as the engine's answer before a mount.
 *
 * 111.5 is taller than the tallest row this file measures (Material's two-line minimum is
 * 72 dp, UIKit's `.subtitleCell()` 68.33 pt) and shorter than the width, so a box left
 * standing at it cannot be mistaken for a row that measured itself.
 */
const WRONG_SIZE = { width: 33.5, height: 111.5 };

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

function corrections(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return (
    after.correctionsImmediate -
    before.correctionsImmediate +
    (after.correctionsBatched - before.correctionsBatched)
  );
}

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

function handleOf(testId: string): ListItemHandle {
  const handle = handles.get(testId);
  if (handle == null) {
    throw new Error(`"${testId}" never handed back a hybridRef handle.`);
  }
  return handle;
}

/**
 * The size configuration the row filed itself under.
 *
 * `nuiSizingKey` is an intrinsic prop (`core/NitroUiIntrinsicProps.ts`), which nitrogen
 * keeps off the generated hybrid type — so it is read through a cast, as
 * `Picker.harness.tsx` does, rather than widened into the handle above.
 */
function sizingKeyOf(testId: string): string | undefined {
  return (
    handles.get(testId) as unknown as { nuiSizingKey?: string } | undefined
  )?.nuiSizingKey;
}

/** The state report, as `key -> value`. */
function reportOf(testId: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/** `insets=<l>,<t>;shape=<0|1>;box=<w>x<h>`, as numbers — or the raw line in a message. */
type Layout = {
  leading: number;
  trailing: number;
  shape: number;
  box: Size;
  raw: string;
};

function layoutOf(testId: string): Layout | null {
  const raw = handles.get(testId)?.nuiTestLayoutReport() ?? '';
  const match =
    /^insets=(-?[\d.]+),(-?[\d.]+);shape=([01]);box=([\d.]+)x([\d.]+)$/.exec(
      raw
    );
  if (match == null) return null;
  return {
    leading: Number(match[1]),
    trailing: Number(match[2]),
    shape: Number(match[3]),
    box: { width: Number(match[4]), height: Number(match[5]) },
    raw,
  };
}

async function waitForLayout(testId: string, what: string): Promise<Layout> {
  return pollUntil(
    () => {
      const layout = layoutOf(testId);
      return layout != null && layout.box.height > 0 ? layout : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never reported where it drew - last answer ` +
          `"${handles.get(testId)?.nuiTestLayoutReport() ?? 'no handle'}".`
      )
  );
}

/** Poll until the row has drawn the line it is being asked to draw. */
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

async function waitForMeasured(testId: string, what: string): Promise<Size> {
  return pollUntil(
    () => {
      const size = measured(testId);
      return size != null && size.width > 0 && size.height > 0 ? size : null;
    },
    () =>
      new Error(
        `"${testId}" (${what}) never reported a measured size from the hosted ` +
          `row. Box: ${describeSize(sizeOf(testId))}.`
      )
  );
}

/** Poll until the *laid-out* box is `size`, i.e. until a size has really arrived. */
async function waitForBox(testId: string, size: Size, what: string) {
  return pollUntil(
    () => (sameSize(sizeOf(testId), size) ? sizeOf(testId) : null),
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached ${describeSize(size)} - ` +
          `last box ${describeSize(sizeOf(testId))}, row measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/** Poll until the box's *height* is `height`, whatever width it settled at. */
async function waitForBoxHeight(testId: string, height: number) {
  return pollUntil(
    () => {
      const box = sizeOf(testId);
      return box != null && Math.abs(box.height - height) < 0.6 ? box : null;
    },
    () =>
      new Error(
        `testID "${testId}" never reached a height of ${height.toFixed(
          2
        )} - last box ${describeSize(sizeOf(testId))}, row measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/**
 * Mount each id, then wait until each one's laid-out box equals what its own row measured.
 * Every assertion in this file sits behind this: a box still standing at the planted size
 * would make "it corrected" and "it never corrected" read the same.
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

/** Plant `WRONG_SIZE` as the engine's answer for each key, and force a re-ask. */
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

/** Press an item the way this platform's harness can, through the tap's own path. */
function pressItem(testId: string): void {
  handleOf(testId).nuiTestPress();
}

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/** Wait until the app has been told exactly `wanted`, and then say what it was told. */
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
  // Then a quiet period: returning the moment the count is reached let a surplus event
  // through, and a row that fires twice per tap is exactly what this suite must see.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
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

/** The colour the row tinted its glyph with, as the number the probe wants. */
async function glyphTintOf(testId: string): Promise<number> {
  const tint = await pollUntil(
    () => {
      const field = reportOf(testId).iconTint;
      return field == null || field === '-' ? null : field;
    },
    () =>
      new Error(
        `"${testId}" never recorded a glyph tint - it reports ` +
          `"${handles.get(testId)?.nuiTestStateReport() ?? 'no handle'}".`
      )
  );
  const hex = /^#([0-9A-Fa-f]{6})$/.exec(tint);
  if (hex == null) {
    throw new Error(`"${tint}" is not a #RRGGBB colour.`);
  }
  return parseInt(hex[1] ?? '', 16);
}

/** `drops=<n> recycles=<m>`, as numbers. */
function lifetimeOf(testId: string): { drops: number; recycles: number } {
  const raw = handles.get(testId)?.nuiTestLifetimeReport() ?? '';
  const drops = /drops=(\d+)/.exec(raw)?.[1];
  const recycles = /recycles=(\d+)/.exec(raw)?.[1];
  if (drops == null || recycles == null) {
    throw new Error(
      `nuiTestLifetimeReport answered "${raw}", which has no drops= or recycles= field`
    );
  }
  return { drops: Number(drops), recycles: Number(recycles) };
}

/** The perf marks the pool left for one instance id, since the last drain. */
function drainKinds(instanceId: number): string[] {
  const kinds: string[] = [];
  for (const event of nitroUiCore.drainPerf()) {
    if (event.instanceId === instanceId) {
      kinds.push(event.kind);
    }
  }
  return kinds;
}

/**
 * The props a test rewrites, by testID.
 *
 * A row's height claim is about *changing* slots, and `ListItem.tsx` sends every prop on
 * every commit, so the only way to change one is for the parent to re-render with a
 * different value. These are the parents' setters.
 */
type Slots = {
  title?: string | null;
  subtitle?: string | null;
  value?: string | null;
  accessory?: 'none' | 'disclosure';
  disabled?: boolean;
};
const slotSetters = new Map<string, (next: Slots) => void>();

/** Re-render `testId` with `next` merged over its current slots, and wait for the draw. */
async function setSlots(testId: string, next: Slots): Promise<void> {
  const set = slotSetters.get(testId);
  if (set == null) {
    throw new Error(`"${testId}" has no parent to rewrite its slots.`);
  }
  set(next);
  await sleep(80);
}

/** One row whose slots a test can rewrite, with its own press log and handle. */
function SlotItem(props: Slots & { testId: string; onPress?: boolean }) {
  const { testId, onPress = true, ...initial } = props;
  const [slots, setSlotsForThisRow] = useState<Slots>(initial);
  slotSetters.set(testId, (next) =>
    setSlotsForThisRow((current) => ({ ...current, ...next }))
  );
  return (
    <ListItem
      accessory={slots.accessory ?? 'none'}
      disabled={slots.disabled ?? false}
      testID={testId}
      title={slots.title ?? null}
      subtitle={slots.subtitle ?? null}
      value={slots.value ?? null}
      onPress={onPress ? recordPress(testId) : undefined}
      hybridRef={captureItem(testId)}
    />
  );
}

const columnStyle = { gap: 6 } as const;

describe('ListItem · G30', () => {
  afterEach(() => {
    cleanup();
    events.length = 0;
    slotSetters.clear();
  });

  it('sizes each configuration from a poisoned fallback, and only it', async () => {
    // Four rows, four size configurations, each planted with a size no row has before it
    // mounts. A configuration that never arrives leaves a visible 111.5 tall row *and*
    // costs this file the correction it requires below, so the two failure modes — the
    // engine never asked, and the engine asked and was ignored — cannot both hide.
    //
    // The relations between the four are the actual claim, and they are asserted rather
    // than logged: the subtitle is the only slot that costs height, so it must move the
    // box, and the glyph — which is in the key because on Android a leading composable
    // *could* raise the row's minimum — must not. Measured against UIKit's `.cell()`
    // (52.00 pt) and `.subtitleCell()` (68.33 pt) and Material's one- and two-line minima
    // (56 dp, 72 dp), a subtitle that changed nothing, or a glyph that changed something,
    // is red here rather than in a screenshot review.
    const ids = ['size-title', 'size-subtitle', 'size-icon', 'size-both'];
    const keys = new Map<string, string>([
      ['size-title', KEY_TITLE],
      ['size-subtitle', KEY_SUBTITLE],
      ['size-icon', KEY_ICON],
      ['size-both', KEY_BOTH],
    ]);
    poison([...keys.values()]);
    const before = stats();
    await render(
      <View style={columnStyle} testID="sizing-column">
        <ListItem
          testID="size-title"
          title="Ringtone"
          hybridRef={captureItem('size-title')}
        />
        <ListItem
          testID="size-subtitle"
          title="Ringtone"
          subtitle="Only while the app is open"
          hybridRef={captureItem('size-subtitle')}
        />
        <ListItem
          androidIcon={SLAB}
          systemImage={SYMBOL}
          testID="size-icon"
          title="Ringtone"
          hybridRef={captureItem('size-icon')}
        />
        <ListItem
          accessory="disclosure"
          androidIcon={SLAB}
          systemImage={SYMBOL}
          testID="size-both"
          title="Ringtone"
          subtitle="Only while the app is open"
          value="Normal"
          hybridRef={captureItem('size-both')}
        />
      </View>,
      { timeout: 20000 }
    );
    const boxes = await settleEach(ids);
    const made = corrections(before, stats());
    const column = sizeOf('sizing-column');

    const table = ids
      .map(
        (id) =>
          `  ${id.padEnd(15)} box=${describeSize(
            boxes.get(id) ?? null
          )} key="${String(sizingKeyOf(id))}"`
      )
      .join('\n');
    console.log(`list-item configurations:\n${table}\n  corrections=${made}`);

    // Four cold configurations, and each owes its own correction.
    expect(made).toBeGreaterThanOrEqual(ids.length);
    for (const id of ids) {
      const box = boxes.get(id) ?? null;
      // 1. The box is not the planted size: the correction arrived.
      expect(sameSize(box, WRONG_SIZE)).toBe(false);
      // 2. The row filed itself under the key this file poisoned, which is what makes the
      //    correction above attributable to the poison rather than to a key nobody read.
      expect(sizingKeyOf(id)).toBe(keys.get(id));
      // 3. `fillWidth`: the width is the column's, and the height is the row's own.
      const measuredSize = measured(id);
      expect(measuredSize).not.toBeNull();
      expect(
        Math.abs((box?.height ?? 0) - (measuredSize?.height ?? 0))
      ).toBeLessThan(0.6);
      if (column != null) {
        expect(Math.abs((box?.width ?? 0) - column.width)).toBeLessThan(1);
      }
    }

    const heightOf = (id: string): number => boxes.get(id)?.height ?? 0;
    // 4. The subtitle is the slot that costs height, by at least half a line.
    expect(heightOf('size-subtitle')).toBeGreaterThan(
      heightOf('size-title') + 8
    );
    // 5. The glyph is in the key but costs no height: one line either way, on both
    //    platforms. `size-both` against `size-subtitle` says the same of the value and the
    //    accessory, which are not in the key at all.
    expect(
      Math.abs(heightOf('size-icon') - heightOf('size-title'))
    ).toBeLessThan(0.6);
    expect(
      Math.abs(heightOf('size-both') - heightOf('size-subtitle'))
    ).toBeLessThan(0.6);
    // 6. And the poison is not the answer for any of them, spelled for the report.
    expect(heightOf('size-title')).not.toBeCloseTo(WRONG_SIZE.height, 5);
  });

  it('keeps one box while the slots that cost nothing change', async () => {
    // The sizing promise in the other direction: a key that folded the *text* in would
    // pass the test above and still cost a cache entry per row of a settings screen,
    // because every row has its own title. Here the title, the value and the accessory all
    // change, and the box has to stay exactly where it was — and, the sharper half,
    // `cachedSizes` has to stay where it was: **no new configuration may open**. That is
    // the claim, not "zero corrections", which this run measured at 1 for a value change on
    // iOS: a prop commit re-measures the hosted row and the engine re-applies a size it
    // already had, and a re-apply of the right number costs a list nothing. A key that
    // folded the text in cannot hide from `cachedSizes`, which counts configurations.
    //
    // Then the subtitle arrives and leaves, and both directions pay: the box has to follow
    // the configuration, and the key has to be what makes it do so. The `s` key is poisoned
    // first so "the two-line box came back" cannot be a box that was simply never corrected.
    const id = 'slot-row';
    poison([KEY_SUBTITLE]);
    await render(
      <View style={columnStyle}>
        <SlotItem
          testId={id}
          title="Ringtone"
          value="Off"
          accessory="none"
          onPress={false}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId(id);
    const settled = await settleEach([id]);
    const oneLine = settled.get(id)?.height ?? 0;
    const drawn = (suffix: string) => waitForDisplayed(id, suffix);

    // 1. A different value: same key, same box, and no new configuration opened.
    let before = stats();
    await setSlots(id, { value: 'Normal' });
    await drawn('Ringtone|-|Normal|none');
    expect(stats().cachedSizes - before.cachedSizes).toBe(0);
    expect((await waitForBoxHeight(id, oneLine)).height).toBeCloseTo(
      oneLine,
      1
    );

    // 2. The disclosure chevron: drawn inside the insets the row already has.
    before = stats();
    await setSlots(id, { accessory: 'disclosure' });
    await drawn('Ringtone|-|Normal|disclosure');
    expect(stats().cachedSizes - before.cachedSizes).toBe(0);
    expect((await waitForBoxHeight(id, oneLine)).height).toBeCloseTo(
      oneLine,
      1
    );

    // 3. A title four times as long, at the same width: one line, tail-truncated, and the
    //    same height. This is the fixture that does not coincide with the answer — the
    //    row has to *truncate* rather than grow, and a row that grew is 20 pt taller.
    before = stats();
    const longTitle =
      'Ringtone for the default text tone on this device and its repeats';
    await setSlots(id, { title: longTitle });
    await drawn(`${longTitle}|-|Normal|disclosure`);
    expect(stats().cachedSizes - before.cachedSizes).toBe(0);
    expect((await waitForBoxHeight(id, oneLine)).height).toBeCloseTo(
      oneLine,
      1
    );

    // 4. The subtitle, from the poisoned key: the box moves, and it moves to what the row
    //    measured — not to the 111.5 that was planted.
    before = stats();
    await setSlots(id, { subtitle: 'Only while the app is open' });
    await drawn(`${longTitle}|Only while the app is open|Normal|disclosure`);
    const twoLine = await waitForMeasured(id, 'two-line row');
    expect(twoLine.height).not.toBeCloseTo(WRONG_SIZE.height, 5);
    expect(sameSize(sizeOf(id), WRONG_SIZE)).toBe(false);
    await waitForBoxHeight(id, twoLine.height);
    expect(corrections(before, stats())).toBeGreaterThanOrEqual(1);
    // The second line is a *configuration*, which is why it is the one change that opens a
    // cache entry — and the entry it opened is the poisoned `s` key, not a fresh one per text.
    expect(stats().cachedSizes - before.cachedSizes).toBe(1);
    expect(twoLine.height).toBeGreaterThan(oneLine + 8);

    // 5. And back: the one-line key is still in the cache, so leaving a two-line row opens
    //    no configuration and the box returns to the height it started at.
    before = stats();
    await setSlots(id, { subtitle: null });
    await drawn(`${longTitle}|-|Normal|disclosure`);
    await waitForBoxHeight(id, oneLine);
    expect(stats().cachedSizes - before.cachedSizes).toBe(0);
    console.log(
      `list-item slot changes: oneLine=${oneLine.toFixed(2)} ` +
        `twoLine=${twoLine.height.toFixed(2)}`
    );
  });

  it('draws the leading glyph in the row content colour, filling its slot', async () => {
    // Three rows with the same title and the same height: a slab, nothing, and a drawable
    // that is not in the APK. The row records the colour it tinted the glyph with where it
    // tinted it (`LocalContentColor`, which is Material's own dynamic-palette answer and
    // cannot be written down by a test), and the probe counts pixels of that colour over
    // the row's own bounds.
    //
    // The slab is the fixture that makes the count *mean* something. A glyph's ink area is
    // unknowable from the outside, so "an icon appeared" is the most a star could prove; a
    // filled 24 dp square paints `(24 dp x density)^2` pixels, so the delta over the row
    // with no icon can be asserted against the slot's area — which is the difference
    // between an icon that drew and an icon that drew *in the slot Material gives a leading
    // glyph* (`ListTokens.ItemLeadingIconSize`).
    //
    // The missing drawable is the fixture that must not pass: its slot is held at 24 dp by
    // a `Spacer`, so the box is right while the ink is absent, and only a pixel count can
    // tell the two apart.
    const ids = ['ink-slab', 'ink-none', 'ink-missing'];
    await render(
      <View style={columnStyle}>
        <ListItem
          androidIcon={SLAB}
          systemImage={SYMBOL}
          testID="ink-slab"
          title="Ringtone"
          hybridRef={captureItem('ink-slab')}
        />
        <ListItem
          testID="ink-none"
          title="Ringtone"
          hybridRef={captureItem('ink-none')}
        />
        <ListItem
          androidIcon={NOT_SHIPPED}
          testID="ink-missing"
          title="Ringtone"
          hybridRef={captureItem('ink-missing')}
        />
      </View>,
      { timeout: 20000 }
    );
    await settleEach(ids);

    if (Platform.OS === 'ios') {
      // iOS has no sampler: the probe refuses rather than reporting zero hits, which is the
      // answer that would let a dropped symbol look like a passing test. What iOS does
      // prove here is the *slot* — the glyph is in the box the row measured (the `i`
      // configuration above), and the SF Symbol's pixels are the screenshot's and the
      // example app's to show.
      const refusal = await pixelProbe('ink-slab', 0x000000, 'the iOS refusal');
      expect(refusal).toContain('no pixels');
      expect(reportOf('ink-slab').iconTint).toBe('-');
      expect(reportOf('ink-slab').displayed).toContain('Ringtone');
      return;
    }

    // Android records the tint, and records *nothing* for a row that has no glyph — the
    // difference between "no icon" and "an icon whose colour was never read".
    const tint = await glyphTintOf('ink-slab');
    expect(reportOf('ink-none').iconTint).toBe('-');

    const filled = probeHits(await pixelProbe('ink-slab', tint, 'the slab'));
    const empty = probeHits(await pixelProbe('ink-none', tint, 'no glyph'));
    const missing = probeHits(
      await pixelProbe('ink-missing', tint, 'the miss')
    );

    // The ink a 24 dp slab paints at this density, and the floor it has to clear. Half of
    // the slot's area is generous — antialiasing costs a rim of pixels at the edge, and
    // the probe's own tolerance is ±30 per channel sum — and it is still three times what
    // a slot that drew nothing could produce.
    const density = PixelRatio.get();
    const slot = Math.pow(24 * density, 2);
    const glyphInk = filled - empty;
    const missingInk = missing - empty;
    console.log(
      `list-item glyph ink: tint=${reportOf('ink-slab').iconTint} ` +
        `filled=${String(filled)} none=${String(empty)} missing=${String(
          missing
        )} glyph=${String(glyphInk)} slot=${String(
          Math.round(slot)
        )} density=${String(density)}`
    );
    expect(glyphInk).toBeGreaterThanOrEqual(slot * 0.5);
    expect(missingInk).toBeLessThan(slot * 0.25);
  });

  it('takes no press and sends nothing while disabled', async () => {
    // A tap on a disabled row must do *nothing*: not fire and be grey, not fire once for
    // the row and once for the cell. `nuiTestPress` runs the path a tap takes — Material's
    // `onClick`, UIKit's recogniser — and refuses on the same condition, so the counter
    // below is the row's own answer rather than a prop's.
    const ids = ['press-enabled', 'press-disabled'];
    await render(
      <View style={columnStyle}>
        <ListItem
          onPress={recordPress('press-enabled')}
          testID="press-enabled"
          title="Ringtone"
          hybridRef={captureItem('press-enabled')}
        />
        <ListItem
          disabled
          onPress={recordPress('press-disabled')}
          testID="press-disabled"
          title="Do not disturb"
          hybridRef={captureItem('press-disabled')}
        />
      </View>,
      { timeout: 20000 }
    );
    await settleEach(ids);
    await waitForDisplayed('press-disabled', 'Do not disturb|-|-|none');

    const from = events.length;
    pressItem('press-disabled');
    pressItem('press-disabled');
    pressItem('press-disabled');
    await sleep(EVENT_QUIET_MS);
    expect(events.slice(from)).toEqual([]);
    expect(reportOf('press-disabled').presses ?? 'none').toBe('0');

    pressItem('press-enabled');
    expect(await waitForEvents(from, ['press-enabled:press'])).toEqual([
      'press-enabled:press',
    ]);
    expect(reportOf('press-enabled').presses ?? 'none').toBe('1');

    // The disabled row is still *drawn*, and still says it is disabled to a reader: inert,
    // not absent.
    expect(reportOf('press-disabled').displayed).toContain('Do not disturb');
    const a11y = await probeAccessibility('press-disabled');
    expect(a11y).toContain('disabled=true');
    expect(await probeAccessibility('press-enabled')).toContain(
      'disabled=false'
    );
    console.log(`list-item disabled: a11y=${a11y}`);
  });

  it('publishes one node, whose role is a button only with onPress', async () => {
    // One element per item (core.md §3), carrying title, subtitle and value; the button
    // role only when there is a press to make. Android reads the merged Compose semantics
    // node a reader is handed — and says how many nodes name the item, so a row that
    // leaked its labels as separate elements is a failure rather than an ambiguity — and
    // iOS reads the one element this leaf publishes for itself.
    const ids = ['a11y-button', 'a11y-label'];
    await render(
      <View style={columnStyle}>
        <ListItem
          onPress={recordPress('a11y-button')}
          subtitle="Only while the app is open"
          testID="a11y-button"
          title="Ringtone"
          value="Normal"
          hybridRef={captureItem('a11y-button')}
        />
        <ListItem
          subtitle="Last synced yesterday"
          testID="a11y-label"
          title="Account"
          hybridRef={captureItem('a11y-label')}
        />
      </View>,
      { timeout: 20000 }
    );
    await settleEach(ids);

    const button = await probeAccessibility('a11y-button');
    const label = await probeAccessibility('a11y-label');
    console.log(`list-item a11y:\n  button: ${button}\n  label:  ${label}`);

    expect(button).not.toContain('no node');
    expect(button).not.toContain('ambiguous');
    expect(label).not.toContain('no node');
    expect(label).not.toContain('ambiguous');

    // The role, and only with `onPress`. iOS spells the element's trait `button`; Android
    // spells `Role.Button`'s own name, and the row without a press has no role at all.
    expect(button.toLowerCase()).toContain('role=button');
    expect(label.toLowerCase()).not.toContain('role=button');

    // All three slots are in what a reader gets, whatever order the platform reads them in.
    for (const text of ['Ringtone', 'Only while the app is open', 'Normal']) {
      expect(button).toContain(text);
    }
    for (const text of ['Account', 'Last synced yesterday']) {
      expect(label).toContain(text);
    }

    // An explicit label wins, and is the whole answer.
    const named = 'Work account, signed in as danny';
    await render(
      <View style={columnStyle}>
        <ListItem
          accessibilityLabel={named}
          onPress={recordPress('a11y-named')}
          subtitle="Only while the app is open"
          testID="a11y-named"
          title="Account"
          hybridRef={captureItem('a11y-named')}
        />
      </View>,
      { timeout: 20000 }
    );
    await waitForTestId('a11y-named');
    await settleEach(['a11y-named']);
    expect(await probeAccessibility('a11y-named')).toContain(`label=${named}`);
  });

  it('starts a recycled row from nothing', async () => {
    // The residue a row can leave for its next owner is its press counter and the line it
    // drew, and neither is cleared by a prop rewrite: `ListItem.tsx` sends every prop on
    // every commit, so the only thing that says whether the reset ran is a press the second
    // owner takes and reads back.
    //
    // `nuiPerfId` is the witness that the churn actually pooled something: without a
    // `recycled` mark the loop below would be measuring a run that allocated a fresh view
    // every round and proved nothing (`Recycling.harness.tsx`'s rule, for the same reason).
    const PERF_ID = 3030;
    const owner = (title: string, value: string) => (
      <View style={columnStyle}>
        <ListItem
          nuiPerfId={PERF_ID}
          onPress={recordPress('recycled-item')}
          testID="recycled-item"
          title={title}
          value={value}
          hybridRef={captureItem('recycled-item')}
        />
      </View>
    );

    nitroUiCore.setPerfEnabled(true);
    try {
      nitroUiCore.drainPerf();
      let sawRecycle = false;
      for (let round = 0; round < 4 && !sawRecycle; round += 1) {
        const first = await render(owner('Notifications', 'On'), {
          timeout: 20000,
        });
        await settleEach(['recycled-item']);
        await waitForDisplayed('recycled-item', 'Notifications|-|On|none');
        const from = events.length;
        pressItem('recycled-item');
        await waitForEvents(from, ['recycled-item:press']);
        first.unmount();
        // Long enough for the drop and, on iOS, for the instance to reach the pool.
        await sleep(500);
        sawRecycle = drainKinds(PERF_ID).includes('recycled');

        const second = await render(owner('Bluetooth', 'Off'), {
          timeout: 20000,
        });
        await settleEach(['recycled-item']);
        // Read *before* pressing: a stale `displayed=` is the residue, and pressing first
        // would overwrite it with the answer the props would have produced anyway.
        const drawn = reportOf('recycled-item').displayed;
        const from2 = events.length;
        pressItem('recycled-item');
        await waitForEvents(from2, ['recycled-item:press']);
        const presses = reportOf('recycled-item').presses ?? 'none';
        const marks = drainKinds(PERF_ID);
        const life = lifetimeOf('recycled-item');
        console.log(
          `  · round ${String(round)}: displayed=${drawn} presses=${presses} ` +
            `marks=${marks.join(',') || 'none'} drops=${String(life.drops)} ` +
            `recycles=${String(life.recycles)}`
        );
        expect(drawn).toBe('Bluetooth|-|Off|none');
        expect(presses).toBe('1');
        second.unmount();
        await sleep(300);
      }
      expect(sawRecycle).toBe(true);
    } finally {
      nitroUiCore.setPerfEnabled(false);
    }
  });

  it('draws no insets, container or highlight of its own inside a Form.Row', async () => {
    // The row is the cell, and the cell has already paid for its insets, its shape and its
    // press (D46 item 2). An item that also drew them would land its text 32 pt in from the
    // edge with a second highlight under the cell's — the doubled-padding row this leaf
    // exists to make impossible.
    //
    // `insets=` is measured, not declared: it is where the content column landed inside the
    // view's bounds (`onGloballyPositioned` on Android, the configuration's own margins on
    // iOS). `shape=` is read where the painter is chosen — `1` when this leaf paints a
    // background or arms its own highlight, `0` when it hands the press to the cell — so the
    // two rows cannot both answer the same thing and one of them cannot be right by accident.
    const ids = ['bare-item', 'form-item'];
    await render(
      <View style={columnStyle}>
        <ListItem
          onPress={recordPress('bare-item')}
          testID="bare-item"
          title="Ringtone"
          value="Normal"
          hybridRef={captureItem('bare-item')}
        />
        <Form style={{ height: 140 }}>
          <Form.Row onPress={recordPress('form-row')}>
            <ListItem
              onPress={recordPress('form-item')}
              testID="form-item"
              title="Ringtone"
              value="Normal"
              hybridRef={captureItem('form-item')}
            />
          </Form.Row>
        </Form>
      </View>,
      { timeout: 25000 }
    );
    await settleEach(ids);

    const bare = await waitForLayout('bare-item', 'standalone');
    const inRow = await waitForLayout('form-item', 'inside Form.Row');
    console.log(
      `list-item layout:\n  standalone: ${bare.raw}\n  in row:     ${inRow.raw}`
    );

    const inset = Platform.OS === 'android' ? 16 : 16;
    expect(bare.leading).toBeCloseTo(inset, 1);
    expect(bare.trailing).toBeCloseTo(inset, 1);
    expect(bare.shape).toBe(1);
    expect(inRow.leading).toBeCloseTo(0, 1);
    expect(inRow.trailing).toBeCloseTo(0, 1);
    expect(inRow.shape).toBe(0);

    // And the item inside the row is still itself: it drew, and a press on it is a press.
    expect(reportOf('form-item').displayed).toBe('Ringtone|-|Normal|none');
    const from = events.length;
    pressItem('form-item');
    expect(await waitForEvents(from, ['form-item:press'])).toEqual([
      'form-item:press',
    ]);
  });
});
