/**
 * Question 2 of Q10 Appendix E, on iOS: the Form's inset-grouped list against the same
 * three sections in a SwiftUI `Form`, measured by the same Swift code reading the
 * `UICollectionView` that is currently in the Form's box.
 *
 * Both are UIKit grouped lists; what differs is the front end that configures them, which is
 * exactly what the question asks. Every number is the layout's own answer - item frame,
 * corner radius, separator start, supplementary frames - never a constant, and the go line is
 * 1 pt.
 *
 * The two `hold()`s are screenshot windows: the fidelity question wants our list and the
 * reference at the same traits, and this is the one place both are on screen with the same
 * width. The suite runs once per trait set (light, dark, the largest content size), which is
 * why it is its own gate rather than a case inside `Form.harness`.
 *
 * Android has no platform `Form` to compare with, so the case there only checks that the
 * Form measured itself, and the report says the Android half of question 2 is the
 * `SegmentedListItem` shape check in `Form.harness`.
 */
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';

import { Form } from '../../src/components/Form/Form';

const IOS = Platform.OS === 'ios';

type FormHandle = {
  nuiTestFormReport(): string;
  nuiTestCommand(command: string): void;
};

const forms: Record<string, FormHandle> = {};

/** A section handle: its own report is where the header and footer bands are measured. */
type SectionHandle = { nuiTestSectionReport(): string };

const sections: Record<string, SectionHandle> = {};

/** Names what is on screen, so a screenshot says what it shows. Set by `hold()`. */
let setPhase: (phase: string) => void = () => {};

/** The line under the form. `hold()` names the phase before it opens its window. */
function Banner() {
  const [phase, name] = useState('mounting');
  setPhase = name;
  return (
    <Text style={styles.banner} testID={`phase-${phase}`}>
      {phase}
    </Text>
  );
}

/** The Form under test - fail loudly rather than reading a method off `undefined`. */
function theForm(): FormHandle {
  const form = forms.form;
  if (form == null)
    throw new Error('expected the Form handle and there is none');
  return form;
}

