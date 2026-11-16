/**
 * Counting an app's popup windows in `dumpsys window windows`: the oracle for "the
 * window came down with the control that owned it", readable while the driver holds
 * the device's accessibility connection, because the window manager is not behind it.
 *
 * @file
 */

/**
 * The app's own popup windows in one `dumpsys window windows` print.
 *
 * The window's class is on its header line and the owning package a few lines later,
 * so a window counts once both are seen.
 *
 * @param {string} dump the command's stdout
 * @param {string} appId the package whose popups count
 * @returns {number}
 */
export function countAppPopupWindows(dump, appId) {
  let count = 0;
  let isPopup = false;
  let namesApp = false;
  const flush = () => {
    if (isPopup && namesApp) {
      count += 1;
    }
  };
  for (const line of dump.split('\n')) {
    const header = line.match(/^\s*Window #\d+ Window\{([^}]*)\}/);
    if (header != null) {
      flush();
      isPopup = header[1].includes('Pop-Up');
      namesApp = header[1].includes(appId);
      continue;
    }
    if (isPopup && !namesApp && line.includes(appId)) {
      namesApp = true;
    }
  }
  flush();
  return count;
}
