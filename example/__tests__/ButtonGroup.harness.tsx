/**
 * On-device tests for the ButtonGroup (task G20).
 *
 * A ButtonGroup is a *row*, and everything interesting about a row is decided by the
 * width it is given, which is why almost every claim here is about the row rather than
 * about a prop:
 *
 * - **the box** is the measurement, not the declaration. Every configuration is
 *   **poisoned** first (`seedSizingSize` with a height no ButtonGroup has, then an
 *   environment bump), so a correction that never arrives leaves a visible wrong box
 *   rather than an accidentally right one (`Button.harness.tsx` explains the precedent).
 * - **what overflowed** is read from placement, not from state. Which items overflowed
 *   lives in Material's private `ButtonGroupOverflowState` on Android and inside
 *   SwiftUI's `ViewThatFits` choice on iOS, so neither platform can be asked; the row
 *   stamps the answer as it lays out (`nuiTestProbeRow`). The same six items are then
 *   mounted twice — in a 220-point well and across the screen — which is the only way
 *   to show that the *box* decides, and that an `intrinsic` policy (measure unbounded,
 *   never overflow, get clamped) is not what shipped.
 * - **a press is one report, with the pressed item's id** — for a row item and for an
 *   item that only exists in the overflow menu.
 * - **a toggle flips at once and a refused flip reverts**, on the event-count
 *   handshake, with the tap-twice oracle: a control that had kept the refused change
 *   would ask for the *opposite* on the second tap.
 * - **a disabled group or item takes nothing**, from the row or from the menu, and
 *   `disabled` arriving while the menu is open closes it (D29).
 *
 * The readings: `harnessUi.queryByTestId` (the box Fabric gave the view),
 * `hybridRef.measureContent()` (the size the hosted control measured),
 * `nitroUiCore.sizingStats()` (what the engine did), and the control's own
 * `nuiTestStateReport()` (what it is drawing, what it laid out, and on Android what its
 * semantics tree says).
 */
import { useState } from 'react';
import { Platform, View } from 'react-native';
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
  type NitroUiSizingStats,
} from 'react-native-nitro-ui';

/** The ButtonGroup's Fabric name — what the sizing engine files sizes under. */
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

/** What `hybridRef` hands back — declared, not imported (DECISIONS D14). */
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

/** The parents' `checked` setters, by testID — how a test refuses a change from JS. */
const checkedSetters = new Map<string, (next: string[]) => void>();
/** The parents' `disabled` setters, for the D29 close-on-disable step. */
const disabledSetters = new Map<string, (next: boolean) => void>();

/**
 * The row the fallback row claims: three action items at every default the wrapper
 * resolves. Short titles, so the row fits an iPhone's width and the *default*
 * configuration is a row with no overflow — the thing `DECLARED_FALLBACKS` describes.
 */
const ACTIONS: ButtonGroupItem[] = [
  { id: 'copy', title: 'Copy' },
  { id: 'cut', title: 'Cut' },
  { id: 'paste', title: 'Paste' },
];

/**
 * Six items whose titles are long enough that they cannot share a 220-point well —
 * which is what makes "the overflow control exists" a measurement rather than a hope.
 */
const MANY: ButtonGroupItem[] = [
  { id: 'day', title: 'Day' },
  { id: 'week', title: 'Week' },
  { id: 'month', title: 'Month' },
  { id: 'quarter', title: 'Quarter' },
  { id: 'year', title: 'Year' },
  { id: 'all', title: 'All time' },
];

/** The key `ButtonGroup.tsx` builds, spelled out. */
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

/**
 * The wrapper's `items[].androidIcon`, as the key sees it: the *resolved* string.
 *
 * Every fixture here names a drawable as a plain string, which is the form the
 * wrapper forwards unchanged. A `require()` in a fixture would reach the key as a
 * `res:` name the bundler derived, so this refuses rather than quietly keying the
 * poisoned entry under something the control never registers under.
 */
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

/** A height no ButtonGroup has, planted as the engine's answer before a mount. */
const WRONG_HEIGHT = 99;
const WRONG_WIDTH = 37;

const stats = (): NitroUiSizingStats => nitroUiCore.sizingStats();

function corrections(before: NitroUiSizingStats, after: NitroUiSizingStats) {
  return (
    after.correctionsImmediate -
    before.correctionsImmediate +
    (after.correctionsBatched - before.correctionsBatched)
  );
}

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

/**
 * Wait for the box's **height** to reach the height the control measured.
 *
 * The height is the number a `fillWidth` control measures; its width belongs to the box
 * (`docs/architecture/sizing.md`), and the two platforms report `measureContent().width`
 * differently for exactly that reason — iOS answers the box's width, Android the
 * content's. Only the height can be compared box to measurement.
 */
