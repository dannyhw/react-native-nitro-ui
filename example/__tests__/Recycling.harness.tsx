import { Platform, TurboModuleRegistry, View } from 'react-native';
import {
  afterEach,
  beforeAll,
  cleanup,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import { DatePicker, Switch, nitroUiCore } from 'react-native-nitro-ui';

/** The `nuiPerfId` every view in this file mounts with, so its marks are findable. */
const PERF_ID = 71;

/** Controls per churn cycle. */
const COUNT = 200;

/** Churn cycles between two heap readings. */
const CYCLES = 3;

/** Post-GC heap floor growth allowed per cycle, in MiB. */
const MAX_FLOOR_GROWTH_MIB_PER_CYCLE = 2;

type SwitchHandle = {
  readonly value: boolean | null;
  nuiTestLifetimeReport(): string;
};

type ViewInfo = { x: number; y: number; width: number; height: number };
type HarnessUiModule = {
  queryByTestId(testId: string): ViewInfo | null;
};
const harnessUi = TurboModuleRegistry.getEnforcing(
  'HarnessUI'
) as unknown as HarnessUiModule;

/** Handles in the order they were handed to JS; the last belongs to the latest mount. */
const delivered: SwitchHandle[] = [];

function capture(handle: SwitchHandle): void {
  delivered.push(handle);
}

function latestHandle(): SwitchHandle {
  const handle = delivered[delivered.length - 1];
  if (handle == null) {
    throw new Error(
      'no hybridRef handle has been delivered, so nothing here can ask a native ' +
        'view what it has been through'
    );
  }
  return handle;
}

/** `drops=<n> recycles=<m> …`, as numbers. Throws when either field is missing. */
function lifetime(handle: SwitchHandle): { drops: number; recycles: number } {
  const raw = handle.nuiTestLifetimeReport();
  const drops = /drops=(\d+)/.exec(raw)?.[1];
  const recycles = /recycles=(\d+)/.exec(raw)?.[1];
  if (drops == null || recycles == null) {
    throw new Error(
      `nuiTestLifetimeReport answered "${raw}", which has no drops= or recycles= field`
    );
  }
  return { drops: Number(drops), recycles: Number(recycles) };
}

/** Every `kind` this instance has marked since the last call, oldest first. */
function drainKinds(instanceId: number = PERF_ID): string[] {
  const kinds: string[] = [];
  for (const event of nitroUiCore.drainPerf()) {
    if (event.instanceId === instanceId) {
      kinds.push(event.kind);
    }
  }
  return kinds;
}

/**
 * The Android drop-path counters in `nuiTestLifetimeReport`. The iOS report carries only
 * the two lifetime counters.
 */
const DROP_PATH_FIELDS = [
  'measuresAfterDrop',
  'layoutsAfterDrop',
  'giveUps',
  'floatingFlushes',
] as const;

/**
 * The drop-path fields as numbers. Throws on a missing field: every one is expected to
 * stay at zero, and a missing field must not read as zero.
 */
function lifetimeFields(raw: string): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const field of DROP_PATH_FIELDS) {
    const value = new RegExp(`${field}=(\\d+)`).exec(raw)?.[1];
    if (value == null) {
      throw new Error(
        `nuiTestLifetimeReport answered "${raw}" with no ${field}= field, so a ` +
          `measured negative here would be an unread one`
      );
    }
    seen[field] = Number(value);
  }
  return seen;
}

async function settle(ms = 350): Promise<void> {
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
        `No element with testID "${testId}" within ${String(timeoutMs)}ms.`
      );
    }
    await settle(50);
  }
}

/**
 * One controlled Switch, mounted with the perf id the marks are keyed on. Swapping `key`
 * drops this instance and asks for another.
 */
function oneSwitch(second: boolean, key = 'single') {
  return (
    <Switch
      key={key}
      value={second}
      testID="recycling-switch"
      accessibilityLabel="Recycling switch"
      nuiPerfId={PERF_ID}
      hybridRef={capture}
    />
  );
}

/* ------------------------------ the leak fixture ------------------------------ */

type HeapStats = {
  usedBytes: number;
  totalBytes: number;
  maxBytes: number;
  dalvikPrivateDirtyKb: number;
  dalvikPssKb: number;
};
type ProbeModule = {
  heapStats(forceGc: boolean): Promise<HeapStats>;
  viewRecyclingEnabled(): Promise<boolean>;
  /** Android only: drops a hosted control while it is attached, then measures it. */
  simulatePostDropMeasure(): Promise<string>;
};

