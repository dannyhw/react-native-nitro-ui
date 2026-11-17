import { describe, expect, it } from '@jest/globals';

import { readFileSync } from 'node:fs';

import {
  A11Y_CONTROLS,
  checkIosControlA11y,
  exemptionsFor,
  firstReadScale,
  iosA11yProblems,
  parseIosA11yLog,
  parseIosA11yStability,
  reportIosStability,
  iosStabilityNote,
  iosStabilityWarning,
  staleExemptions,
} from '../real-input/a11y.mjs';

// The box of `switch-controlled`, as XCUITest reported it.
const SWITCH_BOX = { x: 325, y: 217.3333282470703, width: 61, height: 28 };

// One hosted element at the control's box, announcing its name as a switch.
function node(overrides = {}) {
  return {
    type: 'switch',
    enabled: true,
    hittable: true,
    id: '',
    label: 'Controlled switch',
    value: '0',
    frame: { ...SWITCH_BOX },
    anchor: false,
    ...overrides,
  };
}

// React Native copies `accessibilityLabel` onto its own wrapper view, so every
// real tree has the wrapper carrying the `testID` and the name, plus the hosted
// element carrying the same name.
function wrapper(label = 'Controlled switch', frame = SWITCH_BOX) {
  return node({ id: 'switch-controlled', label, frame, anchor: true });
}

function switchTree() {
  return [wrapper(), node()];
}

/**
 * @param {string} id an `A11yControl.id`
 */
function control(id) {
  const found = A11Y_CONTROLS.find((candidate) => candidate.id === id);
  if (found == null) throw new Error(`no a11y case "${id}"`);
  return found;
}

