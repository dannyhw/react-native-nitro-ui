/**
 * Publishes what a harness run decided (whether it opted out of its locale pin), so
 * the app under test can read it back from Metro's dev server.
 */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

/**
 * Path of a run's state file, relative to `example/` (Metro's project root). One
 * file per Metro port, so an iOS and an Android run from one checkout, each on its
 * own port, never read or remove each other's.
 *
 * @param {number} port
 * @returns {string}
 */
function runStateFile(port) {
  return path.join('harness-run', `state-${String(port)}.json`);
}

/**
 * The same path as the URL the middleware serves it under. Served on the Metro port:
 * an emulator reaches this machine only through the `adb reverse` set up for Metro.
 */
const RUN_STATE_URL = '/harness-run/state.json';

/** How often the published state is refreshed while the harness runs. */
const REFRESH_MS = 2000;

/**
 * The state of this run, as an assertion in the app reads it.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ allowLocaleMismatch: boolean }}
 */
function runState({ env = process.env } = {}) {
  return {
    // Whether this run meant to test a locale the shared size table was not
    // measured in. Without it, a locale-dependent comparison fails.
    allowLocaleMismatch: env.NITRO_UI_ALLOW_LOCALE_MISMATCH === '1',
  };
}

/**
 * Connect middleware serving the published state at exactly `RUN_STATE_URL`: the
 * state of the run on the port the request arrived on, which is this Metro's own.
 *
 * Anything else - including every other path under the state directory - goes to
 * `next()` untouched, so attaching this cannot shadow a route or a module.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @returns {(req: unknown, res: unknown, next: () => void) => void}
 */
function createRunStateMiddleware({ exampleDir }) {
  return function runStateMiddleware(req, res, next) {
    const url = typeof req.url === 'string' ? req.url : '';
    if (url.split('?')[0] !== RUN_STATE_URL) {
      next();
      return;
    }
    // The listening socket's port, not the Host header: an emulator reaches Metro
    // through `adb reverse`, which keeps the port and may rewrite the host.
    const port = req.socket?.localPort;
    let body;
    try {
      if (typeof port !== 'number') throw new Error('no local port');
      body = fs.readFileSync(path.join(exampleDir, runStateFile(port)), 'utf8');
    } catch {
      // No run is publishing: a reader treats that as "no premise opted out".
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
 * Wrap a Metro middleware chain so the run-state route answers first.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @returns {(middleware: any, metroServer: unknown) => any} for
 *   `server.enhanceMiddleware`.
 */
function withRunStateRoute({ exampleDir }) {
  const serve = createRunStateMiddleware({ exampleDir });
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
 * Publish the run's state for the duration of the run.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @param {number} options.port The Metro port this run serves, so a reader can
 *   tell its own run's file from one an earlier run left behind.
 * @param {(message: string) => void} [options.log]
 * @returns {() => void} stops publishing and removes the file.
 */
function publishRunState({ exampleDir, port, log = () => {} }) {
  const file = path.join(exampleDir, runStateFile(port));
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const write = () => {
    const body = {
      ...runState(),
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
      log(`harness: could not refresh the run state: ${String(error)}`);
    }
  }, REFRESH_MS);
  timer.unref?.();

  const first = runState();
  log(
    `harness: run state published to ` +
      `${path.relative(process.cwd(), file)} ` +
      `(NITRO_UI_ALLOW_LOCALE_MISMATCH=${first.allowLocaleMismatch ? '1' : 'unset'})`
  );

  let cleared = false;
  return () => {
    if (cleared) return;
    cleared = true;
    clearInterval(timer);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // The run is over either way.
    }
  };
}

module.exports = {
  runStateFile,
  RUN_STATE_URL,
  runState,
  createRunStateMiddleware,
  withRunStateRoute,
  publishRunState,
};
