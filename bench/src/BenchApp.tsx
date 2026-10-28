import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { findImplementation } from './implementations';
import { parsePlan } from './plan';
import type { BenchPlatform } from './plan';
import { probe, probeClock } from './probe';
import {
  LAUNCH_SETTLE_MS,
  MEASURED_ITERATIONS,
  WARMUP_ITERATIONS,
  runLeakScenario,
  runMemoryScenario,
  runMountScenario,
  runUpdateScenario,
} from './runner';
import type { Engine } from './runner';
import type { BenchImplementation, BenchPlan, BenchRecord } from './types';

type Phase = 'idle' | 'running' | 'done' | 'skipped';

/**
 * Benchmark driver screen.
 *
 * One process runs exactly one (scenario, implementation, N) plan, unattended:
 * the runner launches us with `-benchPlan` / a `benchPlan` Intent extra, we
 * settle, loop, write NDJSON into the app container, echo it through
 * `NITRO_BENCH` logs as a fallback, and sit there until the runner kills us for
 * the next launch. Release build, so there is no Metro and no dev menu.
 */
export function BenchApp() {
  const plan = useMemo(
    () => parsePlan(probe.launchPlan(), Platform.OS as BenchPlatform),
    []
  );
  const implementation = useMemo(
    () => (plan === null ? null : findImplementation(plan.implementation)),
    [plan]
  );

  if (plan === null) {
    return <IdleScreen />;
  }
  if (implementation === null) {
    throw new Error(
      `NITRO_BENCH unknown implementation "${plan.implementation}"`
    );
  }

  return (
    <BenchRunner
      key={`${plan.scenario}:${plan.implementation}:${plan.n}`}
      plan={plan}
      implementation={implementation}
    />
  );
}

function IdleScreen() {
  return (
    <View style={styles.idle}>
      <Text testID="bench-status">NITRO_BENCH idle</Text>
    </View>
  );
}

function BenchRunner({
  plan,
  implementation,
}: {
  plan: BenchPlan;
  implementation: BenchImplementation;
}) {
  const [count, setCount] = useState(0);
  const [value, setValue] = useState(false);
  /**
   * Bumped by every `commit`, so a plan step that happens to re-apply the same
   * `n`/`value` still produces a real React commit instead of bailing out and
   * leaving the caller waiting forever.
   */
  const [, setNonce] = useState(0);

  const ticket = useRef<((tCommitNs: number) => void) | null>(null);
  const records = useRef<BenchRecord[]>([]);
  const [phase, setPhase] = useState<Phase>('running');

  useLayoutEffect(() => {
    const pending = ticket.current;
    if (pending !== null) {
      ticket.current = null;
      pending(probe.now());
    }
  });

  const commit = useCallback(
    (nextCount: number, nextValue: boolean) =>
      new Promise<{ t0: number; tCommit: number }>((resolve) => {
        const t0 = probe.now();
        ticket.current = (tCommit: number) => {
          resolve({ t0, tCommit });
        };
        // Arm before the state change: `lastMountNs` resets, so the only mount
        // that can be observed afterwards belongs to this commit.
        probe.armMountObserver();
        setNonce((current) => current + 1);
        setCount(nextCount);
        setValue(nextValue);
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const meta = (warmup: number, measured: number): BenchRecord => ({
        kind: 'meta',
        scenario: plan.scenario,
        implementation: plan.implementation,
        n: plan.n,
        launch: 0,
        warmup,
        measured,
        platform: `${Platform.OS} ${String(Platform.Version)}`,
        probeClock,
        mountSignal: plan.mountSignal,
        mountTimeoutMs: plan.mountTimeoutMs,
        presentedTimeoutMs: plan.presentedTimeoutMs,
      });

      const emit = (record: BenchRecord) => {
        records.current.push(record);
      };

      if (!implementation.available) {
        emit(meta(0, 0));
        emit({
          kind: 'skip',
          scenario: plan.scenario,
          implementation: plan.implementation,
          n: plan.n,
          launch: 0,
          reason: implementation.skipReason ?? 'unavailable',
        });
        finish();
        setPhase('skipped');
        return;
      }

      // An arm that implements some components and not others (T16's
      // `nitro-ui-host`, Switch only) must be *said* to be absent on the rest, not
      // launch and render an empty tree: zero controls still mounts fast, and a fast
      // mount of nothing is exactly the kind of number a table should not contain.
      if (
        implementation.components !== null &&
        !implementation.components.includes(plan.component)
      ) {
        emit(meta(0, 0));
        emit({
          kind: 'skip',
          scenario: plan.scenario,
          implementation: plan.implementation,
          n: plan.n,
          launch: 0,
          reason: `implements ${implementation.components.join(', ')} only`,
        });
        finish();
        setPhase('skipped');
        return;
      }

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, LAUNCH_SETTLE_MS);
      });

      emit(meta(WARMUP_ITERATIONS, MEASURED_ITERATIONS));

      const wantsMarks = plan.perfMarks;
      if (wantsMarks) {
        if (implementation.enablePerfMarks === null) {
          throw new Error(
            `NITRO_BENCH asked for perf marks on ${plan.implementation}, which has none`
          );
        }
        implementation.enablePerfMarks();
      }

      const engine: Engine = {
        commit,
        emit,
        drainPerfMarks: wantsMarks ? implementation.drainPerfMarks : null,
      };

      // The component is not part of this switch: every scenario is the same
      // sequence of commits, and which control a commit mounts is the arm's
      // business (`BenchListProps.component`).
      switch (plan.action) {
        case 'mount':
          await runMountScenario(engine, plan, 0);
          break;
        case 'update':
          await runUpdateScenario(engine, plan, 0);
          break;
        case 'memory':
          await runMemoryScenario(engine, plan, 0);
          break;
        case 'leak':
          await runLeakScenario(engine, plan, 0);
          break;
      }

      if (!cancelled) {
        finish();
        setPhase('done');
      }
    };

    const finish = () => {
      const sentinel: BenchRecord = {
        kind: 'end',
        scenario: plan.scenario,
        implementation: plan.implementation,
        n: plan.n,
        launch: 0,
        recordCount: records.current.length,
      };
      const lines = records.current.map((record) => JSON.stringify(record));
      lines.push(JSON.stringify(sentinel));
      const text = `${lines.join('\n')}\n`;
      const path = probe.writeNdjson(text);
      for (const record of records.current) {
        console.log(`NITRO_BENCH ${JSON.stringify(record)}`);
      }
      console.log(
        `NITRO_BENCH wrote ${String(records.current.length)} records to ${path}`
      );
    };

    run();

    return () => {
      cancelled = true;
    };
    // One plan per process; the runner relaunches for every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const List = implementation.List;

  return (
    <View style={styles.screen}>
      <Text testID="bench-status">
        {`NITRO_BENCH ${plan.scenario} ${plan.implementation} n=${String(plan.n)} ${phase}`}
      </Text>
      {/* No `React.Profiler` wrapper: it only reports when React is built with
          `__PROFILE__`, so in the release build the bench uses it would always
          read 0 ms and the report would print a number nobody asked for. The
          React-side cost is measured directly instead - `jsCommitNs` brackets
          the commit, and `ReactFabric-profiling` can be aliased in
          bench/metro.config.js by whoever wants that metric for real. */}
      <List
        n={count}
        value={value}
        component={plan.component}
        perfMarks={plan.perfMarks}
      />
      {/* Keep React from unmounting the text while the list grows large. */}
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  idle: { flex: 1, padding: 16 },
  screen: { flex: 1, padding: 4 },
  // Keeps React from unmounting the status text while the list grows large.
  spacer: { height: 1 },
});
