/**
 * On-device tests for the S6 Form spike (Q10 Appendix E's seven questions).
 *
 * The prototype is a `UICollectionView` inset-grouped list on iOS and a Material 3
 * segmented column on Android, so the honest channel is the test seams
 * (`nuiTestFormReport`, `nuiTestSectionReport`, `nuiTestRowReport`, whose fields
 * `src/components/Form/Form.nitro.ts` documents) plus React's own counters. The report is
 * not a stand-in for what the screen would show: `heights` is the layout's own answer for
 * a row, `where` is which superview a row's component view is in right now, and `kind` /
 * `x` / `w` / `radius` / `headerH` are the measurements question 2 compares.
 *
 * What these cases *cannot* prove is a finger's touch: `react-native-harness` delivers
 * events by tag, so they show that a reparented row and its hosted Switch are addressable
 * and wired, while `docs/tasks/S6/real-input.md` records the same taps synthesised by the
 * OS. Both are named in the report.
 */
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  afterEach,
  cleanup,
  describe,
  expect,
  it,
  render,
} from 'react-native-harness';
import { screen, userEvent } from '@react-native-harness/ui';

import { Form } from '../../src/components/Form/Form';
import { Switch } from '../../src/components/Switch/Switch';
import { forgetPromisedHandles, handleOf } from './handles';

const IOS = Platform.OS === 'ios';

type FormHandle = {
  nuiTestFormReport(): string;
  nuiTestScrollTo(y: number): void;
  nuiTestCommand(command: string): void;
};
type SectionHandle = { nuiTestSectionReport(): string };
type RowHandle = { nuiTestRowReport(): string };

const forms: Record<string, FormHandle> = {};
const sections: Record<string, SectionHandle> = {};
const rows: Record<string, RowHandle> = {};

