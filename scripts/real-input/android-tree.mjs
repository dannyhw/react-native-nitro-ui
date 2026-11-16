/**
 * Reading a hosted control's own state out of a `uiautomator dump`.
 *
 * Split from `android.mjs` for the same reason `ios-log.mjs` exists: the script
 * boots nothing without a device, and this function's failure mode is silence. A
 * witness that answers `null` cannot report a change, so a retry loop blames every
 * dropped touch and a genuinely lost change event still reads as green. Reading a
 * dump is also pure geometry, so it is worth having on its own: a real dump, kept
 * as a fixture, exercises it without an emulator.
 */

/**
 * The tightest node carrying a boolean flag that contains a target node.
 *
 * The dump is flat and the name and the state of a control live on different nodes,
 * so "which node is the control" is answered by geometry: the smallest box that
 * carries the flag and still contains the labelled node.
 *
 * @param {ReadonlyArray<object>} tree the parsed dump
 * @param {{bounds: {x1: number, y1: number, x2: number, y2: number}} | null} target
 * @param {'checkable' | 'clickable'} flag
 * @returns {object | null} the node, or null when nothing with that flag contains it
 */ export function tightestFlaggedNode(tree, target, flag) {
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
 * The same shape as {@link nativeChecked}, for the same reason: a disabled Material 3
 * chip publishes `enabled="false"` on its touch-target node, and the node inside it
 * carrying the control's name says `enabled="true"` — so reading the labelled node
 * reports every disabled control as enabled.
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