function parse(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function num(report: Record<string, string>, key: string): number {
  const value = Number(report[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`"${key}" is not a number in ${JSON.stringify(report)}`);
  }
  return value;
}

async function read(
  ok: (r: Record<string, string>) => boolean,
  what: string
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    // A first read is often "pending", which parses to {}, and before the native view has
    // published its handle there is no report to read at all - so the poll swallows both
    // rather than letting them out through the assertion.
    try {
      const report = parse(theForm().nuiTestFormReport());
      if (ok(report)) return report;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `never saw "${what}" - last was ${String(
          forms.form?.nuiTestFormReport() ?? '<no handle>'
        )}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Read a section's own report until Compose has measured the header band.
 *
 * The bands are not in the Form's report and cannot be: a Form has several sections, and the
 * numbers belong to one of them. So the case asks the section that owns them, the same way
 * `Form.harness` asks a section for its shapes.
 */
async function readSection(
  which = 'first',
  ok: (r: Record<string, string>) => boolean = () => true
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    try {
      const report = parse(sections[which]?.nuiTestSectionReport() ?? '');
      if (ok(report)) return report;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `never saw the "${which}" section report satisfied - last was ` +
          `${String(sections[which]?.nuiTestSectionReport() ?? '<no handle>')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Name the phase on screen, then hold a window wide enough to screenshot it. */
async function hold(marker: string): Promise<void> {
  setPhase(marker);
  await new Promise((resolve) => setTimeout(resolve, 400));

  console.log(`S6 SHOOT ${marker}`);
  await new Promise((resolve) => setTimeout(resolve, 9000));
}

/** The same nine rows the reference shows, as our Form renders them. */
function FidelityForm() {
  return (
    <Form
      hybridRef={(view) => {
        forms.form = view;
      }}
      style={styles.form}
    >
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => {
          sections.first = view;
        }}
        title="Connectivity"
      >
        <Form.Row>
          <Text>Wi-Fi</Text>
        </Form.Row>
        <Form.Row>
          <Text>Bluetooth</Text>
        </Form.Row>
        <Form.Row>
          <Text>Cellular data</Text>
        </Form.Row>
        <Form.Row>
          <Text>Ring on receipt</Text>
        </Form.Row>
      </Form.Section>
      <Form.Section title="Sound">
        <Form.Row>
          <Text>ringer</Text>
        </Form.Row>
        <Form.Row>
          <Text>alert</Text>
        </Form.Row>
        <Form.Row>
          <Text>notification</Text>
        </Form.Row>
      </Form.Section>
      <Form.Section title="About">
        <Form.Row>
          <Text>nitro-ui 0.4.0</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  banner: { paddingHorizontal: 8, paddingVertical: 2, fontSize: 11 },
});

/** The container metrics question 2 names, plus the two the go line implies for separators. */
const FIELDS = [
  'listW',
  'x',
  'w',
  'h0',
  'h1',
  'h2',
  'radius',
  'sep',
  'headerX',
  'headerY',
  'headerH',
  'footerH',
] as const;

/** How far a container metric may drift from SwiftUI's list, in pt. */
const CONTAINER_BOUND_PT = 1;
/**
 * How far a row's box may drift from SwiftUI's, in pt - see the note on the
 * comparison.
 *
 * It used to be 8, which is how a row 8 pt too tall shipped as a pass: the bound and the
 * bug were the same number. S6's answer minted the cell's chrome instead (`rowChrome`),
 * so the bound is now what a reader could call a match.
 */
const ROW_BOX_BOUND_PT = 0.5;

describe('Form fidelity against a SwiftUI Form (E2)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(forms)) delete forms[key];
    for (const key of Object.keys(sections)) delete sections[key];
  });

  it('measures the Form and a SwiftUI Form the same way (E2)', async () => {
    // The banner is the only way to tell the two screens apart in a screenshot, and a
    // screenshot is the evidence question 2 asks for.
    render(
      <View style={{ flex: 1 }}>
        <FidelityForm />
        <Banner />
      </View>
    );
    const proto = await read(
      // `kind` is iOS-only: it names which list the probe measured. Android has one list,
      // so its report has nothing of the kind to match on.
      (r) => num(r, 'rows') === 8 && (!IOS || r.kind === 'prototype'),
      'the nitro-ui Form list'
    );

    console.log(`S6 GEOM prototype ${theForm().nuiTestFormReport()}`);
    await hold('prototype: nitro-ui Form');

    if (!IOS) {
      // No platform Form on Android: measuring our own list is the whole iOS-free half.
      expect(num(proto, 'rows')).toBe(8);
      // ...except the one thing only Android can get wrong. The header and footer are
      // Compose text in a layer *under* the rows, so the rows cover whatever Yoga failed
      // to reserve: S6 reserved the glyphs alone and every header lost its lower half
      // (form-android.png). The band therefore has to be the glyphs *plus* its padding -
      // the padding itself is FormListMetrics' (16 dp / 12 dp), and what this insists on
      // is that the reservation is not the glyph box: put `onSizeChanged` back inside the
      // padding and both lines below go red at once.
      const bands = await readSection('first', (r) => {
        num(r, 'headerBand');
        num(r, 'footerBand');
        return true;
      });
      console.log(`S6 BANDS first section ${JSON.stringify(bands)}`);
      const padding = (band: string, text: string) =>
        num(bands, band) - num(bands, text);
      expect(padding('headerBand', 'headerText')).toBeGreaterThanOrEqual(8);
      expect(padding('footerBand', 'footerText')).toBeGreaterThanOrEqual(4);
      return;
    }

    // The width the Form tells JS a row is wide has to be the width a cell draws that row
    // in. It is not a cosmetic number: the React side lays a row's content out at it, so a
    // row told about a wider box puts its right-aligned content (a Switch, a chevron, a
    // value) past the cell's edge, and UIKit stops hit-testing at that edge - a hosted
    // `Switch` there takes no taps at all (S6b question 4, 0 of 10). `boxReports` is the
    // other half: a `width` that is right only because the list's layout happened to be
    // asked at the right moment is a number that will be wrong on the next device.
    const reported = num(proto, 'width');
    const drawn = num(proto, 'boxW');
    if (reported !== drawn || num(proto, 'boxReports') < 1) {
      throw new Error(
        `question 4: the Form lays rows out at ${reported} pt and draws them at ${drawn} pt ` +
          `(cell ${num(proto, 'w')} pt, list ${num(proto, 'listW')} pt, ` +
          `${num(proto, 'boxReports')} cell report(s))`
      );
    }

    theForm().nuiTestCommand('show-reference');

    const reference = await read(
      (r) => r.kind === 'reference',
      'the SwiftUI Form reference'
    );

    console.log(`S6 GEOM reference ${theForm().nuiTestFormReport()}`);
    await hold('reference: SwiftUI Form');
    theForm().nuiTestCommand('hide-reference');

    // The container's own geometry has to match a SwiftUI list to the point, because that
    // is what "nobody can tell" means. The three row heights are *not* container metrics -
    // they are the row's box: the row's Yoga height plus the cell's `rowChrome` - so they
    // are compared against a named bound instead. S6 measured 60 pt against SwiftUI's 52
    // and the owner's answer was to match 52; S6b minted `rowChrome` to do it, and the
    // bound is tight again, so a chrome that drifts back is a red gate, not a pass.
    //
    // Failure throws rather than asserting an array: the gate log prints an assertion's
    // received string on one truncated line and elides an array entirely, and this table is
    // question 2's whole answer.
    const measured = FIELDS.map((field) => ({
      field,
      proto: num(proto, field),
      reference: num(reference, field),
    }));
    const table = measured
      .map(
        (m) =>
          `${m.field.padEnd(9)} ${m.proto.toFixed(2).padStart(8)} ${m.reference
            .toFixed(2)
            .padStart(8)} ${(m.proto - m.reference).toFixed(2).padStart(8)}`
      )
      .join('\n');
    const over = measured.filter(
      (m) =>
        Math.abs(m.proto - m.reference) >
        (m.field.startsWith('h') && m.field.length === 2
          ? ROW_BOX_BOUND_PT
          : CONTAINER_BOUND_PT)
    );
    if (over.length > 0) {
      throw new Error(
        `question 2: ${over.length} field(s) out of bounds ` +
          `(${CONTAINER_BOUND_PT} pt container, ${ROW_BOX_BOUND_PT} pt row box).\n` +
          `field       prototype  reference    delta\n${table}`
      );
    }
  });
});
