/**
 * Reading a hosted control's own state out of a `uiautomator dump`.
 *
 * Split from `android.mjs` for the same reason `ios-log.mjs` exists: the script
 * boots nothing without a device, and this function's failure mode is silence.
 * A witness that returns `null` cannot report a change, so `pressUntil` would
 * attribute every retry to a dropped touch and a genuinely lost change event
 * would still go green - the exact hole F1 M3 closes. That has to be testable
 * against a real dump, and a test needs an import. See
 * `scripts/__tests__/real-input-android-tree.test.js`.
 */

/**
 * The tightest node carrying a boolean flag that contains a target node.
 *
 * The dump is flat, so document order is an accident of how the tree happens to be
 * written and "which node is the control" has to be answered by geometry. Measured
 * across three control shapes so far, the name and the state live on different
 * nodes: a hosted Switch keeps `checkable` on its own box with the label inside it,
 * a Material 3 Chip keeps `enabled` on the 48 dp touch target with the label inside
 * that, and a `ButtonGroup` item keeps `clickable`/`checkable`/`checked` on its own
 * box with the *title* drawn as a separate `TextView` inside it. Reading whichever
 * node happens to carry the name therefore answers the wrong question — `off` for a
 * checked toggle, `enabled=true` for a disabled item.
 *
 * The tightest *containing* box is the answer because it is the smallest thing that
 * still is the control. A decoration node does not carry the flag — Compose writes
 * `Role.Checkbox` as an `android.widget.CheckBox` a hair inside the item, and that
 * node says `checkable="false"` — and a larger box is somebody else's: the row, the
 * screen.
 *
 * @param {ReadonlyArray<object>} tree the parsed dump
 * @param {{bounds: {x1: number, y1: number, x2: number, y2: number}} | null} target
 * @param {'checkable' | 'clickable'} flag
 * @returns {object | null} the node, or null when nothing with that flag contains it
 */
export function tightestFlaggedNode(tree, target, flag) {
  if (target == null) {
    return null;
  }
  /** @type {{area: number, node: object} | null} */
  let tightest = null;
  for (const node of tree) {
    if (node[flag] !== 'true') {
      continue;
    }
    const { bounds } = node;
    const contains =
      bounds.x1 <= target.bounds.x1 &&
      bounds.y1 <= target.bounds.y1 &&
      bounds.x2 >= target.bounds.x2 &&
      bounds.y2 >= target.bounds.y2;
    if (!contains) {
      continue;
    }
    const area = bounds.width * bounds.height;
    if (tightest == null || area < tightest.area) {
      tightest = { area, node };
    }
  }
  return tightest == null ? null : tightest.node;
}

/**
 * The control's own answer to "what value do I hold": `checked` on the checkable
 * node that carries this labelled control.
 *
 * A hosted Compose Switch publishes its state on its own accessibility node, and
 * the label the library sets lands on a *child* of it. Measured in a dump of the
 * running app: the parent is `checkable="true" checked="false"` at
 * `[901,738][1038,864]`, and the node carrying `content-desc="Controlled switch"`
 * is `checkable="false"` at `[901,759][1038,843]`. So this cannot simply read the
 * labelled node, and cannot walk backwards to the first checkable node it finds
 * either - the dump is flat, so document order is an accident of how the tree
 * happens to be written. It takes the tightest checkable box that *contains* the
 * labelled one, which is the node that actually is the control.
 *
 * @param {ReadonlyArray<{contentDesc: string, checkable: string, checked: string, bounds: {x1: number, y1: number, x2: number, y2: number, width: number, height: number}}>} tree
 * @param {string} description the control's `accessibilityLabel`
 * @returns {string | null} `"on"` / `"off"`, or null when no node answers
 */
export function nativeChecked(tree, description) {
  const labelled = tree.find(
    (node) => node.contentDesc === description && node.bounds.height > 0
  );
  const control = tightestFlaggedNode(tree, labelled ?? null, 'checkable');
  return control == null ? null : control.checked === 'true' ? 'on' : 'off';
}

/**
 * Whether the control a person would press is enabled: `enabled` on the tightest
 * *clickable* node that carries this labelled control.
 *
 * The same shape as {@link nativeChecked}, for the same reason, measured on G12's
 * Chip screen: a disabled Material 3 chip publishes `enabled="false"` on its 48 dp
 * touch-target node at `[562,738][964,864]`, and the node carrying
 * `content-desc="Real-input disabled chip"` inside it at `[562,759][964,843]` says
 * `enabled="true"` - so reading the labelled node reports every disabled chip as
 * enabled.
 *
 * @param {ReadonlyArray<{contentDesc: string, clickable: string, enabled: string, bounds: {x1: number, y1: number, x2: number, y2: number, width: number, height: number}}>} tree
 * @param {string} description the control's `accessibilityLabel`
 * @returns {string | null} `"true"` / `"false"`, or null when no clickable node
 *   carries the control
 */
export function nativeEnabled(tree, description) {
  const labelled = tree.find(
    (node) => node.contentDesc === description && node.bounds.height > 0
  );
  const control = tightestFlaggedNode(tree, labelled ?? null, 'clickable');
  return control == null ? null : control.enabled;
}
