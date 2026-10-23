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
| G4 SegmentedControl | `nitro-ui-worktrees/G4` · `task/G4-segmented-control` | `415afb3` (9 commits, tree clean) | Implementation round done (used fix round 1 of 2 on the `real-input/support.mjs` teardown bug); devices shut down | Opus full review (no devices) → review lands at `/tmp/G4-segmented-control.review.md`; if lost, re-run it. Then ≤1 fix round left; after merge re-run G4 harness on both platforms (FIX2 touched its measure path). |
| ~~R1 gate hygiene~~ (merged) | `nitro-ui-worktrees/R1` · `task/R1-gate-hygiene` | `4c2da00` (7 commits, tree clean) | Apex round in progress: D21 timing gate implemented; Android harness 72/72 green; iOS harness run + the two timing-gate proofs were in progress | If the session is gone: re-delegate "resume R1": finish iOS harness, the red proof under `HARNESS_TIMING=1`, items 2–3 (real-input Metro bug, Node 26 check), report. |

## Devices (D13)

- G4 (free now; reuse for its fix round): iPhone Air `331EF109-21DD-422B-AEF8-DFFFC6998DC3`, AVD `nitroui_t02` port 5572, adb 5042, Metro 8294.
- R1 → then G3 fix round: iPhone 17 `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, AVD `nitroui_t01` port 5570, adb 5041, Metro 8293.
- Never touch `PR1505_Pixel` / `emulator-5560` (the human's). Max 2 device tasks.

## After these

Merge G3, G4, R1 → remaining release readiness (README/docs, smoke on both platforms, primed
baselines D18, final report) → hand back to the human before any public repo / npm publish.
