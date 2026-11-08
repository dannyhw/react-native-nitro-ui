/**
 * The keyboard's top edge, read out of the insets the window manager publishes.
 *
 * `Popover`'s Android keyboard claim is "the content stays above the keyboard", which can
 * only be checked against the keyboard's own top edge: the keyboard is 306 px tall on one
 * system image and 883 on another, so a hardcoded number would pass on the shallow one
 * whatever the popover did. The number the check wants is the one the popover itself has to
 * honour — the `ime` `InsetsSource` of the app's window — and it is published in the
 * `InsetsState` blocks of `dumpsys activity top`:
 *
 *     InsetsSource id=3 type=ime frame=[0,1541][1080,2424] visibleFrame=[0,1541][1080,2424] visible=true …
 *
 * Reading it off a *window* instead does not work, and the two attempts before this one are
 * the evidence. `dumpsys input_method` stopped printing a frame at all on the API 35 image,
 * and the IME's own window in `dumpsys window windows` reports `frame=[0,142][1080,2424]`
 * while the keyboard is plainly on screen: from API 30 the IME window is a full-height
 * insets host and the keyboard is a surface positioned inside it, so that frame's top is the
 * status bar. A check that read it claimed a field sat 1,400 px under a keyboard that was
 * not there — which is how a scrape that stops matching is supposed to fail loudly, and this
 * one nearly did not.
 *
 * A `null` means "this text never mentioned a visible keyboard", never "the keyboard is at
 * the top". Callers fail their own claim on `null`, so a release that renames the line turns
 * into a red gate rather than a no-op.
 */

/**
 * One `InsetsSource` line for the IME, with the frame it carries.
 *
 * `type=ime` is matched exactly rather than as a substring of the type list: `navigationBars`
 * and `mandatorySystemGestures` lines sit beside it and both carry a bottom frame that would
 * make a wrong answer look plausible.
 */
const IME_SOURCE =
  /InsetsSource\b[^\n]*?\btype=ime\b[^\n]*?\bframe=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\][^\n]*?\bvisible=(true|false)/g;

/**
 * The keyboard's top edge in px, or `null` when this text says nothing.
 *
 * The smallest top among the visible sources wins: a dump can carry one block per activity,
 * and the strictest answer is the one that cannot turn "above the keyboard" into a pass by
 * measuring against a keyboard that is not the tallest one. A source that is not visible, or
 * that has no height, says nothing — that is the IME's window sitting ready with no keyboard
 * in it, whose frame is the whole screen.
 *
 * @param {string} text the output of `dumpsys activity top`, or one `InsetsState` block
 * @returns {number | null}
 */
export function imeInsetTop(text) {
  let top = null;
  for (const match of String(text).matchAll(IME_SOURCE)) {
    if (match[5] !== 'true') {
      continue;
    }
    const sourceTop = Number(match[2]);
    const bottom = Number(match[4]);
    if (bottom <= sourceTop) {
      continue;
    }
    if (top === null || sourceTop < top) {
      top = sourceTop;
    }
  }
  return top;
}

/**
 * The `type=ime` lines a dump carries, for the check that fails when there are none.
 *
 * Every dumpsys scrape ends the same way: the format changes, the pattern stops matching, and
 * a `null` quietly turns the rule into a no-op. The caller's failure names these lines, so the
 * next reader fixes the pattern instead of the claim.
 *
 * @param {string} text the output of `dumpsys activity top`
 * @returns {string} up to two of the lines, joined and shortened
 */
export function imeInsetSample(text) {
  const lines = String(text)
    .split('\n')
    .filter((line) => /\btype=ime\b/.test(line))
    .slice(0, 2)
    .map((line) => line.trim().slice(0, 160));
  return lines.length > 0 ? lines.join(' ~ ') : 'no type=ime line at all';
}
