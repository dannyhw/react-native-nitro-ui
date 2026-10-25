/**
 * The slice of `uiautomator dump` output the Android real-input checks need.
 *
 * `uiautomator dump` prints the *accessibility* tree, not the view tree, which
 * decides how the checks are allowed to find things (verified against a dump of
 * the running example app, not from documentation):
 *
 * - A React Native view's `testID` shows up as `resource-id`, so the on-screen
 *   `Text` echoes (which are RN views) are found by the same identifier iOS uses.
 * - A hosted Compose control is *not* an RN view in that tree: Compose publishes
 *   its own semantics node, and the Nitro views put `accessibilityLabel` into
 *   `contentDescription`, so a control is found by `content-desc`. `testID`
 *   cannot work there: React Native stores it as a view tag, and tags are not
 *   part of the accessibility tree.
 * - Nodes scrolled off screen are absent, so every element a check finds is one
 *   a person could actually see and touch.
 */

/**
 * @typedef {object} UiautomatorNode
 * @property {string} text
 * @property {string} resourceId
 * @property {string} className
 * @property {string} contentDesc
 * @property {string} enabled
 * @property {string} clickable
 * @property {string} selected
 * @property {{ x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, width: number, height: number }} bounds
 */

/**
 * @param {string} xml
 * @returns {UiautomatorNode[]}
 */
export function parseHierarchy(xml) {
  return [...xml.matchAll(/<node\b([^>]*?)\/?>/g)].map((match) => {
    /** @type {Record<string, string>} */
    const attributes = {};
    for (const pair of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes[pair[1]] = unescapeXml(pair[2]);
    }
    return {
      text: attributes.text ?? '',
      resourceId: attributes['resource-id'] ?? '',
      className: attributes.class ?? '',
      contentDesc: attributes['content-desc'] ?? '',
      enabled: attributes.enabled ?? '',
      clickable: attributes.clickable ?? '',
      selected: attributes.selected ?? '',
      bounds: parseBounds(attributes.bounds ?? ''),
    };
  });
}

/**
 * @param {string} value e.g. `[42,775][870,826]`
 * @returns {UiautomatorNode['bounds']}
 */
function parseBounds(value) {
  const match = value.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (match == null) {
    return { x1: 0, y1: 0, x2: 0, y2: 0, cx: 0, cy: 0, width: 0, height: 0 };
  }
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return {
    x1,
    y1,
    x2,
    y2,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    width: x2 - x1,
    height: y2 - y1,
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function unescapeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * The element a check reads a value from: an RN `Text` carrying this `testID`.
 *
 * @param {UiautomatorNode[]} nodes
 * @param {string} testID
 * @returns {UiautomatorNode | undefined}
 */
export function findByTestId(nodes, testID) {
  return nodes.find((node) => node.resourceId === testID);
}

/**
 * A hosted control, found by the `accessibilityLabel` the library publishes.
 *
 * @param {UiautomatorNode[]} nodes
 * @param {string} description
 * @returns {UiautomatorNode | undefined}
 */
export function findByDescription(nodes, description) {
  return nodes.find((node) => node.contentDesc === description);
}

/**
 * The example app's tab bar.
 *
 * A `Pressable`'s `testID` lands on either the wrapper or its inner `Text`
 * depending on the dump, so the tab is matched on the label it renders instead -
 * restricted to the top band of the screen, because a screen titled "Slider" is
 * not the tab labelled "Slider". A label that appears twice in the band is
 * treated as no label at all rather than guessed at.
 *
 * @param {UiautomatorNode[]} nodes
 * @param {string} label
 * @param {number} bandY only nodes starting above this y are tabs
 * @returns {UiautomatorNode | undefined}
 */
export function findTab(nodes, label, bandY) {
  const matches = nodes.filter(
    (node) => node.text === label && node.bounds.y1 < bandY
  );
  return matches.length === 1 ? matches[0] : undefined;
}
