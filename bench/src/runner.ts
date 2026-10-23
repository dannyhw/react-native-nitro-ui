import {
  awaitMountNs,
  awaitPresentedNs,
  collectGarbage,
  heapBreakdown,
  nextFrameNs,
  probe,
  settle,
} from './probe';
import type { BenchPerfMark, BenchPlan, BenchRecord } from './types';

/** Noise control protocol (docs/research/setup-decisions.md SS6). */
export const WARMUP_ITERATIONS = 5;
export const MEASURED_ITERATIONS = 20;
/** Wall-clock settle after launch, before anything is timed. */
export const LAUNCH_SETTLE_MS = 1000;
/** Leak-slope cycles for the `leak` scenario. */
export const LEAK_CYCLES = 10;

/**
 * What a scenario needs from the React side: change the mounted state and get
 * back the timestamp taken *before* `setState` plus the one taken inside the
 * parent's `useLayoutEffect`, which is the JS commit boundary.
 */
export interface Engine {
  commit(
    nextCount: number,
    nextValue: boolean
  ): Promise<{ t0: number; tCommit: number }>;
  emit(record: BenchRecord): void;
  /**
   * The runtime's own native perf marks, or `null` when this arm has none or the
   * launch did not ask for them (`bun bench --perf-marks`).
   */
  drainPerfMarks: (() => BenchPerfMark[] | null) | null;
}

interface IterationTarget {
  count: number;
  value: boolean;
  plan: BenchPlan;
  launch: number;
  index: number;
  warmup: boolean;
}

/**
 * One measured operation: commit, native apply, presenting frame.
 *
 * `mountedNs`/`presentedNs` are absolute D1 timestamps (`probe.now()` shares that
 * base), so each is reported as an offset from `t0` rather than a duration.
 *
 * Returns `t0` so the caller can put the runtime's own perf marks on this
 * iteration's timeline.
 */
async function measureLatency(
  engine: Engine,
  target: IterationTarget
): Promise<number> {
  const { t0, tCommit } = await engine.commit(target.count, target.value);

  const mountedAt = await awaitMountNs();
  const presentedAt = await awaitPresentedNs();

  engine.emit({
    kind: 'iter',
    scenario: target.plan.scenario,
    implementation: target.plan.implementation,
    n: target.plan.n,
    launch: target.launch,
    index: target.index,
    warmup: target.warmup,
    jsCommitNs: tCommit - t0,
    mountedNs: mountedAt === null ? null : mountedAt - t0,
    presentedNs: presentedAt === null ? null : presentedAt - t0,
  });
  return t0;
}

/**
 * Fold one iteration's native perf marks into a `perf` record.
 *
 * Called **outside every CPU bracket**: `drainPerf()` crosses into native code,
 * allocates per mark and hands an array to JS, so draining inside a bracket would
 * charge the JS thread for reading the marks - and marking itself is already a
 * mutex write on the UI thread. That is why a `--perf-marks` run is a diagnostic
 * that explains a measured number rather than a second measurement.
 *
 * It answers: how many `updateState`s one flip really caused (`propsApplied` per
 * instance), whether the hosted content drew at all (`firstFrame`), and how long
 * the library's own props-to-pixels span took. Marks arrive oldest first, so the
 * last of a kind is the newest.
 */
function emitPerfMarks(
  engine: Engine,
  target: IterationTarget,
  t0: number
): void {
  const drain = engine.drainPerfMarks;
  if (drain === null) {
    return;
  }
  const marks = drain();
  if (marks === null) {
    return;
  }

  let propsApplied = 0;
  let firstFrame = 0;
  let lastPropsNs: number | null = null;
  let lastFrameNs: number | null = null;
  const instances = new Set<number>();
  for (const mark of marks) {
    if (mark.kind === 'propsApplied') {
      propsApplied += 1;
      lastPropsNs = mark.timeNs;
    } else if (mark.kind === 'firstFrame') {
      firstFrame += 1;
      lastFrameNs = mark.timeNs;
    } else {
      continue;
    }
    instances.add(mark.instanceId);
  }

  engine.emit({
    kind: 'perf',
    scenario: target.plan.scenario,
    implementation: target.plan.implementation,
    n: target.plan.n,
    launch: target.launch,
    index: target.index,
    propsApplied,
    firstFrame,
    instances: instances.size,
    propsAppliedNs: lastPropsNs === null ? null : lastPropsNs - t0,
    firstFrameNs: lastFrameNs === null ? null : lastFrameNs - t0,
    drawLatencyNs:
      lastPropsNs !== null && lastFrameNs !== null && lastFrameNs >= lastPropsNs
        ? lastFrameNs - lastPropsNs
        : null,
  });
}

