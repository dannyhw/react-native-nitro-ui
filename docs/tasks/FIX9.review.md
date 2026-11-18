FIX ROUND

# FIX9 review: task/FIX9-chip-disabled-selected at 5e9c4ca7

`check` was run once in the worktree (no lease was `in use (real-input:ios)`): PASS, 18 steps.
CodeRabbit has no inline comments on PR #101; its only issue comment says the review is still
in progress, so none are cited. Scope is clean: nothing under `scripts/`, `.claude/`, `AGENTS.md`,
`docs/agents/` or the shared e2e helpers, one author address, no AI mention, path, email or host.

## Must fix

M1. The disabled selected chip is probably drawn louder than the enabled one, not dimmed, and
the four-state screenshot the brief's Proof asks for was never taken, so nobody has looked.
`ios/components/Chip/HybridNitroUiChip.swift:202-209` draws the full accent at `opacity(0.2)` on
top of the opaque disabled container. The README image puts the enabled selected fill at
`#D1EAFF` (about 16-18% accent over white) and the disabled container at `#E9E9EB`. Blending
gives a disabled selected fill near `#BAD3EF`, darker in every channel than the enabled selected
chip, with a slate `#9EB6D3` label. The harness's own red-run means say the same: on `#C5E3FF`,
off `#D9E3ED`, disabledOff `#E8E8E9`, so the blend puts disabledOn near `#BAD2ED`. That makes it
the darkest chip in the row and about 72 from disabledOff, while the enabled pair is 38 apart.
The green run logged no means, so this is arithmetic, not a reading. Brief Behaviour 1 asks for
"dimmed the way a disabled control is". Take the four-state shot, set the strength from it so
the disabled selected chip sits between the disabled unselected one and the enabled selected
one, and report the measured means.

M2. Wrong shipped docs: "a fifth of its strength" is not what the code does. The overlay adds
about as much accent as the enabled fill carries, so it is not a fifth of the enabled fill.
`docs/components/chip.md:82` ("a fifth of it on a disabled chip"), `docs/components/chip.md:164`
("at a fifth of its strength: dimmed"), `.changeset/chip-disabled-selected-fill.md:5` ("at a fifth
strength") and the code comment at `HybridNitroUiChip.swift:203` ("A fifth of the tint"). Reword
all four to say what is drawn, after M1 settles the strength.

M3. The "dimmed, not enabled" assertions cannot fail for a disabled chip that draws stronger than
the enabled one. `example/__tests__/Chip.harness.tsx:1433` only asks for distance from `on` (a
darker chip passes). `:1443` asks for `chroma(dimOn) <= chroma(on)`: about 51 against 58 for
the estimate above, and chroma is not lightness. A drawing at `opacity(0.25)` or a darker accent
would stay green. Add a bound that fails when the disabled selection stands out more than the
enabled one, for example `colourDistance(dimOn, dimOff) < colourDistance(on, off)`, or dimOn
lighter than on. Red-prove it against the current `0.2` drawing if M1 shows that drawing is too
strong.

M4. Wrong shipped image. `docs/images/components/chip-ios.png`, "Disabled" row: "Off" and "On"
sample identically (`#E9E9EB` at both fills, x=58 and x=158, y=445 in the 804 x 534 image). That
is the old drawing, and `example/src/ChipScreen.tsx:189-190` shows both chips as before. Brief
Behaviour 4 asks for the retake. The report lists it as not done (report "Not done"). Retake it
after M1, at the documented 804 px width.

## Nice to have

N1. `ChipDisabledFill` (`HybridNitroUiChip.swift:202`) is `if/else` on `selected && disabled`, so
the two branches give the Toggle different structural identities. Disabling a selected chip, or
selecting a disabled one from JS, rebuilds the Toggle subtree. That can drop VoiceOver focus
on it. Keep the overlay always present and switch only its opacity.

N2. `Color.accentColor` (`:207`) is not the bordered style's colour source. That style fills with
the environment tint. `Capsule().fill(.tint)` follows any `.tint` above the chip and the hosting
view's tint bridging. `accentColor` follows only the app accent. With no `tintColor` prop the
two usually match, but nothing measures a custom accent, dark appearance or Increase Contrast.
The harness read runs in light appearance only.

N3. The report says the merge real-input run "re-checks the disabled chip's iOS role and state"
(report:53). In `RealInputTests.swift:1951-1962` the disabled chip follows `realSelected`
(`ChipScreen.tsx:92`), and the value is "off" at that point. So the overlay path (selected plus
disabled) never reaches an accessibility check. Brief Behaviour 2 ("either state ... reports its
selected state") is unproven for the selected case. Add a selected-disabled element read, or say
the gap in the report.

N4. A refused probe reports a doubled counter. `publishPixelReport` (`:86`) prefixes `n=<k>` to a
line that already starts `n=0` (`:495`, `:501`, `:512`, `:519`), so the line reads
`n=1 n=0 size=... no pixels`. `src/components/Chip/Chip.nitro.ts:118` documents
`n=<probes> no pixels`. Drop the inner `n=0`.

N5. The failure message at `Chip.harness.tsx:1436-1438` says "inside the ${kept} a dimmed chip has
to stay within", but the assertion requires the chip to be at least `kept` away from the enabled
one. The message states the opposite of the check.

N6. The sampler comment (`HybridNitroUiChip.swift:489-492`) says the capture is composited over
"the light page colour, as in the app". In dark appearance the page is not light. The relative
thresholds still hold, but the sentence is wrong there. Say it is a fixed white backdrop chosen
so that two chips can be compared.

## Checked, no finding

- Hit testing: the overlay exists only while disabled and has `.allowsHitTesting(false)`. Enabled
  taps are untouched. `press()` still refuses while disabled.
- Recycle and re-enable: the overlay is derived from the model, so it goes when the chip is
  re-enabled or deselected. `prepareForRecycle` resets `disabled` and `state`, and
  `clearReports` resets the pixel counter.
- Perf contract: setters still only store and `markDirty`, and no hosting view is rebuilt. The
  probe posts to main with `async`, with no `main.sync`.
- Size: the overlay does not take part in layout. The new size test pins disabled sizes to
  enabled ones.
- Red proof: the logged red run (old Swift restored) fails at `:1424` with disabledOn ==
  disabledOff == `#E8E8E9`. No threshold is an absolute colour. `NOISE` and `KEPT` are relative to
  the run's own enabled pair. The iOS `androidIcon` case swapped a refusal check for a pixel
  comparison, which is stronger, not looser. The Android probe helper now rejects refusals, and
  harness:android is green.
