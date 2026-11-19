FIX ROUND

# FIX9 review, fix round 2: task/FIX9-chip-disabled-selected at 43bdc173

`check` was run once here: PASS, 18 steps. No lease was `in use (real-input:ios)`. FIX7's note
lists real-input:ios as its next step, and it was not running. `need --for review` is satisfied.
CodeRabbit has no inline comments on PR #101 after 2026-11-19T00:00Z, so none are cited. Scope is
clean: nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers.
There is one author address and nothing personal. Only `chip-ios.png` changed among the images.

## Re-review

M5 open, narrowed. The darkest ink is back: README "On" is `#C1C1C4` and "Off" is `#C0C0C3`. In
dark, both are `#535358` and `#545459`. But about half the label is still washed, and a ghost
outline now shows where the cut misses the glyphs. M7 has the cause.

M6 closed. "System background colour" is at `chip.md:82`, `:164`, the changeset and the Swift
comment; the Limits line (`chip.md:175-178`) states the off-surface case (wording: N1).

## New findings

M7. The cut does not follow the label. `HybridNitroUiChip.swift:225-233` cuts with a second copy of
`label`, laid out inside the overlay. That copy does not get what the bordered style gives the real
label. Pixel evidence from the README image (3x crop), "On" chip, row y=380:
the `n` right stem (x=194-196) reads `#D9E6F1 #CFDCE7 #CED7E0`, washed and blue where ink is
`#C1C1C4`; beside it (x=197-199) `#E2E4E7 #EAE9EB #E5EAEF` is the unwashed disabled grey, so the
hole sits about 2 px right of the stem (left stem, x=185-187: `#CCD5DD #C4C4C7 #DBDBDD`). Mapped by
blue minus red, the cut `O` is about 22 x 25 px against an ink `O` of 19 x 23: the cut text is
larger than the drawn text, a scale mismatch rather than a shift.

The likely cause is the font: the bordered style at `.controlSize(.small)` sets its label's font,
and the copy in the overlay keeps the environment's. The 2x zooms of both images show a grey or
dark halo around "On". This also explains the harness's 505 of 1038 ink pixels (M8).

Other cases: the error grows with Dynamic Type, and a leading SF Symbol scales with the font too.
A long title truncates at a different place, because the copy is offered the full width, not the
width minus the style's padding. RTL adds no error (both copies centre and mirror alike). iOS
draws no check mark, so there is no check slot to follow.

These claims are false while M7 stands: `chip.md:166-167` ("as legible as any other dimmed chip's"),
the changeset ("stopped at its label") and `:222-224` ("the label's own shape"). The retaken README
image ships the artefact.

Not hand-fixable blind. The code change is small: give the copy the style's font, or pin one font
on `label` for both copies. It still needs a harness:ios read to confirm that enabled chips do not
move, a retaken README image and a new red proof (M8).

M8. The quarter area floor is a loosened bound, and the test cannot fail for a half-washed label.
`Chip.harness.tsx:1531-1539` accepts `areaOn * 4 >= areaOff`. Its comment and the report
(report:117) say only the anti-aliased fringe keeps wash. M7 shows whole stems keep it. The
drawing that ships reaches 505 of 1038 (49 %), a label half washed, and it passes. Anything down to
26 % would pass too. The darkest-pixel check at `:1525` passes once a single pixel of the label is
uncut.

Round one's washed label still fails: `areaOn=0`, and its darkest ink is 56 fainter than the bound
of 6. The red proof stands. With an exact cut, the core strokes match and `areaOn` should be close
to `areaOff`. So the floor belongs near three quarters, red-proved against this round's drawing.
Hand-fixable only together with M7, because raising the floor turns the current drawing red.

## Fill relations (question 4)

These still hold and are still asserted (`:1467`, `:1479`, `:1485`, `:1493`). Round 2 did not touch
them, and harness:ios is green on its digest.

Light (README): enabled On `#D1EAFF` (sum 698, chroma 46), disabled On `#DFECF7` (706, 24),
disabled Off `#E9E9EB`. Dark: `#001A2E` (72, 46), `#101D28` (85, 24), `#262629`. In both, the
disabled On fill is lighter and paler than the enabled one, and 25 / 32 from disabled Off. The fade moved from 0.45 to 0.55, and the report says so.

## Nice to have

N1. The Limits line at `chip.md:175-178` has three problems:
- It does not say it is iOS only, and Android has no such limit.
- "White or black" is wrong inside a dark sheet or popover, where the system background is
  elevated grey.
- "Lighter or darker than the surface behind it" is true of any chip. The consequence that matters
  is that a disabled selected chip can become the brightest chip in its row there.

N2. Two harness comments are four lines each: `Chip.harness.tsx:1506-1509` and `:1531-1534`.
AGENTS.md "Comments" asks for one to three. The second one also gives M8's false justification.

N3. Carried over: dark appearance and a selected-disabled accessibility read stay unmeasured.

## Checked, no finding

- Hit testing, accessibility and size: the overlay has `.allowsHitTesting(false)` and is
  `.accessibilityHidden(true)` (`:237`); the mask carries no elements; neither takes part in layout.
- Identity: the `if` at `:212` sits inside `.overlay`, so the `Toggle` and its VoiceOver focus stay.
- Perf: setters untouched, no host rebuild; the copy costs one extra text layout per body pass,
  only while a chip is selected and disabled. README image: 804 px, light, iOS only.
