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
    // `menu` is the menu's open state on Android; on iOS it is whether the row
    // composes an overflow control.
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

  /** One item, one way: an action, a checked toggle, an unchecked toggle. */
  function soloItems(role: 'action' | 'on' | 'off'): ButtonGroupItem[] {
    if (role === 'action') return [{ id: 'bold', title: 'Bold' }];
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

  it('draws a toggle item in the group variant, like the action item of it', async () => {
    if (Platform.OS !== 'ios') return;
    const read: Record<string, Record<'action' | 'on' | 'off', Drawing>> = {};
    for (const variant of VARIANTS) {
      read[variant] = {} as Record<'action' | 'on' | 'off', Drawing>;
      for (const role of ['action', 'on', 'off'] as const) {
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
        `${variant}: action=${JSON.stringify(read[variant]!.action)} ` +
        `on=${JSON.stringify(read[variant]!.on)} ` +
        `off=${JSON.stringify(read[variant]!.off)}`
    ).join('; ');

    for (const variant of VARIANTS) {
      const { action, on, off } = read[variant]!;
      // The on state is drawn like the action item beside it would be: the same amount of the
      // box painted, and the same amount of it in the group's tint.
      if (on.tint === 0) {
        throw new Error(
          `a checked "${variant}" toggle drew nothing in the group's tint. ${seen}`
        );
      }
      if (Math.abs(on.fill - action.fill) > 10) {
        throw new Error(
          `a checked "${variant}" toggle painted ${on.fill}% of its box against the ` +
            `"${variant}" action item's ${action.fill}% - the two are not drawn in the ` +
            `same style. ${seen}`
        );
      }
      if (Math.abs(on.tint - action.tint) > 10) {
        throw new Error(
          `a checked "${variant}" toggle painted ${on.tint}% of its box in the tint ` +
            `against the "${variant}" action item's ${action.tint}%. ${seen}`
        );
      }
      // The off state draws the same shape with nothing in the tint: it tells apart from the
      // on state without leaving the variant's style family.
      if (off.tint > 2) {
        throw new Error(
          `an unchecked "${variant}" toggle painted ${off.tint}% of its box in the ` +
            `tint, so on and off draw the same thing. ${seen}`
        );
      }
      if (variant === 'text') {
        // `.borderless` paints the label and nothing behind it, in either state.
        if (on.fill > 20 || action.fill > 20) {
          throw new Error(
            `a "text" group painted a background - the toggle's item filled ` +
              `${on.fill}% of its box and the action's ${action.fill}%. ${seen}`
          );
        }
      } else if (Math.abs(off.fill - on.fill) > 12) {
        throw new Error(
          `an unchecked "${variant}" toggle painted ${off.fill}% of its box against ` +
            `the checked one's ${on.fill}% - the capsule is not drawn in both states. ` +
            seen
        );
      }
    }

    // The read tells the three iOS style families apart, so the per-variant claims above say
    // something: only a prominent family paints its box in the tint, and only the two capsule
    // families paint a background at all.
    if (
      read.filled!.action.tint < read.tonal!.action.tint + 10 ||
      read.filled!.action.fill < read.text!.action.fill + 20
    ) {
      throw new Error(
        `the measured read does not tell the three iOS style families apart - filled ` +
          `painted ${read.filled!.action.tint}% in the tint and ` +
          `${read.filled!.action.fill}% of its box, tonal painted ` +
          `${read.tonal!.action.tint}% in the tint, text painted ` +
          `${read.text!.action.fill}% of its box. ${seen}`
      );
    }
  });
});