let probe: ProbeModule | null = null;
function probeModule(): ProbeModule {
  if (probe == null) {
    probe = TurboModuleRegistry.getEnforcing(
      'NitroUiProbe'
    ) as unknown as ProbeModule;
  }
  return probe;
}

/**
 * The process-wide drop-path totals. The report is a method on a live control, so a Switch
 * is mounted just to ask.
 */
async function readLifetimeLine(): Promise<string> {
  delivered.length = 0;
  const { unmount } = await render(oneSwitch(false, 'reporter'));
  await waitForTestId('recycling-switch', 10000);
  await settle(150);
  const raw = latestHandle().nuiTestLifetimeReport();
  unmount();
  await settle(150);
  return raw;
}

function heapStats(): Promise<HeapStats> {
  return probeModule().heapStats(true);
}

const MIB = 1024 * 1024;
const toMib = (bytes: number) => Number((bytes / MIB).toFixed(2));

/**
 * React Native's `enableViewRecycling` flag as the process sees it. iOS has no such flag:
 * Fabric pools every recyclable view.
 */
async function viewRecyclingEnabled(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  if (probe == null) {
    probe = TurboModuleRegistry.getEnforcing(
      'NitroUiProbe'
    ) as unknown as ProbeModule;
  }
  return probe.viewRecyclingEnabled();
}

/**
 * Mount `COUNT` Switches, let the batch draw, unmount the lot. The settle after the mount
 * matters: a host dropped before its first frame may still hold work scheduled for that
 * frame. Every row carries `nuiPerfId` so the cycle's recycle marks can be counted.
 */
async function churnCycle(prefix: string) {
  const { unmount } = await render(
    <View>
      {Array.from({ length: COUNT }, (_, index) => index).map((row) => (
        <Switch
          key={row}
          defaultValue={row % 2 === 0}
          testID={`${prefix}-${String(row)}`}
          nuiPerfId={PERF_ID}
        />
      ))}
    </View>,
    { timeout: 25000 }
  );
  await waitForTestId(`${prefix}-${String(COUNT - 1)}`, 20000);
  await settle(300);
  unmount();
  await settle(300);
}

afterEach(() => {
  cleanup();
  delivered.length = 0;
});

/* ----------------------------------- suites ----------------------------------- */

