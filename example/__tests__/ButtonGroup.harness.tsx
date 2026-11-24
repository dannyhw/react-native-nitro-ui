import { useState } from 'react';
import { Platform, View, processColor } from 'react-native';
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
  ButtonGroup,
  nitroUiCore,
  type ButtonGroupItem,
} from 'react-native-nitro-ui';

const COMPONENT = 'NitroUiButtonGroup';

type ViewInfo = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const { TurboModuleRegistry } = require('react-native');
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

type ButtonGroupHandle = {
  readonly accessibilityLabel: string | null;
  readonly items: { readonly id: string; readonly title: string }[];
  readonly appearance: string;
  readonly checkedIds: string[];
  readonly controlledIds: string[];
  measureContent(): Size;
  nuiTestPressItem(id: string): void;
  nuiTestOpenOverflow(): void;
  nuiTestProbeRow(): void;
  nuiTestProbeAccessibility(): void;
  nuiTestStateReport(): string;
  nuiTestPixelProbe(color: number): void;
  nuiTestPixelReport(): string;
};

const handles = new Map<string, ButtonGroupHandle>();
const captureHybrid =
  (testId: string) =>
  (view: ButtonGroupHandle): void => {
    handles.set(testId, view);
  };

/** Every event the app was told, in order, as `testID:id[:checked]`. */
const events: string[] = [];
const recordPress =
  (testId: string) =>
  (id: string): void => {
    events.push(`${testId}:press:${id}`);
  };
const recordChecked =
  (testId: string) =>
  (id: string, checked: boolean): void => {
    events.push(`${testId}:check:${id}:${String(checked)}`);
  };

const checkedSetters = new Map<string, (next: string[]) => void>();
const disabledSetters = new Map<string, (next: boolean) => void>();

/** Three short titles: a row that fits a phone's width with no overflow. */
const ACTIONS: ButtonGroupItem[] = [
  { id: 'copy', title: 'Copy' },
  { id: 'cut', title: 'Cut' },
  { id: 'paste', title: 'Paste' },
];

/** Six items that cannot share a 220-point well, nor a phone's full width. */
const MANY: ButtonGroupItem[] = [
  { id: 'day', title: 'Day' },
  { id: 'week', title: 'Week' },
  { id: 'month', title: 'Month' },
  { id: 'quarter', title: 'Quarter' },
  { id: 'year', title: 'Year' },
  { id: 'all', title: 'All time' },
];

/** Must match the sizing key `ButtonGroup.tsx` builds. */
function sizingKey(
  appearance: string,
  variant: string,
  size: string,
  labelStyle: string,
  items: readonly ButtonGroupItem[]
): string {
  const parts = [appearance, variant, size, labelStyle, String(items.length)];
  for (const item of items) {
    parts.push(
      item.toggle === true ? 't' : 'a',
      item.title,
      item.systemImage ?? '',
      harnessIconName(item.androidIcon)
    );
  }
  return parts.join('|');
}

// A `require()`d icon reaches the sizing key as a name the bundler derived, which
// this cannot reproduce, so fixtures must name a drawable as a plain string.
function harnessIconName(icon: ButtonGroupItem['androidIcon']): string {
  if (icon == null) {
    return '';
  }
  if (typeof icon !== 'string') {
    throw new Error(
      'A ButtonGroup harness fixture must name androidIcon as a resource string.'
    );
  }
  return icon;
}

// A size no ButtonGroup has, seeded before a mount so that a missing size
// correction leaves a visibly wrong box.
const WRONG_HEIGHT = 99;
const WRONG_WIDTH = 37;

function sizeOf(testId: string): Size | null {
  return harnessUi.queryByTestId(testId);
}

function measured(testId: string): Size | null {
  return handles.get(testId)?.measureContent() ?? null;
}

