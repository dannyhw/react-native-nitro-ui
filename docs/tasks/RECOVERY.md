# Recovery snapshot

> **2026-11-04 — overnight stop (both machines lose network).** In flight, nothing finished. Resume in this order:
>
> 1. **X18 (PR #34, maintainer-mac-2)**: fix round 1 is pushed (`8480f2c7`), and its re-review says MERGE. The merge round
>    had started in its worktree (`t3-d367291d`, branch `task/X18-merge`, **mid-merge of `origin/main`, conflicts
>    unresolved**: `HybridNitroUiMenu.kt`, `nitro.json`, `docs/tasks/FOLLOWUPS.md`). Resume by sending its implementer
>    thread the same merge-round brief: finish the merge (regenerate `nitro.json` with registry/nitrogen/conformance,
>    don't union it), bring Checkbox/ContextMenu up to the floor, pass `shapes = Shapes(), typography = Typography()`
>    explicitly in the theme call, narrow `NitroUiMaterialThemeLibraryTest` (prove it red), delete the stale "runtime
>    theme switch recomposes" follow-up in the report, then all five merge gates and `need --for merge`. If the merge
>    state is confusing, `git merge --abort` and redo it. Then verify the code tree, push `main`, and close #34.
> 2. **G17 SearchField (Codex Apex, maintainer-mac-2)**: worktree `t3-48bfab6e`, `task/G17-search-field`, head
>    `fdd5d8a8` (round-1 report committed, tree clean). It was running `harness:android` under lease `G17-auva6`
>    (pair-a). On resume: `gate.mjs status` in that worktree, re-run any gate that did not finish, release the lease,
>    open its PR, then an independent Opus review.
> 3. **G18 Tooltip and X19 example tab bar (Opus, maintainer-mac-1)**: no PRs yet. G18 has been blocked since
>    2026-11-03 17:32 UTC on one question: how to take the README's Android screenshot (`tooltip-android.png`).
>    Its leased emulator is on the lease's private adb server, which the T3 device tools can't see. Taking it with adb
>    needs the owner's say-so. On resume, read their T3 threads
>    and the `task/G18-*` / `task/X19-*` branches on mac-1 (`git log`, `gate.mjs status`). Continue each as a **new**
>    `delegate_task` with 9-minute gate waits. X19 lands before G17/G18 merge.
> 4. **Version Packages PR #32** is open (it will be 0.7.0): merge it after X18 and the components you want in it, then
>    check `npm view react-native-nitro-ui dist-tags` before you call the release pending.
> 5. After X18: Expressive pass 1 (D40), buttons and menus, run on the two machines in parallel.
>
> Leases older than their TTL expire on their own. Don't `reap` other tasks' devices; release only your own leases.


> **2026-10-27 — handoff point.** Published: 0.3.0 (all seven controls hostable on Android) and 0.3.1
> (docs), each registry shasum = CI, tags `v0.3.0` / `v0.3.1`. **Nothing in flight**: no task
> worktrees, no leases, no open PRs. The orchestrator moves to the second Mac
> (`NITRO_UI_MACHINE_LABEL=maintainer-mac-2`, set up with `scripts/doctor.mjs --setup`, doctor green).
> The first machine (`maintainer-mac-1`) stops running nitro-ui tasks.

## Next, on maintainer-mac-2 (in this order)

> **2026-10-27 progress (maintainer-mac-2).** Doctor green. X8 merged: baselines are per machine
> now (`bench/baselines/maintainer-mac-1/…`; this machine mints into `maintainer-mac-2/`), and
> the iOS key comes from the simulator's device type (this machine's sims are named `nitro-ui A/B`).
> Apex effort policy: `EFFORT-eval-2026-10-27.md`. Step 1 (A3) is merged: Android baseline minted; iOS refused on two `@expo/ui` DatePicker
> N=200 cells that lost presented frames on this slower simulator (FOLLOWUPS), so iOS needs a rule decision
> and one more exclusive window. It was delegated once X3 and X9 had released their leases (this machine is a
> dedicated spare: benches need an idle machine, not a time of day). Step 3 (X3) is merged, and so is X9.
>
> **0.3.2 published (2026-10-29):** approved by the owner; `latest` is 0.3.2, and `v0.3.2` is tagged at `54dcaf5`
> (the Version Packages commit) with its GitHub release. F3's three fixes are what it ships. `Stage on npm` treats
> npm's `E409 Cannot stage previously published version` as already known (`c235180`).
>
> **G7a (Menu) merged (2026-10-29, `41e30c5`, PR #7)** with the owner's D32 rulings; all five merge gates green on
> maintainer-mac-2. Its minor changeset makes the next release **0.4.0**. Hold the Version Packages PR until G7b
> (Menu's bench arm, real-input case, story) and X4 have landed, then release (sequencing call, D31). Whichever of
> X4/G7b merges after the other must cover Menu in X4's conformance tables (`check` refuses an uncovered manifest).
>
> **Owner away from 2026-10-29 (autonomous):** mac-1 runs G7a, then F2 (`HANDOFF-mac1-2026-10-29.md`; F2 merged, PR #6), and
> opens a PR per task. mac-2 runs F1, X13 and X4, and merges mac-1's PRs after re-running gates here
> (the `nitroui-pr-watch` schedule ran until F2 merged and G7a went draft; it was deleted 2026-10-29). It merges the 0.3.2 Version Packages PR once CI is
> green; npm staging still needs the owner's approval on npmjs.com.
>
> **Components:** 0.4 is a button-anchored Menu (G7a/G7b), after X4; TextField moved to 0.5 (D30;
> T18/T18b kept as branches). F3 (0.3.x-visible fixes) merged from maintainer-mac-1.
> **F1 merged (2026-10-29, `2d58ca6`):** `real-input:ios` is green on this machine again (tap-delivery witness,
> retry counts in every gate log). Its dwell probe found a product bug: a hosted Switch on the busy Switch screen
> drops presses shorter than ~0.1 s (a human tap), while RN's `Pressable` takes them; **F7** (`F7-quick-tap.md`) owns
> it. The suite presses for 0.15 s meanwhile. **X4 and F7 started 2026-10-29 from `3dfe041`**, one device pair each
> (worktrees `nitro-ui-worktrees/X4`, `/F7`). **F7 merged** the same day: the drop is RN-level, not ours (FOLLOWUPS F7);
> a real-device thumb check is the open item.
> **G7b merged (2026-10-30, `268859b`)** on maintainer-mac-2: 1 impl + 1 fix round, re-review MERGE WITH FIXES
> (applied by the orchestrator, plus two commit messages scrubbed of a temp path before merge); all five merge gates
> green. **X4 merged (`a31ad90`)** after two fix rounds, and **D3 (`8c42ce8`)**, the README pass, both with all five
> merge gates green. **0.4.0 staged on npm (2026-10-30):** Version Packages PR #8 merged (`c74ffd0`; a bot-opened PR
> runs no CI by design, and the gate is `Release`'s `check` on `main`). Release run 41019762301 green, `Stage on npm`
> succeeded; the owner approved it, 0.4.0 is `latest` on npm, and `Release tag` was dispatched for v0.4.0.
> **A5 merged (`4f67da0`)**: quiet numbers in README and reports, six reversed conclusions stated. **X14 merged (`386a511`)**: Menu's cells are in both of this machine's baselines (Android by X14's proof, iOS by an orchestrator merge mint: 224 launches, 35 min, 28 added, 0 replaced). maintainer-mac-1 still owes Menu on both
> (`X14-bench-component-mint.md`). The owner finds 11-hour exclusive windows rough, so after X14 a new component's
> baseline cells are minted alone. A full window is only for a comparability break (Xcode/runtime/RN/bench change).
> **X15 merged (2026-10-31, `5bc783b`)** after two fix rounds (a Kotlin CI step that skipped itself under `CI=true`;
> a flaky Metro fixture that leaked processes): all five merge gates green. Each device gate now stops the Metro its own
> run left on its leased port, and `check` runs the Android JVM tests. F6 merges after it.
> **F6 merged (2026-10-31, `611fd66`)** after two fix rounds: the example runs with RN view recycling on, the Recycling
> harness proves pool reuse while mounted, Android `DatePicker` resets its sizing policy on recycle, and a dropped Android
> host no longer measures until it is re-attached. All five merge gates green (`check` on a re-run: X15's self-exit
> fixture raced a busy port once, fixed in the next commit). Three patch changesets are pending for 0.4.1. CI on `main`
> was red from `386a511` to `96ad69c` (a depth-1 checkout had no `HEAD~5`); the jobs that run `check` now fetch history.
> **0.4.1 staged on npm (2026-10-31):** Version Packages PR #9 merged (`7a4063c`), Release run 41217627377 green with
> `Stage on npm` succeeded; it waits for the owner's approval, then `Release tag` tags v0.4.1.
> **0.4.1 live (2026-10-31):** approved by the owner, `latest` on npm, `v0.4.1` tagged at the Version Packages commit
> (`c7496a8`, as v0.4.0 was) by a dispatched `Release tag`. **F4 merged (`072ed4c`)** after one fix round: `main` runs
> get a concurrency group per sha, `pack` installs without a cache (seen skipped in run 41234951195), and both CI harness
> jobs now load their config; their remaining hosted-runner failures are in FOLLOWUPS. **A6 merged (`b86faaa`)**, the first
> task run on a linked machine (T3 linked environment INV-0391 = maintainer-mac-1, full access, the child pushed only
> its task branch): mac-1's Android baseline gained Menu's 35 cells; its iOS mint was refused by the load guard.
> **A6b merged (2026-11-01, `fa99b05`, PR #13):** mac-1's iOS baseline gained Menu's 28 cells (quiet run after 1am:
> median load 2.42 of 7.0), so Menu is now in both machines' baselines on both platforms. The link to mac-1 runs through
> T3 Connect's relay, not Tailscale; the owner is to revoke it on mac-1.
> **F8 + F8b merged (2026-11-01, `e011d8e`, PR #12):** both CI harness jobs green on hosted runners for the first time
> (dispatch 41301942271: iOS 227 passed, Android 280 passed). Product changes: DatePicker's iOS fallback re-measured at
> `en_US`; the sizing engine reclaims late-filed and never-bound ledger rows (the Menu/Picker leaks) and keeps corrections
> for re-shown views. **Merge exception:** this host's simulators could not launch apps, so `harness:ios` was taken from
> the CI run on the same head (92ffe64) and `real-input:ios` was not run; check, real-input:android and harness:android
> ran locally on the merged tree. Three patch changesets are pending for 0.4.2.
> **0.4.2 staged on npm (2026-11-01):** Version Packages PR #14 merged (`323818a`), Release run 41308986511 green with
> `Stage on npm` succeeded (two patch notes: DatePicker's iOS fallback at `en_US`; the sizing-engine leak and re-show fix).
> **F8's iOS gate exception closed (V1, PR #16, `eaedc73`):** on maintainer-mac-1, `real-input:ios` 14/14 and `harness:ios`
> 227 passed on `main` at `161e7d2` (which carries 0.4.2), so every merge gate has now run on a device. Stale duplicate
> Version Packages PR #15 closed.
> **G9 merged (2026-11-01, `baf9811`, PR #17):** iOS `Menu` now draws an untitled section's rows (its header was a
> `Divider()`, which UIKit built as an empty inline menu). Run on maintainer-mac-1 by **Claude Opus 5.5 at `auto`**: the
> first linked task in auto mode, with nothing blocked. iOS gates ran there on the same code tree; check and both Android
> gates ran here on the merged tree, plus an Android red proof the orchestrator added (`ce4ba14`).
> **G8 merged (2026-11-02, `b52435e`, PR #18):** the Android `Menu` dropdown sizes to its items, not the trigger; the inline
> `DatePicker` fits 320 dp (40 dp touch targets only below 360 dp, height unchanged at 512 dp). iOS gates ran first on
> maintainer-mac-1 (V3, V3b), and then all five merge gates ran here after the host restart, which fixed the simulators'
> `DataMigrationFailed` boots. Two patch changesets are pending.
> **X16 merged (2026-11-02, `f2a6f2c`, PR #20):** tooling sweep 2. Tests scrub the lease env; `acquire --exclusive --boot` needs
> `--platform` and an explicit flag; `--help` probes record nothing; `real-input:ios` re-reads a11y boxes until two agree.
> All five merge gates ran here. Five small follow-ups from its re-review are in FOLLOWUPS.
> **G11 merged (2026-11-02, `74efeb6`, PR #24): AlertDialog and ConfirmationDialog**, the first new components since Menu
> (Q5 Appendix B, D33). iOS presents from its own window (`ios/core/NitroUiPresentation.swift`, shared with DatePicker),
> so a dialog over an RN `Modal` can't strand it. Built, fixed twice and merge-gated on maintainer-mac-1 by Claude Opus at
> `auto`: the merge branch `task/G11-merge` carried the five-gate ledger, and `main` was fast-forwarded to it.
> **0.4.3 live, 0.5.0 staged (2026-11-02):** the owner approved 0.4.3 (tagged by a dispatched `Release tag`). Version
> Packages PR #25 merged (`4f931b2`, minor: the dialogs); Release run 41483605054 green with `Stage on npm` succeeded.
>
> **0.6.0 live (2026-11-03 08:59 UTC; tagged `v0.6.0` at `0696da5` by a dispatched `Release tag`).** Was: Version Packages PR #30 merged (`3afdf5d`; minors TextField, Chip, BottomSheet; G10's
> three patches); Release's `Stage on npm` succeeded. Awaiting the owner's approval, then dispatch `Release tag`.
> Running: G15 Checkbox (mac-2), S3 ContextMenu spike (mac-1, D36).
>
> **G14 and G12 merged (2026-11-03, PRs #28/#27): BottomSheet and Chip.** G14's merge took main + D4 and Chip's
> reviewed head `239c370`, resolved the TextField x Chip x BottomSheet registrations, and passed all five gates on code
> tree `87d4b2ab0814` (mac-2). mac-1's separate Chip merge (`b5cfb7c`, also green) was not needed. Minor changesets:
> TextField, Chip, BottomSheet; Version Packages PR #30 is now the next minor.
>
> **D4 merged (2026-11-03, PR #29): every component in the README with iOS/Android screenshots**, and a `check`-time guard
> (`scripts/__tests__/readme-components.test.js`: Components row, import line, 804/720 px screenshots per exported
> component; Host exempt). Convention in CONTRIBUTING and AGENTS' quality bar. All five merge gates green on mac-2.
>
> **G13 merged (2026-11-03, PR #26): TextField** (`UITextField` on iOS, `BasicTextField` on Android; D34). After the
> second fix round the orchestrator applied the re-review's small fixes on the merge (`15d9db3`: a refused iOS edit is
> refused whole, the native view survives hidden effects, the Android probe closes a composing region before a typed
> key). Device gates green on maintainer-mac-1 and `check` on mac-2, on code tree `9cabf5fbe5e4`. Minor changeset.
>
> **0.5.0 live (2026-11-03):** the owner approved the staged 0.5.0 (AlertDialog, ConfirmationDialog); `latest` is 0.5.0, and
> a dispatched `Release tag` tagged `v0.5.0` at `06f4d08` with its GitHub release. Version Packages PR #30 (G10's patches) is
> held so the TextField, Chip and BottomSheet minors ship with it.
>
> **M2 merged (2026-11-02, PRs #22/#23): G10 component follow-ups and X17 tooling follow-ups**, with the Host suites'
> hybrid-handle race fixed (`7833707`, every first handle read waits for the handle). All five merge gates green on
> maintainer-mac-1 on code tree `e99634813021`; `check` re-run on mac-2 on the merge. G10's patch changesets ride
> the next release with TextField/Chip/BottomSheet's minors. In flight: G13 TextField fix round 2 (last), G14
> BottomSheet fix round 1, G12 Chip fix round 1 (mac-1), D4 README screenshots + guard fix round 1.
>
> **Failure logs (owner, 2026-10-28):** A4 adds per-iteration missing-sample reasons to the bench;
> **X12** (`X12-failure-logs.md`, after X10) keeps gate logs outside the worktree and exports failure
> excerpts with the ledger.
>
> Research done during the mint (read-only, merged): `Q1-menu-design.md` (+ D29, the owner's Menu
> answers) feeds the G7a brief; `Q2-textfield-research.md` (orchestrator answers appended) feeds T18;
> `Q3-flaky-tests.md` has the patches for F1; `Q4-followups-triage.md` turned FOLLOWUPS into groups
> F1–F6 (pruned by F0).
>
> Queue (owner-approved 2026-10-27; X3 and X9 merged): after the A3 mint, **X11**
> (`X11-device-throughput.md`: emulator `-gpu host`, warm device pool, harness timing) and **X10**
> (`X10-check-throughput.md`, no devices) in parallel; then **X4** (`X4-conformance.md`) and the 0.4
> components. X11 goes first because software rendering plus repeated device boots are what make two
> device tasks flake on this 10-core machine; until it lands, no two device tasks overlap. Nothing
> else runs while A3 (or any `--exclusive` bench) holds the machine. After X10/X11, the step-2 quiet
> re-runs go as one more exclusive window. X9 is `X9-tooling-smoothing.md` (bench `--dry-run`, lockfile follows
> releases, `doctor --prime`, one build at a time, `gate.mjs wait`, unowned devices). The **X4** brief must also include: `task-ready.mjs`
> fails when a backticked path in the report doesn't exist at HEAD (unless the diff adds or
> deletes it). That catches invented files, which X3's first minutes showed. Every brief now gets a
> context pack (`ORCHESTRATOR.md` step 1b).

1. **Mint that machine's bench baselines** (`--exclusive`, idle, overnight, no Screen Sharing):
   iOS 27.0 `--plan full --launches 8` and the Android equivalent. They are new files under
   `bench/baselines/` with `machine.hostname = maintainer-mac-2`. Keep `maintainer-mac-1`'s files:
   they gate only that machine.
2. **Quiet bench re-runs** on that machine, against its own baselines: H2a, H2b, G5 and G6 (each
   report and the README Performance section mark their numbers as indicative, pending this).
   Replace the indicative tables with the quiet ones, keeping the caveat if a run isn't quiet.
3. **X3, the component registry plus codegen** (`docs/tasks/PROCESS-review-2026-10-26.md` §5): one
   `component.json` per control, which generates the ~25 registration lists, plus a nitrogen merge
   rule. It unblocks running components in parallel.
4. **X4, the conformance suite plus `scripts/task-ready.mjs`** (same doc, §3).
5. **Follow-ups worth a small task** (`FOLLOWUPS.md`):
   - real-input tap-delivery check (iOS HID and Android Switch taps drop intermittently);
   - the H2b review N items;
   - the CI Harness (Android) failure inside the upstream action.

X5 (a bench queue for a second machine) is moot while one machine both orchestrates and benches.
Revisit it if a second worker machine is added.

## main (`~/Developer/oss/nitro-ui`)

Merged and green: T01, T02, T03, T10, T11, T12, T13 (report only), T14, T15, T15b, FIX1, FIX2,
G1 Slider, G2 Button. v0.1 = Switch, Slider, Button (merged) + Progress + SegmentedControl (D19).
Decisions D1–D21 in `docs/DECISIONS.md`; follow-ups in `docs/tasks/FOLLOWUPS.md`.

## In-flight work

| Task | Worktree / branch | Last commit | State | Next step |
|---|---|---|---|---|
| G3 Progress | — | merged into main (`7b91e95`) | Done | — |
| G4 SegmentedControl | — | merged into main (`ea4c42d`) | Done | — |
| R2 Release 0.1 | — | merged into main | Done. v0.1 ready locally; waiting on the human (repo/publish decision, Android D15 decision). | — |
| S1 Storybook | — | merged | Done | — |
| T16 Host spike | branch only (`b93b41b`, pushed) | report merged | Done | Human decides whether 0.2 ships an Android `<Host>`. |
| A2 small fixes | — | merged | Done | — |
| A1 baselines | — | report merged | Not minted (iOS busy; Android OOM) | iOS re-run in an idle window; Android after B1. |
| B1 Android OOM | — | merged | Done | — |
| A1b overnight baselines | — | merged | Android minted; iOS refused (end-of-run load) | One more overnight iOS attempt after R4 merges; if refused again, stop — iOS stays on `--compare`. |
| R4 load guard | — | merged | Done | iOS overnight attempt scheduled 01:00 2026-10-26. |
| C1 Android over-wide | — | merged | Done | — |
| A1c iOS baseline | — | merged | Done: minted (median load 2.93, 3.4 % over) | — |
| G6 Picker | — | merged | Done | — |
| H1 Android Host | — | merged | Done | — |
| D1 public docs | — | merged | Done | — |
| R5 publish 0.1.0 | — | merged | **Published** `react-native-nitro-ui@0.1.0` (registry tarball sha256 = tested `fa1b7b96…`), tag `v0.1.0` + GitHub release | — |
| X1 dev tooling (CI checks, build-app, lease) | — | merged | Done; CI enabled (checks / native-tests / build-android) | Next: X2 gate ledger + short reports, X3 registry codegen (after H2a), X4 conformance, X5 bench queue / second Mac. |
| R6 Changesets release | — | merged | **Validated end to end:** 0.1.1 staged by CI via OIDC with provenance, approved by the owner, `v0.1.1` tagged at `152e059` by Release tag | — |
| X6 build speed | `nitro-ui-worktrees/X6` · `task/X6-build-speed` (clean, no commits) | brief on main | **Merged** (1 impl + 2 fix rounds; review MERGE WITH FIXES; all five merge gates green; package byte-identical) | — |
| X2 gate ledger + short reports | `nitro-ui-worktrees/X2` · `task/X2-gate-ledger` (clean, no commits) | brief on main | **Merged** (1 impl + 1 fix round; review FIX ROUND → fixed; merge exception: no iOS/real-input, diff reaches no app binary) | — |
| R5b post-publish smoke | — | merged | Done: all 6 rows green from the npm tarball | — |
| H2a Host: Slider/Progress/Button | — | merged | Done; ships in the next minor via `.changeset/host-composes-more-controls.md` | Quiet bench re-run pending (bench machine). |
| H2b Host: SegmentedControl/Picker/DatePicker | `nitro-ui-worktrees/H2b` · `task/H2b-host-popups` | brief on main | **Merged** (1 impl + 1 fix round; review MERGE WITH FIXES, M1-M3 fixed; all five merge gates green) | Ships as 0.3.0 via the Version Packages PR. |
| G5 DatePicker | — | merged | Done | — |
| P1 iOS profiling | — | report merged | Done | — |
| T17 iOS Host spike | branch only (`871c579`, pushed) | report merged | Done: iOS Host not better (D23); H3 dropped | — |
| ~~R1 gate hygiene~~ (merged) | `nitro-ui-worktrees/R1` · `task/R1-gate-hygiene` | `4c2da00` (7 commits, tree clean) | Apex round in progress: D21 timing gate implemented; Android harness 72/72 green; iOS harness run + the two timing-gate proofs were in progress | If the session is gone: re-delegate "resume R1": finish iOS harness, the red proof under `HARNESS_TIMING=1`, items 2–3 (real-input Metro bug, Node 26 check), report. |

## Devices (D13)

- Leased through `scripts/lease.mjs`: pair-a (iPhone 17 + `nitroui_t03`), pair-b (iPhone Air + `nitroui_t01`). The `RNSB …` simulators belong to the Storybook thread and were left running. Device config for `scripts/lease.mjs` is machine-local in `~/.nitro-ui/devices.json`.
- Never touch `emulator-5560` (the human's). Max 2 device tasks.

## After these

Merge G3, G4, R1 → remaining release readiness (README/docs, smoke on both platforms, primed
baselines D18, final report) → hand back to the human before any public repo / npm publish.

## Overnight baselines

The human approved running the ~3 h bench baselines overnight. A one-shot T3 scheduled task fires at 01:00 local into the orchestrator thread (`nitroui-overnight-baselines-1`): delegate A1b (iOS then Android, `--plan full --launches 8 --update-baseline`, one attempt each), then delete the schedule. The RN Storybook thread was asked to keep devices idle 01:00–07:00. No other nitro-ui device work in that window.
