# G22 — Popover (React Native content, anchored)

**Worktree / branch:** named in your delegation message (`task/G22-popover`). **Round cap:** 1 round, plus at most 2
fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G22 --boot`). Export the lease's
environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D35 (BottomSheet's presentation), D36/D37, D38, D39, D41 (Tooltip presents from its own window
  on iOS) and **D44** (this component's decisions).
- `docs/tasks/S5-popover-spike.report.md`: the whole report, especially "what the build must change" and the proposed
  API. The prototype is on `task/S5-popover-spike` (`ac11788e`): read and reuse what holds up, but it was never
  reviewed, so bring it to the bar rather than copying it.
- `docs/tasks/Q7-next-components-2.report.md` Appendix F (the original design). Where Q7, S5 and this brief differ,
  this brief wins, then D44, then S5.
- Tooltip and BottomSheet, as they are on `main`: Tooltip's anchor and window, BottomSheet's drop rule and content
  mechanism.

## Do

1. **The component:** `<Popover isPresented onIsPresentedChange anchor children onDismiss maxWidth testID style>`,
   per S5's proposed API, controlled through the event-count handshake with Tooltip's refusal warning. Every native
   prop always passed; no optional Hybrid View props.
2. **Sizing:** the content lays itself out in place with Yoga, capped at the smaller of `maxWidth` and the window
   width minus 32; native reads that box. First frame equals final size on both platforms.
3. **iOS:** `UIPopoverPresentationController` with `preferredContentSize` set from the box before presenting. Decide,
   with evidence, whether it presents from its own window as Tooltip does (D41) or through D35's chain, and test it
   over an RN `Modal` and alongside a Tooltip and a BottomSheet.
4. **Android:** a Compose `Popup` composed only once the box has a size, with our own position provider (below the
   anchor, start-aligned, flipping above when there's no room) that also moves clear of the keyboard (D44 item 1).
   Focusable so a `TextInput` inside can bring up the keyboard. One RN root per presentation, released on dispose.
5. **Drops (D44 item 2):** a popover dropped while presented follows BottomSheet's rule on both platforms.
6. **Accessibility, recycling, the conformance tables, the registry (`component.json`), stories, docs page
   (`docs/components/popover.md`), the README row, import, Usage section and both screenshots, and a minor
   changeset.**

## Tests, each shown red first

- **Harness, both platforms:** first frame equals final size across content sizes and `maxWidth` values; the
  handshake (a refused open, an ignored `onIsPresentedChange`); 50 open/close cycles with no leftover roots,
  controllers, windows or lifecycle observers; a drop during the entry transition; a recycle while open; a drop while
  presented reporting per D44 item 2; presenting over a `Modal`.
- **Real input, both platforms:** a `Pressable` inside takes a tap exactly once over 10 opens; a `TextInput` inside
  brings up the keyboard and stays visible above it (Android on a software keyboard, D44 item 1); tap outside closes.
- **Bench:** the component's cells by merge mint (X14) on this machine, against `react-native-popover-view` if it
  installs cleanly, otherwise our own numbers only.

## Not in scope

Arrow styling, a no-animation prop (D44 item 3), Popover inside a Form (S6), and anything else, which goes as one
FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at `docs/tasks/G22-popover.report.md`.
Export the ledger with `gate.mjs export --task G22`.
