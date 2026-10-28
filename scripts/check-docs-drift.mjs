/**
 * Proves the claim merge reuse leans on (X10 review M1).
 *
 * `need --for merge` can accept a `check` line whose code tree equals the merged tree. That digest
 * deliberately excludes `docs/`, `bench/`, `.github/` and every `*.md`, so tree equality says nothing
 * about whether those files changed - while `check` reads some of them (`bench:typecheck`, `lint` and
 * `format` read `bench/`; `format` and `readme:check` read `README.md`; a test in the unit run reads
 * `.github/workflows/ci.yml`). Reuse therefore also requires that every path a merge adds beyond the
 * checked commit is on `CHECK_REUSE_ALLOWLIST`, and that list has to be true rather than hopeful.
 *
 * This module asks whether anything `bun run check` runs can read a path under the allowlist, and the
 * `test` step runs it (`scripts/__tests__/check-allowlist.test.js`): the moment a step or a test
 * starts reading `docs/`, `check` goes red instead of reuse quietly becoming unsound. It named
 * something on its first run - `gate.mjs` opens `docs/tasks/<ID>/gates.jsonl`, which is why
 * `CHECK_REUSE_EXCLUDE` exists - so this is a check that bites, not a check that agrees.
 *
 * What counts as a read:
 *
 *  - **a call**: an allowlisted path reaches a filesystem or process call (`readFileSync`,
 *    `existsSync`, `spawnSync`, `globSync`, … - `FS_CALLS` below is the definition, and adding to it
 *    is a diff). Paths are recovered from the *syntax tree*, not from text: `@babel/parser` gives real
 *    string literals, so a comment, or a test fixture whose source contains the string
 *    `"fs.readdirSync(root)"`, cannot be mistaken for a call. `path.join(root, 'docs', 'tasks',
 *    'X1', 'gates.jsonl')` and a `const` holding one are resolved too, because that is how the repo
 *    actually spells a path.
 *  - **a walk**: a listing of the repo root or of a directory under the allowlist, which no allowlist
 *    could bound however narrow it is. Where the listed directory is a parameter, the file's own call
 *    sites of that function are asked what they pass, so a generic `walk(dir)` over `.gates` is not
 *    reported forty times and a `walk(dir)` that is handed `docs/` is.
 *  - **a tool's own reach**, asked of the tool rather than guessed from its config: `prettier
 *    --file-info` and `eslint --format json` (their ignore verdicts are the claim, sampled per file
 *    type), and `npm pack --dry-run` for the publish surface - the one step that walks the whole tree.
 *    Two static checks cover what a probe cannot see: a codegen spec glob that would match, and the
 *    config paths of external CLIs with no file list to ask (`bob`'s targets, api-extractor's entry).
 *    The ignore rules are also matched *as directories*: a probe that passes because today's docs files
 *    happen to be `.md` would say nothing about the first `.txt`.
 *
 * Reachability is followed, not assumed: each step's script, the files that script names, the config
 * files it parses, transitively. That is how "a test that shells out to a script which reads a doc" is
 * caught - the case the brief named.
 *
 * Anything `check` runs that this file does not classify is a failure rather than a pass, and so is a
 * classified step whose command changed: the table below is what the allowlist is proved against, so
 * neither it nor the commands it describes may drift.
 *
 * Exemptions are tables, not comment directives. `EXEMPT` covers a file that declares the allowlist
 * and tests that build their own repo with `mkdtemp` (verified against the file's own AST, so it
 * cannot be granted to a test that reads the real checkout); `EXEMPT_WALKS` covers a walk whose
 * reachable set is already named by `CHECK_REUSE_EXCLUDE`. Every honoured exemption is printed, so a
 * green run says out loud what it let through.
 *
 * No `import.meta`, for the same reason `gate-core.mjs` and `check-steps.mjs` avoid it: jest imports
 * this file.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { parse } from '@babel/parser';
import {
  CHECK_REUSE_ALLOWLIST,
  CHECK_REUSE_EXCLUDE,
  isReuseAllowlistedPath,
} from './gate-core.mjs';
import { findRepoRoot } from './app-stamp-core.mjs';
import { CHECK_STEPS } from './check-steps.mjs';

const SELF = 'scripts/check-docs-drift.mjs';
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'Pods',
  'build',
  'dist',
  'target',
  '.cxx',
]);
const SOURCE_EXT = new Set([
  '.mjs',
  '.cjs',
  '.js',
  '.jsx',
  '.mjsx',
  '.ts',
  '.tsx',
]);
const SCRIPT_EXT = new Set(['.mjs', '.cjs', '.js', '.sh']);
const TEST_FILE = /(^|\/)(__tests__|[^/]*\.test\.(js|mjs|cjs|ts|tsx)$)/;
/** Files whose contents a followed script parses, so what they name counts as that script's inputs. */
const CONFIG_BASENAMES = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.test.json',
  'tsconfig.android.json',
  'nitro.json',
  'babel.config.js',
  'react-native.config.js',
  '.prettierignore',
]);
const PARSE_PLUGINS = [
  'jsx',
  'typescript',
  'decorators-legacy',
  'classProperties',
  'topLevelAwait',
];
/** Tokens that mean "the checkout" in a path expression. */
const ROOT_TOKENS =
  /^(root|repoRoot|REPO_ROOT|ROOT|rootDir|__dirname|__filename)$/;

/**
 * The calls that make a path an input. Spelled out rather than derived, because this list *is* the
 * definition of "reads" for a script of ours.
 */
export const FS_CALLS = Object.freeze([
  'readFileSync',
  'readFile',
  'createReadStream',
  'openSync',
  'open',
  'readdirSync',
  'readdir',
  'opendirSync',
  'statSync',
  'lstatSync',
  'existsSync',
  'accessSync',
  'realpathSync',
  'watch',
  'glob',
  'globSync',
  'writeFileSync',
  'writeFile',
  'appendFileSync',
  'copyFileSync',
  'mkdirSync',
  'rmSync',
  'unlinkSync',
  'spawnSync',
  'spawn',
  'execFileSync',
  'execFile',
  'execSync',
  'exec',
  'fork',
]);
const FS_CALL_SET = new Set(FS_CALLS);
/** The subset that *lists* a directory, which an allowlist cannot bound at all. */
export const WALK_CALLS = Object.freeze([
  'readdirSync',
  'readdir',
  'opendirSync',
  'glob',
  'globSync',
]);
const WALK_CALL_SET = new Set(WALK_CALLS);

