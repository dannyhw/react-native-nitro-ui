/**
 * The conformance suite's deciding logic, with no device.
 *
 * This is where "the suite picks up a new manifest automatically" is proved: the
 * coverage matrix and its check are run against a manifest the repo does not have
 * (a `Menu`), and the suite has to notice. A manifest-driven suite that only passes on
 * the seven controls it was written for is a suite with seven hand-written cases and a
 * loop around them, which is what X4 exists to replace.
 *
 * The rule bodies are also driven here rather than only on a device, because their
 * failure modes are arithmetic the harness cannot vary: a fallback that equals the
 * measured size, a poisoned guess that is never corrected, ledger entries that outlive
 * their instance. On a device those need the component to be broken; here they need an
 * argument.
 *
 * @file
 */

import { describe, expect, it } from '@jest/globals';

import {
  CONFORMANCE_EXEMPTIONS,
  CONFORMANCE_RULES,
  DECLARED_FALLBACKS,
  POISON_SIZES,
  repoRoot,
  RULE_IDS,
  checkA11yTable,
  checkCoverage,
  checkFallbackTable,
  checkSharedTableMirror,
  classifyFindings,
  coverageMatrix,
  findingKey,
  formatMatrix,
  leakFindings,
  readerFor,
  recycleFindings,
  repoManifests,
  fallbackFindings,
  sharedInAppTable,
  staleDebt,
  staleExemptions,
} from '../conformance-core.mjs';
import { A11Y_CONTROLS } from '../real-input/a11y.mjs';
import { runA11ySweep } from '../real-input/a11y-sweep.mjs';
import { parseHierarchy } from '../real-input/uiautomator.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = readerFor();

/** A manifest with just enough shape for the rules to reason about it. */
function manifest(overrides = {}) {
  return {
    id: 'switch',
    name: 'Switch',
    hybridView: 'NitroUiSwitch',
    sizing: 'intrinsic',
    exampleTab: 'switch',
    ...overrides,
  };
}

/**
 * A deep copy, for mutating a table without touching the real one.
 *
 * `structuredClone` would be the obvious call and is available in the Node this repo runs
 * scripts with, but ESLint's config for `scripts/__tests__` declares no globals, so an
 * undefined identifier there is a lint error rather than a runtime problem. A JSON round trip
 * is enough for these tables and says what it does.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** The repo's manifests, with one control added that this repo does not have. */
function repoWithExtraControl(extra) {
  const manifests = repoManifests();
  if (extra != null) manifests.push(manifest(extra));
  return manifests;
}

/* ---------------------------------- the rules --------------------------------- */

