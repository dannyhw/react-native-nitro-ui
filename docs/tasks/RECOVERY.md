# Recovery snapshot — 2026-10-23 23:50 local

Written because the machine may restart (at 23:41:02 CoreSimulatorService got SIGTERM and shut down
all simulators; the human's `PR1505_Pixel` emulator exited the same minute; cause unconfirmed —
`softwareupdate --list` shows no pending update). Everything below is on disk; uncommitted work in
worktrees survives a restart. Agent sessions do **not** survive — re-delegate with this context.

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
| B1 Android OOM | `nitro-ui-worktrees/B1` · `task/B1-android-mount-oom` | `e0efb23` + uncommitted review | Fix round 1 running (Apex, `nitroui-B1-fix-r1`) on `nitroui_t01` + iPhone 17 | If lost: re-delegate fix round 1 from the review (M1, M2, report corrections). Then narrow Opus re-review, merge, then C1. |
| P1 iOS profiling | — | report merged | Done (H3 dropped) | — |
| ~~R1 gate hygiene~~ (merged) | `nitro-ui-worktrees/R1` · `task/R1-gate-hygiene` | `4c2da00` (7 commits, tree clean) | Apex round in progress: D21 timing gate implemented; Android harness 72/72 green; iOS harness run + the two timing-gate proofs were in progress | If the session is gone: re-delegate "resume R1": finish iOS harness, the red proof under `HARNESS_TIMING=1`, items 2–3 (real-input Metro bug, Node 26 check), report. |

## Devices (D13)

- Lent to the separate RN Storybook fixes thread (not nitro-ui work): AVD `nitroui_t02` port 5572, adb 5042, Metro 8294; iPhone Air `331EF109-21DD-422B-AEF8-DFFFC6998DC3`. Don't assign them to nitro-ui tasks.
- B1: iPhone 17 `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, AVD `nitroui_t01` port 5570, adb 5041, Metro 8293.
- Never touch `PR1505_Pixel` / `emulator-5560` (the human's). Max 2 device tasks.

## After these

Merge G3, G4, R1 → remaining release readiness (README/docs, smoke on both platforms, primed
baselines D18, final report) → hand back to the human before any public repo / npm publish.

## Overnight baselines

The human approved running the ~3 h bench baselines overnight. A one-shot T3 scheduled task fires at 01:00 local into the orchestrator thread (`nitroui-overnight-baselines-1`): delegate A1b (iOS then Android, `--plan full --launches 8 --update-baseline`, one attempt each), then delete the schedule. The RN Storybook thread was asked to keep devices idle 01:00–07:00. No other nitro-ui device work in that window.
