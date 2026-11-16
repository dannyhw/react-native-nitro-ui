/**
 * The repo files a device gate reads, found by following imports from the files
 * the gate starts. Used to prove that a path left out of a gate's digest is one
 * that gate never reads.
 *
 * The walk is deliberately wide: every platform variant of a module (`.ios.tsx`,
 * `.android.tsx`, `.native.tsx`) is followed, type-only imports are followed, and
 * a package import of the library itself is followed into `src/`. Reaching too
 * much makes the proof stricter, never weaker.
 */

import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'];
const PLATFORM_INFIXES = ['.ios', '.android', '.native', ''];
const PARSED = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs']);

/** The library's own package name: the example resolves it to `src/`. */
const LIBRARY_PACKAGE = 'react-native-nitro-ui';

/**
 * Every file a specifier can resolve to, repo-relative.
 *
 * @param {string} repoRoot
 * @param {string} fromFile repo-relative
 * @param {string} specifier
 * @returns {string[]}
 */
export function resolveSpecifier(repoRoot, fromFile, specifier) {
  let base;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.join(path.dirname(fromFile), specifier);
  } else if (specifier === LIBRARY_PACKAGE) {
    base = 'src/index';
  } else if (specifier.startsWith(`${LIBRARY_PACKAGE}/`)) {
    base = path.join('src', specifier.slice(LIBRARY_PACKAGE.length + 1));
  } else {
    return [];
  }
  base = path.normalize(base).split(path.sep).join('/');
  const exists = (file) => {
    try {
      return fs.statSync(path.join(repoRoot, file)).isFile();
    } catch {
      return false;
    }
  };
  if (exists(base)) return [base];
  const found = [];
  for (const stem of [base, `${base}/index`]) {
    for (const infix of PLATFORM_INFIXES) {
      for (const extension of EXTENSIONS) {
        const candidate = `${stem}${infix}${extension}`;
        if (exists(candidate)) found.push(candidate);
      }
    }
    if (found.length > 0) return found;
  }
  return found;
}

/**
 * The module specifiers and the string literals in one source file. Comments
 * are not code, so a path named in a comment is not a read.
 *
 * @param {string} text
 * @param {string} file for the parser's choice of dialect
 * @returns {{specifiers: string[], literals: string[]}}
 */
export function scanSource(text, file) {
  const kind =
    file.endsWith('.tsx') || file.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : file.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  const specifiers = [];
  const literals = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier != null &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'resolve' &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'require'))
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    if (ts.isTemplateExpression(node)) {
      literals.push(node.head.text);
      for (const span of node.templateSpans) literals.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, literals };
}

/**
 * Every repo file reachable from `roots` through imports, with who reached it.
 *
 * @param {string} repoRoot
 * @param {string[]} roots repo-relative
 * @returns {Map<string, {from: string | null, literals: string[]}>}
 */
export function reachableFiles(repoRoot, roots) {
  const reached = new Map();
  const queue = roots.map((file) => [file, null]);
  while (queue.length > 0) {
    const [file, from] = queue.shift();
    if (reached.has(file)) continue;
    const record = { from, literals: [] };
    reached.set(file, record);
    if (!PARSED.has(path.extname(file))) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    const { specifiers, literals } = scanSource(text, file);
    record.literals = literals;
    for (const specifier of specifiers) {
      for (const target of resolveSpecifier(repoRoot, file, specifier)) {
        if (!reached.has(target)) queue.push([target, file]);
      }
    }
  }
  return reached;
}

/** `a <- b <- c`: how the walk reached a file, for a failure message. */
export function chainTo(reached, file) {
  const chain = [file];
  let at = reached.get(file)?.from ?? null;
  while (at != null && chain.length < 20) {
    chain.push(at);
    at = reached.get(at)?.from ?? null;
  }
  return chain.join(' <- ');
}
