/**
 * The CocoaPods-stamp logic, apart from the CLI that uses it.
 *
 * `pod-install.mjs` resolves repo paths through `import.meta`, and a module
 * containing `import.meta` cannot be evaluated by jest's CommonJS transform at
 * all - the same split `scripts/bench/render.mjs` documents against
 * `report.mjs`. So the decisions live here, where
 * `scripts/__tests__/pod-install.test.js` can test them without pods.
 */

/**
 * The `COCOAPODS:` trailer of a Podfile.lock, or null when there is none.
 * @param {string | null} lockText
 * @returns {string | null}
 */
export function cocoapodsStamp(lockText) {
  if (lockText == null) return null;
  const match = /^COCOAPODS: [^\S\n]*(\S+)[^\S\n]*$/m.exec(lockText);
  return match == null ? null : match[1];
}

/**
 * Put the recorded CocoaPods stamp back, but only when the stamp is *all* that
 * changed.
 *
 * @param {string | null} beforeText the lock as it was before the install
 * @param {string} afterText the lock as `pod` wrote it
 * @returns {{ text: string, changed: boolean, stampOnly: boolean, from: string | null, to: string | null }}
 *   `text` is what to write back; `stampOnly` is true when the only difference
 *   was the tool version and `text` is therefore the original text.
 */
export function reconcileCocoapodsStamp(beforeText, afterText) {
  const from = cocoapodsStamp(beforeText);
  const to = cocoapodsStamp(afterText);
  if (beforeText == null || beforeText === afterText) {
    return { text: afterText, changed: false, stampOnly: false, from, to };
  }
  if (from != null && to != null && from !== to) {
    const rewritten = afterText.replace(
      /^COCOAPODS: [^\S\n]*\S+[^\S\n]*$/m,
      `COCOAPODS: ${from}`
    );
    if (rewritten === beforeText) {
      return { text: beforeText, changed: true, stampOnly: true, from, to };
    }
  }
  return { text: afterText, changed: true, stampOnly: false, from, to };
}

/**
 * The CocoaPods version to aim for: the target lock's own stamp, else the
 * repository's (a generated consumer app has no lock of its own yet).
 *
 * @param {{ targetLockText: string | null, repoLockText?: string | null }} options
 * @returns {string | null}
 */
export function pinnedCocoapods({ targetLockText, repoLockText = null }) {
  return cocoapodsStamp(targetLockText) ?? cocoapodsStamp(repoLockText);
}

/**
 * Pick the command to install with, as `[file, ...args]` (no shell: the caller's
 * environment is already the one to honour).
 *
 * @param {object} options
 * @param {string | null} options.pin the CocoaPods version to prefer
 * @param {(cmd: string[]) => { ok: boolean, version?: string }} options.probe
 * @param {boolean} options.hasGemfile whether bundler can resolve one here
 * @param {string | undefined} options.override `COCOAPODS_BIN`
 * @returns {{ cmd: string[], why: string }}
 */
export function choosePodCommand({ pin, probe, hasGemfile, override }) {
  if (override != null && override.trim() !== '') {
    return { cmd: override.trim().split(/\s+/), why: 'COCOAPODS_BIN' };
  }
  if (pin != null) {
    // Ruby's `gem version` syntax: exact, and needs no shell profile or bundler.
    const gem = probe(['pod', `_${pin}_`]);
    if (gem.ok)
      return { cmd: ['pod', `_${pin}_`], why: `gem ${pin} installed` };
  }
  if (hasGemfile) {
    const bundled = probe(['bundle', 'exec', 'pod']);
    if (bundled.ok && (pin == null || bundled.version === pin)) {
      return { cmd: ['bundle', 'exec', 'pod'], why: 'Gemfile resolves it' };
    }
  }
  return {
    cmd: ['pod'],
    why: pin == null ? 'pod on PATH' : `pod on PATH, not ${pin}`,
  };
}