/**
 * Reads of allowlisted paths that are allowed because the code cannot reach anything else, each
 * verified against the file's own syntax tree (it must contain the directory and the call) and against
 * the rule it is excused by.
 *
 * `gate.mjs` lists `docs/tasks` and opens each entry's `gates.jsonl`, so its reachable set is one
 * ledger per task directory - exactly what `CHECK_REUSE_EXCLUDE` names, and what reuse already refuses
 * to be blind to. A *new* walk under `docs/` is not in this table, so it is a violation.
 */
export const EXEMPT_WALKS = [
  {
    file: 'scripts/gate.mjs',
    directory: 'docs/tasks',
    reaches: 'docs/tasks/*/gates.jsonl',
    reason:
      'lists docs/tasks and opens each entry\u2019s gates.jsonl, which CHECK_REUSE_EXCLUDE already names',
  },
];

/**
 * The only files allowed to name an allowlisted path in a call without it counting. Two kinds exist:
 * the module that declares the allowlist, and a test whose paths live inside a repo it builds itself.
 * The latter is verified - the file must contain a `mkdtempSync` call - so an exemption cannot be
 * granted to a test that reads the real checkout.
 */
export const EXEMPT = [
  {
    file: 'scripts/gate-core.mjs',
    allowlistedPathPatterns: ['docs/**'],
    reason: 'declares CHECK_REUSE_ALLOWLIST, and no check step executes it',
  },
  {
    file: 'scripts/__tests__/gate-check.test.js',
    allowlistedPathPatterns: ['docs/**'],
    reason: 'its paths are inside the mkdtemp repos it builds',
  },
  {
    file: 'scripts/__tests__/check-runner.test.js',
    allowlistedPathPatterns: ['docs/**'],
    reason: 'its paths are inside the mkdtemp repos it builds',
  },
  {
    file: 'scripts/__tests__/check-allowlist.test.js',
    allowlistedPathPatterns: ['docs/**'],
    reason:
      'this is the proof, so it has to name what it proves (also mkdtemp fixtures)',
  },
];

/**
 * Every step of `check`, keyed by name, with the command this proof was written for and what it may
 * read. `argv` is compared with `package.json`, so a changed command fails here instead of keeping a
 * stale verdict, and `reads` is the claim a reviewer checks it against.
 */
export const KNOWN_STEPS = [
  {
    name: 'typecheck',
    argv: 'tsc',
    kind: 'graph',
    starts: ['tsconfig.json'],
    reads: 'what tsconfig.json includes',
  },
  {
    name: 'lock:check',
    argv: 'node scripts/sync-example-lock.mjs',
    kind: 'graph',
    starts: ['scripts/sync-example-lock.mjs'],
    reads: 'the two package.json files and Podfile.lock',
  },
  {
    name: 'bench:typecheck',
    argv: 'bun --cwd bench typecheck && bun --cwd bench typecheck:android',
    kind: 'graph',
    starts: ['bench/tsconfig.json', 'bench/tsconfig.android.json'],
    reads: 'bench and src, per bench/tsconfig*.json',
  },
  {
    name: 'lint',
    argv: 'eslint "**/*.{js,mjs,ts,tsx}"',
    kind: 'glob-tool',
    tool: 'eslint',
    reads: 'the linted glob; eslint.config.mjs ignores docs/, probed',
  },
  {
    name: 'format',
    argv: 'prettier --check .',
    kind: 'glob-tool',
    tool: 'prettier',
    reads:
      'everything prettier does not ignore; .prettierignore ignores docs/, probed',
  },
  { name: 'test', argv: 'jest', kind: 'jest' },
  {
    name: 'test:native',
    argv: 'bash scripts/native-tests.sh',
    kind: 'graph',
    starts: ['scripts/native-tests.sh'],
    reads:
      'named .cpp/.swift inputs under cpp/, ios/, android/, scripts/native-tests/',
  },
  {
    name: 'perf:renders',
    argv: 'node scripts/perf/renders.mjs',
    kind: 'graph',
    starts: ['scripts/perf/renders.mjs'],
    reads: 'its own script plus the *.perf-test.tsx files it globs under src/',
  },
  {
    name: 'nitrogen:check',
    argv: 'node scripts/nitrogen-check.mjs',
    kind: 'graph',
    starts: ['scripts/nitrogen-check.mjs'],
    reads: 'nitro.json specs and the committed nitrogen/generated tree',
  },
  {
    name: 'registry:check',
    argv: 'node scripts/gen-registry.mjs --check',
    kind: 'graph',
    starts: ['scripts/gen-registry.mjs'],
    reads: 'the manifests, src, and nitro.json spec globs',
  },
  {
    name: 'autolinking:check',
    argv: 'node scripts/check-autolinking.mjs',
    kind: 'graph',
    starts: ['scripts/check-autolinking.mjs'],
    reads: 'android/ and example/android/ sources',
  },
  {
    name: 'prepare',
    argv: 'bob build',
    kind: 'config-tool',
    config: 'package.json#bob',
    reads: 'lib/ and nitrogen/generated: bob targets and clean directories',
  },
  {
    name: 'api-extractor:check',
    argv: 'api-extractor run --config etc/api-extractor.json',
    kind: 'config-tool',
    config: 'etc/api-extractor.json',
    reads: 'lib/typescript/src/index.d.ts in, etc/*.api.md out',
  },
  {
    name: 'publint',
    argv: 'publint --strict',
    kind: 'pack-list',
    reads: 'the publish surface - the list npm pack reports',
  },
  {
    name: 'manifest:check',
    argv: 'node scripts/package-files.mjs',
    kind: 'graph',
    starts: ['scripts/package-files.mjs'],
    alsoPackList: true,
    reads: 'package.json, etc/package-files.txt and the pack list',
  },
  {
    name: 'readme:check',
    argv: 'node scripts/readme-examples-check.mjs',
    kind: 'graph',
    starts: ['scripts/readme-examples-check.mjs'],
    reads: 'README.md and example/src/readme-examples.tsx',
  },
];

