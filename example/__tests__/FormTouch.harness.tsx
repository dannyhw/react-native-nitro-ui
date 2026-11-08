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
import { type ComponentRef, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
const log = {
  rows: 0,
  pressable: 0,
  switches: 0,
  switchToTrue: 0,
  outside: 0,
  lastSwitch: false,
};

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

/**
 * Both platforms answer a report with whatever main published last and refill it on the next
 * main pass, because answering *now* would block the JS thread on main. So one read is a
 * snapshot of "pending" the first time, and every case that asserts on the report polls -
 * this one included, or `orphans` reads as missing and a clean run looks like an orphan.
 */
async function readReport(): Promise<Record<string, string>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const report = parse(theForm().nuiTestFormReport());
    if (report.orphans !== undefined) return report;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return parse(theForm().nuiTestFormReport());
}

/**
 * Log a target's window rect for the driver outside the app: iOS wants points, Android wants
 * pixels, and both are this same number times the platform's own scale. `console.log` reaches
 * the simulator's log and logcat even though a gate log carries neither.
 */
type Measurable = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

function logGeometry(name: string, view: Measurable | null) {
  view?.measureInWindow((x, y, width, height) => {
    console.log(
      `S6 GEOM ${name}=${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`
    );
  });
}

function TouchForm() {
  const outsideBox = useRef<ComponentRef<typeof View>>(null);
  const rowBox = useRef<ComponentRef<typeof View>>(null);
  const pressBox = useRef<ComponentRef<typeof View>>(null);
  const switchBox = useRef<ComponentRef<typeof View>>(null);
  return (
    <View style={styles.page}>
      {/*
       * The control for the driver itself. An injected touch that reaches this plain
       * `Pressable` - an ordinary RN tree, no native container around it - says the harness
       * app takes OS-level input at all. Without it, a Form row that answers nothing is
       * indistinguishable from a screen that was never touched.
       */}
      <View
        onLayout={() => logGeometry('outside', outsideBox.current)}
        ref={outsideBox}
      >
        <Pressable
          onPress={() => (log.outside += 1)}
          testID="outside-press"
          style={styles.outside}
        >
          <Text>Outside</Text>
        </Pressable>
      </View>
      <Form
        hybridRef={(view) => {
          forms.form = view;
        }}
        style={styles.form}
      >
        <Form.Section title="Real input">
          <Form.Row onPress={() => (log.rows += 1)}>
            <View
              onLayout={() => logGeometry('rowA', rowBox.current)}
              ref={rowBox}
            >
              <Text testID="row-a">Row A</Text>
            </View>
          </Form.Row>
          <Form.Row onPress={() => (log.rows += 1)}>
            <Text testID="row-b">Row B</Text>
          </Form.Row>
          <Form.Row onPress={() => (log.rows += 1)}>
            <Text testID="row-c">Row C</Text>
          </Form.Row>
          <Form.Row>
            <View
              onLayout={() => logGeometry('inner', pressBox.current)}
              ref={pressBox}
            >
              <Pressable
                onPress={() => (log.pressable += 1)}
                testID="inner-press"
                style={styles.pressable}
              >
                <Text>Press me</Text>
              </Pressable>
            </View>
          </Form.Row>
          <Form.Row onPress={() => (log.rows += 1)}>
            <Text>Switch</Text>
            <View
              onLayout={() => {
                switchBox.current?.measureInWindow((x, y, width, height) => {
                  console.log(
                    `S6 GEOM switch=${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`
                  );
                });
              }}
              ref={switchBox}
            >
              <Switch
                onValueChange={(value) => {
                  log.switches += 1;
                  log.switchToTrue += value ? 1 : 0;
                  log.lastSwitch = value;
                }}
                testID="switch-a"
                value={log.lastSwitch}
              />
            </View>
          </Form.Row>
          <Form.Row>
            <Text testID={`echo-${log.rows}-${log.pressable}-${log.switches}`}>
              {`rows=${log.rows} pressable=${log.pressable} switches=${log.switches} outside=${log.outside}`}
            </Text>
          </Form.Row>
        </Form.Section>
      </Form>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  form: { flex: 1 },
  pressable: { paddingHorizontal: 12, paddingVertical: 6 },
  outside: {
    backgroundColor: '#ffffff',
    borderColor: '#000000',
    borderRadius: 8,
    borderWidth: 2,
    paddingVertical: 12,
  },
});

describe('Form real input (S6 spike, questions 4 and 7)', () => {
  afterEach(() => {
    cleanup();
    delete forms.form;
    log.rows = 0;
    log.pressable = 0;
    log.switches = 0;
    log.switchToTrue = 0;
    log.outside = 0;
    log.lastSwitch = false;
  });

  it('takes ten taps each on a row, a Pressable and a hosted Switch', async () => {
    render(<TouchForm />);
    // Long enough for a driver outside the app to read the live tree, tap three targets ten
    // times each, and still have this case assert what arrived. Real input is slow from out
    // here, so the window belongs to the driver, not to the app.
    const deadline = Date.now() + 240000;
    while (
      Date.now() < deadline &&
      (log.rows < TARGET ||
        log.pressable < TARGET ||
        log.switches < TARGET ||
        log.outside < TARGET)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const report = await readReport();
    const driven = log.rows + log.pressable + log.switches + log.outside > 0;

    console.log(
      `S6 REALINPUT ${driven ? 'driven' : 'not driven'} rows=${log.rows} ` +
        `pressable=${log.pressable} switches=${log.switches} outside=${log.outside} ` +
        `taps=${report.taps ?? '-'} orphans=${report.orphans ?? '-'} ` +
        `where=${IOS ? 'cell' : 'inplace'}`
    );
    if (!driven) return;

    // One assertion whose red message is every counter: jest stops at the first failed
    // `expect`, and a run that says only "expected 4 to be >= 10" hides whether the Switch
    // or the Pressable got anything - the difference between a lost tap and a row whose
    // content cannot be touched at all. `outside` comes first, because a run where the
    // control answereds nothing never had an injected touch to begin with, and reading that
    // back as "the Form drops taps" would be a finding that was never measured.
    const counts = `outside=${log.outside} rows=${log.rows} pressable=${log.pressable} switches=${log.switches} toTrue=${log.switchToTrue}`;
    const enough =
      log.outside >= TARGET &&
      log.rows >= TARGET &&
      log.pressable >= TARGET &&
      log.switches >= TARGET &&
      log.switchToTrue >= 1 &&
      report.orphans === '0' &&
      (!IOS || Number(report.taps) >= TARGET);
    // Q4: taps land on the row's own cell and on the content inside it; Q7: the hosted
    // control still gets its own touches, so ten presses of the Switch are ten changes.
    expect(enough ? 'all ten' : counts).toBe('all ten');
  });
});
