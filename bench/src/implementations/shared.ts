import { StyleSheet } from 'react-native';

import type { ComponentName } from '../types';

/**
 * One row per control, per component.
 *
 * Every implementation of one component gets the same box, so no arm gets a
 * cheaper layout - but two *components* may need different boxes, because a row
 * has to be tall enough for the tallest control of that component on either
 * platform. Squeezing Material 3's 40 dp Slider into the Switch's 34 pt row
 * would measure a clipped control (T02 review B3: arms differ only in what they
 * host).
 */
const ROW_HEIGHTS: Record<
  Exclude<ComponentName, 'button' | 'segmented-control' | 'date-picker'>,
  number
> = {
  // RN's Switch, SwiftUI's Toggle and M3's Switch all fit; 34 is T02/T10's row.
  switch: 34,
  // Above SwiftUI's measured 31 pt and Material 3's measured 40 dp, so nothing
  // clips and every arm still lays out the identical area.
  slider: 44,
  // The circular variants are the tall ones: SwiftUI's `.circular` ProgressView
  // is 32 pt and Material 3's loading indicator is 40 dp, so the row is as tall
  // as the slider's to hold either without clipping the arm under test.
  progress: 44,
};

/* Button, SegmentedControl and DatePicker have no row height on purpose - see `fitRowStyle`. */

/**
 * Whether a component's own measurement decides its box, so no arm may be given a
 * box to fit into.
 *
 * Button (G2) and SegmentedControl (G4) are the components whose size comes from
 * their props: a fixed height and a stretched width would each silence the
 * re-measure the `update` cell is there to price (DECISIONS D16). Switch and
 * Slider are platform-sized, so they take a row.
 */
function isSizedByContent(
  component: ComponentName
): component is 'button' | 'segmented-control' | 'date-picker' {
  return (
    component === 'button' ||
    component === 'segmented-control' ||
    component === 'date-picker'
  );
}

/**
 * Row style for the arms of a component that sizes itself, returned by
 * {@link rowStyle}.
 *
 * Deliberately not a fixed row: the arms hug their content on both axes and every
 * arm is given the same rule. The resulting heights differ per platform (Material
 * 3 keeps a 40 dp minimum for a Button and a 48 dp touch box for a segment,
 * SwiftUI a ~35 pt regular control and a 31 pt segmented `Picker`) - that is the
 * platforms' own cost, which no arm can equalise without drawing something the
 * others do not.
 */
const fitRowStyle = { alignSelf: 'flex-start' as const };

/**
 * Style for a shared-host arm holding a whole batch of self-sizing controls,
 * returned by {@link stackStyle}.
 *
 * Module-level and unconditional: a fresh object per render would hand the
 * `Host` a changed style prop on every flip, which no other arm pays (T02 review
 * NIT). `matchContents` sizes these hosts to their content, so they need no
 * `n`-derived height - unlike the fixed rows {@link stackStyle} builds for the
 * components that do have a row height.
 */
const sharedHostStyle = { width: '100%' as const };

const styles = StyleSheet.create({
  /**
   * One bench row, sized identically for every implementation so no arm gets a
   * cheaper layout. Out of the JSX so the harness itself stays style-free.
   */
  row: { height: ROW_HEIGHTS.switch, width: '100%' },
  sliderRow: { height: ROW_HEIGHTS.slider, width: '100%' },
  progressRow: { height: ROW_HEIGHTS.progress, width: '100%' },
});

/**
 * The row style for one component, one object per component.
 *
 * Cached because a fresh object per render hands a shared host a style prop whose
 * identity changed on every value flip, i.e. a prop update on every flip that no
 * other arm pays (T02 review NIT).
 */
export function rowStyle(component: ComponentName) {
  if (isSizedByContent(component)) {
    return fitRowStyle;
  }
  if (component === 'slider') {
    return styles.sliderRow;
  }
  return component === 'progress' ? styles.progressRow : styles.row;
}

/**
 * One host tall enough for the whole batch, for the shared-host arms.
 *
 * Cached per component and `n`, for the same reason as `rowStyle`.
 */
const stackStyles = new Map<string, { height: number; width: '100%' }>();

export function stackStyle(
  n: number,
  component: ComponentName
): { height: number; width: '100%' } | typeof sharedHostStyle {
  if (isSizedByContent(component)) {
    // A self-sizing batch hugs its content: telling the host a height would take
    // the control's own measurement out of the measurement.
    return sharedHostStyle;
  }
  const key = `${component}:${String(n)}`;
  const cached = stackStyles.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const style = { height: ROW_HEIGHTS[component] * n, width: '100%' as const };
  stackStyles.set(key, style);
  return style;
}

/**
 * Stable no-op handler.
 *
 * The bench never lets the native control own its state - JS flips `value` - so
 * every implementation gets the same referentially stable callback. An inline
 * arrow here would change identity on every render and hand one implementation
 * cheaper prop diffs than another (see the `no-inline-callback-in-jsx` rule).
 */
