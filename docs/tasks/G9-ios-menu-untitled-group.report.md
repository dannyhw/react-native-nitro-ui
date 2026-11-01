# G9 — iOS Menu drops an untitled group

**Branch:** `task/G9-ios-menu-untitled-group` (from `main` at `0d89002`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G9-3rusj` (iPhone 17 `F08675D3` / `emulator-5574` / Metro `8295`) · **Machine:** maintainer-mac-1

## Summary

**Root cause: the props-to-SwiftUI mapping, made fatal by SwiftUI.** The model was right (`rows=` counted every
row). `MenuContent.rows()` drew an untitled section as `Section { rows } header: { Divider() }`, and SwiftUI built
that as an inline `UIMenu` with **no children**. Read with lldb from the Storybook File menu on the simulator:
`Open`, `(Share: AirDrop, Mail)`, then `UIMenu title="" options=displayInline n=0`. The presented menu had no
Delete row (`docs/tasks/G9-ios-menu-untitled-group/file-menu-ios-before.png`).

**Fix:** an untitled section is now a `Section` with no header (`ios/components/Menu/HybridNitroUiMenu.swift`).
UIKit sets the inline group off with its own separator, so Delete appears in red under a divider, as on Android
(`file-menu-ios-after.png`). Android code paths are unchanged.

**The read-out, and the one decision a reviewer should check.** The existing `rows=` on iOS counts the model, so it
could not go red for this bug. While reproducing I found two things. SwiftUI backs the trigger with a public
`UIButton` (`HostingUIButton`) whose `menu` holds the `UIMenu` UIKit presents. SwiftUI fills that menu only when it
is presented. And `UIControl.performPrimaryAction()` (iOS 17.4) presents it. So I added a test-only
`nuiTestMenuProbe()` to the Menu spec, following DatePicker's `nuiTestPresent` and SegmentedControl's probe/report
pair. On iOS it hops to main, presents the menu, copies the `UIMenu` tree, and dismisses it in the same turn. It
leaves the result under a lock for a new trailing `drawn=` field in `nuiTestMenuReport()`, written as
`Open,(Share:AirDrop,Mail),(:Delete!,Archive~),(More:Get Info)`. A Menu with a `primaryAction`, a disabled Menu, or
iOS below 17.4 answers `-1` instead of pressing. Android's probe is a no-op and it answers `drawn=-1`, since its
`rows` already counts composed rows. This changes the nitrogen-generated spec on both platforms (test-only,
`@internal`, D14).

**Harness test** (`Menu.harness.tsx`, "draws every row of an untitled group, with its role (G9)"): an untitled
group holding a destructive row and a disabled row, between two titled groups. On iOS it asserts the titled groups
as a barrier, then the untitled group's rows and roles, then the whole tree in order. On Android it asserts that
the probe leaves `drawn` alone and that the open popup composes all six rows. Both platforms then pick the
destructive row and get nothing from its disabled neighbour.

**Screenshot:** `docs/images/components/menu-ios.png` shows the **Edit** menu open, not File, so the fix does not
change it and it was not re-taken.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1590 tests / 59 suites | `292d2871bd36` | 1 m 54 s | start 16.3 / med 10.7 / max 17.2 |
| `harness:ios` | **PASS** | 230 tests / 16 suites | `292d2871bd36` (ios tree) | 3 m 47 s | start 5.3 / med 3.4 / max 5.3 |
| `harness:android` | **PASS** | 281 tests / 16 suites | `292d2871bd36` (android tree) | 7 m 58 s | start 8.8 / med 2.8 / max 8.9 |
| `real-input:ios` | **PASS** | — | `292d2871bd36` (ios tree) | 12 m 58 s | start 1.9 / med 5.1 / max 21.9 |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Menu` | stale | 1 failed of 16 tests / 1 suites | 39c26f8d3333 (not this tree) | 22.0 s | start 5.8 / med 7.4 / max 7.7 |

`harness:ios:Menu` is the red proof below, run on the mutated tree. `real-input:android` is not
required for review and was not run. The first `check` failed only on `api-extractor:check`,
because the API report was stale; it is fixed in `etc/react-native-nitro-ui.api.md` (excerpt in
`docs/tasks/G9-ios-menu-untitled-group/failures/`).

`need --for review`: `need: review is satisfied on this code tree.` (check, harness:ios, harness:android green)

## Red proofs

- `Menu.harness.tsx` "draws every row of an untitled group" -> the untitled branch given `header: { Divider() }`
  back (`origin/main`'s mapping) -> `expected [] to deeply equal [ 'Delete!', 'Archive~' ]` at the
  `drawnGroup(drawn, '')` line. Titled-group barriers passed and the other 15 Menu tests passed
  (`harness:ios:Menu`, 17:43Z, in the ledger).

## Files changed

- `ios/components/Menu/HybridNitroUiMenu.swift`: the untitled `Section` has no header. Adds `nuiTestMenuProbe()`,
  the `drawn=` field, and resets the probe's answer on recycle.
- `src/components/Menu/Menu.nitro.ts`, `nitrogen/generated/**/HybridNitroUiMenuSpec*`: the probe method and the
  report format.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiMenu.kt`: a no-op probe and `drawn=-1`.
- `src/components/Menu/Menu.tsx`, `src/components/Menu/NativeNitroUiMenu.ts`: handle types.
- `example/__tests__/Menu.harness.tsx`: the test, its fixture, and `drawn` in the parser.
- `etc/react-native-nitro-ui.api.md`: the `@internal` handle type gains the probe.
- `docs/components/menu.md`, `.changeset/g9-ios-menu-untitled-section.md`, `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

- iOS Menu testing: `performPrimaryAction()` opens a SwiftUI `Menu` from native code, and `HostingUIButton.menu`
  is readable. That may reopen D29's "no harness gesture reaches a SwiftUI Menu" for the X4 recycle cell (FOLLOWUPS,
  the X4 recycle rule line) and for an iOS open-state read-out.
- iOS Menu: the probe reads `menu` right after presenting, and that held on iOS 27. If a later SwiftUI fills it
  asynchronously, `drawn` will read a stale or empty tree, and the G9 test will go red rather than pass silently.