describe('the iOS a11y rule', () => {
  it('passes the tree the current code produces', () => {
    expect(iosA11yProblems(control('switch'), switchTree())).toEqual([]);
  });

  it('goes red when the name is on the wrapper and nowhere else', () => {
    const tree = [wrapper()];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'no element other than the React Native wrapper'
    );
    expect(problems[0]).toContain(
      'a name on a wrapper rather than on the control'
    );
  });

  describe('a control that is the React Native view (ContextMenu)', () => {
    const GRACE_BOX = { x: 16, y: 300, width: 361, height: 76 };
    const graceWrapper = (overrides = {}) =>
      node({
        type: 'other',
        id: 'ctx-accessible',
        label: 'Message from Grace',
        value: '',
        frame: { ...GRACE_BOX },
        anchor: true,
        ...overrides,
      });

    it('passes when the wrapper itself carries the name', () => {
      expect(
        iosA11yProblems(control('context-menu'), [graceWrapper()])
      ).toEqual([]);
    });

    it('goes red when the wrapper lost its name (not an accessibility element)', () => {
      const problems = iosA11yProblems(control('context-menu'), [
        graceWrapper({ label: '' }),
      ]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(
        'no element other than the React Native wrapper'
      );
    });

    it('goes red when a child inside it is announced with the name as well', () => {
      const problems = iosA11yProblems(control('context-menu'), [
        graceWrapper(),
        node({
          type: 'staticText',
          label: 'Message from Grace',
          frame: { ...GRACE_BOX, height: 20 },
        }),
      ]);
      expect(problems.join('\n')).toContain(
        '2 elements under "ctx-accessible"'
      );
    });

    it('goes red on the measured tree of a wrapper that is not one element', () => {
      // XCUITest lists any view with an identifier, so the wrapper still shows its
      // label here. What separates this tree from a healthy one is the unnamed
      // container box between the wrapper and its texts.
      const tree = parseIosA11yLog(
        readFileSync(
          `${__dirname}/fixtures/a11y/ios-context-menu-not-an-element.log`,
          'utf8'
        )
      ).get('context-menu');
      expect(tree).toHaveLength(6);
      const problems = iosA11yProblems(control('context-menu'), tree);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(
        '4 element(s) under "ctx-accessible" are stops'
      );
      expect(problems[0]).toContain('an unnamed box under the named wrapper');
    });

    it('reports both shipped readings as its recorded debt, and only those', () => {
      // iOS 27 reads either 2 stops or 4, depending on whether React Native had
      // published the second Text when the tree was walked.
      const read = (name) =>
        parseIosA11yLog(
          readFileSync(`${__dirname}/fixtures/a11y/${name}.log`, 'utf8')
        ).get('context-menu');
      for (const name of ['ios-context-menu', 'ios-context-menu-four-stops']) {
        const shipped = checkIosControlA11y(
          control('context-menu'),
          read(name)
        );
        expect(shipped.failures).toEqual([]);
        expect(shipped.known).toHaveLength(1);
      }
      const regressed = checkIosControlA11y(
        control('context-menu'),
        read('ios-context-menu-not-an-element')
      );
      expect(regressed.failures).toHaveLength(1);
      expect(regressed.exempt).toBe(false);
    });

    it("excuses the wrapper's own Texts at any count, and nothing else", () => {
      const [row] = exemptionsFor('context-menu', 'ios');
      const stop = (label) => `static text "${label}" at (25, 459.67, 352, 17)`;
      const grace = stop('Grace Hopper');
      const body = stop('One element for screen readers, with the menu on it.');
      const sentence = (count, items, tail) =>
        `NitroUiContextMenu: ${String(count)} element(s) under "ctx-accessible" ` +
        `are stops of their own (${items}) — ${tail}`;
      const published =
        'React Native publishes each Text inside the wrapper as an element of its own';
      expect(
        row.matches.test(sentence(2, [grace, grace].join('; '), published))
      ).toBe(true);
      expect(
        row.matches.test(
          sentence(4, [grace, body, grace, body].join('; '), published)
        )
      ).toBe(true);
      expect(
        row.matches.test(
          sentence(
            6,
            [
              grace,
              body,
              stop('A Pressable that should be its own stop'),
              grace,
              body,
              grace,
            ].join('; '),
            published
          )
        )
      ).toBe(false);
      expect(
        row.matches.test(
          sentence(
            4,
            [grace, body, grace, body].join('; '),
            'the walk also reaches other "" at (25, 429, 352, 42), an unnamed box ' +
              'under the named wrapper'
          )
        )
      ).toBe(false);
    });

    it('records a Form row that is named only on its wrapper as debt', () => {
      const read = parseIosA11yLog(
        readFileSync(`${__dirname}/fixtures/a11y/ios-form.log`, 'utf8')
      ).get('form');
      expect(read).toHaveLength(2);
      const shipped = checkIosControlA11y(control('form'), read);
      expect(shipped.failures).toEqual([]);
      expect(shipped.known).toHaveLength(1);
      expect(
        checkIosControlA11y(control('form'), read, []).failures
      ).toHaveLength(1);
      const [row] = exemptionsFor('form', 'ios');
      expect(row.matches.test(shipped.known[0])).toBe(true);
      expect(
        row.matches.test(
          'NitroUiForm: "Row with onPress" is announced as an other and not as a button'
        )
      ).toBe(false);
      expect(
        row.matches.test(
          'NitroUiForm: the element under "form-row" announces the control\'s name twice'
        )
      ).toBe(false);
    });

    it('is the only case that may grade its wrapper', () => {
      expect(
        A11Y_CONTROLS.filter((entry) => entry.wrapperIsControl === true).map(
          (entry) => entry.id
        )
      ).toEqual(['context-menu']);
    });
  });

  it('goes red when the named element is not at the control’s box', () => {
    const tree = [
      wrapper(),
      node({ frame: { ...SWITCH_BOX, y: SWITCH_BOX.y + 10 } }),
    ];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is on a box that is not the control');
  });

  it('still accepts the sub-tenth a second read of one layout produces', () => {
    const tree = [
      wrapper(),
      node({ frame: { ...SWITCH_BOX, height: SWITCH_BOX.height + 0.33 } }),
    ];
    expect(iosA11yProblems(control('switch'), tree)).toEqual([]);
  });

  it('goes red when the name reaches two elements', () => {
    const tree = [
      wrapper(),
      node(),
      node({ frame: { ...SWITCH_BOX, width: SWITCH_BOX.width + 0.6 } }),
    ];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems.join(' ')).toContain('announces twice');
  });

  it('goes red when the named element can be neither acted on nor focused', () => {
    const tree = [wrapper(), node({ enabled: false, hittable: false })];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems[0]).toContain('neither enabled nor hittable');
  });

  it('leaves an indicator alone — Progress is not something you press', () => {
    // The hosted linear bar's element is `hittable=false` because it is 4 pt tall.
    const progress = control('hosted-progress');
    const tree = [
      node({
        id: progress.anchorTestId,
        label: progress.label,
        type: 'progress indicator',
        frame: { x: 16, y: 378.33, width: 370, height: 4 },
        anchor: true,
        hittable: true,
      }),
      node({
        label: progress.label,
        type: 'progress indicator',
        value: '35%',
        frame: { x: 16, y: 378.33, width: 370, height: 4 },
        hittable: false,
      }),
    ];
    expect(iosA11yProblems(progress, tree)).toEqual([]);
  });

  it('goes red when the announcement loses the kind of control it is', () => {
    // `other` is what XCUITest reports for a plain box.
    const tree = [wrapper(), node({ type: 'other' })];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems[0]).toContain(
      'is announced as an other and not as a switch'
    );
  });

  it('goes red when no element carries the testID it anchors on', () => {
    const problems = iosA11yProblems(control('switch'), [node()]);
    expect(problems[0]).toContain('never found the control');
  });

  it('tells a name with no box apart from a name that is absent', () => {
    const tree = [
      wrapper(),
      node({ frame: { x: 0, y: 0, width: 0, height: 0 } }),
    ];
    expect(iosA11yProblems(control('switch'), tree)[0]).toContain(
      'zero-sized box'
    );
  });
});

