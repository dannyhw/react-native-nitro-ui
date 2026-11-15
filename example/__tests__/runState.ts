/**
 * What this *run* decided, read from inside the app.
 *
 * X37 deleted the wall-clock half of this module. What is left is one flag: whether
 * the run said it meant to compare a locale-dependent row in a locale other than the
 * one the shared table names. It cannot ride the launch arguments, because the
 * question is not what the app was launched with — it is whether the run that is
 * judging these numbers opted out of its own pin. So the runner publishes it and the
 * app reads it back over the dev server, which is the one host port an emulator is
 * sure to reach (see `scripts/harness-run-state.js`).
 *
 * Nothing here is trusted without checking: the publisher refreshes the file every
 * 2 s while its run lives and deletes it on exit, so a reader that finds a file from
 * another Metro port, or one older than the refresh interval allows, treats it as
 * absent. Absent means *not allowed*, which is the direction that can produce a red
 * rather than a quiet green.
 */
import { TurboModuleRegistry } from 'react-native';

type SourceCodeModule = { getConstants(): { scriptURL?: string } };

const sourceCode = TurboModuleRegistry.getEnforcing(
  'SourceCode'
) as unknown as SourceCodeModule;

/** Where the runner publishes the run's state, relative to Metro's root. */
const STATE_PATH = '/harness-run/state.json';

/** A read this slow is not worth blocking a test for. */
const READ_TIMEOUT_MS = 3000;

/**
 * The publisher refreshes every 2s, so anything older than this belongs to a
 * run that is no longer alive - or to no run at all. Trusting it would be
 * reading a premise nobody is asserting.
 */
const STALE_MS = 15000;

/** What the runner publishes. */
type PublishedState = {
  readonly metroPort: number;
  readonly updatedAt: number;
  readonly allowLocaleMismatch?: boolean;
};

type FetchResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};
type FetchLike = (url: string) => Promise<FetchResponse>;

/** The dev server this bundle came from, or `null` when it came from a bundled file. */
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

/** The port part of {@link devServerOrigin}, or `null` when the origin has none. */
function portOf(origin: string): number | null {
  const match = /:(\d+)$/.exec(origin);
  return match === null ? null : Number.parseInt(match[1] ?? '', 10);
}

/** Shape-check a published file, or say it is not one. */
function asPublishedState(state: unknown): PublishedState | null {
  if (typeof state !== 'object' || state === null) return null;
  const candidate = state as Record<string, unknown>;
  for (const key of ['metroPort', 'updatedAt']) {
    if (typeof candidate[key] !== 'number') return null;
  }
  return state as PublishedState;
}

type StateRead =
  | { readonly kind: 'ok'; readonly state: PublishedState }
  | { readonly kind: 'absent'; readonly reason: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Read the file this run published about itself, from the app. */
async function readState(origin: string): Promise<StateRead> {
  const fetchFn = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof fetchFn !== 'function') {
    return { kind: 'absent', reason: 'this runtime has no fetch' };
  }

  let response: FetchResponse;
  try {
    const request = fetchFn(origin + STATE_PATH);
    response = await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out')), READ_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    return {
      kind: 'absent',
      reason: `could not reach ${origin + STATE_PATH} (${String(error)})`,
    };
  }

  if (!response.ok) {
    return {
      kind: 'absent',
      reason: `${origin + STATE_PATH} answered ${String(response.status)}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: `${origin + STATE_PATH} is not JSON (${String(error)})`,
    };
  }

  const state = asPublishedState(body);
  if (state === null) {
    return {
      kind: 'unreadable',
      reason: `${origin + STATE_PATH} is not a run-state file`,
    };
  }

  const port = portOf(origin);
  if (port !== null && state.metroPort !== port) {
    return {
      kind: 'unreadable',
      reason:
        `${origin + STATE_PATH} was published for Metro port ` +
        `${String(state.metroPort)}, not this run's ${String(port)} - an earlier ` +
        'run left it behind',
    };
  }

  const ageMs = Date.now() - state.updatedAt;
  if (ageMs > STALE_MS) {
    return {
      kind: 'unreadable',
      reason:
        `${origin + STATE_PATH} was last written ${String(
          Math.round(ageMs / 1000)
        )}s ago, and the publisher refreshes every 2s - the run that wrote ` +
        'it is gone',
    };
  }

  return { kind: 'ok', state };
}

/**
 * Did this run say it means to compare a locale-dependent row in a locale other than
 * the one the table names?
 *
 * `false` unless the run's own published state says otherwise, which is the only
 * direction that can produce a red rather than a quiet green: no state file, a file
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
  const read = await readState(origin);
  if (read.kind !== 'ok') {
    return { allowed: false, note: `${read.kind}: ${read.reason}` };
  }
  return {
    allowed: read.state.allowLocaleMismatch === true,
    note: `${ALLOW_LOCALE_MISMATCH_ENV}=${String(
      read.state.allowLocaleMismatch === true
    )}`,
  };
}

/** The variable the opt-out is set with, named in the failure message a run reads. */
export const ALLOW_LOCALE_MISMATCH_ENV = 'NITRO_UI_ALLOW_LOCALE_MISMATCH';
