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
  if (labelled == null) {
    return null;
  }
  /** @type {{area: number, checked: string} | null} */
  let tightest = null;
  for (const node of tree) {
    if (node.checkable !== 'true') {
      continue;
    }
    const { bounds } = node;
    const contains =
      bounds.x1 <= labelled.bounds.x1 &&
      bounds.y1 <= labelled.bounds.y1 &&
      bounds.x2 >= labelled.bounds.x2 &&
      bounds.y2 >= labelled.bounds.y2;
    if (!contains) {
      continue;
    }
    const area = bounds.width * bounds.height;
    if (tightest == null || area < tightest.area) {
      tightest = { area, checked: node.checked };
    }
  }
  return tightest == null ? null : tightest.checked === 'true' ? 'on' : 'off';
}
