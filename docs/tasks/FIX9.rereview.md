FIX ROUND

# FIX9 re-review, fix round 1: task/FIX9-chip-disabled-selected at 100996b9

`check` run once here (no real-input gate running; FIX8's note says its real-input:ios run is
next, not started): PASS, 18 steps. `need --for review` satisfied on code tree `788f1c731e92`,
both harness gates green on their current digests. Scope clean (nothing under `scripts/`,
`.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers; no `.rnstorybook` edit left behind).
One author address, nothing personal, no mention of AI.

## First review

M1 closed. README image, Disabled row: Off is `#E9E9EB`, On is `#DDE9F5`. The enabled pair is
`#D1EAFF` / `#E9E9EB`. So the disabled On fill is lighter and greyer than the enabled On fill
and still blue next to the disabled Off chip. Dark image (`/tmp/FIX9r1-chip-states-light-dark.png`):
enabled On `#001A2E`, disabled Off `#262629`, disabled On `#13202C`. That is paler than the
enabled chip (chroma 25 against 46), a little lighter (channel sum 95 against 72), and apart from
the grey chip. The fill relations hold in both appearances. The label does not: see M5.

M2 closed: no doc quotes a strength the code lacks (its new wording is M6).

M3 closed. `Chip.harness.tsx:1446` (`lighter >= kept`) and `:1452` (`paler >= keptColour`) replace
the old distance and chroma checks, and each one is stricter than the check it replaces. Bounds
come from the run's own enabled pair (`kept = 13` from 38). Checked by hand: round one's
`#BED6ED` gives lighter = -38 and paler = 11, so it fails both, as the report's red line says. The
new reading `#DEE9F4` gives lighter = 20, paler = 36, apart = 22, colour = 21, so it passes. The
four bounds together reject a fill with no tint and a fill faded all the way to white. Nothing
was loosened.

M4 closed. `chip-ios.png`: 804 px, light, `States` story (`Chip.stories.tsx:94-119`), iOS only;
the Disabled row shows the new fill. 534 to 462 px tall: the leased iPhone is wider, Nut-free no
longer wraps; glyph scale unchanged.

The first review's N1 (identity) and N2 (`.tint`) are closed. `ChipDisabledFill.body`
(`HybridNitroUiChip.swift:207-222`) now has one structural type for every state, so the
`Toggle` keeps its identity. The ZStack has `.allowsHitTesting(false)` (`:220`). The capsules
carry no accessibility content. N3 to N6 remain follow-ups, as the report says.

## New findings

M5. The overlay washes the label and the glyph, so the disabled selected chip has the faintest
label in the row. Neither existing disabled label is that faint. The 0.45 `systemBackground`
capsule (`HybridNitroUiChip.swift:213-215`) is drawn over the text as well as the container.
README image: the "On" label's darkest pixel is `#C9D5E1` on `#DDE9F5`, a contrast of 1.21:1.
"Off" is `#C0C0C3` on `#E9E9EB`, 1.5:1. Dark: "On" `#2A3744` on `#13202C` is 1.36:1, and "Off"
`#545459` on `#262629` is 2.0:1. In the README image, "On" is visibly fainter than "Off". The
brief asks for "dimmed the way a disabled control is" (Behaviour 1) and a leading glyph that
does not change (Behaviour 2). This fill dims the text by an extra 45 % on top of SwiftUI's
disabled dimming. The harness cannot see this, because it reads the mean colour of the box,
and a fainter label makes that box read lighter, which helps it pass.
Options: (a) draw the wash under the text, for example by laying the label back over the
capsules, accessibility-hidden and in the disabled label colour; (b) lower the fade and raise
the tint until the "On" label is at least as legible as "Off"; (c) keep the drawing and add a
Limits line. I recommend (a) or (b), with a harness bound that compares the label strength of
the two disabled chips.

M6. Wrong shipped doc. The doc says the fill fades "toward the page the chip sits on"
(`docs/components/chip.md:82`, `:164`, `.changeset/chip-disabled-selected-fill.md:5`, and the
Swift comment at `:194-195`). The code always fades toward `UIColor.systemBackground`
(`:214`), whatever is actually behind the chip. Off that background the doc's "lighter and paler
than the enabled chip's fill" stops being true. Arithmetic for a chip in light appearance on a
dark card or photo (`#1C1C1E`):
disabled Off is about `#242426`, enabled On about `#172D47`, and disabled On about `#7A8592`.
The disabled selected chip becomes the brightest chip in the row, which is M1 in reverse. In
dark appearance on a coloured card, it fades toward black instead. A chip on a non-system
surface is a less common layout, so I accept the drawing as a documented limit. The doc as it
stands is still wrong. Fix: say "faded toward the system background colour" in all four places,
and add a Limits line saying a disabled selected chip on any other surface fades toward white
(light) or black (dark).

N1. Dark appearance is never measured. The sampler composites over white
(`HybridNitroUiChip.swift:497`, `:522`), and the harness runs in light appearance only. The
dark numbers under M1 come from the image, not from a test. Either log it as a follow-up or
read the chip in dark against a dark backdrop.

N2. Stale report text. `docs/tasks/FIX9-chip-disabled-selected.report.md:8-12` still describes
round one's `Color.accentColor` at `opacity(0.2)`. `:36-39` still says the screenshots are not
done. CodeRabbit comment 4621342694, on report line 37, asks for the README retake. The image
now has the new drawing, so that point is closed, but the "Not done" paragraph it points at is
now false. Mark both paragraphs as round one's, or correct them.

N3. The Swift doc comment at `HybridNitroUiChip.swift:193-198` is six lines. AGENTS.md
"Comments" asks for one to three. It also repeats the "page it sits on" wording from M6.

## Checked, no finding

Perf contract (setters untouched; an enabled chip draws two opacity-0 capsules, nothing visible);
recycle (overlay follows `state.displayed` and `disabled`, both reset); harness change run on both
platforms (harness:android green on digest `fbdc7ceb593f`).
