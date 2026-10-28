/**
 * The proof behind merge reuse (X10 review M1).
 *
 * `need --for merge` accepts a `check` line whose code tree equals the merged tree, provided every
 * path the merge adds is on `CHECK_REUSE_ALLOWLIST`. The tree digest excludes `docs/`, `bench/`,
 * `.github/` and every `*.md`, so that list is load-bearing: if a `check` step ever read a path on it,
 * reuse would mark a tree green that no step ever saw. `scripts/check-docs-drift.mjs` asks each step
 * what it reads, and this file is what puts that proof inside `bun run check` - so the claim fails the
 * gate instead of failing quietly in someone's merge.
 *
 * Why a test and not a step: the brief froze the step list at exactly what `check:serial` runs, and
 * `scripts/__tests__/check-step-parity.test.js` enforces that. Riding inside `test` costs ~7 s of a
 * ~150 s run and needs no new graph node.
 *
 * The red proofs are the point. Each one states a way the allowlist could stop being true and shows
 * the proof naming it, including the case the brief asked for by name - a test that starts reading a
 * committed ledger - reached through the script the test spawns, not through the test's own text.
 *
 * Fixture assertions filter to violations about `docs`, because a fixture repo has none of the real
 * `check` scripts and the proof says so sixteen times; what is under test is always the docs half.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  CHECK_REUSE_ALLOWLIST,
  CHECK_REUSE_EXCLUDE,
  pathsOutsideReuseExemption,
  isReuseAllowlistedPath,
} from '../gate-core.mjs';
import { CHECK_STEPS } from '../check-steps.mjs';
import {
  EXEMPT,
  EXEMPT_WALKS,
  KNOWN_STEPS,
  checkDocsDrift,
  evalPath,
  fileFacts,
  ignoreCoversDirectory,
  parseSource,
  probeEslint,
  probePrettier,
  visitNodes,
} from '../check-docs-drift.mjs';

const ROOT = process.cwd();
const cleanup = [];

afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

/** Violations about the allowlist, i.e. the ones a fixture is actually demonstrating. */
function docs(result) {
  return result.violations
    .filter((line) => /\bdocs\b|\.md\b|gates\.jsonl/.test(line))
    .join('\n');
}

/** A spawn that answers like the tools, so a fixture repo is proved without running any. */
function fakeSpawn(answers = {}) {
  return (cmd, args) => {
    const key = [cmd, ...(args ?? [])].join(' ');
    for (const [pattern, answer] of Object.entries(answers)) {
      if (key.includes(pattern)) {
        return {
          status: 0,
          stdout: typeof answer === 'string' ? answer : (answer.stdout ?? ''),
          stderr: '',
        };
      }
    }
    if (/--file-info/.test(key))
      return {
        status: 0,
        stdout: '{"ignored":true,"inferredParser":null}',
        stderr: '',
      };
    if (/eslint/.test(key))
      return {
        status: 0,
        stdout:
          '[{"filePath":"/fixture/docs/x.mjs","ignored":true,"messages":[]}]',
        stderr: '',
      };
    if (/--listTests/.test(key)) return { status: 0, stdout: '', stderr: '' };
    if (/npm pack/.test(key))
      return {
        status: 0,
        stdout: '[{"files":[{"path":"lib/index.js"}]}]',
        stderr: '',
      };
    return { status: 1, stdout: '', stderr: `unexpected: ${key}` };
  };
}

/** The smallest repo `checkDocsDrift` will judge: a root marker, a manifest, and the files asked for. */
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x10-allowlist-'));
  fs.mkdirSync(path.join(dir, 'nitrogen/generated/ios'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'nitrogen/generated/ios/NitroUiAutolinking.swift'),
    '//\n'
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'jest' } })
  );
  fs.writeFileSync(path.join(dir, '.prettierignore'), 'docs\n');
  fs.writeFileSync(
    path.join(dir, 'eslint.config.mjs'),
    'export default [{ ignores: ["docs/**"] }]\n'
  );
  // Something has to exist under the allowlist, or the proof says the probes would prove nothing -
  // which is true of an empty fixture and would hide every assertion below it.
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/fixture.md'), '# fixture\n');
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  cleanup.push(dir);
  return dir;
}

const TEST_STEP = [{ name: 'test' }];