describe('the iOS debt rows', () => {
  it('prints the Slider’s real announcement as known failing, not as a pass', () => {
    // XCUITest reports the slider's adjustable element as `other` with value "0.25".
    const slider = control('slider');
    const tree = [
      node({
        id: slider.anchorTestId,
        label: slider.label,
        type: 'other',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
        anchor: true,
        value: '',
      }),
      node({
        label: slider.label,
        type: 'other',
        value: '0.25',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
      }),
    ];
    const result = checkIosControlA11y(slider, tree);
    expect(result.failures).toEqual([]);
    expect(result.known).toHaveLength(1);
    expect(result.known[0]).toContain('known failing');
    expect(result.known[0]).toContain(
      'is announced as an other and not as a slider'
    );
    expect(result.exempt).toBe(true);
  });

  it('still fails the Slider for a bug its debt row does not describe', () => {
    const slider = control('slider');
    const tree = [
      node({
        id: slider.anchorTestId,
        label: slider.label,
        type: 'other',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
        anchor: true,
      }),
      node({
        label: slider.label,
        type: 'other',
        value: '0.25',
        frame: { x: 16, y: 260, width: 370, height: 31 },
      }),
    ];
    const result = checkIosControlA11y(slider, tree);
    expect(result.failures[0]).toContain('not the control');
    expect(result.known).toHaveLength(1);
    expect(result.exempt).toBe(true);
  });

  it('reports the hosted Picker’s doubled name as a finding, and keeps it debt', () => {
    const picker = control('hosted-picker');
    const box = { x: 16, y: 578.67, width: 75.33, height: 34.67 };
    const tree = [
      node({
        id: picker.anchorTestId,
        label: 'Hosted picker',
        type: 'other',
        frame: box,
        anchor: true,
        value: '',
      }),
      node({
        label: 'Hosted picker, Hosted picker',
        type: 'button',
        frame: box,
        value: '',
      }),
    ];
    const problems = iosA11yProblems(picker, tree);
    expect(problems[0]).toContain("announces the control's name twice");
    const result = checkIosControlA11y(picker, tree);
    expect(result.known).toHaveLength(1);
    expect(result.exempt).toBe(true);
  });

  it('goes red when the hosted Picker’s label stops arriving at all', () => {
    const picker = control('hosted-picker');
    const box = { x: 16, y: 578.67, width: 75.33, height: 34.67 };
    const tree = [
      node({
        id: picker.anchorTestId,
        label: 'Hosted picker',
        type: 'other',
        frame: box,
        anchor: true,
        value: '',
      }),
      node({ label: '', type: 'button', frame: box, value: '' }),
    ];
    const result = checkIosControlA11y(picker, tree);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain(
      'no element other than the React Native wrapper'
    );
    expect(result.known).toEqual([]);
    expect(result.exempt).toBe(false);
  });

  it('counts a doubled name by the name, not by the separator', () => {
    const picker = control('hosted-picker');
    const box = { x: 16, y: 578.67, width: 75.33, height: 34.67 };
    for (const announcement of [
      'Hosted picker Hosted picker',
      'Hosted picker;Hosted picker',
      'Hosted picker, Hosted picker, Hosted picker',
    ]) {
      const problems = iosA11yProblems(picker, [
        node({
          id: picker.anchorTestId,
          label: 'Hosted picker',
          frame: box,
          anchor: true,
          value: '',
        }),
        node({ label: announcement, type: 'button', frame: box, value: '' }),
      ]);
      expect(problems[0]).toContain("announces the control's name twice");
    }
  });

  it('does not let one platform’s row excuse the other platform’s finding', () => {
    const good = [
      node({
        id: 'slider-controlled',
        label: 'Controlled slider',
        type: 'slider',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
        anchor: true,
      }),
      node({
        label: 'Controlled slider',
        type: 'slider',
        value: '0.25',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
      }),
    ];
    const result = checkIosControlA11y(control('slider'), good);
    expect(result.known).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(exemptionsFor('slider', 'ios').length).toBe(1);
    expect(
      staleExemptions(
        A11Y_CONTROLS.map((entry) => entry.id),
        [],
        'ios'
      ).every((line) => line.includes('the ios entry'))
    ).toBe(true);
  });

  it('reports the shipped IconButton inset as its recorded debt, and only that', () => {
    // On iOS 27 the named `button` element is the style's own 38.67 pt box, centred
    // inside the 44 x 44 pt host.
    const measured = parseIosA11yLog(
      readFileSync(`${__dirname}/fixtures/a11y/ios-icon-button.log`, 'utf8')
    ).get('icon-button');
    expect(measured).toHaveLength(6);
    const shipped = checkIosControlA11y(control('icon-button'), measured);
    expect(shipped.failures).toEqual([]);
    expect(shipped.known).toHaveLength(1);
    expect(shipped.known[0]).toContain('known failing');
    expect(shipped.known[0]).toContain('is announced by the element at');
    expect(shipped.exempt).toBe(true);
    const moved = checkIosControlA11y(
      control('icon-button'),
      measured.map((entry) =>
        entry.anchor
          ? entry
          : { ...entry, frame: { ...entry.frame, x: 20.5, width: 35 } }
      )
    );
    expect(moved.failures).toHaveLength(1);
    expect(moved.failures[0]).toContain('not the control');
    expect(moved.exempt).toBe(false);
  });

  it('excuses the measured inset, not a box one point or ten wider', () => {
    const [row] = exemptionsFor('icon-button', 'ios');
    const sentence = (namedBox, drawnBox) =>
      'NitroUiIconButton: "Real-input icon button" is announced by the element at ' +
      `(${namedBox}) while the control is drawn at (${drawnBox}) \u2014 the name is on a ` +
      "box that is not the control's";
    const DRAWN = '16, 267, 44, 44';
    expect(
      row.matches.test(sentence('18.67, 269.67, 38.67, 38.67', DRAWN))
    ).toBe(true);
    // The vertical coordinate may move: it depends on where the screen is scrolled.
    expect(
      row.matches.test(sentence('18.67, 412.67, 38.67, 38.67', DRAWN))
    ).toBe(true);
    expect(row.matches.test(sentence('16, 267, 44, 44', DRAWN))).toBe(false);
    expect(
      row.matches.test(sentence('18.17, 269.67, 38.67, 38.67', DRAWN))
    ).toBe(false);
    expect(
      row.matches.test(sentence('18.67, 269.67, 40.67, 38.67', DRAWN))
    ).toBe(false);
    expect(
      row.matches.test(
        sentence('18.67, 269.67, 38.67, 38.67', '16, 267, 54, 44')
      )
    ).toBe(false);
  });
});