describe('the rule list', () => {
  it('is the four rules, each with the gates that assert it', () => {
    expect(RULE_IDS).toEqual([
      'a11y-name-on-focusable-node',
      'declared-fallback',
      'no-leak-on-drop',
      'recycle-reset',
    ]);
    for (const rule of CONFORMANCE_RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.runs.length).toBeGreaterThan(0);
      for (const gate of rule.runs) {
        // `harness:<platform>` or `real-input:<platform>`. A rule that named a gate the
        // ledger does not know would report green forever.
        expect(gate).toMatch(/^(harness|real-input):(ios|android)$/);
      }
    }
    // The Android a11y half has to name the gate it actually rides.
    expect(
      CONFORMANCE_RULES.find((r) => r.id === 'a11y-name-on-focusable-node').runs
    ).toContain('real-input:android');
  });

  it('answers every rule for a self-sizing control, and says why for one that is not', () => {
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const covered = coverageMatrix([manifest()], { sizing });
    expect(
      Object.values(covered[0].rules).every((cell) => cell.state === 'covered')
    ).toBe(true);

    const plain = coverageMatrix(
      [manifest({ id: 'label', name: 'Label', sizing: undefined })],
      { sizing }
    );
    expect(plain[0].rules['declared-fallback'].state).toBe('not-applicable');
    expect(plain[0].rules['declared-fallback'].reason).toContain(
      'no sizing policy'
    );
    expect(plain[0].rules['no-leak-on-drop'].state).toBe('not-applicable');
    // Recycle reset always applies: identity is a thing every control can get wrong.
    expect(plain[0].rules['recycle-reset'].state).toBe('covered');
  });

  it('picks up a control that does not exist yet', () => {
    // The brief's central requirement, tested by adding one: Menu is 0.4's control, and
    // the moment it has a manifest the matrix has a row for it and every rule has a
    // verdict — `not-applicable` or `covered`, never silence.
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const matrix = coverageMatrix(
      repoWithExtraControl({
        id: 'menu',
        name: 'Menu',
        hybridView: 'NitroUiMenu',
        sizing: 'intrinsic',
        exampleTab: 'menu',
      }),
      { sizing }
    );
    const menu = matrix.find((row) => row.name === 'Menu');
    expect(menu).toBeDefined();
    // No a11y case exists for it, so the a11y rule says so in words — and `checkCoverage`
    // below is what turns that into a red run.
    expect(menu.rules['a11y-name-on-focusable-node'].state).toBe(
      'not-applicable'
    );
    expect(menu.rules['a11y-name-on-focusable-node'].reason).toContain('Menu');
    expect(menu.rules['declared-fallback'].state).toBe('covered');
    expect(menu.rules['recycle-reset'].state).toBe('covered');
  });
});

/* ---------------------------------- coverage ---------------------------------- */

describe('coverage', () => {
  it('is complete for the seven controls today', () => {
    const manifests = repoManifests();
    expect(manifests.map((m) => m.name)).toEqual([
      'Button',
      'DatePicker',
      'Picker',
      'Progress',
      'SegmentedControl',
      'Slider',
      'Switch',
    ]);
    const matrix = coverageMatrix(manifests, {
      sizing: JSON.parse(read('nitro-ui.sizing.json')),
    });
    expect(checkCoverage(manifests, matrix, () => null)).toEqual([]);
  });

  it('goes red for a manifest no rule covers', () => {
    const manifests = repoWithExtraControl({
      id: 'menu',
      name: 'Menu',
      hybridView: 'NitroUiMenu',
      sizing: undefined,
      exampleTab: 'menu',
    });
    const matrix = coverageMatrix(manifests, { sizing: {} });
    const problems = checkCoverage(manifests, matrix, () => null);
    // Every rule answers `not-applicable` with a reason, so coverage is complete — but
    // the a11y rule's reason is a gap, and `checkA11yTable` is where that is caught.
    expect(problems).toEqual([]);
    expect(checkA11yTable(manifests, () => null).join('\n')).toContain(
      'no a11y case for Menu'
    );
  });

  it('goes red when a matrix row is missing or a cell has no verdict', () => {
    const manifests = repoManifests();
    const matrix = coverageMatrix(manifests, { sizing: {} });
    expect(checkCoverage(manifests, matrix.slice(1), () => null)[0]).toContain(
      'a manifest with no row'
    );
    const broken = clone(matrix);
    delete broken[0].rules['recycle-reset'];
    expect(checkCoverage(manifests, broken, () => null)[0]).toContain(
      'no verdict'
    );
  });

  it('goes red when a failing rule has no FOLLOWUPS line', () => {
    const manifests = repoManifests();
    const matrix = coverageMatrix(manifests, {
      failing: [findingKey('Switch', 'recycle-reset')],
      sizing: {},
    });
    expect(matrix[6].rules['recycle-reset'].state).toBe('failing');
    expect(checkCoverage(manifests, matrix, () => null).join('\n')).toContain(
      'marked failing with no'
    );
    // …and green once the line exists, which is the whole contract: debt needs an address.
    expect(
      checkCoverage(
        manifests,
        matrix,
        () => 'X4: Switch keeps its previous owner'
      )
    ).toEqual([]);
  });

  it('prints the matrix with a verdict per cell, for the report', () => {
    const manifests = repoManifests();
    const matrix = coverageMatrix(manifests, {
      failing: [findingKey('Slider', 'a11y-name-on-focusable-node')],
      sizing: {},
    });
    const lines = formatMatrix(
      matrix,
      CONFORMANCE_RULES,
      () => 'docs/tasks/FOLLOWUPS.md'
    );
    expect(lines[0]).toContain('| Control |');
    expect(lines.find((line) => line.includes('| Slider |'))).toContain(
      '**failing** — see docs/tasks/FOLLOWUPS.md'
    );
    expect(lines.find((line) => line.includes('| Switch |'))).toContain(
      'covered'
    );
  });
});

