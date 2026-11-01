/**
 * The quiet-machine gate for wall-clock assertions (D21).
 *
 * Structural counters - corrections, immediate pushes, flushes, stale frames,
 * event counts - are asserted on every harness run, on every machine: a wrong
 * count is wrong at any load. A threshold on a *duration* is not, because
 * several tasks share this machine and a busy host turns a correct
 * implementation red. So a duration goes through here, which does one of three
 * things:
 *
 *  - `HARNESS_TIMING` unset: log the measurement and skip the threshold. The
 *    number still reaches the log, so a regression is visible - it is not a
 *    verdict.
 *  - `HARNESS_TIMING=1`, quiet machine: assert it, and fail on the miss.
 *  - `HARNESS_TIMING=1`, busy machine (1-minute load average at or above the
 *    published `busyLoad1`): refuse. A gate that cannot tell a slow build from
 *    a slow host is not evidence, and a run that says nothing is better than a
 *    run that lies.
 *
 * The assertions run inside the app, which cannot see this machine's load
 * average or environment. The harness runner publishes both (see
 * `scripts/harness-timing-gate.js`) to a file under `example/`, which Metro
 * serves per request through a route that config declares - so this reads the
 * load average at the moment of the assertion, not the one from bundle time.
 * The file is gitignored and owned by whichever harness run is alive; nothing
 * here trusts it without checking `metroPort` and its age first.
 */
import { TurboModuleRegistry } from 'react-native';
import { expect } from 'react-native-harness';

type SourceCodeModule = { getConstants(): { scriptURL?: string } };

const sourceCode = TurboModuleRegistry.getEnforcing(
  'SourceCode'
) as unknown as SourceCodeModule;

/** Where the runner publishes the machine state, relative to Metro's root. */
const GATE_PATH = '/harness-timing/state.json';

/** A read this slow is not worth blocking a test for. */
const READ_TIMEOUT_MS = 3000;

/**
 * The publisher refreshes every 2s, so anything older than this belongs to a
 * run that is no longer alive - or to no run at all. Trusting it would be
 * gating on a machine nobody is measuring.
 */
const STALE_MS = 15000;

/** What the runner publishes. `busyLoad1` travels with it so the threshold is
 *  the one this run decided on rather than a copy that can drift. */
type PublishedGate = {
  readonly harnessTiming: boolean;
  readonly load1: number;
  readonly load5: number;
  readonly cores: number;
  readonly busyLoad1: number;
  readonly metroPort: number;
  readonly updatedAt: number;
  /**
   * Whether the *run* said it meant to test a locale the declared-fallback table
   * was not measured in. Read by the conformance rule, not by a duration gate; it
   * is published here because a test inside the app cannot see the runner's
   * environment, and a premise someone opted out of has to be stated rather than
   * inferred. Absent means false: the answer that can only produce a red, never a
   * quiet green.
   */
  readonly allowLocaleMismatch?: boolean;
};

/**
 * `fetch` exists on the runtime but is not in this project's libs
 * (`lib: ["ESNext"]`, no DOM), so it is declared rather than assumed.
 */
type FetchResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};
type FetchLike = (url: string) => Promise<FetchResponse>;

/**
 * The dev server this app's JS came from - `http://localhost:8293` on a
 * simulator, `http://10.0.2.2:8293` on an emulator reached through `adb
 * reverse`. Same origin, so one code path covers both platforms.
 *
 * @returns the origin, or `null` when the bundle did not come from a server
 */
function devServerOrigin(): string | null {
  let scriptURL = '';
  try {
    scriptURL = sourceCode.getConstants().scriptURL ?? '';
  } catch {
    return null;
  }
  const match = /^\w+:\/\/[^/]+/.exec(scriptURL);
  return match === null ? null : match[0];
}

/**
 * @param {string} origin A dev-server origin
 * @returns the port it says it serves, or `null`
 */
function portOf(origin: string): number | null {
  const match = /:(\d+)$/.exec(origin);
  return match === null ? null : Number.parseInt(match[1] ?? '', 10);
}

/**
 * @param gate A value read from the gate file
 * @returns it typed, or `null` when it is not a gate at all
 */
function asPublishedGate(gate: unknown): PublishedGate | null {
  if (typeof gate !== 'object' || gate === null) return null;
  const candidate = gate as Record<string, unknown>;
  const numbers = [
    'load1',
    'load5',
    'cores',
    'busyLoad1',
    'metroPort',
    'updatedAt',
  ];
  if (typeof candidate.harnessTiming !== 'boolean') return null;
  for (const key of numbers) {
    if (typeof candidate[key] !== 'number') return null;
  }
  return gate as PublishedGate;
}

/**
 * How reading the machine state went. `absent` is not an error: a run whose
 * Metro was started by something else has no gate, and every duration then
 * reports without gating - which is what D21 asks for when nothing asked for a
 * verdict. Anything else (a file from another run, a half-written one, a stale
 * one) is a bug, and says so.
 */