describe('recycling · the pool is real on both platforms (F6)', () => {
  beforeAll(async () => {
    // Android pools views only when the app turned `enableViewRecycling` on; without it
    // nothing below tests recycling.
    if (Platform.OS === 'android') {
      const enabled = await viewRecyclingEnabled();
      console.log(
        `    · enableViewRecycling as the process sees it: ${String(enabled)}`
      );
      expect(enabled).toBe(true);
    }
  });

  it('sends a dropped control to the pool, not just to the collector', async () => {
    // `dropped` is marked by a plain unmount and by recycling alike; only the pair with
    // `recycled` says the view went to the pool.
    nitroUiCore.setPerfEnabled(true);
    try {
      delivered.length = 0;
      nitroUiCore.drainPerf();
      const { unmount } = await render(oneSwitch(false));
      await waitForTestId('recycling-switch', 5000);
      // Props have to have landed before the drop, or `dropped` would be the only mark
      // and a run could not tell "mounted then dropped" from "never mounted".
      await settle();
      const mounted = drainKinds();
      expect(mounted).toEqual(expect.arrayContaining(['propsApplied']));

      unmount();
      await settle(500);
      const afterDrop = drainKinds();
      console.log(
        `    · recycle marks for nuiPerfId=${String(PERF_ID)}: ` +
          `[${afterDrop.join(', ')}]`
      );
      expect(afterDrop).toEqual(
        expect.arrayContaining(['dropped', 'recycled'])
      );
    } finally {
      nitroUiCore.setPerfEnabled(false);
    }
  });

  it('hands the next mount a host with no sizing policy left behind', async () => {
    // Each round leaves an `inline` picker's `fillWidth` host in the pool, then mounts a
    // `compact` field in a full-width row. A sizing policy that survived the reset would
    // stretch the field to the row. Three rounds, because the pool chooses which instance
    // comes back.
    const POLICY_PERF_ID = 72;
    const pickers = (variant: 'inline' | 'compact') => (
      <View testID="policy-row">
        <DatePicker
          variant={variant}
          defaultValue={new Date(2026, 6, 4)}
          testID="policy-date"
          nuiPerfId={POLICY_PERF_ID}
        />
      </View>
    );
    nitroUiCore.setPerfEnabled(true);
    try {
      nitroUiCore.drainPerf();
      let sawRecycle = false;
      let widestField = 0;
      let narrowestRow = Number.POSITIVE_INFINITY;
      for (const round of [0, 1, 2]) {
        // 1. Leave a `fillWidth` host in the pool.
        const previous = await render(pickers('inline'), { timeout: 25000 });
        await waitForTestId('policy-date', 10000);
        await settle(300);
        previous.unmount();
        // Long enough for the dropped view to reach the pool.
        await settle(500);

        // 2. Mount the default variant, which cannot fix the policy itself.
        const current = await render(pickers('compact'), { timeout: 25000 });
        await waitForTestId('policy-date', 10000);
        await settle(500);
        const box = harnessUi.queryByTestId('policy-date');
        const row = harnessUi.queryByTestId('policy-row');
        if (box == null || row == null) {
          throw new Error(
            `round ${String(round)}: the field or the row could not be measured, so ` +
              'nothing below can say which policy the host was left with'
          );
        }
        const marks = drainKinds(POLICY_PERF_ID).filter(
          (kind) => kind === 'recycled'
        ).length;
        if (marks > 0) {
          sawRecycle = true;
        }
        widestField = Math.max(widestField, box.width);
        narrowestRow = Math.min(narrowestRow, row.width);
        console.log(
          `    · round ${String(round)} (inline -> compact): ` +
            `box=${box.width.toFixed(2)} row=${row.width.toFixed(2)} ` +
            `recycledMarks=${String(marks)}`
        );
        current.unmount();
        await settle(300);
      }

      // A run that never pooled would pass the bound below trivially.
      expect(sawRecycle).toBe(true);
      // Widest field against narrowest row across rounds, so one stretched field fails.
      if (widestField >= narrowestRow - 1) {
        throw new Error(
          `a compact field was laid out at its row's width — widest field ` +
            `${widestField.toFixed(2)} against narrowest row ` +
            `${narrowestRow.toFixed(2)}, so a recycled host kept the previous ` +
            `owner's fillWidth sizing policy`
        );
      }
    } finally {
      nitroUiCore.setPerfEnabled(false);
    }
  });

  it('gives a later mount an instance the pool took back', async () => {
    // The counters are read while the control is mounted: after an unmount every handle
    // reads `drops=1 recycles=1`, reused or not. The swap is by `key` within one render,
    // because React Native's pool is per surface and is emptied when a surface stops.
    delivered.length = 0;
    const KEYS = ['a', 'b', 'a', 'b', 'a', 'b'];
    const { rerender, unmount } = await render(oneSwitch(false, KEYS[0]), {
      timeout: 25000,
    });
    await waitForTestId('recycling-switch', 10000);
    await settle();
    const whileMounted: Array<{ drops: number; recycles: number }> = [];
    for (const [round, key] of KEYS.entries()) {
      const value = round % 2 === 1;
      if (round > 0) {
        await rerender(oneSwitch(value, key));
        await settle(400);
      }
      // Each round's own mount has to have received its own props.
      await waitFor(() => expect(latestHandle().value).toBe(value), {
        timeout: 8000,
      });
      const counters = lifetime(latestHandle());
      whileMounted.push(counters);
      console.log(
        `    · round ${String(round)} (key ${key}, value ${String(value)}) ` +
          `while mounted: ${JSON.stringify(counters)}`
      );
    }
    unmount();

    const reused = Math.max(...whileMounted.map((c) => c.recycles));
    const dropped = Math.max(...whileMounted.map((c) => c.drops));
    // Thrown with every round in the message: a device run reports a thrown Error, while
    // `console.log` output may not leave the device.
    if (dropped < 1 || reused < 1) {
      throw new Error(
        `no mounted control reported a previous mount — highest on a mounted view was ` +
          `drops=${String(dropped)} recycles=${String(reused)} over ` +
          `${String(whileMounted.length)} rounds ${JSON.stringify(whileMounted)}. ` +
          `Either the pool never handed a view back, or the counters no longer survive ` +
          `a recycle — which is the exact claim this test exists to make.`
      );
    }
  });
});