/* ------------------------------- fallback findings --------------------------- */

describe('the declared-fallback rule', () => {
  const expected = DECLARED_FALLBACKS.NitroUiSwitch.ios;

  it('passes when the declared fallback is the control’s own and nothing corrected it', () => {
    expect(
      fallbackFindings({
        component: 'Switch',
        platform: 'ios',
        declared: expected,
        measured: expected,
        corrections: 0,
      })
    ).toEqual([]);
  });

  it('goes red when the engine has no fallback at all', () => {
    const findings = fallbackFindings({
      component: 'Switch',
      platform: 'ios',
      declared: null,
      measured: expected,
      corrections: 0,
    });
    expect(findings.length).toBe(1);
    expect(findings[0].rule).toBe('declared-fallback');
    expect(findings[0].problem).toContain('no declared fallback');
  });

  it('goes red when the engine’s number is not the table’s', () => {
    const findings = fallbackFindings({
      component: 'Switch',
      platform: 'ios',
      declared: { width: 51, height: 31 },
      measured: expected,
      corrections: 0,
    });
    expect(findings[0].problem).toContain('the engine declares 51x31');
    expect(findings[0].problem).toContain('61x28');
  });

  it('goes red when a fallback is shared by two controls', () => {
    // The "someone pasted the previous component's number" shape, invisible to the
    // generated policy check because the policy is right and only the number is stale.
    const manifests = repoManifests();
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const copied = clone(DECLARED_FALLBACKS);
    copied.NitroUiSlider.ios = { ...copied.NitroUiSwitch.ios };
    const problems = checkFallbackTable(manifests, sizing, copied);
    expect(problems.join('\n')).toContain(
      '61x28 on ios for NitroUiSlider and NitroUiSwitch'
    );
    expect(problems.join('\n')).toContain('one of these rows was copied');
  });

  it('goes red when a control has no row in the table', () => {
    const manifests = repoWithExtraControl({
      id: 'menu',
      name: 'Menu',
      hybridView: 'NitroUiMenu',
      sizing: 'intrinsic',
      exampleTab: 'menu',
    });
    const problems = checkFallbackTable(
      manifests,
      {
        ...JSON.parse(read('nitro-ui.sizing.json')),
        HybridNitroUiMenu: 'intrinsic',
      },
      DECLARED_FALLBACKS
    );
    expect(problems.join('\n')).toContain(
      'no DECLARED_FALLBACKS row for NitroUiMenu'
    );
  });

  it('goes red when the sizing table and the manifest disagree', () => {
    const manifests = repoManifests();
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const problems = checkFallbackTable(
      manifests,
      { ...sizing, HybridNitroUiSwitch: 'deferred' },
      DECLARED_FALLBACKS
    );
    expect(problems.join('\n')).toContain(
      'HybridNitroUiSwitch says "deferred"'
    );
    // And the missing-row case, which is the one that puts a control in the `0x0` branch.
    const missing = checkFallbackTable(manifests, {}, DECLARED_FALLBACKS);
    expect(missing[0]).toContain('no row for Hybrid');
    expect(missing[0]).toContain('0x0');
  });

  it('goes red when a declared size is not positive', () => {
    const zeroed = clone(DECLARED_FALLBACKS);
    zeroed.NitroUiButton.android = { width: 0, height: 48 };
    expect(
      checkFallbackTable(
        repoManifests(),
        JSON.parse(read('nitro-ui.sizing.json')),
        zeroed
      ).join('\n')
    ).toContain('is not a positive size');
  });

  it('passes the clean tables, which is the assertion the mutations above are measured against', () => {
    expect(
      checkFallbackTable(
        repoManifests(),
        JSON.parse(read('nitro-ui.sizing.json'))
      )
    ).toEqual([]);
  });

  it('catches a poisoned guess that was never corrected', () => {
    // The one the brief asks for by name: a fixture equal to the right answer hides a
    // failed correction, so the device run poisons the guess with a size nothing declares
    // and asserts the correction arrives. These are the three outcomes it can report.
    const poison = POISON_SIZES.ios;
    const settledAtPoison = fallbackFindings({
      component: 'Switch',
      platform: 'ios',
      declared: expected,
      measured: poison,
      corrections: 1,
      poisoned: true,
    });
    expect(settledAtPoison[0].problem).toContain(
      'settled at the poisoned 97x11'
    );

    const silent = fallbackFindings({
      component: 'Switch',
      platform: 'ios',
      declared: expected,
      measured: expected,
      corrections: 0,
      poisoned: true,
    });
    expect(silent[0].problem).toContain('no correction');
    expect(silent[0].problem).toContain('the correction went missing');

    const corrected = fallbackFindings({
      component: 'Switch',
      platform: 'ios',
      declared: expected,
      measured: expected,
      corrections: 1,
      poisoned: true,
    });
    expect(corrected).toEqual([]);
  });

  it('goes red when a warm mount still needs a correction', () => {
    const findings = fallbackFindings({
      component: 'Switch',
      platform: 'ios',
      declared: expected,
      measured: expected,
      corrections: 3,
    });
    expect(findings[0].problem).toContain('needed 3 correction(s)');
  });

  it('goes red rather than being vacuous when the control has no row', () => {
    const findings = fallbackFindings({
      component: 'Menu',
      platform: 'ios',
      declared: { width: 10, height: 10 },
      measured: { width: 10, height: 10 },
      corrections: 0,
    });
    expect(findings.length).toBe(1);
    expect(findings[0].problem).toContain('vacuous');
  });

  it('uses the poison size for the platform under test', () => {
    expect(POISON_SIZES.android).not.toEqual(POISON_SIZES.ios);
    // A poison that equalled a real fallback would make the poisoned assertion green on
    // the bug, which is the exact failure mode the rule exists to avoid.
    const allSizes = new Set(
      Object.values(DECLARED_FALLBACKS).flatMap((entry) => [
        `${String(entry.ios.width)}x${String(entry.ios.height)}`,
        `${String(entry.android.width)}x${String(entry.android.height)}`,
      ])
    );
    for (const platform of ['ios', 'android']) {
      const size = POISON_SIZES[platform];
      expect(allSizes.has(`${String(size.width)}x${String(size.height)}`)).toBe(
        false
      );
    }
  });
});

