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

/** A test drawable in the example APK: a filled 24 dp square, so its ink is computable. */
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

type FormRowHandle = {
  nuiTestRowReport(): string;
  nuiTestA11yClick(): void;
};

const rowHandles = new Map<string, FormRowHandle>();
const captureRow =
  (key: string) =>
  (view: FormRowHandle): void => {
    rowHandles.set(key, view);
  };

/** The cell's own report, as `key -> value`. iOS publishes it on main, so callers poll. */
function rowReportOf(key: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = rowHandles.get(key)?.nuiTestRowReport() ?? '';
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fields;
}

/**
 * `colours=text=…,secondary=…,image=…,chevron=…,value=…`, as `slot -> colour`.
 *
 * Each colour is a `#rrggbbaa`, or a word: `none` for a slot that draws nothing, `unset` for
 * iOS's image slot when the row set no tint, and `pending` for a slot whose configure never
 * ran.
 */
function coloursOf(testId: string): Record<string, string> {
  const report = reportOf(testId).colours ?? '';
  const slots: Record<string, string> = {};
  for (const pair of report.split(/,(?=[a-z]+=)/)) {
    const at = pair.indexOf('=');
    if (at > 0) slots[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return slots;
}

/** A `#rrggbbaa`'s alpha as 0-255, or `null` when the slot paints nothing. */
function alphaOf(colour: string | undefined): number | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
    colour ?? ''
  );
  return hex == null ? null : parseInt(hex[4] ?? '', 16);
}

/** Press the *cell* the way a screen reader does — Android's `ACTION_CLICK` seam. */
function clickRow(key: string): void {
  const row = rowHandles.get(key);
  if (row == null) {
    throw new Error(`no Form.Row handle was captured for "${key}"`);
  }
  row.nuiTestA11yClick();
}

/** Every press the app was told about, in order, as `testID:press`. */
const events: string[] = [];
const recordPress = (testId: string) => (): void => {
  events.push(`${testId}:press`);
};

/**
 * The four size configurations, spelled out rather than imported from the component, so a
 * change in how the component derives its keys fails here. `s` is the subtitle (the only
 * slot that costs height) and `i` the leading glyph.
 */
const KEY_TITLE = '';
const KEY_SUBTITLE = 's';
const KEY_ICON = 'i';
const KEY_BOTH = 's|i';

/**
 * A size no list row has (taller than the tallest row here), planted as the engine's answer
 * before a mount, so a box left standing at it cannot pass for a row that measured itself.
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
 * The size configuration the row filed itself under. `nuiSizingKey` is not on the generated
 * hybrid type, hence the cast.
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
 * Mount each id, then wait until each one's laid-out box equals what its own row measured,
 * so no assertion reads a box still standing at the planted size.
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

/** Press an item through the path a tap takes. */
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
  // Then a quiet period, so a surplus event (a row that fires twice per tap) is seen.
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

