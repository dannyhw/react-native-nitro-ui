# Recovery snapshot

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
> **Components:** 0.4 is a button-anchored Menu (G7a/G7b) plus a TextField spike (T18), starting
> after X3 and X4 merge; see `PLAN-0.4.md`.
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