/* --------------------------------- leak findings ------------------------------ */

describe('the no-leak-on-drop rule', () => {
  const baseline = {
    component: 'Switch',
    baselineLedger: 4,
    baselineRegistry: 2,
    instances: 200,
  };

  it('passes when the engine is back where it started', () => {
    expect(
      leakFindings({
        ...baseline,
        ledgerEntries: 4,
        registryEntries: 2,
      })
    ).toEqual([]);
  });

  it('goes red when ledger entries outlive their instances', () => {
    const findings = leakFindings({
      ...baseline,
      ledgerEntries: 7,
      registryEntries: 2,
    });
    expect(findings.length).toBe(1);
    expect(findings[0].rule).toBe('no-leak-on-drop');
    expect(findings[0].problem).toContain(
      '3 ledger entry(ies) survived 200 drops'
    );
    expect(findings[0].problem).toContain('onDropView');
  });

  it('goes red when the registry keeps per-instance state', () => {
    const findings = leakFindings({
      ...baseline,
      ledgerEntries: 4,
      registryEntries: 34,
      registryGrowth: 1,
    });
    expect(findings[0].problem).toContain('grew by 32 across 200 mounts');
  });

  it('allows the one registry row a component legitimately gains', () => {
    expect(
      leakFindings({
        ...baseline,
        ledgerEntries: 4,
        registryEntries: 3,
        registryGrowth: 1,
      })
    ).toEqual([]);
  });
});

