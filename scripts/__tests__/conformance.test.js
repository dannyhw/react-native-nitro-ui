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
  boxRuleFor,
  checkA11yTable,
  checkContentSizedBox,
  checkCoverage,
  checkFallbackTable,
  failingKeys,
  followupsResolver,
  recycleNotes,
  checkInAppFixtures,
  checkRecycleNotes,
  checkSharedTableMirror,
  classifyFindings,
  coverageMatrix,
  findingKey,
  formatMatrix,
  leakFindings,
  readerFor,
  recycleFindings,
  repoManifests,
  repoSizingTable,
  fallbackFindings,
  sharedInAppTable,
  staleDebt,
  staleExemptions,
} from '../conformance-core.mjs';
import { A11Y_CONTROLS, A11Y_EXEMPTIONS } from '../real-input/a11y.mjs';
import { runA11ySweep, SCROLL_PROBE_LIMIT } from '../real-input/a11y-sweep.mjs';
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
    // The brief's central requirement, tested by adding one. It used to be `Menu`, which is
    // how this file proves the mechanism keeps working: Menu arrived in the registry, and the
    // probe control moved on to a name the repo still does not have. A new manifest gets a row
    // and a verdict from every rule — `not-applicable` or `covered`, never silence.
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const extra = repoWithExtraControl({
      id: 'tooltip',
      name: 'Tooltip',
      hybridView: 'NitroUiTooltip',
      sizing: 'intrinsic',
      exampleTab: 'tooltip',
    });
    const matrix = coverageMatrix(extra, { sizing });
    const tooltip = matrix.find((row) => row.name === 'Tooltip');
    expect(tooltip).toBeDefined();
    expect(tooltip.rules['a11y-name-on-focusable-node'].state).toBe('covered');
    expect(tooltip.rules['declared-fallback'].state).toBe('covered');
    expect(tooltip.rules['recycle-reset'].state).toBe('covered');
    // A control with no a11y case is a red run, not a matrix cell that explains itself.
    // Round 1 had both, and the matrix half could not be reached: `checkA11yTable` fails
    // the same tree first, so a cell waiting to say "no case for Tooltip" was dead code
    // (review N9). One owner for the condition, and it is this.
    expect(checkA11yTable(extra, read).join('\n')).toContain(
      'no a11y case for Tooltip'
    );
  });
});

/* ---------------------------------- coverage ---------------------------------- */

