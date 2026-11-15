#!/usr/bin/env node
// Fails unless every ```tsx name=<region> block in README.md equals the
// `// #region <region>` … `// #endregion` lines of
// example/src/readme-examples.tsx, and every region there appears in the README.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const EXAMPLES = join(ROOT, 'example/src/readme-examples.tsx');

/** Lines of `text` between `open` and `close`, keyed by the captured name. */
function collect(text, open, close, source) {
  const found = new Map();
  const pattern = new RegExp(`${open}([\\s\\S]*?)${close}`, 'g');
  let match;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].trim();
    const body = (match[2] ?? '').replace(/^\n+|\n+$/g, '');
    index = pattern.lastIndex - match[0].length + match[0].indexOf(match[2]);
    if (found.has(name)) {
      console.error(`${source}: duplicate "${name}" at offset ${index}`);
      process.exitCode = 1;
    }
    found.set(name, body);
  }
  return found;
}

const readmeBlocks = collect(
  readFileSync(README, 'utf8'),
  '```tsx name=([a-z-]+)\\n',
  '```',
  README
);
const exampleRegions = collect(
  readFileSync(EXAMPLES, 'utf8'),
  '// #region ([a-z-]+)\\n',
  '// #endregion',
  EXAMPLES
);

const problems = [];
for (const [name, code] of readmeBlocks) {
  const region = exampleRegions.get(name);
  if (region === undefined) {
    problems.push(`${name}: README block has no region in the example file`);
  } else if (region !== code) {
    problems.push(
      `${name}: README and ${EXAMPLES.replace(ROOT + '/', '')} differ\n` +
        diff(region, code)
    );
  }
}
for (const name of exampleRegions.keys()) {
  if (!readmeBlocks.has(name)) {
    problems.push(`${name}: example region is not shown in the README`);
  }
}

/** First difference, with a few lines of context from each side. */
function diff(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 2);
      const show = (lines) =>
        lines
          .slice(from, i + 3)
          .map((line) => `      ${line ?? ''}`)
          .join('\n');
      return `      first difference at line ${i + 1}:\n    example:\n${show(
        a
      )}\n    README:\n${show(b)}`;
    }
  }
  return '';
}

if (problems.length > 0) {
  console.error(
    `README examples drifted (${problems.length}): ` +
      problems.map((p) => p.split(':')[0]).join(', ')
  );
  for (const problem of problems) {
    console.error(`\n${problem}`);
  }
  console.error(
    `\nFix: copy the region from example/src/readme-examples.tsx into the\n` +
      `matching \`\`\`tsx name=<region> block in README.md (or the other way round).\n` +
      `Both sides are typechecked, so only the text can disagree.`
  );
  process.exit(1);
}

console.log(
  `README examples: ${readmeBlocks.size} blocks match example/src/readme-examples.tsx`
);