/* -------------------------------- recycle findings ---------------------------- */

describe('the recycle-reset rule', () => {
  it('passes when every property the control reports matches its new owner', () => {
    expect(
      recycleFindings({
        component: 'Switch',
        identity: 'testID "recycle-switch"',
        checks: [
          { label: 'checked', expected: false, actual: false },
          { label: 'tintColor', expected: null, actual: null },
        ],
      })
    ).toEqual([]);
  });

  it('goes red for the value that stayed behind', () => {
    const findings = recycleFindings({
      component: 'Switch',
      identity: 'testID "recycle-switch"',
      checks: [
        { label: 'checked', expected: false, actual: true },
        { label: 'tintColor', expected: null, actual: 0xff0000 },
      ],
    });
    expect(findings.length).toBe(2);
    expect(findings[0].rule).toBe('recycle-reset');
    expect(findings[0].problem).toContain('came back wearing its');
    expect(findings[1].problem).toContain('tintColor reads 16711680');
  });
});

/* ---------------------------------- the debt --------------------------------- */

describe('the debt ledger', () => {
  it('has no in-app rows today, and the mechanism works when one is added', () => {
    expect(CONFORMANCE_EXEMPTIONS).toEqual([]);
    const finding = {
      component: 'Switch',
      rule: 'recycle-reset',
      problem: 'kept checked',
    };
    // Unmatched: a failure.
    expect(classifyFindings([finding]).failures).toEqual([
      'Switch × recycle-reset: kept checked',
    ]);
    // Matched: known debt, and the key is reported so `staleExemptions` can clear it. The
    // real lists are frozen — that is deliberate, so debt cannot be added at runtime —
    // hence `tables` rather than a push.
    const row = {
      component: 'Switch',
      rule: 'recycle-reset',
      followups: 'X4: Switch keeps a recycled owner’s value',
      detail: 'checked survives a remount',
    };
    const result = classifyFindings([finding], { conformance: [row] });
    expect(result.failures).toEqual([]);
    expect(result.matched).toEqual([findingKey('Switch', 'recycle-reset')]);
    expect(result.known[0]).toContain('known failing (X4:');
    expect(staleExemptions(result.matched, result.matched, [row])).toEqual([]);
    expect(
      staleExemptions([findingKey('Switch', 'recycle-reset')], [], [row])[0]
    ).toContain('matched no finding this run');
  });

  it('matches an a11y row on its finding, not on its control', () => {
    // The a11y list is keyed on the case id and matched by problem text, so a row written
    // for one finding cannot excuse a different one on the same control.
    const row = {
      control: 'slider',
      followups: 'X4: not actionable',
      matches: /not actionable/,
    };
    const tables = { a11y: [row] };
    expect(
      classifyFindings(
        [
          {
            component: 'Slider',
            rule: 'a11y',
            controlId: 'slider',
            problem: 'the node is not actionable',
          },
        ],
        tables
      ).known.length
    ).toBe(1);
    expect(
      classifyFindings(
        [
          {
            component: 'Slider',
            rule: 'a11y',
            controlId: 'slider',
            problem: 'no node carries the name at all',
          },
        ],
        tables
      ).failures.length
    ).toBe(1);
  });

  it('clears an exemption the run covered and found nothing for', () => {
    const rows = [
      {
        component: 'Switch',
        rule: 'recycle-reset',
        followups: 'X4: something',
        detail: 'x',
      },
    ];
    const key = findingKey('Switch', 'recycle-reset');
    expect(staleExemptions([key], [], rows)).toEqual([
      expect.stringContaining('matched no finding this run'),
    ]);
    expect(staleExemptions([key], [key], rows)).toEqual([]);
    // A rule the run did not exercise (a filtered harness run) is not evidence of a fix.
    expect(staleExemptions([], [], rows)).toEqual([]);
  });

  it('sweeps both lists in one call, each on its own key', () => {
    // The a11y list is keyed on a *case* id (one component has two cases: its own screen
    // and inside a `<Host>`) and the in-app list on `component|rule`. `staleDebt` is the
    // one call a run makes, and a row the run covered but did not match must appear.
    const debt = staleDebt({
      a11yCovered: A11Y_CONTROLS.map((entry) => entry.id),
      a11yMatched: ['slider'],
      coveredKeys: [],
      matchedKeys: [],
    });
    expect(debt.length).toBe(3);
    expect(debt.join('\n')).toContain('the entry for "segmented-control"');
    expect(debt.join('\n')).not.toContain('the entry for "slider"');

    // And the in-app half, from the same call. The real list is empty today, so rows are
    // passed in: the sweeper takes them as an argument because that list is frozen —
    // deliberately, so nothing can add debt at runtime.
    const row = {
      component: 'Switch',
      rule: 'recycle-reset',
      followups: 'X4: something',
      detail: 'x',
    };
    expect(
      staleDebt({
        a11yCovered: ['switch'],
        a11yMatched: ['switch'],
        coveredKeys: [findingKey('Switch', 'recycle-reset')],
        matchedKeys: [],
        conformanceRows: [row],
      }).join('\n')
    ).toContain('Switch × recycle-reset');
  });
});

