# Q9 — ButtonGroup and IconButton design, with the iOS ControlGroup check

**Worktree / branch:** named in your delegation message (`task/Q9-buttongroup-iconbutton-design`). **Round cap:** 1
round (a design task; D19). **Devices:** one iOS simulator from your lease (`node scripts/lease.mjs acquire --task Q9
--boot`), used only for the ControlGroup check.

## Why

D40 orders pass 2 of Material 3 Expressive as ButtonGroup (Android `ButtonGroup`, iOS `ControlGroup`) and SplitButton.
IconButton and icon-only group items build on D40 item 2: an `androidIcon` prop naming a drawable resource the app
ships, alongside iOS's `systemImage`, with no icon set bundled. Both are new components, so they need a design at the
depth Q1/Q6/Q7 gave theirs before anyone builds them.

## Read first

- AGENTS.md.
- `docs/DECISIONS.md` D17 (measured sizing), D29, D38 item 1 (build from each platform's real controls), D39, D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md`: Appendix C rows 1, 6 and 7, Appendix E (pass 0's "ButtonGroup's
  iOS check" and pass 2), and question A (around line 117: `androidIcon`).
- `docs/tasks/Q7-next-components-2.report.md`, for the shape and depth of a component design.
- The Button, SegmentedControl, Chip and Menu source and docs as they are on `main` now: E1 built the connected
  `ConnectedRow`, the size ladder and `shape`; E2 built the Expressive popup and rows. The E1 and E2 reports say what
  they learned.

## Do

1. **The iOS ControlGroup check** (Q8 pass 0, never run). Build a throwaway screen, not merged, that hosts one
   SwiftUI `ControlGroup` of three `Button`s in plain content, not in a toolbar.
   - Take a screenshot on the oldest and the newest iOS runtime installed here. `xcrun simctl list runtimes` lists
     them; if your lease's simulator runs only one, say which runtimes you could check.
   - Measure its sizing through the core sizing path.
   - Also try `.controlGroupStyle(.navigation)` / `.compactMenu` / `.palette` where available, and say which draws
     as a connected row.
   - **Go** if it draws as a connected row on the supported iOS range. **Otherwise** iOS falls back to a row of
     bordered `Button`s (D38 item 1); say so.
2. **ButtonGroup design.**
   - **API:** items as data (id, title, `systemImage`, `androidIcon`, enabled, and toggleable items with `checked`),
     `appearance: 'standard' | 'connected'`, size and variant (reusing E1's ladder), and events (`onPress(id)`, and
     for toggleable items a controlled value on the existing event-count handshake, or a decision against one).
   - **Overflow:** Android's `ButtonGroup` overflow indicator opens E2's popup; what does iOS do?
   - **Platform mapping:** for every prop, with what has no counterpart.
   - **Sizing and measurement**, accessibility (TalkBack and VoiceOver for each kind of item) and recycling.
   - **The test plan**, with the red proof each test needs.
   - Relationship to SegmentedControl: why both exist, and when to use which. Users will ask.
3. **`androidIcon` and IconButton design.**
   - **Resolving the drawable:** how the native side resolves a drawable name in the app's resources (and what happens
     when it's missing), how it's tinted, and its size per the size ladder.
   - **Where it applies:** which existing components take `androidIcon` beside `systemImage` (Button, Menu rows,
     Chip, ButtonGroup items), and in what order.
   - **IconButton:**
     - Android: `IconButton(onClick, shapes, …)` with the XS–XL sizes and narrow/wide widths, and the
       filled/tonal/outlined/standard variants.
     - iOS: `Button` + `Label` `.iconOnly`.
     - Toggleable or not, the required accessibility label, sizing, and tests.
   - **How an app ships the drawable:** in bare RN and Expo (a config plugin or not). Write the short user-facing
     section the docs would carry.
4. **Build order and split** into G tasks, with what can run in parallel. Name any spike that's needed and its
   questions.

## Output

`docs/tasks/Q9-buttongroup-iconbutton-design.report.md`, containing:
- the ControlGroup check result (screenshots committed under `docs/tasks/Q9/`);
- both designs;
- the build plan;
- `## Questions for orchestrator`, with options and a recommendation for anything the owner should decide.

Keep the summary at 400 words or less, and put the designs in appendices.

## Gates

`check` on your branch (the throwaway screen isn't committed, or is committed only under `docs/tasks/Q9/` as a
snippet). Export the ledger with `gate.mjs export --task Q9`.
