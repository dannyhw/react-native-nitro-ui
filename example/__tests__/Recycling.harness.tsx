/**
 * View-recycling gate (task F6).
 *
 * The library implements `RecyclableView` on every control, which makes each Hybrid
 * View *poolable* — but a pool only exists where the platform runs one, and on Android
 * that is React Native's `enableViewRecycling` flag, whose RN 0.88 default is `false`.
 * So for every gate this repo ran before F6, the recycle reset was written and never
 * executed on Android, and `docs/tasks/X4-conformance.report.md` recorded that as a
 * platform fact: "Android never reaches `prepareForRecycle`… `prepareToRecycleView`'s
 * only caller is the legacy `ViewManager.recycleView`".
 *
 * **That is not true of RN 0.88, and this file is what measures it instead of reading
 * it off a call graph.** `ViewManager.onDropViewInstance` (decompiled from
 * `react-android-0.88.0`) calls `prepareToRecycleView` and pushes the view onto the
 * pool's stack whenever `enableViewRecycling` allocated that stack, and
 * `ViewManager.createViewInstance(tag, …)` pops it. Nitro's generated manager overrides
 * both, and its `prepareToRecycleView` is what calls our `prepareForRecycle()`. The
 * example app now turns the flag on (`NitroUiFeatureFlags.kt`), so the state the harness
 * drives is the state a host app opts into — and the recycle rule in
 * `Conformance.harness.tsx` is now a live path on Android rather than an iOS-only one.
 *
 * Three things have to be true before "the reset is tested on Android" means anything,
 * and each is a test here:
 *
 * 1. **The drop really went to the pool and not to the garbage collector.** Both paths
 *    run `onDropView`, so a drop is not evidence. The pool path is the one that also
 *    runs `prepareForRecycle`, so the two are told apart by *marks*: `NitroUiPerf`
 *    records `dropped` and `recycled` (`dropped` with no `recycled` after it is a real
 *    unmount). Those marks are what the first test reads, via the one channel that
 *    already crosses to JS — `nitroUiCore.drainPerf()`.
 * 2. **The instance the next mount gets is that same object.** A mark says a reset ran;
 *    only a counter that *survives* a recycle says who ran on it. `nuiTestLifetimeReport`
 *    reads two per-object counters (`drops=`, `recycles=`) that `prepareForRecycle`
 *    deliberately does not clear, so a second mount that reads `recycles=1` can only be
 *    looking at an instance the pool handed back. A fresh instance answers `drops=0
 *    recycles=0`, which is why the assertion cannot pass by accident.
 * 3. **Pooling does not leak.** A pooled host is a retained object by design — the pool
 *    is a cache — so the question is whether the *floor* after a collect keeps climbing
 *    cycle over cycle while the pool is being reused. Same shape as
 *    `MountChurn.harness.tsx`, whose 2 MiB/cycle bound this reuses, with one addition
 *    that churn alone does not need: the loop has to prove it recycled, or a heap that
 *    is flat because nothing was ever pooled would pass for the wrong reason.
 *
 * The residue probes themselves live in `Conformance.harness.tsx`, one per control; this
 * file gates the machinery those probes now depend on. Both platforms run tests 1 and 2;
 * the leak test is Android-only, for the reason `MountChurn.harness.tsx` gives — the
 * question is about the Compose hosting lifecycle, and iOS hosts SwiftUI with a
 * different lifetime, so the iOS branch registers one pending test that says so.
 *
 * @file Gates: `harness:ios`, `harness:android`. Discovered automatically:
 *       `example/jest.harness.config.mjs` matches any `*.harness.tsx` under a
 *       `__tests__` directory.
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
  waitFor,
} from 'react-native-harness';
import { DatePicker, Switch, nitroUiCore } from 'react-native-nitro-ui';

/** The `nuiPerfId` every view in this file mounts with, so its marks are findable. */
const PERF_ID = 71;

