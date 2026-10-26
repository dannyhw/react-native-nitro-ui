# G4 — SegmentedControl · implementation report

Branch `task/G4-segmented-control` from `340e521` (the commit `main` was at when
the worktree opened). **Scope: SegmentedControl only.** `Picker` is 0.2 (D19) and
was not started — no spec, no wrapper, no docs page for it.

SwiftUI `Picker` with `.pickerStyle(.segmented)` on iOS, Material 3
`SingleChoiceSegmentedButtonRow` + `SegmentedButton` on Android, both on the T10
core and sized by the T11 engine. Structurally this is Switch (a user-editable
value behind the event-count handshake) plus Button (a size that comes from props).

## What shipped

**Component**

- `src/components/SegmentedControl/SegmentedControl.nitro.ts` — the Hybrid View
  spec (`options`, `selectedIndex`, `defaultSelectedIndex`, `disabled`, `tintColor`,
  `accessibilityLabel`, `testID`, `onValueChange`) plus `NitroUiSegmentedControlSize`.
  `selectedIndex`, `tintColor`, `testID`, `accessibilityLabel` and `nuiPerfId` are
  `T | null`; `options`, `defaultSelectedIndex`, `mostRecentEventCount` and `disabled`
  are plain `T` (they have no meaningful null). No `?:` on any prop except the
  callback (D7/D7b).
- `src/components/SegmentedControl/SegmentedControl.tsx` — the wrapper:
  `useControlled` + `useStableCallback` + `useProcessedColor`, the JS-side clamp, and
  `nuiSizingKey = "<count>|<escaped labels>"`.
- `src/components/SegmentedControl/NativeNitroUiSegmentedControl.ts`,
  `NitroUiSegmentedControlConfig.ts`, `SegmentedControl.perf-test.tsx`, `src/index.ts`.
- `ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift` — the model,
  the clamp, the `Picker` content, the size-affecting setters
  (`noteContentSizeMayHaveChanged()` + `noteSizingKeyChanged()`), the declared
  fallback, the `RecyclableView` reset.
- `android/.../HybridNitroUiSegmentedControl.kt` — the Compose content, the same clamp
  in `afterUpdate()`, `SegmentedColorsCache`, the declared fallback,
  `RecyclableView` with a composition dispose. No `recreateIfNeeded`: options and
  selection flow through the model, so one `setContent` at init and no re-seeded
  fallback (the trap G3 hit on Progress).
- Registration: `nitro-ui.sizing.json` (`intrinsic`), `NitroUiDeclaredFallbacks`
  (both platforms, T14), `NitroUiPackage.kt`, nitrogen output, autolinking,
  `src/__tests__/viewConfigs.test.ts`.

**Docs, example, screenshots**

- `docs/components/segmented-control.md` — API table, platform mapping, the clamping
  table, measured size tables, accessibility, behaviour notes, limits.
- `example/src/SegmentedControlScreen.tsx` behind a `Segments` tab: real-input pair,
  controlled, uncontrolled, options changing on a timer, disabled, tinted, long
  labels under a caller width, and 200 controls in a scrolling list.
- `docs/tasks/G4-segmented-control/{ios,android}-{light,dark}.png`.
- `scripts/smoke/App.tsx` lines, `etc/react-native-nitro-ui.api.md`,
  `etc/package-files.txt`.

**Bench**

- `bench/src/implementations/{rnCore,expoUi.ios,expoUi.android,nitroUi}.tsx` +
  `shared.ts`: a segmented arm for every implementation. The `rn-core` control is a
  row of `Pressable`s — RN core has no segmented control, and that row is what a
  pure-JS version of this control is.
- `bench/src/plan.ts`, `scripts/bench/lib.mjs`: `mount|update|memory.segmented-control`
  cells for `--component segmented-control`; `scripts/__tests__/bench-gate.test.js`
  gained the pairing/doubling/reference-arm/component-scoping cases.

## Decisions

- **The clamp lives in `afterUpdate()`, not in a setter.** `options` and
  `selectedIndex` arrive in one batch in arbitrary order (core.md §3), so an index of
  4 has no meaning until the option list it belongs to is known — the same reason
  Slider normalises `value` against its range there. Rule, documented in
  `docs/components/segmented-control.md`: past the end → last option; junk/negative →
  first; `options` shrinking → the index is clamped, never cleared; `options` growing
  → the selection stays on the same option. The wrapper clamps too, so the JS the
  control is configured with is already legal and a harness read-back cannot tell a
  missing native clamp from a JS one — which is why `clamps an index written straight
  to native` writes through the handle.
