/**
 * Which window holds input focus, read from `dumpsys window`: the window manager's own
 * answer, which a `uiautomator` dump cannot give, because a dump only shows whatever
 * window is on top, and mid-transition that may be the launcher or a closing task.
 *
 * @file
 */

/**
 * @typedef {object} WindowFocus
 * @property {string | null} title the focused window as the window manager names it
 *   (`com.example/com.example.MainActivity`, `NotificationShade`, `PopupWindow:1a2b`),
 *   or null when no window has focus
 * @property {'activity' | 'app-window' | 'starting' | 'other' | 'none'} owner
 *   `activity`: the app's own activity window. `app-window`: a window the app put above
 *   it (a popup, a dialog), which Back dismisses. `starting`: the app's splash window,
 *   still being replaced. `other`: the launcher, the shade, another app. `none`: nothing
 *   has focus, as between two windows of a transition.
 */

/**
 * Reads only the live display contents and window list. A full `dumpsys window` opens
 * with a copy of both as they were at the last ANR, kept for two hours, whose focus
 * may name a window long gone; the live sections are the last ones printed.
 *
 * @param {string} dump the stdout of `dumpsys window displays` and `dumpsys window windows`
 *   (a full `dumpsys window` reads the same)
 * @param {string} appId the app's package
 * @returns {WindowFocus}
 */
export function readWindowFocus(dump, appId) {
  const focus = lastSection(dump, 'DISPLAY CONTENTS').match(
    /mCurrentFocus=(?:null|Window\{(\S+) u\d+ ([^\n]*)\})/
  );
  if (focus?.[1] == null) {
    return { title: null, owner: 'none' };
  }
  const [, hash, title] = focus;
  const block = windowBlock(lastSection(dump, 'WINDOWS'), hash);
  if (block == null) {
    return {
      title,
      owner: title.startsWith(`${appId}/`) ? 'activity' : 'other',
    };
  }
  if (block.package !== appId) {
    return { title, owner: 'other' };
  }
  if (block.type === 'BASE_APPLICATION') {
    return { title, owner: 'activity' };
  }
  if (block.type === 'APPLICATION_STARTING') {
    return { title, owner: 'starting' };
  }
  return { title, owner: 'app-window' };
}

/**
 * The text under the last `WINDOW MANAGER <name>` header, up to the next header.
 *
 * @param {string} dump
 * @param {string} name
 * @returns {string} empty when the dump has no such section
 */
function lastSection(dump, name) {
  const lines = dump.split('\n');
  const start = lines.findLastIndex((line) =>
    line.startsWith(`WINDOW MANAGER ${name} `)
  );
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('WINDOW MANAGER '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * The owning package and window type of one window in the dump's window list.
 *
 * @param {string} dump
 * @param {string} hash the window's identity hash, as `Window{<hash> ...}` prints it
 * @returns {{ package: string | null, type: string | null } | null}
 */
function windowBlock(dump, hash) {
  const lines = dump.split('\n');
  const header = new RegExp(`^\\s*Window #\\d+ Window\\{${hash} `);
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return null;
  let pkg = null;
  let type = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*Window #\d+ Window\{/.test(line)) break;
    pkg ??= line.match(/\bpackage=(\S+)/)?.[1] ?? null;
    type ??= line.match(/\bty=([A-Z_]+)/)?.[1] ?? null;
  }
  return { package: pkg, type };
}
