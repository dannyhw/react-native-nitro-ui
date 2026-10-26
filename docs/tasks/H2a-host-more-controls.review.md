# H2a review: Android `<Host>` for Slider, Progress, Button (+ N4)

Branch `task/H2a-host-more-controls`, 14 commits on `9c60166`, reviewed at `f69db4f`.
This was a read-only review. I re-ran `bun run typecheck` (exit 0), `bun run lint` (clean) and `bun run test` (16 suites / 237 tests, matching the report). I also re-ran `node bench/tools/arm-ratios.mjs` with Node 24 for `--arm=nitro-ui-host`, `--arm=nitro-ui` and `--arm=expo-ui-shared-host` on `bench/results/e7b7dbf-dirty-android-20261026T135002Z.json`. No devices were used, so the on-device red proofs are checked by reading the code, not by re-running them.

## Verdict: MERGE WITH FIXES

The native change is small and correct:
- `isHostable` on three hosts.
- Two `isHostedByParent` early returns.
- A release path for the move-in transition.
- The accessibility-event guard on the Host.

Unhosted behaviour is unchanged. The N4 probe, after `0a4501f`, is a real gate. Every number in the report, `host.md` and `sizing.md` tables matches the results file.

The fixes are about claims:
- The README draws verdicts from cells the repo's own tables flag as noise.
- The F8 follow-up's new assertion never exercises the condition F8 described.
- The report overstates what three of its gates prove.

None of the fixes needs a native change.

## What holds (checked, no finding)

- **Accessibility guard (`NitroUiHost.kt:223-231`) does not drop real events.**
  - With a reader or UiAutomation connected, `AccessibilityManager.isEnabled` is true and `super` runs.
  - With nothing connected, `ViewRootImpl` → `AccessibilityManager.sendAccessibilityEvent` would throw on the main thread anyway.
  - Compose itself sends nothing while disabled, unless `forceAccessibilityForTesting` was called. Only the Slider step seam (`HybridNitroUiSlider.kt:1006`) calls it.
  - So the guard is the same refusal `SliderHost` already makes, applied at the view the event now leaves through.
- **N4 transitions (`NitroComposeHost.kt`), by reading the code:**
  - *Mounted directly hosted.* `parent` is set by `addViewInner` before attach, so `armCompositionStrategy` (:674) and `watchForFirstFrame` (:999) both decline. The child's `ComposeContent` attach then installs `DisposeWithTheHost`, which is harmless.
  - *Moving into a Host.* `strategyArmed` short-circuits the arm. `ComposeContent.onAttachedToWindow` (:505-511) then disposes the composition and releases both guards. `ViewGroup` dispatches child attaches after the parent's `onAttachedToWindow`, so the release runs last.
  - *Moving out.* `strategyArmed` is false and the parent is not a Host, so the arm runs. `firstFrameWatchRegistered` was cleared, so a mount that never marked a frame re-arms it.
  - *Host unmounting.* Every child still goes through `drop()`, which is idempotent with nothing armed.
  - *Recycling.* `prepareForRecycle` resets both `everArmed*` flags together with the live ones.
  - `releaseOwnCompositionGuards()` leaves `strategyArmed=false`, `firstFrameWatch=null` and `firstFrameWatchRegistered=false`, which is exactly the state the re-arm needs.
- **Unhosted paths.** Every new branch is gated on `isHostedByParent`. The `everArmed*` flags are write-only for unhosted mounts. `strategyArmed` / `drop()` / `PreDrawWatch` and the C1 placement path are untouched, and hosted content still skips `NitroUiMeasuredRoot`.
- **D24 per control matches the code.**
  - The Host's `Column` offers max width only.
  - The linear Progress applies `fillMaxWidth` (`HybridNitroUiProgress.kt:307`).
  - The M3 Slider fills its constraint.
  - Button (`maxLines = 1`, ellipsis), Switch and circular Progress size intrinsically at the leading edge.
  - `host.md`, `sizing.md` §10, the `HostProps` docs, the harness sizing cases and real-input `hosted-mixed` all say the same thing. One exception is a bench comment (nit N1).