- **`nuiSizingKey` = option count + escaped labels** (`'|'` separator, `\` → `\\`,
  `|` → `\|`). Without the escape, the same-count pair `['aa|bb', 'c']` and
  `['aa', 'bb|c']` build one key and share a cached size that is wrong for one of them
  for the life of the process (a different-count pair like `['a|b']` and `['a','b']` is
  already told apart by the prefix). The count is in front because escaping alone
  cannot tell `[]` from `['']` apart. `disabled` and
  `tintColor` repaint and are deliberately not in the key.
- **One declared fallback per component**, measured rather than guessed:
  `165 × 31` pt (iOS) and `256 × 48` dp (Android), both registered at startup in
  `NitroUiDeclaredFallbacks` (T14) and both poisoned in the harness so a missing
  correction is visible (D17).
- **Colours are cached, not rebuilt.** `SegmentedButtonDefaults.colors()` allocates,
  so the M3 `SegmentedButtonColors` per `(scheme, tint)` come from a bounded
  process-wide cache keyed on the theme's identity (core.md "Shared objects", the
  same fix G1/G2/T12 needed). `itemShape` is index-derived, not theme-derived, so it
  is not cached.
- **Android renders no check icon.** M3's default `icon` draws a check on the selected
  segment only, which would make width depend on the selection and force
  `selectedIndex` into the sizing key. Labels only, like iOS.
- **`tintColor` is Android-only.** SwiftUI ignores `.tint()` on a `.segmented` `Picker`
  (`F1`), so the prop has no visible effect on iOS: the selected segment keeps the
  scheme's accent fill there. On Android it replaces the selected segment's container
  *and* border. Documented as a limit in the API table, the platform mapping, the
  limits list and both JSDoc blocks, and left in the spec rather than faked into
  symmetry; a per-instance iOS tint is a follow-up (a custom segmented view, not
  `UIAppearance`, which would repaint every `Picker` in the app).
- **The two platforms do not share a segment-width rule** (Android gives equal
  shares, iOS uses SwiftUI's own distribution). Both grow with the labels, which is
  all the sizing key claims; documented in the limits.
- **Nothing pops up**, so the brief's "don't leak an open menu on recycle" is
  satisfied by construction here — but the recycle path still resets the model and
  disposes the Android composition, and the remount test covers it.

## Gates

| Command | Result |
| --- | --- |
| `bun run check` | **pass** (typecheck, bench typecheck ×2, eslint, prettier, jest, `test:native` under ASan, `perf:renders`, nitrogen drift, autolinking, `bob build`, api-extractor, publint, manifest) |
| `bunx react-native-harness --harnessRunner ios SegmentedControl.harness.tsx` | **14/14 pass** — iPhone Air (iOS 27), `331EF109-21DD-422B-AEF8-DFFFC6998DC3`, Metro 8294, 26.5 s |
| `bunx react-native-harness --harnessRunner android SegmentedControl.harness.tsx` | **14/14 pass** — `nitroui_t02` / `emulator-5572` (API 35), adb server 5042, Metro 8294 |
| `bun run test:real-input:android --control segmented-control` | **pass, exit 0** — `emulator-5572`, 13 assertions, every value read out of `uiautomator dump` |
| `bun run test:real-input:ios --control segmented-control` | **pass, exit 0** — iPhone Air, `testRealInputSegmentedControl` passed (35.0 s), `** TEST EXECUTE SUCCEEDED **` |
| `bunx jest scripts/__tests__/bench-gate.test.js` | **pass** (part of `bun run test`) |

`bun run check` and both real-input runs were re-run on the final tree of the
implementation round (`dcc0397`, after the in-round real-input teardown fix below), and
the Android harness APK was checked byte-for-byte against the artifact built from it.
The Android harness was also run once with failures that never came back; see
**Observations**.

**Fix round 1 re-ran every gate above** after merging `main`, with the harness file
changed (AGENTS.md: both platforms). See **Fix round 1** for the numbers.

## Tests, and what each is shown to fail on

`example/__tests__/SegmentedControl.harness.tsx` — 14 tests, run on both platforms.

| Test | Proves |
| --- | --- |
| lays each option list out at the size the control measured | box = `measureContent()` for three lists, poisoned fallback first, corrections counted |
| re-measures when the options change (R3) | short → long → short reaches each new fitting box |
| re-reports a key change that keeps the size (R3) | the box leaves the fallback when the new key measures what the old one did (the G2 F1 hook) |
| keeps its size when the selection moves | selection is not in the key, and moving it does not resize |
| clamps a selection the caller sends out of range | React's out-of-range index cannot select a segment that does not exist |
| clamps an index written straight to native | the `selectedIndex` **getter's** clamp on both platforms; it cannot see the `afterUpdate()` clamp that decides the painted segment (see mutation proof 9) |
| clamps the selection and re-measures when the options shrink | the documented shrink rule + a re-measure in the same batch |
| reads back what React sent | the handle reports the batch that landed, not a stale one |
| keeps a caller width in charge | `style.width` wins over the measured box (iOS also truncates; Android clips both ends — F2) |
| reports one event per selection, and nothing when disabled | the event, and the disabled path |
| snaps back a selection React does not accept | the handshake: a rejected index returns to what React sends |
| sizes 200 option lists, each at its own size | 200 configurations, each correct (cold-cache path at scale) |
| survives remounts with the size and seed of each mount | recycling / re-seeding, plus the painted selection of a re-mounted uncontrolled control (proof 8) |
| corrects a planted size that matches the current box (iOS measure signal) | D20: an equal-to-box planted size still triggers the re-measure |

Deliberately absent: a suite-local `beforeAll` warm-up mount, and a second live
`render()` tree (G1/G2 lesson).

**Mutation proofs (each red, then reverted; the same two breaks per platform).**

1. *Native clamp removed* (iOS
   `HybridNitroUiSegmentedControl.swift:65`, Android
   `HybridNitroUiSegmentedControl.kt:150` — upper bound dropped) and *`host.noteSizingKeyChanged()`
   deleted* from the `nuiSizingKey` setter, one build per platform:

   ```console
   # iOS (iPhone Air) and Android (nitroui_t02) — identical output
   ● SegmentedControl · G4 › re-reports a key change that keeps the size (R3)
     expected true to be false
   ● SegmentedControl · G4 › clamps an index written straight to native
     expected 9 to be 2
   Tests: 2 failed, 12 passed, 14 total
   ```

   Both platforms fail the same two tests with the same values, which is the point of
   writing the check once and running it twice. Note what stayed green: the *JS* clamp
   keeps the other clamp tests green, so only the handle-written test can see the
   native one — that is why it exists.
2. *`escapeOption` returns the label unchanged* → `bunx jest
   src/__tests__/segmentedControl.test.tsx`: `escapes a separator inside a label` and
   `escapes a backslash too, so the escape cannot be forged` red, 6 green.
3. *JS clamp loses its upper bound* → the same file: `clamps a controlled index into
   the options` and `clamps the uncontrolled seed and sends null as the controlled
   value` red (Expected: 2 / Expected: 1), 6 green.
4. *Bench pairing broken* (`componentOf()` in `scripts/bench/lib.mjs` answers
   `'button'` for `mount.segmented-control`) → `bunx jest
   scripts/__tests__/bench-gate.test.js`: exactly the four SegmentedControl cases red —
   `divides a SegmentedControl arm by the SegmentedControl control`, `fails conclusively
   when the SegmentedControl arm doubles`, `never gates a SegmentedControl reference
   arm`, `only SegmentedControl arms pass a component-scoped comparison` — and every
   Switch/Slider/Button case still green.
5. *Real-input check*: the guard it exists for is the touch path
   (InputDispatcher → RN → the hosted control), and it is a check rather than a
   mutation — its failure mode is a touch that never reaches the control, which every
   in-app test would still pass. Run green on both platforms; the Android half reads
   every value out of the accessibility tree, so the touch path is the only thing that
   can move these numbers:

   ```console
   ✓ the SegmentedControl has reported no index before a touch — expected -, saw -
   ✓ no change has been reported before a touch — expected 0, saw 0
   ✓ a real tap on the second segment reaches JS as index 1 — expected 1, saw 1
   ✓ one tap reports one change — expected 1, saw 1
   ✓ the control did not move out from under the finger — 42,738 → 492,864
   ✓ a real tap on the first segment reaches JS as index 0 — expected 0, saw 0
   ✓ two taps report two changes — expected 2, saw 2
   ✓ the refusing parent pins its SegmentedControl at index 0 — expected 0, saw 0
   ✓ nothing has been reported on the controlled control yet — expected 0, saw 0
   ✓ a real tap on the controlled control still reaches JS - native paints
     optimistically (core.md section 4) — expected 1, saw 1
   ✓ the parent never accepted the change, so the index it sends is still 0 — 0
   ✓ a second tap on segment 2 is a fresh selection, which is only true if the
     refused one was rolled back — expected 2, saw 2
   ✓ and the parent should still be refusing — expected 0, saw 0
   ```

   The snap-back witness is deliberately indirect — a *second* tap on segment 2 must
   report index 2, which is only true if the refused index-1 paint was rolled back.
   Watching the control paint index 1 and then repaint index 0 from outside the process
   is not something `uiautomator` can witness reliably, because both happen between two
   dumps.

**Red runs added in fix round 1 (each break → run → restore, recorded per D17).** The
three gaps the review named — a test that cites `noteContentSizeMayHaveChanged()` without
ever having been shown to fail without it, the snap-back test's teeth, and a remount test
that asserted geometry but not the selection.

6. *`host.noteContentSizeMayHaveChanged()` deleted* from the iOS `options` setter
   (`HybridNitroUiSegmentedControl.swift:235`). iOS only: the call has no Android
   counterpart, because Compose re-measures by itself.

   ```console
   # iPhone Air
   ● SegmentedControl · G4 › corrects a planted size that matches the current box (iOS measure signal)
     expected false to be true
   Tests: 1 failed, 13 passed, 14 total
   ```

   Exactly the test the comment above that call says exists for it, and only that test:
   the claim is now backed by a red run instead of by assertion.
7. *`reconcile()` suppressed* in `afterUpdate()` — run on **both** platforms.

   ```console
   # iPhone Air and nitroui_t02 — identical output
   ● SegmentedControl · G4 › snaps back a selection React does not accept
     Only 1 of 2 change events arrived: ["rejected:1"].
   Tests: 1 failed, 13 passed, 14 total
   ```

   The failure mode is the one the test's comment describes: without the rollback the
   second tap lands on a segment that is already selected, so it reports nothing and only
   one of the two expected events ever arrives. One finding worth recording: commenting out
   only the *body* of the reconcile branch — the copy back to `displayed` — stayed green on
   Android, because the idempotent shrink-clamp block a few lines below re-derives the same
   value. The rollback is defended by two code paths, so the mutation has to remove the
   handshake read itself.
8. *The uncontrolled seed pinned to segment 0*, on **both** platforms, at the seed branch of
   `afterUpdate()` (the `seeded` line) — proving the selection assertion the remount test
   gained.

   ```console
   # nitroui_t02 and iPhone Air — identical output
   ● SegmentedControl · G4 › survives remounts with the size and seed of each mount
     expected [ 'remount-proof:1', 'remount-kept:1' ] to deeply equal [ 'remount-proof:1' ]
   Tests: 1 failed, 13 passed, 14 total
   ```

   The witness control behaved as designed: `remount-proof` (seeds 0) still reported index
   1, which proves a harness tap reaches the control, so the empty log expected from
   `remount-kept` (seeds 1, middle already selected) means something — and with the seed
   wrong it reports a change it should not.
   *What this does **not** prove*, stated plainly: the bug the test's comment describes —
   `didApplyDefault` surviving a recycle — did not reproduce when mutated. Deleting
   `didApplyDefault = false` from Android's `reset()` left the suite 14/14, because the
   re-mounted control's model had the flag false anyway. So the assertion is shown to
   detect "the wrong segment painted after a remount", which is all an outside observer can
   see, and is not shown to detect that particular stale flag.
9. *The `afterUpdate()` clamp block deleted* on **both** platforms — this one stayed
   **green**: 14/14 on iPhone Air and 14/14 on `nitroui_t02`.

   That is the evidence for rewording `clamps an index written straight to native` rather
   than adding an assertion to it. Nothing in the suite can see the clamp that decides the
   *painted* segment: the handle only reads the getter (which clamps on its own), and the
   shrink test cannot see it either because the JS wrapper sends an already-clamped index.
   The one purely-native path — an uncontrolled selection under a shrinking `options` — is
   untested, and is recorded as a follow-up rather than papered over by a comment that
   claims more than the test covers.

## Observations

- **One Android harness run reported failures that never came back, and the cause is not
  established.** A single run printed 4 failures. The same APK, byte-for-byte, gave
  14/14 twice afterwards with no code change in between — once at a machine load
  average of 237. The failing set was not stable enough between the two looks to name a
  mechanism, so this is recorded as **unreproduced and unattributed**: nothing in G4 is
  believed to cause it, and no race has been proven either, so no lesson is claimed.
  **The names of those 4 failures were never captured.** They were read off the console
  and the log file for that run was later overwritten by a retry, so this report cannot
  quote them and does not invent them. What the candidates are: several G4 tests assert
  after a fixed `settle(500)`/`settle(600)` rather than a `pollUntil`, and `re-reports a
  key change that keeps the size` (`:456`) and `corrects a planted size that matches the
  current box` (`:1096`) are the two that would drop an event under load; the fix is to
  poll in both (follow-up).
  What does hold up, and is what the Gates table rests on: the two clean runs used an APK
  identical to the artifact built from the reviewed commit, so 14/14 describes the
  shipped bytes.
- **This machine was not idle for most of the session.** Load average went from 9 to
  274 (a game plus `syspolicyd` storms after repeated installs). Harness suites are
  load-tolerant enough to be trusted here (they assert values, and 14/14 held at
  load 237), but the numbers below are labelled with the load the runner recorded.
## Bench

`segmented-control` is a first `nitro-ui` arm, so per D15 it cannot fail a gate for
want of a prior ratio; what it must do is report ratios to `rn-core` **and** to both
`expo-ui-*` arms on `mount presented`, UI CPU and memory, and explain any miss. The
reference arms make this the cleanest comparison in the library so far:

- `rn-core` is a **floor, not a peer**. RN core has no segmented control, so the arm
  is a row of `Pressable`s with one `Text` each — what a pure-JS implementation is.
  Its ratio answers "what does any hosted segmented control cost over drawing a row of
  views"; the `expo-ui-*` arms answer "over another native segmented control".
- `expo-ui-host-per-control` and `expo-ui-shared-host` host **the same two native
  controls** this task hosts — SwiftUI `Picker` + `.pickerStyle(.segmented)` on iOS
  (`pickerStyle('segmented')`, `labelsHidden()`) and Material 3's single-choice
  segmented row on Android — reached through Expo's bridge instead of through Nitro.
  So a gap here is the host architecture, not the widget.

### Runs

`bun run bench -- --platform <ios|android> --plan quick --component segmented-control`
with the devices from the brief. `quick` = 4 launches × (5 warmup + 20 measured)
iterations. The runner flags a machine busy above 0.5 × cores, i.e. load1 > 7.0 here.

| Results file | Device | load1 / load5 | busy | Notes |
| --- | --- | --- | --- | --- |
| `3e8166b-ios-20261023T230907Z.md` | iPhone Air (`ios27-sim-iphoneair`) | 6.75 / 10.87 | no | `problems: none`; iOS primary below |
| `3e8166b-ios-20261023T231449Z.md` | iPhone Air | 4.83 / 8.16 | no | `problems: none`; iOS repeat below |
| `3e8166b-android-20261023T232016Z.md` | `nitroui_t02` (`android35-emu-pixel9`) | 4.97 / 6.21 | no | `problems: none`; ART `speed-profile` primed, 1 attempt (D18) |
| `3e8166b-ios-20261023T215211Z.md` | iPhone Air | 4.83 / 35.67 | no (load5 not) | earlier same commit; used only to corroborate |
| `3e8166b-ios-20261023T215909Z.md` | iPhone Air | 13.06 / 45.79 | **yes** | superseded |
| `3e8166b-dirty-android-20261023T225234Z.md` | `nitroui_t02` | 11.88 / 41.19 | **yes** | dirty tree; superseded by the quiet run |

**The iPhone 17 was held by another task all session, so no iOS run here is
canonical.** The device key `ios27-sim-iphoneair` is not the one D15 names for the
baseline, so these numbers are labelled **non-canonical**, `--check` was not run, and
this task does not establish the canonical iOS segmented baseline — that belongs to
release readiness, when one task can hold iPhone 17 on a quiet machine. Android *is*
canonical and quiet. The three quiet iPhone Air runs agree with each other, so the
missing canonical run costs verdict strength, not direction.

Ratios below are `nitro-ui ÷ reference`, read off the report's launch-paired
ratio-to-`rn-core` columns (the same medians the `x rn-core` column is built from), so
the ratio uses both arms' paired data rather than two independent medians.

### iOS — iPhone Air, primary run (load 6.75, `problems: none`)

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | presented | 16.14 ms | 108.46 ms | 42.32 ms | **16.16 ms** | 0.38× — no verdict (probe) | 0.15× (nv) |
| mount N=50 | mounted | 18.49 ms | 31.47 ms | 19.15 ms | 41.06 ms | 2.15× — no verdict (probe) | 1.35× (nv) |
| mount N=50 | JS commit | 8.02 ms | 6.20 ms | 4.73 ms | **1.38 ms** | 0.31× (v) | 0.24× (v) |
| mount N=50 | JS CPU/op | 8.15 ms | 8.23 ms | 5.25 ms | **1.63 ms** | 0.33× (v) | 0.21× (v) |
| mount N=50 | UI CPU/op | 11.68 ms | 97.41 ms | 56.04 ms | 41.04 ms | 0.73× — no verdict (noise) | 0.50× (nv) |
| update N=50 | presented | 32.77 ms | 104.48 ms | 98.95 ms | 80.97 ms | 0.90× — no verdict (probe) | 0.85× (nv) |
| update N=50 | mounted | 20.93 ms | 15.43 ms | 14.11 ms | 50.40 ms | 3.64× — no verdict (probe) | 3.30× (nv) |
| update N=50 | JS commit | 8.62 ms | 5.43 ms | 4.30 ms | **1.14 ms** | 0.27× (v) | 0.21× (v) |
| update N=50 | JS CPU/op | 8.73 ms | 9.98 ms | 5.06 ms | **1.64 ms** | 0.33× (v) | 0.17× (v) |
| update N=50 | UI CPU/op | 20.50 ms | 88.07 ms | 78.77 ms | 63.58 ms | 0.81× — not like-for-like | 0.72× — not like-for-like |
| memory N=200 | bytes/inst | 154.1 KiB | 543.1 KiB | 438.1 KiB | 360.2 KiB | **0.82× PASS** | **0.66× PASS** |

`(nv)` = no verdict: one of the two columns was noisy within the run or its
sanity counters were non-zero; `(v)` = verdictable but not a D15 gate metric.

### iOS — iPhone Air, repeat run (load 4.83, `problems: none`)

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | presented | 16.14 ms | 49.17 ms | 16.15 ms | **16.14 ms** | 1.00× — no verdict (probe) | 0.33× (nv) |
| mount N=50 | mounted | 19.86 ms | 30.52 ms | 19.03 ms | 40.60 ms | 2.11× — no verdict (probe) | 1.36× (nv) |
| mount N=50 | JS commit | 8.75 ms | 5.76 ms | 4.54 ms | **1.34 ms** | 0.30× (v) | 0.25× (v) |
| mount N=50 | JS CPU/op | 8.59 ms | 7.22 ms | 5.02 ms | **1.59 ms** | 0.31× (v) | 0.23× (v) |
| mount N=50 | UI CPU/op | 13.39 ms | 69.14 ms | 51.91 ms | 40.74 ms | 0.79× — no verdict (noise) | 0.62× (nv) |
| update N=50 | presented | 24.47 ms | 106.61 ms | 74.68 ms | 82.66 ms | 1.30× — no verdict (noise) | 0.76× (nv) |
| update N=50 | mounted | 21.24 ms | 15.55 ms | 23.61 ms | 51.84 ms | 2.21× — no verdict (noise) | 3.36× (nv) |
| update N=50 | JS commit | 9.01 ms | 5.53 ms | 4.30 ms | **1.10 ms** | 0.25× (v) | 0.20× (v) |
| update N=50 | JS CPU/op | 9.09 ms | 10.15 ms | 5.10 ms | **1.75 ms** | 0.35× (v) | 0.18× (v) |
| update N=50 | UI CPU/op | 20.41 ms | 90.48 ms | 80.51 ms | 64.99 ms | 0.81× — not like-for-like | 0.72× — not like-for-like |
| memory N=200 | bytes/inst | 153.9 KiB | 543.4 KiB | 437.9 KiB | 359.6 KiB | **0.82× PASS** | **0.66× PASS** |

### Android — `nitroui_t02`, quiet (load 4.97, ART primed, `problems: none`)

| Cell | Metric | rn-core | per-control | shared-host | nitro-ui | ÷ shared | ÷ per-control |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | presented | 48.73 ms | 65.98 ms | 47.72 ms | **42.30 ms** | **0.88× PASS** | **0.64× PASS** |
| mount N=50 | mounted | 29.60 ms | 37.25 ms | 29.65 ms | 35.52 ms | 1.20× (v) | 0.95× (v) |
| mount N=50 | JS commit | 8.99 ms | 11.56 ms | 5.71 ms | **1.57 ms** | 0.27× (v) | 0.13× (v) |
| mount N=50 | JS CPU/op | 10.16 ms | 13.37 ms | 7.13 ms | **2.10 ms** | 0.30× (v) | 0.16× (v) |
| mount N=50 | UI CPU/op | 17.25 ms | 44.38 ms | 18.39 ms | 24.24 ms | **1.33× MISS** | **0.55× PASS** |
| update N=50 | presented | 35.35 ms | 53.69 ms | 65.20 ms | **21.06 ms** | 0.32× — no verdict (probe) | 0.40× (nv) |
| update N=50 | mounted | 29.48 ms | 20.45 ms | 20.11 ms | **5.20 ms** | 0.26× — no verdict (probe) | 0.26× (nv) |
| update N=50 | JS commit | 10.00 ms | 8.02 ms | 6.08 ms | **1.30 ms** | 0.21× (v) | 0.16× (v) |
| update N=50 | JS CPU/op | 11.15 ms | 9.46 ms | 7.50 ms | **2.14 ms** | 0.28× — no verdict (noise) | 0.23× (nv) |
| update N=50 | UI CPU/op | 17.42 ms | 25.57 ms | 24.05 ms | **16.60 ms** | 0.71× — not like-for-like | 0.66× — not like-for-like |
| memory N=200 | bytes/inst | 253.4 KiB | 462.3 KiB | 285.5 KiB | 311.9 KiB | **1.10× MISS** | **0.67× PASS** |

The only noise flag in the Android `mount` cell is on `UI CPU per unmount` (teardown),
which is a separate column and not a gate metric, so every gated Android `mount` value
here carries a verdict.

### Against D15 (mount presented, UI CPU, memory)

| Run | mount presented | mount UI CPU/op | memory |
| --- | --- | --- | --- |
| iPhone Air, primary | 0.38× — no verdict (probe) | 0.73× — no verdict (noise) | **0.82× PASS** |
| iPhone Air, repeat | 1.00× — no verdict (probe) | 0.79× — no verdict (noise) | **0.82× PASS** |
| `nitroui_t02`, quiet | **0.88× PASS** | **1.33× MISS** | **1.10× MISS** |

- **memory on iOS: met, twice, verdictable.** 0.82× shared-host in both runs (360.2 and
  359.6 KiB against 438.1 and 437.9 KiB), with clean counters in both arms. It is the
  one iOS gate metric the runner lets this task claim, and two independent launches
  sets agree to 0.2%.
- **mount presented on Android: met.** 42.30 ms against 47.72 ms shared-host, no lost
  samples, no out-of-order counters, within-run spread under 10% on the metric. This is
  the run's strongest result: a hosted M3 segmented row mounts *faster* than the same
  row behind Expo's shared host.
- **mount UI CPU on Android: missed at 1.33×** (24.24 ms/op against 18.39 ms/op).
  Verdictable on both sides, so the miss stands as measured.
- **memory on Android: missed at 1.10×** (311.9 KiB/inst against 285.5 KiB/inst, +26.4
  KiB per control). Narrow, but verdictable in both Android runs and about the same size
  in both: the earlier busy run put 1.08× on memory and 1.43× on mount UI CPU, against
  1.10× and 1.33× here, so both misses repeat in the same direction.
- **iOS mount presented and UI CPU cannot be judged on this device.** Both are
  disqualified rather than passed: `presentedBeforeMount` is non-zero on every arm —
  41/80 (nitro-ui), 42/80 (shared-host), 64/80 (**rn-core**) — and
  `docs/architecture/benchmarks.md` calls a column with a non-zero counter a broken
  probe, not a result. UI CPU/op then lost its verdict to within-run spread (17.3%
  nitro-ui in the primary run, 14.4% shared-host in the repeat). The direction is
  consistently favourable (0.38×/1.00× presented, 0.73×/0.79× UI CPU) but D15 asks for
  a verdict, and there is none.
- **Against `expo-ui-host-per-control` the target is met on Android on all three gate
  metrics** (mount presented 0.64×, mount UI CPU 0.55×, memory 0.67×). **On iOS it is
  carried by memory alone** (0.66×, both runs): mount presented and mount UI CPU against
  per-control are `(nv)` there, by the labels in the tables above, so they report a
  direction (0.15×–0.50×) and no verdict. The `0.95×` that was quoted here before is
  Android `mounted`, which is neither a gate metric nor "well below".

**The `update` cells are not the brief's cell.** The brief asks bench to price "update
K selection changes". `update.segmented-control` flips the `options` array with a
constant `SEGMENTED_SELECTION` (`bench/src/implementations/shared.ts`), so it prices a
**re-measure**, not a selection change — defensible, and arguably the more expensive of
the two for this control, but it is a deviation and is named as one here. It is also not
like-for-like against the reference arms: both `expo-ui` segmented arms key their
children by **label** (`<Text key={label}>`, `<SegmentedButton key={label}>`), so every
flip unmounts and remounts three children there while nitro-ui updates the same three in
place. That is why the `update` UI CPU rows carry no PASS above. A selection-change cell,
and index-keyed `expo-ui` arms, are follow-ups.

So: **SegmentedControl meets D15 on iOS memory and on Android mount presented, misses
Android mount UI CPU and Android memory, and has no verdictable iOS mount cell.** Per
D15 and D19 the two misses come with the explanation below and follow-up items rather
than a third implementation round.

### Why the numbers are what they are

- **The two misses are the same architectural bill G1 and G2 documented.**
  `expo-ui-shared-host` amortises **one** hosting subtree across all 50 controls;
  nitro-ui gives every control its own Hybrid View — a Fabric shadow node, its own
  `UIHostingController` / `AbstractComposeView`, its own view model and sizing-cache
  entry. Memory and UI CPU/op are exactly the columns that bill for that, so
  Android's 1.10× memory and 1.33× mount UI CPU are T10's shape measured, not a
  SegmentedControl defect. Read the same trade the other way: giving each control its
  own host the way `expo-ui-host-per-control` does costs **1.48× the memory and 1.83×
  the mount UI CPU** that nitro-ui pays (Android: 462.3 against 311.9 KiB, 44.38 against
  24.24 ms/op). The `1.83×`/`2.56×` this report quoted before were those arms divided by
  `rn-core`, which answers a different question.
- **It is not the widget.** Both `expo-ui` arms host the same `SingleChoiceSegmentedButtonRow`
  nitro-ui hosts, so on Android the 1.33× cannot be blamed on Compose's segmented row
  being expensive: the reference arm runs the same composables and pays less only
  because it hosts them once instead of fifty times.
- **The iOS `mounted` gap (41 ms mount / 50 ms update for 50 controls against 19 ms /
  14–24 ms shared-host) is not the first-frame fallback → correction round-trip.** G2's
  review (F2) settled that: `bench/src/runner.ts` runs five warmups before measuring and
  the sizing cache is process-global, so every *measured* iteration hits an exact entry
  and makes zero corrections — `options` is constant in `mount` and toggles one pair in
  `update`. What is left is the per-instance synchronous measure, still stated as a
  **hypothesis**: on each props turn every control runs `layoutIfNeeded` +
  `sizeThatFits` inside `commit()` (what `noteContentSizeMayHaveChanged()` buys) and a
  second `sizeThatFits` from `layoutSubviews` when the bounds move, and on mount
  `didMoveToWindow` measures again. shared-host lays out natively in one pass and never
  pays it. `sizingStats()` deltas per launch remain the way to settle it (follow-up).
  Both quiet runs put the same number on it (41.06 ms and 40.60 ms mounted, MAD ±1.22
  and ±1.43 ms), and the third quiet iPhone Air run puts 2.01× and 3.72× on the same two
  columns against shared-host.
- **JS is where nitro-ui wins, everywhere.** JS commit and JS CPU/op are 0.21×–0.35× of
  shared-host and 0.13×–0.16× of per-control in every cell of every run — the Nitro
  props write is one C++-side batch, where the Expo arms cross a bridge per prop update.
- **iOS `presented` is a frame-bound column, not a component column.** The floor sits at
  16.14 ms in both quiet runs — one vsync — and nitro-ui's `mount presented` measures
  16.16 ms and 16.14 ms, so the column is quantised at the frame boundary instead of
  measuring this control; benchmarks.md calls it the noisiest column for exactly this
  reason, and the non-zero `presentedBeforeMount` counters say the probe cannot separate
  commit from present here. Read `mounted` and UI CPU for this control, and compare arms
  rather than platforms.
- **One declared fallback for every option list** (`165 × 31` pt / `256 × 48` dp), so a
  *cold* mount of any other width is corrected on a later frame — the D17 contract, spent
  in the warmups and outside the measured window.

## In-round fix (implementation round, not a D19 fix round): the real-input runner's teardown

Landing the Android real-input check found a real defect in the shared runner, not in
the control. The check printed its verdict and then died:

```console
segmented-control: PASS

real-input (android): 1/1 controls passed
node:events:487
      throw er; // Unhandled 'error' event
Error [ERR_STREAM_WRITE_AFTER_END]: write after end
    at ChildProcess.<anonymous> (scripts/real-input/support.mjs:103:9)
error: script "test:real-input:android" exited with code 1
```

`ensureMetro` SIGTERMs the Metro it started, `pipe()` ends the log `WriteStream` when
Metro's stdout/stderr end, and the `exit` handler then writes one more line to a stream
that is already closed. The stream emits `error` with no listener, so Node exits 1
**after** the suite has reported a pass — a green run is indistinguishable from a red
one to anything reading the status, which is exactly what a check that exists to be
trusted must not do.

It is pre-existing, and it was already on the books: `docs/tasks/FOLLOWUPS.md:21` records
`scripts/real-input/support.mjs:103` dying with `ERR_STREAM_WRITE_AFTER_END` when the
script owns Metro, from T15b, with "pre-start Metro" as the workaround. So this is a
known bug being fixed, not a bug T15 missed. What T15's run did establish is the timing
half: the 20-second `switch` check exits before the handler runs, while the 60-second
segmented check stays alive long enough to hit it. That was confirmed rather than
assumed — `--control switch` on the same tree exited 0 with the same code path,
`--control segmented-control` exited 1 before the fix and 0 after it. `end: false` leaves
the log's lifecycle to the exit handler, which also skips the write if the stream is
somehow closed already; the "metro exited with code …" line is still recorded.

Two statements this report made about that fix were wrong, and both are corrected in fix
round 1: `support.mjs` was untouched by this branch's commits only **until `dcc0397`**,
which is the commit that added this branch's own fix; and the fix belongs to the
**implementation round** (it landed inside the round, before review), not to a D19 fix
round — this task still has both fix rounds available, and fix round 1 is the section
below.

`support.mjs` is shared by both platforms, so both were re-run on the final tree of that
round (`dcc0397`): Android 13 assertions PASS at exit 0, iOS XCUITest PASS at exit 0.

## Fix round 1 (1 of the 2 D19 allows): the review's findings

Addresses `docs/tasks/G4-segmented-control.review.md`. Findings F1, F2 and F4, the report
corrections the review listed, and the merge. No behaviour change: everything here is
docs, JSDoc, harness, example, and two comment-only native edits.

### Merge

`main` (`bc29aaa`) merged as `b4b0222`. Twenty-three conflicts, resolved by union where
both sides added (component registries, `nitro-ui.sizing.json`, the example and smoke
`App.tsx`, the bench plans and `bench/baselines/renders.json`, the bench-gate tests, now
five components) and by regeneration where the tool owns the file (`nitrogen` output,
`etc/package-files.txt`, `etc/react-native-nitro-ui.api.md`).

`scripts/real-input/support.mjs` took **main's** fix and dropped this branch's
`{ end: false }`. Main's version is the better one: it never holds a `WriteStream` open
at all — the log fd is closed right after `spawn`, and the `exit` handler appends with
`fs.appendFileSync` — so there is no stream left to write after end, instead of a stream
whose end is merely deferred. It also keeps the "metro exited with code …" line.

`support.mjs` is shared by both platforms, so both real-input checks were re-run on the
merged tree — that is what proves main's fix covers the segmented case rather than only
the case R1 added:

```console
$ bun run test:real-input:ios --control segmented-control   # iPhone Air
Test Case '-[…RealInputTests testRealInputSegmentedControl]' passed (36.629 seconds)
    ** TEST EXECUTE SUCCEEDED **
segmented-control: PASS
real-input (ios): 1/1 controls passed          # exit 0

$ bun run test:real-input:android --control segmented-control   # emulator-5572
segmented-control: PASS   # 13 assertions, every value from uiautomator dump
real-input (android): 1/1 controls passed      # exit 0
```

What `main` actually added over the `340e521` base is R1 (D21 timing gates, that
`support.mjs` fix, the Node version check), docs, and the G3 Progress merge — which is why
this suite was re-run: R1 changed the harness config, and `support.mjs` had to be resolved.
Not a SwiftUI host change; see the corrected Known issues.

One environment consequence of R1: the Node version check refuses Node 25/26 outright, so
every harness and real-input command in this round ran under Node 24 (`v24.18.0`).

### F1 — `tintColor` does nothing on iOS

Accepted as measured: SwiftUI ignores a per-instance `.tint(_:)` on a `.segmented`
`Picker`. No native workaround was attempted (no `UIAppearance`, which would restyle every
segmented `Picker` in the app). Made honest in four places:

- `docs/components/segmented-control.md` — the API row, both platform-mapping rows and the
  limits bullet now say Android-only / no visible effect on iOS.
- `src/components/SegmentedControl/SegmentedControl.tsx` and
  `SegmentedControl/SegmentedControl.nitro.ts` — JSDoc.
- This report's Decisions bullet and Known issues.
- `ios/components/SegmentedControl/HybridNitroUiSegmentedControl.swift` — the
  `OptionalSegmentedTint` doc comment claimed the opposite ("the tint is the selected
  segment's fill"). Comment-only.

### F2 — Android clips an over-wide row at both ends

Accepted: Android measures the row unbounded and centres it in the box Yoga gives it, so a
row wider than its box loses ink at *both* ends and the outer parts are untappable — it is
not the truncation the test name claimed. The shared Android host is deliberately **not**
touched this round: the same constraint path serves Button, so it is a 0.2 host change, not
a SegmentedControl one. Corrected instead:

- `docs/components/segmented-control.md` — the sizing paragraph and a limits bullet say
  clipped-at-both-ends, and note the untappable outer edges.
- The harness test is now `keeps a caller width in charge` (was "…and truncates the
  labels"), with a comment that states what each platform does.
- `example/src/SegmentedControlScreen.tsx` — the two rows that overflowed on this window
  now use short labels (`['Yes','No','Ok','Later']`, `['Small','Medium','Large']`), and the
  row that still demonstrates an over-wide list captions itself "(iOS truncates, Android
  clips the ends)".
- `HybridNitroUiSegmentedControl.kt` — the fallback KDoc quoted "411.43 dp for four long
  ones" as a measured row width. 411.43 dp is this AVD's window: the clamped **box**, which
  is the overflow case, not a measurement. Comment-only.

### F4 — tests

`example/__tests__/SegmentedControl.harness.tsx`:

- `clamps an index written straight to native` — its comment claimed the native clamp
  generally; the test reads back through the handle, so it covers the **getter's** clamp
  and nothing else. Reworded to say exactly that, name the `afterUpdate()` clamp it cannot
  see, and record the untested purely-native path. Reworded rather than extended: proof 9
  shows a red assertion there is not reachable through the handle.
- `survives remounts with the size and seed of each mount` — gained the selection
  assertion the review asked for, with a witness control so an empty log means something
  (proof 8).
- The `no-shadow` lint warning at the old `:915` is fixed (`_row` / `_label`), and the
  comment on `reads back what React sent` no longer calls a controlled control
  uncontrolled.

Red runs 6–9 above are this round's, each reverted.

### Native diff

Two files, both comment-only, no behaviour change: the Kotlin fallback KDoc and the Swift
tint comment. Both were rebuilt and re-run because a comment still changes the artifact:
14/14 on iPhone Air and 14/14 on `nitroui_t02` after them.

### Gates, this round

| Gate | Result |
| --- | --- |
| `bun run check` | **pass** — all thirteen steps on the merged tree with these changes: typecheck, bench typecheck ×2, eslint, prettier, jest (132 tests, 9 suites), `test:native` (C++/ASan+UBSan, Swift, Kotlin), `perf:renders` (5/5), nitrogen drift (139 files), autolinking, `bob build`, api-extractor, publint, manifest (333 files) |
| `bunx react-native-harness --harnessRunner ios SegmentedControl.harness` | **14/14 pass** — iPhone Air (`331EF109-…`), Metro 8294 |
| `bunx react-native-harness --harnessRunner android SegmentedControl.harness` | **14/14 pass** — `nitroui_t02` / `emulator-5572`, adb server 5042, Metro 8294 |
| `bun run test:real-input:ios --control segmented-control` | **pass, exit 0** — merged tree, main's `support.mjs` |
| `bun run test:real-input:android --control segmented-control` | **pass, exit 0** — merged tree, main's `support.mjs` |

Harness and real-input both re-run on the merged tree with the harness file changed, which
is what AGENTS.md asks for; no bench reruns this round, so the bench tables above still
describe the `340e521`-base implementation round.

## Acceptance

| Item (from the brief) | State |
| --- | --- |
| `bun run check` green | **pass** on the final tree of each round: `dcc0397` in the implementation round, and again on the merged fix-round tree (132 jest tests, native tests under ASan+UBSan, `perf:renders` 5/5, no nitrogen drift, manifest 333 files) |
| Harness green on both platforms, R3 included | 14/14 iPhone Air, 14/14 `nitroui_t02`, in both rounds — each time against that round's bytes |
| Bench tables | both platforms above, with verdict labels and the D15 read |
| Screenshots iOS + Android, light + dark | `docs/tasks/G4-segmented-control/{ios,android}-{light,dark}.png`, from the example screen |
| "menu open" screenshot | **not applicable to this control**: a segmented control has no menu. That item belongs to `Picker`, which is 0.2 (D19); the screenshot set here is the four the control can actually produce |
| `nuiSizingKey` + declared fallback per sizing.md | done; fallback in `NitroUiDeclaredFallbacks` on both platforms, sizes measured |
| R3 test owned by G4 (D16) | done, both platforms (`re-measures when the options change`, `re-reports a key change that keeps the size`) |
| D20 corrected-instance behaviour | covered by `corrects a planted size that matches the current box` |
| Example screen + smoke app + api-extractor report | done (`Segments` tab) |
| Real-input check (this task's addition) | added for both platforms: a real tap on segment 2 moves the selection echo, and a change the parent refuses snaps back. Android 13 assertions from `uiautomator dump`, iOS XCUITest reading rendered text. Both exit 0 on the final tree |
| Docs page follows `docs/components/button.md` | done — `docs/components/segmented-control.md` |
| Bench uses `--component`, ART-primed Android (D18) | done — `*.{mount,update,memory}.segmented-control`, ART `speed-profile` primed in 1 attempt |

One naming note: the brief says `docs/tasks/G4-segmented-picker/`, and the task shipped
as `G4-segmented-control` (the brief's own `Picker` half is 0.2), so the screenshots and
this report are under `docs/tasks/G4-segmented-control*`, matching how G1 and G2 name
theirs.

## Known issues

- **Merging `main` needed this suite re-run** — done in fix round 1, 14/14 on both
  platforms. The base was `340e521`, which already contains FIX2; what `main` added
  since is R1 (D21 timing gates, the `support.mjs` teardown fix, the Node version
  check), docs, and the G3 Progress merge. So the reason to re-run was R1's harness
  config plus resolving `support.mjs` onto main's fix — **not** a change to the SwiftUI
  host this control's measure path runs through.
- **The Android D15 misses are open**: mount UI CPU/op 1.33× and memory 1.10× against
  `expo-ui-shared-host`, verdictable in this run and repeated in the earlier busy one
  (1.43×, 1.08×).
- **No iOS mount cell of this component can carry a verdict on this device.**
  `presentedBeforeMount` is non-zero on every arm — including `rn-core` at 64/80 — so the
  runner's own rule ("a column whose counters are not zero is a broken probe") takes the
  whole latency pair out, and UI CPU/op then loses to within-run spread. This reads as an
  instrument limit for the segmented cell shape rather than a component property, since
  the floor arm is the worst offender.
- **No canonical iOS numbers.** iPhone 17 was held by another task the whole session, so
  every iOS figure here is labelled non-canonical and `--check` was not run; there is no
  committed segmented baseline to check against yet either.
- **One Android harness run reported 4 failures and never reproduced them** (see
  **Observations**). Recorded as unreproduced and unattributed; no cause is claimed.
- **Deliberate cross-platform asymmetries, documented in `docs/components/segmented-control.md`
  rather than faked into symmetry**: `tintColor` has a visible role on Android and none on
  iOS (SwiftUI ignores `.tint` on a segmented `Picker`); the two platforms do not share a
  segment-width rule (Android equal shares, iOS SwiftUI's own distribution); an over-wide
  row truncates on iOS and is clipped at both ends on Android.
- **`Picker` was not started.** It is 0.2 (D19): no spec, no wrapper, no docs page, no
  bench arm, and nothing here pre-shapes it beyond the shared core it will use.

## Follow-ups (recorded per D19, not chased)

- **F1 — canonical iOS segmented baseline.** One task holding iPhone 17 on a machine the
  runner calls idle, `bun run bench -- --platform ios --plan quick --component
  segmented-control`, then `--update-baseline`. Belongs to release readiness, not to this task.
- **F2 — the Android D15 gap.** Closing mount UI CPU and memory against
  `expo-ui-shared-host` needs host sharing or batching across sibling controls, which is
  T10's architecture and not a SegmentedControl change. The reviewer decides whether it
  blocks the 0.1 bar.
- **F3 — settle the iOS `mounted` hypothesis with `sizingStats()` deltas per launch**, the
  same follow-up G2 carries: it is the only way to say whether the per-instance
  synchronous measure is where the 2.1–3.6× lives.
- **F4 — the `presented` probe on segmented cells.** `presentedBeforeMount` non-zero on
  every arm (41–64 of 80) makes `presented` permanently unverdictable for this component
  family on iOS. Worth a bench-instrument look: either the probe or the cell shape needs
  fixing, because it will silently cost every future segmented run its gate column.
- **F5 — closed in fix round 1:** the harness was re-run on both platforms after merging
  `main` (14/14 each), for the reason now stated in Known issues.
- **F6 — `Picker` for 0.2.**

From the review, one line each, recorded and not chased:

- Core: Android `intrinsic` content larger than its box draws centred and clipped instead
  of fitting. Record via intrinsics, place with bounded constraints (F2; also Button).
- iOS: per-instance segmented tint (SwiftUI ignores `.tint` on a segmented `Picker`) (F1).
- SegmentedControl: no test covers the native-only clamp (an uncontrolled selection while
  `options` shrinks).
- SegmentedControl iOS: the fallback is not OS-versioned (31 pt measured on iOS 27 only;
  pre-26 heights are unverified, D14).
- SegmentedControl iOS: an `accessibilityLabel` on a segmented `Picker` is unverified with
  VoiceOver. No test reads it from the a11y tree.
- SegmentedControl iOS: empty `options` with selection 0 logs SwiftUI's "selection is
  invalid" warning on every body evaluation.
- SegmentedControl: switching controlled→uncontrolled applies `defaultSelectedIndex` late
  (`didApplyDefault` is still false). This mode switch is unsupported, but the jump is
  surprising.
- SegmentedControl harness: replace `settle(N)` + assert with `pollUntil` in `re-reports a
  key change` and `corrects a planted size` (load tolerance).
- SegmentedControl harness: `no-shadow` at `:915`, and the "Uncontrolled" comment on the
  controlled `reads back what React sent` — both fixed in fix round 1.
- Bench: add an `update.segmented-control` selection-change cell (the brief's ask), and key
  the `expo-ui` segmented arms by index.
- Example: the Android screenshots show a LogBox warning ("Open debugger to view warnings")
  on the Segments tab. Identify it.
- Docs: the four screenshots predate fix round 1's example rows; re-take them with the
  LogBox finding resolved.
- F1 canonical iOS segmented baseline (iPhone 17, quiet machine). F2 Android D15 misses
  (mount UI CPU 1.33×, memory 1.10×). Both are host architecture, as for G1/G2.
- F3 settle the iOS `mounted` 2.1–3.6× hypothesis with per-launch `sizingStats()` deltas
  (same as G2).
- F4 `presentedBeforeMount` non-zero on every iOS segmented arm, including rn-core 64/80.
  Look at the bench instrument.

## Device and process hygiene

- **Devices addressed by serial throughout** (AGENTS.md): Android was
  `emulator-5572` / `nitroui_t02` with `ANDROID_ADB_SERVER_PORT=5042`, iOS was
  `331EF109-21DD-422B-AEF8-DFFFC6998DC3`. The `adb` server on the default port was never
  used or restarted, and `emulator-5560` was never touched.
- **iPhone 17 (`F08675D3-…`) and `nitroui_t01` (adb 5041, Metro 8293) belong to G3 and
  were left alone.** That is also why the iOS bench numbers are non-canonical: the
  canonical device was not available, so this task took the honest label rather than the
  better-looking number.
- **Metro stayed on 8294** for the whole session and nothing is left listening there
  (`lsof` on 8294 returns nothing, and 8293 — G3's port — was never touched).
- **Gradle daemons were left running on purpose.** `./gradlew --stop` would also stop the
  daemon another task's build is sharing, which is worse than an idle daemon.
- **The screenshots are from the implementation round.** Fix round 1 changed two rows of
  the example screen (F2), so `docs/tasks/G4-segmented-control/*.png` no longer show the
  current labels; they still show the control honestly. Re-taking them is a
  release-readiness chore, recorded in the follow-ups.
- **This task's devices are down.** `nitroui_t02` was stopped by serial
  (`adb -s emulator-5572 emu kill`, server on 5042) and the iPhone Air by UDID
  (`xcrun simctl shutdown 331EF109-…`), after checking that no other process was using
  either. Afterwards `adb devices` on 5042 is empty and no simulator this task started was
  left running.

## Questions for orchestrator

None outstanding. No web lookup was needed: both native APIs are already exercised by
committed code in this repo (the `expo-ui` bench arms host the same SwiftUI
`.segmented` `Picker` and the same Material 3 segmented row), so the implementation was
written against the pinned BOM and the pinned RN/SwiftUI behaviour observed on the
assigned simulator rather than against documentation assumptions.
