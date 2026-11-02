# G14 — BottomSheet

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task G14 --boot`). G13 (TextField) holds the other pair on
this host.

## Read first

- AGENTS.md (the perf contract, red proofs, the controlled-value handshake);
- `docs/DECISIONS.md` D33 and **D35**: D35 settles the presentation and overrides Q5 C6;
- `docs/tasks/Q5-next-components.report.md` Appendix C, the design;
- `docs/tasks/S2-bottomsheet-spike.report.md` and its prototype branch `origin/task/S2-bottomsheet-spike`. Reuse
  what it proved, but don't merge it;
- G11's dialogs on `main` (`ios/core/NitroUiPresentation.swift`, `docs/components/dialog.md`): the presentation
  helper, and the current registry, conformance and docs conventions.

## Do

1. **Build `BottomSheet`** to Appendix C as amended by D35:
   - RN children in the presented window, at the sheet's width;
   - `isPresented` through the event-count handshake (as the dialogs do);
   - detents in SwiftUI's names (`fit`, `medium`, `large`, height, fraction). The selected detent is reported, not
     controlled, in v1. Android uses Material 3's two detents and documents the limit;
   - content mounted only while presented;
   - the iOS presentation rule from D35 (in-chain, or an own window under a top RN `Modal`), with an
     unasked-dismissal witness. Close the own-window `fit` gap, or document it;
   - the Android Material 3 `ModalBottomSheet`;
   - registry and component.json entries, the conformance rules, an example screen and Storybook stories,
     `docs/components/bottom-sheet.md`, a README section with screenshots, and a minor changeset.
2. **Tests, red first,** on both platforms:
   - present and dismiss: by drag, back and outside tap, and by JS mid-animation;
   - drop while presented;
   - touches and a `ScrollView` inside;
   - `fit` following content;
   - recycle-reset;
   - 50-cycle cleanliness;
   - real-input: an XCUITest drag and dismiss on iOS, and a real tap on Android;
   - the stranded-Modal hazard case in its own app instance (D35 item 5).
3. **react-native-screens:** measure a sheet presented from a native-stack screen and from a `formSheet`, with the
   dependency added for one commit and reverted (D35 item 3).
4. **Bench arms** for present and dismiss, if cheap. Otherwise one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G14-bottomsheet.report.md`, with the ledger exported.