/** Controls per churn cycle. 200 is the batch `MountChurn.harness.tsx` dies at. */
const COUNT = 200;

/** Churn cycles between two heap readings. */
const CYCLES = 3;

/**
 * Post-GC heap floor growth allowed per cycle, in MiB. The same bound
 * `MountChurn.harness.tsx` uses, and for the same reason: it sits between the leak that
 * gate was written for (8.18 MiB/cycle) and a loop that frees everything (~0.13 MiB of
 * ART slack), so a pooled-but-leaking host shows up here without riding on machine load.
 */
const MAX_FLOOR_GROWTH_MIB_PER_CYCLE = 2;

/** The Switch handle, narrowed to what this file reads. */
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

/**
 * Handles in the order they were handed to JS.
 *
 * A list rather than a `testID → handle` map because identity is the subject: the last
 * entry is the object the most recent mount reported, and the length says whether a
 * second mount reported one at all.
 */
const delivered: SwitchHandle[] = [];

function capture(handle: SwitchHandle): void {
  delivered.push(handle);
}

/** The most recent handle, or a failure that names what never happened. */
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

/**
 * `drops=<n> recycles=<m> …`, as numbers.
 *
 * Parsed strictly on purpose: a probe that answered a shape this file does not know
 * would otherwise read `undefined`, and `undefined >= 1` is false, which is the kind of
 * silence that turns a broken probe into a permanent pass.
 */
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
 * The Android drop-path counters `nuiTestLifetimeReport` answers, in the report's own words.
 *
 * Android only: iOS hosts SwiftUI, which has no measure pass to decline after a drop and no
 * `ViewTreeObserver` listener to lose, so its report is the two lifetime counters alone.
 */
const DROP_PATH_FIELDS = [
  'measuresAfterDrop',
  'layoutsAfterDrop',
  'giveUps',
  'floatingFlushes',
] as const;