/** The report as `key -> value`. */
function parse(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function num(report: Record<string, string>, key: string): number {
  const value = report[key];
  if (value == null)
    throw new Error(`report has no "${key}": ${JSON.stringify(report)}`);
  return Number(value);
}

function raw(report: Record<string, string>, key: string): string {
  return report[key] ?? '<missing>';
}

/** Read the Form's report until `ok` holds, and fail naming the report if it never does. */
async function formReport(
  ok: (r: Record<string, string>) => boolean,
  what: string,
  which = 'form'
): Promise<Record<string, string>> {
  const deadline = Date.now() + 12000;
  for (;;) {
    const handle = forms[which];
    if (handle != null) {
      const report = parse(handle.nuiTestFormReport());
      // A first read is often still "pending", which parses to {} - and a predicate that
      // reads a missing field throws rather than returning false, so the poll must swallow
      // it rather than let it out through the assertion.
      try {
        if (ok(report)) return report;
      } catch {
        /* not yet */
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Form report never satisfied "${what}" - last was ${String(
          forms[which]?.nuiTestFormReport()
        )}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Fail loudly rather than reading a method off `undefined`. */
function need<T>(handle: T | undefined): T {
  if (handle == null)
    throw new Error('expected a hybridRef handle and there is none');
  return handle;
}

async function formRef(): Promise<FormHandle> {
  return handleOf(() => forms.form, 'the Form');
}

/** The reference for a testID, retried: the first pass can find nothing. */
async function boxOf(
  testId: string
): Promise<Parameters<typeof userEvent.press>[0]> {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      return await screen.findByTestId(testId);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

const LONG_TEXT =
  'Airplane mode turns off every radio at once, including Bluetooth, Wi-Fi and cellular.';

/** What `Probe` renders, and the counters a case reads back. */
type Mode = 'base' | 'inserted' | 'removed' | 'grown';

function counters() {
  const log = {
    rows: 0,
    pressable: 0,
    switches: 0,
    silent: false,
  };
  return {
    log,
    onRowPress: () => {
      log.rows += 1;
    },
    onPressablePress: () => {
      log.pressable += 1;
    },
    onSwitchChange: (value: boolean) => {
      log.switches += 1;
      log.silent = value;
    },
  };
}

type ProbeProps = ReturnType<typeof counters> & { mode: Mode };

/**
 * The form under test: three sections, nine rows, a hosted Switch, a `Pressable`, and a
 * `Text` that wraps at the cell width. Nine = 4 + 3 + 2 in `base`; `inserted` makes ten and
 * `removed` eight, so a keyed change is a real insert or removal rather than a rebuild.
 */
function Probe({
  mode,
  log,
  onRowPress,
  onPressablePress,
  onSwitchChange,
}: ProbeProps) {
  return (
    <Form hybridRef={(view) => (forms.form = view)} style={styles.form}>
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => (sections.first = view)}
        title="Connectivity"
      >
        <Form.Row
          hybridRef={(view) => (rows.wifi = view)}
          key="wifi"
          onPress={onRowPress}
        >
          <Text testID="label-wifi">Wi-Fi</Text>
        </Form.Row>
        <Form.Row
          accessory="disclosure"
          hybridRef={(view) => (rows.bt = view)}
          key="bt"
          onPress={onRowPress}
        >
          <Text testID="label-bt">Bluetooth</Text>
        </Form.Row>
        {mode === 'inserted' ? (
          <Form.Row key="hotspot" onPress={onRowPress}>
            <Text testID="label-hotspot">Personal hotspot</Text>
          </Form.Row>
        ) : null}
        {mode === 'removed' ? null : (
          <Form.Row key="cell" onPress={onRowPress}>
            <Text testID="label-cell">Cellular data</Text>
          </Form.Row>
        )}
        <Form.Row hybridRef={(view) => (rows.pressable = view)} key="pressable">
          <Text style={styles.wrapped}>
            {mode === 'grown' ? `${LONG_TEXT} ${LONG_TEXT}` : 'Ring on receipt'}
          </Text>
          <Pressable
            onPress={onPressablePress}
            testID="inner-press"
            style={styles.pressable}
          >
            <Text>Press me</Text>
          </Pressable>
        </Form.Row>
      </Form.Section>
      <Form.Section
        hybridRef={(view) => (sections.second = view)}
        title="Sound"
      >
        {(['ringer', 'alert', 'notification'] as const).map((key) => (
          <Form.Row key={key} onPress={onRowPress}>
            <Text testID={`label-${key}`}>{key}</Text>
          </Form.Row>
        ))}
      </Form.Section>
      <Form.Section title="About">
        <Form.Row key="about">
          <Text testID="label-about">nitro-ui 0.4.0</Text>
        </Form.Row>
        <Form.Row key="silent">
          <Text testID="label-silent">Silent mode</Text>
          <Switch
            onValueChange={onSwitchChange}
            testID="switch-silent"
            value={log.silent}
          />
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

/** The same rows outside any native container - question 6's comparison. */
function Column({ count }: { count: number }) {
  return (
    <ScrollView contentContainerStyle={styles.column}>
      {Array.from({ length: count }, (_, index) => (
        <View key={`c${index}`} style={styles.columnRow}>
          <Text testID={`c${index}`}>Row {index}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function CostForm({ count }: { count: number }) {
  return (
    <Form hybridRef={(view) => (forms.cost = view)} style={styles.form}>
      <Form.Section title="Many">
        {Array.from({ length: count }, (_, index) => (
          <Form.Row key={`f${index}`}>
            <Text testID={`f${index}`}>Row {index}</Text>
          </Form.Row>
        ))}
      </Form.Section>
    </Form>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  wrapped: { flex: 1 },
  pressable: { paddingHorizontal: 8 },
  column: { gap: 8 },
  columnRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  // E7: the measured box has to *be* the row's box, so the row's own alignment and padding
  // are neutralised here - otherwise the child sits inset by them and the case would be
  // comparing a row with its content's inset copy. `measureInWindow` on the child then
  // answers the question the case asks, because the two boxes have the same origin.
  measuringRow: { alignItems: 'stretch', paddingHorizontal: 0 },
  measured: { flex: 1 },
});

/**
 * The same `Pressable` and `Switch` with no Form in sight - E4's positive control. On iOS
 * the copies inside a row receive nothing from the test's press channel, and these have to
 * receive everything, or the finding would only say that pressing is broken on this device.
 */
function Loose({
  onPressablePress,
  onSwitchChange,
}: {
  onPressablePress: () => void;
  onSwitchChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.column}>
      <Pressable
        onPress={onPressablePress}
        style={styles.pressable}
        testID="loose-press"
      >
        <Text>Press me</Text>
      </Pressable>
      <Switch
        onValueChange={onSwitchChange}
        testID="loose-switch"
        value={false}
      />
    </View>
  );
}

/** A handle, printed without assuming it is plain data. */
function describeBox(box: unknown): string {
  try {
    return JSON.stringify(box);
  } catch {
    return String(box);
  }
}

/** Mount the probe and wait for the Form's handle and first laid-out row. */
async function mount(props: ProbeProps) {
  render(<Probe {...props} />);
  await formRef();
  await boxOf('label-wifi');
  return props;
}

/** Element `index` of a parsed height list, or a failure naming the list. */
function nth(values: number[], index: number): number {
  const value = values[index];
  if (value == null || !Number.isFinite(value))
    throw new Error(`no item ${index} in [${values.join(', ')}]`);
  return value;
}

/**
 * Read a Row's or Section's report until `ok` holds. Every native report is refreshed on
 * main and read on the JS thread, so the first read is often still `"pending"`.
 */
async function reportUntil(
  read: () => string | undefined,
  ok: (r: Record<string, string>) => boolean,
  what: string
): Promise<Record<string, string>> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const line = read();
    if (line != null) {
      const report = parse(line);
      if (ok(report)) return report;
    }
    if (Date.now() > deadline) {
      throw new Error(`never saw "${what}" - last was ${String(read())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Poll an async probe until its own verdict passes, and hand back the last verdict either
 * way. A settle is not a fixed wait: a published position travels native -> JS -> React ->
 * Fabric and every hop is a turn of a queue, so the case asks again instead of sleeping. The
 * failed verdict comes back rather than a timeout error, because the assertion that reads it
 * names the rows that are still wrong.
 */
async function until<T>(
  probe: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs: number,
  what: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (ok(value)) return value;
    if (Date.now() > deadline) {
      console.log(`S6b MEASURE timed out waiting for ${what}`);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Form (S6 spike)', () => {
  afterEach(() => {
    cleanup();
    forgetPromisedHandles();
    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
  });

  it('mounts every row into the list with none stranded (E1)', async () => {
    await mount({ mode: 'base', ...counters() });
    const report = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    expect(num(report, 'sections')).toBe(3);
    expect(num(report, 'orphans')).toBe(0);
    if (IOS) {
      expect(num(report, 'items')).toBe(9);
      // Rows on screen are inside a cell; the rest are in a section's holding view.
      expect(num(report, 'inCells')).toBeGreaterThan(0);
    } else {
      expect(num(report, 'inCells')).toBe(num(report, 'rows'));
      // Question 2's Android half: one shape per row, so the count is the row count.
      const section = await reportUntil(
        () => sections.first?.nuiTestSectionReport(),
        (r) => r.shapes != null,
        'the first section to count its shapes'
      );
      expect(num(section, 'shapes')).toBe(4);
    }
    const wifi = await reportUntil(
      () => rows.wifi?.nuiTestRowReport(),
      (r) => r.where != null,
      'the Wi-Fi row to say where it is'
    );
    expect(num(wifi, 'h')).toBeGreaterThanOrEqual(IOS ? 43 : 55);
    expect(wifi.where).toBe(IOS ? 'cell' : 'inplace');
    const second = await reportUntil(
      () => sections.second?.nuiTestSectionReport(),
      (r) => r.index != null,
      'the second section to know its index'
    );
    expect(num(second, 'rows')).toBe(3);
    expect(num(second, 'index')).toBe(1);
    // Every row view in a section is a row the Form was told about. The shape a phantom
    // takes - a recycled component view registered by a recovery scan - is exactly this.
    if (IOS) expect(num(report, 'stale')).toBe(0);
  });

  it('keeps the tree intact through an insert, a removal and 50 scrolls (E1)', async () => {
    await mount({ mode: 'base', ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');

    // A keyed insert in the middle of the first section.
    const { rerender } = await render(
      <Probe mode="inserted" {...counters()} />
    );
    await formReport((r) => num(r, 'rows') === 10, 'ten rows after the insert');
    await boxOf('label-hotspot');
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');

    await rerender(<Probe mode="removed" {...counters()} />);
    await formReport(
      (r) => num(r, 'rows') === 8,
      'eight rows after the removal'
    );
    if (!IOS) {
      // Question 2 again: the shapes follow the new index/count, not the old ones.
      const section = await reportUntil(
        () => sections.first?.nuiTestSectionReport(),
        (r) => r.shapes != null,
        'the first section to recount its shapes'
      );
      expect(num(section, 'shapes')).toBe(3);
    }

    await rerender(<Probe mode="base" {...counters()} />);
    const settled = await formReport(
      (r) => num(r, 'rows') === 9,
      'nine rows again'
    );
    expect(settled.orphans).toBe('0');

    // The leak probe is growth across the cycles, not equality with the row count: a row
    // React has thrown away can still be alive in Fabric's own component-view pool, and
    // that is RN's retention, not the list's.
    const beforeCycles = parse(need(forms.form).nuiTestFormReport());
    // 50 scroll-through cycles: cells are reused, so rows move in and out of them.
    for (let cycle = 0; cycle < 50; cycle += 1) {
      need(forms.form).nuiTestScrollTo(cycle % 2 === 0 ? 400 : 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    need(forms.form).nuiTestScrollTo(0);
    const after = parse(need(forms.form).nuiTestFormReport());
    expect(after.orphans).toBe('0');
    expect(num(after, 'rows')).toBe(9);
    // Nothing was left behind by the churn or by 50 cycles of cell reuse.
    expect(num(after, 'alive')).toBe(num(beforeCycles, 'alive'));
    if (IOS) {
      // Cells really did take rows and really did hand them back. The two are not compared
      // with each other: UIKit keeps a cell across a snapshot apply, so a row can be given
      // back and re-adopted without the provider running again.
      expect(num(after, 'reclaims')).toBeGreaterThan(0);
      expect(num(after, 'reparents')).toBeGreaterThan(0);
      // The question the counters cannot answer, and the one this case exists for: after
      // fifty give-backs, is the row on screen sitting in a cell? A give-back with no
      // re-adopt looks like a blank row, not like a wrong count.
      const home = await reportUntil(
        () => rows.wifi?.nuiTestRowReport(),
        (r) => r.where != null,
        'Wi-Fi to say where it lives'
      );
      expect(home.where).toBe('cell');
    }
  });

  it('gives a row the height its content needs, before and after it grows (E3)', async () => {
    const probe = await mount({ mode: 'base', ...counters() });
    const settled = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    const wifi = await reportUntil(
      () => rows.wifi?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'Wi-Fi to have a height'
    );
    const bt = await reportUntil(
      () => rows.bt?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'Bluetooth to have a height'
    );
    const short = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'the wrapped row to have a height'
    );
    const items = (settled.heights ?? '').split(',').map(Number);
    expect(items.length).toBeGreaterThanOrEqual(4);
    // The delta between what the list says an item is and what Yoga says its row is is the
    // cell's own chrome. It must be the same for every row - that is "the cell follows
    // Yoga", and it is a comparison rather than a threshold.
    // iOS: the delta is the cell's own chrome, and it is not zero. Android has no cell -
    // the section draws behind rows Yoga laid out - so its delta is zero by construction,
    // and the case proves only that the number tracks the row. That asymmetry is the
    // answer to question 3 for the platform, and the report says it as one.
    const chrome = nth(items, 0) - num(wifi, 'h');
    if (IOS) expect(chrome).toBeGreaterThan(0);
    else expect(Math.abs(chrome)).toBeLessThanOrEqual(1);
    expect(Math.abs(nth(items, 1) - num(bt, 'h') - chrome)).toBeLessThanOrEqual(
      1
    );

    // Grow the wrapped row's text: its cell follows, and its neighbours do not move. A
    // rerender of the same tree, not a second mount: a second mount leaves the first tree's
    // row views behind in recycled holding views, which is not what this measures.
    const { rerender } = await render(<Probe {...probe} />);
    await rerender(<Probe {...probe} mode="grown" />);
    const grown = await formReport(
      (r) =>
        Math.abs(Number((r.heights ?? 'x,').split(',')[3]) - nth(items, 3)) > 4,
      'the wrapped row to be taller in the list'
    );
    const grownItems = (grown.heights ?? '').split(',').map(Number);
    expect(Math.abs(nth(grownItems, 0) - nth(items, 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(nth(grownItems, 1) - nth(items, 1))).toBeLessThanOrEqual(1);
    const tall = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > num(short, 'h') + 4,
      'the wrapped row to have grown'
    );
    expect(
      Math.abs(nth(grownItems, 3) - num(tall, 'h') - chrome)
    ).toBeLessThanOrEqual(1);
  });

  it('aims a row content at its Yoga origin on iOS and presses it on Android (E4)', async () => {
    const probe = await mount({ mode: 'base', ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    const pressable = await boxOf('inner-press');
    const toggle = await boxOf('switch-silent');

    console.log(
      `S6 TAP boxes pressable=${describeBox(pressable)} switch=${describeBox(toggle)}`
    );
    if (IOS) {
      // Question 4, the half that is not a finger. The row view is reparented into a cell,
      // so the layout tree has it nowhere near where it is drawn (`Form.tsx` therefore lays
      // iOS rows at `position: absolute, top: 0`, which is what leaves `measure`,
      // `measureInWindow` and anything that aims at the point they return useless for row
      // content). Ten presses of the Pressable and ten of the hosted Switch, aimed through
      // that geometry, reach neither: the counters stay at zero while the same case on
      // Android counts ten of each. A touch the operating system aims at the screen does
      // reach them, and that is what FormTouch.harness.tsx + docs/tasks/S6/real-input.md
      // measure. G-Form must not build anything on a row's measured position on iOS.
      for (let index = 0; index < 10; index += 1) {
        await userEvent.press(pressable);
        await userEvent.press(toggle);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(probe.log.pressable).toBe(0);
      expect(probe.log.switches).toBe(0);
      cleanup();
      render(
        <Loose
          onPressablePress={probe.onPressablePress}
          onSwitchChange={probe.onSwitchChange}
        />
      );
      await userEvent.press(await boxOf('loose-press'));
      await userEvent.press(await boxOf('loose-switch'));
      expect(probe.log.pressable).toBe(1);
      expect(probe.log.switches).toBe(1);
      return;
    }
    for (let index = 0; index < 10; index += 1) {
      await userEvent.press(pressable);
      await userEvent.press(toggle);
    }
    expect(probe.log.pressable).toBe(10);
    expect(probe.log.switches).toBe(10);
    expect(probe.log.silent).toBe(true);
    // The row stayed where it belongs after ten taps in its content.
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');
  });

  it('mounts 20 and 50 rows in one apply and no more views than rows (E6)', async () => {
    for (const count of [20, 50]) {
      const started = Date.now();
      render(<CostForm count={count} />);
      await handleOf(() => forms.cost, 'the cost Form');
      const report = await formReport(
        (r) => num(r, 'rows') === count,
        `${count} rows`,
        'cost'
      );
      const native = Date.now() - started;
      cleanup();
      delete forms.cost;
      // The same rows outside any native container, same probe: `native` versus `plain`,
      // wall-clock from `render()` to the report agreeing on the row count. Question 6's
      // harness stand-in for a bench arm - the report says so in as many words.
      const plainStart = Date.now();
      render(<Column count={count} />);
      await boxOf(`c${count - 1}`);
      const plain = Date.now() - plainStart;
      cleanup();

      console.log(
        `S6 COST N=${count} form=${native}ms plain=${plain}ms ${raw(report, 'applies')}`
      );
      expect(num(report, 'orphans')).toBe(0);
      expect(num(report, 'alive')).toBe(count);
      if (IOS) {
        expect(num(report, 'items')).toBe(count);
        // The cell-reuse claim, measured: on screen, not mounted-and-visible, is a window.
        expect(num(report, 'inCells')).toBeLessThan(count);
      }
    }
  });
});

// MARK: - E7: does `measure` say where the row is, or where the Form is?

/** 24 rows: enough that the list scrolls on any phone, which is half the question. */
const MEASURE_ROWS = 24;

/**
 * How many rows one pass compares. The go line is ten; this is ten with room, and it is what
 * keeps the case inside the suite's 30 s per-test budget rather than a claim about speed.
 */
const COMPARE_LIMIT = 14;

/** The row content of `MeasureForm`, kept by ref so a case can `measureInWindow` it. */
const measured: Record<
  string,
  {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void
    ) => void;
  }
> = {};

/**
 * A Form whose every row is measurable from JavaScript (`ref`) and reportable from native
 * (`hybridRef`), so one case can ask both trees the same question.
 */
function MeasureForm() {
  return (
    <Form hybridRef={(view) => (forms.measure = view)} style={styles.form}>
      <Form.Section title="Twenty-four">
        {Array.from({ length: MEASURE_ROWS }, (_, index) => (
          <Form.Row
            hybridRef={(view) => (rows[`m${index}`] = view)}
            key={`m${index}`}
            style={styles.measuringRow}
          >
            <View
              ref={(handle) => {
                if (handle != null) measured[`m${index}`] = handle as never;
              }}
              style={styles.measured}
              testID={`m${index}`}
            >
              <Text>Row {index}</Text>
            </View>
          </Form.Row>
        ))}
      </Form.Section>
    </Form>
  );
}

/** `measureInWindow` as a promise - the shadow tree's answer, in window points. */
function measureInWindow(
  testId: string
): Promise<[number, number, number, number]> {
  const handle = measured[testId];
  if (handle == null)
    throw new Error(`no measured view registered for "${testId}"`);
  return new Promise((resolve) => {
    handle.measureInWindow((x, y, width, height) =>
      resolve([x, y, width, height])
    );
  });
}

/** `[x, y, w, h]` from a report's `window=` field, or null for a row with no window. */
function windowOf(
  report: Record<string, string>
): [number, number, number, number] | null {
  const box = report.window;
  if (box == null || box === '-') return null;
  const parts = box.split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite)
    ? (parts as [number, number, number, number])
    : null;
}

/**
 * Ask both trees where every row in a cell is, and return what disagrees.
 *
 * Rows without a cell are skipped rather than counted: their published position is derived
 * from the list's layout, while `window=` is a view's real position, and there is no view to
 * read for a recycled row. That is also why the case insists on a minimum count - "all zero
 * rows agree" is a pass that proves nothing.
 *
 * The pass is bounded at {@link COMPARE_LIMIT} comparisons. Every comparison is two round
 * trips - one to a report refreshed on main, one to the shadow tree - and the suite's per-test
 * budget is 30 s, which this case shares with the scroll and the settle poll. Ten in-cell rows
 * is the go line; fourteen is the same claim with a margin, and a pass that stops at the limit
 * is still a pass on rows it actually read.
 *
 * `scrolledBy` is a correction the case applies to the shadow-tree answer, and S6b measured
 * that it is `0` on both platforms - which is the most useful thing this case found.
 * `measure`/`measureInWindow` are one shared C++ walk (`UIManagerBinding.cpp:689` ->
 * `dom::measureInWindow` -> `LayoutableShadowNode::computeRelativeLayoutMetrics`), and per
 * ancestor that walk adds two things: the node's Yoga `frame.origin` and its
 * `getContentOriginOffset(true)`. RN's `ScrollView` overrides the second to `-contentOffset`
 * (`ScrollViewShadowNode.cpp:67`, fed from `scrollViewDidScroll`), so an Android Form - whose
 * scroller *is* an RN `ScrollView` (`Form.tsx`) - already measures where its rows are drawn,
 * mid-scroll and at rest: after a 180 dp scroll its rows measured `-178.7` against UIKit's
 * `-178.7`. iOS gets the same `0` for the opposite reason: a `UICollectionView` is not a
 * shadow node, so nothing in the walk knows about its scroll, and the Form publishes each
 * cell's resting place into the row's own `top`/`left` to put it there (question 4).
 * Subtracting the scroll offset on Android, which an earlier draft of this case did, made all
 * fourteen comparisons wrong by exactly the scroll - a wrong assumption, not a wrong Form.
 */
async function compareRows(
  what: string,
  scrolledBy: number
): Promise<{ compared: number; bad: string[] }> {
  let compared = 0;
  const bad: string[] = [];
  for (
    let index = 0;
    index < MEASURE_ROWS && compared < COMPARE_LIMIT;
    index += 1
  ) {
    const id = `m${index}`;
    const report = await reportUntil(
      () => rows[id]?.nuiTestRowReport(),
      // A row in a section's holding view has no pixels to report (`-`), so it may answer
      // with that instead of a box; anything else has to produce a box to be compared.
      (r) =>
        windowOf(r) != null || r.where === 'holding' || r.where === 'detached',
      `${id} to have a window or be off screen`
    );
    const native = windowOf(report);
    if (native == null) continue;
    const measured2 = await measureInWindow(id);
    compared += 1;
    // The view has been drawn `scrolledBy` higher than Yoga laid it out; the shadow-tree
    // answer does not know that (see above), so it has to be taken off before comparing.
    // Both platforms answer `0` today, so this subtraction is a seam rather than a
    // correction: it stays because the day a Form scrolls inside itself on iOS without
    // publishing (or a platform stops applying the ancestor hook) is the day it is needed.
    const expectY = measured2[1] - scrolledBy;
    const off = Math.max(
      Math.abs(measured2[0] - native[0]),
      Math.abs(expectY - native[1])
    );
    if (off > 1) {
      bad.push(
        `${id}: measureInWindow ${measured2.map(round1).join(',')} (-scroll ` +
          `${round1(scrolledBy)} = ${round1(expectY)}) vs UIKit ` +
          `${native.map(round1).join(',')} (off by ${round1(off)} pt)`
      );
    }
  }
  console.log(
    `S6b MEASURE ${what}: compared=${compared} scroll=${round1(scrolledBy)} ` +
      `mismatched=${bad.length}` +
      (bad.length > 0 ? ` - ${bad.join(' | ')}` : '')
  );
  return { compared, bad };
}

/**
 * How far the Form has scrolled, as its own report says - Android only.
 *
 * Asked, not assumed: the case compares a number it read from the device against a number it
 * read from the device, and a wrong guess here reads as a `measure` bug on the other side.
 * The report is eventually consistent (a read answers with whatever main published last), so
 * one read straight after `nuiTestScrollTo` can answer with the offset from *before* it; the
 * poll waits for an offset that has both moved past `minimum` and stopped moving, which is
 * the same shape `readReport()` polls in.
 */
async function formScrollY(minimum: number): Promise<number> {
  const deadline = Date.now() + 12000;
  let previous = Number.NaN;
  for (;;) {
    const report = await formReport(
      (r) => r.scroll !== undefined,
      'the Form to report its scroll offset',
      'measure'
    );
    const scroll = num(report, 'scroll');
    if (scroll === previous && scroll >= minimum) return scroll;
    previous = scroll;
    if (Date.now() > deadline) {
      throw new Error(
        `the Form's scroll offset never settled past ${String(minimum)} dp - last reads ` +
          `were ${String(previous)}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function round1(value: number): string {
  return value.toFixed(1);
}

describe('Form measure (S6b spike, question 4)', () => {
  afterEach(() => {
    cleanup();
  });

  it('measures a row as the row, before and after a scroll (E7)', async () => {
    render(<MeasureForm />);
    const form = await handleOf(() => forms.measure, 'the measuring Form');
    await formReport(
      (r) => num(r, 'rows') === MEASURE_ROWS,
      `${MEASURE_ROWS} rows`,
      'measure'
    );

    // At rest. Android is the control here: its rows never leave Yoga's box, so both trees
    // have always agreed and a case that cannot see the difference is not worth running.
    const atRest = await compareRows('at rest', 0);
    expect(atRest.bad).toEqual([]);
    expect(atRest.compared).toBeGreaterThanOrEqual(10);

    // Scrolled. On iOS this is the whole point: the cells move and the rows' Yoga origins do
    // not, until the Form publishes where they came to rest - and on Android that the list
    // really moved is asked of the device, not assumed, because a case that compared two
    // numbers with nothing scrolled would pass on the at-rest readings.
    const height = 180;
    form.nuiTestScrollTo(height);
    const scrolledBy = 0;
    if (!IOS) {
      expect(Math.abs((await formScrollY(height / 2)) - height)).toBeLessThanOrEqual(2);
    }
    const scrolled = await until(
      () => compareRows(`after ${height} pt`, scrolledBy),
      (r) => r.bad.length === 0 && r.compared >= 10,
      12000,
      'every row in a cell to measure where UIKit put it'
    );
    expect(scrolled.bad).toEqual([]);
    expect(scrolled.compared).toBeGreaterThanOrEqual(10);
    cleanup();
  });
});
