# F2 — Follow-ups sweep (docs, comments, two real fixes, one test-hygiene change)

**Branch:** `task/F2-followups-sweep` (from `main` at `747debc`) · **Round:** 1 of 1 (D19) ·
**Lease:** `F2-3hxh8` (`iPhone Air` `331EF109-…` / `nitroui_t01` `emulator-5570`, Metro `8293`)

## Summary

Fifteen items in sixteen commits (the FOLLOWUPS prune is its own commit). Fixed: X1's doc-table `20`→`19`; the always-true lease-TTL
assertion (now assertable); platform-correct `harness:*` labels in `scripts/harness.mjs`;
`--clean` also dropping the pod-inputs record, with a test; C1's N1 caption, N2 `armed`
comment, N3 `settle()` before the over-wide edge taps and N4 apply-notification/clipped-frame
wording; the bench `nitro-ui-host` comment; the `0 x 0` comment a696d05 left behind; the
`slider.md` thumb-only-drag note; the three fake dark cards; and the S1 `real-input:android`
PASS row (annotated, not rewritten).

Three of the brief's items were **wrong about the tree** and are closed as readings, not fixes:

- the word "prospective" is not in `sizing.md`, and `git log -S prospective` over that file finds
  no change at all, so the line row 18 names does not exist (T14's own sentence was about sizing.md's
  claim that a mounted instance "is asked to measure again"). What *was* vague — "the host re-measures and reports" — now
  names the two asks it means (`onConfigurationChanged`, `traitCollectionDidChange`).
- H1's S2 "value change while hidden" is already covered (`Host.harness.tsx:1124-1178`,
  `6028511`); the gap Q4 cited is the dialog test. Round 1 called F10's **shown→hidden after
  mount** half open, and review M1 showed that is wrong — `HostPopups.harness.tsx:1135` performs
  that teardown; the hit-test half is what has no test (fixed in the fix round, below).
- Row 25's audit tail closes clean: the three components passing a configuration to
  `useSizingId` are exactly the three that render their native view with a `key`.

Two items were skipped as larger than a small fix and left as one FOLLOWUPS line each: C1's N5
(a behaviour change to `onConfigurationChanged`) and the T11 sizing-engine minors.

