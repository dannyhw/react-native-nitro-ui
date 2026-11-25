# FIX35 review

**Verdict: fix round** (one small doc fix; the native change itself is correct). Diff `b93d3b60..HEAD`.

## What was checked

- Every iOS path: `PickerContent` renders `.menu` or `.wheel` only (`radio` resolves to `menu` in JS and again
  in `NitroUiPickerVariant.resolved`). No inline, navigation-link or `Form`-hosted style exists: the host is a bare
  `UIHostingController(rootView: NitroUiRoot)` (`ios/core/NitroSwiftUIHost.swift:117`), `<Host>` and the
  Form put the Picker in its own hosting view, so no SwiftUI container that draws a `Picker` label wraps it. No
  `#available` branch or iOS < 26 fallback in the file. Recycle resets `label` (`HybridNitroUiPicker.swift:379`).
- Nothing but `OptionalPickerAccessibility` and the Nitro getter reads `model.label` now. The `label` setter's
  `markDirty()` is still needed (the a11y modifier reads it).
- Names: label only -> `.accessibilityLabel(label)`; accessibilityLabel only -> unchanged; both ->
  `accessibilityLabel` wins, as documented; neither -> `label == nil` already took the `EmptyView()` branch and
  no modifier applies, so the tree is identical to main. No combination loses its name.
- The harness claim holds: Checkbox (`HybridNitroUiCheckbox.swift:565`), ButtonGroup (`:1055`), Chip, IconButton
  answer `unavailable` because a hosting view vends `accessibilityElements == []` in-process.
- The self-clearing debt check is real (`scripts/real-input/ios-run.mjs:282`, `a11y.mjs:1540`).

## Findings

1. **blocking**: `src/components/Picker/Picker.tsx:70-72`: the JSDoc on `label` says "iOS uses it as the menu's
   title and for accessibility". The menu's title is the selected option (`Picker.tsx:81`, picker.md:35, :248),
   and after this change `label` never reaches SwiftUI except as the a11y name. Failure scenario: an app developer
   sets `label="Size"` and expects "Size" as the menu button's title or a menu header on iOS, and gets neither.
   `docs/components/picker.md` was corrected; the consumer JSDoc, the text the editor shows, was not. Suggested
   text: "Android draws it as the Material 3 field's label. iOS draws nothing and uses it as the control's
   accessibility name when `accessibilityLabel` is not set. Default: none."
2. **blocking (same fix, internal)**: `src/components/Picker/Picker.nitro.ts:31` says the same thing ("iOS uses it
   as the menu's title and draws none"). Correct it in the same round.
3. **non-blocking**: `ios/components/Picker/HybridNitroUiPicker.swift:21-22`: the `PickerModel.label` doc comment
   ("Drawn where the platform draws one") and `:253` ("A label may change the control's width") are now false
   for this iOS-only file. Neither style draws the label, so a label change cannot move the box. Fold the two comment
   fixes into the round; keep the `markDirty()`. Dropping `noteContentSizeMayHaveChanged()` and the iOS
   `lbl:` part of the sizing key (`Picker.tsx:164`) is a follow-up, not this round: it only costs a redundant
   measure per label change.
4. **non-blocking (merge path)**: this branch cannot pass `real-input:ios`: `a11y:ios-debt` goes red on the
   now-stale `hosted-picker` exemption (`scripts/real-input/a11y.mjs:756`) until that row is deleted and the case
   gains `iosTrait: 'button'` (`:381-394`; the comments at `:389-393` and `:659-662` go stale too). `scripts/`
   is out of scope here, so the orchestrator must land those lines on the merge branch (or via the tooling owner)
   before the merge run. Otherwise `need --for merge` cannot be satisfied.
5. **non-blocking (guard)**: until item 4 lands, nothing on this branch guards the fix. The `hosted-picker` case
   is exempt, and the unhosted `picker` case (`a11y.mjs:205-213`, `iosTrait: 'button'`, not exempt) renders
   `accessibilityLabel` only (`example/src/PickerScreen.tsx:337`), the one combination that never doubled. A
   cheaper guard within the brief's scope: add `label="Real-input picker"` to that Picker. The existing non-exempt
   case then goes red on a regression ("announces the control's name twice") with no `scripts/` change. Cost: it
   draws an Android field label (+8 dp on PickerScreen), so it needs a filtered `--a11y picker` run on both
   platforms. Fine to take in the fix round or leave as a follow-up. The item-4 change alone also gives a guard.
6. **non-blocking**: the new comment at `HybridNitroUiPicker.swift:110-112` meets AGENTS.md "Comments": three lines,
   why the obvious approach is wrong, no history or references. The report's readings cover the four combinations
   hosted and unhosted plus a labelled wheel, and that wheel's box (330 x 216) supports "no visual change".
   The opened menu (whether a standalone `.menu` Picker ever showed the label as a menu header) was not captured
   before and after. SwiftUI shows a Picker label as a header only when the Picker is nested in a `Menu`, which
   this component never is, so I accept the claim.

## Not a problem

- `docs/components/picker.md:33` and `:56` are true for both platforms after the change.
- Android is untouched (one Swift file, one doc file).
