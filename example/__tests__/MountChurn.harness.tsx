/**
 * Mount/unmount churn gate (task B1).
 *
 * A settings screen that is opened, closed and opened again is a mount loop, and
 * on Android every hosted control brings its own Compose composition. The bench
 * found that such a loop runs the Java heap out at `mount.<component>:nitro-ui:200`
 * (`docs/tasks/A1-baselines.report.md`): each cycle kept ~84 KiB of the ~132 KiB
 * each control had cost, so a 192 MiB heap died after a handful of cycles.
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
 * Android only: the leak is in the Compose hosting lifecycle, and iOS hosts
 * SwiftUI views with a different lifetime, so there is nothing here to assert on
 * iOS and the suite registers no test there.
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
import { Switch, nitroUiCore } from 'react-native-nitro-ui';

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
 * Two MiB per cycle is 12x below the bug and well above the noise, so it is red
 * for the leak and green for the fix without riding on machine load.
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
    it.skip('is Android-only: the gate measures the Compose hosting lifecycle', () => {});
  });
}