/* ------------------------------- the a11y table ------------------------------ */

describe('the a11y table cross-check', () => {
  it('passes as the repo stands', () => {
    expect(checkA11yTable(repoManifests(), read)).toEqual([]);
  });

  it('goes red when a label stops existing in the screen it names', () => {
    const screen = read('example/src/SwitchScreen.tsx');
    const without = (path) =>
      path === 'example/src/SwitchScreen.tsx'
        ? screen.replace('accessibilityLabel="Controlled switch"', '')
        : read(path);
    expect(checkA11yTable(repoManifests(), without).join('\n')).toContain(
      'looking for a name no screen renders'
    );
  });

  it('goes red when the table’s hybridView drifts from the manifest', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      { ...A11Y_CONTROLS[0], hybridView: 'NitroUiToogle' },
      ...A11Y_CONTROLS.slice(1),
    ]);
    expect(problems.join('\n')).toContain('says hybridView');
  });

  it('goes red when a case names a screen with no file', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      { ...A11Y_CONTROLS[0], screen: 'nope' },
      ...A11Y_CONTROLS.slice(1),
    ]);
    expect(problems.join('\n')).toContain('names no file for');
  });

  it('goes red when an anchor testID is gone', () => {
    const screen = read('example/src/SwitchScreen.tsx');
    const without = (path) =>
      path === 'example/src/SwitchScreen.tsx'
        ? screen.replace(/testID="switch-controlled"/, '')
        : read(path);
    const problems = checkA11yTable(repoManifests(), without, [
      { ...A11Y_CONTROLS[0], anchorTestId: 'switch-controlled' },
      ...A11Y_CONTROLS.slice(1),
    ]);
    expect(problems.join('\n')).toContain('no testID "switch-controlled"');
  });

  it('goes red for a case that guards a control no manifest declares', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      ...A11Y_CONTROLS,
      {
        id: 'ghost',
        component: 'Ghost',
        hybridView: 'NitroUiGhost',
        screen: 'host',
        label: 'Ghost',
      },
    ]);
    expect(problems.join('\n')).toContain('no manifest declares that control');
  });
});

