/**
 * On-device tests for `Form`, `Form.Section` and `Form.Row` (G24, DECISIONS D45).
 *
 * The `(E…)` on each case is the question of Q10 Appendix E that the case answers, kept
 * because `docs/tasks/Q10-form-list-research.report.md` is where the answers are read.
 *
 * The container is a `UICollectionView` inset-grouped list on iOS and a Material 3
 * segmented column on Android, so the honest channel is the test seams
 * (`nuiTestFormReport`, `nuiTestSectionReport`, `nuiTestRowReport`, whose fields
 * `src/components/Form/Form.nitro.ts` documents) plus React's own counters. The report is
 * not a stand-in for what the screen would show: `heights` is the layout's own answer for
 * a row, `where` is which superview a row's component view is in right now, and `kind` /
 * `x` / `w` / `radius` / `headerH` are the measurements question 2 compares.
 *
 * What these cases *cannot* prove is a finger's touch: `react-native-harness` delivers
 * events by tag, so they show that a reparented row and its hosted Switch are addressable
 * and wired, while `testRealInputForm` (`example/ios/NitroUiExampleUITests`) and the `form`
 * check in `scripts/real-input/android.mjs` synthesise the same taps through the OS.
 */
import type { ReactElement } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
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
import { useSelfSizingBaseStyle } from '../../src/core/useSelfSizing';
import { Switch } from '../../src/components/Switch/Switch';
import { forgetPromisedHandles, handleOf } from './handles';

const IOS = Platform.OS === 'ios';

type FormHandle = {
  nuiTestFormReport(): string;
  nuiTestScrollTo(y: number): void;
  nuiTestCommand(command: string): void;
};
type SectionHandle = { nuiTestSectionReport(): string };
type RowHandle = {
  nuiTestRowReport(): string;
  nuiTestA11yClick(): void;
};

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

/** Print the few Form fields that say what the list is doing, tagged with the step. */
function trace(what: string, report: Record<string, string>): void {
  console.log(
    `FORM TRACE ${what}: ` +
      [
        'rows',
        'items',
        'inCells',
        'reparents',
        'reclaims',
        'applies',
        'alive',
        'placed',
        'screen',
        'offset',
        'recycles',
        'insetTop',
        'width',
        'boxW',
        'boxSpan',
        'boxMismatch',
      ]
        .map((key) => `${key}=${report[key] ?? '-'}`)
        .join(';')
  );
}

/** Fail loudly rather than reading a method off `undefined`. */
function need<T>(handle: T | undefined): T {
  if (handle == null)
    throw new Error('expected a hybridRef handle and there is none');
  return handle;
}

/**
 * Assert the Form holds these rows in this relative order, judged by the words inside each
 * row - the `order=` field of its report. Relative rather than absolute because the field is
 * the rows' own labels joined, and a label is whatever the aggregated text of a row is; the
 * claim this makes is only that one row sits after another, which is the claim a keyed
 * insert or reorder has to satisfy.
 */
function expectOrder(
  report: Record<string, string>,
  names: readonly string[]
): void {
  const order = report.order;
  if (order == null) throw new Error('the Form report has no "order=" field');
  const at = names.map((name) => order.indexOf(name));
  const missing = names.filter((_, index) => (at[index] ?? -1) < 0);
  if (missing.length > 0) {
    throw new Error(
      `the Form's order "${order}" does not name ${missing.join(', ')} - every row is named ` +
        'by the words inside it, so a row that answers to nothing is its own finding'
    );
  }
  for (let index = 1; index < names.length; index += 1) {
    const before = at[index - 1];
    const now = at[index];
    if (before == null || now == null || now <= before) {
      throw new Error(
        `the Form holds "${names[index]}" before "${names[index - 1]}" - its order is "${order}"`
      );
    }
  }
}

/**
 * How many items the list says it is drawing - the fourth number of `screen=`, with the number
 * of cells it has actually realised as the fifth.
 *
 * `inCells` counts the visible cells that hold a row; this counts the items the list has
 * realised. They are equal exactly when nothing on screen is a blank row, which is the claim
 * E1 now makes at every step: a row can be alive, counted, and in a section's model while the
 * cell drawing its item holds nothing, and no other field in the report says so.
 */
function visibleItems(report: Record<string, string>): number {
  const box = report.screen;
  if (box == null) throw new Error('the Form report has no "screen=" field');
  const value = Number(box.split(',')[3]);
  if (!Number.isFinite(value))
    throw new Error(`"screen=${box}" has no visible-item count`);
  return value;
}

/**
 * Wait until every item on screen is drawn from a cell that holds a row.
 *
 * iOS only: Android has no cells to come short of (`inCells` is the row count there, because a
 * row never leaves its Yoga box), and the report's `screen=` field is the collection view's.
 */
async function drawnOnScreen(step: string, which = 'form') {
  const report = await formReport(
    (r) => num(r, 'inCells') === visibleItems(r),
    `${step}: every item on screen drawn from a cell (inCells against the ` +
      'visible-item count; the last report below says which of the two moved)',
    which
  );
  trace(`drawn: ${step}`, report);
  return report;
}

async function formRef(): Promise<FormHandle> {
  return handleOf(() => forms.form, 'the Form');
}

/**
 * Wait until the Form is in the state a press is graded in, and hand back the report that said
 * so. iOS only.
 *
 * Five things have to be true before ten presses mean anything, and the Form — not a row
 * handle — answers every one of them. A handle is only a handle: a row view another case unmounted goes
 * on answering for itself, `where=holding`, at a frame nothing is drawing, while the Form on
 * screen has that row in a cell. The Form is also asked about *every* row on screen rather than
 * the two this case has handles for, which is the difference between a precondition and a hope.
 *
 * - `boxMismatch` — the worst gap anywhere on screen between a row's own box and the width
 *   React laid its content out at. A row laid out wider than its box has its right-hand content
 *   drawn past its bounds, and UIKit's hit-test stops at those bounds: a press there lands on
 *   the cell, React Native walks up from wherever the hit-test stopped and never reaches the
 *   `Pressable`, so the press counts nothing. Laid out *narrower* is not dangerous, only wrong —
 *   the content moves inward, where a finger still reaches it — but the witness is the absolute
 *   difference in either direction, because a Form that only looked for an excess would be green
 *   while a row was drawn 22 pt inside its own cell, and this case is about content being where
 *   it is drawn. It used to be non-zero on some row whatever the Form said: one list-wide width
 *   cannot match a plain row's box and its accessory row's narrower one side by side.
 * - `rowsInCells` against `rows` — every row this Form owns is sitting in a cell. A row left in
 *   its section's *holding view* is not drawn at all (that view is hidden), and its live view is
 *   still measurable, so a press aimed at it lands on whichever cell happens to be at those
 *   pixels: zero presses for a row that is wired perfectly (X29).
 * - `distinctDrawn` against `inCells` — no row is drawn by two cells, which is the other half of
 *   the count above: nine cells naming eight rows reads as a full list.
 * - `wrongCells` — every cell on screen is holding the row its own item names. Without this one
 *   the two counts above can disagree *silently*: a recycled cell can be on screen holding a
 *   perfectly live row that belongs to a different item, which reads as a full cell to every
 *   "does this cell hold a row?" question while the row its item owns draws nothing from its
 *   section's hidden holding view. That was X29: `rows` 9, `inCells` 9, `rowsInCells` 8, and a
 *   press delivered ten times at a row whose pixels were somewhere else.
 */
