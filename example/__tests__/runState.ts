/**
 * What the harness runner published about this run, read from the app over the dev
 * server: whether the run opted out of the pinned locale for locale-dependent rows.
 */
import { TurboModuleRegistry } from 'react-native';

type SourceCodeModule = { getConstants(): { scriptURL?: string } };

const sourceCode = TurboModuleRegistry.getEnforcing(
  'SourceCode'
) as unknown as SourceCodeModule;

/** Where the runner publishes the run's state, relative to Metro's root. */
const STATE_PATH = '/harness-run/state.json';

const READ_TIMEOUT_MS = 3000;

/** The publisher refreshes every 2 s, so anything older is from a run that is gone. */
const STALE_MS = 15000;

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
 * Whether this run opted out of the pinned locale. `false` unless the run's own fresh
 * state file says otherwise, so a missing, stale or foreign file fails a mismatch
 * instead of quietly allowing it. `note` says why, for the log.
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

/** The environment variable the opt-out is set with. */
export const ALLOW_LOCALE_MISMATCH_ENV = 'NITRO_UI_ALLOW_LOCALE_MISMATCH';
