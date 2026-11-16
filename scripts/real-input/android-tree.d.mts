/**
 * Types for `android-tree.mjs` — reading a control's state out of a `uiautomator
 * dump`. Same arrangement as `uiautomator.d.mts`: the rule stays JavaScript and
 * unit-tested, and this names only what a typed caller may reach.
 */

import type { UiautomatorNode } from './uiautomator.mjs';

/** The smallest node containing `target` that carries `flag="true"`. */
export function tightestFlaggedNode(
  tree: ReadonlyArray<UiautomatorNode>,
  target: UiautomatorNode | null,
  flag: 'checkable' | 'clickable'
): UiautomatorNode | null;

/** `"on"` / `"off"` on the checkable node carrying this control, or null. */
export function nativeChecked(
  tree: ReadonlyArray<UiautomatorNode>,
  description: string
): 'on' | 'off' | null;

/** `"true"` / `"false"` on the clickable node carrying this control, or null. */
export function nativeEnabled(
  tree: ReadonlyArray<UiautomatorNode>,
  description: string
): 'true' | 'false' | null;
