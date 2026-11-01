/**
 * The quiet-machine tag for the harness's wall-clock gates (D21).
 *
 * Structural counters (corrections, immediate pushes, flushes, stale frames,
 * event counts) are asserted on every harness run. A threshold on a *duration*
 * is not: several tasks share this machine, and a busy host turns a correct
 * implementation red. So a duration gate runs only when the harness was started
 * with `HARNESS_TIMING=1`, and it refuses to judge anything while the 1-minute
 * load average is at or above `BUSY_LOAD1`.
 *
 * The assertions run inside the app, which cannot see this machine's load
 * average, so the runner publishes it and the app reads it over the dev server.
 * Two halves:
 *
 *  - `publishTimingGate` (the runner): writes the state next to the project,
 *    refreshed while the run lives, so a reader sees the load average at the
 *    moment it asserts rather than the one from bundle time.
 *  - `createTimingGateMiddleware` (`example/metro.config.js`): serves exactly
 *    `TIMING_GATE_URL` from disk. Metro's dev server serves no project files of
 *    its own - the first run of this gate found its file answered 404 at every
 *    path tried, under a dot-directory or not - so the route is declared here
 *    and reads the file per request.
 *
 * It has to be the Metro port: an emulator reaches this machine only through the
 * `adb reverse` the harness sets up for Metro, so a second port would be readable
 * on iOS and unreachable on Android.
 *
 * The file is gitignored and owned by the running harness, and the middleware
 * answers one exact path - nothing here browses the project. The refresh timer is
 * `unref()`'d so it can never keep the CLI alive, and an old file says nothing
 * about a run: every reader checks `metroPort` and the age of `updatedAt`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');

/** Path of the gate file, relative to `example/` (Metro's project root). */
const TIMING_GATE_FILE = path.join('harness-timing', 'state.json');

/** The same path as the URL the middleware serves it under. */
const TIMING_GATE_URL = '/harness-timing/state.json';

/** At or above this 1-minute load average, a duration gate refuses to judge. */
const BUSY_LOAD1 = 10;

/** How often the published load average is refreshed while the harness runs. */
const REFRESH_MS = 2000;

/**
 * @returns {boolean} whether this run was asked to gate on wall-clock.
 */
function timingGatesRequested() {
  return process.env.HARNESS_TIMING === '1';
}

/**
 * The published state of the machine, as an assertion reads it.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ harnessTiming: boolean, load1: number, load5: number, cores: number, allowLocaleMismatch: boolean }}
 */
function timingGateState({ env = process.env } = {}) {
  const [load1 = 0, load5 = 0] = os.loadavg();
  return {
    harnessTiming: env.HARNESS_TIMING === '1',
    // The other thing an app cannot see about its own run: whether the run said "I
    // meant to test a locale the table was not measured in". It rides along here
    // because it is the same problem as the load average — the app's JS cannot read
    // the runner's environment, so a premise a *run* opted out of has to be
    // published rather than guessed at. `localePremiseMiss` in
    // `scripts/conformance-core.mjs` fails a locale-dependent comparison unless this
    // is true, which is what stops that rule degrading into a silent skip.
    allowLocaleMismatch: env.NITRO_UI_ALLOW_LOCALE_MISMATCH === '1',
    load1,
    load5,
    cores: os.cpus().length,
  };
}

/**
 * Connect middleware serving the published state at exactly `TIMING_GATE_URL`.
 *
 * Anything else - including every other path under the gate directory - goes to
 * `next()` untouched, so attaching this cannot shadow a route or a module.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @returns {(req: unknown, res: unknown, next: () => void) => void}
 */
function createTimingGateMiddleware({ exampleDir }) {
  const file = path.join(exampleDir, TIMING_GATE_FILE);
  return function timingGateMiddleware(req, res, next) {
    const url = typeof req.url === 'string' ? req.url : '';
    if (url.split('?')[0] !== TIMING_GATE_URL) {
      next();
      return;
    }
    let body;
    try {
      body = fs.readFileSync(file, 'utf8');
    } catch {
      // No run is publishing: the app reports its durations without gating.
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(body);
  };
}

/**
 * Wrap a Metro middleware chain so the gate route answers first.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @returns {(middleware: any, metroServer: unknown) => any} for
 *   `server.enhanceMiddleware`.
 */
function withTimingGateRoute({ exampleDir }) {
  const serve = createTimingGateMiddleware({ exampleDir });
  return function enhanceMiddleware(middleware, metroServer) {
    const connect = require('connect');
    const app = connect();
    app.use(serve);
    app.use(middleware);
    // Keep the chain's own properties (`metroServer` is passed for the same
    // reason): callers reach through the returned function for them.
    Object.assign(app, { middleware, metroServer });
    return app;
  };
}

/**
 * Publish the machine state for the duration of the run.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @param {number} options.port The Metro port this run serves, so a reader can
 *   tell its own run's file from one an earlier run left behind.
 * @param {(message: string) => void} [options.log]
 * @returns {() => void} stops publishing and removes the file.
 */
function publishTimingGate({ exampleDir, port, log = () => {} }) {
  const file = path.join(exampleDir, TIMING_GATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const write = () => {
    const state = timingGateState();
    // `busyLoad1` travels with it so the app asserts the threshold this run
    // decided on; a reader that has to restate it can drift from it silently.
    const body = {
      ...state,
      busyLoad1: BUSY_LOAD1,
      metroPort: port,
      updatedAt: Date.now(),
    };
    // Write-then-rename: a reader must never see a half-written file.
    const tmp = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    fs.renameSync(tmp, file);
  };

  write();
  const timer = setInterval(() => {
    try {
      write();
    } catch (error) {
      log(`harness: could not refresh the timing gate: ${String(error)}`);
    }
  }, REFRESH_MS);
  timer.unref?.();

  const first = timingGateState();
  log(
    `harness: wall-clock gates ${first.harnessTiming ? 'ON' : 'off'} ` +
      `(HARNESS_TIMING=${first.harnessTiming ? '1' : 'unset'}) · load average ` +
      `${first.load1.toFixed(2)}/${first.load5.toFixed(2)} over ${String(first.cores)} cores · ` +
      `a gate refuses at load1 >= ${String(BUSY_LOAD1)} · ` +
      `published to ${path.relative(process.cwd(), file)}`
  );
  if (first.harnessTiming && first.load1 >= BUSY_LOAD1) {
    log(
      `harness: HARNESS_TIMING=1 but this machine is busy (load1 ` +
        `${first.load1.toFixed(2)} >= ${String(BUSY_LOAD1)}) - every duration ` +
        'gate will refuse to judge. Re-run on a quiet machine for a verdict.'
    );
  }

  let cleared = false;
  return () => {
    if (cleared) return;
    cleared = true;
    clearInterval(timer);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Evidence, not a failure: the run is over either way.
    }
  };
}

module.exports = {
  TIMING_GATE_FILE,
  TIMING_GATE_URL,
  BUSY_LOAD1,
  timingGatesRequested,
  timingGateState,
  createTimingGateMiddleware,
  withTimingGateRoute,
  publishTimingGate,
};
