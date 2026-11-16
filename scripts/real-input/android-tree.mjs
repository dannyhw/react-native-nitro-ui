/**
 * Reading a hosted control’s own state out of a `uiautomator dump`.
 *
 * A witness that answers `null` cannot report a change, so a retry loop blames every
 * dropped touch and a genuinely lost change event still reads as green. Reading a dump
 * is also pure geometry: a real dump, kept as a fixture, exercises it without one.
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
 * The control’s own answer to “what value do I hold”: `checked` on the checkable node
 * that carries this labelled control.
 *
 * A hosted Compose Switch publishes its state on its own node and the label lands on
 * a child of it; the dump is flat, so document order proves nothing. It takes the
 * tightest checkable box containing the labelled one.
 * @param {ReadonlyArray<{contentDesc: string, checkable: string, checked: string, bounds: {x1: number, y1: number, x2: number, y2: number, width: number, height: number}}>} tree
 * @param {string} description the control’s `accessibilityLabel`
 * @returns {string | null} `"on"` / `"off"`, or null when no node answers
 */
export function nativeChecked(tree, description) {
  const labelled = tree.find(
    (node) => node.contentDesc === description && node.bounds.height > 0
  );
  const control = tightestFlaggedNode(tree, labelled ?? null, 'checkable');
  return control == null ? null : control.checked === 'true' ? 'on' : 'off';
}
