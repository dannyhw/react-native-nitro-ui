import { Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import {
  Button,
  Host,
  Picker,
  Progress,
  Slider,
  Switch,
  nitroUiCore,
} from 'react-native-nitro-ui';
import { userEvent } from '@react-native-harness/ui';

const COUNT = 200;

const CYCLES = 3;

/**
 * How much the post-GC heap floor may climb per cycle, in MiB. A loop that
 * frees everything returns to roughly the same floor (ART keeps a few hundred
 * KiB of slack between collects); a control leaked per mount costs about 8 MiB
 * per cycle of 200.
 */
const MAX_FLOOR_GROWTH_MIB_PER_CYCLE = 2;

const COMPONENT = 'NitroUiSwitch';

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/**
 * Hermes reports only its own heap to JS, so the Java heap comes from the
 * example app's probe module.
 */
type HeapStats = {
  usedBytes: number;
  totalBytes: number;
  maxBytes: number;
  dalvikPrivateDirtyKb: number;
  dalvikPssKb: number;
};
type ProbeModule = {
  heapStats(forceGc: boolean): Promise<HeapStats>;
};

let probe: ProbeModule | null = null;
function heapStats(): Promise<HeapStats> {
  if (probe == null) {
    probe = TurboModuleRegistry.getEnforcing(
      'NitroUiProbe'
    ) as unknown as ProbeModule;
  }
  return probe.heapStats(true);
}

const MIB = 1024 * 1024;
const toMib = (bytes: number) => Number((bytes / MIB).toFixed(2));

async function settle(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTestId(testId: string, timeoutMs: number) {
  const deadline = nitroUiCore.now() + timeoutMs;
  for (;;) {
    if (harnessUi.queryByTestId(testId) != null) {
      return;
    }
    if (nitroUiCore.now() > deadline) {
      throw new Error(
        `No element with testID "${testId}" within ${timeoutMs}ms.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * The settle after the mount lets the batch draw its first frame; the settle
 * after the unmount lets teardown run.
 */
async function churnCycle(prefix: string) {
  const { unmount } = await render(
    <View>
      {Array.from({ length: COUNT }, (_, index) => index).map((row) => (
        <Switch
          key={row}
          defaultValue={row % 2 === 0}
          testID={`${prefix}-${String(row)}`}
        />
      ))}
    </View>,
    // 200 hosted controls need far more than the default one-second render wait.
    { timeout: 25000 }
  );
  await waitForTestId(`${prefix}-${String(COUNT - 1)}`, 20000);
  await settle(300);
  unmount();
  await settle(300);
}

const PICKER_OPTIONS = ['Cinder', 'Mica', 'Shale'];

/**
 * The first row's menu is open when the tree goes away: a `PopupWindow` is
 * owned by the composition, so a composition that is not dropped keeps the
 * window reachable.
 */
async function churnPickerCycle(prefix: string) {
  const { unmount } = await render(
    <View>
      {Array.from({ length: COUNT }, (_, index) => index).map((row) => (
        <Picker
          key={row}
          options={PICKER_OPTIONS}
          defaultSelectedIndex={row % PICKER_OPTIONS.length}
          testID={`${prefix}-${String(row)}`}
        />
      ))}
    </View>,
    { timeout: 40000 }
  );
  await waitForTestId(`${prefix}-${String(COUNT - 1)}`, 30000);
  await settle(300);
  // The anchor is in the app's window, so a real press reaches it; the popup's
  // rows are not.
  const anchor = harnessUi.queryByTestId(`${prefix}-0`);
  expect(anchor).not.toBeNull();
  await userEvent.pressAt(
    anchor!.x + anchor!.width / 2,
    anchor!.y + anchor!.height / 2
  );
  await settle(400);
  unmount();
  await settle(300);
}

/**
 * 48 dp per Switch is the box the sizing engine gives that configuration on
 * Android. Module-level, so the churn does not hand the Host a new style object
 * per cycle.
 */
const HOST_STYLE = { width: '100%' as const, height: COUNT * 48 };

/**
 * Returns the last child's box so the caller can prove the batch was hosted: a
 * hosted control declines to measure, so its own view is laid out at 0x0.
 */
async function churnHostedCycle(prefix: string): Promise<ViewInfo | null> {
  const { unmount } = await render(
    <Host testID={`${prefix}-host`} style={HOST_STYLE}>
      {Array.from({ length: COUNT }, (_, index) => index).map((row) => (
        <Switch
          key={row}
          defaultValue={row % 2 === 0}
          testID={`${prefix}-${String(row)}`}
        />
      ))}
    </Host>,
    { timeout: 40000 }
  );
  await waitForTestId(`${prefix}-${String(COUNT - 1)}`, 30000);
  const lastChild = harnessUi.queryByTestId(`${prefix}-${String(COUNT - 1)}`);
  await settle(300);
  unmount();
  await settle(300);
  return lastChild;
}

/**
 * A quarter of `COUNT` of each kind: a cycle of 200 mixed controls plus four
 * forced collects does not fit the harness's per-test timeout.
 */
const MIXED_COUNT = 100;

const MIXED_KINDS = ['switch', 'slider', 'progress', 'button'] as const;

const MIXED_HOST_STYLE = {
  width: '100%' as const,
  height: MIXED_COUNT * 48,
};

/**
 * Returns the box of one child of each kind: a hosted control is laid out at
 * 0x0, and one that started measuring itself again would answer a real frame.
 */
async function churnMixedCycle(
  prefix: string
): Promise<Record<(typeof MIXED_KINDS)[number], ViewInfo | null>> {
  const { unmount } = await render(
    <Host testID={`${prefix}-host`} style={MIXED_HOST_STYLE}>
      {Array.from({ length: MIXED_COUNT }, (_, index) => index).map((row) => {
        const kind = MIXED_KINDS[row % MIXED_KINDS.length];
        const testId = `${prefix}-${String(row)}`;
        if (kind === 'slider') {
          return <Slider key={row} defaultValue={0.5} testID={testId} />;
        }
        if (kind === 'progress') {
          return <Progress key={row} value={0.5} testID={testId} />;
        }
        if (kind === 'button') {
          return (
            <Button key={row} title={`Row ${String(row)}`} testID={testId} />
          );
        }
        return (
          <Switch key={row} defaultValue={row % 2 === 0} testID={testId} />
        );
      })}
    </Host>,
    { timeout: 60000 }
  );
  await settle(600);
  const boxes = {} as Record<(typeof MIXED_KINDS)[number], ViewInfo | null>;
  MIXED_KINDS.forEach((kind, index) => {
    boxes[kind] = harnessUi.queryByTestId(`${prefix}-${String(index)}`);
  });
  await settle(600);
  unmount();
  await settle(400);
  return boxes;
}

/**
 * Many small Hosts make a leaked Host a per-cycle event: one leaked Host per
 * cycle is far below the floor bound, 200 are about four times over it.
 */
const HOST_COUNT = 200;

const SMALL_HOST_STYLE = { width: '100%' as const, height: 48 };

/**
 * Returns the last Host's box and its child's: a real Host has a height and its
 * child is 0x0.
 */
async function churnManyHostsCycle(prefix: string): Promise<{
  host: ViewInfo;
  child: ViewInfo;
}> {
  const { unmount } = await render(
    <View>
      {Array.from({ length: HOST_COUNT }, (_, index) => index).map((row) => (
        <Host
          key={row}
          testID={`${prefix}-host-${String(row)}`}
          style={SMALL_HOST_STYLE}
        >
          <Switch
            defaultValue={row % 2 === 0}
            testID={`${prefix}-${String(row)}`}
          />
        </Host>
      ))}
    </View>,
    { timeout: 60000 }
  );
  await waitForTestId(`${prefix}-${String(HOST_COUNT - 1)}`, 45000);
  const host = harnessUi.queryByTestId(
    `${prefix}-host-${String(HOST_COUNT - 1)}`
  );
  const child = harnessUi.queryByTestId(`${prefix}-${String(HOST_COUNT - 1)}`);
  expect(host).not.toBeNull();
  expect(child).not.toBeNull();
  await settle(400);
  unmount();
  await settle(400);
  return { host: host!, child: child! };
}

afterEach(() => {
  cleanup();
});

if (Platform.OS === 'android') {
  describe('Mount churn · Android (B1)', () => {
    beforeAll(async () => {
      // Pay the one-time costs (Nitro's first hybrid call, the first composition,
      // the first measurement of this configuration) before any heap is read, so
      // the first floor is a steady-state one.
      nitroUiCore.prewarmSizing([COMPONENT]);
      await churnCycle('churn-warmup');
    });

    const title =
      `keeps the post-GC heap floor flat across ${String(CYCLES)} churn cycles ` +
      `of ${String(COUNT)} Switches`;
    it(title, async () => {
      const statsBefore = nitroUiCore.sizingStats();
      const floors: HeapStats[] = [];
      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        await churnCycle(`churn-${String(cycle)}`);
        floors.push(await heapStats());
      }
      const first = floors[0];
      const last = floors[floors.length - 1];
      if (first == null || last == null) {
        throw new Error(
          `Expected ${String(CYCLES)} heap floors, read ${String(floors.length)}.`
        );
      }
      const after = nitroUiCore.sizingStats();
      const corrections =
        after.correctionsImmediate -
        statsBefore.correctionsImmediate +
        (after.correctionsBatched - statsBefore.correctionsBatched);
      const growthMib = toMib(
        (last.usedBytes - first.usedBytes) / (floors.length - 1)
      );
      console.log(
        `churn: N=${String(COUNT)} cycles=${String(floors.length)} ` +
          `floorsMiB=[${floors.map((f) => toMib(f.usedBytes)).join(', ')}] ` +
          `growthMiBPerCycle=${String(growthMib)} ` +
          `maxHeapMiB=${String(toMib(last.maxBytes))} ` +
          `privateDirtyMiB=[${floors
            .map((f) => toMib(f.dalvikPrivateDirtyKb * 1024))
            .join(', ')}] ` +
          `corrections=${String(corrections)}`
      );

      // The cycles must have been warm, or the heap could legitimately be the
      // sizing engine's own cache learning a new size rather than a leak.
      expect(corrections).toBe(0);
      // The last floor still has to have room to grow: a run that passes the
      // slope while sitting at the heap limit is not a pass.
      expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(20);
      expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
    });

    const hostedTitle =
      `keeps the post-GC heap floor flat across ${String(CYCLES)} churn cycles ` +
      `of ${String(COUNT)} Switches inside one <Host>`;
    it(hostedTitle, async () => {
      nitroUiCore.prewarmSizing([COMPONENT]);
      // A Host that drew nothing would still churn 200 Fabric nodes and free
      // them; 0x0 here means the Host took the batch over.
      const warmUp = await churnHostedCycle('hosted-warmup');
      expect(warmUp).not.toBeNull();
      expect([Math.round(warmUp!.width), Math.round(warmUp!.height)]).toEqual([
        0, 0,
      ]);

      const statsBefore = nitroUiCore.sizingStats();
      const floors: HeapStats[] = [];
      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        await churnHostedCycle(`hosted-${String(cycle)}`);
        floors.push(await heapStats());
      }
      const first = floors[0];
      const last = floors[floors.length - 1];
      if (first == null || last == null) {
        throw new Error(
          `Expected ${String(CYCLES)} heap floors, read ${String(floors.length)}.`
        );
      }
      const after = nitroUiCore.sizingStats();
      const corrections =
        after.correctionsImmediate -
        statsBefore.correctionsImmediate +
        (after.correctionsBatched - statsBefore.correctionsBatched);
      const growthMib = toMib(
        (last.usedBytes - first.usedBytes) / (floors.length - 1)
      );
      console.log(
        `hosted churn: N=${String(COUNT)} cycles=${String(floors.length)} ` +
          `floorsMiB=[${floors.map((f) => toMib(f.usedBytes)).join(', ')}] ` +
          `growthMiBPerCycle=${String(growthMib)} ` +
          `maxHeapMiB=${String(toMib(last.maxBytes))} ` +
          `corrections=${String(corrections)}`
      );

      // A hosted control reports no size, so a warm hosted loop costs no
      // corrections.
      expect(corrections).toBe(0);
      expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(20);
      expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
    });

    const mixedTitle =
      `keeps the post-GC heap floor flat across ${String(CYCLES)} churn cycles ` +
      `of ${String(MIXED_COUNT)} mixed controls inside one <Host>`;
    it(mixedTitle, async () => {
      nitroUiCore.prewarmSizing([
        COMPONENT,
        'NitroUiSlider',
        'NitroUiProgress',
        'NitroUiButton',
      ]);
      const warmUp = await churnMixedCycle('mixed-warmup');
      for (const kind of MIXED_KINDS) {
        const box = warmUp[kind];
        expect(box).not.toBeNull();
        expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([
          0, 0,
        ]);
      }

      const statsBefore = nitroUiCore.sizingStats();
      const floors: HeapStats[] = [];
      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        await churnMixedCycle(`mixed-${String(cycle)}`);
        floors.push(await heapStats());
      }
      const first = floors[0];
      const last = floors[floors.length - 1];
      if (first == null || last == null) {
        throw new Error(
          `Expected ${String(CYCLES)} heap floors, read ${String(floors.length)}.`
        );
      }
      const after = nitroUiCore.sizingStats();
      const corrections =
        after.correctionsImmediate -
        statsBefore.correctionsImmediate +
        (after.correctionsBatched - statsBefore.correctionsBatched);
      const growthMib = toMib(
        (last.usedBytes - first.usedBytes) / (floors.length - 1)
      );
      console.log(
        `mixed churn: N=${String(MIXED_COUNT)} cycles=${String(floors.length)} ` +
          `floorsMiB=[${floors.map((f) => toMib(f.usedBytes)).join(', ')}] ` +
          `growthMiBPerCycle=${String(growthMib)} ` +
          `maxHeapMiB=${String(toMib(last.maxBytes))} ` +
          `corrections=${String(corrections)}`
      );

      expect(corrections).toBe(0);
      expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(20);
      expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
    });

    /**
     * A Host's teardown is `onDropView` -> `host.drop()`. Without it the
     * observer armed at attach keeps the Host alive on the activity's
     * `LifecycleRegistry` for the life of the process.
     */
    const manyHostsTitle =
      `keeps the post-GC heap floor flat across ${String(CYCLES)} churn cycles ` +
      `of ${String(HOST_COUNT)} single-child <Host>s`;
    it(manyHostsTitle, async () => {
      nitroUiCore.prewarmSizing([COMPONENT]);
      const warmUp = await churnManyHostsCycle('many-hosts-warmup');
      expect(Math.round(warmUp.host.height)).toBeGreaterThan(20);
      expect([
        Math.round(warmUp.child.width),
        Math.round(warmUp.child.height),
      ]).toEqual([0, 0]);

      const statsBefore = nitroUiCore.sizingStats();
      const floors: HeapStats[] = [];
      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        await churnManyHostsCycle(`many-hosts-${String(cycle)}`);
        floors.push(await heapStats());
      }
      const first = floors[0];
      const last = floors[floors.length - 1];
      if (first == null || last == null) {
        throw new Error(
          `Expected ${String(CYCLES)} heap floors, read ${String(floors.length)}.`
        );
      }
      const after = nitroUiCore.sizingStats();
      const corrections =
        after.correctionsImmediate -
        statsBefore.correctionsImmediate +
        (after.correctionsBatched - statsBefore.correctionsBatched);
      const growthMib = toMib(
        (last.usedBytes - first.usedBytes) / (floors.length - 1)
      );
      console.log(
        `many-hosts churn: N=${String(HOST_COUNT)} cycles=${String(floors.length)} ` +
          `floorsMiB=[${floors.map((f) => toMib(f.usedBytes)).join(', ')}] ` +
          `growthMiBPerCycle=${String(growthMib)} ` +
          `maxHeapMiB=${String(toMib(last.maxBytes))} ` +
          `corrections=${String(corrections)}`
      );

      expect(corrections).toBe(0);
      expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(20);
      expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
    });

    const pickerTitle =
      `keeps the post-GC heap floor flat across ${String(CYCLES)} churn cycles ` +
      `of ${String(COUNT)} Pickers, one with its menu open`;
    it(pickerTitle, async () => {
      nitroUiCore.prewarmSizing(['NitroUiPicker']);
      await churnPickerCycle('picker-warmup');
      const statsBefore = nitroUiCore.sizingStats();
      const floors: HeapStats[] = [];
      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        await churnPickerCycle(`picker-churn-${String(cycle)}`);
        floors.push(await heapStats());
      }
      const first = floors[0];
      const last = floors[floors.length - 1];
      if (first == null || last == null) {
        throw new Error(
          `Expected ${String(CYCLES)} heap floors, read ${String(floors.length)}.`
        );
      }
      const after = nitroUiCore.sizingStats();
      const corrections =
        after.correctionsImmediate -
        statsBefore.correctionsImmediate +
        (after.correctionsBatched - statsBefore.correctionsBatched);
      const growthMib = toMib(
        (last.usedBytes - first.usedBytes) / (floors.length - 1)
      );
      console.log(
        `picker churn: N=${String(COUNT)} cycles=${String(floors.length)} ` +
          `floorsMiB=[${floors.map((f) => toMib(f.usedBytes)).join(', ')}] ` +
          `growthMiBPerCycle=${String(growthMib)} ` +
          `maxHeapMiB=${String(toMib(last.maxBytes))} ` +
          `corrections=${String(corrections)}`
      );
      expect(corrections).toBe(0);
      expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(20);
      expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
    });
  });
}
// The platform is in the file name: jest fails a collected file that reports no
// tests, and `react-native-harness` ignores files named for another platform.