describe('reading the pass out of an xcodebuild log', () => {
  const LOG = [
    "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputA11y]' started.",
    'real-input a11y case=switch kind=anchor id=switch-controlled x=325.0 y=217.333 w=61.0 h=28.0 nodes=2',
    'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="switch-controlled" label="Controlled switch" value="" x=325.0 y=217.333 w=61.0 h=28.0',
    'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="" label="Controlled switch" value="0" x=325.0 y=217.333 w=61.0 h=28.0',
    'real-input a11y case=hosted-segmented kind=node trait="segmented control" enabled=true hittable=true id="host-segmented" label="Hosted segmented" value="" x=16.0 y=547.667 w=165.0 h=31.0',
    'real-input a11y case=hosted-picker kind=node trait="other" enabled=true hittable=true id="host-picker" label="Hosted picker" value="" x=16.0 y=578.667 w=75.333 h=34.667',
    'real-input a11y case=hosted-picker kind=node trait="button" enabled=true hittable=true id="" label="Hosted picker, Hosted picker" value="" x=16.0 y=578.999 w=75.333 h=34.333',
    "Test Case '-[... testRealInputA11y]' passed (140.173 seconds).",
  ].join('\n');

  it('keeps a two-word element type intact', () => {
    const node = parseIosA11yLog(LOG).get('hosted-segmented')[0];
    expect(node.type).toBe('segmented control');
    expect(node.label).toBe('Hosted segmented');
  });

  it('reads each case’s elements, and marks the wrapper by its testID', () => {
    const trees = parseIosA11yLog(LOG);
    expect([...trees.keys()]).toEqual([
      'switch',
      'hosted-segmented',
      'hosted-picker',
    ]);
    const [anchor, hosted] = trees.get('switch');
    expect(anchor.anchor).toBe(true);
    expect(hosted.anchor).toBe(false);
    expect(hosted.value).toBe('0');
    expect(hosted.type).toBe('switch');
  });

  it('carries a label with a comma and spaces through intact', () => {
    const node = parseIosA11yLog(LOG).get('hosted-picker')[1];
    expect(node.label).toBe('Hosted picker, Hosted picker');
  });

  it('decides the whole run from the log alone', () => {
    const trees = parseIosA11yLog(LOG);
    expect(
      checkIosControlA11y(control('switch'), trees.get('switch'))
    ).toMatchObject({
      failures: [],
      known: [],
    });
    const picker = checkIosControlA11y(
      control('hosted-picker'),
      trees.get('hosted-picker')
    );
    expect(picker.known).toHaveLength(1);
  });

  it('refuses a line whose box did not parse, rather than reading no elements', () => {
    // The node line is broken, not the anchor line, which the reader skips.
    const broken = LOG.replace(
      'label="Controlled switch" value="0" x=325.0 y=217.333 w=61.0 h=28.0',
      'label="Controlled switch" value="0" x=325.0 y=217.333 w=?? h=??'
    );
    expect(() => parseIosA11yLog(broken)).toThrow(/no readable box/);
  });

  it('reads a log with no a11y lines as no cases at all', () => {
    expect(parseIosA11yLog('nothing here').size).toBe(0);
  });
});

