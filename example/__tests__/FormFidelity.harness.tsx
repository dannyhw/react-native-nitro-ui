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
import { Platform, StyleSheet, Text } from 'react-native';
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
    const report = parse(theForm().nuiTestFormReport());
    if (ok(report)) return report;
    if (Date.now() > deadline) {
      throw new Error(
        `never saw "${what}" - last was ${theForm().nuiTestFormReport()}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A window wide enough to screenshot the screen this case is holding. */
async function hold(marker: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`S6 SHOOT ${marker}`);
  await new Promise((resolve) => setTimeout(resolve, 15000));
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

const styles = StyleSheet.create({ form: { flex: 1 } });

/** The fields question 2 names, plus the two the go line implies for separators. */
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

describe('Form fidelity (S6 spike, question 2)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(forms)) delete forms[key];
  });

  it('measures the prototype and a SwiftUI Form the same way (E2)', async () => {
    render(<FidelityForm />);
    const proto = await read(
      (r) => num(r, 'rows') === 8 && r.kind === 'prototype',
      'the prototype list'
    );
    // eslint-disable-next-line no-console
    console.log(`S6 GEOM prototype ${theForm().nuiTestFormReport()}`);
    await hold('prototype');

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
    // eslint-disable-next-line no-console
    console.log(`S6 GEOM reference ${theForm().nuiTestFormReport()}`);
    await hold('reference');
    theForm().nuiTestCommand('hide-reference');

    const diffs = FIELDS.map(
      (field) =>
        `${field}=${(num(proto, field) - num(reference, field)).toFixed(2)}`
    );
    // eslint-disable-next-line no-console
    console.log(`S6 DIFF ${diffs.join(' ')}`);
    for (const field of FIELDS) {
      expect(
        Math.abs(num(proto, field) - num(reference, field))
      ).toBeLessThanOrEqual(1);
    }
  });
});