/**
 * Runs the proof over a fixture with no exclusions.
 *
 * The fixture paths these tests assert on (`docs/tasks/X1/gates.jsonl`) collide with the real
 * `CHECK_REUSE_EXCLUDE`, whose job is to make such a read a *recorded price* rather than a
 * violation - which is exactly what the real-checkout tests below check. Here the question is only
 * whether the scan finds the read at all, so the exclusion is switched off rather than the fixture
 * renamed away from the shape a real read has.
 */
function drift(options) {
  return checkDocsDrift({ exclude: [], ...options });
}

/* ------------------------- the proof, on this checkout ----------------------- */

describe('checkDocsDrift on this checkout', () => {
  it('passes: no step of check reads the reuse allowlist', () => {
    const result = checkDocsDrift({ root: ROOT });
    expect(result.violations).toEqual([]);
    expect(result.code).toBe(0);
    // It judged the run's real test graph, not an empty list, or "no violations" would be vacuous.
    expect(result.notes.join('\n')).toMatch(/\d+ test file\(s\)/);
  }, 120_000);

  it('classifies exactly the steps CHECK_STEPS has, and no command has changed', () => {
    // Both directions in one: a step added to the graph without an entry here, and a step whose
    // command moved out from under this proof, each leaves the allowlist unproven.
    const names = CHECK_STEPS.map((step) => step.name);
    expect(KNOWN_STEPS.map((entry) => entry.name).sort()).toEqual(
      [...names].sort()
    );
    const scripts = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
    ).scripts;
    const changed = KNOWN_STEPS.filter(
      (entry) => scripts[entry.name] !== entry.argv
    ).map(
      (entry) =>
        `${entry.name}: ${JSON.stringify(scripts[entry.name])} != ${JSON.stringify(entry.argv)}`
    );
    expect(changed).toEqual([]);
  });

  it('every classified step is judged by something, not just listed', () => {
    // An entry with a `kind` nothing handles would be a pass with no evidence behind it; the proof
    // reports "unknown kind" for that, so the set of kinds here has to stay the handled set.
    const handled = new Set([
      'graph',
      'glob-tool',
      'jest',
      'config-tool',
      'pack-list',
    ]);
    for (const entry of KNOWN_STEPS) expect(handled.has(entry.kind)).toBe(true);
    for (const entry of KNOWN_STEPS.filter((each) => each.kind === 'graph')) {
      const missing = (entry.starts ?? []).filter(
        (start) => !fs.existsSync(path.join(ROOT, start))
      );
      expect(missing).toEqual([]);
    }
  });

  it('keeps its exemption tables honest about files that still exist', () => {
    expect(
      EXEMPT.filter((entry) => !fs.existsSync(path.join(ROOT, entry.file))).map(
        (e) => e.file
      )
    ).toEqual([]);
    for (const entry of EXEMPT) expect(entry.reason.length).toBeGreaterThan(10);
    expect(
      EXEMPT_WALKS.filter(
        (entry) => !fs.existsSync(path.join(ROOT, entry.file))
      ).map((e) => e.file)
    ).toEqual([]);
    expect(
      EXEMPT_WALKS.filter(
        (entry) => !fs.existsSync(path.join(ROOT, entry.directory))
      ).map((e) => e.directory)
    ).toEqual([]);
    for (const entry of EXEMPT_WALKS) {
      // The excuse has to be the rule: a walk is allowed only if reuse already refuses what it reaches.
      expect(
        isReuseAllowlistedPath('docs/tasks/X9/gates.jsonl', [entry.reaches])
      ).toBe(true);
    }
  });

  it('an excluded read is recorded, and never smuggled through an exemption', () => {
    // Both halves of the M1 accounting, on the real checkout. `gate-check.test.js` opens
    // `docs/tasks/ORCHESTRATOR.md`; that path is on the allowlist and then taken back by the exclude
    // list, so the proof reports it as a known read the reuse rule refuses over - and must not count
    // it as an exemption, which would be a hole rather than a price.
    const result = checkDocsDrift({ root: ROOT });
    expect(result.exemptions.join('\n')).not.toContain('ORCHESTRATOR');
    expect(result.excludedReads.join('\n')).toContain(
      'docs/tasks/ORCHESTRATOR.md'
    );
    // Every excluded read has to be a path reuse really does refuse over: that is the only reason
    // recording it instead of failing on it is sound.
    const paths = [
      ...new Set(
        result.excludedReads.map((line) => {
          const m = / (docs\S*) - /.exec(line);
          return m == null ? '' : m[1];
        })
      ),
    ].filter((path) => path !== '');
    expect(paths.length).toBeGreaterThan(0);
    expect(pathsOutsideReuseExemption(paths)).toEqual(paths);
  }, 120_000);

  it('refuses an empty allowlist by saying reuse is impossible', () => {
    const result = checkDocsDrift({ root: ROOT, allowlist: [] });
    expect(result.code).toBe(0);
    expect(result.notes.join('\n')).toContain('allowlist is empty');
  });
});