describe('the accessibility re-read', () => {
  // XCUITest can return a stale first snapshot whose boxes are the real ones
  // divided by the screen scale. Here the first read is at ⅓ scale.
  const STABILITY_LOG = [
    'real-input a11y case=switch kind=stability reads=3 settled=true moved=1 elapsedMs=240 ' +
      'firstAnchorX=108.33333 firstAnchorY=72.44444 firstAnchorW=20.33333 firstAnchorH=9.33333',
    'real-input a11y case=switch kind=anchor id=switch-controlled x=325.0 y=217.333 w=61.0 h=28.0 nodes=2',
    'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="switch-controlled" label="Controlled switch" value="" x=325.0 y=217.333 w=61.0 h=28.0',
    'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="" label="Controlled switch" value="0" x=325.0 y=217.333 w=61.0 h=28.0',
  ].join('\n');

  it('does not read a stability line as an element', () => {
    const trees = parseIosA11yLog(STABILITY_LOG);
    expect(trees.get('switch')).toHaveLength(2);
    expect(
      trees.get('switch').every((element) => element.type !== 'unknown')
    ).toBe(true);
    expect(
      trees
        .get('switch')
        .every(
          (element) => Number.isFinite(element.frame.x) && element.label !== ''
        )
    ).toBe(true);
  });

  it('reads how many re-reads a case cost, and what the first read said', () => {
    const stability = parseIosA11yStability(STABILITY_LOG).get('switch');
    expect(stability.reads).toBe(3);
    expect(stability.settled).toBe(true);
    expect(stability.moved).toBe(1);
    expect(stability.elapsedMs).toBe(240);
    expect(stability.firstAnchor).toEqual({
      x: 108.33333,
      y: 72.44444,
      width: 20.33333,
      height: 9.33333,
    });
  });

  it('reports a case that printed no stability line as an ordinary two-read settle', () => {
    expect(
      parseIosA11yStability(
        'real-input a11y case=switch kind=anchor id=switch-controlled x=325.0 y=217.333 w=61.0 h=28.0 nodes=2\n' +
          'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="switch-controlled" label="Controlled switch" value="" x=325.0 y=217.333 w=61.0 h=28.0'
      ).size
    ).toBe(0);
  });

  it('keeps an unsettled case visibly unsettled', () => {
    const log =
      'real-input a11y case=switch kind=stability reads=6 settled=false moved=2 elapsedMs=1440 ' +
      'firstAnchorX=325 firstAnchorY=217 firstAnchorW=61 firstAnchorH=28';
    const stability = parseIosA11yStability(log).get('switch');
    expect(stability.settled).toBe(false);
    expect(stability.reads).toBe(6);
  });

  it('refuses a stability line whose counts did not parse', () => {
    expect(() =>
      parseIosA11yStability(
        'real-input a11y case=switch kind=stability reads=?? settled=true moved=1'
      )
    ).toThrow(/no readable read count/);
  });

  it('says nothing in the report for a case that settled on the ordinary two reads', () => {
    expect(iosStabilityNote(undefined)).toBeNull();
    expect(iosStabilityNote(null)).toBeNull();
  });

  it('notes a re-read with the read count, the first read, and the ratio between them', () => {
    const note = iosStabilityNote(
      parseIosA11yStability(STABILITY_LOG).get('switch'),
      SWITCH_BOX
    );
    expect(note).toContain('read 3 times before two agreed');
    expect(note).toContain('(108.33, 72.44, 20.33, 9.33)');
    expect(note).toContain('at ⅓ scale');
    expect(note).toContain('1 frame(s) moved');
    expect(note).toContain('240 ms');
    expect(note).toContain('never two reads');
  });

  it('will not call the first read a scaled one unless every component says so', () => {
    // One component off: x, y and width are at a third, the height is not.
    const almost = {
      reads: 3,
      settled: true,
      moved: 1,
      elapsedMs: 240,
      firstAnchor: { x: 108.33, y: 72.44, width: 20.33, height: 40 },
    };
    const notScaled = iosStabilityNote(almost, SWITCH_BOX);
    expect(notScaled).not.toContain('the first read is this box at');
    expect(notScaled).not.toContain('⅓');
    const same = { ...almost, firstAnchor: { ...SWITCH_BOX } };
    expect(iosStabilityNote(same, SWITCH_BOX)).not.toContain('scale');
    // No discarded box at all: the note still renders.
    const none = { reads: 2, settled: false, moved: 0, elapsedMs: 1500 };
    expect(iosStabilityNote(none, SWITCH_BOX)).toContain(
      'read 2 times and never agreed'
    );
  });

  it('says outright when a tree would not hold still, rather than reporting a clean box', () => {
    const note = iosStabilityNote({
      reads: 6,
      settled: false,
      moved: 2,
      elapsedMs: 1440,
    });
    expect(note).toContain('read 6 times and never agreed');
    expect(note).toContain('discount it');
    expect(note).not.toMatch(/\bFAIL\b/);
  });

  it('warns when the first read has the shape of a stale render-scale snapshot', () => {
    const warning = iosStabilityWarning(
      parseIosA11yStability(STABILITY_LOG).get('switch'),
      SWITCH_BOX
    );
    expect(warning).toContain('⅓');
    expect(warning).toContain('stale');
    expect(warning).toMatch(/not a failure/);
  });

  it('warns nothing for a re-read that is not the screen-scale shape', () => {
    expect(
      iosStabilityWarning(
        { reads: 3, settled: true, moved: 1, elapsedMs: 240 },
        SWITCH_BOX
      )
    ).toBeNull();
    const arbitrary = {
      reads: 3,
      settled: true,
      moved: 1,
      elapsedMs: 240,
      firstAnchor: { x: 108.33, y: 72.44, width: 20.33, height: 40 },
    };
    expect(iosStabilityWarning(arbitrary, SWITCH_BOX)).toBeNull();
  });

  it('warns nothing for a uniform ratio that is not a screen scale', () => {
    // Only the scales a screen has (⅓, ½, ¼, 2×, 3×) mean a stale snapshot. A
    // uniform 0.8× is a box that moved.
    const uniform = {
      x: SWITCH_BOX.x * 0.8,
      y: SWITCH_BOX.y * 0.8,
      width: SWITCH_BOX.width * 0.8,
      height: SWITCH_BOX.height * 0.8,
    };
    expect(firstReadScale(uniform, SWITCH_BOX)).toBe('0.800×');
    const stability = {
      reads: 3,
      settled: true,
      moved: 1,
      elapsedMs: 240,
      firstAnchor: uniform,
    };
    expect(iosStabilityWarning(stability, SWITCH_BOX)).toBeNull();
    const note = iosStabilityNote(stability, SWITCH_BOX);
    expect(note).toContain('0.800×');
    expect(note).not.toContain('render scale');
  });

  it('has one definition of the scale shape, shared by the note and the warning', () => {
    expect(
      firstReadScale({ x: 100, y: 100, width: 30, height: 30 }, SWITCH_BOX)
    ).toBe(null);
    const scaled = { x: 108.333, y: 72.444, width: 20.333, height: 9.333 };
    expect(firstReadScale(scaled, SWITCH_BOX)).toBe('⅓');
    const warns = iosStabilityWarning(
      {
        reads: 3,
        settled: true,
        moved: 1,
        elapsedMs: 240,
        firstAnchor: scaled,
      },
      SWITCH_BOX
    );
    const notes = iosStabilityNote(
      {
        reads: 3,
        settled: true,
        moved: 1,
        elapsedMs: 240,
        firstAnchor: scaled,
      },
      SWITCH_BOX
    );
    expect(warns).toContain('⅓');
    expect(notes).toContain('⅓');
    const plain = { x: 300, y: 200, width: 61, height: 28 };
    expect(firstReadScale(plain, SWITCH_BOX)).toBeNull();
    expect(
      iosStabilityWarning(
        {
          reads: 2,
          settled: true,
          moved: 1,
          elapsedMs: 10,
          firstAnchor: plain,
        },
        SWITCH_BOX
      )
    ).toBeNull();
  });

  it('reports the re-read onto the check: a note always, a WARN only for the scale shape', async () => {
    const { CheckLog } = await import('../real-input/report.mjs');
    const scaled = { x: 108.333, y: 72.444, width: 20.333, height: 9.333 };
    const stability = {
      reads: 3,
      settled: true,
      moved: 2,
      elapsedMs: 6_000,
      firstAnchor: scaled,
    };

    const warned = new CheckLog('Switch a11y');
    reportIosStability(warned, stability, SWITCH_BOX);
    expect(warned.notes.some((n) => n.startsWith('ok:') || n.length > 0)).toBe(
      true
    );
    expect(warned.warns.length).toBe(1);
    expect(warned.warns[0]).toContain('⅓');
    expect(warned.passed).toBe(true);

    const quiet = new CheckLog('Slider a11y');
    reportIosStability(
      quiet,
      { ...stability, firstAnchor: undefined },
      SWITCH_BOX
    );
    expect(quiet.warns).toEqual([]);
    expect(quiet.notes.length).toBeGreaterThan(0);

    const ordinary = new CheckLog('Button a11y');
    reportIosStability(ordinary, undefined, SWITCH_BOX);
    expect(ordinary.warns).toEqual([]);
    expect(ordinary.notes).toEqual([]);
  });

  it('has the runner hand the anchor-flagged box, not index zero, to the reporter', () => {
    const runner = require('node:fs').readFileSync(
      `${__dirname}/../real-input/ios-run.mjs`,
      'utf8'
    );
    const call = runner.slice(
      runner.indexOf('reportIosStability('),
      runner.indexOf('reportIosStability(') + 260
    );
    expect(call).toContain('stabilityByCase.get(entry.id)');
    expect(call).toContain('nodes.find((element) => element.anchor)?.frame');
  });

  it('has the Swift pass print what the reader parses', () => {
    // The line is written in Swift and parsed in JavaScript: every key the parser
    // reads has to be one the pass prints.
    const swift = require('node:fs').readFileSync(
      `${__dirname}/../../example/ios/NitroUiExampleUITests/RealInputTests.swift`,
      'utf8'
    );
    for (const key of [
      'reads',
      'settled',
      'moved',
      'elapsedMs',
      'firstAnchorX',
    ]) {
      expect(swift).toContain(`${key}=`);
    }
    // The pass must use the shared helpers, which the host-side Swift tests
    // cover, and not an inline copy of the wait or of the print condition.
    expect(swift).toContain('A11yFrameStability.settle(');
    expect(swift).not.toMatch(/while !framesAgree/);
    expect(swift).toContain('A11yFrameStability.shouldReport(settled)');
    expect(swift).not.toMatch(/if settled\.reads > 2/);
    expect(swift).not.toMatch(/if settled\.moved > 0/);
  });
});

