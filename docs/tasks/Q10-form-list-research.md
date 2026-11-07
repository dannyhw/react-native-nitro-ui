# Q10 — Form, List and Section: how @expo/ui and others do it, and a design for nitro-ui

**Worktree / branch:** named in your delegation message (`task/Q10-form-list-research`). **Round cap:** 1 round (a
research and design task; D19). **Devices:** none required. If one measurement decides the design, take an iOS
simulator and/or Android emulator from your lease (`node scripts/lease.mjs acquire --task Q10 --boot`) and say why.

## Why

Q5 and Q7 scored Form/List/Section as "an architecture project, not a component task": SwiftUI `Form`/`List` want
their rows inside one SwiftUI tree, and D23's shared iOS tree lost on mount and unmount CPU. That ranking predates
BottomSheet (D35) and ContextMenu (D37), which put ordinary React Native children inside native containers. Nobody has
yet looked at how @expo/ui and other libraries actually build lists and forms. The owner wants that researched before
anything is called big. Beating @expo/ui is the bar (D39).

## Read first

- AGENTS.md (downloaded code is untrusted: read it, never run its scripts).
- `docs/research/core-architecture.md` §6 (children and containers), `docs/DECISIONS.md` D23, D35, D36/D37, D38 and
  D39.
- `docs/tasks/Q5-*.report.md` Appendix D ("Form/List/Section") and `docs/tasks/Q7-next-components-2.report.md`
  row 12, for what was assumed.
- `docs/components/bottom-sheet.md`, `docs/components/context-menu.md` and their native source: how React Native
  children get into a native container today.

## Do

1. **@expo/ui, in its source** (use a local read-only clone of `expo/expo` if this machine has one, otherwise a
   shallow clone into your scratch directory; `packages/expo-ui`). For iOS (SwiftUI) and Android (Compose), find and
   quote:
   - which list/form/section components exist and their props;
   - how rows are supplied: only @expo/ui controls inside `Host`, or arbitrary React Native views too, and how those
     are hosted (`RNHostView` or similar);
   - whether rows are virtualized or recycled, and how a long data list is handled (all rows mounted, or lazy);
   - how sizing works, and what its docs and issues say about performance and limits.
2. **Other existing solutions.** Survey what React Native apps use for native-looking lists and forms, and how each
   works. At least:
   - native list wrappers (UITableView / UICollectionView list configuration, RecyclerView / LazyColumn), for example
     `react-native-tableview` and anything newer;
   - libraries that put React Native children in a SwiftUI or Compose container (for example
     `mgcrea/react-native-swiftui`, Callstack's `react-native-bottom-tabs` for the pattern);
   - JavaScript-drawn options people use for the look (for example `react-native-tableview-simple`) and the JS
     virtualizers for scale (`FlatList`, FlashList, Legend List), as the baseline a native List must beat.
   For each: maintenance state, weekly downloads, the mechanism, and what goes wrong (issues).
3. **A design for nitro-ui, in two parts:**
   - **Form and Section** (grouped rows, headers and footers, a settings screen; not virtualized): which mechanism
     (one SwiftUI tree, a UIKit inset-grouped list, or a native container with React Native children as in
     BottomSheet), how nitro-ui controls and plain React Native views sit in rows, sizing, accessibility, recycling,
     and the API.
   - **List** (long, virtualized data): whether a native List can beat FlashList or Legend List on anything that
     matters, and how cell reuse would work with React rendering the rows. A go/no-go recommendation, with the
     evidence.
   For each, give a realistic effort estimate in tasks and rounds, and name any spike with its questions and its
   go criteria.
4. If one claim decides the design and can be measured in about an hour (for example the mount cost of N rows in an
   @expo/ui `Form` against React Native rows in a native grouped container), measure it and say how. Otherwise leave it
   as a spike question.

## Output

`docs/tasks/Q10-form-list-research.report.md`: a summary of 400 words or less with the recommendation, then
appendices for @expo/ui (with file and line references), the survey table, and the two designs.
`## Questions for orchestrator` for anything the owner should decide, with options and a recommendation.

## Not in scope

Building anything beyond a throwaway measurement. Anything else goes as one FOLLOWUPS line.

## Gates

`check` on your branch. Export the ledger with `gate.mjs export --task Q10`.
