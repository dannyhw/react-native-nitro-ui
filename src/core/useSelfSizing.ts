import { createContext, useContext } from 'react';
import type { ViewStyle } from 'react-native';

/**
 * Whether the nearest content box above this component is a `Form.Row`'s.
 * `Form.Row` sets it for its content; `Form` and anything that presents app
 * content outside the tree it was written in clear it.
 */
export const InsideRowContext = createContext(false);

// Module constants, so a control's style array keeps its identity across renders.
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;
const SELF_SIZING_IN_ROW_STYLE = { alignSelf: 'center' } as const;

/**
 * The base style of a self-sizing control: `alignSelf: 'center'` inside a
 * `Form.Row`, `alignSelf: 'flex-start'` anywhere else.
 *
 * Without it a column's default `alignItems: 'stretch'` hands the control its
 * parent's width as an exact constraint, and its measured size is never asked
 * for. Inside a row, `center` lines the control up with a label that is shorter
 * than the row.
 *
 * Put it first, as `style={[useSelfSizingBaseStyle(), style]}`, so the caller's
 * `width`, `flex` or `alignSelf` wins.
 */
export function useSelfSizingBaseStyle(): ViewStyle {
  return useContext(InsideRowContext)
    ? SELF_SIZING_IN_ROW_STYLE
    : SELF_SIZING_BASE_STYLE;
}

export function useInsideRow(): boolean {
  return useContext(InsideRowContext);
}
