/**
 * Publishes what a harness *run* decided, so the app under test can read it back.
 *
 * The app's JS cannot read this process's environment, and some assertions depend on
 * a premise the run chose rather than on anything the app was launched with — today
 * one: whether the run opted out of its own locale pin
 * (`NITRO_UI_ALLOW_LOCALE_MISMATCH`, read by `example/__tests__/runState.ts` and
 * enforced by the conformance rule that compares a locale-dependent box). So the
 * runner publishes it next to the project and the app reads it over the dev server.
 *
 * It has to be the Metro port: an emulator reaches this machine only through the
 * `adb reverse` the harness sets up for Metro, so a second port would be readable on
 * iOS and unreachable on Android. Metro serves no project files of its own - the
 * first run of this route found its file answered 404 at every path tried, under a
 * dot-directory or not - so the route is declared here and reads the file per request.
 *
 * The file is gitignored and owned by the running harness, and the middleware answers
 * one exact path - nothing here browses the project. The refresh timer is `unref()`'d
 * so it can never keep the CLI alive, and an old file says nothing about a run: every
 * reader checks `metroPort` and the age of `updatedAt` before believing it.
 *
 * X37 removed the other thing this used to publish - the load average, for the
 * wall-clock gates (D21). Those gates judged nothing: `HARNESS_TIMING` is unset in
 * every gate run, and the durations moved to `bench/`.
 */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

/** Path of the state file, relative to `example/` (Metro's project root). */
const RUN_STATE_FILE = path.join('harness-run', 'state.json');

/** The same path as the URL the middleware serves it under. */
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
    // Whether this run said "I meant to test a locale the shared table was not
    // measured in". It is published rather than passed as a launch argument because
    // it is a premise about the *run*: `localePremiseMiss` in
    // `example/__tests__/Conformance.harness.tsx` fails a locale-dependent comparison
    // unless this is true, which is what stops that rule degrading into a silent skip.
    allowLocaleMismatch: env.NITRO_UI_ALLOW_LOCALE_MISMATCH === '1',
  };
}

/**
 * Connect middleware serving the published state at exactly `RUN_STATE_URL`.
 *
 * Anything else - including every other path under the state directory - goes to
 * `next()` untouched, so attaching this cannot shadow a route or a module.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @returns {(req: unknown, res: unknown, next: () => void) => void}
 */
function createRunStateMiddleware({ exampleDir }) {
  const file = path.join(exampleDir, RUN_STATE_FILE);
  return function runStateMiddleware(req, res, next) {
    const url = typeof req.url === 'string' ? req.url : '';
    if (url.split('?')[0] !== RUN_STATE_URL) {
      next();
      return;
    }
    let body;
    try {
      body = fs.readFileSync(file, 'utf8');
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
  const file = path.join(exampleDir, RUN_STATE_FILE);
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
      // Evidence, not a failure: the run is over either way.
    }
  };
}

module.exports = {
  RUN_STATE_FILE,
  RUN_STATE_URL,
  runState,
  createRunStateMiddleware,
  withRunStateRoute,
  publishRunState,
};