/**
 * Teardown of the batch, timed by its own CPU bracket.
 *
 * Tearing down `n` hosting controllers is real work - unmounting it used to sit
 * inside the "mount" bracket, so a costlier teardown looked like a costlier
 * mount (T02 review S5).
 */
async function teardown(
  engine: Engine,
  target: IterationTarget
): Promise<void> {
  await engine.commit(0, target.value);
  await awaitMountNs();
}

/**
 * Drop whatever the warmups recorded, so the first measured iteration's marks are
 * its own. `setPerfEnabled(true)` clears the ring, but it runs before the warmups.
 */
function discardPerfMarks(engine: Engine): void {
  if (engine.drainPerfMarks !== null) {
    engine.drainPerfMarks();
  }
}

/* ------------------------------------------------------------------ CPU ---- */

interface CpuSample {
  js: number;
  main: number;
}

/**
 * Sums one thread's CPU deltas over a batch of iterations.
 *
 * A delta is dropped (rather than clamped to 0) when either sample is missing or
 * the pair went backwards, so an unreadable counter yields `null` for the whole
 * batch instead of an understated number.
 */
class CpuBatch {
  private jsTotal = 0;
  private mainTotal = 0;
  private reliable = true;
  private open: CpuSample | null = null;

  start(): void {
    this.open = {
      js: probe.threadCpuNs('js'),
      main: probe.threadCpuNs('main'),
    };
  }

  stop(): void {
    const before = this.open;
    this.open = null;
    if (before === null) {
      return;
    }
    const js = probe.threadCpuNs('js');
    const main = probe.threadCpuNs('main');
    const jsDelta = deltaOrNull(js, before.js);
    const mainDelta = deltaOrNull(main, before.main);
    if (jsDelta === null || mainDelta === null) {
      this.reliable = false;
      return;
    }
    this.jsTotal += jsDelta;
    this.mainTotal += mainDelta;
  }

  emit(engine: Engine, plan: BenchPlan, launch: number, phase: string): void {
    const iterations = MEASURED_ITERATIONS;
    engine.emit({
      kind: 'cpu',
      scenario: plan.scenario,
      implementation: plan.implementation,
      n: plan.n,
      launch,
      phase: phase === 'unmount' ? 'unmount' : 'mount',
      iterations,
      jsCpuNs: this.reliable ? this.jsTotal : null,
      mainCpuNs: this.reliable ? this.mainTotal : null,
    });
  }
}

function deltaOrNull(after: number, before: number): number | null {
  if (after < 0 || before < 0) {
    return null;
  }
  const value = after - before;
  return value < 0 ? null : value;
}

/* -------------------------------------------------------------- scenarios --- */

/**
 * `mount`: mount `n` controls, measure, then tear them down.
 *
 * Each iteration is teardown -> two idle frames -> a short settle -> mount, so a
 * leftover mount from the previous iteration can never be attributed to this
 * one. The pacing sits outside both CPU brackets, and the teardown has its own
 * bracket, so `mount` CPU is the op alone.
 */
