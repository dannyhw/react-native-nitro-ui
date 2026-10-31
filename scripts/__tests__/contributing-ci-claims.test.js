/**
 * Does CONTRIBUTING describe the CI that `ci.yml` actually runs?
 *
 * The claim worth guarding is the runner label. D3's review found the prose saying
 * the host native tests run in a `macos-latest` job while the workflow names
 * `macos-26` on purpose - a floating label means the Swift toolchain changes under a
 * green run. A contributor who reads the doc asks the wrong question of a red job,
 * and nothing in the chain notices, so the two files are compared here instead.
 *
 * The comparison is one-directional on purpose: every runner label the prose names
 * has to be one a workflow really schedules on. The reverse (a label the doc does not
 * mention) is not a lie, so it is not a failure.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/** Every `runs-on:` label in `.github/workflows/*.yml`, in whatever form it is written. */
function scheduledRunnerLabels() {
  const workflowDir = path.join(root, '.github', 'workflows');
  const labels = new Set();
  for (const entry of fs.readdirSync(workflowDir)) {
    if (!entry.endsWith('.yml')) continue;
    const text = fs.readFileSync(path.join(workflowDir, entry), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^\s*runs-on:\s*(.+?)\s*$/.exec(line);
      if (match == null) continue;
      const value = match[1];
      // A expression is a choice between literals, so take the literals out of it;
      // a plain scalar is its own label.
      const quoted = [...value.matchAll(/'([^']+)'/g)].map((group) => group[1]);
      for (const label of quoted.length > 0 ? quoted : [value]) {
        if (label.startsWith('${')) continue;
        labels.add(label);
      }
    }
  }
  return labels;
}

/** Every runner label CONTRIBUTING's prose names, in backticks, near CI talk. */
function documentedRunnerLabels(text) {
  // A label is a family *and* a version/`-latest`: `xcodebuild` on its own is the
  // build tool, not a runner.
  return new Set(
    [...text.matchAll(/`(macos|ubuntu|windows|xcode)-[\w.]+`/g)].map((group) =>
      group[0].replace(/`/g, '')
    )
  );
}

describe('CONTRIBUTING describes the runners CI schedules on', () => {
  const scheduled = scheduledRunnerLabels();

  it('finds the labels to compare, so neither side can pass by being empty', () => {
    expect(scheduled.size).toBeGreaterThan(0);
    expect(scheduled).toContain('macos-26');
    const documented = documentedRunnerLabels(read('CONTRIBUTING.md'));
    expect(documented.size).toBeGreaterThan(0);
  });

  it('names no runner label that no workflow uses', () => {
    const documented = documentedRunnerLabels(read('CONTRIBUTING.md'));
    const invented = [...documented].filter((label) => !scheduled.has(label));
    expect(invented).toEqual([]);
  });
});
