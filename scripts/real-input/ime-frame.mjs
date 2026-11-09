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

/**
 * ---------------------------------------------------------------------------
 * The same edge, read from the input method service instead of the window
 * (added by G24, for `Form`'s keyboard check)
 * ---------------------------------------------------------------------------
 *
 * `imeInsetTop` answers what *this app's window* was told to avoid, which is the edge a
 * control has to honour. The IME service answers the same edge from the other side, and
 * the two are worth having beside each other: one is what the component saw
 * (`WindowInsetsCompat.Type.ime()`), the other is what the keyboard really occupies, so a
 * control that moved a field above one and not the other is visible in the log rather than
 * silently right.
 *
 * The shape, at the end of `dumpsys input_method`, printed by the service itself:
 *
 *     Last computed insets:
 *       contentTopInsets=2424 visibleTopInsets=1399 touchableRegion=SkRegion((0,1399,1080,2156)) …
 *
 * `mInputShown=true` is read first, and is not decoration. That block is the *last computed*
 * insets: it keeps printing after the keyboard goes away (`visibleTopInsets=2156` with an
 * empty `touchableRegion` on the lease's API 35 AVD — the bottom of the keyboard's own
 * rectangle, which is a nonsense top edge). A reader that skipped the flag took the edge of
 * a hidden keyboard for a shown one, which is how S6b round 2 reported a field sitting
 * "below" a keyboard that was not on screen.
 */

/** Whether the service says it put an input view on screen. */
const IME_INPUT_SHOWN = /\bmInputShown=true\b/;

/** The `Last computed insets:` block, whose first line carries the two top insets. */
const IME_LAST_COMPUTED_INSETS =
  /Last computed insets:[^\n]*\n[^\n]*?\bvisibleTopInsets=(-?\d+)\b/;

/**
 * Whether this `dumpsys input_method` says the software keyboard is on screen.
 *
 * `true` distinguishes a real keyboard from the floating toolbar an AVD with a hardware
 * keyboard answers a focused field with, which is the difference S6b question 5 is about.
 *
 * @param {string} text the output of `dumpsys input_method`
 * @returns {boolean}
 */
export function imeServiceShown(text) {
  return IME_INPUT_SHOWN.test(String(text));
}

/**
 * The keyboard's top edge in px from the IME service's own insets, or `null`.
 *
 * `null` means "this text does not say": no input view on screen, or the block moved. It is
 * never "the keyboard is at the top" — `0` is a legal edge (a fullscreen extract-mode IME
 * starts there) and is returned as `0`.
 *
 * @param {string} text the output of `dumpsys input_method`
 * @returns {number | null}
 */
export function imeServiceTopPx(text) {
  const dump = String(text);
  if (!imeServiceShown(dump)) {
    return null;
  }
  const insets = dump.match(IME_LAST_COMPUTED_INSETS);
  if (insets == null) {
    return null;
  }
  const top = Number(insets[1]);
  return Number.isFinite(top) ? top : null;
}

/**
 * The lines a wrong answer was read from, for the caller's failure message.
 *
 * Same rule as {@link imeInsetSample}: a scrape that stops matching has to fail loudly, so
 * the failure names what the dump actually said instead of reporting a keyboard that is not
 * there.
 *
 * @param {string} text the output of `dumpsys input_method`
 * @returns {string}
 */
export function imeServiceSample(text) {
  const dump = String(text);
  const shown = IME_INPUT_SHOWN.test(dump)
    ? 'mInputShown=true'
    : 'mInputShown is not true';
  const insets = dump.match(IME_LAST_COMPUTED_INSETS);
  return insets == null
    ? `${shown}, no "Last computed insets:" block with visibleTopInsets`
    : `${shown}, ${insets[0].split('\n').pop().trim().slice(0, 160)}`;
}
