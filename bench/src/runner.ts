import {
  awaitMountNs,
  awaitPresentedNs,
  collectGarbage,
  heapBreakdown,
  nextFrameNs,
  probe,
  settle,
} from './probe';
import type { BenchPlan, BenchRecord } from './types';

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
 */
async function measureLatency(
  engine: Engine,
  target: IterationTarget
): Promise<void> {
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

    if (!warmup) mountBatch.start();
    await measureLatency(engine, target);
    if (!warmup) mountBatch.stop();

    if (!warmup) unmountBatch.start();
    await teardown(engine, target);
    if (!warmup) unmountBatch.stop();
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

    if (!warmup) opBatch.start();
    await measureLatency(engine, {
      count: plan.n,
      value,
      plan,
      launch,
      index,
      warmup,
    });
    if (!warmup) opBatch.stop();
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
