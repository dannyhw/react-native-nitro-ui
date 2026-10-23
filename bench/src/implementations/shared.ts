import { StyleSheet } from 'react-native';

/** Row height used for every implementation so all arms lay out the same area. */
export const ROW_HEIGHT = 34;

const styles = StyleSheet.create({
  /**
   * One bench row, sized identically for every implementation so no arm gets a
   * cheaper layout. Out of the JSX so the harness itself stays style-free.
   */
  row: { height: ROW_HEIGHT, width: '100%' },
});

export const rowStyle = styles.row;

/**
 * One host tall enough for the whole batch, for the shared-host arms.
 *
 * Cached per `n`: building a new object on every render hands the `Host` a style
 * prop whose identity changed, i.e. a prop update on every value flip, which no
 * other arm pays (T02 review NIT).
 */
const stackStyles = new Map<number, { height: number; width: '100%' }>();

export function stackStyle(n: number): { height: number; width: '100%' } {
  const cached = stackStyles.get(n);
  if (cached !== undefined) {
    return cached;
  }
  const style = { height: ROW_HEIGHT * n, width: '100%' as const };
  stackStyles.set(n, style);
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

export function range(n: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < n; index++) {
    out.push(index);
  }
  return out;
}

/**
 * Row style for the *Button* arms.
 *
 * Deliberately not {@link rowStyle}: Button is the first component whose size
 * comes from its props, and the `update` scenario changes the title to exercise
 * re-measuring (DECISIONS D16). A fixed height and a stretched width would both
 * silence that measure, so the button arms hug their content on both axes and
 * every arm is given the same rule. The resulting heights differ per platform
 * (Material 3 keeps a 40 dp minimum, SwiftUI a ~35 pt regular control) - that is
 * the platforms' own cost, which no arm can equalise without drawing something
 * the others do not.
 */
export const buttonRowStyle = { alignSelf: 'flex-start' as const };

/**
 * The label every Button arm draws, flipped by the `update` scenario.
 *
 * Both words are short and one is longer than the other on purpose: the flip
 * must change the measured width, or the scenario would exercise a prop write
 * and no re-measure.
 */
export function buttonTitle(value: boolean): string {
  return value ? 'Saved' : 'Save';
}

/**
 * Stable no-op press handler for the Button arms, for the same reason as
 * {@link onValueChange}: the runner owns the state, so no arm may pay for a new
 * callback identity per render.
 */
export function onPress(): void {
  // Intentionally empty: state is driven by the runner.
}

/**
 * Style for a shared-host arm that contains the whole batch.
 *
 * Module-level and unconditional: a fresh object per render would hand the
 * `Host` a changed style prop on every flip, which no other arm pays (T02 review
 * NIT). `matchContents` sizes these hosts to their content, so they need no
 * `n`-derived height (unlike {@link stackStyle}, whose fixed rows would clip a
 * control taller than {@link ROW_HEIGHT}).
 */
export const sharedHostStyle = { width: '100%' as const };
