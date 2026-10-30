# A5 re-review (fix round 1, HEAD `c89d5c5`)

**Verdict: MERGE WITH FIXES** (docs only, exact text below). All nine must-fixes and all of the should-fixes from `67a389d` are in. Every new number matches the `abe68a1` results under `pairedLaunchRatios`, with the right cell, arm, N and platform. "Monotonic" matches `lib.mjs:1289-1294`/`:1368`, and the gating reason matches `:72`/`:1618-1623`; no baseline stores a slope. `need --for review` is satisfied, and there are no D25 leaks.

## Must fix

1. **A sixth reversed conclusion was missed: the JS cost of hosting.** The indicative claims were H2b's "Only `Button` pays more than about a twentieth" (hosted ÷ unhosted 0.94–1.16x), the 0.4.0 README's "JS CPU per op unchanged", and host.md's "roughly flat … `Progress` near parity (0.92x)". The quiet run reads hosted ÷ unhosted JS as `Switch` 1.20, `Slider` 1.05, `Progress` 1.32, `Button` 1.12, SC 1.02, `Picker` 1.05, `DatePicker` 1.11 and `Menu` 1.09. Hosted `Progress` against the shared host is 0.77x. The README is already right. H2b's own quiet table contradicts its prose.
   - **H2b:155**: change "Every claim this section made holds there" to "Every claim this section made holds there except the JS cost of hosting (below)".
   - **H2b:173**: change "Two numbers move:" to "Three numbers move: hosted ÷ unhosted JS CPU, now 1.02–1.32x and over 1.10x on `Switch`, `Progress`, `Button` and `DatePicker`;".
   - **H2b:204**: after "…on the unhosted side of the arithmetic too." add "A5's quiet run reverses this: every control pays, four of them more than a tenth (1.20x `Switch`, 1.32x `Progress`, 1.12x `Button`, 1.11x `DatePicker`)."
   - **host.md:115**: after "…not from below it." add "On the quiet run the bullet's heading reverses too: hosting costs JS on all four (hosted ÷ unhosted 1.20x / 1.05x / 1.32x / 1.12x), and `Progress` lands at **0.77x**, not near parity." At host.md:114, change "the one verdict that reverses" to "a verdict that reverses".
   - **A5 report:24, :155**: change "five" to "six". Add item 6 to the list, "Hosting's JS cost: 'roughly flat' / 'unchanged' → hosted ÷ unhosted 1.02–1.32×. Corrected in README, H2b and host.md."
2. **README:606-607** claims a memory win on `Progress`, but its own line 627 says `Progress` memory has no verdict (the shared-host arm has 16.1 % spread). This sentence came from the review's own text. Change "the UI-thread win holds on all four and the memory win on three, `Progress` most of all, `Slider` level at 1.02×;" to "the UI-thread win holds on all four, `Progress` most of all (0.40×); the memory win holds on `Switch` and `Button`, `Progress` reads 0.45× but `n/v`, and `Slider` is level at 1.02×;".

## Should fix

- **sizing.md:550-551**: the quiet run also adds flags, and one of them removes a bold verdict (hosted `Progress` memory, **0.37x**). Change "and one verdict reversed:" to "three gained (`Progress` memory on both sides, 1.70x and 0.45x, where the shared host's own spread is 16 %, and unhosted `Progress` unmount, 2.24x at 15 %), and one verdict reversed:". Add the same clause to A5 report:176 ("Everything else that moved was a flag").
- **H2a:319, H2b:161**: change "**0.45x**" to "0.45x" (not bold), because bold means a verdict (sizing.md:560).

## Nits

- **host.md:75**: change "in both directions" to "on both sides of the Host (1.06x unhosted, 1.11x hosted)".
- **G5:755**: change "so 1.00x is a" to "so 1.02x is a", because the pre-review run read 1.02x (G5:796).

## Verified

The README numbers on lines 470-482, 577 and 596-635 match the data. So do G5:742/756/763, G6:205, the G7b `(nv)` cells, the host.md flags (five clear) and the sizing.md flags (six clear). No stale 0.94x or 0.92x is left outside a labelled indicative table.
