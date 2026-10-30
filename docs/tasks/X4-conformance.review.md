# X4 — review (2026-10-29)

**Verdict: FIX ROUND.** The unit half is sound (144 tests pass; three red proofs reproduced). Several device-half rules marked `covered` cannot go red for the bug they are named after.

## Must-fix

- **M1 — the iOS a11y rule compares the wrapper with itself** (`example/__tests__/Conformance.harness.tsx:958-985`). Nitro props extend `ViewProps`, so `RCTViewComponentView` copies the label onto the wrapper (`RCTViewComponentView.mm:471-473`); `HarnessUI` finds that wrapper by `accessibilityLabel` (`ViewQueryHelper.mm:65`) — the same view `queryByTestId` returns (`box == labelBox` for every control in the logs). Deleting `content.accessibilityLabel(label)` (`HybridNitroUiSlider.swift:460`) leaves it green. The brief's trait is unchecked and nothing covers iOS inside `<Host>`. Fix: assert on the real accessibility tree via XCUITest under `real-input:ios` (label, frame matching the control, trait, hosted cases); prove red by removing that modifier.
- **M2 — the recycle-reset rule cannot fail** (`Conformance.harness.tsx:925-956`). The second owner sets every checked prop, so every setter runs. iOS Fabric recycles by default (`RCTComponentViewRegistry.mm:110-117`), so the "not reached" claim is Android-only. Deleting `model.accessibilityLabel = nil` (`HybridNitroUiSwitch.swift:319`) stays green. Fix: first owner non-default, second owner default/`null` (so `hasSameValue` skips setters); prove red with that deletion; correct the iOS claim.
- **M3 — the leak rule has no positive control and no red proof on a real control** (`Conformance.harness.tsx:890-923`). 50 immediate mount/unmounts show `ledger 0→0`; an instance that never registers can't leak. Fix: keep K mounted and settled, assert the ledger rose by K, then back to baseline; prove red on Android by removing `host.drop()` from one control's `onDropView`. Every report red proof mutates a pure function; the brief asks for each rule red once on a real control.
- **M4 — `task-ready` accepts invented gate rows** (`scripts/task-ready-core.mjs:171`): only generated→report is checked. Flag report rows whose gate the generated table doesn't print.
- **M5 — "registered before first measure" can be satisfied by another file, and `restore()` leaks numbers into later files** (`Conformance.harness.tsx:826`, `:536`). `seedSize` also writes `fallbacks_` (`NitroUiSizingEngine.cpp:512`); `Button.harness.tsx` seeds Button earlier in the process. Fix: read registration for every manifest before any seed (e.g. ColdSizing's first-in-process block), and drop or rework `restore()`.

## Nits

- N1 `scripts/real-input/a11y.mjs:452` `hasActableHome` checks containment only; add the size bound the message promises.
- N2 `task-ready-core.mjs:22` TODO scan misses the component sources holding the numbers (`fallbackSize`, `FALLBACK_*_DP`).
- N3 `checkInAppFixtures` matches substrings (a comment satisfies it); a non-self-sizing control makes `declaredFallback()` throw at collection.
- N4 `Conformance.harness.tsx:297` claims a parity check in `conformance.test.js` that doesn't exist.
- N5 `DECLARED_FALLBACK_EXCEPTIONS` comment says the harness asks the engine for its number; JS can't read it.
- N6 New `package.json` scripts change the published `package.json` — orchestrator ruled: accepted (X9 precedent; scripts are inert to consumers).
- N7 `task-ready.mjs:302` uses `git ls-files` (index), not `git ls-tree -r HEAD`.
- N8 No merge-base → the TODO section prints `ok`; it should not let the command say "ready".
- N9 The a11y rule's `applies` "n/a" branch is unreachable.

Android a11y sweep, new-manifest coverage, the four Android exemptions (state that `/not actionable/` can hide a same-class move) and the poisoned-guess half of the fallback rule are sound.