- **Progress inside the shared composition is read from the drawing.** `recordDrawn` runs in `ProgressContent`, so `nuiTestDisplayedValue` and `nuiTestIsAnimating` really do read the composition, and the animation pair is a sound gate.
- **Button.** Presses through the Host (`pressRow`/sweeps), the disabled/enabled pair and real-input `hosted-button` go through the Host's `AndroidComposeView`. These are real gates.
- **N4 probe.** It reports whether a guard was ever armed during the mount. Deleting either `isHostedByParent` return turns it red even though the move-in release would unarm the strategy straight away. That makes it a sound, red-able gate for the steady state (see S2 for the transition it cannot see).
- **Leak gate.** It is still adequate for H2a:
  - The mixed cycle has 100 children per Host. A per-child retention of B1's size (~42 KiB) would be about 4 MiB per cycle, twice the bound.
  - Retaining the whole composition from any one kind retains all 100 children.
  - The one gap is a fixed per-Host leak triggered only by a non-Switch child. The report states it honestly, and the 200-Hosts gate covers the kind-agnostic version (see N8).
- **Bench tables.**
  - The absolutes and ratios in `README.md`, `host.md`, `sizing.md` §10 and the report match the results file.
  - `machine.loadSamples` is 459 samples, median 5.51, p90 15.87, max 36.18, 170 over (37.04 %), `quiet: false`, `problems: []`.
  - The quiet caveat is present in all three documents.
- **Personal data.** No added line carries a home path, email, hostname or the owner's AVD/device name. The results file does hold the hostname, but it is gitignored (`.gitignore:102`) and not committed. See N7 for the simulator UDID.

## Must-fix

### M1: the README gives verdicts on cells its own tables flag as noise

`README.md:277-285`:
- "unmounting costs 0.68×/0.67×/0.82×/0.62×, all of them below the shared host." All four cells have spreads over 10 %: Switch 40 %, Button 37 %, Progress 26 %, Slider 21 %. `sizing.md` §10 marks every one of them ᴺ.
- "`Button` stays under it (0.71×)". That cell's spread is 10.x %, so it is ᴺ. `host.md` says to read it as "no worse", not as a win.
- "`Slider` … 1.07×" is printed with no flag. Its spread is 16 % (ᴺ).

Scenario: a reader of the public README takes "unmount below the shared host on all four" as a measured result. On this run it is not one.

**Fix:**
- Drop the unmount clause, or say "unmount UI CPU reads 0.62–0.82× but every cell's spread is over 10 %, so no verdict".
- Mark the Slider (1.07×) and Button (0.71×) JS figures as no-verdict, as `host.md` does.

### M2: F8 is not exercised, and the `testID` caveat was not corrected

The new F8 assertion is at `example/__tests__/Host.harness.tsx:590-626`, with the `Grower` helper at `:318-340`. It forces the "later Fabric layout" by growing a spacer *below* the Host's wrapper.

That does not change the layout metrics of the Host or of any hosted child. Fabric only emits `UpdateLayout` for nodes whose metrics changed. So `SurfaceMountingManager.updateLayout`, which is what F8 says re-lays a child at its Yoga frame, never runs for `find-sized`. The `[0, 0, 0, 0]` assertion therefore passes whether or not F8 is real.

The H1 re-review asked for something else (`H1-android-host.rereview.md:209,254`): a child added or re-framed later while the Host's frame stays the same, e.g. `list-d`. `list-d` still only asserts `not.toBeNull()` (`Host.harness.tsx:492`). The public caveat at `docs/components/host.md:279-283` ("**`0 × 0` at the Host's origin**") is unchanged, and the new test comment ("stays decorative for the whole mount", `:604-605`) asserts more than the test shows.

**Fix:**
1. Re-frame the hosted child itself after mount, e.g. flip `find-sized`'s own `style` from `120×44` to `160×60` via state. Also assert `list-d`'s box after it joins.
2. Record what Android answers.
3. Then make `host.md:279-283` match: either it stays `0 × 0`, or "0 × 0 at mount, its Yoga frame after a later re-frame".

### M3: three report claims are not what the branch shows

All three are in `docs/tasks/H2a-host-more-controls.report.md`.

1. **`:152-157` calls `089ec1e` and `c8f5819` "two real bugs".** That sentence reads as "a hosted Button needing a second tap before its press reaches JS on a real touchscreen". `089ec1e` actually adds a missing second `tapNode` to the check script: the check waited for `2` without tapping again. `c8f5819` fixes a Swift throwing-autoclosure compile error in the UI test. Neither is a library bug.
   - **Fix:** describe both as test-script bugs.