/* ------------------------------- the shared mirror --------------------------- */

describe('the in-app table mirror', () => {
  it('is what the harness file embeds, byte for byte', () => {
    const harnessText = readFileSync(
      join(repoRoot(), 'example/__tests__/Conformance.harness.tsx'),
      'utf8'
    );
    expect(checkSharedTableMirror(harnessText)).toEqual([]);
  });

  it('goes red when the region is missing, corrupt, or stale', () => {
    expect(checkSharedTableMirror('export {}').join('\n')).toContain(
      'no "BEGIN CONFORMANCE SHARED TABLE" region'
    );
    const good = readFileSync(
      join(repoRoot(), 'example/__tests__/Conformance.harness.tsx'),
      'utf8'
    );
    expect(
      checkSharedTableMirror(
        good.replace('"tolerance": 0.6', '"tolerance": 0.7')
      ).join('\n')
    ).toContain('no longer matches');
    const broken = good.replace('"tolerance": 0.6,', '"tolerance": ,');
    expect(checkSharedTableMirror(broken).join('\n')).toContain('is not JSON');
  });

  it('mirrors every number the in-app rules assert against, and nothing else', () => {
    const shared = sharedInAppTable();
    expect(Object.keys(shared)).toEqual([
      'declaredFallbacks',
      'poisonSizes',
      'tolerance',
      'exemptions',
    ]);
    expect(shared.declaredFallbacks).toEqual(DECLARED_FALLBACKS);
    // And it is JSON-safe: a `Date` or a function would round-trip into `null`, which
    // would make the mirror check above compare two different things and pass.
    expect(JSON.parse(JSON.stringify(shared))).toEqual(shared);
  });
});

/* ------------------------------- the device sweep ---------------------------- */

