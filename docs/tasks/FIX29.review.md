# FIX29 review — round 1 (`ec49b1d8..e4cf9fb6`, PR #125 head; read-only, no device runs)

## Verdict

**Fix round needed.**

## Blocking findings

1. **The cause does not explain either CI red, and the fix makes the report unable to show the
   thing the brief asks about.** The Material part checks out: `javap` on material3
   1.5.0-beta02's `ExposedDropdownMenu-kbRbctU` shows `remember { MutableTransitionState(false) }`,
   `setTargetState(expanded)`, then `if (currentState || targetState) Popup(...)`, so the window
   does outlive `expanded` by the exit fade. But both CI cases (run 45383576823, both attempts)
   had already read `!expanded && live === 0` from the old witness. That witness counted the
   popup's composition, so `live` was 0 only once the window had left. A later `live = 1`
   (843 after re-enable plus `settle(300)`, 910 after the date dialog presented) means a Picker
   popup composed again, so `targetState`/`expanded` was true for at least one composition.
   A fade of the first close cannot produce a 1 after a 0. The report's line "the pair both CI
   cases reported" leaves out the earlier 0, and cause 2 is ruled out only on the final
   `expanded = 0`, which does not exclude a reopen that closed again before the read.
   After the change, `live` follows `expanded`, and `PickerModel` drops view, frame and rows
   while closed (`HybridNitroUiPicker.kt:242-270`). So no field of the report can show a window
   composed while `expanded = 0`. The new case's checks after the close
   (`HostPopups.harness.tsx:873-885`) pass whatever happens: a ghost window, or a reopen that
   closes inside `settle` (a menu the user sees flash).
   Change it:
   - (a) Keep a process-wide window count in `MenuWindowWitness` as its own field (`windows`).
   - (b) After each close, wait for `windows === 0`. That is a real signal: the fade ends.
   - (c) Assert `windows` stays 0 through the re-enable, the Host move and the date dialog.
   - (d) Add a monotonic `opens` count (each time `MenuOpenWitness` enters) and assert it does
     not change across those three steps. A red then tells a ghost reopen from a ghost window.
   - (e) Correct the report's cause section: what the fade explains and what it does not. If
     the sharper case goes red on CI, that is the bug to report, not a reason to soften it.
2. **Production regression: reopening during the fade leaves `menuView` null.** At the close,
   `MenuOpenWitness`'s dispose calls `noteMenuView(null)` (`HybridNitroUiPicker.kt:995`).
   During the fade the same `Popup` stays composed. If the menu reopens then (a fast re-tap, or
   an Enter/D-pad toggle), `MenuOpenWitness` re-enters, but `MenuWindowWitness`'s
   `DisposableEffect(menuView)` keeps its key and does not run again (`:1009`). `menuView`
   stays null for the whole reopened session. `dropOpenMenu()` (`:231`) and
   `refreshMenuFrame()` (`:277`) both need it, so a reopened menu no longer closes when its
   anchor moves: a window left pointing at the old place, which is the user-visible bug
   `dropOpenMenu` exists for.
   Fix: let `MenuWindowWitness` alone own `menuView`. Drop the null write from
   `MenuOpenWitness` and the `expanded` gate in `noteMenuView` (`:266-270`). Both functional
   readers already check `expanded`. The "report shows nothing while closed" rule then
   belongs in `readMenuReport`, not in the stored state.
3. **Red proof for the new case.** The mutation quoted ("compose `MenuOpenWitness`
   unconditionally", nine cases red) does not undo the fix. Under the old placement the new
   case would pass on this emulator, because every read comes 200 ms or more after the fade.
   After finding 1, prove the case red with a mutation that leaves a window or an open behind
   while `expanded = 0`. One example: in the `disabled` setter's re-enable branch, set
   `expanded` true for one frame and then false again. Quote the line that goes red.

## Non-blocking

- Changing the re-enable case from two reads to one (`expectNoOpenMenu`) does not loosen it.
  It keeps the same fields from a single moment and adds `menu`. With the fix as written,
  though, `menu = -1` holds by construction whenever `expanded = 0` (see finding 1).
- Perf contract: no setter changes, nothing re-created, no thread hops. The
  `if (expanded) { MenuOpenWitness }` group is cheap. `MenuWindowWitness` still sets
  `expanded = false` on dispose, so a Host child that re-enters does not reopen. Composing
  and disposing the popup is unchanged.
- Users and TalkBack: as intended, nothing visible changes. Semantics, dismissal and the
  key handling are Material's, and none of them read `menuView`. Finding 2 is the one
  exception. No changeset is right for a change that only affects the test report; keep it
  that way after the fix round.
- Comments follow the rules: no IDs, no history. "so the popup's composition is not when a
  menu is open" (`:985`) does not parse. Suggested: "so the popup being composed does not mean
  the menu is open". The doc on `liveMenus` ("a mount dropped mid-menu cannot report its own
  leak") no longer matches a count that sits beside the anchor.
- CodeRabbit: no inline comments on PR #125 yet, only its "review in progress" placeholder.

## Follow-ups

- `MenuRows.kt:567` `MenuWitness` (Menu, ContextMenu): confirmed. It counts the popup's
  composition (`DisposableEffect(LocalView)` inside the window), so their `live` also lasts
  through the exit fade.
- Why a Picker popup composed again on CI after closing is still open; `opens`/`windows` answer it.
