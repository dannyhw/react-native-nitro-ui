/**
 * Mount/unmount churn gate (task B1).
 *
 * A settings screen that is opened, closed and opened again is a mount loop, and
 * on Android every hosted control brings its own Compose composition. The bench
 * found that such a loop runs the Java heap out at `mount.<component>:nitro-ui:200`
 * (`docs/tasks/A1-baselines.report.md`): the bench retained 16.5 MiB per cycle of
 * 200 controls, so a 192 MiB heap died after a handful of cycles. This file is the
 * same leak measured in the harness, where it was 8.18 MiB per cycle (~42 KiB per
 * control); the two runs are both measurements of it and the gap between them is
 * not attributed.
 *
 * The gate is therefore retention, not duration: after a full collect, the Java
 * heap a churn loop is *holding* must not climb cycle over cycle. Wall-clock is
 * never gated here (D21) - the loop is slow on any loaded machine, and being slow
 * is not the bug.
 *
 * Two things make the number mean something:
 * - every measured cycle is warm (pre-warmed, and asserted to cost 0 sizing
 *   corrections), so the heap cannot be growing because the sizing engine learned
 *   something new;
 * - the bound is on the *floor* after garbage collection, which is what survives
 *   an iteration. A transient allocation storm returns to the floor; a leak moves
 *   it.
 *
 * The file gates two controls, because the second one adds a failure mode the first
 * cannot show: a `Picker`'s menu is a Compose `Popup` - a real `PopupWindow` in the
 * window list - and it is a child of the composition, so the composition that a leak
 * retains also retains the popup of a control that is already gone. The Picker cycle
 * therefore opens one menu and unmounts the tree while it is open, which is the
 * `onDropView` → `host.drop()` path (G6, review M4).
 *
 * Android only: the leak is in the Compose hosting lifecycle, and iOS hosts SwiftUI
 * views with a different lifetime, so there is nothing to assert there. The iOS
 * branch registers one pending test that says so - see the `else` below, which also
 * records why it cannot register nothing.
 */
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
import { Host, Picker, Switch, nitroUiCore } from 'react-native-nitro-ui';
import { userEvent } from '@react-native-harness/ui';

/** Controls per cycle: the N the bench died at. */
const COUNT = 200;

/** Churn cycles between two heap readings. */
const CYCLES = 3;

/**
 * How much the post-GC heap floor may climb per cycle, in MiB.
 *
 * Placed between the two outcomes this gate has to tell apart: the leak measured
 * 8.18 MiB per cycle of 200 controls, and a loop that frees everything returns to
 * roughly the same floor (ART keeps a few hundred KiB of slack between collects).
 * Two MiB per cycle is about 4x below that bug and far above the spread of the
 * fixed runs (0.13 MiB), so it is red for the leak and green for the fix without
 * riding on machine load.
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
 * What `NitroUiProbe.heapStats` answers - the Java heap, seen from inside the
 * process after the collectors were asked to run.
 *
 * Hermes reports only its own heap to JS, so the number has to come from the app.
 * The probe is an example-app module (test-only), fetched lazily rather than at
 * module scope: on iOS it does not exist, and this file must still load there.
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
 * Mount `COUNT` Switches, let the batch draw, and unmount it again.
 *
 * The settle after the mount is what makes a failure mean retention: a host that
 * is dropped before its first frame could still legitimately be waiting on work it
 * scheduled for that frame. The settle after the unmount lets teardown run.
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

/** The three titles every churned Picker shows - one configuration per row mod 3. */
const PICKER_OPTIONS = ['Cinder', 'Mica', 'Shale'];

/**
 * Mount `COUNT` Pickers, open one of their menus, and unmount the lot.
 *
 * Same shape as [churnCycle], with one addition: the menu of the first row is open
 * when the tree goes away. A `PopupWindow` is owned by the composition, and the
 * composition is owned by `host.drop()` in `onDropView`, so this is the churn that
 * fails if that call is ever dropped - the window and everything behind it stay
 * reachable from the window's own list.
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
    // 200 Material fields need the same generous wait the Switches do.
    { timeout: 40000 }
  );
  await waitForTestId(`${prefix}-${String(COUNT - 1)}`, 30000);
  await settle(300);
  // The anchor is in the app's window, so a real press reaches it (only the popup's
  // rows do not, which is why the pick itself is a `nuiTestSelect`/real-input case).
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
 * The box a hosted batch needs: 48 dp per Switch is the box the sizing engine gives
 * that configuration on Android, and a Host with no `height` of its own would be
 * exactly that sum anyway (D24). Module-level, so the churn does not hand the Host a
 * new style object per cycle.
 */
const HOST_STYLE = { width: '100%' as const, height: COUNT * 48 };

/**
 * Mount `COUNT` Switches inside **one** `<Host>`, let the batch draw, unmount.
 *
 * The Host is the answer to this leak, not an exemption from it: two hundred hosted
 * Switches are one Compose composition and one `AndroidComposeView`, so what a cycle
 * can retain is one composition plus two hundred Fabric nodes — and the unmounted
 * `NitroUiHostView` stays reachable if anything in that composition still points at
 * it. A leak here is therefore bigger per node than the one above, which is what makes
 * it worth gating separately rather than assuming the shared path inherits B1's fix.
 *
 * Returns the last child's box so the caller can prove the batch was hosted: on
 * Android a hosted control's own view is `GONE`, which is reported as `0x0`. A Host
 * that silently composed nothing would churn an empty tree and pass every heap
 * assertion below.
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
    // The same generous wait the unhosted batch needs; hosting does not make 200
    // nodes cheaper to attach, only cheaper to compose.
    { timeout: 40000 }
  );
  await waitForTestId(`${prefix}-${String(COUNT - 1)}`, 30000);
  const lastChild = harnessUi.queryByTestId(`${prefix}-${String(COUNT - 1)}`);
  await settle(300);
  unmount();
  await settle(300);
  return lastChild;
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
      // The witness that the fixture is what the title says. A `Host` that drew
      // nothing would still churn 200 Fabric nodes and free them, and the heap would
      // be flat for the wrong reason; a hosted control's own view is `GONE`, so 0x0
      // here means the Host took the batch over.
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

      // D24 again, this time as a churn assertion: a hosted control reports nothing,
      // so a warm hosted loop cannot be growing the heap because the engine learned a
      // size. Zero here is also the number that makes the heap slope mean retention.
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
} else {
  /**
   * A gate with nothing to gate still has to register something.
   *
   * Jest fails a suite that registers no test at all - "Your test suite must
   * contain at least one test" - and measured on this repo's runner, a file whose
   * only `describe` is behind a platform check fails the *other* platform's run
   * rather than being skipped. So the platform that is not gated says so as a
   * pending test: visible in the report, and honest about why it did not run.
   */
  describe('Mount churn (B1)', () => {
    it.skip(
      'is Android-only: the gate measures the Compose hosting lifecycle, ' +
        'Picker popup included',
      () => {}
    );
  });
}
