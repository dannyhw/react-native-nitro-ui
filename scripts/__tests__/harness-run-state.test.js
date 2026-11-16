import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import harnessRunState from '../harness-run-state.js';

const { createRunStateMiddleware, publishRunState, RUN_STATE_URL } =
  harnessRunState;

const dirs = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function exampleDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-'));
  dirs.push(dir);
  return dir;
}

/** What the middleware answers for a request that arrived on `port`. */
function serve(middleware, port, url = RUN_STATE_URL) {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body ?? null;
    },
  };
  let passed = false;
  middleware({ url, socket: { localPort: port } }, res, () => {
    passed = true;
  });
  return {
    passed,
    status: res.statusCode,
    state: res.body == null ? null : JSON.parse(res.body),
  };
}

describe('the harness run state with two runs in one checkout', () => {
  it("each Metro serves its own run's state, and one run ending leaves the other's", () => {
    const dir = exampleDir();
    const stopIos = publishRunState({ exampleDir: dir, port: 8291 });
    const stopAndroid = publishRunState({ exampleDir: dir, port: 9291 });
    const middleware = createRunStateMiddleware({ exampleDir: dir });
    try {
      expect(serve(middleware, 8291).state.metroPort).toBe(8291);
      expect(serve(middleware, 9291).state.metroPort).toBe(9291);

      stopIos();
      expect(serve(middleware, 8291).status).toBe(404);
      const android = serve(middleware, 9291);
      expect(android.status).toBe(200);
      expect(android.state.metroPort).toBe(9291);
    } finally {
      stopIos();
      stopAndroid();
    }
  });

  it('answers 404 on a port no run published for, and leaves every other path alone', () => {
    const dir = exampleDir();
    const stop = publishRunState({ exampleDir: dir, port: 8291 });
    const middleware = createRunStateMiddleware({ exampleDir: dir });
    try {
      expect(serve(middleware, 7000).status).toBe(404);
      expect(serve(middleware, undefined).status).toBe(404);
      expect(serve(middleware, 8291, '/index.bundle').passed).toBe(true);
    } finally {
      stop();
    }
  });
});