describe('coverage', () => {
  it('is complete for the eight controls today', () => {
    const manifests = repoManifests();
    expect(manifests.map((m) => m.name)).toEqual([
      'Button',
      'DatePicker',
      'Menu',
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
      id: 'tooltip',
      name: 'Tooltip',
      hybridView: 'NitroUiTooltip',
      sizing: undefined,
      exampleTab: 'tooltip',
    });
    const matrix = coverageMatrix(manifests, { sizing: {} });
    const problems = checkCoverage(manifests, matrix, () => null);
    // Every rule answers `not-applicable` with a reason, so coverage is complete — but
    // the a11y rule's reason is a gap, and `checkA11yTable` is where that is caught.
    expect(problems).toEqual([]);
    expect(checkA11yTable(manifests, () => null).join('\n')).toContain(
      'no a11y case for Tooltip'
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
    expect(
      matrix.find((row) => row.name === 'Switch').rules['recycle-reset'].state
    ).toBe('failing');
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
      id: 'tooltip',
      name: 'Tooltip',
      hybridView: 'NitroUiTooltip',
      sizing: 'intrinsic',
      exampleTab: 'tooltip',
    });
    const problems = checkFallbackTable(
      manifests,
      {
        ...JSON.parse(read('nitro-ui.sizing.json')),
        HybridNitroUiTooltip: 'intrinsic',
      },
      DECLARED_FALLBACKS
    );
    expect(problems.join('\n')).toContain(
      'no DECLARED_FALLBACKS row for NitroUiTooltip'
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
    // `Tooltip`, because every control the repo has now has a row — and this is the check
    // that goes red the day one is added without its number written down.
    const findings = fallbackFindings({
      component: 'Tooltip',
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

/* ---------------------- the box rule: which axes are the control's ------------- */

/* The three cases below are not theoretical: the first device run of this suite went red on
 * Slider, Progress and Button, and the rule was wrong rather than the controls. A `fillWidth`
 * control's width is its parent's, and a content-sized control's declaration is a documented
 * middle of a measured table. Each mode is therefore tested at both ends — the difference it
 * must allow, and the one it must still refuse. */

describe('which axes a declared fallback describes', () => {
  it('reads the axis from the generated sizing policy', () => {
    const sizing = repoSizingTable();
    // `intrinsic` and content-sized disagree about the same policy, so Button is listed
    // explicitly and the policy alone cannot be the whole answer.
    expect(boxRuleFor('NitroUiSwitch', sizing)).toBe('both');
    expect(boxRuleFor('NitroUiSlider', sizing)).toBe('height');
    expect(boxRuleFor('NitroUiProgress', sizing)).toBe('height');
    expect(boxRuleFor('NitroUiButton', sizing)).toBe('none');
    // Menu joined the content-sized list with G7a: its trigger is a Button's box and its
    // width is its title's, so its declaration is Button-sized by decree rather than a
    // measured configuration (`HybridNitroUiMenu.swift:451-458` says so in words).
    expect(boxRuleFor('NitroUiMenu', sizing)).toBe('none');
    // An unknown control keeps the strictest rule: a policy the table lost should cost a
    // red run, not a widened assertion.
    expect(boxRuleFor('NitroUiTooltip', sizing)).toBe('both');
  });

  it('lets a fillWidth control be wider than its declaration, and still checks its height', () => {
    // Measured on device: Slider declared 351 and settled at 420 wide on a 420 dp screen.
    const declared = DECLARED_FALLBACKS.NitroUiSlider.ios;
    const parentWidth = { width: 420, height: declared.height };
    expect(
      fallbackFindings({
        component: 'Slider',
        platform: 'ios',
        declared,
        measured: parentWidth,
        corrections: 0,
        boxRule: 'height',
      })
    ).toEqual([]);

    const staleHeight = fallbackFindings({
      component: 'Slider',
      platform: 'ios',
      declared,
      measured: { width: 420, height: 12 },
      corrections: 0,
      boxRule: 'height',
    });
    expect(staleHeight[0].problem).toContain('width is its parent');
    expect(staleHeight[0].problem).toContain('12');
  });

  it('does not claim a fillWidth control needed no correction, because its width always does', () => {
    // The warm assertion is only true of a control whose declaration is its whole box.
    expect(
      fallbackFindings({
        component: 'Slider',
        platform: 'ios',
        declared: DECLARED_FALLBACKS.NitroUiSlider.ios,
        measured: { width: 420, height: 31 },
        corrections: 1,
        boxRule: 'height',
      })
    ).toEqual([]);
  });

  it('asks a content-sized control for a box that is its own, not its declaration', () => {
    // Button: 33.3 to 103.2 wide across titles per docs/components/button.md, so the
    // declared pair matches nothing measured. This is the device run's 57.3x34.3.
    const declared = DECLARED_FALLBACKS.NitroUiButton.ios;
    expect(
      fallbackFindings({
        component: 'Button',
        platform: 'ios',
        declared,
        measured: { width: 57.3, height: 34.3 },
        corrections: 1,
        boxRule: 'none',
      })
    ).toEqual([]);
  });

  it('goes red when the content-sized exemption earns nothing', () => {
    // The exemption's own proof: a control that measures exactly its declaration has
    // stopped sizing itself from its content, and the exemption should have been removed.
    // Injected rather than achieved by editing a number in this repo: Button's box really
    // does vary with its title, so the only honest way to produce "measured == declared"
    // here is a table that says so.
    const declared = DECLARED_FALLBACKS.NitroUiButton.ios;
    const table = { NitroUiButton: { ios: declared, android: declared } };
    const findings = fallbackFindings({
      component: 'Button',
      platform: 'ios',
      declared,
      measured: declared,
      corrections: 0,
      boxRule: 'none',
      declaredTable: table,
    });
    expect(findings[0].problem).toContain('exempt from the box comparison');
    expect(findings[0].problem).toContain('no longer true');
    // And the same inputs without the exemption go red for a different reason: skipping the
    // comparison is the only thing that made this box acceptable at all.
    const strict = fallbackFindings({
      component: 'Button',
      platform: 'ios',
      declared,
      measured: { width: declared.width + 20, height: declared.height },
      corrections: 0,
      declaredTable: table,
    });
    expect(strict[0].problem).toContain('is not the measured');
  });

  it('still catches a poisoned fallback for both narrowed modes', () => {
    // The poison is an exact pair that nothing declares, so it needs no policy to detect:
    // a box that survives it is a missing correction whichever axes the control owns.
    for (const [component, boxRule] of [
      ['Slider', 'height'],
      ['Button', 'none'],
    ]) {
      const findings = fallbackFindings({
        component,
        platform: 'ios',
        declared: DECLARED_FALLBACKS[`NitroUi${component}`].ios,
        measured: POISON_SIZES.ios,
        corrections: 1,
        poisoned: true,
        boxRule,
      });
      expect(findings[0].problem).toContain('settled at the poisoned 97x11');
    }
  });

  it('goes red for a CONTENT_SIZED_BOX entry that is not an intrinsic control', () => {
    // Adding a name here skips a comparison, so membership is checked against the manifests
    // rather than trusted. The interesting case cannot be produced by this repo's tree —
    // Progress really is `fillWidth` — so the list is injected, which is exactly what the
    // mistake looks like: somebody puts a fillWidth control in the list to skip its height
    // comparison.
    expect(
      checkContentSizedBox(repoManifests(), ['NitroUiProgress']).join('\n')
    ).toContain('sizing: "fillWidth"');
    expect(
      checkContentSizedBox(repoManifests(), ['NitroUiGhost']).join('\n')
    ).toContain('no manifest declares that control');
    // And the real list is legitimate on the real tree, which is the assertion the two
    // mutations above are measured against.
    expect(checkContentSizedBox(repoManifests())).toEqual([]);
    expect(checkFallbackTable(repoManifests(), repoSizingTable())).toEqual([]);
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

/* ------------------------ the recycle hole, as two lists see it ---------------------- */

describe('a recycle hole, as the fixture and the debt list describe it', () => {
  /** A harness file with one fixture whose `probe` is the given kind. */
  function harnessWith(kind, name = 'Switch') {
    const body =
      kind === 'probe'
        ? "      leaveBehind: 'a tap on the control',"
        : `      ${kind}:\n        'the reason the suite gives for not probing',`;
    return [
      'const FIXTURES: ReadonlyArray<Fixture> = [',
      '  {',
      `    name: '${name}',`,
      "    component: 'NitroUiSwitch',",
      '    probe: {',
      body,
      '    },',
      '  },',
      '];',
    ].join('\n');
  }

  const row = {
    component: 'Switch',
    rule: 'recycle-reset',
    followups: 'X4 recycle rule: Switch holds residue no read-out can show',
    detail: 'nothing reports the drawn value',
  };

  it('reads the note each fixture declares, and the reason with it', () => {
    const notes = recycleNotes(harnessWith('blindSpot'));
    expect(notes.Switch.kind).toBe('blindSpot');
    expect(notes.Switch.reason).toBe(
      'the reason the suite gives for not probing'
    );
    expect(recycleNotes(harnessWith('noProbe')).Switch.kind).toBe('noProbe');
    expect(recycleNotes(harnessWith('probe')).Switch).toEqual({
      kind: 'probe',
    });
    // No table is not "no control has a hole" — that reading is how a check disappears
    // without leaving a trace. `checkInAppFixtures` is what reports an absent table.
    expect(recycleNotes(null)).toEqual({});
    expect(recycleNotes('nothing in this file')).toEqual({});
  });

  it('goes red when a fixture calls its rule a hole and no debt row owns it', () => {
    // The re-review's finding verbatim: the controls with no probe had a sentence in a
    // fixture and a `covered` cell, and nothing could tell a hole in the guard from an
    // exemption. A `blindSpot` is a failing cell, so it cannot live only in a comment.
    const problems = checkRecycleNotes(harnessWith('blindSpot'), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'the Switch fixture says its recycle rule is a `blindSpot`'
    );
    expect(problems[0]).toContain('add the row');
  });

  it('goes red when a debt row covers a control whose probe can produce the finding', () => {
    // The dangerous direction: a probe lands, its row is left behind, and the run prints
    // "known failing" over a number that now means something.
    expect(checkRecycleNotes(harnessWith('probe'), [row]).join('\n')).toContain(
      'that fixture has a residue probe'
    );
  });

  it('goes red when the two files disagree about whether the control holds state', () => {
    // `noProbe` says there is nothing to reset; a debt row says the reset is unreachable.
    // Both cannot be true of one control, and the honest reading is that the probe is
    // missing — which is the row being refused, not the note being rewritten.
    expect(
      checkRecycleNotes(harnessWith('noProbe'), [row]).join('\n')
    ).toContain('disagree about whether the control holds state');
  });

  it('goes red when a row guards a control no fixture guards', () => {
    // Nothing reports the key, so nothing can ever retire the row, and it sits there
    // excusing a finding no probe is capable of producing.
    expect(
      checkRecycleNotes(harnessWith('blindSpot', 'Slider'), [row]).join('\n')
    ).toContain('no fixture guards that control');
  });

  it('is quiet on the repo as it stands, and the two lists agree cell for cell', () => {
    const harness = read('example/__tests__/Conformance.harness.tsx');
    expect(checkRecycleNotes(harness)).toEqual([]);
    // The statement the four tests above exist to make unfakeable: the set of fixtures
    // that call their rule a hole *is* the set of debt rows, in both directions.
    const notes = recycleNotes(harness);
    expect(
      Object.entries(notes)
        .filter(([, note]) => note.kind === 'blindSpot')
        .map(([name]) => name)
        .sort()
    ).toEqual(
      CONFORMANCE_EXEMPTIONS.filter((r) => r.rule === 'recycle-reset')
        .map((r) => r.component)
        .sort()
    );
    // And every reason that reaches the coverage table is a sentence, not a fragment:
    // the cell's whole claim is that the suite cannot reach the rule, so it has to say so.
    for (const [name, note] of Object.entries(notes)) {
      if (note.kind === 'probe') continue;
      expect(note.reason.length).toBeGreaterThan(40);
      expect(`${name}: ${note.reason}`).not.toMatch(/\s\+$/);
    }
  });
});

/* ---------------------------------- the debt --------------------------------- */

describe('the debt ledger', () => {
  it('is the recycle holes on record, and the mechanism works when one is added', () => {
    // Every row since the re-review is a `recycle-reset` hole, and they are named here
    // rather than just counted: a row appearing means a new hole is on record (which wants
    // a fixture note, a FOLLOWUPS line and a matrix cell with it), and a row disappearing
    // without its probe landing is the same lie in the other direction.
    expect(
      CONFORMANCE_EXEMPTIONS.map((row) => `${row.component}|${row.rule}`)
    ).toEqual(['Menu|recycle-reset', 'SegmentedControl|recycle-reset']);
    for (const row of CONFORMANCE_EXEMPTIONS) {
      // Debt needs an address and a description of what is blind, not just a name.
      expect(row.followups.length).toBeGreaterThan(0);
      expect(row.detail.length).toBeGreaterThan(0);
    }
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
      a11yPlatform: 'android',
    });
    // The Android sweep, the platform it was told about: three Android rows matched
    // nothing. The iOS rows for the same controls are not in this count — an Android run
    // never read those trees, so it has no evidence that they still reproduce.
    expect(debt.length).toBe(3);
    expect(debt.join('\n')).toContain(
      'the android entry for "segmented-control"'
    );
    expect(debt.join('\n')).not.toContain('the android entry for "slider"');
    expect(debt.join('\n')).not.toContain('the ios entry');

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
      'boxRules',
      'exemptions',
    ]);
    expect(shared.declaredFallbacks).toEqual(DECLARED_FALLBACKS);
    // The box rule is in the mirror for the same reason the numbers are: which axes a
    // control's declaration describes comes from the generated sizing policy, and a suite
    // that decided that on the device could decide it wrongly and go green.
    expect(shared.boxRules).toEqual(
      Object.fromEntries(
        Object.keys(DECLARED_FALLBACKS).map((hybridView) => [
          hybridView,
          boxRuleFor(hybridView, repoSizingTable()),
        ])
      )
    );
    // And it is JSON-safe: a `Date` or a function would round-trip into `null`, which
    // would make the mirror check above compare two different things and pass.
    expect(JSON.parse(JSON.stringify(shared))).toEqual(shared);
  });
});

/* ------------------------------ the in-app fixtures -------------------------- */

describe('the debt, as the matrix sees it', () => {
  const followups = () => read('docs/tasks/FOLLOWUPS.md');

  it('collapses the a11y cases onto their components, once per control', () => {
    // Seven cases across three controls: `slider` and `hosted-slider` both guard `Slider`,
    // and the debt list carries both platforms' rows for a control. The matrix is about
    // controls, so every row for one control makes exactly one failing cell.
    //
    // `Picker` is here because the real accessibility tree says so, not because a rule was
    // widened to reach it: measured under XCUITest, a hosted Picker's control announces
    // "Hosted picker, Hosted picker" and no element carries the name alone. That is a
    // finding about the control, so it is recorded as debt with a FOLLOWUPS line and
    // printed on every run rather than asserted away.
    expect(failingKeys()).toEqual([
      'Menu|recycle-reset',
      'SegmentedControl|recycle-reset',
      'Slider|a11y-name-on-focusable-node',
      'SegmentedControl|a11y-name-on-focusable-node',
      'Picker|a11y-name-on-focusable-node',
    ]);
  });

  it('names the FOLLOWUPS line for a failing cell, when the line exists', () => {
    const resolve = followupsResolver(followups());
    for (const key of failingKeys()) {
      const cited = resolve(key);
      expect(cited).not.toBeNull();
      // One cell can carry debt on both platforms — the Slider's Android name is not
      // actionable and its iOS name is announced as the wrong kind of control — and the
      // resolver joins the citations it checked. It proves each one is in the document
      // before answering at all, so the parts are what a reader can go and open, not the
      // joined string.
      for (const line of cited.split(' · ')) {
        expect(followups()).toContain(line);
      }
    }
    // A cell no debt row claims has no line, which is what `checkCoverage` reports as debt
    // with no owner — so the resolver cannot answer for it.
    expect(resolve(findingKey('Switch', 'recycle-reset'))).toBeNull();
  });

  it("refuses to name a line when only one of a control's two platform rows is written down", () => {
    // The shape the iOS rows introduced: one control, debt on both platforms. A resolver
    // that answered with whichever citation it found first would send a reviewer to one
    // line and leave the other bug unowned.
    const rows = [
      {
        control: 'slider',
        platform: 'android',
        followups:
          'X4 a11y: Compose RangeInfo nodes are not actionable in a dump',
        matches: /not actionable/,
      },
      {
        control: 'slider',
        platform: 'ios',
        followups: 'X4 a11y: a line nobody wrote',
        matches: /announced as other/,
      },
    ];
    expect(
      followupsResolver(followups(), { a11y: rows })(
        findingKey('Slider', 'a11y-name-on-focusable-node')
      )
    ).toBeNull();
  });

  it('goes red when a debt row cites a line that is not in FOLLOWUPS.md', () => {
    // The citation is the only thing tying the exemption to a person's task list. A row
    // whose line was renamed or never written has no owner, and this is where that shows.
    const row = {
      control: 'slider',
      followups: 'X4: a line nobody wrote',
      matches: /x/,
    };
    const resolve = followupsResolver(followups(), { a11y: [row] });
    expect(
      resolve(findingKey('Slider', 'a11y-name-on-focusable-node'))
    ).toBeNull();
    // …and `checkCoverage` then refuses the matrix rather than printing the cell as fine.
    const manifests = repoManifests();
    const matrix = coverageMatrix(manifests, {
      failing: failingKeys(),
      sizing: JSON.parse(read('nitro-ui.sizing.json')),
    });
    expect(checkCoverage(manifests, matrix, resolve).join('\n')).toContain(
      'Slider × a11y-name-on-focusable-node'
    );
  });

  it('picks up a debt row on the in-app side too', () => {
    // `failingKeys` reads both lists, so a new in-app exemption reaches the matrix without
    // anyone editing a second table — the same reason the a11y rows are read from the list.
    const row = {
      component: 'Switch',
      rule: 'recycle-reset',
      followups: 'X4: Switch keeps a recycled owner',
      detail: 'checked survives',
    };
    expect(failingKeys(A11Y_EXEMPTIONS, [row])).toContain(
      findingKey('Switch', 'recycle-reset')
    );
    // And it does not disturb the rows that already exist — which means passing the real
    // list plus the new one, since a one-row list *replaces* it and reads as two fewer keys.
    expect(
      failingKeys(A11Y_EXEMPTIONS, [...CONFORMANCE_EXEMPTIONS, row]).length
    ).toBe(failingKeys().length + 1);
  });
});

describe('the in-app fixture table cross-check', () => {
  const harness = () => read('example/__tests__/Conformance.harness.tsx');

  it('has a fixture for every control the registry declares', () => {
    expect(checkInAppFixtures(repoManifests(), harness())).toEqual([]);
  });

  it('goes red for a manifest with no fixture, and names it', () => {
    const withTooltip = [
      ...repoManifests(),
      manifest({
        id: 'tooltip',
        name: 'Tooltip',
        hybridView: 'NitroUiTooltip',
        sizing: 'intrinsic',
        exampleTab: 'tooltip',
      }),
    ];
    expect(checkInAppFixtures(withTooltip, harness()).join('\n')).toContain(
      'no fixture for Tooltip'
    );
  });

  it('goes red for a fixture whose hybridView name drifted from the manifest', () => {
    const renamed = harness().replace(
      "    component: 'NitroUiPicker',",
      "    component: 'NitroUiComboBox',"
    );
    expect(renamed).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), renamed).join('\n')).toContain(
      'says NitroUiComboBox'
    );
  });

  it('is not satisfied by a comment that mentions the control', () => {
    // The scan reads the FIXTURES table's rows, not the file's text (X4 review N3). Round 1
    // asked whether `name: 'Picker'` appeared anywhere, so a row whose members are prose used
    // to pass it. Anything a `// TODO` can satisfy is not a coverage claim.
    const commentedOut = harness().replace(
      ['  {', "    name: 'Picker',", "    component: 'NitroUiPicker',"].join(
        '\n'
      ),
      [
        '  {',
        "    // name: 'Picker',",
        "    // component: 'NitroUiPicker',",
      ].join('\n')
    );
    expect(commentedOut).not.toBe(harness());
    const wholeRow = checkInAppFixtures(repoManifests(), commentedOut).join(
      '\n'
    );
    expect(wholeRow).toContain('no fixture for Picker');
    // The leftover row is not silently ignored either: an unnamed row in the table is one no
    // manifest declares, which is the same bug reported from the other end.
    expect(wholeRow).toContain('a fixture guards');

    // The subtler half. The row is real and only its `component` has become a comment, so a
    // text scan still finds `name: 'Picker'` while the sizing rules ask the engine about a
    // component this fixture never names.
    const noComponent = harness().replace(
      "    component: 'NitroUiPicker',",
      "    // component: 'NitroUiPicker',"
    );
    expect(noComponent).not.toBe(harness());
    const rowOnly = checkInAppFixtures(repoManifests(), noComponent).join('\n');
    expect(rowOnly).toContain('says null');
  });

  it('reads the engine’s registration before it seeds anything', () => {
    // The shape M5 is about, checked structurally because the failure is an ordering
    // between two calls in one file and no host test can mount a control.
    //
    // `prewarmSizing` answers "is this name in `fallbacks_`" and `seedSizingSize` writes
    // `fallbacks_` (`NitroUiSizingEngine.cpp:512`, `:855`), so the first poison in this file
    // makes every later "is it registered?" the poison's own answer. The suite therefore
    // asks once, for every control, in the file's first test — and the poison must come
    // after it. A file that re-reads per test would pass the assertion above and still be
    // measuring nothing.
    const harness = read('example/__tests__/Conformance.harness.tsx');
    const readCall = harness.indexOf('readRegistrationOnce();');
    expect(readCall).toBeGreaterThan(-1);
    const firstPoison = harness.indexOf('poison(fixture.component)');
    expect(firstPoison).toBeGreaterThan(readCall);
    // Asked once for the whole file, not per fixture row: a per-row read is exactly the
    // bug, and `readRegistrationOnce`'s own guard is what makes it cheap, so a call site
    // outside that guard would mean the read is being done somewhere else entirely.
    const calls = [...harness.matchAll(/readRegistrationOnce\(\)/g)].length;
    const insideGuard = harness.slice(
      harness.indexOf('function readRegistrationOnce'),
      harness.indexOf('/**', harness.indexOf('function readRegistrationOnce'))
    );
    expect(
      calls - [...insideGuard.matchAll(/readRegistrationOnce\(\)/g)].length
    ).toBe(1);
    // And the question is asked in exactly one place. The engine seam's name appears as its
    // own definition and as the one call inside the reader; a second call anywhere else in
    // the file would be a per-test read wearing the fix's clothes.
    const asks = [...harness.matchAll(/hasDeclaredFallback\(/g)];
    expect(asks).toHaveLength(2);
    expect(harness.slice(asks[0].index - 9, asks[0].index + 20)).toContain(
      'function hasDeclaredFallback'
    );
    const guard = harness.indexOf('function readRegistrationOnce');
    const guardEnd = harness.indexOf('\n}', guard);
    expect(asks[1].index > guard && asks[1].index < guardEnd).toBe(true);
  });

  it('looks the shared numbers up inside a test, not while collecting', () => {
    // The other half of N3. `declaredFallback` and `boxRuleFor` throw on a missing row, and
    // round 1 called them in the `describe` body — Jest runs that while collecting, so one
    // fixture whose component had no shared-table row aborted the whole file and reported
    // nothing about the six controls that were fine. Inside an `it` the same throw is one red
    // test with its control's name on it. Device-only code, so this proves the shape rather
    // than the behaviour: no lookup between the loop's `describe(` and its first `it(`.
    // The suite's own loop. Anchored on its `describe`, because `readRegistrationOnce` above
    // it iterates the same table and is allowed to call things at module scope.
    const anchor = harness().indexOf(
      "describe('conformance · every control, four rules'"
    );
    expect(anchor).toBeGreaterThan(-1);
    const body = harness().slice(anchor);
    const firstTest = body.indexOf('it(');
    expect(firstTest).toBeGreaterThan(-1);
    const collection = body.slice(0, firstTest);
    for (const lookup of ['declaredFallback(', 'boxRuleFor(']) {
      expect(collection).not.toContain(lookup);
    }
    // …and they really are called, or this guard is guarding nothing.
    expect(body).toContain('declaredFallback(');
    expect(body).toContain('boxRuleFor(');
  });

  it('says so when the fixture table itself cannot be found', () => {
    // The failure mode of a scan that quietly finds nothing: rename the table and the old
    // substring check reported every control covered, because a doc comment elsewhere in the
    // file still said `name: 'Switch'`. An unreadable table has to be its own problem.
    const renamed = harness().replace(
      'const FIXTURES: ReadonlyArray<Fixture> = [',
      'const CASES: ReadonlyArray<Fixture> = ['
    );
    expect(renamed).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), renamed).join('\n')).toContain(
      'could not be found'
    );
  });

  it('goes red for a fixture guarding a control nobody declares', () => {
    // A row *of the table*, which is the shape the bug has: the control leaves the registry,
    // its fixture stays, still rendering and still green. An object appended after the table
    // is not a fixture, and the old scan reporting it as one was the too-much-reading that
    // the test above refuses from the other side.
    const extra = harness().replace(
      'const FIXTURES: ReadonlyArray<Fixture> = [\n',
      'const FIXTURES: ReadonlyArray<Fixture> = [\n  {\n    name: ' +
        "'Ghost',\n    component: 'NitroUiGhost',\n  },\n"
    );
    expect(extra).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), extra).join('\n')).toContain(
      'a fixture guards "Ghost"'
    );
  });

  it('goes red when the whole suite is missing', () => {
    expect(checkInAppFixtures(repoManifests(), null)[0]).toContain(
      'no suite, so no control is checked'
    );
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

  it('keeps scrolling past a name with no box, and judges the tree that has one', () => {
    // The other half of that scroll, and the case a `contentDesc === label` test would
    // pass without ever exercising: a named node drawn at nothing. It is the same finding
    // the rule reports when it gives up (`zero-sized box`), so a sweep that stopped here
    // would exempt a control that merely needed one more swipe — and the box check in the
    // scroll loop would be dead code that reads like a guard.
    let dumps = 0;
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => {
      dumps += 1;
      return dumps === 1
        ? [node('Controlled switch', { width: 0, height: 0 })]
        : [node('Controlled switch')];
    });
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(dumps).toBe(2);
      expect(navigation.scrolls).toBe(1);
      expect(logs[0].log.failures).toEqual([]);
    });
  });

  it('judges the last tree after the scroll budget runs out, and says what it saw', () => {
    // Named but never boxed: the budget ends and the rule still has to speak, because
    // "I could not find it" and "it is drawn at nothing" are different bugs.
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => [
      node('Controlled switch', { width: 0, height: 0 }),
    ]);
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(navigation.scrolls).toBe(SCROLL_PROBE_LIMIT);
      expect(logs[0].log.failures.join('\n')).toContain('zero-sized box');
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
      expect.stringContaining('the android entry for "slider"'),
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
        'menu',
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