/* ------------------- the probes, against the real tools --------------------- */

describe('the probes, run for real', () => {
  it('asks prettier, and prettier says it never opens docs/', () => {
    const allowlisted = [
      'docs/PLAN.md',
      'docs/research/spike-artifacts/patch-nitrogen.mjs',
    ];
    const result = probePrettier(ROOT, allowlisted, undefined);
    expect(result.error).toBeUndefined();
    expect(result.read).toEqual([]);
    // Several file types, or the verdict would rest on one ignore entry.
    expect(result.detail).toMatch(/\d+ type\(s\)/);
  }, 60_000);

  it('asks eslint, and eslint says it never opens docs/', () => {
    const result = probeEslint(
      ROOT,
      ['docs/research/spike-artifacts/patch-nitrogen.mjs'],
      undefined
    );
    expect(result.error).toBeUndefined();
    expect(result.read).toEqual([]);
  }, 60_000);

  it('is red for an allowlist that names a file prettier really does read', () => {
    // The probe, proved: README.md is formatted by `prettier --check .`, so an allowlist that claimed
    // it would be a lie - and one call to the tool says so. Without this, a probe that always answered
    // "ignored" would pass the whole proof.
    const result = probePrettier(ROOT, ['README.md'], undefined);
    expect(result.read).toEqual(['README.md']);
  }, 60_000);

  it('is red for an allowlist whose ignore rule is not a directory', () => {
    for (const [pattern, reason] of [
      [
        'docs/*.md',
        'a per-extension rule would let a new .txt under docs/ through',
      ],
      ['docsx/**', 'a rule for the wrong directory'],
      ['my-docs', 'a rule for a different directory'],
    ]) {
      const dir = makeFixture({ '.prettierignore': `${pattern}\n` });
      const result = ignoreCoversDirectory(
        dir,
        'prettier',
        CHECK_REUSE_ALLOWLIST
      );
      // `reason` is the claim under test, so it goes into the assertion message by hand:
      // this jest's `expect` takes one argument.
      expect([pattern, reason, result.covers]).toEqual([
        pattern,
        reason,
        false,
      ]);
      expect(result.why || result.error).toContain('docs');
    }
  });

  it('accepts the real .prettierignore and eslint.config.mjs', () => {
    expect(
      ignoreCoversDirectory(ROOT, 'prettier', CHECK_REUSE_ALLOWLIST).covers
    ).toBe(true);
    expect(
      ignoreCoversDirectory(ROOT, 'eslint', CHECK_REUSE_ALLOWLIST).covers
    ).toBe(true);
  });
});

/* ---------------------- red proofs: how it could break ---------------------- */