/** The props a test rewrites on a mounted row. */
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
      // 2. The row filed itself under the key this file poisoned.
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
    // 5. The glyph is in the key but costs no height. `size-both` against `size-subtitle`
    //    says the same of the value and the accessory, which are not in the key at all.
    expect(
      Math.abs(heightOf('size-icon') - heightOf('size-title'))
    ).toBeLessThan(0.6);
    expect(
      Math.abs(heightOf('size-both') - heightOf('size-subtitle'))
    ).toBeLessThan(0.6);
    // 6. And the poison is not the answer.
    expect(heightOf('size-title')).not.toBeCloseTo(WRONG_SIZE.height, 5);
  });

  it('keeps one box while the slots that cost nothing change', async () => {
    // The claim is `cachedSizes`, not zero corrections: a prop commit may re-measure the
    // row and re-apply a size the engine already had. The `s` key is poisoned so the
    // two-line box below cannot be one that was simply never corrected.
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

    // 3. A title four times as long, at the same width: it truncates on one line instead
    //    of growing.
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
    // The second line is a configuration, so it is the one change that opens a cache entry.
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
    // Three rows of the same height: a filled 24 dp slab, whose ink area is computable, no
    // glyph, and a drawable missing from the APK, whose empty slot is still held at 24 dp.
    // The tint is Material's dynamic colour, so it is read from the row, not written here.
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
      // iOS has no pixel sampler: the probe refuses rather than reporting zero hits.
      const refusal = await pixelProbe('ink-slab', 0x000000, 'the iOS refusal');
      expect(refusal).toContain('no pixels');
      expect(reportOf('ink-slab').iconTint).toBe('-');
      expect(reportOf('ink-slab').displayed).toContain('Ringtone');
      return;
    }

    // Android records the tint, and records nothing for a row that has no glyph.
    const tint = await glyphTintOf('ink-slab');
    expect(reportOf('ink-none').iconTint).toBe('-');

    const filled = probeHits(await pixelProbe('ink-slab', tint, 'the slab'));
    const empty = probeHits(await pixelProbe('ink-none', tint, 'no glyph'));
    const missing = probeHits(
      await pixelProbe('ink-missing', tint, 'the miss')
    );

    // The ink a 24 dp slab paints at this density. The floor is half the slot's area:
    // antialiasing costs a rim of pixels, and the probe tolerates ±30 per channel sum.
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
    // `nuiTestPress` runs the path a tap takes (Material's `onClick`, UIKit's recogniser)
    // and refuses on the same condition, so the press counter is the row's own answer.
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

    // The disabled row is still drawn, and still says it is disabled to a screen reader.
    expect(reportOf('press-disabled').displayed).toContain('Do not disturb');
    const a11y = await probeAccessibility('press-disabled');
    expect(a11y).toContain('disabled=true');
    expect(await probeAccessibility('press-enabled')).toContain(
      'disabled=false'
    );
    console.log(`list-item disabled: a11y=${a11y}`);
  });

  it('publishes one node, whose role is a button only with onPress', async () => {
    // Android reads the merged Compose semantics node and answers `ambiguous` when more
    // than one node names the item; iOS reads the one element the row publishes.
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

    // iOS spells the element's trait `button`; Android spells `Role.Button`'s own name, and
    // the row without a press has no role at all.
    expect(button.toLowerCase()).toContain('role=button');
    expect(label.toLowerCase()).not.toContain('role=button');

    // All three slots, in the order a person reads the row: headline, supporting line,
    // value. `label=` is the last field of the probe line on both platforms.
    const readOrder = (probed: string): string => {
      const at = probed.lastIndexOf(',label=');
      return at < 0 ? probed : probed.slice(at + ',label='.length);
    };
    expect(readOrder(button)).toBe(
      'Ringtone, Only while the app is open, Normal'
    );
    for (const text of ['Account', 'Last synced yesterday']) {
      expect(label).toContain(text);
    }
    expect(readOrder(label)).toBe('Account, Last synced yesterday');

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
    // A prop rewrite does not clear the press counter, so the second owner's count shows
    // whether the reset ran. The `recycled` perf mark shows a view really was pooled.
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
        // Read before pressing: a stale `displayed=` is the residue, and a press would
        // overwrite it.
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
    // `insets=` is where the content landed inside the view's bounds, and `shape=` is 1
    // once the row has painted a press highlight of its own. The `Form.Row` has no
    // `onPress`: the handler is written on the item, and the row has to take it.
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
          <Form.Row hybridRef={captureRow('form-row')}>
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

    expect(bare.leading).toBeCloseTo(16, 1);
    expect(bare.trailing).toBeCloseTo(16, 1);
    expect(inRow.leading).toBeCloseTo(0, 1);
    expect(inRow.trailing).toBeCloseTo(0, 1);

    // Nothing has painted yet, on either row.
    expect(bare.shape).toBe(0);
    expect(inRow.shape).toBe(0);

    // The cell has taken the item's handler: `pressable` is what the row tells its own native
    // view to be. iOS publishes the report from main, so this polls rather than reads once.
    const pressable = await pollUntil(
      () => {
        const report = rowReportOf('form-row');
        return report.pressable == null ? null : report.pressable;
      },
      () =>
        new Error(
          `the Form.Row around a pressable item never reported its own pressability - last ` +
            `answer "${rowHandles.get('form-row')?.nuiTestRowReport() ?? 'no handle'}".`
        )
    );
    console.log(`  · in-Form cell: pressable=${pressable}`);
    expect(pressable).toBe('1');

    // The standalone row paints; the row inside the cell never does, press or no press.
    pressItem('bare-item');
    const painted = await pollUntil(
      () => (layoutOf('bare-item')?.shape === 1 ? '1' : null),
      () =>
        new Error(
          `"bare-item" never reported its own highlight painting - last answer ` +
            `"${handles.get('bare-item')?.nuiTestLayoutReport() ?? 'no handle'}", and a press ` +
            `was taken (presses=${String(reportOf('bare-item').presses)}).`
        )
    );
    expect(painted).toBe('1');
    const afterPress = await waitForLayout('form-item', 'inside Form.Row');
    console.log(`  · in row after both presses: ${afterPress.raw}`);
    expect(afterPress.shape).toBe(0);

    // The item inside the row still gets its own press, through the cell that owns the
    // touch: on Android, `ACTION_CLICK` on the row. iOS's activation is a synthesised centre
    // tap that no method can send from here.
    expect(reportOf('form-item').displayed).toBe('Ringtone|-|Normal|none');
    if (Platform.OS === 'android') {
      const from = events.length;
      clickRow('form-row');
      expect(await waitForEvents(from, ['form-item:press'])).toEqual([
        'form-item:press',
      ]);
    }
  });

  it('greys every slot when it is disabled, not only the value', async () => {
    // `colours=` is read where each slot is configured, so it is what will be painted. The
    // alpha byte is compared between two identical rows, because each platform has its
    // own greys.
    const ids = ['colour-live', 'colour-off'];
    const slots = {
      accessory: 'disclosure' as const,
      subtitle: 'A supporting line',
      systemImage: SYMBOL,
      title: 'Notifications',
      value: 'On',
    };
    await render(
      <View style={columnStyle}>
        <ListItem
          {...slots}
          androidIcon={SLAB}
          hybridRef={captureItem('colour-live')}
          testID="colour-live"
        />
        <ListItem
          {...slots}
          androidIcon={SLAB}
          disabled
          hybridRef={captureItem('colour-off')}
          testID="colour-off"
        />
      </View>,
      { timeout: 25000 }
    );
    await settleEach(ids);

    const live = coloursOf('colour-live');
    const off = coloursOf('colour-off');
    console.log(
      `list-item colours:\n  enabled:  ${JSON.stringify(live)}\n  disabled: ${JSON.stringify(off)}`
    );
    for (const id of ids) {
      expect(Object.keys(coloursOf(id)).sort()).toEqual(
        ['chevron', 'image', 'secondary', 'text', 'value'].sort()
      );
    }

    // The three slots every platform owns: same colour family, less alpha. A `pending`
    // slot fails here too.
    for (const slot of ['text', 'secondary', 'value']) {
      const before = alphaOf(live[slot]);
      const after = alphaOf(off[slot]);
      expect({ slot, before, after }).toEqual(
        expect.objectContaining({ slot })
      );
      if (before == null || after == null) {
        throw new Error(
          `slot "${slot}" is not a colour on both rows: enabled=${String(
            live[slot]
          )} disabled=${String(off[slot])}.`
        );
      }
      expect(after).toBeLessThan(before);
    }

    // iOS leaves the symbol's tint to UIKit when the row is enabled and so answers `unset`;
    // Android resolves Material's leading-content colour either way. On both, disabling
    // the row has to change its glyph.
    if (alphaOf(live.image) == null) {
      expect(alphaOf(off.image)).not.toBeNull();
    } else {
      const before = alphaOf(live.image) as number;
      const after = alphaOf(off.image) as number;
      expect(after).toBeLessThan(before);
    }

    // UIKit's disclosure indicator is `.tertiaryLabel`, already the row's disabled grey, so
    // iOS cannot grey it further. Android takes the trailing icon's colour from Material,
    // which does dim it.
    const liveChevron = alphaOf(live.chevron);
    const offChevron = alphaOf(off.chevron);
    if (liveChevron != null && offChevron != null) {
      if (Platform.OS === 'ios') {
        expect(offChevron).toBe(liveChevron);
      } else {
        expect(offChevron).toBeLessThan(liveChevron);
      }
    }
  });
});
