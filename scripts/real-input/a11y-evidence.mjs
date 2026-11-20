/**
 * What a red a11y sweep case leaves behind: the dump its verdict was made on, a
 * screenshot taken straight after, and, for a name with no box, the nearest ancestor
 * that was drawn. The device overwrites its own dump file on the next read, so without
 * this a failure can only be told apart from a read taken mid-layout by running it again.
 *
 * @file
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseHierarchy } from './uiautomator.mjs';

/** The folder, inside the run's output folder, a red case's files are written to. */
export const EVIDENCE_DIR = 'a11y-sweep';

/** @param {import('./uiautomator.mjs').UiautomatorNode} node */
const drawn = (node) => node.bounds.width > 0 && node.bounds.height > 0;

/** @param {import('./uiautomator.mjs').UiautomatorNode['bounds']} b */
const formatBounds = (b) =>
  `[${String(b.x1)},${String(b.y1)}][${String(b.x2)},${String(b.y2)}]`;

/**
 * When `label` is in the tree only on nodes with no box, the nearest ancestor of the
 * first of them that has one. `null` when the name has a box somewhere, or is absent.
 *
 * @param {string} xml one `uiautomator dump`
 * @param {string} label
 * @returns {{ bounds: string, className: string, resourceId: string } | null | undefined}
 *   `undefined` when no ancestor of the named node has a box either
 */
export function drawnAncestor(xml, label) {
  /** @type {import('./uiautomator.mjs').UiautomatorNode[]} */
  const stack = [];
  /** @type {import('./uiautomator.mjs').UiautomatorNode[] | null} */
  let ancestors = null;
  for (const match of xml.matchAll(/<node\b[^>]*?(\/?)>|<\/node>/g)) {
    if (match[0] === '</node>') {
      stack.pop();
      continue;
    }
    const [node] = parseHierarchy(match[0]);
    if (node.contentDesc === label) {
      if (drawn(node)) return null;
      ancestors ??= [...stack];
    }
    if (match[1] !== '/') stack.push(node);
  }
  if (ancestors == null) return null;
  const ancestor = ancestors.findLast(drawn);
  return ancestor == null
    ? undefined
    : {
        bounds: formatBounds(ancestor.bounds),
        className: ancestor.className,
        resourceId: ancestor.resourceId,
      };
}

/**
 * Write a red case's dump and screenshot into `out`, and say where they went.
 *
 * The screenshot goes through `adbShell` like every other read in the sweep. A shell's
 * stdout is text, so the PNG crosses as base64 from a file on the device.
 *
 * @param {object} options
 * @param {string} options.out the run's output folder
 * @param {string} options.id the case id, which names the files
 * @param {string} options.label the name the case looks for
 * @param {string} options.xml the dump the verdict was made on
 * @param {(command: string) => string} options.adbShell
 * @returns {string} one sentence for the case's log line
 */
export function keepSweepEvidence({ out, id, label, xml, adbShell }) {
  const dir = path.join(out, EVIDENCE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const xmlFile = path.join(EVIDENCE_DIR, `${id}.xml`);
  const pngFile = path.join(EVIDENCE_DIR, `${id}.png`);
  fs.writeFileSync(path.join(out, xmlFile), xml);
  const parts = [`final dump ${xmlFile}`];
  try {
    const remote = '/sdcard/nitro-ui-a11y-sweep.png';
    adbShell(`screencap -p ${remote}`);
    const png = Buffer.from(adbShell(`base64 ${remote}`), 'base64');
    fs.writeFileSync(path.join(out, pngFile), png);
    parts.push(`screenshot ${pngFile}`);
  } catch (error) {
    parts.push(
      `no screenshot (${String(/** @type {Error} */ (error)?.message ?? error).slice(0, 200)})`
    );
  }
  const ancestor = drawnAncestor(xml, label);
  if (ancestor === undefined) {
    parts.push(`no ancestor of "${label}" has a box either`);
  } else if (ancestor != null) {
    parts.push(
      `nearest drawn ancestor of "${label}": ${ancestor.bounds} ` +
        `${ancestor.className} resource-id "${ancestor.resourceId}"`
    );
  }
  return `evidence in the output folder: ${parts.join('; ')}`;
}

/**
 * Remove the last run's evidence, so the folder only ever holds this run's red cases.
 *
 * @param {string} out
 */
export function clearSweepEvidence(out) {
  fs.rmSync(path.join(out, EVIDENCE_DIR), { recursive: true, force: true });
}
