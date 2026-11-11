import { createContext, useContext } from 'react';
import type { ViewStyle } from 'react-native';

/**
 * Whether the nearest content box above this component is a `Form.Row`'s.
 *
 * `Form.Row` sets it for its own content; `Form` clears it for its body (a `Form` inside a row
 * is a new list, not a row inside the outer row), and anything that presents app content
 * outside the tree it was written in clears it too — that content is not the row's to lay out.
 *
 * Read it with {@link useSelfSizingBaseStyle} in a control, and with {@link useInsideRow} when
 * you only want to know (the nested-row warning does).
 */
export const InsideRowContext = createContext(false);

/**
 * The two answers {@link useSelfSizingBaseStyle} can give, kept as module constants so a
 * control's style array keeps the same identity from render to render — the whole reason this
 * is a context read and not a wrapper `View`.
 */
const SELF_SIZING_BASE_STYLE = { alignSelf: 'flex-start' } as const;
const SELF_SIZING_IN_ROW_STYLE = { alignSelf: 'center' } as const;

/**
 * What a self-sizing control is laid out with, before any `style`:
 * `alignSelf: 'center'` inside a `Form.Row`, `alignSelf: 'flex-start'` anywhere else.
 *
 * `alignItems: stretch` (the default in a column) otherwise decides a control's width for it:
 * Yoga gives a stretched child the row's width as an *exact* constraint, so the measured size
 * is never even asked for and a Switch becomes a 402 pt-wide box with a 61 pt control in it.
 * React Native's own `Switch` does the same thing for the same reason
 * (`Libraries/Components/Switch/Switch.js`).
 *
 * The cross-axis rule then depends on the box the control is being centred against. Outside a
 * row there is nothing to line up with, and `flex-start` is the rule that keeps the control
 * self-sized. Inside a row the box has a height the row did not ask for — every row is at least
 * its platform's row height, and a label is shorter than that — so `flex-start` parks the
 * control on the row's top edge while its label centres, and
 * `<Form.Row><Text style={{ flex: 1 }} /><Switch /></Form.Row>` comes out with a ragged pair.
 * `center` on the control itself is what fixes that, and fixes it with no node: a child's
 * `alignSelf` is exactly the override this control needs to *not* have, and the row's own
 * `alignItems` cannot reach past it.
 *
 * It is a base style, not a forced one, both ways round: an explicit `width`, `flex`, or
 * `alignSelf` in the caller's `style` wins, because their styles are applied after this — which
 * is also why a non-nitro-ui control written into the same row keeps whatever cross-axis rule
 * it carries itself. Every control using this must put it first in the array, as
 * `style={[useSelfSizingBaseStyle(), style]}`.
 *
 * The context reaches every descendant of the row, so a control the app has put in a box of its
 * own is centred in that box, which is the box it would be centred in by the row's
 * `alignItems` if it did not carry `flex-start` either.
 */
export function useSelfSizingBaseStyle(): ViewStyle {
  return useContext(InsideRowContext)
    ? SELF_SIZING_IN_ROW_STYLE
    : SELF_SIZING_BASE_STYLE;
}

/** Is the nearest content box above this component a `Form.Row`'s? See {@link InsideRowContext}. */
export function useInsideRow(): boolean {
  return useContext(InsideRowContext);
}