describe('the a11y sweep, against a fake device', () => {
  /** A log in the shape `CheckLog` has, recording instead of printing. */
  function fakeLog() {
    return {
      notes: [],
      failures: [],
      note(message) {
        this.notes.push(message);
      },
      check(description, condition) {
        if (!condition) this.failures.push(description);
        return condition;
      },
    };
  }

  /** A navigation that records where it was asked to go. */
  function fakeNavigation(dump, screens = []) {
    return {
      screens,
      scrolls: 0,
      async goToScreen(screen) {
        screens.push(screen);
      },
      async scrollToTop() {},
      async scrollPage() {
        this.scrolls += 1;
      },
      dump,
    };
  }

  /** A collector for the logs the sweep opens. */
  function collector() {
    /** @type {Array<{id: string, log: any}>} */
    const logs = [];
    return {
      logs,
      begin(id, title) {
        const log = fakeLog();
        logs.push({ id, title, log });
        return log;
      },
    };
  }

  /** A node with a box, in the shape `parseHierarchy` produces. */
  function node(contentDesc, overrides = {}) {
    const width = overrides.width ?? 100;
    const height = overrides.height ?? 40;
    return {
      contentDesc,
      className: 'android.view.View',
      clickable: 'true',
      checkable: 'false',
      focusable: 'true',
      scrollable: 'false',
      ...overrides,
      bounds: {
        x1: 0,
        y1: 0,
        x2: width,
        y2: height,
        cx: width / 2,
        cy: height / 2,
        width,
        height,
      },
    };
  }

  const only = (id) => A11Y_CONTROLS.filter((entry) => entry.id === id);
  const switchCase = () => only('switch');
  const sliderCase = () => only('slider');

  it('scrolls until its control has a box, and judges the tree that has it', () => {
    // The measured reason: a hosted control below the fold answers a dump with no box, so
    // a sweep that read only the top of a screen would report healthy controls as missing.
    let dumps = 0;
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => {
      dumps += 1;
      return dumps === 1 ? [] : [node('Controlled switch')];
    });
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(dumps).toBe(2);
      expect(navigation.scrolls).toBe(1);
      expect(logs[0].log.failures).toEqual([]);
    });
  });

  it('reports a control that never appears as a failure, not as a scroll timeout', () => {
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => []);
    return runA11ySweep(begin, navigation, switchCase()).then((result) => {
      expect(logs.length).toBe(1);
      expect(logs[0].log.failures.join('\n')).toContain(
        'announces this control as nothing'
      );
      expect(result.covered).toEqual(['switch']);
      expect(result.stale).toEqual([]);
    });
  });

  it('prints debt rather than failing it, and still fails what the debt does not cover', async () => {
    // The Slider's named node is not actionable and has a row. The same control with no
    // name at all is a different finding, and the row must not excuse it.
    const withDebt = collector();
    await runA11ySweep(
      withDebt.begin,
      fakeNavigation(() => [
        node('Controlled slider', { clickable: 'false', focusable: 'false' }),
      ]),
      sliderCase()
    );
    expect(withDebt.logs[0].log.notes.join('\n')).toContain('known failing');
    expect(withDebt.logs[0].log.failures).toEqual([]);

    const unnamed = collector();
    const result = await runA11ySweep(
      unnamed.begin,
      fakeNavigation(() => [node('Something else')]),
      sliderCase()
    );
    expect(result.matched).toEqual([]);
    expect(unnamed.logs[0].log.failures.join('\n')).toContain(
      'announces this control as nothing'
    );
  });

  it('fails the run when a debt row no longer describes anything', async () => {
    // The self-clearing half, at the device end: give the Slider an actionable node and
    // its row matches nothing, so the sweep opens an `a11y:debt` log that says to delete it.
    const { begin, logs } = collector();
    const result = await runA11ySweep(
      begin,
      fakeNavigation(() => [node('Controlled slider')]),
      sliderCase()
    );
    expect(result.stale).toEqual([
      expect.stringContaining('the entry for "slider"'),
    ]);
    const debt = logs.find((entry) => entry.id === 'a11y:debt');
    expect(debt).toBeDefined();
    expect(debt.log.failures.join('\n')).toContain('delete the exemption');
  });

  it('navigates once per screen, not once per case', () => {
    const { begin } = collector();
    const screens = [];
    const navigation = fakeNavigation(
      () => A11Y_CONTROLS.map((entry) => node(entry.label)),
      screens
    );
    return runA11ySweep(begin, navigation).then(() => {
      expect(screens).toEqual([
        'switch',
        'slider',
        'button',
        'segmented',
        'datepicker',
        'picker',
        'host',
      ]);
    });
  });

  it('runs every case in the table, so a new control is swept the day it is added', () => {
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() =>
      A11Y_CONTROLS.map((entry) => node(entry.label))
    );
    return runA11ySweep(begin, navigation).then((result) => {
      expect(logs.map((entry) => entry.id)).toEqual([
        ...A11Y_CONTROLS.map((entry) => `a11y:${entry.id}`),
        // plus the debt log the run opens for itself when rows go stale
        'a11y:debt',
      ]);
      expect(result.covered.length).toBe(A11Y_CONTROLS.length);
      // A tree where every control is named on one actionable node: only the four rows
      // whose finding was about something else can still be outstanding, and here they are
      // stale — which is the same proof as above, over the whole table.
      expect(result.matched).toEqual([]);
      expect(result.stale.length).toBe(4);
    });
  });

  it('reads a real measured dump the same way the unit test says it does', () => {
    // The sweep and the pure rule have to agree on a real tree, or the gate and the test
    // are checking two different things. The Switch's own dump, through the fake device.
    const { begin, logs } = collector();
    const tree = parseHierarchy(
      readFileSync(`${__dirname}/fixtures/a11y/switch.xml`, 'utf8')
    );
    return runA11ySweep(
      begin,
      fakeNavigation(() => tree),
      switchCase()
    ).then(() => {
      expect(logs[0].log.failures).toEqual([]);
      expect(logs[0].log.notes).toEqual([]);
    });
  });
});