Two things a reviewer should see first. The N1 fix edits **another task's report**
(`C1-android-overwide.report.md`), which the brief authorises by naming N1; the caption now
describes the shot as it draws (row 1 ellipsised, row 2 showing January…April whole). And
`DatePicker.stories.tsx` turned out to carry the same honesty defect as the three named cards —
its note pointed at a light/dark pair `docs/components/date-picker.md` does not contain — so it
went in as a fourth one-line commit. Checking that claim is what showed only
`docs/components/button.md` holds a captured pair, which is why the new notes say that instead
of promising one.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1113 tests / 42 suites | `b65316f3df4e` | 1 m 54 s | start 3.2 / med 6.4 / max 7.4 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `b65316f3df4e` (ios tree) | 2 m 05 s | start 11.2 / med 7.8 / max 11.2 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `b65316f3df4e` (android tree) | 6 m 04 s | start 24.2 / med 4.7 / max 24.2 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need: review is satisfied on this code tree.` The ledger also carries three earlier
`harness:ios` rows that did not pass: two refusals before the stamped app was built (`05:43`,
`05:44`), and one real red at `05:45` — `Sizing · intrinsic (T11) › lays a cold Switch out at
the size the control measures`, red on `expect(content).not.toBeNull()`. The ledger's load
samples for that run are start 50.78 / max 50.78; the excerpt's own load1 at the moment of
failure is 8.70.

Review N2: the log line this reading rests on is line 26 of the store log, outside the last 150
lines the committed excerpt keeps, so it is quoted here rather than asked of the reader. Exact,
with the trailing `d={…}` stats object elided:

    cold: box=61.00x28.00 content=null trace=["laidOut:40.0x20.0","drew:61.0x28.0","drew:40.0x20.0","corrected:61.0x28.0"]

What that shows is a box already at the corrected size and a trace whose last stage is
`corrected`, while the value the assertion needed came back `null`. The read is
`hybrid?.measureContent() ?? null` (`example/__tests__/Sizing.harness.tsx:362`), so the log does
not say whether the ref was missing or `measureContent()` answered `null` — either way it is the
read that failed and not the layout, which is as far as this report goes. S1 saw the same test
fail at load 108 (`docs/tasks/S1-storybook.report.md:187-190`), and the pair is now one FOLLOWUPS
line for F1-style determinism. Excerpts in `docs/tasks/F2/failures/`.
`real-input` is not owed here: no runner or control code changed.

## Red proofs

- `lease.test.js` TTL -> `EXCLUSIVE_TTL_MINUTES 960 -> 240` in `scripts/lease-core.mjs` ->
  `lease.test.js:1117` `Expected: >= 840, Received: 240` (mutation reverted).
- `build-speed.test.js` -> drop the `Pods/.nitro-ui-pod-inputs` entry from what `iosCleanTargets`
  returns -> `build-speed.test.js:227` `Expected value: "/repo/example/ios/Pods/.nitro-ui-pod-inputs"`,
  `Received array: ["/repo/example/ios/build"]`. Round 1's proof here deleted the helper and
  showed a `TypeError`, which tested the import rather than the behaviour (review N1).
- Gap this report states rather than fixes: nothing proves `buildIos` *uses* the helper. Writing
  `removeIfPresent(derivedData, log)` back over the loop at `scripts/build-app.mjs:315` leaves
  `build-speed.test.js` green (24/24, measured), and no test imports `build-app.mjs` - the one
  source-text guard in the area (`scripts/__tests__/build-slot.test.js:607`) checks skip-before-slot
  ordering. Accepted for a script; the pure function is what carries the assertion.
- The N3 change adds no assertion (it is `await settle()` before existing taps), and the other
  thirteen commits are comments, docs and story markup, so there is nothing else to show red.
  The story change is covered by `check`'s typecheck, not by a test.

## Files changed

- Docs: `docs/architecture/sizing.md`, `docs/architecture/core.md`, `docs/components/slider.md`,
  `docs/tasks/FOLLOWUPS.md`, `docs/tasks/S1-storybook.report.md`,
  `docs/tasks/C1-android-overwide.report.md`, `docs/tasks/F2/gates.jsonl` + `failures/`.
- Kotlin: `android/.../core/NitroComposeHost.kt` (two comments).
- Scripts/bench: `scripts/__tests__/lease.test.js`, `scripts/harness.mjs`, `scripts/build-app.mjs`,
  `scripts/build-speed-lib.mjs`, `scripts/__tests__/build-speed.test.js`, `bench/src/plan.ts`.
- Example: `example/__tests__/SegmentedControl.harness.tsx`, `example/__tests__/HostControls.harness.tsx`,
  `example/src/stories/{Switch,Progress,SegmentedControl,DatePicker}.stories.tsx`.

## Follow-ups

- C1 N5: gate the `onConfigurationChanged` `remeasureToken` bump on the host having been armed, or drop it.
- H1 F10: one harness case for shown→hidden after mount (the value-write half already exists).
- T11 minors: the three engine behaviours in `FOLLOWUPS.md`, each a behaviour change.
- Docs: only `button.md` has a captured light/dark pair; the other six controls' appearance
  claims live in prose only. Capturing the pair is someone's task, not F2's.
## Fix round 1

Both must-fixes and all six nits, in ten commits.

**M1** — the F10 line no longer calls shown→hidden untested: `HostPopups.harness.tsx:1135`
mounts a drawn DatePicker, opens its dialog and hides the child; the line now names the hit-test
half as the gap and cites that coverage. The Summary carries the same correction. **M2** — the
`armed` comment now reads "the one *placement* value read here that is snapshot state", says a
further *measure* where it said recomposition, and covers `reset()`'s out-of-pass write. Comment-only, but it moves
the Android tree. **N1** — the `--clean` proof above is now a behaviour mutation, and the use-site
gap is stated. **N2** — the store-log line the reading rests on is quoted there, the diagnosis
stops at what it shows, and the flake sits on F1's determinism line. **N3** — C1's two timing
claims point at `core.md:424-425`. **N4** — one clipped frame is the already-armed `markDirty()`
case, real cause named. **N5** — citation moved onto the bump. **N6** — T16's arm in the past
tense. Pruned beyond the list: B1's line still claimed a stale comment remained, which F2's own N2
fix removed.

`harness:ios` did not re-run: the iOS tree is unchanged (`41a31720d618`), so its row still cites
the round-1 tree.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1113 tests / 42 suites | `6f4bc4b427e5` | 2 m 02 s | start 5.6 / med 11.2 / max 14.4 |
| `harness:ios` | **PASS** | 168 tests / 13 suites | `b65316f3df4e` (ios tree) | 2 m 05 s | start 11.2 / med 7.8 / max 11.2 |
| `harness:android` | **PASS** | 217 tests / 13 suites | `6f4bc4b427e5` (android tree) | 6 m 01 s | start 4.0 / med 6.7 / max 13.8 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

```
need: review is satisfied on this code tree.
```