2. **`:31-34` says drag gestures, the three phase callbacks, the controlled handshake and `disabled` "all run inside the Host's composition".** Four of the harness cases cannot show that:
   - "reports a hosted drag…" (`HostControls.harness.tsx:564`)
   - "snaps … back" (`:595`)
   - "shows a JS write…" (`:619`)
   - "keeps a disabled hosted Slider inert…" (`:641`)

   They drive `SliderModel` directly through `nuiTestDrag` → `runTestDrag`. That path checks `if (!model.enabled)` itself (`HybridNitroUiSlider.kt:925`), and `displayed` is a model field written in `afterUpdate`/`dragTo`. The report's own red proof confirms it: with `HybridNitroUiSlider.isHostable = false`, only 2 of 19 cases fail. Composition-level Slider evidence is the sizing tap test, the accessibility step and real-input `hosted-slider` (drag only).
   - **Fix:** say exactly that. The test-side fix is S1.
3. **`:216-218` says the move-in transition is covered ("both are covered (`releaseOwnCompositionGuards()` is idempotent)").** No gate covers it, and the probe cannot see it (S2).
   - **Fix:** say "reasoned, not gated", or add the gate.

## Should-fix

### S1: hosted Slider `disabled` and snap-back have no composition-level gate

Files: `example/__tests__/HostControls.harness.tsx:595-669`, plus the comments at `:610-611` and `:631-632`. Those comments claim `nuiTestDrag` "is a reading of what Compose drew", but it reads `model.displayed`.

Scenario: suppose a hosted Slider kept answering taps while `disabled`. That would need the Host's composition to miss the `enabled` recomposition. Every current gate would stay green: the harness refuses in `runTestDrag` before Compose is involved, and real-input `hosted-slider` has no disabled half.

**Fix:** reuse `tapSlider`'s `probeIn` on the track inside the Host.
- Disabled: a real tap must answer `null`. After `setSliderDisabled(false)`, the same tap must answer.
- Refused (`accept={false}`): a second tap at a different offset must report `onSlidingStart` from the *old* value.

Then correct the two comments.

### S2: the N4 move-in release path is ungated, and the probe cannot see it

Files: `NitroComposeHost.kt:505-511,721-726`; `armedGuardsReport()` at `:744-753`.

The probe reports `everArmed*`, which stays true after a release. If `releaseOwnCompositionGuards()` were deleted, a control that moves into a Host would keep an activity `LifecycleRegistry` observer until it is dropped, and nothing would turn red. The move is reachable through view flattening: an app wrapper whose `View` flips between layout-only and not reparents the control into or out of the Host.

**Fix:**
- Make the report include the live state as well, e.g. `strategy,preDraw|live:` vs `|live:strategy`.
- Add one case where a wrapper component (JS cannot see through it) toggles its `View` between layout-only and styled. Assert that the Switch inside reads live-empty once it is inside the Host, and that it re-arms (`strategy`) once it is back out.
- If that is out of round, downgrade the claim per M3.3 and add a FOLLOWUPS line.

### S3: the `nuiTestArmedGuards` spec doc describes the probe as it was before `0a4501f`

`src/components/Switch/Switch.nitro.ts:83-96` says "the guards this view **currently holds** … `strategy` *while* … installed, `preDraw` *while* … registered". It now reports whether each guard was ever armed during the mount. That is the exact distinction that made the round-1 gate unsound.

**Fix:** reword to "armed at any point in this mount (reset on recycle)", matching `armedGuardsReport()`'s KDoc.

### S4: inconsistent reason for taking `alignSelf` off the warning

The warning reads the Host's *own* style (`Host.tsx` `INERT_HOST_STYLES`). F5 and `Host.tsx:219-221` give the right reason: a Host's `alignSelf` moves its box, and the drawing is inside the box.

Four places instead say it is about "a child's own `alignSelf`" / "a self style never reached the drawing on either side":
- `docs/components/host.md:164-166`
- `docs/architecture/sizing.md:616-618`
- `NitroUiHost.kt:65-69`
- the report at `:226`

That reason is wrong: the warning never looked at children. Separately, `host.md`'s "Only some of a Host's own styles reach the drawing" list (`:151-153`) leaves out `alignSelf`, while `Host.tsx:74-75` lists it as reaching.