async function formReadyToPress(step: string): Promise<Record<string, string>> {
  return formReport(
    (report) =>
      num(report, 'boxMismatch') <= 0.5 &&
      num(report, 'rowsInCells') === num(report, 'rows') &&
      num(report, 'distinctDrawn') === num(report, 'inCells') &&
      num(report, 'claims') === 0 &&
      num(report, 'wrongCells') === 0,
    `every row drawn by exactly one cell, at its own box (${step}) - the report ` +
      'names rowsInCells, rows, distinctDrawn, inCells, claims, wrongCells and boxMismatch'
  );
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

/**
 * Wait until exactly one live view answers each testID, and return the counts as seen.
 *
 * `userEvent.press` names the view to press, not a screen coordinate: it takes the native view
 * the query answered with and delivers the tap at that view's centre in the window. So a second
 * live view with the same testID — the previous case's surface, on its way out — leaves the case
 * measuring whichever copy the query happened to answer with, which is a property of the query
 * and not of the Form.
 *
 * Waiting for one is a precondition, not a loosening: with two live copies there is no fact of
 * the matter about whether "a finger at the row content's drawn position reaches it". It is not
 * the reason E4 was red on one simulator and green on the other (X29: the row's cell had lost its
 * row to another cell, and the Form could not see that its own cell was blank) — that is what the
 * five counts in `formReadyToPress` are for.
 */
async function oneLiveViewPer(testIds: readonly string[]): Promise<string> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const seen = testIds.map(
      (id) => `${id}=${screen.queryAllByTestId(id).length}`
    );
    if (seen.every((entry) => entry.endsWith('=1'))) return seen.join(' ');
    if (Date.now() > deadline) {
      throw new Error(
        `a testID does not have exactly one live view: ${seen.join(' ')} - with two copies ` +
          'on screen a press is aimed at whichever one the query answered with, which is the ' +
          'previous case’s surface rather than this one'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * The Form's box for E1, short enough that its 646 pt of content is taller than the list.
 * Measured: at `flex: 1` on this device the list is 874 pt, so `nuiTestScrollTo` moved
 * nothing and no cell was ever given back - the cycles ran and proved nothing.
 */
const SHORT_BOX = { maxHeight: 420 } as const;

const LONG_TEXT =
  'Airplane mode turns off every radio at once, including Bluetooth, Wi-Fi and cellular.';

/** What `Probe` renders, and the counters a case reads back. */
type Mode = 'base' | 'inserted' | 'removed' | 'grown' | 'reordered';

/**
 * The first section's row order, per mode.
 *
 * Written as an order rather than five JSX children so that `reordered` is a *move* and not a
 * rebuild: every row keeps its key, so React asks Fabric to move the child, which is the path
 * a "pinned rows first" toggle takes. It is also what turns the order into an assertion - the
 * mode picks the order, and the case reads the Form's own list back.
 */
const FIRST_ROWS: Record<Mode, readonly string[]> = {
  base: ['wifi', 'bt', 'cell', 'pressable'],
  inserted: ['wifi', 'bt', 'hotspot', 'cell', 'pressable'],
  removed: ['wifi', 'bt', 'pressable'],
  grown: ['wifi', 'bt', 'cell', 'pressable'],
  reordered: ['cell', 'wifi', 'bt', 'pressable'],
};

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

type ProbeProps = ReturnType<typeof counters> & {
  mode: Mode;
  /**
   * Extra style for the probe's Form. E1 needs one: at full height the Form's list is
   * 874 pt and its content is 646 pt, so it cannot scroll a point and no cell is ever
   * recycled - the cycles below would exercise nothing while still counting as run.
   */
  formStyle?: StyleProp<ViewStyle>;
};

/**
 * The form under test: three sections, nine rows, a hosted Switch, a `Pressable`, and a
 * `Text` that wraps at the cell width. Nine = 4 + 3 + 2 in `base`; `inserted` makes ten and
 * `removed` eight, so a keyed change is a real insert or removal rather than a rebuild.
 */
function Probe({
  mode,
  log,
  formStyle,
  onRowPress,
  onPressablePress,
  onSwitchChange,
}: ProbeProps) {
  // The first section's rows, built here so the handlers above stay the fixture's own, and
  // keyed so `reordered` moves a row rather than rebuilding it. See {@link FIRST_ROWS}.
  const firstSectionRows: Record<string, ReactElement> = {
    wifi: (
      <Form.Row
        hybridRef={(view) => {
          if (view != null) rows.wifi = view;
        }}
        key="wifi"
        onPress={onRowPress}
      >
        <Text testID="label-wifi">Wi-Fi</Text>
      </Form.Row>
    ),
    bt: (
      <Form.Row
        accessory="disclosure"
        hybridRef={(view) => {
          if (view != null) rows.bt = view;
        }}
        key="bt"
        onPress={onRowPress}
      >
        <Text testID="label-bt">Bluetooth</Text>
      </Form.Row>
    ),
    hotspot: (
      <Form.Row key="hotspot" onPress={onRowPress}>
        <Text testID="label-hotspot">Personal hotspot</Text>
      </Form.Row>
    ),
    cell: (
      <Form.Row key="cell" onPress={onRowPress}>
        <Text testID="label-cell">Cellular data</Text>
      </Form.Row>
    ),
    pressable: (
      <Form.Row
        hybridRef={(view) => {
          if (view != null) rows.pressable = view;
        }}
        key="pressable"
      >
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
    ),
  };
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.form = view;
      }}
      style={[styles.form, formStyle]}
    >
      <Form.Section
        footer="These settings apply to this device only."
        hybridRef={(view) => {
          if (view != null) sections.first = view;
        }}
        title="Connectivity"
      >
        {FIRST_ROWS[mode].map((key) => firstSectionRows[key])}
      </Form.Section>
      <Form.Section
        hybridRef={(view) => {
          if (view != null) sections.second = view;
        }}
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
        <Form.Row
          key="silent"
          hybridRef={(view) => {
            if (view != null) rows.silent = view;
          }}
        >
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
    <Form
      hybridRef={(view) => {
        if (view != null) forms.cost = view;
      }}
      style={styles.form}
    >
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

/** A press that asks for nothing, so no case mounts an inline closure as a native callback. */
function pressNow(): void {
  // The harness counts what it likes; this row's `onPress` exists to make the row pressable.
}

/**
 * One titled, pressable row - for the cases that care about what a *previous* mount left on a
 * recycled view.
 *
 * React Native hands the next mount the same section and row views (`setupViewRecycling`, the
 * F6 gate), so anything the first mount did not take back off them is the second mount's
 * problem: a disposed Compose layer is a section that draws nothing, and a `contentDescription`
 * React Native did not clear is a row announced under a name its own app never gave it. Both
 * were found by mounting this twice.
 */
function OneRow({
  title,
  label,
  styled,
  rowKey = 'single',
}: {
  title: string | null;
  label: string | null;
  /** `false` leaves the `Form` with no `style` at all - the README's `<Form>`. */
  styled: boolean;
  /**
   * Swapping it asks Fabric for another row instance *in the same surface*, which is the
   * drop-and-create pair RN's pool turns into a hand-back (F6's `oneSwitch`). A fresh
   * `render` is a fresh surface, and the pool is per surface, so it is not the way to get a
   * recycled view.
   */
  rowKey?: string;
}) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.one = view;
      }}
      onLayout={(event) => {
        formBox.height = event.nativeEvent.layout.height;
      }}
      style={styled ? styles.form : undefined}
    >
      <Form.Section
        hybridRef={(view) => {
          if (view != null) sections.one = view;
        }}
        title={title}
      >
        <Form.Row
          key={rowKey}
          accessibilityLabel={label ?? undefined}
          hybridRef={(view) => {
            if (view != null) rows.one = view;
          }}
          onPress={pressNow}
        >
          <Text testID="one-row">One row</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

/** What the last `OneRow` Form reported for its own box. */
const formBox = { height: Number.NaN };

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
  // Forget every handle the previous case left behind before mounting. A `hybridRef`
  // cleanup from a case that has already ended can arrive after this render, and a report
  // read from the dying Form says "nine rows, all in cells" once and then never again -
  // which is how E1 came to assert against a Form that had already been dropped.
  for (const map of [forms, sections, rows]) {
    for (const key of Object.keys(map)) delete map[key];
  }
  const { rerender } = await render(<Probe {...props} />);
  await formRef();
  await boxOf('label-wifi');
  // The `rerender` rides along so a case can keep working in *this* surface. A second
  // `mount` is a second surface, in which every row mounts in document order - which for
  // E1 would mean an insert always landing where React put it, by accident.
  return Object.assign(props, { rerender });
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

