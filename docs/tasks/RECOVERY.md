# Recovery snapshot

> **2026-10-27:** **0.2.0 published** (H2a Host controls; owner merged Version Packages #2 and approved; registry shasum = CI `51b609ff…`, tag `v0.2.0`). H2b ships as 0.3.0. X2, X6, X7 and H2b merged; **nothing in flight** (clean point to move the orchestrator, see below). 0.3.0 Version Packages PR pending; each takes devices through `scripts/lease.mjs` (pool: pair-a, pair-b). If sessions are gone, re-delegate each from its brief.
 — 2026-10-23 23:50 local

Written because the machine may restart (at 23:41:02 CoreSimulatorService got SIGTERM and shut down
all simulators; the human's `emulator-5560` emulator exited the same minute; cause unconfirmed —
`softwareupdate --list` shows no pending update). Everything below is on disk; uncommitted work in
worktrees survives a restart. Agent sessions do **not** survive — re-delegate with this context.

## Moving the orchestrator to another machine

Planned: the orchestrator moves to a second Mac once nothing is in flight (H2b, X6, X2 merged).

1. On the new machine, `git clone` the repo to `~/Developer/oss/nitro-ui` and run `bun install`,
   then `node scripts/doctor.mjs` until it shows 0 failing. Then run `node scripts/doctor.mjs --setup`
   and set `NITRO_UI_MACHINE_LABEL=maintainer-mac-2`.
2. Start the orchestrator session there with `docs/tasks/ORCHESTRATOR.md`, this file and `STATUS.md`.
   Worktrees, leases and `devices.json` are per machine. Re-create worktrees from the pushed
   branches, never by copying them.
3. First device job there: mint that machine's bench baselines (`--exclusive`, idle, overnight).
   This machine's baselines don't apply there.

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