describe('checkDocsDrift red proofs (how the allowlist could stop being true)', () => {
  it('catches a jest test that reads an allowlisted path through a script it spawns', () => {
    // The case the brief named. Nobody writes `readFileSync('docs/...')` in a test - they point a test
    // at a script, and the script opens the file. So the scan follows what the test names.
    const dir = makeFixture({
      'scripts/reader.mjs':
        "import fs from 'node:fs'\nimport path from 'node:path'\n" +
        'export function readLedger(root) {\n' +
        "  return fs.readFileSync(path.join(root, 'docs', 'tasks', 'X1', 'gates.jsonl'), 'utf8')\n}\n",
      'scripts/__tests__/a.test.js':
        "import { execFileSync } from 'node:child_process'\nimport path from 'node:path'\n" +
        "const CLI = path.join(process.cwd(), 'scripts', 'reader.mjs')\n" +
        'execFileSync(process.execPath, [CLI], { cwd: process.cwd() })\n',
      'docs/tasks/X1/gates.jsonl': '{}\n',
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests': path.join(dir, 'scripts/__tests__/a.test.js') + '\n',
      }),
    });
    expect(result.code).toBe(1);
    expect(docs(result)).toContain('scripts/reader.mjs');
    expect(docs(result)).toContain('gates.jsonl');
  }, 60_000);

  it('does not call test data a read', () => {
    // `classify(['docs/a.md'])` asks a pure function about a string, and Markdown links are prose. If
    // that counted, this proof would be red on half the repo's suites and switched off within a week.
    const dir = makeFixture({
      'scripts/__tests__/a.test.js':
        "import { expect, it } from '@jest/globals'\n" +
        "function classify(paths) { return paths.filter((p) => p.startsWith('docs/')) }\n" +
        "it('classifies', () => { expect(classify(['docs/a.md', 'docs/b/c.md'])).toHaveLength(2) })\n",
      'CHANGELOG.md': 'see [docs](docs/components/picker.md)\n',
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests': path.join(dir, 'scripts/__tests__/a.test.js') + '\n',
      }),
    });
    expect(docs(result)).toBe('');
  }, 60_000);

  it('catches a read whose path is built across several lines', () => {
    // The realistic shape in this repo (`join(root, 'docs', 'tasks', id, 'gates.jsonl')`), and the
    // reason the analysis is a syntax tree rather than a per-line grep.
    const dir = makeFixture({
      'scripts/__tests__/a.test.js':
        "import fs from 'node:fs'\nimport path from 'node:path'\n" +
        "const file = path.join(\n  process.cwd(),\n  'docs',\n  'tasks',\n  'X1',\n  'gates.jsonl'\n)\n" +
        "fs.readFileSync(file, 'utf8')\n",
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests': path.join(dir, 'scripts/__tests__/a.test.js') + '\n',
      }),
    });
    expect(docs(result)).toContain('docs/tasks/X1/gates.jsonl');
  }, 60_000);

  it('catches a listing of a directory on the allowlist', () => {
    const dir = makeFixture({
      'scripts/lister.mjs':
        "import fs from 'node:fs'\nimport path from 'node:path'\n" +
        "const tasksDir = path.join(process.cwd(), 'docs', 'tasks')\n" +
        'export function names() { return fs.readdirSync(tasksDir) }\n',
    });
    const facts = fileFacts(dir, 'scripts/lister.mjs', CHECK_REUSE_ALLOWLIST);
    expect(facts.walks.map((w) => w.directory)).toEqual(['docs/tasks']);
  });

  it('honours an exemption only for a file that really builds its own repo', () => {
    // An exemption is a hole by construction, so the claim it makes is checked against the file's
    // syntax tree: a test that names `docs/...` in a call but never calls mkdtempSync reads the
    // checkout for real.
    const dir = makeFixture({
      'scripts/__tests__/gate-check.test.js':
        "import fs from 'node:fs'\n" +
        "fs.readFileSync('docs/tasks/X1/gates.jsonl', 'utf8')\n",
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests':
          path.join(dir, 'scripts/__tests__/gate-check.test.js') + '\n',
      }),
    });
    expect(docs(result)).toContain('builds no temp repo');
    expect(result.exemptions).toEqual([]);
  }, 60_000);

  it('is green for that same file once it does build its own repo', () => {
    const dir = makeFixture({
      'scripts/__tests__/gate-check.test.js':
        "import fs from 'node:fs'\nimport os from 'node:os'\n" +
        'const repo = fs.mkdtempSync(os.tmpdir())\n' +
        "fs.readFileSync('docs/tasks/X1/gates.jsonl', 'utf8')\n",
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests':
          path.join(dir, 'scripts/__tests__/gate-check.test.js') + '\n',
      }),
    });
    expect(docs(result)).toBe('');
    expect(result.exemptions.join('\n')).toContain('mkdtemp repos');
  }, 60_000);

  it('is red for source that will not parse, rather than quietly seeing nothing', () => {
    // The permissive alternative is the dangerous one: a `.mjs` with a syntax error has no tree, so a
    // scanner that shrugged would report "no reads" for a file it never read. The read below is built
    // from pieces, so even the text fallback used for shell and JSON finds nothing - the only honest
    // verdict is "I cannot see this file", and that is the verdict asserted here.
    const dir = makeFixture({
      'scripts/broken.test.mjs':
        "import fs from 'node:fs'\nimport path from 'node:path'\n" +
        "export function read(root) { return fs.readFileSync(path.join(root, 'docs', 'PLAN.md'), 'utf8') }\n" +
        'function oops( { }\n',
    });
    const facts = fileFacts(
      dir,
      'scripts/broken.test.mjs',
      CHECK_REUSE_ALLOWLIST
    );
    expect(facts.parseError).toBe(true);

    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests': path.join(dir, 'scripts/broken.test.mjs') + '\n',
      }),
    });
    // Not through `docs()`: the message names the file, not the allowlisted path, and the fixture
    // repo's unrelated "no entry in the table" violations do not contain this phrase.
    expect(result.violations.join('\n')).toContain('cannot parse');
  }, 60_000);

  it('does not call a Markdown link a read, because nobody executes a Markdown file', () => {
    // `CHANGELOG.md` really does link to `docs/components/picker.md`, and the first version of this
    // proof called that a read. Text scanning is reserved for things a step actually runs: shell and
    // config. Everything else that is not parseable is data.
    const dir = makeFixture({
      'CHANGELOG.md': 'see [docs](docs/components/picker.md)\n',
      'docs/components/picker.md': '# picker\n',
    });
    expect(fileFacts(dir, 'CHANGELOG.md', CHECK_REUSE_ALLOWLIST).reads).toEqual(
      []
    );
  });
});