function posix(value) {
  return String(value).split(sep).join('/');
}

function globToRegExp(pattern) {
  const body = posix(pattern)
    .split('**')
    .map((part) =>
      part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    )
    .join('.*');
  return new RegExp(`^${body}$`);
}

/**
 * How deep a path sits under the allowlist: `-1` not on it, `0` the directory the allowlist names,
 * `1`+ something inside it.
 *
 * The distinction matters because a bare `docs` is a word that means many things - an ESLint ignore
 * entry, a tsconfig `exclude` item, a prettier rule, a CHANGELOG link label - while
 * `docs/components/picker.md` is a path to a file. Only the second one is evidence of a read, and a
 * proof that flinched at the first was red on `tsconfig.json`, `nitro.json`, `.prettierignore` and
 * `CHANGELOG.md` before it ever found anything real.
 *
 * @returns {number}
 */
function allowlistDepth(path, patterns) {
  const clean = posix(path).replace(/\/+$/, '');
  if (clean === '') return -1;
  for (const raw of patterns ?? []) {
    const pattern = posix(raw);
    if (pattern.endsWith('/**')) {
      const dir = pattern.slice(0, -3);
      if (!clean.startsWith(`${dir}/`)) continue;
      return clean
        .slice(dir.length + 1)
        .split('/')
        .filter(Boolean).length;
    }
    if (isReuseAllowlistedPath(clean, [pattern])) return 1;
  }
  return -1;
}

/** Whether a path is on the allowlist, or is the directory the allowlist covers. */
function touchesAllowlist(path, patterns) {
  const clean = posix(path).replace(/\/+$/, '');
  if (clean === '') return false;
  if (allowlistDepth(clean, patterns) >= 0) return true;
  return patterns.some(
    (pattern) => posix(pattern).replace(/\/\*\*$/, '') === clean
  );
}

/** Whether a path names a file *inside* the allowlist, not merely its directory. */
function namesAllowlistedFile(path, patterns) {
  return allowlistDepth(path, patterns) >= 1;
}

function walkDir(root, relDir, onFile, depth = 0) {
  if (depth > 12) return;
  let entries = [];
  try {
    entries = readdirSync(join(root, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = posix(relDir ? `${relDir}/${entry.name}` : entry.name);
    if (entry.isDirectory()) walkDir(root, rel, onFile, depth + 1);
    else if (entry.isFile()) onFile(rel);
  }
}

function listFiles(root) {
  const out = [];
  walkDir(root, '', (rel) => out.push(rel));
  return out.sort();
}

function readText(root, rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

function readJson(root, rel) {
  const text = readText(root, rel);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* --------------------------------- the AST ---------------------------------- */

/** @returns {object | null} a program node, or null when the file is not parseable JavaScript */
export function parseSource(rel, text) {
  if (!SOURCE_EXT.has(extname(rel))) return null;
  try {
    return (
      parse(text, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        plugins: PARSE_PLUGINS,
      }).program ?? null
    );
  } catch {
    return null;
  }
}

/** Visits every object node in a syntax tree, with its parent chain. */
export function visitNodes(node, onNode, parents = []) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visitNodes(child, onNode, parents);
    return;
  }
  if (typeof node.type === 'string') onNode(node, parents);
  const next = [...parents, node];
  for (const key of Object.keys(node)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments' ||
      key === 'comments'
    )
      continue;
    visitNodes(node[key], onNode, next);
  }
}

function calleeName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' && node.property?.type === 'Identifier')
    return node.property.name;
  return null;
}

/** `const x = <init>` / `let x = <init>` in a program or function body, by name. */
function collectBindings(ast) {
  const bindings = new Map();
  visitNodes(ast, (node) => {
    if (
      node.type !== 'VariableDeclarator' ||
      node.id?.type !== 'Identifier' ||
      node.init == null
    )
      return;
    if (!bindings.has(node.id.name)) bindings.set(node.id.name, node.init);
  });
  return bindings;
}

/**
 * The repo-relative path an expression evaluates to, or null.
 *
 * Handles the three spellings the repo uses: a literal, a template without substitutions, and
 * `join`/`resolve` of literals rooted at a checkout token (`repoRoot`, `process.cwd()`, `root`,
 * `__dirname`). An identifier is followed through its `const` once, to a bounded depth, which is what
 * `const tasksDir = path.join(repoRoot, 'docs', 'tasks')` then `readdirSync(tasksDir)` needs.
 */