describe('Form (G24)', () => {
  afterEach(() => {
    cleanup();
    forgetPromisedHandles();
    // `measured` too: a ref callback that only ever stores (`if (handle != null)`) leaves a
    // case able to measure a view the previous case unmounted, and a dead view answers
    // `measureInWindow` with its right size at (0, 0) - the exact shape of a row the shadow
    // tree has misplaced (fix round 1).
    for (const map of [forms, sections, rows, measured]) {
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
    // One surface for the whole case, and every step a `rerender` of it. A second `render`
    // would be a new surface mounting all ten rows in document order, where the index the
    // holding view reports happens to be the one React used - so the case below would pass
    // without ever asking the question (fix round 1).
    const probe = await mount({
      mode: 'base',
      formStyle: SHORT_BOX,
      ...counters(),
    });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    trace('base', parse(need(forms.form).nuiTestFormReport()));

    const { rerender } = probe;

    if (IOS) {
      // The state the insert is going to happen in: every row of the section is drawn from a
      // cell, so none of them is in the holding view any more, and that is the only state in
      // which the holding view's own subview count can disagree with the index React used.
      // Asking for it here is what stops the order assertion below passing because nothing had
      // been adopted yet - scrolling first does the opposite (a scroll hands rows *back*), so
      // this reads the list at rest.
      // Some of the section's rows, not all of them: at this box a screen holds six of the
      // nine, and the state the insert needs is "rows have left the holding view for
      // cells", which is what makes the holding view's own count the wrong answer.
      const resting = await formReport(
        (r) => num(r, 'inCells') > 1,
        'rows to be drawn from cells before the insert'
      );
      trace('at rest', resting);
      expect(num(resting, 'inCells')).toBeGreaterThan(1);
      await drawnOnScreen('at rest');
    }

    // A keyed insert in the middle of the first section, in this same surface.
    await rerender(
      <Probe mode="inserted" formStyle={SHORT_BOX} {...counters()} />
    );
    await formReport((r) => num(r, 'rows') === 10, 'ten rows after the insert');
    trace('inserted', parse(need(forms.form).nuiTestFormReport()));
    await boxOf('label-hotspot');
    expect(parse(need(forms.form).nuiTestFormReport()).orphans).toBe('0');

    if (IOS) {
      // ...and the insert landed *third*, which is where React put it. A count of ten says a
      // row arrived; this says where. The index the Form was handed used to be the holding
      // view's position among the subviews still in it, and by the time a third row has been
      // shown that is 0 - so a keyed insert jumped to the front of the section.
      expectOrder(parse(need(forms.form).nuiTestFormReport()), [
        'Wi-Fi',
        'Bluetooth',
        'Personal hotspot',
        'Cellular data',
      ]);
      // Ten rows is a count; this is the screen. Fix round 1's logs show this step at
      // `inCells=3` with 5 items on screen: two rows drawn as nothing, and every counter in
      // the report content with the step.
      await drawnOnScreen('after the insert');
    }

    await rerender(
      <Probe mode="removed" formStyle={SHORT_BOX} {...counters()} />
    );
    await formReport(
      (r) => num(r, 'rows') === 8,
      'eight rows after the removal'
    );
    trace('removed', parse(need(forms.form).nuiTestFormReport()));
    if (IOS) {
      // The same field, asked *after* a removal rather than at first mount. `stale` is a row
      // view sitting in a section's holding view that this Form never agreed to hold: on a
      // clean mount it is 0 by definition, and it is after a removal - when a cell hands back
      // a row another cell has already adopted - that it can become a row drawn in one place
      // and mounted in another.
      expect(parse(need(forms.form).nuiTestFormReport()).stale).toBe('0');
      await drawnOnScreen('after the removal');
    }

    // A keyed reorder: the same four rows, `cell` moved from third to first, every key
    // intact - so React moves the child instead of rebuilding it, which is the path a
    // "pinned rows first" toggle takes and the one the Form's index used to lose.
    await rerender(
      <Probe mode="reordered" formStyle={SHORT_BOX} {...counters()} />
    );
    const reordered = await formReport(
      (r) => num(r, 'rows') === 9,
      'nine rows after the reorder'
    );
    trace('reordered', reordered);
    expect(reordered.orphans).toBe('0');
    if (IOS) {
      expectOrder(reordered, [
        'Cellular data',
        'Wi-Fi',
        'Bluetooth',
        'Ring on receipt',
      ]);
      // The order is right and two of the five rows on screen are blank: the first is what
      // the index fix proved, this is what the *screen* says after a move.
      await drawnOnScreen('after the reorder');
    }
    if (!IOS) {
      // Question 2 again: the layer follows the new order. The count is still four - a
      // reorder moves a row, it does not remove one - so what this can say is that the
      // section recounted rather than keeping the mount that ended (fix round 1: this read
      // `3`, which is the count from the removal two steps above, not the one here).
      const section = await reportUntil(
        () => sections.first?.nuiTestSectionReport(),
        (r) => r.shapes != null,
        'the first section to recount its shapes'
      );
      expect(num(section, 'shapes')).toBe(4);
    }

    await rerender(<Probe mode="base" formStyle={SHORT_BOX} {...counters()} />);
    const settled = await formReport(
      (r) => num(r, 'rows') === 9,
      'nine rows again'
    );
    expect(settled.orphans).toBe('0');

    // The leak probe is growth across the cycles, not equality with the row count: a row
    // React has thrown away can still be alive in Fabric's own component-view pool, and
    // that is RN's retention, not the list's.
    const beforeCycles = parse(need(forms.form).nuiTestFormReport());
    trace('before the cycles', beforeCycles);
    // 50 scroll-through cycles: cells are reused, so rows move in and out of them.
    for (let cycle = 0; cycle < 50; cycle += 1) {
      need(forms.form).nuiTestScrollTo(cycle % 2 === 0 ? 400 : 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    need(forms.form).nuiTestScrollTo(0);
    const after = parse(need(forms.form).nuiTestFormReport());
    trace('after the cycles', after);
    expect(after.orphans).toBe('0');
    expect(num(after, 'rows')).toBe(9);
    // Nothing was left behind by the churn or by 50 cycles of cell reuse.
    expect(num(after, 'alive')).toBe(num(beforeCycles, 'alive'));
    if (IOS) {
      // The cycles have to have moved the list, or they exercised nothing: the box is
      // 420 pt and its content 646 pt, so 400 is reachable and `offset` is the proof.
      // Asked for explicitly, because the loop above was measured reading `offset=-62` the
      // whole way through - 50 `nuiTestScrollTo` calls with nothing waiting for them leave
      // the list where UIKit settled it, and every counter beside it describes a list that
      // never moved (fix round 1).
      need(forms.form).nuiTestScrollTo(400);
      const scrolled = await formReport(
        (r) => num(r, 'offset') > 100,
        'the Form to scroll for the cycles'
      );
      trace('scrolled for the cycles', scrolled);
      expect(num(scrolled, 'offset')).toBeGreaterThan(100);
      // 0 of 4 items drawn at offset 400 in fix round 1's log, with `reparents` 103 and
      // `reclaims` 100 behind it: every give-back landed and no re-adopt followed it.
      await drawnOnScreen('at offset 400');
      // Cells really did take rows, and really did hand them back, once the list moved:
      // measured across the scroll, `reparents` 4 -> 103 and `reclaims` 0 -> 100. The two
      // are not compared with each other: UIKit keeps a cell across a snapshot apply, so a
      // row can be given back and re-adopted without the provider running again.
      expect(num(scrolled, 'reparents')).toBeGreaterThan(
        num(after, 'reparents')
      );
      expect(num(scrolled, 'reclaims')).toBeGreaterThan(0);
      need(forms.form).nuiTestScrollTo(0);
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
    await probe.rerender(<Probe {...probe} mode="grown" />);
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

  it('aims a row content at its Yoga origin and presses it on both platforms (E4)', async () => {
    const probe = await mount({ mode: 'base', ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    const pressable = await boxOf('inner-press');
    const toggle = await boxOf('switch-silent');

    console.log(
      `FORM TAP boxes pressable=${describeBox(pressable)} switch=${describeBox(toggle)}`
    );
    if (IOS) {
      // Everything the ten presses below are graded on is waited for here, and of the Form
      // rather than of `rows.pressable`/`rows.silent`: a handle is only a handle, and a row
      // view that another case unmounted answers for itself forever (it reports
      // `where=holding` for as long as you ask, whether or not the Form on screen has that row
      // in a cell). What the case needs is the Form's own account of every row it is drawing —
      // drawn, once each, by a cell that holds it, at the box that cell gives it. Without that,
      // the press count below is a property of the list's state at the moment of the aim.
      await drawnOnScreen('before the presses');
      const geometry = await formReadyToPress('before the presses');
      const live = await oneLiveViewPer(['inner-press', 'switch-silent']);
      // Re-aim from the certified tree: a press names a view, never a place. The JavaScript side
      // sends (0, 0) beside the `nativeId` the query answered with (`@react-native-harness/ui`'s
      // `userEvent.ts:80`), the native side substitutes the centre of the view the registry holds
      // under that id (`HarnessUI.mm:248`) and hit-tests *that* — and the rejection it prints
      // formats the *arguments*, so a rejected press reads `No view found at point (0.00, 0.00)`
      // whatever the point was (`HarnessUI.mm:277`). Handles taken before the waits above answer
      // for wherever their views ended up: a row at rest in a section's holding view keeps the
      // absolute position its cell would have had (`NitroUiFormViews.swift:18-23`), and a settle
      // moves rows through that state. Pressed then, the aim lands on a neighbour and every
      // counter below stays at zero, or it lands outside the window's bounds and `hitTest:`
      // answers nil — the two texts pair-b produced from one tree, 35 minutes apart (X29). A
      // fresh query cannot name the row that has left: E6's `f49` is `Unable to find element`, not
      // a press.
      const aim = {
        pressable: await boxOf('inner-press'),
        toggle: await boxOf('switch-silent'),
      };
      // Print them before grading them: when one of them stops holding, the numbers say
      // which, and a press count on its own says only "something was wrong".
      console.log(
        `FORM TAP geometry rows=${geometry.rows} rowsInCells=${geometry.rowsInCells} ` +
          `inCells=${geometry.inCells} distinct=${geometry.distinctDrawn} ` +
          `claims=${geometry.claims} wrong=${geometry.wrongCells} ` +
          `losses=${geometry.losses} ` +
          `mismatch=${geometry.boxMismatch} boxSpan=${geometry.boxSpan} ` +
          `width=${geometry.width} boxW=${geometry.boxW} live=${live}`
      );
      // Asserted rather than only waited for, so that a Form which stops reaching this state
      // fails by name. A row counted twice (`distinctDrawn` short of `inCells`) and a row in no
      // cell at all (`rowsInCells` short of `rows`) are the same mix-up seen from the two ends;
      // a cell `claims` a row it is not holding is the reason the Form could not see either.
      expect(Number(geometry.rowsInCells)).toBe(Number(geometry.rows));
      expect(Number(geometry.distinctDrawn)).toBe(Number(geometry.inCells));
      expect(Number(geometry.claims)).toBe(0);
      expect(Number(geometry.wrongCells)).toBe(0);
      // The box wait is only worth anything because the rows on this screen do *not* share a
      // box: `boxSpan` is the widest row box minus the narrowest, and a Form whose rows were all
      // the same width would satisfy `boxMismatch` 0 with one list-wide number — which is the
      // code that was wrong. It is asserted rather than remembered from a measurement so that a
      // future iOS that stops reserving the accessory's room fails here instead of quietly
      // turning this case into one that proves nothing.
      expect(Number(geometry.boxSpan)).toBeGreaterThan(0);
      // Question 4, the half that is not a finger, and it splits by who hit-tests the touch.
      // A press lands on whichever UIView UIKit says owns the point, and a row drawn from its
      // cell owns the points inside itself: React Native walks *up* the view tree from wherever
      // that stopped until it finds a view that can emit a touch, so a `Pressable` in a row
      // answers here just as it does on Android — ten of ten, which is what `testRealInputForm`
      // counts with real fingers (D45) and what Android has always counted. It stopped answering
      // for the point in one row for two reasons, and the wait above is what keeps this case out
      // of both (X29): a row laid out *wider* than its own box has that content drawn past the
      // bounds UIKit will hit-test, and a row that is not in a cell at all is drawn nowhere —
      // the tap then lands on whatever cell owns those pixels, and the row's own content counts
      // nothing. A hosted control takes all ten for a third reason: it is a native control, and
      // it answers for its own point without React Native in the path at all.
      for (let index = 0; index < 10; index += 1) {
        await userEvent.press(aim.pressable);
        await userEvent.press(aim.toggle);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(probe.log.pressable).toBe(10);
      expect(probe.log.switches).toBe(10);
      // The positive control: the very same two callbacks, outside any Form, where React
      // Native's hit-test has its content where it is drawn. Both counters are the ones the
      // loop above just drove ten times, so this is graded as a delta.
      const loose = {
        pressable: probe.log.pressable,
        switches: probe.log.switches,
      };
      cleanup();
      render(
        <Loose
          onPressablePress={probe.onPressablePress}
          onSwitchChange={probe.onSwitchChange}
        />
      );
      // The same for the positive control: `cleanup()` is still on its way out when this render
      // lands, so until the pair is the only live copy of itself the query can answer with the
      // copy that is going away — an aim whose view leaves with it is pressed at wherever its last
      // frame was, which is the pair of texts above rather than a control.
      await oneLiveViewPer(['loose-press', 'loose-switch']);
      await userEvent.press(await boxOf('loose-press'));
      await userEvent.press(await boxOf('loose-switch'));
      expect(probe.log.pressable - loose.pressable).toBe(1);
      expect(probe.log.switches - loose.switches).toBe(1);
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
        `FORM COST N=${count} form=${native}ms plain=${plain}ms ${raw(report, 'applies')}`
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

  it('composes a recycled Section, and drops the band of a gone title', async () => {
    // The mount -> unmount -> mount cycle React Native's view pool makes real.
    const first = await render(
      <OneRow label="Named" styled={true} title="First" />
    );
    await reportUntil(
      () => sections.one?.nuiTestSectionReport(),
      (r) => Number(r.rows) === 1,
      'the first section to hold its row'
    );
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 150));

    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
    const again = await render(
      <OneRow label="Named" styled={true} title="Second" />
    );
    const second = await reportUntil(
      () => sections.one?.nuiTestSectionReport(),
      // `layerH` is what the Compose layer was last measured at and `boxH` the section's own
      // height. Equal is the whole claim that the layer came back: a section whose composition
      // was dropped *with its view* - which is what `onDropView` used to do, one turn before
      // React Native put the view in the pool - reports a box and no layer at all, and draws
      // its rows over the page background forever. iOS has no Compose layer to lose, so the
      // case asks it only for the rows.
      (r) =>
        Number(r.rows) === 1 &&
        (IOS || Math.abs(num(r, 'layerH') - num(r, 'boxH')) < 1),
      'the recycled section to draw its layer again'
    );
    if (!IOS) {
      expect(num(second, 'headerBand')).toBeGreaterThan(0);
    }
    if (IOS) {
      // Before believing anything the section says about what its Form drew, ask whether the
      // Form it answers to is the one that holds it. A recycled Section that kept the Form of
      // the mount that ended would read a heading out of a list nobody is looking at.
      expect(second.form).toBe('held');
      // The other half of the same recycled section: a *changed* title string. The section's
      // identity is its model and the model did not change, so the snapshot the Section applies
      // is a no-op and UIKit never runs the provider that fills the band in — the old heading
      // stays painted, at the old height. `drawnTitle` is what the band is painted with, the
      // only field here that separates a title the Form stored from one it drew (fix round 1).
      const redrawn = await reportUntil(
        () => sections.one?.nuiTestSectionReport(),
        // Asked as a wait because the promise is about where the screen ends up: a band
        // re-painted one turn after the snapshot is still a band that says what its model
        // says. What must not happen is that it goes on saying "First" forever.
        (r) => r.drawnTitle === 'Second',
        'the recycled band to be painted with the new title'
      );
      expect(redrawn.drawnTitle).toBe('Second');
    }

    // A title that goes to null leaves nothing behind to measure, and Android reported the band
    // from the heading's own `onSizeChanged` - which stops running the moment the `Text` is
    // gone. Without a second path the height of a heading that no longer exists stays reserved
    // in the layout forever, so a section keeps a blank band where its title used to be.
    await again.rerender(<OneRow label="Named" styled={true} title={null} />);
    if (!IOS) {
      const untitled = await reportUntil(
        () => sections.one?.nuiTestSectionReport(),
        (r) => r.headerBand != null && num(r, 'headerBand') === 0,
        'the gone title to give its band back'
      );
      expect(num(untitled, 'headerBand')).toBe(0);
    }
    if (IOS) {
      await reportUntil(
        () => sections.one?.nuiTestSectionReport(),
        (r) => r.drawnTitle === '',
        'the gone title to come off the band'
      );
    }
  });

  it('presses a row from the accessibility path and names it for its own mount', async () => {
    const { rerender } = await render(
      <OneRow label="Named row" styled={true} title="A" rowKey="labelled" />
    );
    const named = await reportUntil(
      () => rows.one?.nuiTestRowReport(),
      (r) => r.desc != null,
      'the row to carry its label'
    );
    if (!IOS) expect(named.desc).toBe('Named row');

    // Unmount this row and let a row with no label arrive - the shape that leaves a recycled
    // `ReactViewGroup` answering for a mount that ended, because React Native's
    // `prepareToRecycleView` clears its own tag and not the framework's name. It has to be a
    // *key swap in this surface*: the pool RN keeps is per surface, so a second `render` would
    // be handed a brand-new view and could not carry a name over.
    //
    // What this case guards is `recycles >= 1` and the promise that a fresh row carries no
    // name; the row's own a11y reset (`resetRow`) is NOT proven by it. With the reset commented
    // out and the APK verified rebuilt, `desc` still came back empty, so that reset is defence
    // in depth (fix round 1's red proof says so). The upstream bug's reproducer is the plain
    // labelled `<View>` on the Form screen, which the a11y sweep grades.
    await rerender(
      <OneRow label={null} styled={true} title="B" rowKey="plain" />
    );
    const plain = await reportUntil(
      () => rows.one?.nuiTestRowReport(),
      (r) => r.where != null && r.desc != null,
      'the second row to be laid out'
    );
    if (!IOS) {
      // The seam has to be able to see the bug at all. Only an instance the pool handed back
      // can carry the previous mount's name, and `recycles=` is the one number that says this
      // view was reused rather than built (F6's reason for counting it per object).
      expect(num(plain, 'recycles')).toBeGreaterThanOrEqual(1);
      expect(plain.desc).toBe('-');
      // The other half of the promise: a row that is one clickable element to TalkBack has to
      // answer the action the framework offers. `isClickable` only *offers* it - the press came
      // from `dispatchTouchEvent`, which a screen reader never sends.
      const before = num(plain, 'presses');
      need(rows.one).nuiTestA11yClick();
      await reportUntil(
        () => rows.one?.nuiTestRowReport(),
        (r) => num(r, 'presses') === before + 1,
        '`ACTION_CLICK` to reach `onPress`'
      );
    }
  });

  it('has a height when the app gave it no style at all', async () => {
    // Every iOS section is `position: 'absolute'` inside the Form, so before the base style an
    // unstyled `<Form>` had nothing in flow and was 0 pt tall: the README, `form.md` and
    // `readme-examples.tsx` snippets all drew nothing at all.
    formBox.height = Number.NaN;
    await render(<OneRow label={null} styled={false} title="Unstyled" />);
    const deadline = Date.now() + 8000;
    for (;;) {
      if (formBox.height > 0) break;
      if (Date.now() > deadline) {
        throw new Error(
          `an unstyled Form measured height ${String(formBox.height)} - it takes no space, so ` +
            'its rows cannot be seen'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(formBox.height).toBeGreaterThan(0);
  });

  it('reports a settle that no drag announced', async () => {
    // The delegate had a `scrollViewDidLayout`, which is not a `UIScrollViewDelegate` method,
    // so nothing ran it: a settle that was not a drag ending was reported only by the one hop
    // a snapshot apply queues. Move the content from inside the library *without* reporting it
    // and the shadow tree is left with the offset from before the move - the same 72 pt class
    // of wrong that E7 measures, reached by a different door.
    render(<MeasureForm />);
    const form = await handleOf(() => forms.measure, 'the measuring Form');
    await formReport(
      (r) => num(r, 'rows') === MEASURE_ROWS,
      `${MEASURE_ROWS} rows`,
      'measure'
    );
    // Let UIKit place a page of rows before comparing. A row still sitting in its section's
    // holding view has no pixels to compare and is skipped, and on a loaded machine the list
    // has not necessarily realised its cells by the turn the rows report their count - which
    // made the number of comparisons below a race rather than a measurement.
    await formReport(
      (r) => num(r, 'inCells') >= 10,
      'ten rows to be drawn from cells',
      'measure'
    );
    if (IOS) {
      const atRest = await formReport(
        (r) => r.origin !== undefined,
        'the Form to have published an offset',
        'measure'
      );
      expect(num(atRest, 'origin')).toBeCloseTo(num(atRest, 'offset'), 0);
      form.nuiTestCommand('scroll-no-report');
      const moved = await formReport(
        (r) => num(r, 'offset') > num(atRest, 'offset') + 20,
        'the list to have scrolled',
        'measure'
      );
      await formReport(
        (r) => Math.abs(num(r, 'origin') - num(moved, 'offset')) < 0.5,
        'the shadow tree to be told the offset the list is at',
        // This case mounted `MeasureForm`, whose handle is `forms.measure`. Reading the
        // default `form` here asked a Form that was never mounted to report.
        'measure'
      );
    }
  });

  it('starts a recycled Form at the top of its own content', async () => {
    // A `UICollectionView` keeps its `contentOffset` when its view goes back to React
    // Native's pool, and the Form mounted into it inherits that scroll. This is not
    // hypothetical: E7's at-rest reading of `offset=-2` against a 62 pt top inset is the
    // `+60` the settle case above moves the list by, arriving in a Form that case never
    // scrolled (fix round 2, item 2).
    //
    // Ending the surface and mounting another is the shape React Native really recycles, and
    // `recycles=` on the new Form's report is the witness. A key swap inside one surface is
    // not that shape, which an earlier draft of this case assumed: measured on this tree, the
    // swap leaves `recycles`, `alive` and `applies` exactly where they were — Fabric keeps the
    // same subtree, so nothing is being mounted and there is no new mount to reset.
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    need(forms.form).nuiTestScrollTo(200);
    // Each platform reports its scroller under its own field: iOS publishes the list's real
    // `contentOffset` as `offset`, while Android's report answers that question with `scroll`
    // and keeps `offset=0.00` as a placeholder, because its rows are measured through the
    // shadow tree instead (S6b). Asking one platform the other's question is how this case
    // first went red on Android.
    const offsetField = IOS ? 'offset' : 'scroll';
    const scrolled = await formReport(
      (r) => num(r, offsetField) > 100,
      'the list to have scrolled before the recycle'
    );
    trace('scrolled before the recycle', scrolled);
    {
      // `recycles` is iOS's witness that a view came back out of the pool; Android's Form
      // report has no such field, so on Android the mount itself is the witness.
      const recycled = IOS ? num(scrolled, 'recycles') : 0;
      cleanup();
      // The pool gets the view when the surface is really gone, not when React says so.
      await new Promise((resolve) => setTimeout(resolve, 150));
      forgetPromisedHandles();
      for (const map of [forms, sections, rows]) {
        for (const key of Object.keys(map)) delete map[key];
      }
      await render(<Probe mode="base" formStyle={SHORT_BOX} {...counters()} />);
      await formRef();
      await boxOf('label-wifi');
      const next = await formReport(
        // `recycles` is iOS's witness that a view came back out of the pool; Android's report
        // has no such field, so there the mount itself is the witness.
        (r) =>
          num(r, 'rows') === 9 && (!IOS || num(r, 'recycles') >= recycled + 1),
        'a Form mounted into the list the case above left scrolled (`recycles` to move)'
      );
      trace('the recycled Form', next);
      // The top of the content is wherever the list's own inset says it is, so this is one
      // number rather than a constant. Android's scroller has no content inset at all, so its
      // top is 0.
      const top = IOS ? num(next, 'insetTop') : 0;
      if (IOS) expect(top).toBeGreaterThan(0);
      expect(Math.abs(num(next, offsetField) + top)).toBeLessThanOrEqual(1);
    }
  });

  it('publishes a settle for a scroll it started, not a frame', async () => {
    // The keyboard path's `setContentOffset(animated: true)`, and a status-bar scroll to the
    // top, set none of `isDragging`, `isTracking` or `isDecelerating`, so every frame of them
    // walked past the delegate's guard and into `onContentOffset` - a re-render of the Form and
    // its sections per frame of an animation nobody flicked (fix round 2, item 3).
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    if (!IOS) {
      // `offsetPublishes` counts publishes from UIKit's delegate, and Android's Form has
      // neither the delegate nor the field: its scroller is React Native's own `ScrollView`,
      // which does this work in `onScroll`. The case is iOS-only, so it says so before it
      // asks for a number Android's report does not have.
      return;
    }
    const atRest = await formReport(
      (r) => num(r, 'rows') === 9 && num(r, 'offsetPublishes') >= 1,
      'nine rows and a published offset'
    );
    const before = num(atRest, 'offsetPublishes');
    const target = num(atRest, 'offset') + 60;
    need(forms.form).nuiTestCommand('scroll-animated');
    // The offset is not the settle. `setContentOffset` writes the model value before UIKit
    // has drawn a frame of the animation, so an offset at the target only says the scroll
    // started; the settle is the publish, and that is what has to be waited for.
    await formReport(
      (r) =>
        Math.abs(num(r, 'offset') - target) <= 1 &&
        num(r, 'offsetPublishes') >= before + 1,
      `the Form to have published the settle at ${String(target)} pt (` +
        `offsetPublishes was ${String(before)})`
    );
    // A beat longer than the animation, so the ceiling below counts a scroll that is over:
    // read mid-flight, even an unguarded one looks quiet.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = parse(need(forms.form).nuiTestFormReport());
    const published = num(settled, 'offsetPublishes') - before;
    console.log(
      `FORM ANIMATED SCROLL: publishes=${String(published)} offset=${String(
        atRest.offset
      )} -> ${String(settled.offset)}`
    );
    // One for the settle it came to rest at, and room for the inset change that came with it.
    // The floor matters as much as the ceiling: a Form that publishes nothing is quiet too.
    expect(published).toBeGreaterThanOrEqual(1);
    expect(published).toBeLessThanOrEqual(2);
  });

  it('grows a row when UIKit is not watching its height constraint (E3, iOS 15)', async () => {
    // `selfSizingInvalidation` is iOS 16 and later. Below it - and in a list the
    // `self-sizing-off` command has just switched off - the only thing that can tell the layout
    // a row's height constraint moved is the `rowResized` fallback, which asks for one
    // invalidation. Without it a row that grew was drawn at its old height forever (fix round 2,
    // item 4), and no test on this host could see that, because every simulator here is modern.
    const probe = await mount({ mode: 'base', ...counters() });
    const settled = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    if (!IOS) return;
    expect(num(settled, 'selfSizing')).toBe(1);
    const items = (settled.heights ?? '').split(',').map(Number);
    const short = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > 0,
      'the wrapped row to have a height'
    );
    need(forms.form).nuiTestCommand('self-sizing-off');
    await formReport(
      (r) => num(r, 'selfSizing') === 0,
      'the list to stop watching row height constraints'
    );

    await probe.rerender(<Probe {...probe} mode="grown" />);
    const grown = await formReport(
      (r) =>
        Math.abs(Number((r.heights ?? 'x,').split(',')[3]) - nth(items, 3)) > 4,
      'the grown row to be taller in the layout with no self-sizing to do it',
      'form'
    );
    const grownItems = (grown.heights ?? '').split(',').map(Number);
    // The neighbours did not move, either: one invalidation re-asks the layout, it does not
    // rebuild the section at a different pitch.
    expect(Math.abs(nth(grownItems, 0) - nth(items, 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(nth(grownItems, 1) - nth(items, 1))).toBeLessThanOrEqual(1);
    const tall = await reportUntil(
      () => rows.pressable?.nuiTestRowReport(),
      (r) => Number(r.h) > num(short, 'h') + 4,
      'the wrapped row to have grown'
    );
    // The same delta as at rest - the cell followed the row, which is the whole claim, reached
    // by the fallback rather than by UIKit noticing on its own.
    const chrome = nth(items, 3) - num(short, 'h');
    expect(
      Math.abs(nth(grownItems, 3) - num(tall, 'h') - chrome)
    ).toBeLessThanOrEqual(1);
  });

  it('leaves the window with the app still running', async () => {
    // UIKit scrolls a scroll view *on its way out of the window*: removing one shifts its own
    // `contentOffset`, and `scrollViewDidScroll` fires for that shift. By then the JS function
    // behind a section's placement callback can already be gone, and calling into a callback
    // that has been torn down is fatal, not a no-op. The shape this took was not a failing
    // assertion but the next test suite in the same app refusing to start - "the app bridge
    // disconnected" - so the proof here is that the app answers afterwards (fix round 1).
    // `Probe`, not E7's `MeasureForm`: mounting a second Form with the same row test ids as
    // the case that runs after it is how that case came to measure a dead view.
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    const resting = await formReport((r) => num(r, 'rows') === 9, 'nine rows');
    need(forms.form).nuiTestScrollTo(400);
    await formReport(
      // The claim is "scrolled", not "scrolled past 100": `SHORT_BOX` gives a 9-row Form
      // about 84 dp of travel, so a fixed 100 is unreachable on Android however well the
      // scroll works. Each platform publishes one of the two numbers — iOS moves the list's
      // own `offset`, Android's scroll view updates `scroll` — so the case compares both
      // against the reading taken before `nuiTestScrollTo`, and asks for 20 dp of movement
      // out of either (fix round 1: this waited for a number that only iOS can reach).
      (r) =>
        num(r, 'offset') > num(resting, 'offset') + 20 ||
        num(r, 'scroll') > num(resting, 'scroll') + 20,
      'the list to have scrolled before it goes'
    );
    // The screen goes away with the list scrolled: the moment UIKit moves the list out on
    // its own.
    delete forms.one;
    delete rows.one;
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 250));

    // A fresh Form has to answer. If the app died with the previous surface, this never does.
    render(<OneRow label="Alive" styled={true} title="After" />);
    const alive = await reportUntil(
      () => rows.one?.nuiTestRowReport(),
      (r) => r.where != null,
      'the app to still answer after a scrolled Form left the window'
    );
    expect(alive.where).toBeDefined();
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
    <Form
      hybridRef={(view) => {
        if (view != null) forms.measure = view;
      }}
      style={styles.form}
    >
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
  // The two constants and the two offsets the comparison is built from, so a mismatch says
  // which number moved rather than leaving the arithmetic to be reconstructed from points.
  const geometry = need(forms.measure).nuiTestFormReport();
  console.log(
    `S6b MEASURE ${what}: compared=${compared} scroll=${round1(scrolledBy)} ` +
      `mismatched=${bad.length} geometry{${[
        'offset',
        'origin',
        'received',
        'listY',
        'insetTop',
      ]
        .map((key) => `${key}=${raw(parse(geometry), key)}`)
        .join(',')}}` +
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

describe('Form measure (E7)', () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(measured)) delete measured[key];
  });

  it('measures a row as the row, before and after a scroll (E7)', async () => {
    await render(<MeasureForm />);
    const form = await handleOf(() => forms.measure, 'the measuring Form');
    await formReport(
      (r) => num(r, 'rows') === MEASURE_ROWS,
      `${MEASURE_ROWS} rows`,
      'measure'
    );
    // Every row has to have registered the view this case measures, or the first comparison
    // below reads a box from a mount that has already ended (fix round 1: m0 came back
    // 338x44 at (0, 0), which is a dead view's answer, not a misplaced row's).
    const registered = await until(
      async () => Object.keys(measured).length,
      (n) => n >= MEASURE_ROWS,
      8000,
      `${MEASURE_ROWS} measured views to be registered`
    );
    expect(registered).toBe(MEASURE_ROWS);

    // At rest. Android is the control here: its rows never leave Yoga's box, so both trees
    // have always agreed and a case that cannot see the difference is not worth running.
    // Polled for the same reason the pass below is: a row answers with the frame Fabric last
    // wrote it, and the frames arrive per view. Mounting 24 rows behind one heading re-lays
    // the section out once the heading's band has been measured, and a comparison that reads
    // m3 and m8 mid-that pass sees the frame from before it (fix round 1: `m3 ... vs UIKit
    // 12.2,37.3` and `m8 ... vs UIKit 12.2,0.0`, in a pass where twelve of fourteen rows
    // agreed). Nothing is loosened here — the verdict is still "no row disagrees" — this just
    // gives the layout the same chance to settle the scrolled pass has always had.
    const atRest = await until(
      () => compareRows('at rest', 0),
      (r) => r.bad.length === 0 && r.compared >= 10,
      12000,
      'every row to measure where its own tree put it'
    );
    expect(atRest.bad).toEqual([]);
    // The floor is the go line, ten comparisons, and it is reachable: this Form is `flex: 1`
    // in an 874 pt window, its rows are 52 pt, and the pass is capped at `COMPARE_LIMIT` (14)
    // - every green run in the ledger logs `compared=14` at rest. An earlier draft called eight
    // the ceiling, which counted a screenful of rows on a box this case does not use.
    expect(atRest.compared).toBeGreaterThanOrEqual(10);

    // Scrolled. On iOS this is the whole point: the cells move and the rows' Yoga origins do
    // not, until the Form publishes where they came to rest - and on Android that the list
    // really moved is asked of the device, not assumed, because a case that compared two
    // numbers with nothing scrolled would pass on the at-rest readings.
    const height = 180;
    form.nuiTestScrollTo(height);
    // Asked of the device, not assumed on both sides of the comparison below: what the case
    // measures is a shadow-tree number against a UIKit number, and it expects the difference
    // to be the scroll. A list that never moved leaves the two agreeing and the case passing
    // on the at-rest readings - which is what it did, until this line went in: with
    // `nuiTestScrollTo` made to do nothing, every row still "matched". Each platform is asked
    // where its own scroller got to: iOS answers with the list's content offset from the
    // Form's report, Android with its scroll view's.
    if (IOS) {
      await formReport(
        (r) => Math.abs(num(r, 'offset') - height) <= 2,
        `the list to have scrolled to ${height} pt`,
        'measure'
      );
    } else {
      expect(
        Math.abs((await formScrollY(height / 2)) - height)
      ).toBeLessThanOrEqual(2);
    }
    const scrolledBy = 0;
    const scrolled = await until(
      () => compareRows(`after ${height} pt`, scrolledBy),
      (r) => r.bad.length === 0 && r.compared >= 10,
      12000,
      'every row in a cell to measure where UIKit put it'
    );
    expect(scrolled.bad).toEqual([]);
    // A 180 pt scroll leaves a full page of rows on screen in an 874 pt window, so the same
    // ten apply here as at rest - and the same reason: a pass over one or two rows is not a
    // pass on the scroll.
    expect(scrolled.compared).toBeGreaterThanOrEqual(10);
    cleanup();
  });
});

// MARK: - X24: does a row's content reach the row's trailing edge, level with its label?

/** `[left, top, width, height]` in the window's own units (pt on iOS, dp on Android). */
type WindowBox = [number, number, number, number];

/** Anything React gave a `measureInWindow` handle to. */
type Measurable = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

/**
 * The boxes of {@link TrailingEdgeForm}, held by ref.
 *
 * Every one of them is a plain `View`, because a nitro-ui control takes no `ref`:
 * its handle (`hybridRef`) reports the size its native side measured and never
 * where it sits, and `measureInWindow` is a walk of the shadow tree, which only a
 * view React Native lays out answers. So each measured box is a wrapper that hugs
 * the thing it holds — in a row that centres its children a `View` with no style
 * is exactly as wide and as tall as the control inside it, which is the box that
 * control draws in.
 */
const contentBoxes: Record<string, Measurable> = {};

/** Hold one box under `key`, ignoring the unmount `null` (E7's pattern). */
function keepBox(key: string): (handle: Measurable | null) => void {
  return (handle) => {
    if (handle != null) contentBoxes[key] = handle as never;
  };
}

/** One box, or null while the shadow tree has no size for it yet. */
async function readBox(key: string): Promise<WindowBox | null> {
  const handle = contentBoxes[key];
  if (handle == null) throw new Error(`no box registered for "${key}"`);
  const box = await new Promise<WindowBox>((resolve) => {
    handle.measureInWindow((x, y, width, height) =>
      resolve([x, y, width, height])
    );
  });
  return box[2] > 0 && box[3] > 0 ? box : null;
}

/**
 * Every box once the layout has settled, or a complaint naming the last reading.
 *
 * Settled means two reads in a row that agree on the probe row's width. On iOS a
 * row starts at `width: '100%'` and narrows to the width the list's cell reported,
 * so a box read between those two answers is the row's first frame and not the row
 * a screenshot shows — and a case that measured then would be comparing a form
 * that was still being laid out.
 */
async function settledBoxes<const K extends readonly string[]>(
  keys: K
): Promise<Record<K[number], WindowBox>> {
  let previous: number | null = null;
  const deadline = Date.now() + 15000;
  for (;;) {
    const boxes: Record<string, WindowBox> = {};
    for (const key of keys) {
      const box = await readBox(key);
      if (box != null) boxes[key] = box;
    }
    const width = boxes.probe?.[2];
    if (width != null && width > 100 && width === previous) {
      return boxes as Record<K[number], WindowBox>;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the row content never settled: ${keys
          .map((key) => `${key}=${JSON.stringify(boxes[key] ?? null)}`)
          .join(' ')}`
      );
    }
    previous = width ?? null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** One child that takes all the room its row offers — the probe's whole job. */
const x24Fill = { flex: 1 } as const;

/**
 * A stand-in for a self-sizing control: a box React Native *can* measure, carrying the
 * base style the real controls carry because it reads it from the same hook they do.
 *
 * This is the whole trick of the case. `measureInWindow` walks the shadow tree, and a
 * hybrid view's handle reports the size its native side measured, never where it sits —
 * so the question "where does a `Switch` land in a row?" can only be asked through a
 * proxy. Reading `useSelfSizingBaseStyle` instead of retyping `{ alignSelf:
 * 'flex-start' }` is what keeps the proxy honest: the answer the case measures is the
 * answer the row gives a real control, and on a `Form.Row` that predates the row-aware
 * base style the proxy follows `flex-start` to the row's top edge and the case goes red
 * for the reason it exists, not for the reason it was written.
 */
function SelfSizingProbe({
  boxKey,
  children,
}: {
  boxKey: string;
  children?: ReactElement;
}) {
  return (
    <View ref={keepBox(boxKey)} style={useSelfSizingBaseStyle()}>
      {children}
    </View>
  );
}

/** The same pair inside a box of an app's own — what an app that copied round 1 has. */
const x24Box = {
  alignItems: 'center',
  flex: 1,
  flexDirection: 'row',
} as const;

const x24Styles = StyleSheet.create({
  form: { flex: 1 },
  label: { flex: 1 },
  text: { fontSize: 16 },
});

/**
 * The README's `form` example, with measurable boxes.
 *
 * Row one is a probe: one child that takes all the room, so its box *is* the row's
 * content box, insets and all, on a platform this file has to know nothing about.
 * Row two is the README's row written the obvious way — a `flex: 1` label and a
 * switch, both direct children of the row. Row three is that pair inside a box of
 * the app's own, so the case also covers an app that wrapped its content already.
 */
function TrailingEdgeForm() {
  return (
    <Form style={x24Styles.form}>
      <Form.Section title="Notifications">
        <Form.Row>
          <View ref={keepBox('probe')} style={x24Fill} testID="x24-probe">
            <Text style={x24Styles.text}>Notifications</Text>
          </View>
        </Form.Row>
        <Form.Row>
          <View ref={keepBox('label')} style={x24Styles.label}>
            <Text style={x24Styles.text}>Push notifications</Text>
          </View>
          <SelfSizingProbe boxKey="control">
            <Switch testID="x24-switch" value />
          </SelfSizingProbe>
        </Form.Row>
        <Form.Row>
          <View style={x24Box}>
            <View ref={keepBox('boxedLabel')} style={x24Styles.label}>
              <Text style={x24Styles.text}>Play a sound</Text>
            </View>
            <SelfSizingProbe boxKey="boxedControl">
              <Switch testID="x24-boxed-switch" value={false} />
            </SelfSizingProbe>
          </View>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

describe('Form row content (X24)', () => {
  afterEach(() => {
    cleanup();
    // A ref callback that only ever stores leaves the next case able to measure a
    // view this one unmounted, and a dead view answers with its right size at (0, 0).
    for (const key of Object.keys(contentBoxes)) delete contentBoxes[key];
  });

  it('lays a row’s content across the row and level with its label (X24)', async () => {
    await render(<TrailingEdgeForm />);
    await screen.findByTestId('x24-switch');
    const { probe, label, control, boxedLabel, boxedControl } =
      await settledBoxes([
        'probe',
        'label',
        'control',
        'boxedLabel',
        'boxedControl',
      ] as const);
    const right = (box: WindowBox): number => box[0] + box[2];
    const centre = (box: WindowBox): number => box[1] + box[3] / 2;
    const issues: string[] = [];
    // The same three promises, asked of the bare pair the README prints and of the
    // pair inside an app's own box.
    const pairs: Record<string, { label: WindowBox; control: WindowBox }> = {
      'a bare row': { label, control },
      'a boxed row': { label: boxedLabel, control: boxedControl },
    };
    for (const [name, pair] of Object.entries(pairs)) {
      // (How wide the row's content box *is* — the width the cell handed the row — is
      // what the E7 case checks against the list, so nothing is repeated here.)
      if (Math.abs(pair.label[0] - probe[0]) > 1) {
        issues.push(
          `${name}: the label starts at x=${pair.label[0].toFixed(1)} while the row's content starts at x=${probe[0].toFixed(1)}`
        );
      }
      if (Math.abs(right(pair.control) - right(probe)) > 1) {
        issues.push(
          `${name}: the control ends at x=${right(pair.control).toFixed(1)} while the row's content ends at x=${right(probe).toFixed(1)}`
        );
      }
      // The one round 1's `Form.Row` failed: a control whose base style is
      // `alignSelf: 'flex-start'` was left directly in a row taller than its content
      // followed that style to the row's top edge, because a child's `alignSelf` beats
      // the row's `alignItems`. A row now answers that base style with `alignSelf:
      // 'center'` (`src/core/useSelfSizing.ts`), so the control lands on its label's
      // middle — within a point, which is what "level" means to a reader of a screenshot.
      if (Math.abs(centre(pair.control) - centre(pair.label)) > 1) {
        issues.push(
          `${name}: the control is centred at y=${centre(pair.control).toFixed(1)} while its label is centred at y=${centre(pair.label).toFixed(1)}`
        );
      }
    }
    const delta = (pair: { label: WindowBox; control: WindowBox }): string =>
      (centre(pair.control) - centre(pair.label)).toFixed(1);
    console.log(
      `X24 BARE pair: row content x=${probe[0].toFixed(1)}..${right(probe).toFixed(1)}, ` +
        `control x=${control[0].toFixed(1)}..${right(control).toFixed(1)}, centre delta ` +
        `${delta({ label, control })}`
    );
    console.log(
      `X24 BOXED pair: control x=${boxedControl[0].toFixed(1)}..${right(boxedControl).toFixed(1)}, ` +
        `centre delta ${delta({ label: boxedLabel, control: boxedControl })}`
    );
    expect(issues).toEqual([]);
  });
});

// MARK: - X29 fix round 2: the box a row is told, and who is told about it

/**
 * A Form inside a box of the app's own, whose width the app changes mid-case.
 *
 * The two deep rows are what the case is about. Twelve 52 pt rows in a 420 pt box put them
 * off screen at rest; the case scrolls them into view so their own cells report a box, then
 * scrolls them back out again, which parks them in their section's holding view. From there
 * nothing lays them out again — not the resize, and not a `measure`, which reads the shadow
 * tree. What they answer afterwards is the width the row *remembers*, which is exactly the
 * thing a rotation used to leave behind.
 *
 * Row 2 has an accessory and stays on screen: it is what teaches the Form what an accessory
 * costs under the new width, so the parked accessory row's expected number is measured in this
 * Form rather than typed here.
 */
function SizedForm({ boxWidth }: { boxWidth: number }) {
  return (
    <View style={{ height: 420, width: boxWidth }} testID="resize-host">
      <Form
        hybridRef={(view) => {
          if (view != null) forms.resize = view;
        }}
        style={styles.form}
      >
        <Form.Section title="Rows">
          {Array.from({ length: 12 }, (_, index) => (
            <Form.Row
              accessory={index === 1 || index === 11 ? 'disclosure' : 'none'}
              hybridRef={
                index === 9
                  ? (view) => {
                      if (view != null) rows.resizePlain = view;
                    }
                  : index === 11
                    ? (view) => {
                        if (view != null) rows.resizeAccessory = view;
                      }
                    : undefined
              }
              key={`resize-${index}`}
            >
              <Text testID={`resize-label-${index}`}>Row {index + 1}</Text>
            </Form.Row>
          ))}
        </Form.Section>
      </Form>
    </View>
  );
}

/**
 * Three rows, the middle of which the case gives a trailing accessory between two renders.
 *
 * A visible row gaining an accessory is the cheapest way to make one cell report a narrower
 * box than its neighbours *after* the list has already settled — which is the case the
 * list-wide number has to survive without moving.
 */
function AccessoryForm({ accessoried }: { accessoried: boolean }) {
  return (
    <Form
      hybridRef={(view) => {
        if (view != null) forms.toggle = view;
      }}
      style={styles.form}
    >
      <Form.Section title="Sound">
        <Form.Row>
          <Text testID="toggle-label-steady">Ringer</Text>
        </Form.Row>
        <Form.Row
          accessory={accessoried ? 'disclosure' : 'none'}
          hybridRef={(view) => {
            if (view != null) rows.toggled = view;
          }}
        >
          <Text testID="toggle-label-target">Alerts</Text>
        </Form.Row>
        <Form.Row>
          <Text testID="toggle-label-third">Notifications</Text>
        </Form.Row>
      </Form.Section>
    </Form>
  );
}

describe('Form row boxes (X29 r2)', () => {
  afterEach(() => {
    cleanup();
    forgetPromisedHandles();
    for (const map of [forms, sections, rows]) {
      for (const key of Object.keys(map)) delete map[key];
    }
  });

  it('hands no row back as a loss across 400 pt scrolls (X29 r2, item 1)', async () => {
    // iOS only: a give-back is a cell emptying, and Android has no cells — its rows stay where
    // Yoga put them, so there is nothing here for Android to be red about.
    if (!IOS) return;
    await mount({ mode: 'base', formStyle: SHORT_BOX, ...counters() });
    await formReport((r) => num(r, 'rows') === 9, 'nine rows');

    // A cycle is one jump down and one back up, each asked of the list rather than assumed:
    // `nuiTestScrollTo(400)` is clamped to the bottom of a 646 pt content in a 420 pt box, and
    // a list at rest sits at its own top inset, so the only honest target is "moved away from
    // where it was" — which is what recycles a cell, which is what this case counts.
    let rest = await formReport(() => true, 'the report at rest');
    const cycle = async (step: string): Promise<void> => {
      const at = num(rest, 'offset');
      need(forms.form).nuiTestScrollTo(400);
      const down = await formReport(
        (r) => num(r, 'offset') > at + 20,
        `${step}: the list to have scrolled down from ${at} pt`
      );
      await drawnOnScreen(`${step} down`);
      need(forms.form).nuiTestScrollTo(0);
      rest = await formReport(
        (r) => num(r, 'offset') < num(down, 'offset') - 20,
        `${step}: the list to have come back up from ${down.offset} pt`
      );
      await drawnOnScreen(`${step} back up`);
    };
    // A warm-up cycle first, so the reading below is taken from a list that has already
    // recycled once and is not still settling from its own mount.
    await cycle('warm-up 1');
    await cycle('warm-up 2');
    const lossesAtRest = num(rest, 'losses');

    for (const step of ['1', '2', '3', '4']) {
      await cycle(`cycle ${step}`);
    }
    const after = await formReport(() => true, 'the report after four scrolls');
    // The rows on screen are still the ones their items name — the claim the chase exists to
    // repair, asked directly so this case cannot go green by the chase never having run.
    expect(num(after, 'claims')).toBe(0);
    expect(num(after, 'wrongCells')).toBe(0);
    // Four 400 pt scrolls move a 9-row Form's whole content twice over, so every cell on
    // screen was emptied and refilled several times. A give-back is not a lost row: before fix
    // round 2 the container was still naming the row while `onGiveBack` moved it, so each one
    // read back as a take, and the Form queued a walk of the visible cells for every one of
    // them.
    expect(num(after, 'losses') - lossesAtRest).toBe(0);
    // `applies` — the chases that ran — is deliberately not asserted: every settle asks the
    // same question of the visible cells (`reportGeometry` -> the chase), and a settle that
    // lands while UIKit is mid-reuse really does find a cell to reconfigure. What had to stop
    // moving is the number above, because each loss queued that walk on its own turn.
  });

  it('re-lays a row that is off screen at the Form’s new width (X29 r2, item 2)', async () => {
    // iOS only, and iOS-only by cause: the row's own box is reported by its iOS cell, and
    // Android lays every row out at the width the list gives it.
    if (!IOS) return;
    const { rerender } = await render(<SizedForm boxWidth={400} />);
    await handleOf(() => forms.resize, 'the resizable Form');
    const wide = await formReport(
      (r) =>
        num(r, 'rows') === 12 &&
        num(r, 'width') > 100 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      // `inCells` against the items on screen, not against twelve: five of these rows are
      // parked off screen by design, and a Form that drew every visible row from a cell is the
      // settle this case can ask for.
      'the wide Form to draw every visible row at its own box',
      'resize'
    );
    const wideWidth = num(wide, 'width');
    const restingOffset = num(wide, 'offset');

    // Show the deep rows, so the cells that draw them are the ones that tell them their box —
    // and wait on the Form's own witness that every row on screen sits at the box of the cell
    // drawing it. Reading a row before that settles reads the box its view carried in from the
    // case that ran *before* this one: a row view is pooled and reused, and its content keeps
    // the last Yoga width until the new one arrives. That is what this case first went red on —
    // an accessory row apparently 2 pt wider than the list drawing it — and it is the same race
    // that made E4 depend on which case ran ahead of it, so the wait is the finding, not a
    // workaround for it.
    need(forms.resize).nuiTestScrollTo(400);
    const shown = await formReport(
      (r) =>
        num(r, 'offset') > restingOffset + 60 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the list to have scrolled to the deep rows, each drawn by its own cell at its own box',
      'resize'
    );
    // What an accessory costs, from two real cell reports rather than a typed constant — and
    // from the Form rather than from a row, because this is the number the Form goes on to hand
    // the rows that cannot ask their own cell. Asked before the rows are read, so a Form that
    // never learned it cannot make the accessory expectations below coincide with the plain one.
    const wideInset = num(shown, 'accessoryInset');
    expect(wideInset).toBeGreaterThan(4);
    await reportUntil(
      () => rows.resizePlain?.nuiTestRowReport(),
      (r) => r.where === 'cell' && Math.abs(Number(r.laid) - wideWidth) <= 0.5,
      `the deep plain row to be drawn in a cell at the Form’s ${wideWidth} pt box`
    );
    await reportUntil(
      () => rows.resizeAccessory?.nuiTestRowReport(),
      (r) =>
        r.where === 'cell' &&
        Math.abs(Number(r.laid) - (wideWidth - wideInset)) <= 0.5,
      `the deep accessory row to be drawn in a cell at ${wideWidth} - ${wideInset} pt`
    );

    // Park them again: off screen, in the section's holding view, remembered at the wide box.
    need(forms.resize).nuiTestScrollTo(0);
    await formReport(
      // Relative, like every other scroll in this file: the list is clamped by its own content
      // and rests at its top inset, so "came back up" is the claim and an absolute number is
      // one this Form cannot make.
      (r) => num(r, 'offset') < num(shown, 'offset') - 60,
      'the list to be back at the top again',
      'resize'
    );
    for (const [name, handle, remembered] of [
      ['plain', rows.resizePlain, wideWidth],
      ['accessory', rows.resizeAccessory, wideWidth - wideInset],
    ] as const) {
      const parked = await reportUntil(
        () => handle?.nuiTestRowReport(),
        (r) => r.where === 'holding',
        `the deep ${name} row to be off screen again`
      );
      // Still the box their own cells last reported: nothing lays a parked row out, which is
      // exactly the state a rotation used to find them in and leave.
      expect(Math.abs(Number(parked.laid) - remembered)).toBeLessThanOrEqual(
        0.5
      );
    }

    // The app changes a parent's width — the same thing a rotation does to the Form's box.
    await rerender(<SizedForm boxWidth={320} />);
    const narrow = await formReport(
      (r) =>
        num(r, 'width') > 100 &&
        wideWidth - num(r, 'width') > 20 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the Form to publish a new, narrower box for the rows it can see',
      'resize'
    );
    const narrowWidth = num(narrow, 'width');
    // What an accessory costs is the cell's own margins, which a width change does not move, and
    // the Form had to learn it again from the cells it has now. Both rows are graded against
    // this measured number, and it is checked to be real before either is read.
    const narrowInset = num(narrow, 'accessoryInset');
    expect(narrowInset).toBeGreaterThan(4);
    const expectedAccessory = narrowWidth - narrowInset;

    // Neither row was in a cell for that layout pass. The Form has to tell them anyway: a row
    // measured at a width the list stopped having is D45.4's promise broken at rest.
    const plainRelaid = await reportUntil(
      () => rows.resizePlain?.nuiTestRowReport(),
      (r) => Math.abs(Number(r.laid) - narrowWidth) <= 0.5,
      `the parked plain row to be laid out at the new ${narrowWidth} pt box (where it ` +
        'is parked, at what the Form publishes now)'
    );
    expect(plainRelaid.where).toBe('holding');
    const accessoryRelaid = await reportUntil(
      () => rows.resizeAccessory?.nuiTestRowReport(),
      (r) => Math.abs(Number(r.laid) - expectedAccessory) <= 0.5,
      `the parked accessory row to be laid out at ${narrowWidth} - ${narrowInset} = ` +
        `${expectedAccessory} pt`
    );
    expect(accessoryRelaid.where).toBe('holding');

    // Then the Form's own witnesses, which have to agree with the rows: the published number is
    // the plain box, and what an accessory costs did not move with the width. Asked after the
    // rows, so a Form that never re-told them fails on its rows first.
    expect(Math.abs(narrowInset - wideInset)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(num(narrow, 'plainBox') - narrowWidth)).toBeLessThanOrEqual(
      0.5
    );
  });

  it('moves no row of the list when one row gains an accessory (X29 r2, items 3 and 5)', async () => {
    // iOS only: on Android the section paints the accessory and the row reserves its room with
    // padding, so there is one box for every row and nothing to flip.
    if (!IOS) return;
    const { rerender } = await render(<AccessoryForm accessoried={false} />);
    await handleOf(() => forms.toggle, 'the accessory Form');
    const before = await formReport(
      (r) =>
        num(r, 'rows') === 3 &&
        num(r, 'width') > 100 &&
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'inCells') === visibleItems(r),
      'the all-plain Form to settle',
      'toggle'
    );
    const plainBox = num(before, 'plainBox');
    const published = num(before, 'widthPublishes');
    // The published number is the plain box, and with no accessories every box is that one.
    expect(Math.abs(num(before, 'width') - plainBox)).toBeLessThanOrEqual(0.5);
    expect(num(before, 'boxSpan')).toBeLessThanOrEqual(0.5);

    await rerender(<AccessoryForm accessoried={true} />);
    // Item 5: the row that gained the accessory has to be re-aimed at its own narrower box —
    // `boxMismatch` is the Form's own answer to "is every row on screen laid out at the box of
    // the cell drawing it", and one wide row on screen is the whole of X29.
    const after = await formReport(
      (r) =>
        num(r, 'boxMismatch') <= 0.5 &&
        num(r, 'boxSpan') > 4 &&
        num(r, 'inCells') === visibleItems(r),
      'the toggled row to be laid out at its own narrower box, and its neighbours at theirs',
      'toggle'
    );
    const inset = num(after, 'accessoryInset');
    expect(inset).toBeGreaterThan(4);
    expect(Math.abs(inset - num(after, 'boxSpan'))).toBeLessThanOrEqual(0.5);
    const toggled = await reportUntil(
      () => rows.toggled?.nuiTestRowReport(),
      (r) =>
        r.where === 'cell' &&
        Math.abs(Number(r.laid) - (plainBox - inset)) <= 0.5,
      `the toggled row to be laid out at ${plainBox} - ${inset} = ${plainBox - inset} pt`
    );
    expect(toggled.where).toBe('cell');

    // Item 3: and it moved nothing else. The narrower box belongs to that one row; the
    // list-wide number is the plain box, published once per list width — every Section and
    // `RowRoot` renders again for each publish, so this is the difference between one row
    // changing and the Form re-rendering its whole tree because a cell laid out last.
    expect(num(after, 'widthPublishes')).toBe(published);
    expect(Math.abs(num(after, 'width') - plainBox)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(num(after, 'plainBox') - plainBox)).toBeLessThanOrEqual(
      0.5
    );
  });
});
