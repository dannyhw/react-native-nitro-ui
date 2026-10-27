import {
  Button,
  DatePicker,
  Host,
  Picker,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
  nitroUiCore,
} from 'react-native-nitro-ui';

import type { BenchListProps, BenchPerfMark } from '../types';
import {
  SEGMENTED_SELECTION,
  buttonTitle,
  dateValue,
  onDateChange,
  onPress,
  onPickerChange,
  onSegmentChange,
  onSliderChange,
  onValueChange,
  pickerOptions,
  pickerSelection,
  progressValue,
  range,
  rowStyle,
  segmentedOptions,
  sliderValue,
  stackStyle,
} from './shared';

/**
 * =====================================================================================
 *  THE ONE-FILE CHANGE - the `nitro-ui` arm
 * =====================================================================================
 *
 * This is the only file in the harness that renders `react-native-nitro-ui`, plus
 * the only place its native perf marks are read. Everything else (plan, runner,
 * reporter) is runtime-agnostic.
 *
 * Adding a *second* component to the matrix means one entry in
 * `bench/src/plan.ts`/`docs` scenario props and one `List` per platform here - see
 * docs/architecture/benchmarks.md "Per-component checklist".
 *
 * `Switch` is a **named import** from T10 onwards, so the props passed below are
 * typechecked against the real component by `bun run bench:typecheck`
 * (`paths: { "react-native-nitro-ui": ["../src/index.ts"] }` in
 * `bench/tsconfig.json` is the TS mirror of Metro's `extraNodeModules`, which
 * resolves the package to the repository root and asks for its
 * `react-native-nitro-ui-source` export condition).
 *
 * Cost fairness: the arm passes what the reference arms pass - `value`, a stable
 * no-op `onValueChange`, `testID`, and the shared `rowStyle`, so every arm lays
 * out the same box and diffs the same JS props. `tintColor` and `disabled` stay
 * unset: the comparison is each control's platform default. What the arm cannot
 * avoid passing is what the library's own wrapper always sends
 * (`defaultValue`, `mostRecentEventCount`, `nuiPerfId`, `null` for the rest,
 * DECISIONS D7) - that is the library's props contract being measured, not bench
 * bias, and it is the same cost a consumer pays.
 * =====================================================================================
 */

/** `nitroUiCore.now()` and every perf mark are ms; the probe speaks ns (D1). */
const MS_TO_NS = 1_000_000;

/**
 * Whether this process turned marks on.
 *
 * `nuiPerfId` alone is not enough to record anything (a marked view with
 * recording off pays one relaxed atomic load and writes nothing), and a drained
 * buffer is JS work, so both halves stay behind this flag: a normal measured run
 * of the `nitro-ui` arm is instrumented exactly as much as the reference arms
 * are, i.e. not at all.
 */
let marksEnabled = false;

/** Called by the runner for a `--perf-marks` launch, before the first commit. */
export function enableNitroUiPerfMarks(): void {
  nitroUiCore.setPerfEnabled(true);
  marksEnabled = true;
}

/**
 * Every mark recorded since the last call, in the probe's nanosecond base.
 *
 * The library's ring is 4096 events and a 25-iteration x 50-instance run writes
 * thousands, so the caller drains between iterations rather than once at the end
 * - a full ring drops its oldest marks, which would silently under-count.
 */
export function drainNitroUiPerfMarks(): BenchPerfMark[] | null {
  if (!marksEnabled) {
    return null;
  }
  const marks: BenchPerfMark[] = [];
  for (const event of nitroUiCore.drainPerf()) {
    marks.push({
      instanceId: event.instanceId,
      kind: event.kind,
      timeNs: Math.round(event.time * MS_TO_NS),
    });
  }
  return marks;
}

/**
 * `n` nitro-ui controls inside **one** `<Host>` (H1, widened to Slider, Progress and
 * Button by H2a, and to SegmentedControl, Picker and DatePicker by H2b): one Compose
 * composition and one `AndroidComposeView` for the batch instead of one per control.
 *
 * The box is the `expo-ui-shared-host` arm's box (`stackStyle`), and the child's props
 * are the `nitro-ui` arm's props - same `rowStyle`, same stable no-op handler - so the
 * difference this cell prices is only *where the control composes*. That is deliberate:
 * the Expo arm's children carry no box at all (a Compose child has no Yoga node to size),
 * and giving this arm's children no box either would fold "no intrinsic sizing round
 * trip" into a number that is supposed to be about compositions. The sizing consequence
 * of that is real and belongs in the report, not in the ratio.
 *
 * `Host` stacks its children itself (a Compose `Column`), which is the same arrangement
 * the Expo arm builds with an explicit `<Column>`.
 *
 * D24 makes the cells mean slightly different things, and the rows say so: the
 * `fillWidth` controls (Slider, linear Progress) take the Host's inner width in the Column
 * rather than their own `style.width`, and `Switch` and `Button` keep their intrinsic width
 * at the column's leading edge. H2b's three (`SegmentedControl`, `Picker`, `DatePicker`)
 * are `isSizedByContent`, so they get the hugging row and the hugging host: the batch's
 * height is the Compose column's own height, which is what makes its `Host` box height a
 * measured quantity rather than a declared one. The *box RN lays out* is the same one the other arms get
 * (`rowStyle`), because that is the box the ratio is about; what the control draws inside
 * it is the library's documented Host sizing, not a per-arm styling choice.
 */