/**
 * The four drop-path fields, as numbers, refusing a report that does not carry them.
 *
 * The refusal is the point. Every one of these is expected to stay at zero, so a probe that
 * stopped answering the field would make a silent `undefined` look exactly like the pass —
 * which is the failure mode a "this must never happen" gate has and a "this must happen"
 * gate does not. Comparing the field as a string (`field=0`) keeps a missing field and a
 * wrong one in the same shape the assertion prints.
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
 * One Switch, mounted with the perf id the marks are keyed on.
 *
 * `value` is passed explicitly because every prop is always passed (nitro#1184), and
 * because a *controlled* value is what the second mount can be asked about. `key` is for
 * the identity test: swapping it deletes this instance and asks for another, which is the
 * drop-and-create pair the pool turns into a hand-back.
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
  /** Android only: drives B1's N5 shape and reports what the guard answered. */
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
 * The process-wide drop-path totals, as the library's own line, read through whichever
 * control answers.
 *
 * A mount is needed to ask at all — the probe is a method on a live control — so this
 * mounts one, reads it while it is on screen, and takes it away. The read is of the
 * library's process-wide counters, so which control answers is beside the point. Callers
 * hand the line to `lifetimeFields`, which is what refuses a missing field.
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
 * The flag the example app installs, read back from the process.
 *
 * This is the difference between a gate that measures recycling and one that measures
 * its own absence: if a future RN starts refusing the app's override, or a refactor
 * moves the install after the first flag read, every assertion below would still be
 * green on Android while nothing recycled. iOS has no such flag — Fabric pools every
 * recyclable view unconditionally — so this is asked where a flag exists.
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
 * Mount `COUNT` Switches, let the batch draw, unmount the lot.
 *
 * The settle after the mount is what makes a failure mean retention: a host dropped
 * before its first frame could still legitimately be waiting on work scheduled for that
 * frame. `key` is stable across cycles, but each cycle is a fresh tree, so the whole
 * batch is torn down and the whole pool refilled — the churn a settings screen does.
 *
 * Every row carries `nuiPerfId`, which the leak gate reads back as its witness: with
 * them unset, `drainPerf()` would answer nothing for the churn and the heap numbers
 * below would be measuring a run that never recycled. Sharing one id across a batch is
 * what makes that cheap — the marks are counted per cycle, and the ring is drained
 * between cycles so the count is a rate rather than a running total.
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
    // Precondition, asserted rather than assumed: on Android every assertion in this
    // file is only about recycling if the flag that creates the pool is on, and the app
    // installs that override at launch. If a future RN refuses it, or the install moves
    // after the first flag read, this goes red instead of the three tests below passing
    // on a process that never pooled anything. iOS has no such flag.
    if (Platform.OS === 'android') {
      const enabled = await viewRecyclingEnabled();
      console.log(
        `    · enableViewRecycling as the process sees it: ${String(enabled)}`
      );
      expect(enabled).toBe(true);
    }
  });

  it('sends a dropped control to the pool, not just to the collector', async () => {
    // The mark half of the evidence, and the platform-independent half: `dropped` comes
    // from `onDropView`, which both an unmount and the front door of recycling run, so
    // it is the *pair* that says which one happened. Nothing here knows or assumes that
    // Android pools — it asks the ring, which only the native reset can write to.
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
    // The reset rule that F6's flag exposed, and the one that actually broke a suite.
    // `sizingPolicy` is per-*host* state that a prop setter moves: DatePicker's `variant`
    // setter sends `compact` → intrinsic and anything else → `fillWidth`, because an
    // inline calendar takes its width from Yoga's box while a field sizes to its own
    // text. The setter compares against `model.variant`, and `prepareForRecycle()` puts
    // that back to `compact` — so the next mount, wanting the default, is "no change"
    // and returns without touching the policy. The previous owner's `fillWidth` then
    // survives into a control that is a field, and the field is laid out at its
    // parent's width. That is how `DatePicker.harness.tsx` · G5 went red on this
    // branch: three tests failed with a 131.05 dp field laid out at the row's 411.43.
    //
    // Shape of a round: an `inline` picker is mounted so its host is legitimately moved
    // to `fillWidth`, then unmounted — which is what puts that host in the pool — and the
    // next round mounts a plain `compact` field, the default variant, in a full-width row.
    // If the policy survived the reset, the field is stretched to the row. So the bound
    // is `box < row`, and it can only be reached by a control that asked the sizing
    // engine the *right* question.
    //
    // Both mounts carry one perf id, so the `recycled` mark is attributable: without that
    // witness the box bound below could be satisfied by a run that allocated a fresh view
    // every time and never ran the reset at all. Three rounds, because which pooled
    // instance comes back is the pool's choice — the fact this needs is that some round
    // both recycled and stayed narrow.
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
        // Long enough for the drop and, on iOS, for the instance to reach the pool:
        // `enqueueComponentViewWithComponentHandle` runs `prepareForRecycle` on the
        // mounting transaction that removes the view (see the identity test below).
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

      // The witness first: a run that never pooled would leave the bound below
      // trivially true, so the loop has to show it reached the reset at all. What it
      // shows precisely is that *this control class* went through the drop-and-pool path
      // — `recycled` is marked for the shared perf id, so it counts the inline picker's
      // own pool entry as well as the field's. That is weaker than the identity test's
      // per-object proof, and it is the weaker witness on purpose: DatePicker has no
      // `nuiTestLifetimeReport`, and adding one to a second control for a witness the
      // Switch already settles is more API surface than the claim is worth.
      expect(sawRecycle).toBe(true);
      // The claim. `widestField` and `narrowestRow` are deliberately the pessimistic
      // pair across rounds: the assertion holds only if *every* round's field was
      // narrower than *every* round's row, so a single stretched field fails it. The
      // two numbers are not from one layout pass, which is what makes this about the
      // rule rather than about a particular measurement.
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
    // The identity half. A mark says a reset ran somewhere; this says the object a mount
    // is looking at *is* the one that was reset, because its own counter — which the
    // reset does not clear — says it has been through a mount already.
    //
    // **The read happens while the control is still mounted**, and that is the whole
    // test. Read after the unmount, every handle says `drops=1 recycles=1`: the drop and
    // the pool entry have both run on it by then, so a freshly allocated instance reads
    // exactly like a reused one and the assertion proves nothing. Read while mounted, a
    // fresh view can only say `drops=0 recycles=0` — nothing has dropped it yet — and
    // `recycles >= 1` is reachable only by a view the pool popped for this mount.
    //
    // The churn is one `render` plus rerenders, and the swap is by `key`, for two
    // reasons. A swap by key deletes and re-adds inside the same parent, which is what
    // drops one instance and asks for another; and it stays on the *same surface*, which
    // matters because RN's pool is keyed by `surfaceId` and `onSurfaceStopped` empties it
    // — a churn that tore the root down between rounds would be paying for a new pool
    // every time. Alternating `value` as well, so every round's control has to have
    // received its own props: a recycled view that came back as a corpse with tidy
    // counters would satisfy a counter assertion without being a control anyone could use.
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
      // The read, while this mount is live. `latestHandle()` is the handle *this* round
      // delivered, so the numbers are about the instance currently on screen.
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
    // Thrown, not `expect`, and with every round in the message: the assertion is only
    // convincing next to the whole series, and a device run carries a thrown Error out of
    // the process where `console.log` goes nowhere (the lesson `Conformance.harness.tsx`
    // learned the hard way).
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
        // Pay the one-time costs first, and fill the pool: it is a cache, so the first
        // cycle legitimately raises the floor to hold its contents. Measuring from the
        // second floor is what makes the slope about retention rather than about a cache
        // reaching its working set (MountChurn.harness.tsx does the same).
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

        // The witness that the loop recycled at all. Every churned row carries
        // `nuiPerfId`, and the ring is drained each cycle, so this is that cycle's own
        // hand-backs and not a running total. Zero across every cycle would mean the pool
        // never ran, and the flat heap below would be measuring something else entirely.
        expect(
          recycledPerCycle.reduce((sum, value) => sum + value, 0)
        ).toBeGreaterThan(0);
        // The last floor still has room to grow: a run that passes the slope while
        // sitting at the heap limit is not a pass.
        expect(toMib(last.maxBytes) - toMib(last.usedBytes)).toBeGreaterThan(
          20
        );
        expect(growthMib).toBeLessThan(MAX_FLOOR_GROWTH_MIB_PER_CYCLE);
      } finally {
        nitroUiCore.setPerfEnabled(false);
      }
    });

    /**
     * The drop-path branches B1 could only measure once, by hand: nothing happens, and
     * nothing happens across a whole churn.
     *
     * B1's re-review called both "honest, but unasserted": the post-drop measure and
     * layout path (its N5 — `stopSurface` drops views before taking the root out, so a
     * dropped host can still be measured while attached) and the listener shape it filed
     * as near-unreachable (M2 — a sizing flush scheduled while detached, then attach,
     * then detach before a frame, then drop). The counting lives in the shipping code
     * (`NitroComposeHost`'s companion: `processMeasuresAfterDrop`,
     * `processLayoutsAfterDrop`, `giveUpUnregisters`, `floatingFlushSchedules`) and all
     * four are **process-wide totals**, which is what makes a zero mean anything: the
     * host whose guard fired is the one object a harness holds no handle for, and the
     * population is every mount the process has done, not the one control being read.
     *
     * A delta across a churn, not an absolute: the totals are monotonic and other tests
     * in this file mount and drop controls, so an absolute zero would be a claim about
     * test ordering. A delta of zero says 600 mounts, 600 drops and 600 pool entries
     * produced no post-drop ask, which is the measured negative B1's re-review asked for.
     *
     * The number is only as honest as the counter, and that is the next test's job: it
     * drives the shape and shows the counter can move.
     */
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
        // Thrown with both reports inside the message, the way `Conformance.harness.tsx`
        // learned to report: a device run carries a thrown Error out of the process and
        // carries `console.log` out of it in none of the runs anyone has tried.
        throw new Error(
          `${grew.join(', ')} ${grew.length === 1 ? 'rose' : 'rose'} across a churn ` +
            `of ${String(COUNT)} controls, so B1's unreachable drop-path branch is a ` +
            `live leak path. before=${JSON.stringify(before)} ` +
            `after=${JSON.stringify(after)}`
        );
      }
    });

    /**
     * B1's N5 shape, driven on purpose, to show the guard fires and the counter counts.
     *
     * A zero from a counter nobody has ever seen move is an assumption wearing a number.
     * So this asks the example app to do the thing `stopSurface` does — drop a hosted
     * control while it is still attached, then let the framework measure it — and reads
     * the answer two ways: the view's own `measuredWidth` (`0` = the guard declined; any
     * other number = it composed a UI for a mount that no longer exists, which is the
     * leak) and the same process-wide counters as the test above, which have to have moved
     * by *exactly one* — the probe makes exactly one measure call.
     *
     * It is also the only place the guard is *seen working* on Android. With recycling on,
     * `onDropView` and `prepareToRecycleView` arrive back to back, so in normal operation
     * the window the guard covers is entered only by `stopSurface`, which no harness here
     * produces. That is what made the rule deletable before this round.
     *
     * Ordering matters twice over. The control must still be **mounted** when the probe
     * walks the tree (the harness tears the whole root down between tests, so a probe run
     * after the last `unmount()` sees an empty app and says `no-host`), and the "after"
     * read must go through a *live* handle for the same reason. So: read the totals, mount
     * the control, probe, read again, then unmount.
     */
    it('declines, and counts, a host dropped while it is still attached', async () => {
      const before = lifetimeFields(await readLifetimeLine());

      const { unmount } = await render(oneSwitch(false));
      await waitForTestId('recycling-switch', 5000);
      await settle();

      const answer = await probeModule().simulatePostDropMeasure();
      // Read through the handle this test's own render delivered, which is still on
      // screen. The probe has dropped the view it found, which may or may not be this
      // one; either way the numbers are the process's.
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
      // The precondition, stated as data: the guard only matters for a dropped host that
      // is still attached, so a probe that found an already-detached view would be
      // measuring the wrong thing and reporting a passing width.
      expect(answer).toContain('attached=true');
      // The guard. `measuredWidth=0` is the decline: the alternative is a view that
      // measured, and so composed, for a mount whose composition was already disposed.
      expect(answer).toContain('measuredWidth=0');
      // The counter, moved by exactly the one ask the probe made. Without this half the
      // assertion above could be satisfied by a guard that never ran, which is the failure
      // mode a "must not happen" gate has and a "must happen" gate does not.
      expect(after.measuresAfterDrop).toBe((before.measuresAfterDrop ?? 0) + 1);
    });
  });
} else {
  /**
   * iOS: measured, not cited, because round 1 of this file asserted two absences that
   * turned out not to be true. It said `HermesInternal` does not exist and
   * `performance.memory` is unimplemented; a run says `HermesInternal` **is** present and
   * `performance.memory.usedJSHeapSize` **is** readable and live. So the reason iOS has no
   * recycling leak gate is not that JS cannot see memory, and the reason has to be stated
   * as three facts this test measures every run:
   *
   * 1. **No way to force a collection.** `HermesInternal` exposes no enumerable methods,
   *    and neither `getHeapInfo` nor `collectGarbage` is among them. The Android gate is a
   *    slope on a *post-collect* floor (`Runtime.totalMemory()` after `System.gc()`);
   *    without a collect, a series of readings measures when the GC happened to run, not
   *    what is retained.
   * 2. **No ceiling to size a tolerance against.** `jsHeapSizeLimit` is `null`, so the
   *    "the floor still has room to grow" half of the Android assertion — which is what
   *    stops a pass at the heap limit — has no iOS equivalent.
   * 3. **The leak this gate exists to catch is not on the JS heap.** On Android the
   *    retention B1 measured was Java-heap objects (host, `ComposeContent`,
   *    `AndroidComposeView`, ~42 KiB and one lifecycle observer each), which is why the
   *    probe reads the Java heap. On iOS the same shape would be SwiftUI/UIKit objects in
   *    native memory, which a JS-heap number cannot see at any sampling rate.
   *
   * Point 1 is why the number cannot be patched into a gate anyway, and the test below
   * shows the number *is* live rather than frozen — `usedJSHeapSize` did move across a
   * churn (5.97 MiB before, 8.60 MiB after 200 Switches, in the run that established
   * this). A live number you cannot pin to a collection is still not a floor.
   *
   * Registered, not skipped: a skipped test asserts nothing. This one pins the three facts
   * and has a future — the day a collect handle or a heap limit appears, it goes red and
   * tells whoever added it to write the gate (the follow-up in
   * `docs/tasks/FOLLOWUPS.md` is the same instruction).
   */
  /**
   * `performance.memory.usedJSHeapSize` on both sides of a churn, because the test needs
   * the pair and `churnCycle` returns nothing.
   */
  async function sampleUsedJsHeapAcrossChurn(prefix: string): Promise<{
    before: number;
    after: number;
  }> {
    const read = () =>
      (
        globalThis as unknown as {
          performance?: { memory?: { usedJSHeapSize?: number } };
        }
      ).performance?.memory?.usedJSHeapSize ?? 0;
    const before = read();
    await churnCycle(prefix);
    await settle(400);
    return { before, after: read() };
  }

  describe('recycling · what iOS can measure about leaks (F6)', () => {
    it('has a JS heap number but no way to pin it to a collection, so no floor gate', async () => {
      const g = globalThis as unknown as {
        HermesInternal?: Record<string, unknown>;
        performance?: { memory?: Record<string, number | undefined> };
      };
      const hermes = g.HermesInternal;
      const asHeap = hermes as unknown as {
        getHeapInfo?: unknown;
        collectGarbage?: unknown;
      };
      const memory = g.performance?.memory;
      const used = memory?.usedJSHeapSize;

      // The readout has to be a real number, or the rest of this test is about nothing.
      expect(typeof used).toBe('number');
      expect(used).toBeGreaterThan(0);
      expect(memory?.jsHeapSizeLimit).toBeNull();
      expect(asHeap?.getHeapInfo).toBeUndefined();
      expect(asHeap?.collectGarbage).toBeUndefined();

      // And live, not frozen: `performance.memory` could in principle be a constant stub,
      // in which case "we could not gate on it" would be the wrong reason. Sampled across
      // a real churn, it has to answer differently. Measured on the simulator, it is also
      // *not* monotonic in an obvious way — an 8 MiB JS ballast made it go down (5.97 MiB
      // before, 4.30 MiB holding the ballast, 9.02 MiB after a 200-Switch churn) — which is
      // exactly the problem: a series of uncollected readings tracks when the GC happened
      // to run, so only its direction is safe to assert, not its sign or its slope.
      const samples = await sampleUsedJsHeapAcrossChurn('ios-readout');
      // Thrown evidence is what survives a device run, but the pair is worth logging too:
      // it is the number a future reader needs in order to judge whether a slope gate
      // would even be stable here.
      console.log(
        `    · iOS usedJSHeapSize across a churn: ${String(
          samples.before
        )} -> ${String(samples.after)} (no forced collect, no limit)`
      );
      expect(samples.after).toBeGreaterThan(0);
      expect(samples.after).not.toBe(samples.before);
    });
  });
}
