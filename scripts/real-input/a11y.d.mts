/**
 * Types for `a11y.mjs` — the screen-reader rule — for its TypeScript consumers in
 * `example/e2e`. Same arrangement as `uiautomator.d.mts`: the rule stays JavaScript,
 * unit-tested against measured dumps, and this file only names what a typed caller
 * may reach.
 */

import type { UiautomatorNode } from './uiautomator.mjs';

/** One control's a11y case: the label to look for, its screen, and the rule's shape. */
export interface A11yControl {
  id: string;
  component: string;
  hybridView: string;
  screen: string;
  label: string;
  role: 'interactive' | 'indicator' | 'container';
  hosted?: boolean;
  anchorTestId?: string;
}

/** Every case the Android sweep runs, in the order it runs them. */
export const A11Y_CONTROLS: ReadonlyArray<A11yControl>;

/**
 * One control's rule, with what it found split into new failures and recorded debt.
 *
 * `failures` has to go red; `known` matched a row of `A11Y_EXEMPTIONS` and is printed
 * instead, which is why a caller may not read an empty `failures` as a clean pass.
 */
export function checkControlA11y(
  control: A11yControl,
  tree: ReadonlyArray<UiautomatorNode>,
  platform?: 'android' | 'ios'
): { failures: string[]; known: string[]; exempt: boolean };