/* -------------------------------- the scanner ------------------------------- */

describe('the scanner itself (AST, not text)', () => {
  const bindingsOf = (source) => {
    const ast = parseSource('x.mjs', source);
    const bindings = new Map();
    visitNodes(ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier')
        bindings.set(node.id.name, node.init);
    });
    return { ast, bindings };
  };

  it('resolves join()/resolve() of literals, a template, and a const holding one', () => {
    const { bindings } = bindingsOf(
      "const a = path.join(repoRoot, 'docs', 'tasks', 'X1', 'gates.jsonl')\n" +
        'const b = `docs/PLAN.md`\n' +
        "const c = resolve('src', 'index.ts')\n"
    );
    expect(evalPath(bindings.get('a'), bindings)).toBe(
      'docs/tasks/X1/gates.jsonl'
    );
    expect(evalPath(bindings.get('b'), bindings)).toBe('docs/PLAN.md');
    expect(evalPath(bindings.get('c'), bindings)).toBe('src/index.ts');
  });

  it('gives up rather than guessing at a computed path', () => {
    // `join(root, 'docs', id)` has no answer, and inventing one would make every dynamic path in the
    // repo look like a read.
    const { bindings } = bindingsOf(
      "const a = path.join(repoRoot, 'docs', id)\nconst b = require(configPath)\n"
    );
    expect(evalPath(bindings.get('a'), bindings)).toBeNull();
    expect(evalPath(bindings.get('b'), bindings)).toBeNull();
  });

  it('is not fooled by source code that lives inside a string', () => {
    // The exact shape this file contains: a test fixture whose *text* is `fs.readdirSync(root)`. A
    // regex over the file sees a walk of the repo root; the tree sees one string literal.
    const dir = makeFixture({
      'scripts/__tests__/a.test.js':
        "import fs from 'node:fs'\n" +
        'const sample =\n' +
        "  \"fs.readdirSync(root)\\nfs.readFileSync(join(root, 'docs', 'x.md'), 'utf8')\"\n" +
        "fs.writeFileSync('out.txt', sample)\n",
    });
    const facts = fileFacts(
      dir,
      'scripts/__tests__/a.test.js',
      CHECK_REUSE_ALLOWLIST
    );
    expect(facts.walks).toEqual([]);
    expect(facts.reads).toEqual([]);
  });

  it('is not fooled by a comment', () => {
    const dir = makeFixture({
      'scripts/a.mjs':
        "// fs.readFileSync('docs/PLAN.md', 'utf8')\nexport const x = 1\n",
    });
    expect(
      fileFacts(dir, 'scripts/a.mjs', CHECK_REUSE_ALLOWLIST).reads
    ).toEqual([]);
  });

  it('treats the allowlist as a directory, never as a substring', () => {
    expect(isReuseAllowlistedPath('docs/tasks/X/gates.jsonl')).toBe(true);
    expect(isReuseAllowlistedPath('docsx/x.md')).toBe(false);
    expect(isReuseAllowlistedPath('bench/docs/x.md')).toBe(false);
    expect(
      isReuseAllowlistedPath('docs/tasks/X/gates.jsonl', CHECK_REUSE_EXCLUDE)
    ).toBe(true);
    expect(
      isReuseAllowlistedPath('docs/tasks/X/other.jsonl', CHECK_REUSE_EXCLUDE)
    ).toBe(false);
  });

  it('names the lists it proves, so proof and rule cannot disagree', () => {
    expect(CHECK_REUSE_ALLOWLIST).toEqual(['docs/**']);
    expect(CHECK_REUSE_EXCLUDE).toEqual([
      'docs/tasks/*/gates.jsonl',
      'docs/tasks/ORCHESTRATOR.md',
    ]);
  });
});

