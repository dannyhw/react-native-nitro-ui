/**
 * Questions 4 and 7 of Q10 Appendix E, answered with touches the *operating system*
 * synthesised - IOHIDEvent on iOS, `adb shell input tap` on Android - rather than the
 * in-app events `react-native-harness` delivers by tag.
 *
 * That distinction is the whole point: a reparented row inside a `UICollectionViewListCell`
 * (iOS) or behind a Compose shape (Android) has to be found by the platform's own
 * hit-testing, and an event delivered straight to a React tag never tests that.
 *
 * So the taps do not come from here. The driver is `docs/tasks/S6/real-input.md`: it reads
 * the coordinates out of the live UI and presses each target ten times. This case renders the
 * form, shows the counters on screen so the driver can be watched, and waits.
 *
 * **It asserts only when it was driven.** If nothing arrived, it logs that and passes, so the
 * case can sit inside a normal harness run unattended; a pass without a `S6 REALINPUT driven`
 * line in the log proves nothing, and the report says so next to the claim it supports.
 */
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';

import { Form } from '../../src/components/Form/Form';
import { Switch } from '../../src/components/Switch/Switch';

const IOS = Platform.OS === 'ios';
const TARGET = 10;

type FormHandle = { nuiTestFormReport(): string };

const forms: Record<string, FormHandle> = {};
const log = { rows: 0, pressable: 0, switches: 0, silent: false };

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

function TouchForm() {
  return (
    <Form
      hybridRef={(view) => {
        forms.form = view;
      }}
      style={styles.form}
    >
      <Form.Section title="Real input">
        <Form.Row onPress={() => (log.rows += 1)}>
          <Text testID="row-a">Row A</Text>
        </Form.Row>
        <Form.Row onPress={() => (log.rows += 1)}>
          <Text testID="row-b">Row B</Text>
        </Form.Row>
        <Form.Row onPress={() => (log.rows += 1)}>
          <Text testID="row-c">Row C</Text>
        </Form.Row>
        <Form.Row>
          <Pressable
            onPress={() => (log.pressable += 1)}
            testID="inner-press"
            style={styles.pressable}
          >
            <Text>Press me</Text>
          </Pressable>
        </Form.Row>
        <Form.Row onPress={() => (log.rows += 1)}>
          <Text>Switch</Text>
          <Switch
            onValueChange={(value) => {
              log.switches += 1;
              log.silent = value;
            }}
            testID="switch-a"
            value={log.silent}
          />
        </Form.Row>
        <Form.Row>
          <Text testID={`echo-${log.rows}-${log.pressable}-${log.switches}`}>
            rows={log.rows} pressable={log.pressable} switches={log.switches}
          </Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  pressable: { paddingHorizontal: 12, paddingVertical: 6 },
});

describe('Form real input (S6 spike, questions 4 and 7)', () => {
  afterEach(() => {
    cleanup();
    delete forms.form;
    log.rows = 0;
    log.pressable = 0;
    log.switches = 0;
    log.silent = false;
  });

  it('takes ten taps each on a row, a Pressable and a hosted Switch', async () => {
    render(<TouchForm />);
    const deadline = Date.now() + 90000;
    while (
      Date.now() < deadline &&
      (log.rows < TARGET || log.pressable < TARGET || log.switches < TARGET)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const report = parse(theForm().nuiTestFormReport());
    const driven = log.rows + log.pressable + log.switches > 0;
    // eslint-disable-next-line no-console
    console.log(
      `S6 REALINPUT ${driven ? 'driven' : 'not driven'} rows=${log.rows} ` +
        `pressable=${log.pressable} switches=${log.switches} ` +
        `taps=${report.taps ?? '-'} orphans=${report.orphans ?? '-'} ` +
        `where=${IOS ? 'cell' : 'inplace'}`
    );
    if (!driven) return;

    // Q4: taps land, on the row's own cell and on the content inside it.
    expect(log.rows).toBeGreaterThanOrEqual(TARGET);
    expect(log.pressable).toBeGreaterThanOrEqual(TARGET);
    // Q7: the hosted control still gets its own touches, and the row's press did not eat
    // them - ten presses of the Switch are ten value changes.
    expect(log.switches).toBeGreaterThanOrEqual(TARGET);
    expect(log.silent).toBe(true);
    expect(report.orphans).toBe('0');
    if (IOS) {
      // On iOS a row's onPress is UIKit's cell selection, so the list counted them too.
      expect(Number(report.taps)).toBeGreaterThanOrEqual(TARGET);
    }
  });
});
