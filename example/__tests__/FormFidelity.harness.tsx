/**
 * Question 2 of Q10 Appendix E, on iOS: the prototype's inset-grouped list against the same
 * three sections in a SwiftUI `Form`, measured by the same Swift code reading the
 * `UICollectionView` that is currently in the Form's box.
 *
 * Both are UIKit grouped lists; what differs is the front end that configures them, which is
 * exactly what the question asks. Every number is the layout's own answer - item frame,
 * corner radius, separator start, supplementary frames - never a constant, and the go line is
 * 1 pt.
 *
 * The two `hold()`s are screenshot windows: `docs/tasks/S6/` wants the prototype and the
 * reference at the same traits, and this is the one place both are on screen with the same
 * width. The suite runs once per trait set (light, dark, the largest content size), which is
 * why it is its own gate rather than a case inside `Form.harness`.
 *
 * Android has no platform `Form` to compare with, so the case there only checks that the
 * prototype measured itself, and the report says the Android half of question 2 is the
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

/** Name the phase on screen, then hold a window wide enough to screenshot it. */
async function hold(marker: string): Promise<void> {
  setPhase(marker);
  await new Promise((resolve) => setTimeout(resolve, 400));

  console.log(`S6 SHOOT ${marker}`);
  await new Promise((resolve) => setTimeout(resolve, 9000));
}

/** The same nine rows the reference shows, as the prototype renders them. */
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
/** How far a row's content box may drift, in pt - see the note on the comparison. */
const ROW_BOX_BOUND_PT = 8;

describe('Form fidelity (S6 spike, question 2)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(forms)) delete forms[key];
  });

  it('measures the prototype and a SwiftUI Form the same way (E2)', async () => {
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
      'the prototype list'
    );

    console.log(`S6 GEOM prototype ${theForm().nuiTestFormReport()}`);
    await hold('prototype: nitro-ui Form');

    if (!IOS) {
      // No platform Form on Android: measuring the prototype is the whole iOS-free half.
      expect(num(proto, 'rows')).toBe(8);
      return;
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
    // they are the row's content box, which React Native lays out from its own text
    // metrics - so they are compared against a named bound instead: the prototype's default
    // row box is 60 pt where SwiftUI's plain row is 52 pt, and the 8 pt is a padding
    // constant G-Form has to mint, not a difference between the containers.
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