async function waitForBoxHeight(
  testId: string,
  height: number,
  what: string
): Promise<Size> {
  return pollUntil(
    () => {
      const box = sizeOf(testId);
      return box != null && Math.abs(box.height - height) < 0.6 ? box : null;
    },
    () =>
      new Error(
        `testID "${testId}" (${what}) never reached height ${height.toFixed(
          2
        )} - last box ${describeSize(sizeOf(testId))}, control measured ` +
          `${describeSize(measured(testId))}.`
      )
  );
}

/**
 * The control's own report, as `key -> value`.
 *
 * `a11y` is last and carries `;` inside its own value (Android spells one entry per
 * semantics node), so the split stops there and the field keeps its separators.
 */
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

/** Ask the row what it laid out, and wait for that answer rather than the last one. */
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

/** Ask the control what its accessibility tree says, and wait for that answer. */
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

/** How long `waitForEvents` waits for a surplus event after the count is reached. */
const EVENT_QUIET_MS = 400;

/** Wait until the app has been told exactly `wanted` since `from`, then be quiet. */
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
  // through, and a control that fires twice per tap is exactly what this sees.
  await sleep(EVENT_QUIET_MS);
  return events.slice(from);
}

/**
 * Press one item, the way this platform's harness can.
 *
 * Both platforms take `nuiTestPressItem`, which runs the item's own tap handler — the
 * same entry the drawn item's `onClick`/`Button` action calls — and refuses a disabled
 * group or item exactly as a finger is refused. Neither platform's harness can aim at
 * an item by name, and both reasons were measured rather than assumed:
 *
 * - iOS: the harness tap is a `UITouch` with no HID event behind it, which SwiftUI's
 *   button gesture refuses (`Button`, `Chip` and `Checkbox` all say the same).
 * - Android: `queryByAccessibilityLabel` walks the Android **View** tree and matches
 *   `View.contentDescription` (`@react-native-harness/ui`'s `ViewQueryHelper.kt`), and
 *   a Compose item is not a View — the row is one `AndroidComposeView` whose items live
 *   in the semantics tree, which is what `nuiTestProbeAccessibility` reads instead.
 *   `queryByText` does not exist on the module at all.
 *
 * So the harness proves *what one item press does* (one report, the right id, the right
 * state) and `real-input` proves *the finger*: a tap on each drawn item, on both
 * platforms, and a row item reached through the open overflow menu.
 */
async function pressItem(testId: string, id: string): Promise<void> {
  handleOf(testId).nuiTestPressItem(id);
  // The Android implementation posts to the UI thread, so give the press its round
  // trip; iOS runs the model on the caller's thread and the event is already queued.
  await sleep(50);
}

function poison(keys: readonly string[]): void {
  for (const key of keys) {
    nitroUiCore.seedSizingSize(COMPONENT, key, WRONG_WIDTH, WRONG_HEIGHT);
  }
  nitroUiCore.invalidateSizingEnvironment();
}

