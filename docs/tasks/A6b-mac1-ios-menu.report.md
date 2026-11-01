# A6b — maintainer-mac-1's iOS Menu baseline cells

**Branch:** `task/A6b-mac1-ios-menu` (from `origin/main` at `f334eb7`) · **Round:** 1 of 1 (D19) ·
**Lease:** `A6b-5k1rs` (`pair-a` + `pair-b`, exclusive, iOS-only: iPhone 17 sim `F08675D3…`, Metro 8295 unused)

## Summary

`bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json` now holds Menu's 28 full-plan cells
(7 scenarios × 4 implementations), so Menu's iOS bench gate measures something on this machine.
It came from one clean mint — 224/224 launches, `problems: []`, `dirty: false`, and
**`quiet: true`**: 284 load samples, median **2.42** against the 7.0 ceiling for 14 cores, only
**8 over (2.8 %)**, against limits of "median ≤ ceiling" and "≤ 10 % over". A6's same mint was
refused at median 6.93 with 47 % over; the difference this time is the window, not the command —
nothing was passed with `--force`, and the command is byte-for-byte the one from A6's report.

As the first merge into a pre-X14 file it also gains that bookkeeping — a `components` block (the
six existing components seeded from the founding run at `c9548f6`, `menu` from this run at
`f334eb7`), `dependencies` recovered from `bun.lock` at the founding commit, an empty
`skippedCells`, and the schema 2 → 3 bump. The diff is 1851 insertions over **2 deletions**:
`"schemaVersion": 2,` and one closing brace. All 168 pre-existing cells survive byte-for-byte, in
their original key order (comparator, 10/10, with three mutations shown red below).

Two decisions a reviewer needs:

1. **The simulator was booted by hand, on the leased device, before the settle window.** An
   `--exclusive` lease never boots anything: `lease.mjs:719` gates the boot on `options.boot`, and
   `poolHandoff`'s own boot path is inside `if (!lease.exclusive)`, so `--boot` is a dead branch
   for an exclusive lease. Booting inside the measured window would have put a cold-boot spike
   (mac-1 peaks load1 near 58–74) into the samples that decide the guard, so the boot happened at
   01:30:47 — 4 s to `bootstatus`, load1 3.00 → 6.36 — and was then settled away.
2. **The settle was measured, not estimated.** The box had been up 4 minutes when I started
   (`load1` 52.24, Spotlight `mds_stores` at ~110 %). A watcher sampled `load1` every 30 s and
   declared the machine settled only after **six consecutive samples under 4.0**: 360 s from
   25.34 down to 2.93. The pre-settle dry-run refused on load alone (13.86); the post-settle one
   said `Mint: would start` at 3.26. That ordering is the whole fix — a mint launched at A6's
   ambient load would have been refused again.