function describeSize(size: Size | null): string {
  return size == null
    ? 'null'
    : `${size.width.toFixed(2)}x${size.height.toFixed(2)}`;
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

function handleOf(testId: string): ButtonGroupHandle {
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

// `a11y` is the last field and carries `;` inside its own value, so the split
// stops there.
function reportOf(testId: string): Record<string, string> {
  const text = handles.get(testId)?.nuiTestStateReport() ?? '';
  const fields: Record<string, string> = {};
  const at = text.indexOf(';a11y=');
  const head = at < 0 ? text : text.slice(0, at);
  for (const pair of head.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  if (at >= 0) fields.a11y = text.slice(at + ';a11y='.length);
  return fields;
}

// Waits for the probe count to rise, so the answer is this probe's and not the
// previous one's.
async function probeRow(testId: string): Promise<Record<string, string>> {
  const handle = handleOf(testId);
  const before = Number(reportOf(testId).probes ?? '0');
  handle.nuiTestProbeRow();
  return pollUntil(
    () =>
      Number(reportOf(testId).probes ?? '0') > before ? reportOf(testId) : null,
    () => new Error(`"${testId}" never answered a row-layout probe.`),
    10000
  );
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
    () => new Error(`"${testId}" never answered an accessibility probe.`),
    10000
  );
}

const EVENT_QUIET_MS = 400;

/** The mid-grey the Android sampler paints behind the control it draws. */
const BACKDROP = '#808080';

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

/** How many pixels the sampled box covers, from the same report line. */
function sampledArea(report: string): number {
  const size = / size=(\d+)x(\d+)/.exec(report);
  return size == null ? 0 : Number(size[1]) * Number(size[2]);
}

/** The colour on screen that sits nearest the one the probe asked for. */
function closestOf(report: string): string {
  return / closest=(#[0-9A-Fa-f]{6})/.exec(report)?.[1]?.toUpperCase() ?? '';
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

/** Within what Yoga rounds to. */
function sameSize(a: Size | null, b: Size | null): boolean {
  return (
    a != null &&
    b != null &&
    Math.abs(a.width - b.width) < 0.6 &&
    Math.abs(a.height - b.height) < 0.6
  );
}

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
  // A quiet period, so a surplus event (a control firing twice per tap) is seen.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/**
 * Presses an item through its own tap handler, because the harness cannot tap one:
 * SwiftUI's button gesture refuses the harness's synthetic touch on iOS, and on
 * Android a Compose item is not a View the harness can find.
 */
async function pressItem(testId: string, id: string): Promise<void> {
  handleOf(testId).nuiTestPressItem(id);
  // Android posts the press to the UI thread.
  await sleep(50);
}

function poison(keys: readonly string[]): void {
  for (const key of keys) {
    nitroUiCore.seedSizingSize(COMPONENT, key, WRONG_WIDTH, WRONG_HEIGHT);
  }
  nitroUiCore.invalidateSizingEnvironment();
}

function Controlled({
  testId,
  items,
  initialChecked,
  initialDisabled = false,
  refuse = false,
}: {
  testId: string;
  items: ButtonGroupItem[];
  initialChecked: string[];
  initialDisabled?: boolean;
  refuse?: boolean;
}) {
  const [checked, setChecked] = useState<string[]>(initialChecked);
  const [disabled, setDisabled] = useState(initialDisabled);
  checkedSetters.set(testId, setChecked);
  disabledSetters.set(testId, setDisabled);
  return (
    <ButtonGroup
      items={items.map((item) => ({
        ...item,
        checked: checked.indexOf(item.id) >= 0,
      }))}
      disabled={disabled}
      onCheckedChange={(id, next) => {
        recordChecked(testId)(id, next);
        if (!refuse) {
          setChecked((current) =>
            next
              ? [...new Set([...current, id])]
              : current.filter((existing) => existing !== id)
          );
        }
      }}
      onPress={recordPress(testId)}
      testID={testId}
      hybridRef={captureHybrid(testId)}
    />
  );
}

const WELL = { width: 220 } as const;

afterEach(() => {
  cleanup();
  handles.clear();
  checkedSetters.clear();
  disabledSetters.clear();
  events.length = 0;
});

describe('ButtonGroup · G20', () => {
  it('moves the items a 220-point well cannot hold, and takes some back when it grows', async () => {
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', MANY)]);
    const { rerender } = await render(
      <View style={WELL}>
        <ButtonGroup
          items={MANY}
          testID="bg-narrow"
          hybridRef={captureHybrid('bg-narrow')}
        />
      </View>
    );
    await waitForTestId('bg-narrow');
    const narrowBox = sizeOf('bg-narrow');
    expect(narrowBox != null).toBe(true);
    expect(narrowBox!.width).toBeLessThan(300);

    const narrow = await probeRow('bg-narrow');
    expect(Number(narrow.visible)).toBeLessThan(MANY.length);
    expect(narrow.overflow).toBe('1');
    expect((narrow.shown ?? 'none').split(',')).not.toContain('all');

    await rerender(
      <View style={{ width: '100%' }}>
        <ButtonGroup
          items={MANY}
          testID="bg-narrow"
          hybridRef={captureHybrid('bg-narrow')}
        />
      </View>
    );
    // The report holds the last probed layout, so each attempt probes again.
    let wide: Record<string, string> | null = null;
    for (let attempt = 0; attempt < 40 && wide == null; attempt += 1) {
      await sleep(100);
      const probed = await probeRow('bg-narrow');
      if (Number(probed.visible) > Number(narrow.visible)) {
        wide = probed;
      }
    }
    if (wide == null) {
      throw new Error(
        `widening the well from 220 pt brought no more of the ${String(
          MANY.length
        )} items into the row - the row reports "${handles
          .get('bg-narrow')!
          .nuiTestStateReport()}".`
      );
    }
    const narrowShown = (narrow.shown ?? 'none').split(',');
    const wideShown = (wide.shown ?? 'none').split(',');
    expect(wideShown.length).toBeGreaterThan(narrowShown.length);
    expect(
      wideShown.filter((id) => !narrowShown.includes(id)).length
    ).toBeGreaterThan(0);

    await render(
      <ButtonGroup
        items={ACTIONS}
        testID="bg-fits"
        hybridRef={captureHybrid('bg-fits')}
      />
    );
    await waitForTestId('bg-fits');
    const fits = await probeRow('bg-fits');
    expect(fits.visible).toBe(String(ACTIONS.length));
    expect(fits.overflow).toBe('0');
    expect((fits.shown ?? 'none').split(',')).toEqual(
      ACTIONS.map((item) => item.id)
    );
  });

  it('keeps one row when the trailing toggle of a connected group overflows', async () => {
    // On iOS a connected group with a toggle draws the standard bordered row, because
    // `ControlGroup` shows no on state. That holds for the whole group, even when the
    // toggle itself has overflowed, so the row height is the same at every width.
    const items: ButtonGroupItem[] = MANY.map((item, index) =>
      index === MANY.length - 1
        ? { ...item, toggle: true, defaultChecked: true }
        : item
    );
    const LAST = MANY[MANY.length - 1]!.id;
    poison([sizingKey('connected', 'filled', 'medium', 'automatic', items)]);
    const { rerender } = await render(
      <View style={WELL}>
        <ButtonGroup
          items={items}
          appearance="connected"
          testID="bg-connected"
          hybridRef={captureHybrid('bg-connected')}
        />
      </View>
    );
    await waitForTestId('bg-connected');
    const narrowMeasured = await waitForMeasured(
      'bg-connected',
      'the connected group in the well'
    );
    const narrow = await probeRow('bg-connected');
    expect(narrow.overflow).toBe('1');
    expect((narrow.shown ?? 'none').split(',')).not.toContain(LAST);
    expect(narrow.row).toBe('standard');
    const narrowShown = (narrow.shown ?? 'none').split(',');
    const narrowHeight = narrowMeasured.height;

    await rerender(
      <View style={{ width: '100%' }}>
        <ButtonGroup
          items={items}
          appearance="connected"
          testID="bg-connected"
          hybridRef={captureHybrid('bg-connected')}
        />
      </View>
    );
    // The report holds the last probed layout, so each attempt probes again.
    let wide: Record<string, string> | null = null;
    for (let attempt = 0; attempt < 40 && wide == null; attempt += 1) {
      await sleep(100);
      const probed = await probeRow('bg-connected');
      if ((probed.shown ?? 'none').split(',').length > narrowShown.length) {
        wide = probed;
      }
    }
    if (wide == null) {
      throw new Error(
        'widening the well brought no more items into the connected row, so the ' +
          'heights below still describe the narrow layout: ' +
          JSON.stringify(handleOf('bg-connected').nuiTestStateReport())
      );
    }
    expect(wide.row).toBe('standard');
    const wideMeasured = await waitForMeasured(
      'bg-connected',
      'the connected group across the screen'
    );
    expect(wideMeasured.height).toBeCloseTo(narrowHeight, 1);
    expect(wideMeasured.height).not.toBeCloseTo(WRONG_HEIGHT, 0);
  });

  it('presses once per item, from the row and from the overflow menu', async () => {
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', MANY)]);
    await render(
      <View style={WELL}>
        <ButtonGroup
          items={MANY}
          onPress={recordPress('bg-press')}
          testID="bg-press"
          hybridRef={captureHybrid('bg-press')}
        />
      </View>
    );
    await waitForTestId('bg-press');
    const row = await probeRow('bg-press');
    const visible = (row.shown ?? 'none').split(',');
    const hidden = MANY.map((item) => item.id).filter(
      (id) => !visible.includes(id)
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThan(0);

    const from = events.length;
    await pressItem('bg-press', visible[0]!);
    expect(await waitForEvents(from, [`bg-press:press:${visible[0]}`])).toEqual(
      [`bg-press:press:${visible[0]}`]
    );

    const fromMenu = events.length;
    handleOf('bg-press').nuiTestPressItem(hidden[0]!);
    expect(
      await waitForEvents(fromMenu, [`bg-press:press:${hidden[0]}`])
    ).toEqual([`bg-press:press:${hidden[0]}`]);
  });

  it('flips a toggle once per tap, and reverts one its parent refused', async () => {
    const items: ButtonGroupItem[] = [
      { id: 'bold', title: 'Bold', toggle: true },
      { id: 'italic', title: 'Italic', toggle: true },
    ];
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', items)]);
    await render(
      <Controlled testId="bg-toggle" items={items} initialChecked={['bold']} />
    );
    await waitForTestId('bg-toggle');
    await waitForMeasured('bg-toggle', 'the toggle row');
    expect(reportOf('bg-toggle').checked).toBe('bold');

    const from = events.length;
    await pressItem('bg-toggle', 'italic');
    expect(await waitForEvents(from, ['bg-toggle:check:italic:true'])).toEqual([
      'bg-toggle:check:italic:true',
    ]);
    await pollUntil(
      () => (reportOf('bg-toggle').checked === 'bold,italic' ? true : null),
      () =>
        new Error(
          `the accepted flip never reached the row - it reports "${handleOf(
            'bg-toggle'
          ).nuiTestStateReport()}".`
        )
    );

    // Two taps: a control that had kept the refused change would ask for `false`
    // on the second one.
    const refused = events.length;
    await render(
      <Controlled
        testId="bg-refused"
        items={items}
        initialChecked={['bold']}
        refuse
      />
    );
    await waitForTestId('bg-refused');
    await waitForMeasured('bg-refused', 'the refusing row');
    for (const tap of [1, 2]) {
      const at = events.length;
      await pressItem('bg-refused', 'italic');
      expect(
        await waitForEvents(at, ['bg-refused:check:italic:true']),
        `refused tap ${String(tap)}`
      ).toEqual(['bg-refused:check:italic:true']);
      await sleep(400);
      expect(
        reportOf('bg-refused').checked,
        `the refused item snapped back after tap ${String(tap)}`
      ).toBe('bold');
    }
    expect(events.slice(refused).length).toBe(2);
  });

  it('seeds an uncontrolled item once, and never lets a re-render undo a tap', async () => {
    const items: ButtonGroupItem[] = [
      { id: 'bold', title: 'Bold', toggle: true, defaultChecked: true },
    ];
    const [first] = items;
    const { rerender } = await render(
      <ButtonGroup
        items={items}
        onCheckedChange={recordChecked('bg-seed')}
        testID="bg-seed"
        hybridRef={captureHybrid('bg-seed')}
      />
    );
    await waitForTestId('bg-seed');
    await waitForMeasured('bg-seed', 'the seeded row');
    expect(reportOf('bg-seed').checked).toBe('bold');

    const from = events.length;
    await pressItem('bg-seed', 'bold');
    expect(await waitForEvents(from, ['bg-seed:check:bold:false'])).toEqual([
      'bg-seed:check:bold:false',
    ]);

    // The second item changes the items signature. An identical array is served
    // from the wrapper's cache and nothing would be re-sent to native, so the native
    // guard against re-seeding would not be exercised.
    await rerender(
      <ButtonGroup
        items={[{ ...first! }, { id: 'italic', title: 'Italic' }]}
        onCheckedChange={recordChecked('bg-seed')}
        testID="bg-seed"
        hybridRef={captureHybrid('bg-seed')}
      />
    );
    await sleep(400);
    expect(handleOf('bg-seed').nuiTestStateReport()).toContain('checked=none');
  });

  it('takes nothing from a disabled group or a disabled item, and closes an open menu', async () => {
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', MANY)]);
    await render(
      <View style={WELL}>
        <Controlled
          testId="bg-disabled-group"
          items={MANY}
          initialChecked={[]}
          initialDisabled
        />
      </View>
    );
    await waitForTestId('bg-disabled-group');
    await waitForMeasured('bg-disabled-group', 'the disabled group');

    // Every id is pressed, drawn or overflowed: the row and the menu must both refuse.
    const report = await probeRow('bg-disabled-group');
    const shown = (report.shown ?? 'none').split(',');
    const all = MANY.map((item) => item.id);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(MANY.length);
    const from = events.length;
    const pressed = all;
    expect(pressed.length).toBe(MANY.length);
    for (const entry of pressed) {
      handleOf('bg-disabled-group').nuiTestPressItem(entry);
    }
    await sleep(EVENT_QUIET_MS);
    expect(events.slice(from)).toEqual([]);

    await render(
      <ButtonGroup
        items={ACTIONS.map((item) => ({
          ...item,
          disabled: item.id === 'cut',
        }))}
        onPress={recordPress('bg-disabled-item')}
        testID="bg-disabled-item"
        hybridRef={captureHybrid('bg-disabled-item')}
      />
    );
    await waitForTestId('bg-disabled-item');
    const itemFrom = events.length;
    handleOf('bg-disabled-item').nuiTestPressItem('cut');
    await sleep(EVENT_QUIET_MS);
    expect(events.slice(itemFrom)).toEqual([]);
    handleOf('bg-disabled-item').nuiTestPressItem('copy');
    expect(
      await waitForEvents(itemFrom, ['bg-disabled-item:press:copy'])
    ).toEqual(['bg-disabled-item:press:copy']);

    // Android opens the menu first and expects it closed. A SwiftUI `Menu` cannot be
    // opened from code before iOS 18, so iOS checks that the overflow control is
    // composed before the disable and gone after it.
    await render(
      <View style={WELL}>
        <Controlled testId="bg-close" items={MANY} initialChecked={[]} />
      </View>
    );
    await waitForTestId('bg-close');
    await waitForMeasured('bg-close', 'the group whose menu closes');
    expect((await probeRow('bg-close')).overflow).toBe('1');

    if (Platform.OS === 'android') {
      handleOf('bg-close').nuiTestOpenOverflow();
      await pollUntil(
        () => (reportOf('bg-close').menu === 'open' ? 'open' : null),
        () =>
          new Error(
            'the overflow menu never reported itself open, so the close below would ' +
              `prove nothing (menu="${String(reportOf('bg-close').menu)}").`
          ),
        6000
      );
    } else {
      expect(reportOf('bg-close').menu).toBe('composed');
    }

    disabledSetters.get('bg-close')!(true);
    const gone = Platform.OS === 'android' ? 'closed' : 'none';
    await pollUntil(
      () => {
        const menu = reportOf('bg-close').menu;
        return menu === gone ? (menu ?? '') : null;
      },
      () =>
        new Error(
          `disabling the group left its overflow menu reporting menu="${String(
            reportOf('bg-close').menu
          )}" (expected "${gone}" on this platform).`
        ),
      6000
    );
  });

  it('keeps the same items in its row when it is disabled', async () => {
    // Android's overflow indicator belongs to Material's `ButtonGroup` and is drawn whatever
    // the group's state. On iOS this library composes the row itself, so a disabled group has
    // to keep the control's room in it to fit what it fits enabled.
    if (Platform.OS !== 'ios') return;
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', MANY)]);
    await render(
      <View style={WELL}>
        <Controlled testId="bg-keep-row" items={MANY} initialChecked={[]} />
      </View>
    );
    await waitForTestId('bg-keep-row');
    await waitForMeasured('bg-keep-row', 'the overflowing group, enabled');

    /** The furthest right anything was drawn inside the group's box, in points. */
    function rightmostInk(row: Record<string, string>): number {
      let right = 0;
      for (const run of (row.ink ?? 'none').split('|')) {
        const bounds = /^([\d.]+)~([\d.]+)$/.exec(run);
        if (bounds != null) right = Math.max(right, Number(bounds[2]));
      }
      return right;
    }

    function describeRow(row: Record<string, string>): string {
      return (
        `visible=${row.visible ?? 'none'} shown=${row.shown ?? 'none'} ` +
        `overflow=${row.overflow ?? 'none'} ink=${row.ink ?? 'none'}`
      );
    }

    /** Probe until the row has placed something: a host mounted moments ago may not have
     * laid its own row out yet. */
    async function probePlacedRow(
      testId: string
    ): Promise<Record<string, string>> {
      let row = await probeRow(testId);
      for (
        let attempt = 0;
        attempt < 30 && (row.visible ?? 'none') === 'none';
        attempt += 1
      ) {
        await sleep(100);
        row = await probeRow(testId);
      }
      return row;
    }

    /**
     * Disable or enable the group and read the row once its overflow control has answered for
     * that state. The control answers from the row's own placement, so the answer arriving is the
     * row having laid itself out in that state; only then is the row probed, because a probe
     * publishes the placement of the moment it runs.
     */
    async function rowWhenDisabled(
      disabled: boolean
    ): Promise<Record<string, string>> {
      const wanted = disabled ? 'none' : 'composed';
      disabledSetters.get('bg-keep-row')!(disabled);
      const state = `the group ${disabled ? 'disabled' : 'enabled'}`;
      await pollUntil(
        () => (reportOf('bg-keep-row').menu === wanted ? true : null),
        () =>
          new Error(
            `"bg-keep-row" never reported its overflow control "${wanted}" with ${state} ` +
              `- it reports "${handleOf('bg-keep-row').nuiTestStateReport()}".`
          ),
        8000
      );
      return await probeRow('bg-keep-row');
    }

    const enabled = await probeRow('bg-keep-row');
    expect(Number(enabled.visible)).toBeGreaterThan(0);
    expect(Number(enabled.visible)).toBeLessThan(MANY.length);
    expect(enabled.overflow).toBe('1');
    expect(enabled.menu).toBe('composed');

    const disabled = await rowWhenDisabled(true);
    expect(
      disabled.overflow,
      `disabling the group took its overflow control out of the row, which is how the row ` +
        `below fits more items - enabled "${describeRow(enabled)}", disabled ` +
        `"${describeRow(disabled)}".`
    ).toBe('1');
    expect(
      disabled.visible,
      `disabling the group changed which items fit its row - enabled ` +
        `"${describeRow(enabled)}", disabled "${describeRow(disabled)}".`
    ).toBe(enabled.visible);
    expect(
      disabled.shown,
      `the same items must be drawn in the same order.`
    ).toBe(enabled.shown);
    expect(
      disabled.menu,
      `a disabled group must keep no control that can present a menu - it reports ` +
        `"${describeRow(disabled)}".`
    ).toBe('none');

    // Every id, drawn or overflowed: a disabled group answers to none of them.
    const from = events.length;
    for (const item of MANY) {
      handleOf('bg-keep-row').nuiTestPressItem(item.id);
    }
    await sleep(EVENT_QUIET_MS);
    expect(events.slice(from)).toEqual([]);

    const enabledAgain = await rowWhenDisabled(false);
    expect(
      enabledAgain.visible,
      `enabling the group again did not give back the row it started with - ` +
        `"${describeRow(enabled)}" before, "${describeRow(enabledAgain)}" after.`
    ).toBe(enabled.visible);
    expect(enabledAgain.shown, `and the same items in the same order.`).toBe(
      enabled.shown
    );

    // The row is not only reported the same: its drawing ends where it ended, so the overflow
    // control is drawn in the disabled row too, and not merely counted. A dimmed glyph is
    // anti-aliased a hair narrower than a live one.
    const drift = Math.abs(rightmostInk(disabled) - rightmostInk(enabled));
    expect(
      drift,
      `the disabled row draws its furthest ink ${drift.toFixed(2)} pt away from the enabled ` +
        `row's - enabled "${describeRow(enabled)}", disabled "${describeRow(disabled)}".`
    ).toBeLessThanOrEqual(2);

    // The same row reached two ways: mounted disabled beside the group that was enabled
    // throughout, rather than only flipped into that state.
    await render(
      <View style={WELL}>
        <Controlled testId="bg-twin-on" items={MANY} initialChecked={[]} />
        <Controlled
          testId="bg-twin-off"
          items={MANY}
          initialChecked={[]}
          initialDisabled
        />
      </View>
    );
    await waitForTestId('bg-twin-on');
    await waitForTestId('bg-twin-off');
    await waitForMeasured('bg-twin-on', 'the enabled twin');
    await waitForMeasured('bg-twin-off', 'the disabled twin');
    const twinOn = await probePlacedRow('bg-twin-on');
    const twinOff = await probePlacedRow('bg-twin-off');
    expect(
      twinOff.visible,
      `a group mounted disabled holds a different row from its enabled twin - enabled ` +
        `"${describeRow(twinOn)}", disabled "${describeRow(twinOff)}".`
    ).toBe(twinOn.visible);
    expect(twinOff.shown, `and the same items in the same order.`).toBe(
      twinOn.shown
    );
    expect(
      twinOff.overflow,
      `and an overflow control drawn where it is drawn.`
    ).toBe('1');
    expect(twinOff.menu, `and nothing that can present a menu.`).toBe('none');
  });

  it('names every item kind, and an icon-only item by its title', async () => {
    const items: ButtonGroupItem[] = [
      // Has a glyph: drawn icon-only, the title becomes the description.
      {
        id: 'copy',
        title: 'Copy',
        systemImage: 'doc.on.doc',
        androidIcon: 'nitroui_test_star',
      },
      // No glyph: the title is drawn as text and there is no description.
      { id: 'paste', title: 'Paste' },
      {
        id: 'bold',
        title: 'Bold',
        systemImage: 'textformat.size',
        androidIcon: 'nitroui_test_close',
        toggle: true,
      },
    ];
    await render(
      <ButtonGroup
        items={items}
        labelStyle="iconOnly"
        testID="bg-a11y"
        hybridRef={captureHybrid('bg-a11y')}
      />
    );
    await waitForTestId('bg-a11y');
    await waitForMeasured('bg-a11y', 'the icon-only row');
    const a11y = await probeAccessibility('bg-a11y');
    if (Platform.OS === 'ios') {
      // A hosted SwiftUI view exposes no accessibility elements to an in-process
      // caller, only to an accessibility client.
      expect(a11y).toBe('unavailable');
      return;
    }
    expect(a11y).toMatch(/text=none,desc=Copy/);
    expect(a11y).toMatch(/text=Paste,desc=none/);
    // Compose reports a toggle button's role as `Checkbox`.
    expect(a11y).toMatch(/\[Checkbox,[^;]*desc=Bold/);

    // With no `overflowAccessibilityLabel`, the overflow control keeps Material's own
    // localized name.
    const { rerender } = await render(
      <View style={WELL}>
        <ButtonGroup
          items={MANY}
          testID="bg-a11y-overflow"
          hybridRef={captureHybrid('bg-a11y-overflow')}
        />
      </View>
    );
    await waitForTestId('bg-a11y-overflow');
    await waitForMeasured('bg-a11y-overflow', 'the overflowing group');
    expect((await probeRow('bg-a11y-overflow')).overflow).toBe('1');
    const unnamed = await probeAccessibility('bg-a11y-overflow');
    expect(unnamed).toContain('More options');
    expect(unnamed).not.toContain('More More');

    await rerender(
      <View style={WELL}>
        <ButtonGroup
          items={MANY}
          overflowAccessibilityLabel="Overflow"
          testID="bg-a11y-overflow"
          hybridRef={captureHybrid('bg-a11y-overflow')}
        />
      </View>
    );
    let renamed = 'none';
    for (
      let attempt = 0;
      attempt < 20 && !renamed.includes('desc=Overflow');
      attempt += 1
    ) {
      await sleep(100);
      renamed = await probeAccessibility('bg-a11y-overflow');
    }
    expect(renamed).toContain('desc=Overflow');
    expect(renamed).not.toContain('More options');
  });

  it('carries no items, checked state or event count across a remount', async () => {
    // The first mount checks two items and emits one flip, so its event count is 1.
    // The second is controlled, with the same ids unchecked and an event count of 0:
    // a recycled view that kept its count would ignore that write as stale.
    const seeded: ButtonGroupItem[] = MANY.map((item) =>
      item.id === 'day' || item.id === 'week'
        ? { ...item, toggle: true, defaultChecked: true }
        : { ...item, toggle: true }
    );
    const { unmount } = await render(
      <View style={WELL}>
        <ButtonGroup
          items={seeded}
          onCheckedChange={recordChecked('bg-recycle')}
          testID="bg-recycle"
          hybridRef={captureHybrid('bg-recycle')}
        />
      </View>
    );
    await waitForTestId('bg-recycle');
    await waitForMeasured('bg-recycle', 'the group before the recycle');
    const before = await probeRow('bg-recycle');
    expect(before.checked).toBe('day,week');
    expect(before.overflow).toBe('1');

    const from = events.length;
    await pressItem('bg-recycle', 'month');
    expect(await waitForEvents(from, ['bg-recycle:check:month:true'])).toEqual([
      'bg-recycle:check:month:true',
    ]);
    // The report lists the checked set in item order, not in the order they were set.
    expect(reportOf('bg-recycle').checked).toBe('day,week,month');

    unmount();
    await sleep(400);
    events.length = 0;

    await render(
      <ButtonGroup
        items={seeded.slice(0, 2).map((item) => ({
          ...item,
          defaultChecked: undefined,
          checked: false,
        }))}
        onCheckedChange={recordChecked('bg-recycle')}
        testID="bg-recycle"
        hybridRef={captureHybrid('bg-recycle')}
      />
    );
    await waitForTestId('bg-recycle');
    // A recycled host may answer a probe before it has laid out its own row.
    let fresh: Record<string, string> | null = null;
    for (let attempt = 0; attempt < 30 && fresh == null; attempt += 1) {
      const probed = await probeRow('bg-recycle');
      if (probed.visible === '2') {
        fresh = probed;
      } else {
        await sleep(100);
      }
    }
    if (fresh == null) {
      throw new Error(
        `the remount never laid out its own two items - it reports "${handleOf(
          'bg-recycle'
        ).nuiTestStateReport()}".`
      );
    }
    expect(fresh.checked).toBe('none');
    expect(fresh.shown).toBe('day,week');
    expect(fresh.overflow).toBe('0');
    // `menu` is the menu's open state on Android; on iOS it is whether the row composes an
    // overflow control that can present its menu.
    expect(fresh.menu).toBe(Platform.OS === 'android' ? 'closed' : 'none');
    await sleep(EVENT_QUIET_MS);
    expect(events).toEqual([]);
  });
});

/** The colour no scheme uses, so a pixel matching it was painted by the app's `tintColor`. */
const TINT = '#E01B24';

describe('ButtonGroup · the overflow row glyphs (G21, Android)', () => {
  /**
   * The tail of this row cannot fit a 220-point well, and the tail carries both an item with a
   * glyph and one without: the rows that draw are the ones this reads.
   */
  const ICONED: ButtonGroupItem[] = [
    { id: 'day', title: 'Day' },
    { id: 'week', title: 'Week' },
    { id: 'month', title: 'Month' },
    { id: 'quarter', title: 'Quarter', androidIcon: 'nitroui_test_star' },
    { id: 'year', title: 'Year' },
    { id: 'all', title: 'All time', androidIcon: 'nitroui_test_close' },
  ];

  const glyphOf = (id: string): ButtonGroupItem['androidIcon'] =>
    ICONED.find((item) => item.id === id)?.androidIcon;

  /** Open the overflow the way the indicator's tap does, and wait for the rows to draw. */
  async function openOverflow(testId: string): Promise<void> {
    handleOf(testId).nuiTestOpenOverflow();
    await pollUntil(
      () => (reportOf(testId).menu === 'open' ? true : null),
      () =>
        new Error(
          `"${testId}" never opened its overflow menu - it reports "${handleOf(
            testId
          ).nuiTestStateReport()}".`
        ),
      8000
    );
    // The menu state flips before the popup composes its rows.
    await sleep(250);
  }

  /** The rows that drew a glyph, as `id` to the colour it drew it with. */
  function glyphRows(testId: string): Map<string, string> {
    const rows = new Map<string, string>();
    const raw = reportOf(testId).overflowIcons ?? '';
    for (const pair of raw.split(',')) {
      const at = pair.indexOf('#');
      if (at > 0) rows.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return rows;
  }

  it('draws an overflowed item its glyph, and nothing for an item without one', async () => {
    if (Platform.OS === 'ios') return;
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', ICONED)]);
    await render(
      <View style={WELL}>
        <ButtonGroup
          items={ICONED}
          testID="bg-menu-icons"
          hybridRef={captureHybrid('bg-menu-icons')}
        />
      </View>
    );
    await waitForTestId('bg-menu-icons');
    const row = await probeRow('bg-menu-icons');
    const shown = (row.shown ?? 'none').split(',');
    const hidden = ICONED.map((item) => item.id).filter(
      (id) => !shown.includes(id)
    );
    const withGlyph = hidden.filter((id) => glyphOf(id) != null);
    const withoutGlyph = hidden.filter((id) => glyphOf(id) == null);
    if (withGlyph.length === 0 || withoutGlyph.length === 0) {
      throw new Error(
        `the overflowed items must hold both kinds: with a glyph ` +
          `${JSON.stringify(withGlyph)}, without ` +
          `${JSON.stringify(withoutGlyph)} (shown: ${JSON.stringify(shown)}).`
      );
    }

    await openOverflow('bg-menu-icons');
    const drew = await pollUntil(
      () => {
        const rows = glyphRows('bg-menu-icons');
        return rows.size > 0 ? rows : null;
      },
      () =>
        new Error(
          `no overflow row drew a glyph while the menu was open - it reports ` +
            `"${handleOf('bg-menu-icons').nuiTestStateReport()}".`
        ),
      8000
    );
    for (const id of withGlyph) {
      const tint = drew.get(id);
      if (tint == null || !/^[0-9A-F]{6}$/.test(tint)) {
        throw new Error(
          `the overflow row for "${id}" (androidIcon ` +
            `"${String(glyphOf(id))}") drew no glyph, or drew one with no colour: ` +
            `"${String(tint)}" in "${handleOf(
              'bg-menu-icons'
            ).nuiTestStateReport()}".`
        );
      }
    }
    for (const id of withoutGlyph) {
      if (drew.has(id)) {
        throw new Error(
          `the overflow row for "${id}" has no androidIcon and drew a glyph in ` +
            `"${String(drew.get(id))}" anyway.`
        );
      }
    }
  });

  /**
   * A row records a glyph only as it composes, so this group is mounted with `titleOnly` from the
   * start: a popup opened on a group that was rerendered keeps the rows it had already composed.
   */
  it('keeps menu rows glyph-free under labelStyle="titleOnly"', async () => {
    if (Platform.OS === 'ios') return;
    poison([sizingKey('standard', 'filled', 'medium', 'titleOnly', ICONED)]);
    await render(
      <View style={WELL}>
        <ButtonGroup
          items={ICONED}
          labelStyle="titleOnly"
          testID="bg-menu-title-only"
          hybridRef={captureHybrid('bg-menu-title-only')}
        />
      </View>
    );
    await waitForTestId('bg-menu-title-only');
    const row = await probeRow('bg-menu-title-only');
    const shown = (row.shown ?? 'none').split(',');
    const withGlyph = ICONED.map((item) => item.id)
      .filter((id) => !shown.includes(id))
      .filter((id) => glyphOf(id) != null);
    if (withGlyph.length === 0) {
      throw new Error(
        `the overflowed items must hold one with a glyph to take away, and ` +
          `"bg-menu-title-only" shows ${JSON.stringify(shown)} - the fixture proves nothing.`
      );
    }

    await openOverflow('bg-menu-title-only');
    await sleep(EVENT_QUIET_MS);
    if (glyphRows('bg-menu-title-only').size > 0) {
      throw new Error(
        `with labelStyle="titleOnly" an overflow row still drew a glyph: ` +
          `"${handleOf('bg-menu-title-only').nuiTestStateReport()}".`
      );
    }
  });
});

describe('ButtonGroup · the toggle variant drawing (G20, iOS)', () => {
  const VARIANTS = ['filled', 'elevated', 'tonal', 'outlined', 'text'] as const;

  /**
   * Narrow enough that a one-item row's box is the item's own: the measured shares are then the
   * item's, not the page's.
   */
  const ITEM_WELL = { width: 96 } as const;

  /**
   * One item, one way. Each is drawn in a group of its own, because the measured box is the
   * control's: a row of two items would report the two drawings added together.
   */
  type Role = 'action' | 'on' | 'off' | 'disabled' | 'disabledAction';

  const ROLES: readonly Role[] = [
    'action',
    'on',
    'off',
    'disabled',
    'disabledAction',
  ];

  function soloItems(role: Role): ButtonGroupItem[] {
    if (role === 'action') return [{ id: 'bold', title: 'Bold' }];
    if (role === 'disabledAction') {
      return [{ id: 'bold', title: 'Bold', disabled: true }];
    }
    if (role === 'disabled') {
      return [{ id: 'bold', title: 'Bold', toggle: true, disabled: true }];
    }
    return [
      {
        id: 'bold',
        title: 'Bold',
        toggle: true,
        defaultChecked: role === 'on' ? true : undefined,
      },
    ];
  }

  /** What the control's box measured at the last row probe: the share drawn at all, and the
   * share drawn in the group's own tint. */
  type Drawing = { fill: number; tint: number };

  async function drawingOf(testId: string, what: string): Promise<Drawing> {
    const probed = await probeRow(testId);
    const raw = probed.drawing ?? '';
    const fill = /,fill=(\d+)(?:,|$)/.exec(raw);
    const tint = /,tint=(\d+)(?:,|$)/.exec(raw);
    if (fill == null || tint == null) {
      throw new Error(
        `"${testId}" (${what}) reported no measured drawing: "${raw}".`
      );
    }
    return { fill: Number(fill[1]), tint: Number(tint[1]) };
  }

  /** How far two measured drawings may sit and still be called the same drawing. Two boxes drawn
   * by one style share every pixel but the anti-aliased ones, which is a point or two; the iOS
   * style families are tens of points apart. */
  const SAME_DRAWING = 6;

  /** How far a drawn item sits from a grey one. A grey label, which is what a disabled item is
   * drawn in, measures none of its ink in the group's colour; a label in the group's colour
   * measures most of it. Measured on the ink and not on the box because the roles compared here
   * are not always drawn in boxes of one size: a `text` group holding a toggle is measured at the
   * height of a capsule while its toggle draws a label alone. */
  const TINT_SEEN = 3;

  function sameDrawing(a: Drawing, b: Drawing): boolean {
    return (
      Math.abs(a.fill - b.fill) <= SAME_DRAWING &&
      Math.abs(a.tint - b.tint) <= SAME_DRAWING
    );
  }

  /** The share of what an item draws that is the group's colour. `fill` and `tint` are both
   * shares of the same sampled box, so their ratio says the same thing whatever size that box is. */
  function tintOfInk(drawing: Drawing): number {
    return drawing.fill === 0
      ? 0
      : Math.round((drawing.tint * 100) / drawing.fill);
  }

  it('draws an unchecked toggle in the group tint, one step below the checked one', async () => {
    if (Platform.OS !== 'ios') return;
    const read: Record<string, Record<Role, Drawing>> = {};
    for (const variant of VARIANTS) {
      read[variant] = {} as Record<Role, Drawing>;
      for (const role of ROLES) {
        const testId = `bg-${variant}-${role}`;
        await render(
          <View style={ITEM_WELL}>
            <ButtonGroup
              items={soloItems(role)}
              tintColor={TINT}
              variant={variant}
              testID={testId}
              hybridRef={captureHybrid(testId)}
            />
          </View>
        );
        await waitForTestId(testId);
        await waitForMeasured(testId, `the ${variant} ${role} group`);
        read[variant][role] = await drawingOf(testId, `${variant} ${role}`);
      }
    }

    const seen = VARIANTS.map(
      (variant) =>
        `${variant}: ` +
        ROLES.map(
          (role) => `${role}=${JSON.stringify(read[variant]![role])}`
        ).join(' ')
    ).join('; ');

    // Two drawings the mapping is written against: `.bordered` in the group's tint, which is what
    // a `tonal` action item draws, and `.borderedProminent` in it, which is what a `filled` one
    // draws. Every cell of the table is compared against one of these rather than a number.
    const quiet = read.tonal!.action;
    const loud = read.filled!.action;

    for (const variant of VARIANTS) {
      const { action, on, off, disabled, disabledAction } = read[variant]!;

      // Unchecked is never grey: what it draws is the group's own colour.
      if (tintOfInk(off) < TINT_SEEN) {
        throw new Error(
          `an unchecked "${variant}" toggle drew only ${tintOfInk(off)}% of the ink it ` +
            `draws in the group's tint, so it reads as a disabled item rather than as an ` +
            `unchecked one. ${seen}`
        );
      }
      // Unchecked draws the quiet drawing: the variant's own look for every variant but
      // `filled`/`elevated`, whose unchecked item drops the prominent fill.
      const offIs = variant === 'text' ? action : quiet;
      if (!sameDrawing(off, offIs)) {
        throw new Error(
          `an unchecked "${variant}" toggle drew ${JSON.stringify(off)} against ` +
            `the ${variant === 'text' ? 'variant' : 'quiet'} item's ` +
            `${JSON.stringify(offIs)}. ${seen}`
        );
      }
      // Checked is one step louder in the same family: the prominent capsule, except for
      // `text`, whose checked item takes the quiet capsule and keeps its tinted label.
      const onIs = variant === 'text' ? quiet : loud;
      if (!sameDrawing(on, onIs)) {
        throw new Error(
          `a checked "${variant}" toggle drew ${JSON.stringify(on)} against the ` +
            `${variant === 'text' ? 'quiet' : 'prominent'} item's ` +
            `${JSON.stringify(onIs)}. ${seen}`
        );
      }
      // In the group's own colour as well: against a capsule the fill on its own is the drawing
      // of any capsule, so a checked item that had lost the group's colour would still match the
      // item it is measured against.
      if (tintOfInk(on) < TINT_SEEN) {
        throw new Error(
          `a checked "${variant}" toggle drew only ${tintOfInk(on)}% of the ink it draws in ` +
            `the group's tint, so a checked item of any colour would match ` +
            `${JSON.stringify(onIs)}. ${seen}`
        );
      }
      if (sameDrawing(on, off)) {
        throw new Error(
          `a "${variant}" toggle draws the same thing checked (${JSON.stringify(on)}) ` +
            `and unchecked (${JSON.stringify(off)}). ${seen}`
        );
      }
      // A disabled item is the grey an unchecked item is not, and an unchecked item sits apart
      // from either of them by more than the read's noise: a toggle drawn in a disabled item's
      // colour is one no user can tell from a control that does nothing.
      if (tintOfInk(off) <= tintOfInk(disabled) + TINT_SEEN) {
        throw new Error(
          `an unchecked "${variant}" toggle (${JSON.stringify(off)}) draws like the ` +
            `disabled toggle beside it (${JSON.stringify(disabled)}). ${seen}`
        );
      }
      if (tintOfInk(off) <= tintOfInk(disabledAction) + TINT_SEEN) {
        throw new Error(
          `an unchecked "${variant}" toggle (${JSON.stringify(off)}) draws like the disabled ` +
            `action item beside it (${JSON.stringify(disabledAction)}). ${seen}`
        );
      }
      if (disabled.tint > SAME_DRAWING || disabledAction.tint > SAME_DRAWING) {
        throw new Error(
          `"${variant}" drew a disabled item in the group's tint (toggle ` +
            `${disabled.tint}%, action ${disabledAction.tint}%), so the read no longer ` +
            `tells a disabled item from an unchecked one. ${seen}`
        );
      }
    }

    // The read tells the three iOS style families apart, so the per-variant claims above say
    // something: only a prominent family paints its box in the tint, and only the two capsule
    // families paint a background at all.
    if (
      loud.tint < quiet.tint + 10 ||
      loud.fill < read.text!.action.fill + 20
    ) {
      throw new Error(
        `the measured read does not tell the three iOS style families apart - filled ` +
          `painted ${loud.tint}% in the tint and ${loud.fill}% of its box, tonal painted ` +
          `${quiet.tint}% in the tint, text painted ` +
          `${read.text!.action.fill}% of its box. ${seen}`
      );
    }
  });

  /**
   * What a control is drawn into and draws there: the height it measured and was laid out at, and
   * the drawing sampled inside its bounds. The two have to agree before either is read - a box
   * still at the size the sizing engine had for it describes a layout the control never agreed
   * to, and a box the control has not measured yet is not the one the drawing fills.
   */
  async function readBox(
    testId: string,
    what: string
  ): Promise<{ height: number; drawn: number; fill: number; tint: number }> {
    const deadline = nitroUiCore.now() + 10000;
    for (;;) {
      const raw = (await probeRow(testId)).drawing ?? '';
      const box = /^size=(\d+)x(\d+),/.exec(raw);
      const fill = /,fill=(\d+)(?:,|$)/.exec(raw);
      const tint = /,tint=(\d+)(?:,|$)/.exec(raw);
      const measuredSize = measured(testId);
      const boxSize = sizeOf(testId);
      if (
        box != null &&
        fill != null &&
        tint != null &&
        measuredSize != null &&
        boxSize != null &&
        Math.abs(Number(box[2]) - measuredSize.height) < 1 &&
        Math.abs(boxSize.height - measuredSize.height) < 1
      ) {
        return {
          height: measuredSize.height,
          drawn: Number(box[2]),
          fill: Number(fill[1]),
          tint: Number(tint[1]),
        };
      }
      if (nitroUiCore.now() > deadline) {
        throw new Error(
          `"${testId}" (${what}) is drawn into a box that never took the size it ` +
            `measured - laid out at ${describeSize(sizeOf(testId))}, sampled at ` +
            `"${(await probeRow(testId)).drawing ?? 'nothing'}", measured ` +
            `${describeSize(measured(testId))}.`
        );
      }
      await sleep(100);
    }
  }

  /** One item, in a well of its own, in the group's colour. */
  async function showSolo(
    testId: string,
    variant: 'text' | 'tonal',
    items: ButtonGroupItem[]
  ): Promise<void> {
    await render(
      <View style={ITEM_WELL}>
        <ButtonGroup
          items={items}
          tintColor={TINT}
          variant={variant}
          testID={testId}
          hybridRef={captureHybrid(testId)}
        />
      </View>
    );
    await waitForTestId(testId);
  }

  it('draws a checked text toggle inside the box the row was measured into', async () => {
    if (Platform.OS !== 'ios') return;

    // Every row is one item with a title no other test here measures: the measured size is
    // cached per configuration and the item titles are part of it, so a second row with the
    // same title would be laid out at the first one's size instead of measuring itself.
    const oneToggle = (title: string, checked: boolean): ButtonGroupItem[] => [
      {
        id: 'item',
        title,
        toggle: true,
        defaultChecked: checked ? true : undefined,
      },
    ];
    const oneAction = (title: string): ButtonGroupItem[] => [
      { id: 'item', title },
    ];

    // The two heights a `text` item can be measured at: the capsule a checked toggle draws, and
    // the label alone a `text` action item draws.
    await showSolo('bg-box-checked', 'text', oneToggle('North', true));
    const checkedFirst = await readBox(
      'bg-box-checked',
      'the text group measured with its toggle checked'
    );
    await showSolo('bg-box-quiet', 'tonal', oneAction('South'));
    const quiet = await readBox(
      'bg-box-quiet',
      'the same label inside a bordered item'
    );
    await showSolo('bg-box-text', 'text', oneAction('South'));
    const text = await readBox(
      'bg-box-text',
      'the same label as a text action item'
    );

    // The row this is about: measured while its toggle is unchecked, then checked by a press
    // that re-measures nothing.
    await showSolo('bg-box-toggle', 'text', oneToggle('South', false));
    const off = await readBox(
      'bg-box-toggle',
      'the text group holding an unchecked toggle'
    );
    await pressItem('bg-box-toggle', 'item');
    await pollUntil(
      () => (reportOf('bg-box-toggle').checked === 'item' ? true : null),
      () =>
        new Error(
          `the toggle never reached the row - it reports "${handleOf(
            'bg-box-toggle'
          ).nuiTestStateReport()}".`
        )
    );
    const on = await readBox(
      'bg-box-toggle',
      'the same group with its toggle checked'
    );

    const seen =
      `checked-first=${JSON.stringify(checkedFirst)} quiet=${JSON.stringify(quiet)} ` +
      `text=${JSON.stringify(text)} off=${JSON.stringify(off)} ` +
      `on=${JSON.stringify(on)}`;

    // A `text` group holding a toggle is measured at the height of a capsule before anything is
    // checked, which is the only way the checked state has a box to be drawn in: nothing
    // re-measures the row when an item is checked.
    if (Math.abs(off.height - quiet.height) > 0.6) {
      throw new Error(
        `a "text" group holding a toggle measured ${off.height} pt high with its toggle ` +
          `unchecked against the ${quiet.height} pt the same label measures inside a ` +
          `capsule, so the taller state has nowhere to be drawn. ${seen}`
      );
    }
    // And the same height after it is checked: the flip repaints the item and moves nothing.
    if (Math.abs(on.height - off.height) > 0.01) {
      throw new Error(
        `checking a toggle moved the "text" group's box from ${off.height} pt to ` +
          `${on.height} pt. ${seen}`
      );
    }
    if (Math.abs(on.height - checkedFirst.height) > 0.6) {
      throw new Error(
        `a "text" group measured with its toggle unchecked is ${on.height} pt high once ` +
          `checked, against the ${checkedFirst.height} pt of one measured while checked, ` +
          `so the checked capsule is drawn outside its box. ${seen}`
      );
    }
    // The two drawings those heights name: the quiet capsule while checked, and far less of the
    // box while unchecked. Neither a row that grew without drawing a capsule, nor a `text` group
    // whose toggle had simply become a capsule in both states, gets past both of these.
    if (!sameDrawing(on, quiet)) {
      throw new Error(
        `a checked toggle in a "text" group drew ${JSON.stringify(on)} against the ` +
          `same label in a bordered item, ${JSON.stringify(quiet)}. ${seen}`
      );
    }
    if (on.fill <= off.fill + 20) {
      throw new Error(
        `a "text" group's toggle paints no more of its box checked (${JSON.stringify(
          on
        )}) than unchecked (${JSON.stringify(off)}), so the unchecked item is not the ` +
          `label alone whose height is being reserved. ${seen}`
      );
    }
    // None of this reaches a `text` group that holds no toggle, and the read still tells the two
    // heights apart.
    if (text.height + 2 > off.height) {
      throw new Error(
        `a "text" group with no toggle is ${text.height} pt high against the ` +
          `${off.height} pt of one holding a toggle: without a toggle a "text" row is ` +
          `the height of a label alone. ${seen}`
      );
    }
    if (text.height + 2 > quiet.height) {
      throw new Error(
        `the read no longer tells a "text" item's height (${text.height} pt) from a ` +
          `capsule's (${quiet.height} pt), so the heights above say nothing. ${seen}`
      );
    }
  });

  /**
   * Every `size` the group takes, each in a well wide enough that its three-item row is never
   * moved into the overflow menu: every item reserves a capsule, and a capsule grows with the size.
   */
  const ROW_SIZES = [
    { size: 'small', well: 260 },
    { size: 'medium', well: 260 },
    { size: 'large', well: 300 },
    { size: 'xlarge', well: 350 },
    { size: 'xxlarge', well: 350 },
  ] as const;

  /** The point ranges across the control's box that were drawing something. */
  function parseInk(raw: string): { start: number; end: number }[] {
    return raw
      .split('|')
      .map((run) => /^([\d.]+)~([\d.]+)$/.exec(run))
      .filter((run): run is RegExpExecArray => run != null)
      .map((run) => ({ start: Number(run[1]), end: Number(run[2]) }));
  }

  /** The room between one drawing's end and the next one's start. */
  function gapsOf(runs: { start: number; end: number }[]): number[] {
    return runs.slice(1).map((run, at) => run.start - runs[at]!.end);
  }

  /**
   * One title for every item, so the room between two drawings is the room between two items and
   * nothing else: what each item paints inside its own space is then the only difference a gap
   * can carry.
   */
  function evenRow(kinds: ('action' | 'on' | 'off')[]): ButtonGroupItem[] {
    return kinds.map((kind, at) => ({
      id: `item${at}`,
      title: 'noon',
      toggle: kind !== 'action',
      defaultChecked: kind === 'on' ? true : undefined,
    }));
  }

  /**
   * How far two gaps of one row may sit apart. The row's own spacing is constant and the room an
   * item leaves beside its neighbour is decided by how it is drawn, so two neighbouring pairs of
   * one row differ by whole points when an item is measured smaller than its neighbours and by
   * nothing when it is not.
   */
  const EVEN_GAP = 1;

  /** One row whose middle pair is a checked toggle, and one whose middle pair is a label. */
  const EVEN_ROWS = [
    ['action', 'on', 'off'],
    ['action', 'action', 'off'],
  ] as const;

  it('leaves the same room between every pair of items in a text group holding a toggle, at every size', async () => {
    if (Platform.OS !== 'ios') return;

    // An action item, a checked capsule and an unchecked toggle each leave a different amount of
    // the space they were measured at empty around what they draw, so a row of mixed items is
    // evenly spaced only when every item of the row is measured at the same size -- at the size
    // the group asks for, since an item that reserved a capsule of another size would be measured
    // wider or narrower than the item beside it.
    const seen: string[] = [];
    for (const { size, well } of ROW_SIZES) {
      for (const kinds of EVEN_ROWS) {
        const row = `the "${size}" row of ${kinds.join('+')}`;
        const testId = `bg-even-${size}-${kinds.join('-')}`;
        await render(
          <View style={{ width: well }}>
            <ButtonGroup
              items={evenRow([...kinds])}
              size={size}
              tintColor={TINT}
              variant="text"
              testID={testId}
              hybridRef={captureHybrid(testId)}
            />
          </View>
        );
        await waitForTestId(testId);
        await waitForMeasured(testId, row);

        const probed = await probeRow(testId);
        const runs = parseInk(probed.ink ?? 'none');
        const gaps = gapsOf(runs);
        seen.push(
          `${row}: ink=${probed.ink ?? 'nothing'} gaps=${JSON.stringify(
            gaps.map((gap) => Number(gap.toFixed(2)))
          )}`
        );

        // The row this reads is the row of three items, not a shorter one whose rest went into
        // the menu: a menu button drawn beside two items would be a third drawing of its own.
        if (probed.visible !== '3') {
          throw new Error(
            `${row} placed ${probed.visible} of 3 items, so its gaps are not the gaps of this ` +
              `row: ${JSON.stringify(probed)}.`
          );
        }
        if (runs.length !== 3) {
          throw new Error(
            `${row} drew ${runs.length} separate things in the box it measured ` +
              `(${seen.join('; ')}), so its items cannot be placed apart.`
          );
        }
        const spread = Math.max(...gaps) - Math.min(...gaps);
        if (spread > EVEN_GAP) {
          throw new Error(
            `${row} leaves ${gaps[0]!.toFixed(2)} pt and ${gaps[1]!.toFixed(2)} pt between its ` +
              `drawings, ${spread.toFixed(2)} pt apart, so an item is drawn in less room than its ` +
              `neighbour takes. ${seen.join('; ')}`
          );
        }
      }
    }
  });
});

describe('ButtonGroup · the outlined toggle border (Android)', () => {
  /** A colour no scheme owns, so anything drawn in it is the control's own tint. */
  const TINT = '#00FF00';
  const tint = processColor(TINT) as number;

  /**
   * A title that draws no glyph, so the border is the only ink these groups own: what the
   * sampler counts is the border and nothing else. The box keeps a real size, because the
   * title is measured even though it draws nothing.
   */
  const BLANK = ' ';
  const TOGGLE: ButtonGroupItem[] = [{ id: 'one', title: BLANK, toggle: true }];
  const ON: ButtonGroupItem[] = [
    { id: 'one', title: BLANK, toggle: true, defaultChecked: true },
  ];

  /**
   * The colour a control draws that is not the sampler's backdrop, or the backdrop itself when
   * it draws nothing: the darkest and the lightest pixels on screen are the two ends of what is
   * drawn, and the backdrop is only one of them when something else was drawn beside it. This
   * reads an untinted outline without naming the colour the scheme draws it in.
   */
  async function inkOf(testId: string, what: string): Promise<string> {
    const darkest = closestOf(
      await pixelProbe(
        testId,
        processColor('#000000') as number,
        `${what}: darkest`
      )
    );
    const lightest = closestOf(
      await pixelProbe(
        testId,
        processColor('#FFFFFF') as number,
        `${what}: lightest`
      )
    );
    if (darkest === BACKDROP) return lightest;
    if (lightest === BACKDROP) return darkest;
    return colourDistance(darkest, BACKDROP) >=
      colourDistance(lightest, BACKDROP)
      ? darkest
      : lightest;
  }

  const IDS = [
    'bg-border-tint-off',
    'bg-border-tint-on',
    'bg-border-tint-disabled',
    'bg-border-text-tint',
    'bg-border-plain-off',
    'bg-border-plain-on',
    'bg-border-plain-disabled',
    'bg-border-text-plain',
  ] as const;

  it('draws Material own outline for each state, in the tint when one is given', async () => {
    function BorderGroups() {
      return (
        <View>
          <ButtonGroup
            items={TOGGLE}
            variant="outlined"
            tintColor={TINT}
            testID="bg-border-tint-off"
            hybridRef={captureHybrid('bg-border-tint-off')}
          />
          <ButtonGroup
            items={ON}
            variant="outlined"
            tintColor={TINT}
            testID="bg-border-tint-on"
            hybridRef={captureHybrid('bg-border-tint-on')}
          />
          <ButtonGroup
            items={TOGGLE}
            variant="outlined"
            tintColor={TINT}
            disabled
            testID="bg-border-tint-disabled"
            hybridRef={captureHybrid('bg-border-tint-disabled')}
          />
          <ButtonGroup
            items={TOGGLE}
            variant="text"
            tintColor={TINT}
            testID="bg-border-text-tint"
            hybridRef={captureHybrid('bg-border-text-tint')}
          />
          <ButtonGroup
            items={TOGGLE}
            variant="outlined"
            testID="bg-border-plain-off"
            hybridRef={captureHybrid('bg-border-plain-off')}
          />
          <ButtonGroup
            items={ON}
            variant="outlined"
            testID="bg-border-plain-on"
            hybridRef={captureHybrid('bg-border-plain-on')}
          />
          <ButtonGroup
            items={TOGGLE}
            variant="outlined"
            disabled
            testID="bg-border-plain-disabled"
            hybridRef={captureHybrid('bg-border-plain-disabled')}
          />
          <ButtonGroup
            items={TOGGLE}
            variant="text"
            testID="bg-border-text-plain"
            hybridRef={captureHybrid('bg-border-text-plain')}
          />
        </View>
      );
    }
    await render(<BorderGroups />, { timeout: 20000 });
    const boxes = new Map<string, Size>();
    for (const id of IDS) {
      await waitForTestId(id);
      boxes.set(id, await waitForMeasured(id, id));
    }

    const reports = new Map<string, string>();
    for (const id of IDS) {
      reports.set(id, await pixelProbe(id, tint, `the tint in "${id}"`));
    }
    const lineOf = (id: string): string => {
      const report = reports.get(id);
      if (report == null) {
        throw new Error(`"${id}" never produced a probe report.`);
      }
      return report;
    };
    console.log(`outlined border probes: ${JSON.stringify([...reports])}`);

    if (Platform.OS !== 'android') {
      // iOS has no pixels to sample, so the probe refuses.
      for (const id of IDS) {
        expect(lineOf(id)).toContain('no pixels');
      }
      return;
    }

    // A `text` item owns no ink at all here, so the two answers below differ only because one
    // variant draws a ring and the other does not.
    const textTint = lineOf('bg-border-text-tint');
    expect(
      probeHits(textTint),
      `a tinted "text" item is drawn in the tint ${TINT}, so it wears a ring the "text" ` +
        `variant must not draw: ${textTint}`
    ).toBe(0);

    const off = lineOf('bg-border-tint-off');
    expect(
      probeHits(off),
      `an enabled tinted "outlined" toggle has no ink in ${TINT}, so its border never reached ` +
        `the screen: ${off}`
    ).toBeGreaterThan(0);

    // Material draws no outline on a toggle that is on, so a tinted one draws none either.
    const on = lineOf('bg-border-tint-on');
    expect(
      probeHits(on),
      `a tinted "outlined" toggle that is on is drawn in the full ${TINT}, so it wears a ring ` +
        `Material's own toggle does not draw: ${on}`
    ).toBe(0);
    expect(
      sameSize(
        boxes.get('bg-border-tint-on') ?? null,
        boxes.get('bg-border-tint-off') ?? null
      ),
      `the toggle that is on (${describeSize(
        boxes.get('bg-border-tint-on') ?? null
      )}) is not the box the unchecked one has (${describeSize(
        boxes.get('bg-border-tint-off') ?? null
      )}), so the two reads are not one control in two states`
    ).toBe(true);

    // Material weakens a disabled outline rather than dropping it: the full tint is gone, and
    // what is left sits nearer the sampler's grey than the tint itself.
    const disabled = lineOf('bg-border-tint-disabled');
    expect(
      probeHits(disabled),
      `a disabled tinted "outlined" toggle is drawn in the full ${TINT}, so its border reads ` +
        `as enabled rather than at Material's disabled strength: ${disabled}`
    ).toBe(0);
    const dim = closestOf(disabled);
    expect(
      dim.length,
      `no colour could be read from a disabled outlined toggle: ${disabled}`
    ).toBe(7);
    expect(
      colourDistance(dim, BACKDROP),
      `the disabled control drew nothing but the sampler's own backdrop (${dim}), so its ` +
        `border was dropped rather than dimmed: ${disabled}`
    ).toBeGreaterThan(30);
    expect(
      colourDistance(dim, BACKDROP) < colourDistance(dim, TINT),
      `the disabled border (${dim}) is nearer the tint than the backdrop, so it is not drawn ` +
        `at Material's disabled strength: ${disabled}`
    ).toBe(true);
    const dimLine = await pixelProbe(
      'bg-border-tint-disabled',
      processColor(dim) as number,
      'the dimmed border'
    );
    expect(
      probeHits(dimLine),
      `the colour this disabled border is drawn in (${dim}) is not on screen at all: ` +
        `${dimLine}`
    ).toBeGreaterThan(0);
    expect(
      probeHits(dimLine) < sampledArea(dimLine) * 0.5,
      `${dim} covers ${String(probeHits(dimLine))} of ${String(
        sampledArea(dimLine)
      )} pixels - that is a filled box, not an outline: ${dimLine}`
    ).toBe(true);

    // Without a tint the control keeps Material's own outline, and this device's scheme draws it
    // barely apart from the sampler's grey, so these four states are read as the exact ink each one
    // puts on screen, and never against a colour the scheme happens to use.
    const ring = await inkOf('bg-border-plain-off', 'the untinted outline');
    expect(
      ring,
      `an enabled "outlined" toggle with no tint draws nothing but the sampler's backdrop, so ` +
        `it has no outline at all: ${lineOf('bg-border-plain-off')}`
    ).not.toBe(BACKDROP);
    const textPlain = await inkOf(
      'bg-border-text-plain',
      'an untinted text item'
    );
    expect(
      textPlain,
      `an untinted "text" item draws ${textPlain}, which is more than the sampler's backdrop, ` +
        `so it is drawn as though it were outlined`
    ).toBe(BACKDROP);
    const onPlain = await inkOf(
      'bg-border-plain-on',
      'the untinted outline of a toggle that is on'
    );
    expect(
      onPlain,
      `an "outlined" toggle with no tint that is on draws ${onPlain}, which is the outline of ` +
        `the unchecked one (${ring}), so it wears a ring Material does not draw`
    ).not.toBe(ring);
    const disabledPlain = await inkOf(
      'bg-border-plain-disabled',
      'the untinted outline of a disabled toggle'
    );
    expect(
      disabledPlain,
      `a disabled "outlined" toggle with no tint draws ${disabledPlain}, which is the outline ` +
        `of the enabled one (${ring}), so it reads as enabled rather than at Material's ` +
        `disabled strength`
    ).not.toBe(ring);
  });
});
