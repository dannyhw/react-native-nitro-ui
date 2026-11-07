# G23 — IconButton

**Worktree / branch:** named in your delegation message (`task/G23-icon-button`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G23 --boot`). Export the
lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17, D39, D40, D42 item 4 (the `xlarge`/`xxlarge` ladder) and **D43** (icons: official Material
  Symbols files; `androidIcon` takes a Metro `.xml` asset or a drawable name).
- `docs/tasks/Q9-buttongroup-iconbutton-design.report.md` **Appendix C4** (the IconButton design). Where Q9 and D43
  differ, D43 wins: `androidIcon` is G19's source type (a Metro asset or a drawable name), not only a drawable name.
- G19 as merged on `main`: `src/iconSource.ts`, `NitroUiIcon.kt`, `NitroUiIcons`, the size ladder, Button's
  `androidIcon`, and `docs/tasks/G19-android-icon-iconbutton.report.md` for what it learned. Reuse all of it; don't
  build a second icon path.

## Do

Build IconButton per Q9 C4 on both platforms:

1. **API:** `accessibilityLabel` required (in the type, and a dev warning when empty), `systemImage`, `androidIcon`
   (G19's source type), `onPress`, `variant: 'standard' | 'filled' | 'tonal' | 'outlined'`, `size` on the shared
   ladder (`small`…`xxlarge`), `width: 'narrow' | 'uniform' | 'wide'` (Android only, documented), `shape`, and a
   toggle form with `checked`/`defaultChecked`/`onCheckedChange` on the event-count handshake. `disabled`,
   `tintColor`, `testID`. Every native prop always passed.
2. **Android:** `IconButton` / `FilledIconButton` / `FilledTonalIconButton` / `OutlinedIconButton` and the matching
   `…IconToggleButton`s, with the `shapes` overloads, `IconButtonDefaults` container sizes per size × width, and
   Material's colours cached per scheme as Button's are. Measure the 48 dp minimum touch target rather than assuming
   it. The icon is drawn through G19's path, sharp at every rung.
3. **iOS:** `Button` + `Label(…).labelStyle(.iconOnly)`, and `Toggle(…).toggleStyle(.button)` for the toggle; the
   variant, shape and `controlSize` mapping from C4.
4. **Sizing (D17):** `intrinsic`, the key from C4 (with `width` and the symbol), a declared fallback that doesn't
   coincide with the real size in the conformance fixture, and conformance rules.
5. **Accessibility, recycling with a full reset (including the resolved icon), the registry entry, stories, the docs
   page `docs/components/icon-button.md`, the README row, import, Usage section and both screenshots
   (`docs/images/components/icon-button-{ios,android}.png`), and a minor changeset.**

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

C4's test table, plus:
- the icon is drawn on Android at each rung (G19's pixel probe), from a Metro asset in dev and a drawable in release;
- a toggle's checked state reads in the accessibility tree on both platforms;
- real input on both platforms: a tap fires `onPress` once; a toggle flips once per tap.

**Bench:** `mount.iconbutton` by merge mint (X14) on this machine, against an RN `Pressable` + `Image` and
`@expo/ui`'s `IconButton`.

## Not in scope

ButtonGroup (G20), `androidIcon` on Menu rows, SplitButton and Chip (G21), and anything else, which goes as one
FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G23-icon-button.report.md`, with the API at the top. Export the ledger with `gate.mjs export --task G23`.