if (Platform.OS === 'android') {
  describe('recycling · churn does not leak (Android, F6)', () => {
    const title =
      `keeps the post-GC heap floor flat across ${String(CYCLES)} churn cycles ` +
      `of ${String(COUNT)} Switches while the pool is in use`;
    it(title, async () => {
      nitroUiCore.setPerfEnabled(true);
      try {
        // The pool is a cache, so the first cycle legitimately raises the floor: warm up
        // first and measure from the second.
        nitroUiCore.prewarmSizing(['NitroUiSwitch']);
        nitroUiCore.drainPerf();
        await churnCycle('pool-warmup');

        const floors: HeapStats[] = [];
        const recycledPerCycle: number[] = [];
        for (let cycle = 0; cycle < CYCLES; cycle += 1) {
          await churnCycle(`pool-${String(cycle)}`);
          floors.push(await heapStats());
          // Consumed each cycle, so this is a rate and not a running total.
          recycledPerCycle.push(
            drainKinds().filter((kind) => kind === 'recycled').length
          );
        }
        const first = floors[0];
        const last = floors[floors.length - 1];
        if (first == null || last == null) {
          throw new Error(
            `Expected ${String(CYCLES)} heap floors, read ${String(floors.length)}.`
          );
        }
        const growthMib = toMib(
          (last.usedBytes - first.usedBytes) / (floors.length - 1)
        );
        console.log(
          `pool churn: N=${String(COUNT)} cycles=${String(floors.length)} ` +
            `floorsMiB=[${floors
              .map((floor) => toMib(floor.usedBytes))
              .join(', ')}] growthMiBPerCycle=${String(growthMib)} ` +
            `maxHeapMiB=${String(toMib(last.maxBytes))} ` +
            `recycledMarksPerCycle=[${recycledPerCycle.join(', ')}] ` +
            `(marks for nuiPerfId=${String(PERF_ID)} only)`
        );

        // Zero across every cycle would mean the pool never ran.
        expect(
          recycledPerCycle.reduce((sum, value) => sum + value, 0)
        ).toBeGreaterThan(0);
        // A run that passes the slope while sitting at the heap limit is not a pass.
        expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(
          20
        );
        expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
      } finally {
        nitroUiCore.setPerfEnabled(false);
      }
    });

    // The totals are process-wide and monotonic, and other tests here mount and drop
    // controls, so the assertion is a delta of zero across the churn.
    it('measures the drop-path branches B1 called unreachable at zero across a churn', async () => {
      const before = lifetimeFields(await readLifetimeLine());
      await churnCycle('drop-path');
      await churnCycle('drop-path');
      const after = lifetimeFields(await readLifetimeLine());
      const grew = DROP_PATH_FIELDS.filter(
        (field) => (after[field] ?? 0) > (before[field] ?? 0)
      );
      console.log(
        `    · drop-path totals across 2 churn cycles of ${String(COUNT)}: ` +
          `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
      );
      if (grew.length > 0) {
        throw new Error(
          `${grew.join(', ')} ${grew.length === 1 ? 'rose' : 'rose'} across a churn ` +
            `of ${String(COUNT)} controls, so B1's unreachable drop-path branch is a ` +
            `live leak path. before=${JSON.stringify(before)} ` +
            `after=${JSON.stringify(after)}`
        );
      }
    });

    // The probe does what `stopSurface` does: it drops a hosted control while it is still
    // attached, then measures it. The control must be mounted when the probe walks the
    // tree, and the second read must go through a live handle, so the unmount comes last.
    it('declines, and counts, a host dropped while it is still attached', async () => {
      const before = lifetimeFields(await readLifetimeLine());

      const { unmount } = await render(oneSwitch(false));
      await waitForTestId('recycling-switch', 5000);
      await settle();

      const answer = await probeModule().simulatePostDropMeasure();
      const after = lifetimeFields(latestHandle().nuiTestLifetimeReport());
      console.log(
        `    · post-drop measure, driven: ${answer} ` +
          `totals before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
      );
      unmount();

      if (answer.startsWith('no-host')) {
        throw new Error(
          `the probe found no hosted control to drop, so it proved nothing about the ` +
            `post-drop rule — a control has to be on screen. ` +
            `The probe's own look at the tree: ${answer}`
        );
      }
      // The guard only matters for a dropped host that is still attached.
      expect(answer).toContain('attached=true');
      // `measuredWidth=0` means the guard declined to measure, and so to compose.
      expect(answer).toContain('measuredWidth=0');
      // Exactly one: the probe makes one measure call.
      expect(after.measuresAfterDrop).toBe((before.measuresAfterDrop ?? 0) + 1);
    });
  });
} else {
  // TODO: iOS has no recycling leak gate. The retention to gate is native (SwiftUI and
  // UIKit objects), and it needs a native iOS probe that counts live hosts or reads the
  // process footprint.
}