**Fix:**
- Use the `Host.tsx` reason in all four places.
- Add `alignSelf` to `host.md`'s list of Host styles that reach the drawing.
- Keep the separate, true point that a *child's* `alignSelf` is decorative (`host.md:146`).

### S5: noise statements that the results file does not support

- `docs/components/host.md:97` says "the `update` cells are all ᴺ". The report at `:275-276` says every host-arm `update.*` cell is over 10 % "except `mounted`".
  - Neither is true. For example, `update` vs shared: `mainNsPerOp` 0.84x (5 %), `jsCommitNs` 0.96x (6 %). `update.slider` vs shared: `mainNsPerOp` 0.70x (3 %).
  - **Fix:** say the `update` cells are mixed, and were not used for any claim.
- The report at `:277-278` says `update.progress` "lost its `rn-core` and `expo-ui-*` pairings entirely".
  - In fact `jsCommitNs` and `jsNsPerOp` pair with all four arms, and `mainNsPerOp` pairs with both `expo-ui-*` arms (0.04x / 0.05x). What is `n/a` is `mountedNs`/`presentedNs` against `rn-core` and the `expo-ui-*` arms, plus `mainNsPerOp` against `rn-core`.
  - **Fix:** list the `n/a` cells precisely.
- The report at `:260-262` says "The Host does what H1 said it does, on all four" from host ÷ unhosted UI CPU of 0.54x / 0.50x / 0.56x / 0.48x. The Switch and Button cells are 13 % (ᴺ).
  - **Fix:** flag those two cells.

### S6: where the `onDropView` red proof came from

The report at `:171` gives `expected 10.98 to be less than 2`. That is H1's figure to the hundredth (`H1-android-host.report.md:385`). Yet `:162-163` says the rows above the last two "are from the final tree". The same sentence also mentions "earlier rounds of this task" while the header says round 1 of 3.

**Fix:** either paste the H2a run's log line (`growthMiBPerCycle=…`), or label the row as H1's proof that was not re-run. Also reword "earlier rounds" to say what it means (earlier iterations within round 1?).

## Nits

- **N1.** `bench/src/implementations/nitroUi.tsx:124` lists `Switch` among the `fillWidth` controls. Switch is intrinsic (D24, `host.md` table). Drop it from that list.
- **N2.** `example/__tests__/HostControls.harness.tsx:730` cites a `hosted-progress` real-input case that does not exist. The Progress geometry is read in `hosted-mixed` (`scripts/real-input/android.mjs:435`).
- **N3.** Report errors:
  - `:105-106` names `NitroUiSwitch.nitro.ts` and `src/specs/NativeNitroUiSwitch.ts`. The real paths are `src/components/Switch/Switch.nitro.ts` and `src/components/Switch/NativeNitroUiSwitch.ts`.
  - `:36` and `:93` mention "progress-report probe(s)" that now search the Host. Only `runTestAccessibilityStep` changed (`HybridNitroUiSlider.kt:995-996`).
- **N4.** The report at `:39-42` says a hosted Slider "dies … on the first drag" without the Host guard. The throw needs Compose's accessibility to be forced on, which only the step seam does. In an app with no reader, Compose sends nothing. Say "after the screen-reader step seam forces semantics", as `SliderHost`'s own KDoc does. The guard is still right to have.
- **N5.** The report at `:96` and the `ProgressHost` KDoc (`HybridNitroUiProgress.kt:197-204`) say an indeterminate bar "stops when the Host leaves the window". That is reasoned from `onDetachedFromWindow` and is not gated for the hosted case. Either say so, or add a detach case. A Host whose `display` flips is not enough: that path removes the child from the composition, it does not detach it.
- **N6.** "T16 spike" wording outside Kotlin: `ios/components/Host/HybridNitroUiHost.swift:5`, `src/components/Host/Host.nitro.ts:12`, `bench/src/plan.ts:35`. The brief only asked for Kotlin headers; clean these in the same sweep.
- **N7.** The report header (`:5`) has the full simulator UDID. Main has precedent for this, and D25 bans device *names*, not UDIDs. Redacting it the way `<avd>` already is would cost nothing.
- **N8.** The leak gate is adequate (see above). If a later round wants the per-Host, per-kind case closed cheaply, rotate the kind in the 200-single-child-Hosts gate (`MountChurn.harness.tsx`) instead of adding a third shape.
