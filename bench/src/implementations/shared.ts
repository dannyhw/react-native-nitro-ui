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

/** One host tall enough for the whole batch, for the shared-host arms. */
export function stackStyle(n: number) {
  return { height: ROW_HEIGHT * n, width: '100%' as const };
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
