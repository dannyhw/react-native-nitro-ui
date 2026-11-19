FIX ROUND

# FIX15 review (2f65e49a, base 4cf99e54)

`check` run once here: PASS, 18 steps, 72 s. No device runs. PR #106: no CodeRabbit review (rate-limited).

## Answers

**Q1. Barely, and not for the keyboard.** The example is edge-to-edge (`gradle.properties:51`), as is
every targetSdk 36 app on Android 16 (`WindowUtil.kt:45-68`), so the window and the ScrollView do not
shrink for the IME. `ReactScrollView.requestChildFocus`/`requestChildRectangleOnScreen`
(`ReactScrollView.kt:479-502`) measure against the scroll view's own height. Before this change, a
field tapped low in an opted-out Form (it must be visible to be tapped) gave a delta of 0: no scroll,
and the field ended up behind the keyboard, as `form.md:194-199` says. The scroll view moved only for
focus landing outside its viewport: IME "Next", Tab, `focus()`, a field clipped by the bottom edge, a
multiline cursor growing past it. Even then it moved only as far as the viewport's bottom edge, never
clear of the keyboard. That contradicts the letter of "no scroll for the focused row", but it is
ordinary ScrollView focus scrolling, not keyboard avoidance. On a window that does resize (no
edge-to-edge, Android 14 and older or opted out on 15), AOSP `ScrollView.onSizeChanged` scrolls the
focused view into the shrunk viewport. `ReactScrollView.onSizeChanged` (`:435`) calls super and
`scrollsChildToFocus` does not gate it, so an opted-out Form still moves for the keyboard there, before
and after this change.

**Q2. Nobody is stranded, but the documented opt-out recipe breaks.** TalkBack linear navigation and
Switch Access reach rows below the fold through `ACTION_SCROLL_FORWARD/BACKWARD`. `ScrollView` handles
those with `smoothScrollTo`, and `ReactScrollViewAccessibilityDelegate` overrides only node info and
events, so they are untouched. Lost: `ACTION_SHOW_ON_SCREEN` and Compose `bringIntoView`, so a row half
under the edge stays half shown. D-pad up/down mostly still scroll through `ScrollView.arrowScroll`
(`doScrollY`), unless the focused content consumes the key and moves focus itself. What does break is
any input-focus move to a row outside the viewport: Tab, IME Next, `focus()` (for example "focus the
first invalid field"). Focus lands on a field the user cannot see and nothing scrolls. See M1.

**Q3.** Yes: a field read per request (`ReactScrollView.kt:333,480,500`), applied by Fabric on change,
reset by `initView` on recycle (`:263`). The default path passes `true`, which is the manager's `defaultBoolean`
(`ReactScrollViewManager.kt:107`), so behaviour is identical. `revealFocusedRow` uses `scrollBy`
directly and is untouched.

**Q4.** The case is sound: `rectReqs` shows the command ran and `rectBelow` holds the premise. The
control case proves the request reaches the scroller (1056 dp), and the three mutations are distinct
and each one bites. Nothing is loosened, and the 1 s waits back an assertion that nothing happened.
The commands cost nothing until called. The counters reset in both `prepareForRecycle` and
`onDropView` (`HybridNitroUiForm.kt:99,109`). The opted-out baseline is the default offset of 0 (N4).

**Q5.** Leaving the case out is sound (FIX10 M2: a request cannot move a row inside the viewport),
but the FOLLOWUPS text contradicts itself (N3). **Q6.** 7 files, none out of scope, one author,
nothing personal; comments and prop doc are for app developers, the changeset is not (M2).

## Findings

**M1. Opting out now stops the Form scrolling for Tab, IME Next and `focus()`, which breaks the opt-out
recipe the docs give.** `Form.tsx:228`. `form.md:197-199` tells an opted-out app to "reserve the room in
your own layout". For example, a `KeyboardAvoidingView` around the Form shrinks the Form's ScrollView.
`onSizeChanged` still brings the focused field into the shrunk viewport, but pressing Next to a field
below it now goes through `requestChildFocus`, which returns early on `scrollsChildToFocus` (`:480`),
and its cursor request is refused at `:500`. The user types into a field below the fold. Before this
change it scrolled into view above the keyboard. The app cannot "scroll the row yourself" either:
`Form` hands its ScrollView no ref and no scroll API (`Form.tsx:218-235`). Per Q1, the change buys
nothing for the keyboard appearing on an edge-to-edge window, and on a resizing window it misses the
`onSizeChanged` scroll. The narrower fixes the brief suggests do not help. Blocking only while the IME
inset is up still blocks Next, because Next happens with the IME up. Blocking only the editor that
holds input focus still blocks Next's target editor. Recommended: drop `scrollsChildToFocus`. Keep the
`ime:`/`rect:` commands and the report fields. Point the opted-out case at what the Form itself does
for the keyboard: the content height holding under an inset (mutation 2 already bites), and no
`revealFocusedRow` lift for a focused row inside the viewport but behind the inset (mutation: drop
`!hybrid.avoidsKeyboardForIme` at `HybridNitroUiForm.kt:321`). Then let `form.md:195` say what is
true: the scroll view still brings a focused row into its own viewport, as any ScrollView does, and
that viewport ignores the keyboard.

**M2. The changeset ships a false claim.** `.changeset/form-keyboard-opt-out-stops-the-scroll-view.md:5`
says "so a keyboard coming up over a Form that opted out leaves its scroll offset where it was". On an
edge-to-edge window it already did. On a resizing window it still does not (`onSizeChanged`, Q1). It
names none of the cost in M1, explains the platform's mechanism instead of the effect, and ends without
a full stop. If M1 is taken, delete it. Otherwise rewrite it to state the cost.

**N1.** `FIX15.report.md:15` says d-pad and TalkBack focus stop scrolling; they mostly do not (Q2).
Next and `focus()` do stop, and the report does not name them.

**N2.** `Form.tsx:226-227` says "the only switch for a Form that must not move"; `onSizeChanged` is
not behind it. If M1 is not taken, `form.md:41` must say focus scrolling goes too.

**N3. The FOLLOWUPS entry contradicts itself.** `FOLLOWUPS.md:43-45,54` explains the lost node by "a
keyboard standing over its node", yet records both failures "with no keyboard on screen". A row at
y 1954 in a 2424 px viewport with no keyboard is in view, so the cause is still unknown. Say that, and
say that the `form-list-geometry` echo is a guess.

**N4. A baseline of 0 is also the answer.** A `scroll=` that never moves passes the opted-out case;
only the control case catches it. Start it from a non-zero offset (`nuiTestScrollTo`).

**N5.** `HybridNitroUiForm.kt:409-439` overrides and comments stay false (already a follow-up).