export async function runMountScenario(
  engine: Engine,
  plan: BenchPlan,
  launch: number
): Promise<void> {
  let value = false;
  const mountBatch = new CpuBatch();
  const unmountBatch = new CpuBatch();

  for (
    let index = 0;
    index < WARMUP_ITERATIONS + MEASURED_ITERATIONS;
    index++
  ) {
    const warmup = index < WARMUP_ITERATIONS;
    const target = {
      count: plan.n,
      value,
      plan,
      launch,
      index,
      warmup,
    };

    await nextFrameNs();
    await nextFrameNs();
    await settle(20);

    if (index === WARMUP_ITERATIONS) discardPerfMarks(engine);
    if (!warmup) mountBatch.start();
    const t0 = await measureLatency(engine, target);
    if (!warmup) mountBatch.stop();

    if (!warmup) unmountBatch.start();
    await teardown(engine, target);
    if (!warmup) unmountBatch.stop();
    if (!warmup) emitPerfMarks(engine, target, t0);
  }

  mountBatch.emit(engine, plan, launch, 'mount');
  unmountBatch.emit(engine, plan, launch, 'unmount');
}

/**
 * `update`: mount the batch once, then flip the controlled value K times.
 * `mountedNs` here is "native applied the update", because the same
 * mounting-transaction signal covers updates.
 */
export async function runUpdateScenario(
  engine: Engine,
  plan: BenchPlan,
  launch: number
): Promise<void> {
  let value = false;
  await engine.commit(plan.n, value);
  await settle(250);
  await nextFrameNs();

  const opBatch = new CpuBatch();

  for (
    let index = 0;
    index < WARMUP_ITERATIONS + MEASURED_ITERATIONS;
    index++
  ) {
    const warmup = index < WARMUP_ITERATIONS;
    value = !value;

    const target: IterationTarget = {
      count: plan.n,
      value,
      plan,
      launch,
      index,
      warmup,
    };

    if (index === WARMUP_ITERATIONS) discardPerfMarks(engine);
    if (!warmup) opBatch.start();
    const t0 = await measureLatency(engine, target);
    if (!warmup) opBatch.stop();
    if (!warmup) emitPerfMarks(engine, target, t0);
  }

  opBatch.emit(engine, plan, launch, 'mount');
}

/* ----------------------------------------------------------------- memory --- */

/**
 * Footprint sample: collect every heap, settle, then read.
 *
 * Both `phys_footprint` and PSS include the Hermes heap, so skipping a JS
 * collect measures garbage rather than the controls. Whether a collector was
 * reachable is recorded with the sample, because a release Hermes build is not
 * guaranteed to expose one.
 */
async function sampleFootprint(
  engine: Engine,
  plan: BenchPlan,
  launch: number,
  phase: string
) {
  const heapCollected = collectGarbage();
  await settle(1000);
  const { nativeHeapBytes, javaHeapBytes } = heapBreakdown();
  engine.emit({
    kind: 'mem',
    scenario: plan.scenario,
    implementation: plan.implementation,
    n: plan.n,
    launch,
    phase,
    footprintBytes: probe.footprintBytes(),
    heapCollected,
    nativeHeapBytes,
    javaHeapBytes,
  });
}

/**
 * `memory`: `(footprint(N) - footprint(0)) / N` after a collect and a settle,
 * as one sample per launch.
 */
export async function runMemoryScenario(
  engine: Engine,
  plan: BenchPlan,
  launch: number
): Promise<void> {
  await engine.commit(0, false);
  await sampleFootprint(engine, plan, launch, 'empty');

  await engine.commit(plan.n, false);
  await sampleFootprint(engine, plan, launch, 'full');
}

/**
 * `leak`: repeated mount/unmount cycles with a footprint sample after each, so a
 * monotonic climb (a leak) is visible in the slope rather than hidden by a
 * single sample. The reporter gates on that slope (T02 review S8).
 */
export async function runLeakScenario(
  engine: Engine,
  plan: BenchPlan,
  launch: number
): Promise<void> {
  await engine.commit(plan.n, false);
  await sampleFootprint(engine, plan, launch, 'leak0');

  for (let cycle = 1; cycle <= LEAK_CYCLES; cycle++) {
    await engine.commit(0, false);
    await settle(250);
    await engine.commit(plan.n, false);
    await settle(250);
    await sampleFootprint(engine, plan, launch, `leak${String(cycle)}`);
  }
}
