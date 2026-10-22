import { nextFrameNs, probe, settle, waitForMountNs } from './probe';
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
  /** Running total of `React.Profiler` `actualDuration`. See the release-build caveat in BenchApp. */
  profilerTotalMs(): number;
}

interface IterationTarget {
  count: number;
  value: boolean;
  plan: BenchPlan;
  launch: number;
  index: number;
  warmup: boolean;
}

async function measureLatency(
  engine: Engine,
  target: IterationTarget
): Promise<void> {
  const { t0, tCommit } = await engine.commit(target.count, target.value);

  const jsCommitNs = tCommit - t0;
  const mountedAt = await waitForMountNs();
  const mountedNs = mountedAt === null ? null : mountedAt - t0;
  const presentedAt = await nextFrameNs();
  const presentedNs = presentedAt - t0;

  engine.emit({
    kind: 'iter',
    scenario: target.plan.scenario,
    implementation: target.plan.implementation,
    n: target.plan.n,
    launch: target.launch,
    index: target.index,
    warmup: target.warmup,
    jsCommitNs,
    mountedNs,
    presentedNs,
  });
}

interface CpuBracket {
  jsBefore: number;
  mainBefore: number;
  profilerBefore: number;
}

function cpuBracketStart(engine: Engine): CpuBracket {
  return {
    jsBefore: probe.threadCpuNs('js'),
    mainBefore: probe.threadCpuNs('main'),
    profilerBefore: engine.profilerTotalMs(),
  };
}

function cpuBracketEnd(
  engine: Engine,
  plan: BenchPlan,
  launch: number,
  iterations: number,
  start: CpuBracket
): void {
  const jsAfter = probe.threadCpuNs('js');
  const mainAfter = probe.threadCpuNs('main');
  engine.emit({
    kind: 'cpu',
    scenario: plan.scenario,
    implementation: plan.implementation,
    n: plan.n,
    launch,
    iterations,
    jsCpuNs: jsBeforeOrNull(jsAfter, start.jsBefore),
    mainCpuNs: jsBeforeOrNull(mainAfter, start.mainBefore),
    profilerTotalMs: engine.profilerTotalMs() - start.profilerBefore,
  });
}

function jsBeforeOrNull(after: number, before: number): number | null {
  if (after < 0 || before < 0) {
    return null;
  }
  const delta = after - before;
  return delta < 0 ? null : delta;
}

/**
 * `mount`: tear the batch down, then mount `n` controls and time the commit,
 * the native mount and the following presented frame. A fresh mount is forced
 * per iteration by unmounting first and letting two frames pass, so a leftover
 * mount from the previous iteration can never be attributed to this one.
 */
export async function runMountScenario(
  engine: Engine,
  plan: BenchPlan,
  launch: number
): Promise<void> {
  let value = false;
  let cpuStart: CpuBracket | null = null;

  for (
    let index = 0;
    index < WARMUP_ITERATIONS + MEASURED_ITERATIONS;
    index++
  ) {
    const warmup = index < WARMUP_ITERATIONS;
    if (!warmup && cpuStart === null) {
      cpuStart = cpuBracketStart(engine);
    }

    await engine.commit(0, value);
    await nextFrameNs();
    await nextFrameNs();
    await settle(20);

    await measureLatency(engine, {
      count: plan.n,
      value,
      plan,
      launch,
      index,
      warmup,
    });
  }

  if (cpuStart !== null) {
    cpuBracketEnd(engine, plan, launch, MEASURED_ITERATIONS, cpuStart);
  }
}

/**
 * `update`: mount the batch once, then flip the controlled value K times, each
 * awaited to its own presented frame. `mountedNs` here is "native applied the
 * update", because the same mounting-transaction signal covers updates.
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

  let cpuStart: CpuBracket | null = null;

  for (
    let index = 0;
    index < WARMUP_ITERATIONS + MEASURED_ITERATIONS;
    index++
  ) {
    const warmup = index < WARMUP_ITERATIONS;
    if (!warmup && cpuStart === null) {
      cpuStart = cpuBracketStart(engine);
    }
    value = !value;

    await measureLatency(engine, {
      count: plan.n,
      value,
      plan,
      launch,
      index,
      warmup,
    });
  }

  if (cpuStart !== null) {
    cpuBracketEnd(engine, plan, launch, MEASURED_ITERATIONS, cpuStart);
  }
}

/** Footprint sample: collect, settle, then read (footprint is slow on Android). */
async function sampleFootprint(
  engine: Engine,
  plan: BenchPlan,
  launch: number,
  phase: string
) {
  probe.gc();
  await settle(1000);
  engine.emit({
    kind: 'mem',
    scenario: plan.scenario,
    implementation: plan.implementation,
    n: plan.n,
    launch,
    phase,
    footprintBytes: probe.footprintBytes(),
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
 * `leak`: repeated mount/unmount cycles with a footprint sample after each, so
 * a monotonic climb (a leak) is visible in the slope rather than hidden by a
 * single sample.
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
    probe.gc();
    await settle(400);
    engine.emit({
      kind: 'mem',
      scenario: plan.scenario,
      implementation: plan.implementation,
      n: plan.n,
      launch,
      phase: `leak${cycle}`,
      footprintBytes: probe.footprintBytes(),
    });
  }
}
