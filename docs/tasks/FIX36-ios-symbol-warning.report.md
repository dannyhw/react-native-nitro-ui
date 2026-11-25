# FIX36 — iOS warns in development when an SF Symbol name draws nothing

**Branch:** `task/FIX36-ios-symbol-warning` (from `main` at `0db5b849`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX36-afibl` (iPhone 17 / iOS 27 simulator, `nitroui_a` emulator; Metro 8295 / 9295)

## Summary

Two halves. The native core gained `unresolvedSystemImageNames(names)`: iOS hands the names
to UIKit on the main queue and settles with the ones that resolve to no symbol. No thread
blocks, and `UIImage` is never touched off the main, which is the line the library already
holds for props. A platform with no SF Symbols settles at once with nothing unresolved and
looks nothing up.

JS gained `warnIosSystemImageName(component, prop, name)` in `src/systemImageName.ts`, called
from the same render sites that already warn about `androidIcon`: `Button`, `Chip`,
`IconButton`, `ListItem`, a `Menu` trigger, `ButtonGroup`'s items, and the rows of `Menu` and
`ContextMenu` — a row is named by the path the app wrote (`actions[].systemImage`,
`actions[].items[].systemImage`, `sections[].items[].systemImage`). One warning per component
and name, in `__DEV__` only, one lookup per name for the process, in the voice
`warnAndroidIconName` already uses. Drawing is unchanged for good and bad names alike.

Two decisions worth reading before the diff. **Where the warning is said:** a native log line
does not reach the JS console or LogBox on this React Native, so JS says it; native answers one
question and owns no wording, and no new prop or event appears. **When it is asked:** from the
render that was handed the name, not from native as props land. The answer is a property of the
device, not of this commit, so asking there cannot race the commit, whereas a native push would
need a drain point on the JS side and any point that is not "the next render" is a guess. The
ask is batched into one core call, so an app pays one timer and one promise per new name.

`Checkbox` draws only glyphs the library picks (`NitroUiCheckboxGlyphs`), so it has no
app-supplied name to ask about; the other seven components of the brief's grep are covered.

The suite is iOS only by its file name: `.ios.harness.tsx` is the harness's own exclusion,
because a file that registers no test on the other platform is a failed suite there.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2267 tests / 106 suites | `27363a768d7b` | 57.8 s | start 9.4 / med 11.0 / max 14.5 |
| `harness:ios` | **PASS** | 625 tests / 31 suites + isolated 6 tests / 3 suites | `823a640eca8f` (harness:ios digest) | 14 m 32 s | start 5.4 / med 4.7 / max 6.1 |
| `harness:android` | **PASS** | 681 tests / 31 suites + isolated 6 tests / 3 suites | `823a640eca8f` (harness:android digest) | 18 m 33 s | start 5.4 / med 4.5 / max 6.1 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:SystemImage` | **PASS** | 3 tests / 1 suites | `823a640eca8f` (harness:ios digest) | 11.0 s | start 4.2 / med 4.3 / max 4.3 |

`need --for review`: review is satisfied on this code tree. The two `real-input` gates are left
for merge, as the brief says.

## Red proofs

All three tests in `SystemImage.ios.harness.tsx`, each filtered run (`harness:ios:SystemImage`,
3 tests):

- `names the Button prop and name iOS cannot draw, once` (and its two siblings) ->
  `warn()` returns before `console.warn` -> `no warning named "nui.fix36.button.missing" within
  8s; warnings so far: []`.
- `names the Button prop and name iOS cannot draw, once` -> the answer test inverted
  (`missingNames.has(name)`, so the names the device *can* draw are the ones warned about) ->
  `warnings so far: ["nitro-ui: Button's systemImage \"square.and.arrow.up\" is not an SF Symbol
  this iOS can draw. …"]` — the valid name warned and the invalid one stayed silent. This
  inversion was a real defect introduced while tidying the helper, and the device caught it
  before it was committed.
- `names a row-level name by the item prop that carried it` -> the first mutation ->
  `no warning named "nui.fix36.item.missing" within 8s; warnings so far: []`.

## Files changed

- `src/systemImageName.ts` — the warning: its wording, its once-per-name memory, its batch.
- `src/NitroUiCore.nitro.ts`, `src/NitroUiCore.ts`, `cpp/HybridNitroUiCore.hpp`,
  `cpp/HybridNitroUiCore.cpp`, `cpp/NitroUiSystemImages.hpp`, `ios/core/NitroUiSystemImages.mm`
  and the regenerated `nitrogen/generated/` — the device's answer.
- `src/components/{Button,Chip,IconButton,ListItem}/…`, `src/components/Menu/{Menu.tsx,MenuRows.ts}`,
  `src/components/ButtonGroup/ButtonGroup.tsx` — the call sites, including row-level ones.
- `example/__tests__/SystemImage.ios.harness.tsx` — the suite.
- `docs/components/{button,button-group,chip,context-menu,icon-button,list-item,menu}.md`,
  `.changeset/ios-sf-symbol-name-warning.md`, `etc/react-native-nitro-ui.api.md`,
  `etc/package-files.txt`.

## Follow-ups

- CONTRIBUTING: the harness's `.ios.` / `.android.` file-name exclusion is undocumented; a
  runtime platform guard alone makes the other platform's run red with "must contain at least
  one test".
- `src/iconName.ts`: an Android name that is well formed but not shipped stays silent by
  design, so the new iOS warning is sharper than the Android one, not symmetrical with it.