export function NitroUiHostList({
  n,
  value,
  perfMarks,
  component,
}: BenchListProps) {
  if (n === 0) {
    return null;
  }
  const style = rowStyle(component);
  /** One child, the same props the `nitro-ui` arm passes for this component. */
  const child = (index: number) => {
    const testId = `bench-nitro-ui-host-${component}-${String(index)}`;
    const nuiPerfId = perfMarks ? index : null;
    if (component === 'slider') {
      return (
        <Slider
          key={index}
          testID={testId}
          value={sliderValue(value)}
          onValueChange={onSliderChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'progress') {
      return (
        <Progress
          key={index}
          testID={testId}
          value={progressValue(value)}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'button') {
      return (
        <Button
          key={index}
          testID={testId}
          title={buttonTitle(value)}
          onPress={onPress}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'switch') {
      return (
        <Switch
          key={index}
          testID={testId}
          value={value}
          onValueChange={onValueChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'segmented-control') {
      return (
        <SegmentedControl
          key={index}
          testID={testId}
          options={segmentedOptions(value)}
          selectedIndex={SEGMENTED_SELECTION}
          onChange={onSegmentChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'picker') {
      return (
        <Picker
          key={index}
          testID={testId}
          options={pickerOptions()}
          selectedIndex={pickerSelection(value)}
          onChange={onPickerChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    if (component === 'date-picker') {
      return (
        <DatePicker
          key={index}
          testID={testId}
          value={dateValue(value)}
          onChange={onDateChange}
          nuiPerfId={nuiPerfId}
          style={style}
        />
      );
    }
    // Nothing is hostable outside the seven (an RN view, a nested Host): a Host refuses
    // them, so the plan should never ask (`BenchImplementation.components`) and
    // rendering an empty tree here would be a number nobody asked for.
    throw new Error(`nitro-ui-host cannot compose ${component}`);
  };
  return <Host style={stackStyle(n, component)}>{range(n).map(child)}</Host>;
}

/**
 * `n` real nitro-ui switches.
 *
 * `nuiPerfId` is the library's own per-instance mark id, and it stays `null`
 * unless the launch asked for marks: passing an id is nearly free but not
 * literally free (one integer compare per mark site), and the numbers in the
 * published tables should be the numbers a consumer gets.
 */
export function NitroUiList({
  n,
  value,
  perfMarks,
  component,
}: BenchListProps) {
  if (n === 0) {
    return null;
  }
  const style = rowStyle(component);
  if (component === 'date-picker') {
    // The `compact` `date` picker: the control's default presentation, and the
    // only one whose box the reference arms can also take (`matchContents` on
    // the Expo hosts). `dateValue(value)` is the same instant every arm shows,
    // so `update.date-picker` is a real value change here: the field's text
    // changes, the control re-emits nothing, and the controlled handshake runs.
    // `disabled` and `tintColor` stay at their defaults - the arms compare each
    // control's platform default, including the size that default measures.
    return (
      <>
        {range(n).map((index) => (
          <DatePicker
            key={index}
            testID={`bench-nitro-ui-date-${String(index)}`}
            value={dateValue(value)}
            onChange={onDateChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'picker') {
    // `pickerSelection(value)` is the same index the other arms paint and the
    // options list is the list they mount, so the `update` cell is a real selection
    // change here: the painted title changes, the sizing key moves, the control
    // re-measures, and the cost of that round trip is in the numbers. `variant`,
    // `label`, `disabled` and `tintColor` stay at their defaults - the arms compare
    // each control's platform default, including the size that default measures
    // (Material 3's 280 dp field floor included).
    return (
      <>
        {range(n).map((index) => (
          <Picker
            key={index}
            testID={`bench-nitro-ui-picker-${String(index)}`}
            options={pickerOptions()}
            selectedIndex={pickerSelection(value)}
            onChange={onPickerChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'segmented-control') {
    // `segmentedOptions(value)` is the same list the other arms draw, so the
    // `update` cell is a real options change here: the sizing key changes, the
    // control re-measures, and the cost of that round trip is in the numbers.
    // `disabled` and `tintColor` stay at their defaults - the arms compare each
    // control's platform default, including the size that default measures.
    return (
      <>
        {range(n).map((index) => (
          <SegmentedControl
            key={index}
            testID={`bench-nitro-ui-segmented-${String(index)}`}
            options={segmentedOptions(value)}
            selectedIndex={SEGMENTED_SELECTION}
            onChange={onSegmentChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'button') {
    // `buttonTitle(value)` is the same string the other arms draw, so the
    // `update` scenario is a real title change here: the sizing key changes, the
    // control re-measures, and that cost is in the measured numbers.
    // `variant`, `size`, `disabled` and `tintColor` stay at their defaults - the
    // arms compare each control's platform default, and the size a default
    // `filled`/`medium` button measures is part of what the arm costs.
    return (
      <>
        {range(n).map((index) => (
          <Button
            key={index}
            testID={`bench-nitro-ui-button-${String(index)}`}
            title={buttonTitle(value)}
            onPress={onPress}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'slider') {
    return (
      <>
        {range(n).map((index) => (
          <Slider
            key={index}
            testID={`bench-nitro-ui-slider-${String(index)}`}
            value={sliderValue(value)}
            onValueChange={onSliderChange}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  if (component === 'progress') {
    // The default `variant` (`'linear'`) and a determinate value: that is the
    // control G3 is asked to price, and the one whose box every arm can match.
    // `tintColor`/`trackColor` stay unset like the other arms' colours - the
    // comparison is each runtime's platform default.
    return (
      <>
        {range(n).map((index) => (
          <Progress
            key={index}
            testID={`bench-nitro-ui-progress-${String(index)}`}
            value={progressValue(value)}
            nuiPerfId={perfMarks ? index : null}
            style={style}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {range(n).map((index) => (
        <Switch
          key={index}
          testID={`bench-nitro-ui-${String(index)}`}
          value={value}
          onValueChange={onValueChange}
          nuiPerfId={perfMarks ? index : null}
          style={style}
        />
      ))}
    </>
  );
}
