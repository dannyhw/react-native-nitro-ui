/**
 * Types for `uiautomator.mjs`, which is plain JavaScript with JSDoc comments.
 *
 * The module stays JavaScript on purpose — a device gate must not depend on a build
 * step — and the typecheck program does not read JavaScript. This is the bridge for
 * its TypeScript consumers in `example/e2e`, and nothing more: a new export needs
 * adding here before a typed caller can use it.
 */

/** One node of a `uiautomator dump`, with every flag kept as the string the dump wrote. */
export interface UiautomatorNode {
  text: string;
  resourceId: string;
  className: string;
  contentDesc: string;
  enabled: string;
  clickable: string;
  longClickable: string;
  focusable: string;
  checkable: string;
  checked: string;
  selected: string;
  scrollable: string;
  bounds: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    cx: number;
    cy: number;
    width: number;
    height: number;
  };
}

/** The nodes a dump describes, in tree order. */
export function parseHierarchy(xml: string): UiautomatorNode[];

/** Every node whose `content-desc` is exactly `description`. */
export function findAllByDescription(
  nodes: ReadonlyArray<UiautomatorNode>,
  description: string
): UiautomatorNode[];

/** Every node whose `text` is exactly `text`. */
export function findAllByText(
  nodes: ReadonlyArray<UiautomatorNode>,
  text: string
): UiautomatorNode[];

/** The first node carrying a `testID`, or `undefined`. */
export function findByTestId(
  nodes: ReadonlyArray<UiautomatorNode>,
  testID: string
): UiautomatorNode | undefined;