export function onValueChange(_value: boolean): void {
  // Intentionally empty: state is driven by the runner.
}

/** `onValueChange` for a control whose value is a number. */
export function onSliderChange(_value: number): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The boolean the runner flips, spelled as a Slider value.
 *
 * The engine flips a bit for every component because what is being compared is
 * the *cost* of a flip, and the magnitude of a flip is not something arms may
 * disagree on: one place maps the bit onto a number, and every arm - RN core,
 * both Expo UI hosts and nitro-ui - renders the same two values.
 */
export function sliderValue(value: boolean): number {
  return value ? 0.75 : 0.25;
}

/**
 * The label every Button arm draws, flipped by the `update.button` cell.
 *
 * Both words are short and one is longer than the other on purpose: the flip
 * must change the measured width, or the scenario would exercise a prop write
 * and no re-measure.
 */
export function buttonTitle(value: boolean): string {
  return value ? 'Saved' : 'Save';
}

/** The two option lists the SegmentedControl arms alternate between. */
const SEGMENTED_SHORT: string[] = ['Day', 'Week', 'Month'];
const SEGMENTED_LONG: string[] = ['Daily', 'Weekly', 'Monthly'];

/**
 * The option list every SegmentedControl arm draws, flipped by the
 * `update.segmented-control` cell.
 *
 * Three labels either way, of different lengths: a segmented control's width is
 * the sum of its labels, so the flip has to move the measured width or the cell
 * would price a repaint rather than a re-measure (D16, the same reason G2 flips
 * the Button's title). The *count* stays at three because adding a segment would
 * make the cell partly a mount, and then the ratio no longer says what a
 * re-measuring update costs.
 *
 * Both lists are module-level so the array identity never changes: an arm that
 * handed its control a fresh array on every flip would pay a prop-identity change
 * no other arm pays.
 */
export function segmentedOptions(value: boolean): string[] {
  return value ? SEGMENTED_LONG : SEGMENTED_SHORT;
}

/**
 * The index every SegmentedControl arm has selected, in both halves of the flip.
 *
 * Deliberately constant: what this cell prices is a content change that moves the
 * measured width, and folding a selection change into the same flip would charge
 * two transactions to one number. Selection correctness is the harness suite's
 * job, not the bench's.
 */
export const SEGMENTED_SELECTION = 1;

/**
 * Stable no-op press handler for the Button arms, for the same reason as
 * {@link onValueChange}: the runner owns the state, so no arm may pay for a new
 * callback identity per render.
 */
export function onPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The boolean the runner flips, spelled as a Progress value.
 *
 * Deliberately the same two numbers as `sliderValue`: arms must agree on how big
 * a flip is, and a progress bar's 0.25→0.75 is the same one-prop commit a slider
 * flip is. Named separately because a Progress and a Slider are different controls
 * and a future change to one must not silently re-scale the other's table.
 */
export function progressValue(value: boolean): number {
  return value ? 0.75 : 0.25;
}

/**
 * Stable no-op `onChange` for the SegmentedControl arms, for the same reason as
 * {@link onPress}. Written without parameters so it satisfies each runtime's own
 * change-event signature without the bench importing any of those types.
 */
export function onSegmentChange(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * The two instants every DatePicker arm shows, built once.
 *
 * Same month, same year, same clock time, and one is a two-digit day: the
 * `update.date-picker` cell must change what the control *displays* (that is the
 * transaction it prices), and it must not change anything else - a different
 * month would move the calendar's page, and a different year its year header,
 * which are the picker's work rather than the value's.
 *
 * Module-level for the same reason as `segmentedOptions`: an arm that handed its
 * control a fresh `Date` on every flip would pay an object-identity change no
 * other arm pays.
 */
const DATES = [
  new Date(2026, 10, 4, 9, 0),
  new Date(2026, 10, 14, 9, 0),
] as const;

/** The instant every DatePicker arm selects, flipped by `update.date-picker`. */
export function dateValue(value: boolean): Date {
  return DATES[value ? 1 : 0];
}

/**
 * The same instant spelled as text, for the `rn-core` floor.
 *
 * RN core has no date picker, so the idiomatic core equivalent is the label a
 * JS-only control would show - which is also what the brief asks this arm to be.
 * One module-level `Intl` formatter keeps the flip to a format call: building a
 * formatter per render would price ICU setup rather than the control.
 */
const DATE_LABEL_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

export function dateLabel(value: boolean): string {
  return DATE_LABEL_FORMAT.format(dateValue(value));
}

/**
 * Stable no-op date handler for the reference arms, for the same reason as
 * {@link onSegmentChange}: the runner owns the state, so no arm may pay a new
 * callback identity per render. Written without parameters so it satisfies each
 * runtime's own change-event signature without the bench importing those types.
 */
export function onDateChange(): void {
  // Intentionally empty: state is driven by the runner.
}

export function range(n: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < n; index++) {
    out.push(index);
  }
  return out;
}