export function evalPath(node, bindings, depth = 0) {
  if (node == null || depth > 6) return null;
  switch (node.type) {
    case 'StringLiteral':
    case 'TemplateLiteral': {
      let value = null;
      if (node.type === 'StringLiteral') value = node.value;
      else if (node.expressions.length === 0)
        value = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
      if (value == null) return null;
      const clean = posix(value).replace(/\/+$/, '');
      if (clean === '' || clean.includes('\u0000')) return null;
      if (clean.startsWith('/')) return posix(clean.replace(/^\/+/, ''));
      return clean.replace(/^\.\//, '');
    }
    case 'Identifier': {
      if (ROOT_TOKENS.test(node.name)) return '.';
      const init = bindings.get(node.name);
      return init == null ? null : evalPath(init, bindings, depth + 1);
    }
    case 'CallExpression': {
      const name = calleeName(node.callee);
      // `process.cwd()` is the third way this repo says "the checkout" (`gate-check.test.js`'s
      // fixtures, `check.mjs`), and a join that starts from it is as knowable as one that starts from
      // `repoRoot`. Left unresolved, every test fixture path in the repo would be invisible.
      if (name === 'cwd') return '.';
      if (name !== 'join' && name !== 'resolve') return null;
      const parts = [];
      for (const argument of node.arguments) {
        const part = evalPath(argument, bindings, depth + 1);
        if (part == null) return null;
        parts.push(part);
      }
      if (parts.length === 0) return null;
      const joined = posix(resolve('/', ...parts)).replace(/^\/+/, '');
      return joined === '' ? '.' : joined;
    }
    default:
      return null;
  }
}

/**
 * @typedef {{reads: Array<{path: string, why: string}>, walks: Array<{what: string, directory: string | null}>, mentioned: string[], calls: Array<{name: string, args: Array<string | null>}>, hasMkdtemp: boolean, parseError: boolean}} FileFacts
 */

/**
 * Everything one file says about files: what it calls with what, what it lists, what it names.
 *
 * @returns {FileFacts}
 */
export function fileFacts(root, rel, patterns) {
  const text = readText(root, rel);
  const facts = {
    reads: [],
    walks: [],
    mentioned: [],
    calls: [],
    hasMkdtemp: false,
    parseError: false,
  };
  if (text == null) return facts;

  const ast = parseSource(rel, text);
  if (ast == null && SOURCE_EXT.has(extname(rel))) {
    // JavaScript or TypeScript that will not parse: the honest answer is "I cannot see this file", not
    // "it reads nothing". Shell and config have no tree to begin with and are handled below; Markdown
    // and images are data. A broken `.mjs` must not slip into either of those.
    facts.parseError = true;
    return facts;
  }
  if (ast == null) {
    // Shell and JSON/dotfile config: no tree to read, so every quoted path in them is a candidate.
    // Comments are `#`-led in shell and absent in JSON, which makes this cheap and strict.
    //
    // Other unparseable files (Markdown, images, `.txt`) are *data*, not code: nothing executes them,
    // so a path inside one is prose - `CHANGELOG.md` links to `docs/components/picker.md` and that is
    // not a read. The file that *opens* a doc is JavaScript, and the branch above is where it is caught.
    const base = rel.split('/').pop();
    const executable =
      SCRIPT_EXT.has(extname(rel)) ||
      extname(rel) === '.json' ||
      CONFIG_BASENAMES.has(base);
    if (!executable) return facts;
    const scrubbed =
      extname(rel) === '.sh' ? text.replace(/#[^\n]*/g, ' ') : text;
    for (const match of scrubbed.matchAll(/['"`]([^'"`\n]{1,240})['"`]/g)) {
      const value = posix(String(match[1]).replace(/^\.\//, '')).replace(
        /\/+$/,
        ''
      );
      if (value === '' || value.startsWith('$')) continue;
      // Every quoted string here is a candidate *mention*, which is what the graph follows. It is a
      // read only when it names something on the allowlist: `tsconfig.build.json`'s `exclude` lists
      // "example" and "lib", and a value that happens to name an existing directory is not a read.
      facts.mentioned.push(value);
      if (namesAllowlistedFile(value, patterns)) {
        facts.reads.push({
          path: value,
          why: `named in ${extname(rel) === '.sh' ? 'a shell command' : 'this config file'}`,
        });
      }
    }
    if (
      /\breaddir\b|\bls\b|\bfind\b|\bglob\b/.test(scrubbed) &&
      /\$ROOT|\$\{ROOT\}|\$\(dirname/.test(scrubbed)
    ) {
      facts.walks.push({ what: 'lists a directory in shell', directory: null });
    }
    return facts;
  }

  const bindings = collectBindings(ast);
  const calls = [];
  visitNodes(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const name = calleeName(node.callee);
    if (name == null) return;
    const args = (node.arguments ?? []).map((argument) =>
      evalPath(argument, bindings)
    );
    if (name === 'mkdtempSync' || name === 'mkdtemp') facts.hasMkdtemp = true;
    calls.push({ name, args, node });
  });

  for (const call of calls) {
    const isFs = FS_CALL_SET.has(call.name);
    const isWalk = WALK_CALL_SET.has(call.name);
    if (!isFs) {
      for (const arg of call.args)
        if (arg != null && existsSync(join(root, arg)))
          facts.mentioned.push(arg);
      continue;
    }
    for (const arg of call.args) {
      if (arg == null) continue;
      if (existsSync(join(root, arg))) facts.mentioned.push(arg);
      if (!isWalk && namesAllowlistedFile(arg, patterns)) {
        facts.reads.push({ path: arg, why: `named to ${call.name}()` });
      }
    }
    if (isWalk) {
      const directory = call.args[0] ?? null;
      if (directory === '.')
        facts.walks.push({
          what: `lists the repo root (${call.name}('.'))`,
          directory: '.',
        });
      else if (directory != null && touchesAllowlist(directory, patterns))
        facts.walks.push({
          what: `lists ${directory} (${call.name}())`,
          directory,
        });
      // An argument this module cannot resolve (`walk(dir)` inside a recursive helper) is *not*
      // reported: it would flag every generic walker in the repo, and a rule that cries wolf gets
      // switched off. What is kept is the resolvable set, which is where a real `docs` listing shows
      // up - and `gate.mjs`'s, the one that mattered, resolves through its own `const`.
    }
  }

  // Paths named anywhere in the tree, including ones handed to non-fs functions: those are how a test
  // points a CLI or a helper at a file, and the callee above is what decides whether it counts.
  visitNodes(ast, (node) => {
    if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
      const value = evalPath(node, bindings);
      if (value != null && value !== '.') facts.mentioned.push(value);
    }
  });
  // A `const` holding a built path (`const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs')`) is a
  // mention too, and the one that matters most: a test that spawns a script names it this way, and the
  // spawn's own argument is the identifier, not a literal. Without this the graph stops at the test.
  for (const init of bindings.values()) {
    const value = evalPath(init, bindings);
    if (value != null && value !== '.' && existsSync(join(root, value)))
      facts.mentioned.push(value);
  }
  facts.mentioned = [...new Set(facts.mentioned)];
  return facts;
}

/** Does this file contain a call to `name`, anywhere in its tree? */
function callsNamed(root, rel, name) {
  const text = readText(root, rel);
  if (text == null) return false;
  const ast = parseSource(rel, text);
  if (ast == null) return new RegExp(`\\b${name}\\b`).test(text);
  let found = false;
  visitNodes(ast, (node) => {
    if (node.type === 'CallExpression' && calleeName(node.callee) === name)
      found = true;
  });
  return found;
}

/* ------------------------------- the analysis ------------------------------- */

function run(spawn, cmd, args, cwd) {
  const res = spawn(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (res?.error)
    return {
      stdout: '',
      status: -1,
      detail: String(res.error.message ?? res.error),
    };
  return { stdout: res?.stdout ?? '', status: res?.status ?? -1, detail: '' };
}

function parseJsonArray(res, what) {
  const start = res.stdout.indexOf('[');
  if (start === -1)
    return {
      error: `${what} produced no JSON (exit ${res.status}): ${res.stdout.slice(0, 140)}`,
    };
  try {
    return { value: JSON.parse(res.stdout.slice(start)) };
  } catch (error) {
    return { error: `${what} produced unparseable JSON: ${error.message}` };
  }
}

/** `npm pack`'s own answer about the publish surface: the only whole-tree walk in the chain. */
export function packList(root, patterns, excludes, spawn) {
  const res = run(
    spawn,
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    root
  );
  const parsed = parseJsonArray(res, 'npm pack --dry-run --json');
  if (parsed.error) return { error: parsed.error };
  const shipped = (parsed.value[0]?.files ?? []).map((f) => posix(f.path));
  if (shipped.length === 0)
    return { error: 'npm pack reported no files - is the package built?' };
  return {
    files: shipped.filter(
      (f) =>
        isReuseAllowlistedPath(f, patterns) &&
        !isReuseAllowlistedPath(f, excludes)
    ),
    detail: `${shipped.length} file(s) in the publish surface, none of them the allowlist`,
  };
}

/** An external tool whose reach is set by a config file in this repo. */
export function configTool(config, root, patterns, excludes, allowlisted) {
  if (config === 'package.json#bob') {
    const pkg = readJson(root, 'package.json');
    const targets = pkg?.['react-native-builder-bob']?.targets ?? [];
    const entries = targets
      .map((target) => (Array.isArray(target) ? target[1] : target))
      .flatMap((options) => [
        options?.output,
        options?.srcDir,
        options?.project,
        ...(Array.isArray(options?.clean)
          ? options.clean
          : options?.clean
            ? [options.clean]
            : []),
      ])
      .filter(Boolean)
      .map((entry) => posix(entry).replace(/\/+$/, ''));
    if (entries.length === 0)
      return { error: 'package.json has no react-native-builder-bob targets' };
    const under = entries.filter(
      (entry) =>
        (isReuseAllowlistedPath(entry, patterns) &&
          !isReuseAllowlistedPath(entry, excludes)) ||
        allowlisted.some((f) => globToRegExp(`${entry}/**`).test(f))
    );
    return {
      files: under,
      detail: `${entries.length} target/clean entr(ies): ${entries.join(', ')}`,
    };
  }
  const text = readText(root, config);
  if (text == null) return { error: `${config} does not exist` };
  const named = [...text.matchAll(/<projectFolder>\/([\w./@{}*-]+)/g)].map(
    (m) => posix(m[1])
  );
  if (named.length === 0)
    return { error: `${config} names no <projectFolder> path` };
  const under = named.filter((entry) =>
    allowlisted.some((f) => globToRegExp(entry.replace(/\*+/g, '**')).test(f))
  );
  return {
    files: under,
    detail: `${named.length} path(s): ${named.join(', ')}`,
  };
}

/** `prettier --file-info`, once per file type under the allowlist - that is what it dispatches on. */
export function probePrettier(root, allowlisted, spawn) {
  const byExt = new Map();
  for (const rel of allowlisted) {
    const ext = extname(rel);
    if (ext && !byExt.has(ext)) byExt.set(ext, rel);
  }
  if (byExt.size === 0)
    return { error: 'no allowlisted file with an extension to ask about' };
  const read = [];
  for (const sample of byExt.values()) {
    const res = run(
      spawn ?? spawnSync,
      'npx',
      ['prettier', '--file-info', sample],
      root
    );
    let info;
    try {
      info = JSON.parse(res.stdout);
    } catch {
      return {
        error: `--file-info unparseable for ${sample} (exit ${res.status}): ${res.stdout.slice(0, 120)}`,
      };
    }
    if (!info.ignored && info.inferredParser !== null) read.push(sample);
  }
  return {
    read,
    detail: `${byExt.size} type(s): ${[...byExt.keys()].join(', ')}`,
  };
}

/** eslint's own ignore verdict, once per source type under the allowlist. */
export function probeEslint(root, allowlisted, spawn) {
  const samples = [];
  const seenExt = new Set();
  for (const rel of allowlisted) {
    const ext = extname(rel);
    if (!SOURCE_EXT.has(ext) || seenExt.has(ext)) continue;
    seenExt.add(ext);
    samples.push(rel);
  }
  if (samples.length === 0)
    return {
      read: [],
      detail:
        'no lintable source type under the allowlist, so eslint cannot open one',
    };
  const res = run(
    spawn ?? spawnSync,
    'npx',
    ['eslint', '--format', 'json', ...samples],
    root
  );
  const parsed = parseJsonArray(res, 'eslint --format json');
  if (parsed.error) return { error: parsed.error };
  const read = parsed.value
    .filter(
      (entry) =>
        !entry.ignored &&
        !entry.messages.some((m) =>
          /File ignored|matching ignore pattern/.test(String(m.message))
        )
    )
    .map((entry) => posix(relative(root, entry.filePath)))
    .filter(Boolean);
  return {
    read,
    detail: `${samples.length} source type(s) asked: ${samples.join(', ')}`,
  };
}

/**
 * Whether a tool's ignore config excludes the allowlisted *directories*, not merely the files that
 * happen to sit under them today.
 *
 * The probe above asks about real files, so alone it would pass with a `docs/*.md` rule and then let
 * the first `.txt` under `docs/` into `prettier --check .`. Matching the directory in the config text
 * is the half the probe cannot do, which is why both are required.
 */
export function ignoreCoversDirectory(root, tool, patterns) {
  const ignoreFile =
    tool === 'prettier' ? '.prettierignore' : 'eslint.config.mjs';
  const text = readText(root, ignoreFile);
  if (text == null)
    return {
      error: `${ignoreFile} does not exist, so there is nothing to check`,
    };
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`\\$])\/\/[^\n]*/g, '$1 ');
  // Tokens, not substrings: `docs/*.md` *contains* `docs`, and a substring test called it directory
  // coverage - which is exactly the false pass this function exists to prevent. An entry counts only
  // when it is the directory itself (`docs`, `docs/`) or a whole-directory glob (`docs/**`).
  const entries = code
    .split(/[^\S\n]+|["'`,()[\]{}]/)
    .map((token) => posix(String(token).trim()).replace(/^\/+|\/+$/g, ''))
    .filter(
      (token) =>
        token !== '' && !token.startsWith('!') && !token.includes('\u0000')
    )
    .map((token) => token.replace(/\/\*\*(?:\/\*)?$/, '').replace(/^\/+/, ''));
  const missing = patterns
    .map((pattern) => posix(pattern).replace(/\/\*\*$/, ''))
    .filter((dir) => !entries.includes(dir));
  if (missing.length > 0) {
    return {
      covers: false,
      why: `${ignoreFile} no longer names ${missing.join(', ')} as a directory, so today's verdict would not survive a new file type under it`,
    };
  }
  return { covers: true, why: '' };
}

/**
 * The files reachable from `starts`: each one's text, the paths it names, and the config files that
 * set parses. Bounded by `maxFiles` and by "it has to exist in the repo".
 */
export function reachableFrom(root, starts, patterns, maxFiles = 1200) {
  const seen = new Set();
  const queued = new Set();
  const queue = [];
  const push = (rel) => {
    if (seen.has(rel) || queued.has(rel)) return;
    queued.add(rel);
    queue.push(rel);
  };
  for (const rel of starts) push(rel);
  while (queue.length && seen.size < maxFiles) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const base = rel.split('/').pop();
    const followable =
      SOURCE_EXT.has(extname(rel)) ||
      SCRIPT_EXT.has(extname(rel)) ||
      CONFIG_BASENAMES.has(base);
    if (!followable) continue;
    const facts = fileFacts(root, rel, patterns);
    for (const value of facts.mentioned) {
      if (!existsSync(join(root, value))) continue;
      const targetBase = value.split('/').pop();
      const interesting =
        SOURCE_EXT.has(extname(value)) ||
        SCRIPT_EXT.has(extname(value)) ||
        CONFIG_BASENAMES.has(targetBase) ||
        CONFIG_BASENAMES.has(base);
      if (!interesting) continue;
      push(value);
    }
  }
  return seen;
}

/**
 * @param {{root?: string, allowlist?: string[], exclude?: string[], spawn?: Function, steps?: Array<{name: string}>}} [options]
 * @returns {{code: number, violations: string[], notes: string[], exemptions: string[]}}
 */
export function checkDocsDrift(options = {}) {
  const root =
    options.root ?? findRepoRoot({ startDir: process.cwd(), existsSync });
  const patterns = options.allowlist ?? CHECK_REUSE_ALLOWLIST;
  const excludes = options.exclude ?? CHECK_REUSE_EXCLUDE;
  const spawn = options.spawn ?? spawnSync;
  const violations = [];
  const notes = [];
  const exemptions = [];
  const excludedReads = [];

  if (!Array.isArray(patterns) || patterns.length === 0) {
    return {
      code: 0,
      violations: [],
      notes: ['the allowlist is empty, so reuse can never accept a check row'],
      exemptions,
    };
  }

  const pkg = readJson(root, 'package.json');
  if (pkg?.scripts == null)
    return {
      code: 1,
      violations: [`${root}/package.json has no scripts`],
      notes,
      exemptions,
    };
  const scripts = pkg.scripts;

  const onDisk = listFiles(root);
  const allowlisted = onDisk.filter(
    (f) =>
      isReuseAllowlistedPath(f, patterns) &&
      !isReuseAllowlistedPath(f, excludes)
  );
  const excluded = onDisk.filter(
    (f) =>
      isReuseAllowlistedPath(f, patterns) && isReuseAllowlistedPath(f, excludes)
  );
  notes.push(
    `allowlist ${patterns.join(', ')} minus ${excludes.length ? excludes.join(', ') : '(nothing)'} - ${allowlisted.length} file(s) it covers, ${excluded.length} excluded as read`
  );
  if (allowlisted.length === 0)
    violations.push(
      `nothing exists under ${patterns.join(', ')} - the probes would prove nothing`
    );

  const plan =
    options.steps ?? CHECK_STEPS.map((step) => ({ name: step.name }));
  const known = new Map(KNOWN_STEPS.map((entry) => [entry.name, entry]));
  for (const entry of KNOWN_STEPS) {
    if (!CHECK_STEPS.some((step) => step.name === entry.name))
      violations.push(
        `${entry.name}: this proof classifies a step that is no longer in CHECK_STEPS - drop the entry`
      );
  }

  /** Judges one file, attributing any finding to the step(s) that reach it. */
  const judged = new Set();
  function judge(rel, owner) {
    if (rel === SELF) return 0;
    const key = `${rel}|${owner}`;
    if (judged.has(key)) return 0;
    judged.add(key);
    const facts = fileFacts(root, rel, patterns);
    if (facts.parseError) {
      violations.push(
        `${owner}: ${rel} is ${extname(rel)} source this scan cannot parse, so what it reads is unknown`
      );
      return 1;
    }
    for (const read of facts.reads) {
      // A path the exclude list takes back is a read the reuse rule already pays for: `need` refuses
      // to borrow a check line when the merge changes one of these. So the proof *records* it instead
      // of failing over it - the payment is `CHECK_REUSE_EXCLUDE`'s job, and a test in
      // `check-allowlist.test.js` pins that every excluded path really is one this scan can see.
      if (isReuseAllowlistedPath(read.path, excludes)) {
        excludedReads.push(
          `${owner}: ${rel} ${read.why} ${posix(read.path)} - a known read; reuse refuses over it`
        );
        continue;
      }
      const exempt = EXEMPT.filter((entry) => entry.file === rel).find(
        (entry) => touchesAllowlist(read.path, entry.allowlistedPathPatterns)
      );
      // The mkdtemp excuse is only an excuse for a path that *cannot* be this checkout's. A test that
      // builds temp repos may name `docs/tasks/X1/gates.jsonl` freely - it points at its own copy -
      // but if the path it names exists here, the file is reading the real thing, and no exemption
      // built on "it probably means its fixture" can say otherwise. This is what caught the first
      // version of this file excusing its own test reading `docs/tasks/ORCHESTRATOR.md`.
      const namesARealFile =
        read.path !== undefined && existsSync(join(root, read.path));
      if (
        exempt != null &&
        !namesARealFile &&
        (rel === 'scripts/gate-core.mjs' ||
          facts.hasMkdtemp ||
          callsNamed(root, rel, 'mkdtempSync'))
      ) {
        exemptions.push(
          `${owner}: ${rel} ${read.why} ${posix(read.path)} - allowed: ${exempt.reason}`
        );
        continue;
      }
      if (exempt != null && namesARealFile) {
        violations.push(
          `${owner}: ${rel} ${read.why} ${read.path} - exempted as fixture data, but the path exists in this checkout, so it is a real read`
        );
        continue;
      }
      if (exempt != null) {
        violations.push(
          `${owner}: ${rel} ${read.why} ${read.path} - exempted, but the file builds no temp repo, so the exemption does not apply`
        );
        continue;
      }
      violations.push(
        `${owner}: ${rel} ${read.why} ${read.path}, which the allowlist claims is never read`
      );
    }
    for (const walkHit of facts.walks) {
      const directory = walkHit.directory ?? '';
      const exempt = EXEMPT_WALKS.find(
        (entry) => entry.file === rel && directory.startsWith(entry.directory)
      );
      if (exempt != null) {
        if (
          !isReuseAllowlistedPath('docs/tasks/X9/gates.jsonl', [exempt.reaches])
        ) {
          violations.push(
            `${owner}: ${rel} ${walkHit.what} - excused by a pattern that no longer matches what it reaches`
          );
          continue;
        }
        exemptions.push(
          `${owner}: ${rel} ${walkHit.what} - allowed: ${exempt.reason} (reachable set: ${exempt.reaches})`
        );
        continue;
      }
      if (walkHit.directory === '' || walkHit.directory === '.') {
        violations.push(
          `${owner}: ${rel} ${walkHit.what} - a walk of the repo cannot be bounded by an allowlist`
        );
        continue;
      }
      // A listing of a directory under the allowlist: the allowlist is a promise about it, and a
      // listing keeps no promise about what is in there.
      violations.push(
        `${owner}: ${rel} ${walkHit.what} - a walk cannot be bounded by an allowlist`
      );
    }
    return 1;
  }

  // 1. argv: a step that names an allowlisted path in its command is reading it. Always over the real
  // graph plus anything the caller added, so judging a subset cannot hide an unclassified step.
  const planNames = [
    ...new Set([
      ...CHECK_STEPS.map((step) => step.name),
      ...plan.map((step) => step.name),
    ]),
  ];
  for (const name of planNames) {
    const entry = known.get(name);
    if (entry == null) {
      violations.push(
        `${name}: no entry in ${SELF} - say what it reads before the allowlist can cover it`
      );
      continue;
    }
    if (scripts[name] == null) {
      violations.push(
        `${name}: package.json has no such script, so the plan and the manifest disagree`
      );
      continue;
    }
    if (scripts[name] !== entry.argv) {
      violations.push(
        `${name}: its command is now ${JSON.stringify(scripts[name])} but this proof was written for ${JSON.stringify(entry.argv)} - re-prove it`
      );
      continue;
    }
    const hits = [...scripts[name].matchAll(/['"`]([^'"`\n]{1,240})['"`]/g)]
      .map((m) => posix(String(m[1]).replace(/^\.\//, '')).replace(/\/+$/, ''))
      .filter(
        (value) =>
          isReuseAllowlistedPath(value, patterns) &&
          !isReuseAllowlistedPath(value, excludes)
      );
    if (hits.length > 0)
      violations.push(
        `${name}: its command ${JSON.stringify(scripts[name])} names ${hits.join(', ')}`
      );
  }

  // 2. the code each step loads.
  let judgedCalls = 0;
  for (const step of plan) {
    const entry = known.get(step.name);
    if (entry == null) continue;
    if (entry.kind === 'graph') {
      const starts = entry.starts ?? [];
      const missing = starts.filter((rel) => !existsSync(join(root, rel)));
      if (missing.length > 0)
        violations.push(
          `${step.name}: ${missing.join(', ')} no longer exists, so this proof is stale`
        );
      const graph = reachableFrom(root, starts, patterns);
      for (const rel of graph) judgedCalls += judge(rel, step.name);
      notes.push(
        `${step.name}: ${graph.size} file(s) reachable from ${starts.join(', ')} judged`
      );
      if (entry.alsoPackList) {
        const packed = packList(root, patterns, excludes, spawn);
        if (packed.error) violations.push(`${step.name}: ${packed.error}`);
        else if (packed.files.length > 0)
          violations.push(
            `${step.name}: the publish surface contains ${packed.files.slice(0, 3).join(', ')}`
          );
        else notes.push(`${step.name}: ${packed.detail}`);
      }
      continue;
    }
    if (entry.kind === 'config-tool') {
      const result = configTool(
        entry.config,
        root,
        patterns,
        excludes,
        allowlisted
      );
      if (result.error)
        violations.push(
          `${step.name}: could not check ${entry.config} (${result.error})`
        );
      else if (result.files.length > 0)
        violations.push(
          `${step.name}: ${entry.config} points the tool at ${result.files.slice(0, 3).join(', ')}`
        );
      else
        notes.push(
          `${step.name}: ${entry.config} stays clear (${result.detail})`
        );
      continue;
    }
    if (entry.kind === 'pack-list') {
      const packed = packList(root, patterns, excludes, spawn);
      if (packed.error) violations.push(`${step.name}: ${packed.error}`);
      else if (packed.files.length > 0)
        violations.push(
          `${step.name}: the publish surface contains ${packed.files.slice(0, 3).join(', ')}`
        );
      else notes.push(`${step.name}: ${packed.detail}`);
      continue;
    }
    if (entry.kind === 'jest' || entry.kind === 'glob-tool') continue;
    violations.push(
      `${step.name}: unknown kind "${entry.kind}" in the classification table`
    );
  }

  // 3. the tools' own answers, plus the run's test graph.
  for (const step of plan) {
    const entry = known.get(step.name);
    if (entry == null) continue;
    if (entry.kind === 'glob-tool') {
      const result =
        entry.tool === 'prettier'
          ? probePrettier(root, allowlisted, spawn)
          : probeEslint(root, allowlisted, spawn);
      if (result.error) {
        violations.push(
          `${step.name}: could not ask ${entry.tool} what it ignores (${result.error}) - unproven is not proven`
        );
        continue;
      }
      if (result.read.length > 0) {
        violations.push(
          `${step.name}: ${entry.tool} would read ${result.read.slice(0, 3).join(', ')}`
        );
        continue;
      }
      notes.push(
        `${step.name}: ${entry.tool} ignores it all (${result.detail})`
      );
      const coverage = ignoreCoversDirectory(root, entry.tool, patterns);
      if (coverage.error) violations.push(`${step.name}: ${coverage.error}`);
      else if (!coverage.covers)
        violations.push(`${step.name}: ${coverage.why}`);
      continue;
    }
    if (entry.kind !== 'jest') continue;
    const listed = run(spawn, 'npx', ['jest', '--listTests'], root);
    if (!listed.stdout.trim()) {
      violations.push(
        `${step.name}: jest --listTests produced nothing (exit ${listed.status} ${listed.detail}) - cannot see what the run loads`
      );
      continue;
    }
    const testFiles = listed.stdout
      .split('\n')
      .map((line) => posix(relative(root, line.trim())))
      .filter((rel) => rel && !rel.startsWith('..'))
      .filter((rel) => TEST_FILE.test(rel));
    const graph = reachableFrom(root, testFiles, patterns, 4000);
    for (const rel of graph)
      judgedCalls += judge(rel, `${step.name} (what jest loads)`);
    notes.push(
      `${step.name}: ${testFiles.length} test file(s), ${graph.size} reachable file(s) judged`
    );
  }

  // A codegen spec glob that matches would be a read no probe above can see.
  const nitro = readJson(root, 'nitro.json') ?? {};
  const specs = [...(nitro.specs ?? []), ...(nitro.commonHeaders ?? [])].map(
    posix
  );
  const readUnder = specs.filter((glob) =>
    allowlisted.some((f) => globToRegExp(glob).test(f))
  );
  if (readUnder.length > 0)
    violations.push(
      `registry:check / nitrogen:check: a nitro.json spec glob matches the allowlist (${readUnder.join(', ')})`
    );
  else
    notes.push(
      `registry:check / nitrogen:check: no nitro.json spec glob reaches it (${specs.join(', ') || 'no specs'})`
    );

  const distinctFiles = new Set(
    [...judged].map((key) => key.slice(0, key.lastIndexOf('|')))
  );
  notes.push(
    `${distinctFiles.size} distinct file(s) judged against the allowlist ` +
      `(${judgedCalls} judgements - a file reached by two steps is judged for both)`
  );
  return {
    code: violations.length > 0 ? 1 : 0,
    violations,
    notes,
    exemptions,
    excludedReads,
    judgedFiles: distinctFiles.size,
    judgedCalls,
  };
}

/** CLI form, so the proof can be run by hand: `node scripts/check-docs-drift.mjs`. */
export function main() {
  const result = checkDocsDrift();
  for (const note of result.notes) console.log(`check-docs-drift: ${note}`);
  for (const line of result.exemptions)
    console.log(`check-docs-drift: exemption honoured: ${line}`);
  for (const line of result.excludedReads)
    console.log(`check-docs-drift: excluded read: ${line}`);
  if (result.code !== 0) {
    console.error(
      '\ncheck-docs-drift: the merge-reuse allowlist is no longer true:'
    );
    for (const violation of result.violations)
      console.error(`  - ${violation}`);
    console.error('');
    console.error(
      'Either stop reading those paths, or narrow CHECK_REUSE_ALLOWLIST / extend'
    );
    console.error(
      'CHECK_REUSE_EXCLUDE in scripts/gate-core.mjs to what really is not read, and say so'
    );
    console.error('in docs/tasks/X10-check-throughput.report.md.');
    console.error(
      '(Reuse is what this protects: a check line says nothing about the files a merge adds'
    );
    console.error(
      'beyond the checked commit, so the allowlist has to be the whole story.)'
    );
  } else {
    console.log(
      `check-docs-drift: no check step reads the allowlist (${CHECK_REUSE_ALLOWLIST.join(', ')})`
    );
  }
  return result.code;
}

/**
 * Runs the proof when invoked as a command, and does nothing when imported - which is how the `test`
 * step runs it. Self is recognised by repo-relative path rather than by `import.meta.url`, because
 * this module avoids that for jest's sake; both sides are realpath-ed, so a relative or symlinked
 * invocation still finds itself.
 */
export function runIfInvokedDirectly(argv1 = process.argv[1]) {
  if (argv1 == null) return false;
  const abs = resolve(argv1);
  if (!existsSync(abs)) return false;
  let self;
  try {
    self = posix(
      relative(
        findRepoRoot({ startDir: process.cwd(), existsSync }),
        realpathSync(abs)
      )
    );
  } catch {
    return false;
  }
  if (self !== SELF) return false;
  process.exitCode = main();
  return true;
}

runIfInvokedDirectly();