/* ------------------ the boundary of an exemption (M1, self-inflicted) -------- */

describe('an exemption stops at the checkout', () => {
  it('refuses the mkdtemp excuse for a path that exists in this checkout', () => {
    // The hole this closes is the one round 0 of this proof dug for itself: an exemption said "its
    // paths are fixture data" for a test that also opened a real page under `docs/`. A file that
    // builds temp repos is still reading the real thing when the path resolves here, so the excuse
    // has to stop at the boundary of the checkout - which is what this asserts, and what caught the
    // original version reading `docs/tasks/ORCHESTRATOR.md`.
    const dir = makeFixture({
      'docs/real.md': '# a page that exists in this checkout\n',
      'scripts/__tests__/gate-check.test.js':
        "import fs from 'node:fs'\nimport os from 'node:os'\n" +
        'const repo = fs.mkdtempSync(os.tmpdir())\n' +
        "fs.readFileSync('docs/real.md', 'utf8')\n",
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests':
          path.join(dir, 'scripts/__tests__/gate-check.test.js') + '\n',
      }),
    });
    expect(docs(result)).toContain('it is a real read');
    expect(result.exemptions.join('\n')).not.toContain('docs/real.md');
  }, 60_000);

  it('still excuses the same file naming a path that only exists in its temp repo', () => {
    // The other side of the line, so the tightening is a boundary rather than a ban: a path that does
    // not resolve in the judged checkout is fixture data, and an exemption covers it.
    const dir = makeFixture({
      'scripts/__tests__/gate-check.test.js':
        "import fs from 'node:fs'\nimport os from 'node:os'\n" +
        'const repo = fs.mkdtempSync(os.tmpdir())\n' +
        "fs.readFileSync('docs/only-in-the-fixture.md', 'utf8')\n",
    });
    const result = drift({
      root: dir,
      steps: TEST_STEP,
      spawn: fakeSpawn({
        '--listTests':
          path.join(dir, 'scripts/__tests__/gate-check.test.js') + '\n',
      }),
    });
    expect(docs(result)).toBe('');
    expect(result.exemptions.join('\n')).toContain(
      'docs/only-in-the-fixture.md'
    );
  }, 60_000);

  it('is red for a step reading a file the exclude list takes back', () => {
    // `docs/tasks/ORCHESTRATOR.md` is on the allowlist and then excluded, so a step that opens it is
    // a violation rather than an exemption - which is the whole point of keeping the two lists apart.
    const dir = makeFixture({
      'docs/tasks/ORCHESTRATOR.md': '# rules\n',
      'scripts/reader.mjs':
        "import fs from 'node:fs'\nexport const rules = fs.readFileSync('docs/tasks/ORCHESTRATOR.md', 'utf8')\n",
    });
    const facts = fileFacts(dir, 'scripts/reader.mjs', CHECK_REUSE_ALLOWLIST);
    expect(facts.reads.map((r) => r.path)).toEqual([
      'docs/tasks/ORCHESTRATOR.md',
    ]);
    expect(pathsOutsideReuseExemption(['docs/tasks/ORCHESTRATOR.md'])).toEqual([
      'docs/tasks/ORCHESTRATOR.md',
    ]);
  });
});