type GateRead =
  | { readonly kind: 'ok'; readonly gate: PublishedGate }
  | { readonly kind: 'absent'; readonly reason: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

async function readGate(origin: string): Promise<GateRead> {
  const fetchFn = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof fetchFn !== 'function') {
    return { kind: 'absent', reason: 'this runtime has no fetch' };
  }

  let response: FetchResponse;
  try {
    const request = fetchFn(origin + GATE_PATH);
    response = await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out')), READ_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    return {
      kind: 'absent',
      reason: `could not reach ${origin + GATE_PATH} (${String(error)})`,
    };
  }

  if (!response.ok) {
    return {
      kind: 'absent',
      reason: `${origin + GATE_PATH} answered ${String(response.status)}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: `${origin + GATE_PATH} is not JSON (${String(error)})`,
    };
  }

  const gate = asPublishedGate(body);
  if (gate === null) {
    return {
      kind: 'unreadable',
      reason: `${origin + GATE_PATH} is not a gate file`,
    };
  }

  const port = portOf(origin);
  if (port !== null && gate.metroPort !== port) {
    return {
      kind: 'unreadable',
      reason:
        `${origin + GATE_PATH} was published for Metro port ` +
        `${String(gate.metroPort)}, not this run's ${String(port)} - an earlier ` +
        'run left it behind',
    };
  }

  const ageMs = Date.now() - gate.updatedAt;
  if (ageMs > STALE_MS) {
    return {
      kind: 'unreadable',
      reason:
        `${origin + GATE_PATH} was last written ${String(
          Math.round(ageMs / 1000)
        )}s ago, and the publisher refreshes every 2s - the run that wrote ` +
        'it is gone',
    };
  }

  return { kind: 'ok', gate };
}

function describeMachine(gate: PublishedGate): string {
  return (
    `load1 ${gate.load1.toFixed(2)}/load5 ${gate.load5.toFixed(2)} over ` +
    `${String(gate.cores)} cores`
  );
}

/**
 * Did this run say it means to compare a locale-dependent row in a locale other than
 * the one the table names?
 *
 * `false` unless the run's own published state says otherwise, which is the only
 * direction that can produce a red rather than a quiet green: no gate file, a gate
 * from another run, a stale one, or a publisher too old to carry the field all answer
 * "not allowed", and the rule then compares the box and fails on a mismatch. The
 * reason travels back for the log, so an unexpected red says whether the opt-out was
 * absent or merely unreadable.
 */
export async function localeMismatchAllowed(): Promise<{
  readonly allowed: boolean;
  readonly note: string;
}> {
  const origin = devServerOrigin();
  if (origin === null) {
    return {
      allowed: false,
      note: 'no dev server to ask (this bundle did not come from one)',
    };
  }
  const read = await readGate(origin);
  if (read.kind !== 'ok') {
    return { allowed: false, note: `${read.kind}: ${read.reason}` };
  }
  return {
    allowed: read.gate.allowLocaleMismatch === true,
    note: `${ALLOW_LOCALE_MISMATCH_ENV}=${String(
      read.gate.allowLocaleMismatch === true
    )}`,
  };
}

/** The variable the opt-out is set with, named in the failure message a run reads. */
export const ALLOW_LOCALE_MISMATCH_ENV = 'NITRO_UI_ALLOW_LOCALE_MISMATCH';

/**
 * Report one wall-clock measurement, and gate it only when this run asked for a
 * verdict and the machine can give one.
 *
 * @param options
 * @param options.label What this measurement is, for the log and the failure.
 * @param options.measuredMs The duration, in ms.
 * @param options.limitMs The threshold it must stay under, in ms.
 * @param options.note Context for the log - where the bar came from.
 * @throws when the gate is on, the machine is busy, or the published state is
 *   unreadable in a way that means someone's run is broken.
 */
export async function expectTimingBudget(options: {
  label: string;
  measuredMs: number;
  limitMs: number;
  note?: string;
}): Promise<void> {
  const { label, measuredMs, limitMs, note } = options;
  const origin = devServerOrigin();
  const suffix = note === undefined ? '' : ` · ${note}`;

  const read =
    origin === null
      ? ({
          kind: 'absent',
          reason: 'this bundle did not come from a dev server',
        } as const)
      : await readGate(origin);

  if (read.kind === 'absent') {
    console.log(
      `timing: ${label} ${measuredMs.toFixed(1)}ms (limit ${String(
        limitMs
      )}ms) - reported, not gated (D21): ${read.reason}${suffix}`
    );
    return;
  }

  if (read.kind === 'unreadable') {
    throw new Error(
      `timing gate for "${label}" cannot be trusted: ${read.reason}. ` +
        'Fix the run (every harness run publishes its machine state) rather ' +
        'than removing the assertion.'
    );
  }

  const { gate } = read;
  if (!gate.harnessTiming) {
    console.log(
      `timing: ${label} ${measuredMs.toFixed(1)}ms (limit ${String(
        limitMs
      )}ms) - reported, not gated (D21: HARNESS_TIMING=1 gates it) · ` +
        `${describeMachine(gate)}${suffix}`
    );
    return;
  }

  if (gate.load1 >= gate.busyLoad1) {
    throw new Error(
      `timing gate for "${label}" refuses to judge: this machine is busy ` +
        `(load1 ${gate.load1.toFixed(2)} >= ${String(
          gate.busyLoad1
        )}). Measured ${measuredMs.toFixed(1)}ms against a ` +
        `${String(limitMs)}ms limit on ${describeMachine(gate)}${suffix}. ` +
        'That is not evidence either way - re-run on a quiet machine, or drop ' +
        'HARNESS_TIMING to report the number without judging it.'
    );
  }

  console.log(
    `timing: ${label} ${measuredMs.toFixed(1)}ms gated at ${String(
      limitMs
    )}ms (${describeMachine(gate)}, under the busy bar of ${String(
      gate.busyLoad1
    )})${suffix}`
  );
  expect(measuredMs).toBeLessThan(limitMs);
}
