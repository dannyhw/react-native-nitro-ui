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
const ROW_HEIGHTS: Record<ComponentName, number> = {
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
): { height: number; width: '100%' } {
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

export function range(n: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < n; index++) {
    out.push(index);
  }
  return out;
}