describe('the Swift case list against the shared table', () => {
  const swift = require('node:fs').readFileSync(
    `${__dirname}/../../example/ios/NitroUiExampleUITests/RealInputTests.swift`,
    'utf8'
  );

  const swiftCases = () => {
    const found = [];
    const pattern =
      /A11yCase\(id:\s*"([^"]+)",\s*testId:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g;
    for (const match of swift.matchAll(pattern)) {
      found.push({ id: match[1], testId: match[2], label: match[3] });
    }
    return found;
  };

  it('has one case per row of the shared table, in the same order', () => {
    expect(swiftCases()).toEqual(
      A11Y_CONTROLS.map((entry) => ({
        id: entry.id,
        testId: entry.anchorTestId,
        label: entry.label,
      }))
    );
  });

  it('goes red when the two lists disagree about a label', () => {
    const table = A11Y_CONTROLS.map((entry) => ({ ...entry }));
    table[0] = { ...table[0], label: 'Renamed switch' };
    expect(swiftCases()).not.toEqual(
      table.map((entry) => ({
        id: entry.id,
        testId: entry.anchorTestId,
        label: entry.label,
      }))
    );
  });

  it('has a testID in the Swift list for every case the iOS rule reads', () => {
    for (const entry of A11Y_CONTROLS) {
      expect(typeof entry.anchorTestId).toBe('string');
    }
  });
});