/** A parent that owns one ButtonGroup's `checked` set and `disabled`, so a test can write. */
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
  it('lays the default row out at the size it measured, not at the planted one', async () => {
    // The declared fallback is a guess about a cold first frame; the only claim that
    // matters is that the measurement replaces it. Poisoning first is what makes the
    // two cases look different: without it, "corrected to 48" and "never corrected,
    // because 48 was declared" print the same box.
    poison([sizingKey('standard', 'filled', 'medium', 'automatic', ACTIONS)]);
    const before = stats();
    await render(
      <ButtonGroup
        items={ACTIONS}
        testID="bg-default"
        hybridRef={captureHybrid('bg-default')}
      />
    );
    await waitForTestId('bg-default');
    const content = await waitForMeasured('bg-default', 'the default row');
    await waitForBoxHeight('bg-default', content.height, 'the default row');

    expect(sizeOf('bg-default')!.height).not.toBeCloseTo(WRONG_HEIGHT, 0);
    expect(corrections(before, stats())).toBeGreaterThanOrEqual(1);
    // The row is `fillWidth`: its width is the parent's, and a group that had been
    // made `intrinsic` would report its content's width here instead.
    expect(sizeOf('bg-default')!.width).toBeGreaterThan(content.width * 0.99);
  });

  it('moves the items a 220-point well cannot hold, and takes some back when it grows', async () => {
    // The same six items, twice, at two widths, so the only variable is the box. Six
    // items do not fit a phone either — the row draws four of them across a 402-point
    // box (measured on the device this runs on) — so "a row with room to spare draws
    // every item" is a separate claim, made by the three-item group at the end.
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
    // The overflowed items are not drawn, so an item that only lives in the menu has
    // to be named by the menu rather than by the row.
    expect((narrow.shown ?? 'none').split(',')).not.toContain('all');

    // Widen the well to the whole screen. Nothing moved in the props: the same control,
    // the same six items, a wider box — and more of the row drawn.
    await rerender(
      <View style={{ width: '100%' }}>
        <ButtonGroup
          items={MANY}
          testID="bg-narrow"
          hybridRef={captureHybrid('bg-narrow')}
        />
      </View>
    );
    // The report's `visible` is the last *probed* layout, so every look has to ask the
    // row again rather than re-read the answer the narrow box gave.
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
    // An item that only existed in the menu at 220 pt is drawn in the row now.
    expect(
      wideShown.filter((id) => !narrowShown.includes(id)).length
    ).toBeGreaterThan(0);

    // The other half of "the box decides", which six long titles cannot show on a
    // phone: a row with room to spare draws every item and composes no menu at all.
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
    // D42 item 2 is a rule about the *group*: an iOS connected group whose items include
    // a toggle draws the standard bordered row, because `ControlGroup` shows no on
    // state. The bug this is here for decided it per candidate instead — and the
    // candidate a narrow box wins is the one whose *trailing* item has already gone into
    // the menu. Six items with the last one a toggle is exactly that shape: the row the
    // user sees holds no toggle, so a per-candidate answer reached for `ControlGroup`
    // (31 pt) while the same group in a wide box reached for the standard row
    // (34.33 pt) — two heights under one sizing key, which is the one thing a sizing key
    // cannot carry, because it does not hold the box's width.
    //
    // The six items are the ones the well test above already proves do not fit 220 pt,
    // so "the toggle overflowed" is a measurement and not a guess about how wide a
    // toggle draws. What is asserted at both widths is the invariant the fix is about:
    // the *same* group draws the same row, at the same height, whatever the box.
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
    // The premise: the toggle really is the item the well could not hold.
    expect(narrow.overflow).toBe('1');
    expect((narrow.shown ?? 'none').split(',')).not.toContain(LAST);
    // And the answer: the *group* has a toggle, so this is the standard row — a
    // per-candidate decision reads `row=controlGroup` here, which is the line this
    // test exists to turn red.
    expect(narrow.row).toBe('standard');
    const narrowShown = (narrow.shown ?? 'none').split(',');
    const narrowHeight = narrowMeasured.height;

    // The same group with room to spare. Widening has to be visible in the row (more
    // items drawn, the way the well test proves it does), because a placement witness
    // that still carried the narrow layout would agree with anything.
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
    // The row is asked again, not read back: `stateReport` answers with the last
    // *published* placement, and only a probe republishes it. Polling the report
    // instead keeps answering with the narrow layout however wide the box got — which
    // is exactly how this test first failed on a device.
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

    // A row item: one report, naming the item that was tapped. Exact, not "at least" —
    // a control that fires twice per tap is the failure this exists for.
    const from = events.length;
    await pressItem('bg-press', visible[0]!);
    expect(await waitForEvents(from, [`bg-press:press:${visible[0]}`])).toEqual(
      [`bg-press:press:${visible[0]}`]
    );

    // An item that only exists in the menu reports the same way, because it is the
    // same item: the menu is how it is reached, not a different control.
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

    // Accepted: the flip lands in the row and in the set React now holds.
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

    // Refused: the same tap, twice, asks for `true` *both* times and leaves the item
    // unchecked. That is the oracle — a control that had kept the refused change would
    // ask for `false` on the second tap, which is the bug the handshake is for.
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

    // A re-render that sends the *same* `defaultChecked` again must not re-apply it:
    // the tap above is the user's, and the seed is a first-render value only. A second
    // `render()` would be a second mount, and a fresh control *should* seed itself, so
    // this is `rerender` — the same view, new props.
    //
    // The second item is the part that makes this a test of native. `useNativeItems`
    // caches by an items signature, so re-sending an identical array hands the wrapper
    // back the *same* props object: nothing is re-sent to native at all, the guard below
    // the bridge is never reached, and the test passes on the JS cache alone. Change one
    // field and the signature changes, `defaultCheckedIds: ['bold']` crosses the bridge
    // a second time, and only native's own `seeded` set stands between it and undoing
    // the tap above. Drop that guard and this line reads `checked=bold`.
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

    // Every id, drawn or overflowed: a disabled group refuses both paths, because the
    // menu is a route to the same items rather than a second control.
    const report = await probeRow('bg-disabled-group');
    const shown = (report.shown ?? 'none').split(',');
    const all = MANY.map((item) => item.id);
    // The row and the menu are two routes to the same six ids, so the probe presses
    // every one of them; the report is what says which went through the row and which
    // only exist as menu rows. Both routes must refuse.
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

    // One disabled item inside an enabled group, beside an enabled sibling: the
    // sibling answering is what says the silence above was a refusal.
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

    // D29: `disabled` arriving while the overflow menu is *open* closes it — which is
    // only a test if the menu was open. Asserting the close from a menu nobody opened
    // proves the witness was never `open`, which is true of a fresh mount too.
    //
    // Android asks Material to show its own menu and reads `open` back from the state the
    // composition is handed. iOS cannot open a `Menu` from code before iOS 18
    // (`isExpanded`; the target is 15.1), so it takes the claim one level down instead:
    // the row composes an overflow control (`menu=composed`), and after the disable there
    // is no control at all (`menu=none`) — the form the rule takes on this platform, and
    // the tap-the-real-indicator half of it is `real-input:ios`.
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

  it('names every item kind, and an icon-only item by its title', async () => {
    const items: ButtonGroupItem[] = [
      // An item that has a glyph on this platform: `iconOnly` draws the glyph alone, so
      // the title has to reach the reader as a description — `desc=`, with no text.
      {
        id: 'copy',
        title: 'Copy',
        systemImage: 'doc.on.doc',
        androidIcon: 'nitroui_test_star',
      },
      // An item with no glyph to draw. `iconOnly` is a preference, not a death sentence:
      // the title is the fallback, and `text=` is what distinguishes "drew the title"
      // from the empty button this control used to draw — a node whose only claim to
      // exist was a description saying a word nothing on screen matched. Carrying both
      // would name it twice, so `desc=none` beside `text=Paste` is half the claim.
      { id: 'paste', title: 'Paste' },
      // A toggle item, for the role.
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
      // Measured (and the reason `Slider` and `IconButton` say the same): a hosted
      // SwiftUI view answers `accessibilityElements == []` to anything that is not an
      // accessibility client, so the in-process probe cannot see the tree. The labels
      // are read from the *outside* by `real-input:ios`, which is the XCUITest pass.
      expect(a11y).toBe('unavailable');
      return;
    }
    // Android reads the merged Compose semantics nodes a reader is handed. Three claims,
    // all from Appendix B5, and they only say anything because `text=` and `desc=` are
    // reported apart: which of the two is filled is how the node is named.
    expect(a11y).toMatch(/text=none,desc=Copy/);
    expect(a11y).toMatch(/text=Paste,desc=none/);
    // The report spells the role as `Checkbox`, with the M3 toggle's own state beside it
    // (`Off` here): a reader is handed a checkbox named Bold, not a button.
    expect(a11y).toMatch(/\[Checkbox,[^;]*desc=Bold/);

    // The overflow control's own name, both halves of it, on one group that overflows.
    //
    // With no `overflowAccessibilityLabel`, the answer is Material's: this control ships
    // named, in the reader's language, and a hardcoded "More" here replaced that string
    // with English in every locale. And when the caller *does* name it, the new words
    // have to arrive — the model held the label in a plain var, so a change after mount
    // was stored and never drawn.
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
    // One name, not two: the first version of this control put its own word in front of
    // Material's and a reader heard "More More options".
    expect(unnamed).not.toContain('More More');

    // The *same* view, renamed: a prop that only reaches a plain var is stored and never
    // drawn, and this is the step that would notice.
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
    // Recycling is the renderer's to decide, not the test's, so the claim is the one
    // that holds whether or not the pool hands the next mount the same instance: a
    // fresh mount shows what React sent and nothing the last instance left behind.
    //
    // The two mounts are deliberately built so the *only* thing that can tell them
    // apart is the reset. The same item ids appear in both. Mount one seeds two of
    // them checked and then emits a real flip, so native's event count is 1. Mount two
    // is a *controlled* group that says both are unchecked with `mostRecentEventCount`
    // back at 0. A model that had kept its count would treat that write as stale
    // (`jsEvents >= nativeEvents` is how §4 admits it) and keep drawing the old
    // selection; a model that had kept its checked set would draw it for the same
    // reason. Either way the row answers `checked=day,week` here instead of `none`.
    // Every item is a toggle: the flip below has to be a flip, and a flip is the only
    // thing that puts a number in the control's event count.
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
    // Ask the row rather than waiting for a layout of its own: the placement record is
    // written as the row lays out, and a recycled host may answer before it has one.
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
    // The three fields that could carry the previous mount, and the quiet that says no
    // stale event was replayed into the new app.
    expect(fresh.checked).toBe('none');
    expect(fresh.shown).toBe('day,week');
    expect(fresh.overflow).toBe('0');
    // Android answers the menu's own state, and a recycled composition must not answer
    // `open`. iOS has no menu state to read (the field answers whether the row composes
    // the control), and this mount composes none.
    expect(fresh.menu).toBe(Platform.OS === 'android' ? 'closed' : 'none');
    await sleep(EVENT_QUIET_MS);
    expect(events).toEqual([]);
  });
});