`check` passes (1538 tests / 57 suites) and `need --for review` is satisfied.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1538 tests / 57 suites | `115bf375d0e8` | 1 m 59 s | start 1.5 / med 6.6 / max 9.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--help` | **FAIL** | — | `115bf375d0e8` | 0.1 s | start 13.8 / med 13.8 / max 13.8 |
| `bench:--platform:ios:--plan:full:--launches:8:--component:menu:--update-baseline` | **PASS** | — | `115bf375d0e8` | 29 m 48 s | start 3.3 / med 2.4 / max 9.3 |

`need --for review`: `need: review is satisfied on this code tree.` — with `✓ check — green` and
`note: the code diff touches no platform-specific code, so no device gate is asked for beyond check`.

The `bench:--help` row is my own usage probe (`gate.mjs bench --help` forwards to
`run.mjs --help`, which exits 2). It measures nothing and blocks nothing; it is in the table
because the table is generated from the ledger and I did not edit the ledger to make it prettier.

## The iOS run — MINTED

`bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json`, one file, its own commit `fb5c83c`.

| Field | Value |
| --- | --- |
| Command | `NITRO_UI_MACHINE_LABEL=maintainer-mac-1 node scripts/gate.mjs bench --background -- --platform ios --plan full --launches 8 --component menu --update-baseline` (pid 8658) |
| Results | bench/results/`f334eb7-ios-20261101T013736Z.json` (+ `.ndjson`, `.md`) — gitignored, so a run-local path, not one a reviewer can open at HEAD |
| sha / dirty | `f334eb7` / `dirty: false` (clean tree for all 29.7 min; no commit was made inside the window, because the runner stamps `sha` when a run *ends*) |
| Device | iPhone 17 sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, iOS 27.0 → key `ios27-sim-iphone17`. The file's `deviceName`/`sha` stay as founded (`iPhone 17`, `c9548f6`), carried through unchanged |
| Plan | `full` / 8 → 7 cells × 4 implementations × 8 = **224 launches**, 224/224, `problems: []` |
| Wall time | 1 783 829 ms = **1784 s / 29.7 min**, 8.0 s per launch, 01:37:31 → 02:07:19 UTC |
| Machine | maintainer-mac-1, Apple M4 Pro, 14 cores, 48 GB, Xcode 27.0, runtime 27.0, **`quiet: true`** |
| loadSamples | `{count: 284, ceiling: 7, median: 2.4221, p90: 4.3188, max: 9.2744, over: 8, overFraction: 0.0282}` |
| Load stamps | boot 3.00 → 6.36 · settle 25.34 → 2.93 over 360 s (12 samples) · dry-run **13.86 (refused) then 3.26 (would start)** · gate row start 3.3 / median 2.4 / max 9.3 / end 2.7 · runner p90 4.32, end instant `loadavg1` 2.67 · ceiling 7.0 |
| Comparability | matched before the guard: CPU model + 14 cores, iOS 27.0 runtime and Xcode 27.0, device key `ios27-sim-iphone17`, RN `0.88.0` and `@expo/ui 58.0.22` from `bun.lock` at founding commit `c9548f6`, waiting rule 1500/8000 ms = platform default (the four `Merge:` inferences) |
| Baseline | 325 407 bytes, sha256 `198a8f4b8075e7e166953ef1…3cbc19`, 196 cells (168 + 28), schema 3, `prettier --check` clean |
| Merge bookkeeping | 6 components `seededFromFoundingRun: true` (`sha c9548f6`, founding `loadSamples` median 2.9265) + `menu` (`sha f334eb7`, 8 launches, `full`, own `loadSamples` median 2.4221, 28 `cellKeys`, 4 `comparabilityNotes`); top-level `dependencies` + empty `skippedCells` |
| `--check` read-back | exit 0. 117 rows: 15 `within tolerance`, 17 reference arm, 41 reference-arm-noisy, 29 control-noisy, 14 noisy, 1 new arm (`leak.menu:nitro-ui:200`, memory slope only — "nothing to regress against until the baseline is refreshed"). 55 metrics noisy within the run. Zero FAIL, `No gated metric exceeded the 1.20x threshold against the baseline.` |

Ratios to `rn-core`, as the run printed them (`nitro-ui` arm; the two `@expo/ui` arms and
`nitro-ui-host` are in the gate log):

| Cell | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- |
| mount N=1 | 1.00× | 5.46× | 1.90× | 1.76× | 8.02× | n/a |
| mount N=50 | 1.00× | 4.40× | 0.51× | 0.44× | 10.07× | n/a |
| mount N=200 | 6.04× | 5.45× | 0.61× | 0.65× | 15.72× | n/a |
| update N=1 | 1.00× | 2.59× | 1.02× | 1.06× | 2.80× | n/a |
| update N=50 | 2.03× | 3.99× | 0.51× | 0.83× | 4.77× | n/a |
| memory N=200 | n/a | n/a | n/a | n/a | n/a | 5.65× |
| leak N=200 | n/a | n/a | n/a | n/a | n/a | n/a |

Absolute medians for the same rows: `mount.menu N=200` presented 97.55 ms for nitro-ui against
16.16 ms for rn-core (mounted 80.10 ms vs 15.01 ms), and `memory.menu N=200` 355.4 KiB against
62.4 KiB — the same shape as mac-2's Menu cells and as the refused A6 run's context numbers.

## Red proofs

No new test or gate shipped (this is a data mint), so the proofs are that the two things doing the
guarding fire. The comparator (a throwaway script, kept locally: it compares the **source text** of
each cell block, because a `JSON.parse`/`stringify` round-trip rewrites 39.6 kB of formatting here
and would go red for a reason the check does not guard) ran against `origin/main` — 10/10 ok on the
committed merge, then red per mutation, with the file restored byte-identical each time
(`198a8f4b8075`).

- comparator -> delete one surviving founding cell (`mount.slider:nitro-ui:50`) -> `FAIL no
  pre-existing cell was removed — 1 removed: mount.slider:nitro-ui:50` and `FAIL every
  pre-existing cell is byte-identical by source text — 167/168 identical; differs:
  mount.slider:nitro-ui:50` (7/10 ok).
- comparator -> forge the last digit of a founding cell's ratio (`mount.button:nitro-ui:50`
  `presentedNs.ratio` …967 → …968) -> `FAIL every pre-existing cell is byte-identical by source
  text — 167/168 identical; differs: mount.button:nitro-ui:50` (8/10 ok).
- comparator -> append a foreign clone `mount.switch:nitro-ui:999` -> `FAIL every added cell key
  belongs to the named component — 29 added, 1 foreign: mount.switch:nitro-ui:999` (9/10 ok).
- `--check` on the merged file, **inside the component** -> scale the base `ratio` +
  `launchRatios` of the quietest gated Menu cell (`mount.menu:nitro-ui:50 presented`, within-run
  MAD 0.03 %) by ⅓ -> exit 1 with `- FAIL mount.menu:nitro-ui:50 presented: 3.00x, 95% CI
  2.99x-4.41x (launch bootstrap over 16 launches)`; the pristine file returns exit 0.
- Direction matters, recorded so a pass there is not misread: the same forgery the other way
  (base ratio ×2) stays **exit 0**, because the gate asks only whether head/base *regressed*.
- Outside-component check, as A6 ran one: forging a founding-run cell (`mount:nitro-ui:50`
  `presentedNs` ×3) stayed **exit 0** with zero founding rows in the table — a narrowed `--check`
  compares only rows its own run measured. The comparator's byte-identity proof is what covers
  those 168 cells here (Follow-ups).

## Files changed

- `bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json` — +28 Menu cells, schema 2 → 3,
  `components`/`dependencies`/`skippedCells` bookkeeping (commit `fb5c83c`).
- `docs/tasks/A6b-mac1-ios-menu.report.md`, `docs/tasks/A6b-mac1-ios-menu/gates.jsonl` — this
  report and the exported ledger.
- `android35-emu-pixel9.json` — untouched: Android Menu is already merged on `main`.

## Setup and load notes

Cost, all of it one-time per linked worktree: `git worktree add` + `bun install` **5.2 s** (1369
packages), `doctor.mjs` exit 0 (0 failing, 2 warnings: the reboot's own `load1`, and
`NITRO_UI_MACHINE_LABEL` unset in the shell profile), iOS bench app build **~2.5 min** (Release,
`BUILD SUCCEEDED`, `reused: false`, ccache already at 85 %), exclusive acquire instant (nothing to
power off — 4 pool devices already off after the restart), sim boot **4 s**, settle **6 min**,
dry-run + mint **30 min**. Roughly **40 min** from worktree to a committed baseline.

The only two refusals seen were both load and both expected: `doctor`'s warning line (advisory) and
the pre-settle dry-run (`Mint: would refuse … load average 13.86 over 14 cores (ceiling 7.0)`). No
comparability refusal, no dirty-tree refusal, no `--force`, and no `--skip-build`: the mint built
its own app and the read-back reused the results file rather than the device.

Nothing else on the machine was touched. `lease list` at the start showed both pool devices
unleased (idle 305 min) and no other leases; `--exclusive` reported 0 shut down, 4 already off. The
non-pool simulators (`RNSB 26.4`, `RNSB starter`, `PR1492 iPhone 17`, `iPhone 17e`) and the
Android pool halves stayed powered off, and no Android emulator — including the reserved serial —
was started, addressed, or listed against. All PIDs I started (build, settle watcher, gate runs)
have exited; `lease.mjs release A6b-5k1rs` leaves the leased simulator booted, which is what the
warm pool wants, and reaps nothing.

## Follow-ups

- bench/lib: a narrowed `--check` still compares only the rows its own run measured, so a merged
  file's older cells cannot be shown to gate by a one-component read-back (same as A6's note; a
  `--check-all`, or a docs line telling a mint host to run one full-plan `--check`, closes it).
- lease: an `--exclusive` acquire ignores `--boot` completely — `lease.mjs:719` requires
  `options.boot` and `poolHandoff`'s boot branch is `if (!lease.exclusive)` — so a bench host is
  pushed into booting its own leased device by hand, and `--boot` prints nothing to say it was
  ignored. That is a documentation or a warning-line gap, not a correctness bug.
- gate: `gate.mjs bench --help` runs the runner and records a **FAIL** row in the branch ledger, so
  a usage probe permanently dirties the report's generated gate table.
