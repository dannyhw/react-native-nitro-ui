# Q4 — `FOLLOWUPS.md` triage (2026-10-27)

**Tree:** `task/Q4-followups-triage` at `349d03c`. Read-only: no `bun`/`node`, no gates, no devices
(the A3 benchmark owns this machine). Published packages: `v0.1.0` → `v0.3.1`
(`package.json:3` = `0.3.1`; tags `v0.1.0 3f7ee23`, `v0.1.1 152e059`, `v0.2.0 3c15fc4`,
`v0.3.0 5a982bc`, `v0.3.1 7f4afd7`). Everything shipped is an ancestor of `v0.3.1`, so
"shipped/0.3.x" means *in that tag* (verified with `git tag --contains`), not merely *on `main`*.
`X4` = the conformance suite brief (`docs/tasks/X4-conformance.md`).

**Caution:** `docs/tasks/FOLLOWUPS.md` is append-only and never edited (D19), so "still open" is
never provable from the file alone. Of its 59 lines (3–61), **19 read fixed and 2 obsolete** — each
marked with the commit or file:line that proves it. Five of the 19 still leave a remainder (the row
names it); the other 14 are closed. Recommend a one-off `FOLLOWUPS` prune commit once this merges.

## 1. Line by line

`#` is the line number in `docs/tasks/FOLLOWUPS.md`. Size: XS = one file/comment/flag; S = one
function or test; M = two modules or a tool plus tests. "Ships" = user-visible in a published package
(0.1.0–0.3.1). No open line is a crash or a leak in shipped code — the shipped-code bugs (B1's
Android leak, FIX2's stale Yoga box) are both in `v0.1.0` — but three open lines can change what a
0.3.x app draws: #10 (a stale width under an infinite parent), #27 (`tintColor` ignored on iOS), and
#60's time-dialog half.

| # | Line (short) | Status + evidence | Size | Ships |
| --- | --- | --- | --- | --- |
| 3 | Android D15 gap (UI CPU 1.35×, mem 2.52×) | **open** — `README.md:395-402` states the misses; closing it needs sibling host sharing (T13 measured the ceiling: `docs/tasks/STATUS.md:11`) | M | yes, perf only |
| 4 | iOS Slider memory 1.42× | **open** — `README.md:411-420` "no known fix"; D23 outcome (`docs/DECISIONS.md:134`) | M | yes, perf only |
| 5 | Primed Android + iOS latency baselines (D18) | **open** — both committed baselines carry `mount`/`update`/`memory`/`leak` cells only, and `ScenarioAction` has no latency (`bench/src/types.ts:30`); Android is `speed-profile`/`primed: true` | M | no |
| 6 | Declared fallbacks on an iOS < 26 runtime | **open** — no `iOS 18`/older-runtime row in `.github/workflows/ci.yml` | S | probably one frame |
| 7 | Compose-semantics a11y queries in the harness | **open, partly X4** — X4 rule 1 owns the label-on-focused-node check | S | no |
| 8 | Modal instances lack perf marks | **open** — `docs/tasks/T11-intrinsic-sizing.report.md:476` item (f) "still open"; the example has no `Modal` control at all (`grep "'modal'" src/components` → nothing) | S | no |
| 9 | T11 minors (first env signature, never-mounted ledger entries, report-before-drop) | **open** — `cpp/NitroUiSizingEngine.cpp:246-259` clears on the first call; `:513` still drops a report with no ledger entry | XS | marginal |
| 10 | `fillWidth` under an infinite width keeps the cached width | **open** — the last resort in the measure block is still `Constraints()` (`NitroComposeHost.kt:1537-1538`); `docs/architecture/sizing.md:317` documents the stored width as "a restatement of a parent" | S | yes, one frame |
| 11 | iOS mount `mounted`: per-instance `UIHostingController` (~0.46 ms) | **fixed (the claim)** — the cost is the synchronous T11 first measure, 33–45 % of the mount (`docs/tasks/P1-ios-mount-profile.report.md:16,114`, accepted at `:312`); the README paragraph is corrected too (#40) | — | no |
| 12 | iOS 18 CI row | **open** — same as #6 | S | see #6 |
| 13 | Android `Sizing › sizes a control inside a Modal` flake | **fixed** — `postInvalidateOnAnimation()` at `NitroComposeHost.kt:1250` (`eb90728`), guard `scripts/check-sizing-flush-draw-request.sh` (in every tag) | — | no |
| 14 | `Slider › ignores a drag while disabled` red on iOS | **fixed** — `fada9f3`, iOS probe emits `disabled=` (`HybridNitroUiSlider.swift:1002-1017`); recorded as FIX1 (`docs/tasks/STATUS.md:14`) | — | no |
| 15 | Harness dies on Node 26 with an ESM error | **fixed** — `scripts/node-version.mjs` (`8e73bf7`), called from `scripts/harness.mjs:54`, `scripts/gate.mjs:1066` and `example/rn-harness.config.mjs:35`; `CONTRIBUTING.md:27-30` | — | no |
| 16 | G1 verifier follow-ups (8) | **open, 5 of 8** — still there: `floor(x + 0.5)` (`NitroUiSliderValue.kt:104`, untested), `refreshAccessibility()` per drag sample (`HybridNitroUiSlider.swift:256`), `element.perform(selector)`'s unused result (`:1012`), no device render for `min > max` (nothing asserts it). Fixed since: the M3-1.4 comment was rewritten (`HybridNitroUiSlider.kt:530-544`), `forceAccessibilityForTesting` is documented where it is called (`:1002-1006`), and the recycler assertion is now platform-split with its reason (`Slider.harness.tsx:1185-1199`) | S | one (String per drag sample) |
| 17 | iOS `app heartbeat timed out` (FIX1) | **open** (infra flake, re-run green) | S | no |
| 18 | Android: box-only move produces no report | **partly fixed, docs stale** — a changed frame now bumps `remeasureToken` (`NitroComposeHost.kt:959-970`, C1's `9b563b6`); `docs/architecture/sizing.md:271` still says "prospective" | XS | yes |
| 19 | iOS Slider only answers drags starting on the thumb | **open (docs)** — `docs/components/slider.md` never says it | XS | no (matches UISlider) |
| 20 | G2 Button follow-ups (~12), incl. F1 redundant report | **open** — e.g. the sizing key still joins free-form fields with `\|` (`Button.tsx:132`); `PaddingValues` is still built per recomposition (`HybridNitroUiButton.kt:331-339`). The rest of the list I did not re-check line by line | S | no |
| 21 | `support.mjs` `ERR_STREAM_WRITE_AFTER_END` | **fixed** — fd + `appendFileSync` (`scripts/real-input/support.mjs:100-114`, `eb59576`); the `:103` in the line is the *spawn* now | — | no |
| 22 | real-input has no render-check kind; Progress uncovered | **open** — `src/components/Progress/component.json` says `"realInput": false` | M | no |
| 23 | G3 Progress follow-ups | **open** — the doc-only half is closed by A2 | XS | no |
| 24 | R1 (load flakes, harness log on failure only, CocoaPods 1.15 vs 1.17, emulator launch) | **open/partial** — the pod trailer is restored by one entry point (`scripts/pod-install-lib.mjs`, used by `build-app.mjs`/`bench/build.mjs`/`sync-example-lock.mjs`) and `doctor` checks the version (`scripts/doctor-core.mjs:105-114`); load flakes are #58's; the `HARNESS_TIMING` log gap is open, as in #29 | S | no |
| 25 | G3 re-review (ref-in-render, raw variant, tests, doc refs, remount-key audit) | **fixed** — `useSizingId` is state (`src/core/useSizingId.ts`), `Progress.tsx:180-196` uses one normalised key, `src/__tests__/useSizingId.test.tsx` exists (A2, `b2ea328`); no `stripes` text in `docs/components/progress.md`. **The audit tail is still open**: `useSizingId(configuration?)` is passed by DatePicker/Picker/Progress only (`grep -n "useSizingId(" src/components/*/*.tsx`) | XS | no |
| 26 | Android over-wide `intrinsic` clipped (core 0.2) | **fixed** — C1 `9b563b6`/`1fd68c6`, `docs/components/segmented-control.md:251`; the `docs/tasks/PLAN-0.2.md` line is history | — | yes → fixed |
| 27 | iOS `SegmentedControl.tintColor` has no effect | **open (documented)** — `HybridNitroUiSegmentedControl.swift:122-131` | M | yes, cosmetic |
| 28 | G4 SegmentedControl follow-ups | **open** — incl. F4: `presentedBeforeMount` is non-zero on every segmented arm (41–64 of 80), which per `docs/architecture/benchmarks.md` makes iOS `presented` permanently unverdictable for that family — the probe or the cell shape needs a fix. `sanity.presentedBeforeMount` is still only counted (`scripts/bench/lib.mjs:965`) | S | no |
| 29 | R2 follow-ups (baselines, smoke testIDs, manifest 332/333, CI never run) | **fixed/obsolete** — baselines committed; `scripts/smoke/ready-line.mjs` + a box per control (A2); api-extractor's TSDoc metadata now lands outside `lib/` so `manifest:check` and `npm pack` agree (`etc/api-extractor.json:20`, A2's report: 332 both ways); CI ran 2026-10-26 → #55. Two survivors: the `HARNESS_TIMING` numbers still print only on failure (`CONTRIBUTING.md:619-633`), and smoke still reads the ready line rather than the `SMOKE-` testIDs | XS | no |
| 30 | `mounted` attribution disputed | **fixed** — see #11 | — | no |
| 31 | Storybook fake dark panel + S1 items | **partly fixed** — Button's panel is honest (`Button.stories.tsx:303-324`, `caf9c77`); the fake card remains in `Switch.stories.tsx:217`, `Progress.stories.tsx:217`, `SegmentedControl.stories.tsx:289`; DatePicker/Picker already carry the honest note | XS | example only |
| 32 | CI disabled after three pushes | **obsolete** → superseded by #55 | — | no |
| 33 | A2 closed list | **fixed** (record) | — | no |
| 34 | A2 found-not-fixed (fake dark card, `real-input:android` red on `progress`, relative `HARNESS_APP_PATH`) | **fixed** — `DEFAULT_SCREEN = 'switch'`, reason documented (`example/src/App.tsx:48-54`, A2's `b2ea328`), and the config resolves `HARNESS_APP_PATH` (`rn-harness.config.mjs:43-52`; `build-app.mjs:590` prints an absolute one). **Open sub-items:** no `uiautomator` read path survives a never-idling window (`scripts/real-input/uiautomator.mjs` has no idle retry), and real-input iOS never resolves its artifact (`ios.mjs` does not read `HARNESS_APP_PATH`; `android.mjs:1934` reads it raw) — the abort itself I did not reproduce. Fake card as in #31 | XS | example only |
| 35 | A2 follow-ups (the three, plus: an idle-tolerant `uiautomator` read path; the S1 report's PASS row) | **dup** of #31/#34, and two parts are genuinely open: no non-idle-tolerant hierarchy read, and `docs/tasks/S1-storybook.report.md:171` still claims a `real-input:android` PASS A2 could not reproduce | XS | example only |
| 36 | Bench load guard samples only at the end | **fixed** — R4 sampler (`scripts/bench/lib.mjs:1536-1610`, `LOAD_SAMPLE_INTERVAL_MS`), merged `1410be5` | — | no |
| 37 | iOS committed baseline unminted | **fixed/obsolete** — `a4d9514`, and per-machine now (`bench/baselines/maintainer-mac-1/`; A3 is minting mac-2) | — | no |
| 38 | Re-scope the iOS `mounted` gate to total main-thread work | **open, owner's OK needed** — `docs/architecture/benchmarks.md:101` still defines `mountedNs` as the only mount number | M | no |
| 39 | Public `UIHostingView` as a cheap win | **obsolete** — no public type in the iOS 27 SDK (`docs/tasks/T17-ios-host-spike.report.md:253-258`) | — | no |
| 40 | README blames `mounted` on `UIHostingController` | **fixed** — `README.md:421-426` names the synchronous measure; no `UIHostingController` in README since `ea40b34` | — | no |
| 41 | B1 follow-ups (recycle gate, M2 gate, listener leak, stale comments, screens-pop, post-drop composition) | **mostly open** — `enableViewRecycling` appears nowhere in `src/` or `example/`. Of the two stale comments, only one is still stale, and it is the "plain fields" sentence at **`NitroComposeHost.kt:1503-1505`** (`armed` is snapshot state, `:1627`); the other B1 cited (`:430-431/448/477-478`) was rewritten since and now reads true (`:433-448`, from `e31899a`/`a696d05`) | S–M | no — B1's own leak fix (`c97ddb0`) is in `v0.1.0` |
| 42 | Baselines need `prettier --write` by hand | **fixed** — the mint formats its own output (`scripts/bench/format.mjs`, `report.mjs:111`, `62f7e86`) | — | no |
| 43 | C1 re-review non-blocking N1–N6 | **open** — N2's "plain fields" sentence is still there (`NitroComposeHost.kt:1503-1505`); N3: none of the first three over-wide tests settles before its edge taps (the only `settle` in them is `SegmentedControl.harness.tsx:1021`, in the fourth); N4: the "deferred to the end of the traversal" / one-clipped-frame wording is unchanged (`NitroComposeHost.kt:915`, `docs/architecture/core.md:415`); N5: `onConfigurationChanged` bumps the token for every host (`:1270`) | S | no |
| 44 | `bench/build.mjs` rewrites the `COCOAPODS:` stamp | **fixed** — `scripts/bench/build.mjs:29,301` uses `installPods` | — | no |
| 45 | Core a11y audit (label on the node TalkBack focuses) | **open** — exactly X4 rule 1; G6's own node fix is `23f9545` | S | audit; any hit ships |
| 46 | G5 DatePicker follow-ups | **mixed** — dialog-follow is fixed by H2b and asserted at `DatePicker.harness.tsx:1050-1060`; `builtBounds` still records from an `.onAppear` outside `.id(_:)` (`HybridNitroUiDatePicker.swift:219-223`, `:602-603`); the UIKit comment is now correct (`DatePicker.harness.tsx:1308`); CONTRIBUTING's Gradle `--rerun` note exists (`:420-421`); the tab row is `flex: 1` (`example/src/App.tsx:168`) so an 8th tab still wants a scroll bar; the announce/calendar-root a11y notes are unverified | S | `builtBounds` only (0.2+) |
| 47 | A1c: tighten noisy iOS cells; leak cells record nothing; `update.button` UI CPU | **open** — every committed `leak *:N=200` cell has `"metrics": {}` (4 per platform in `bench/baselines/maintainer-mac-1/*.json`), and a cell with no expectation prints `new arm` forever (`scripts/bench/render.mjs:498`). `update.button` iOS UI CPU 1.52× is in the README's own table (`README.md:411`) | M | no |
| 48 | G6 merge-main pass (popover direction, CONTRIBUTING build path, Gradle `--rerun`, tab bar) | **open/mixed** — see #46; the anchoring check already constrains its setup (`RealInputTests.swift:1156-1161`) | S | no |
| 49 | T17 iOS memory miss; `benchmarks.md` re-scope | **open** — README says it (`README.md:411-420`); the re-scope waits on the human, as #38 | M | yes, perf only |
| 50 | H1 follow-ups (N4, S2, F8, warning, `borderWidth`, bench comment, "T16 spike", probes) | **mostly fixed** — hosted children skip both registrars (`NitroComposeHost.kt:674-684`, `:1020-1025`, H2a `319a7b8`); `alignSelf`/`borderWidth` are deliberately not warned about (`Host.tsx:226-238`); no "spike" wording left in `android/src/main/java`. F8 is **fixed** — the test really re-frames the child now and asserts `[160, 60, 0, 48]`, its own Yoga frame (`Host.harness.tsx:608-689`, `a696d05`, which also corrected `host.md`/`sizing.md`/README and both Kotlin comments). **Open:** S2's value-change-under-`display:'none'` (the hidden-child test changes only visibility, `HostPopups.harness.tsx:1126-1146`), one comment still states the mount-pass `0 x 0` without the re-frame caveat a696d05 established (`HostControls.harness.tsx:234-238`), the `nitro-ui-host` "gated" comment (`bench/src/plan.ts:37-39` vs `implementations/nitroUi.tsx:235`), two load-sensitive probes | S | no |
| 51 | `CHANGELOG.md` missing from `files`; RN 0.86 iOS smoke n/a | **fixed/obsolete** — `package.json:25`, shipped since 0.1.1 (`306b07f`); the 0.86 iOS row is excluded (`smoke.yml:167-173`); an older-runtime verification is #6/#12 | — | no |
| 52 | Hostnames in committed baselines (D25) | **fixed** — `b205577` + `scripts/bench/machine.mjs` (`NITRO_UI_MACHINE_LABEL`); history keeps the old value — an owner decision, not a task | XS | no |
| 53 | R6 re-review (staged re-run text, node_modules cache, cron minute 0, CONTRIBUTING step 4, provenance) | **open** — `release-tag.yml:26` is still `'0 * * * *'`; the `pack` job still installs through the cached composite (`release.yml:64-65` → `.github/actions/setup/action.yml:18-36`); the "already staged" branch still matches only `cannot publish over the previously published versions` (`release.yml:216`). **Partly closed:** CONTRIBUTING step 4 now says to check `gh workflow list` and enable `Release`/`Release tag` (`CONTRIBUTING.md:1122-1125`), and the `stage` job itself runs `package-manager-cache: false` (`release.yml:147-148`). R6's N-2 (`release-catch-up.mjs` tags the wrong commit) is the same class and is **not** in this file — worth a line | XS | no |
| 54 | X1 re-review (CI cancel, harness refusal text, lock races, doc table, always-true assert, `harness:android` label, `--clean`) | **mostly open** — `ci.yml:41`; the refusal still suggests the path it then refuses (`rn-harness.config.mjs:101-108`); the doc table says `20HybridNitroUiSwitch` while `componentNeedle` builds `${symbol.length}${symbol}` = **19** chars (`scripts/app-stamp-core.mjs:135,151`); `lease.test.js:1066` is always true; `scripts/harness.mjs:55` names `harness:android` on every platform; `--clean` drops DerivedData only (`build-app.mjs:305-308`) | S | no |
| 55 | CI first run: `Harness (Android)` red inside the upstream action | **open** — `ci.yml:226-233` passes `app:` as a relative path; the action parses an input as JSON and got an empty one (line 308 of its `action.yml` — read from CI's log, not a local copy: I could **not verify** which input is empty) | M | no |
| 56 | H2a: quiet bench re-run; one unreproduced iOS failure; Metro port fallback; merged real-input | **open** — `ensureMetro` reuses whatever answers the port (`support.mjs:91-93`); the Host bench cells are busy-flagged, and PLAN-0.4 wave 4 schedules the re-runs | S | no |
| 57 | X2: no SIGINT/SIGTERM test; two `gate.test.js` cases red on Node 25/26 | **open** — `FORWARDED_SIGNALS` (`scripts/gate.mjs:124`) has no test; the CLI block (`scripts/__tests__/gate.test.js:1368`) has no Node-major guard | XS | no |
| 58 | iOS real-input drops a HID tap intermittently | **open** — same class as line 60's Android half and #61's third item; a tap-delivery check belongs in the shared driver | S | no |
| 59 | X6 (no ccache init for JVM tests on purpose; skip wiring untested; CI builds 4 ABIs) | **open by design** — `decideSkipBuild` is unit-tested (`build-speed.test.js:210`), its call in `build-app.mjs:510` is not | XS | no |
| 60 | H2b review N4/N5/N6/N9/N11 + Android real-tap miss | **open** — `followTimeValueInDialog` is ungated (`HybridNitroUiDatePicker.kt:1224`); `reportLock` (`HybridNitroUiPicker.kt:216`) is taken by exactly one method (`:361`); no outside-tap dismissal press in `HostPopups.harness.tsx` | S | the N5 half ships in 0.3.x |
| 61 | X3's three intermittents | **open** — Q3 owns the diagnosis; see task T2 below | S | no |

## 2. Proposed tasks (≤6, ranked)

| # | Task | Lines | Size | Why first |
| --- | --- | --- | --- | --- |
| T1 | **Determinism: one tap-delivery check + four tests.** Assert the OS touch landed before asserting the control's response (iOS `RealInputTests.swift`, Android `CHECKS`); per-instance counters instead of process-wide ones (`livePresentations`); swap the two fixed sleeps for the suite's own `waitFor` (`lease.test.js:821,1152`); a Node-major guard for the `gate.test.js` CLI block; a signal-forwarding test. | 17, 57, 58, 60 (tail), 61 | M | Three suites' red/green is trusted on shared machines today; Q3 has the patches. |
| T2 | **Follow-ups sweep.** Comment/doc fixes, stale-line pruning of `FOLLOWUPS.md`, `slider.md` thumb-only drags, sizing.md's "prospective" line, C1's N1–N5, the bench `nitro-ui-host` comment, H1's S2 case and the one `0 x 0` comment a696d05 left behind, X1's doc-table 20→19, the always-true assertion, `harness:android`→platform-correct labels, `--clean` also dropping the pod-input record, the three fake dark cards, and the S1 report's unverifiable `real-input:android` PASS row (`docs/tasks/S1-storybook.report.md:171`). | 9, 18, 19, 25 (audit), 31, 43, 50, 54 | S–M | Cheapest per line; shrinks the list every reviewer has to re-read. |
| T3 | **Consumer-visible correctness.** `fillWidth` under an infinite parent; `builtBounds` inside `.id(_:)`; an iOS `tintColor` approach for the segmented `Picker`; audit the five controls for label/focus node split with `uiautomator` (the X4 suite then guards it forever). | 10, 27, 45, 46 (`builtBounds`) | M | Only task whose findings can be app-facing bugs in 0.3.x. |
| T4 | **CI green on every trigger.** Fix the harness action's input, `cancel-in-progress` on `main`, the cron minute, CONTRIBUTING's "enable the Release workflow", `HARNESS_APP_PATH` refusals that name a path they reject, a real iOS<26 fallback row (with #12). | 6, 12, 53, 54, 55 | M | Every guardrail in AGENTS.md is only as good as a CI run nobody has to remember. |
| T5 | **Perf and bench axes.** Re-scope the iOS `mounted` gate to total main-thread work (owner's OK), tighten the noisiest iOS cells, re-scope or drop the dead `leak *:N=200` cells, re-run the Host arms in the wave-4 exclusive window, then restate the README numbers. | 5, 28 (F4), 38, 47, 49, 56 | M | Owner-decision-blocked; unblocks what D15 says to document rather than chase. |
| T6 | **Recycling and drop-path gates.** Turn on `enableViewRecycling` in the example and add a leak gate for it, close the post-drop composition guard and the dead-observer re-capture, screens-pop blanking, B1's one remaining stale comment (at `NitroComposeHost.kt:1503-1505`), plus G1's five live verifier items, Button's ~12, G3's and G4's leftovers. | 16, 20, 23, 28, 41 | M | X4 lands the generic no-leak-on-drop rule, so this is finally cheap to prove. |

Deliberately **not** proposed: #3/#4/#49's absolute perf gaps (D15: document after one optimisation
task, don't chase; T13 measured the ceiling), #39 (dead), #32/#37 (obsolete), #31/#34/#35 (fold into
T2), #22 (a real-input render-check primitive is M+ and Progress has no rendered text to read —
X4's counters cover it better), and every line already **fixed**, which needs only the prune in T2.

## Appendix — what I could not verify

- #55: which input the upstream `react-native-harness` action parses as JSON. `react-native-harness`
  1.6.0's npm package (`node_modules/react-native-harness/package.json:3`) ships no `action.yml`, and
  the brief forbids cloning; the `action.yml:308` reference is the CI log's, not a read file.
- The Android side of #46 ("date announced twice without a label", "calendar root merges title +
  weekday names"): that needs a `uiautomator dump` on a device. The labels in
  `HybridNitroUiDatePicker.kt:819-866` look correct on their face.
- #7's and #45's "current state on a device" for every control, and whether any of the
  `real-input`/harness load flakes reproduce here — no devices were touched.
- Whether the RN 0.86 iOS smoke case can be verified on this machine's runtimes at all
  (`smoke.yml:167-173` says it needs an iOS 26.x image or the second Mac).
