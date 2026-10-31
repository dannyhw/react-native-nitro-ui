# A6 — maintainer-mac-1's Menu baseline cells (first task run on a linked machine)

**Branch:** `task/A6-mac1-menu-cells` (from `main` at `35d687a`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `A6-pse0s` (pair-a: iPhone 17 sim `F08675D3…` + AVD `nitroui_t03` / `emulator-5574` / adb 5043 / Metro 8295)

## Summary

Android shipped: `bench/baselines/maintainer-mac-1/android35-emu-pixel9.json` now has Menu's 35
full-plan cells (140 → 175), from one clean mint of 280/280 launches with `problems: []`. It is the
first merge into this pre-X14 file, so the file also gains the bookkeeping CONTRIBUTING lists —
`components` (Menu's own entry, the other five seeded from the founding run), `dependencies`
recovered from `bun.lock` at the file's founding commit `3533d64`, an empty `skippedCells`, schema
2 → 3 — and nothing else: the diff is 2149 insertions over **2 deletions** (`"schemaVersion": 2,`
and one closing brace). A source-text comparator, not deep-equality, confirms all 140 surviving
cells and the `machine`/`art` blocks are byte-identical and the old key order is untouched (28/28
checks, below).

iOS did not ship, and nothing was written for it. All 224/224 launches completed with
`problems: []` and every comparability field matched, then the write-time load guard refused:
**47 % of samples over the ceiling** (137 of 289 over 7.0 for 14 cores, median 6.93). Per brief
item 3 I stopped instead of working around it, and never passed `--force`. mac-1's iOS file is
byte-for-byte the one from `origin/main` (schema 2, 168 cells, founding sha `c9548f6`). The guard
is right to refuse — this machine's ambient load is the owner's own apps (WindowServer,
screen-sharing, Slack/Claude helpers), which sat at 5.2–5.9 before the run and which the brief
says not to wait for; a boot on top of that peaks load1 near 58 and takes ~12 min to recover. So
mac-1's iOS Menu gate stays empty until the orchestrator or owner picks a window (see Questions).

Two decisions a reviewer needs:

1. **The Android device was booted outside the lease**, deliberately: CONTRIBUTING tells a bench
   host not to `lease --boot`, and `--exclusive` powers off every device on the pool. Mode matches
   what A3/X14 minted with (`-gpu host`, `-no-snapshot-load -no-snapshot-save -no-window -noaudio
   -no-boot-anim -no-metrics -port 5574`) because the AVD's own `config.ini` carries
   `hw.gpu.enabled=no`; GPU mode is not a recorded comparability field, so it is stated in the
   note below rather than asserted to match.
2. **Provenance carries two shas on purpose.** The run stamped `sha: 35d687a` (main, the tree it
   measured); the merge keeps the file's founding `sha: 3533d64` and records the mint under
   `components.menu.sha`. No commit was made during either bench window, because the runner stamps
   `sha` when a run *ends*.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1494 tests / 55 suites | `224752adf1e2` | 2 m 22 s | start 6.1 / med 16.3 / max 23.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--platform:android:--plan:full:--launches:8:--component:menu:--update-baseline:--skip-build` | **PASS** | — | `224752adf1e2` | 33 m 59 s | start 4.1 / med 5.1 / max 6.8 |
| `bench:--platform:ios:--plan:full:--launches:8:--component:menu:--update-baseline:--skip-build` | **FAIL** | — | `224752adf1e2` | 32 m 17 s | start 5.3 / med 6.9 / max 9.1 |

`need --for review`: `need: review is satisfied on this code tree.` — with
`✓ check — green` and `note: the code diff touches no platform-specific code, so no device gate is
asked for beyond check`. `check` is this brief's only required gate; the iOS row is a refusal, not
a regression, and a bench never blocks `need` (D15).

## Android run — MINTED

`bench/baselines/maintainer-mac-1/android35-emu-pixel9.json`, one file, its own commit `b59db14`.

| Field | Value |
| --- | --- |
| Command | `node scripts/gate.mjs bench --background -- --platform android --plan full --launches 8 --component menu --update-baseline --skip-build` (pid 60824), `NITRO_UI_MACHINE_LABEL=maintainer-mac-1` |
| Results | bench/results/35d687a-android-20261031T183820Z.json (+ `.ndjson`, `.md`) — that directory is gitignored, so this is a run-local path, not one a reviewer can open at HEAD |
| sha / dirty | `35d687a` / `dirty: false` (clean tree for all 33.9 min) |
| Device | AVD `nitroui_t03`, API 35, profile `pixel_9`, `emulator-5574` on adb server 5043 → key `android35-emu-pixel9`. The file's `deviceName` stays `nitroui_t01` (its founding device): carried through byte-identically, not rewritten |
| Plan | `full` / 8 → 7 cells × 5 implementations × 8 = **280 launches**, 280/280, `problems: []`, `dirty: false` |
| Wall time | 2 035 418 ms = **2035 s / 33.9 min**, 9.3 s per launch, 18:38:16 → 19:12:11 local |
| ART | `com.nitroui.bench` → `speed-profile`, `primed: true`, **attempts: 1** |
| Machine | maintainer-mac-1, Apple M4 Pro, 14 cores, 48 GB, `quiet: true` |
| loadSamples | `{count: 348, ceiling: 7, median: 5.0081, p90: 5.8013, max: 6.9258, over: 0, overFraction: 0}` |
| Load stamps | start `loadavg1` 4.19 (dry-run 4.19, gate row 4.1) · median 5.01 · p90 5.80 · max 6.93 · end instant `loadavg1` 6.59, `loadavg5` 5.46 · ceiling 7.0 |
| Baseline | 287 606 bytes, sha256 `393f841781255cf4…b0dfe6c`, 175 cells, schema 3, `prettier --check` clean |
| Merge notes recorded | `schemaVersion`, `timeouts` (platform default 1500/2000 ms), `dependencies` (`react-native 0.88.0`, `@expo/ui 58.0.22` from `bun.lock` at `3533d64`) |
| `--check` read-back | exit 0. 146 rows compared: `nitro-ui` 26 within tolerance + 3 noisy + 1 new arm (`leak.menu:nitro-ui:200`, memory slope only), and 74 reference-arm + 29 control-noisy + 13 reference-arm-noisy. Zero FAIL, `No gated metric exceeded the 1.20x threshold against the baseline.` |

### Boot mode (comparability note)

Booted by hand on the lease's private adb server with `-gpu host -no-snapshot-load
-no-snapshot-save -no-window -noaudio -no-boot-anim -no-metrics -port 5574`, the same mode A3 and
X14 minted under, because the pool AVD's `config.ini` sets `hw.gpu.enabled=no` and a
software-rendered emulator measures something else entirely in `presentedNs`. Neither committed
baseline records a GPU mode, and `run.mjs` passes no emulator launch args, so this is stated, not
assumed.

Ratios to `rn-core`, as the run printed them (`nitro-ui` arm; the two `@expo/ui` arms and
`nitro-ui-host` are in the gate log):

| Cell | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- |
| mount N=1 | 1.00× | 1.06× | 0.77× | 0.88× | 1.51× | n/a |
| mount N=50 | 1.25× | 1.41× | 0.63× | 0.68× | 2.80× | n/a |
| mount N=200 | 2.52× | 1.95× | 0.65× | 0.65× | 4.60× | n/a |
| update N=1 | 1.00× | 0.99× | 0.98× | 0.98× | 1.48× | n/a |
| update N=50 | 0.79× | 0.66× | 0.74× | 0.76× | 2.59× | n/a |
| memory N=200 | n/a | n/a | n/a | n/a | n/a | 3.95× |
| leak N=200 | n/a | n/a | n/a | n/a | n/a | n/a |

Absolute medians for the same rows are in the gate log
(`gate.mjs logs --branch task/A6-mac1-menu-cells`); e.g. `mount.menu N=200` presented 123.68 ms
for nitro-ui against 49.13 ms for rn-core, and `memory.menu N=200` 300.4 KiB against 75.8 KiB.

## iOS run — REFUSED, nothing written

| Field | Value |
| --- | --- |
| Command | same form, `--platform ios` (pid 82571) |
| Results | bench/results/b59db14-ios-20261031T193448Z.json — gitignored, a run-local path; kept on this machine as the evidence for the refusal |
| sha / dirty | `b59db14` / `dirty: false` |
| Plan | `full` / 8 → 7 cells × 4 implementations × 8 = **224 launches**, 224/224, `problems: []` |
| Wall time | 1 929 545 ms = **1930 s / 32.2 min**, 8.6 s per launch, 19:34:41 → 20:06:30 local |
| Load stamps | start `loadavg1` 5.27 (dry-run 5.65, gate row 5.3) · median 6.93 · p90 7.98 · max 9.32 · **137 of 289 samples over 7.0 (47.4 %)** · end instant `loadavg1` 8.58, `loadavg5` 7.59 · `quiet: false` |
| Refusal, verbatim | `--update-baseline refused (pass --force to override):` then `- the machine was busy for 47% of the run: 137 of 289 load samples over 7.0 (ceiling for 14 cores), median 6.93` |
| Comparability | matched before the guard: CPU model + 14 cores, iOS 27.0 runtime and Xcode, device key `ios27-sim-iphone17`, RN `0.88.0` and `@expo/ui 58.0.22` from `bun.lock` at the file's founding commit `c9548f6`, waiting rule 1500/8000 ms = platform default (the four inferences are the run's own `Merge:` lines) |
| Aftermath | `git status` clean for the file: still schema v2, 168 cells, founding sha `c9548f6`, 265 063 bytes. No iOS `--check` read-back was run — there were no new cells to read back, and the brief's `--check` step follows a merge. |

Settle rule applied as A3 does it (proportionally: its "under 4 of a 5.0 ceiling" ≈ "under 5.6 of
mac-1's 7.0"): after the sim boot peaked load1 at 58.27 I waited ~17 min to a stable 5.2–5.9 and
the Android mint passed with median 5.01 on the same ambient baseline. iOS then drifted up to a
median 6.93 because its own launches run on the host with the owner's apps still at ~5.

For context only (not written anywhere): this run's nitro-ui vs rn-core ratios were mount N=200
6.71× presented / 6.67× mounted / 11.21× UI CPU, memory 5.42× bytes — the same shape mac-2's Menu
cells have, so a quiet re-mint should land comparably.

## Red proofs

No new test or gate shipped in this task (it is a data mint), so the proofs here are that the two
things doing the guarding actually fire: the merge comparator, and `--check` against a merged file.
The comparator ran against `origin/main` (`35d687a`, the file's pre-merge state), 28/28 ok on the
committed merge, then red for each of three mutations. Mutations splice the file's own text — a
`JSON.parse`/`stringify` round-trip would have gone red on formatting, which is not what the check
guards.

- comparator -> delete one surviving founding cell's source block (`mount.slider:nitro-ui:50`) ->
  `FAIL no existing cell was removed — 1 removed: mount.slider:nitro-ui:50` and
  `FAIL every pre-existing cell is byte-identical by source text — 138/140 identical; differs:
  mount.slider:nitro-ui:50, mount.slider:rn-core:200` (24/28 ok).
- comparator -> forge one digit of a founding cell's ratio (`mount.button:nitro-ui:50`
  `jsCommitNs.ratio` …94 → …95) -> `FAIL every pre-existing cell is byte-identical by source text —
  139/140 identical; differs: mount.button:nitro-ui:50` (26/28 ok).
- comparator -> append a foreign clone `mount.switch:nitro-ui:999` -> `FAIL every added cell key
  belongs to the named component — 36 added, 1 foreign` (26/28 ok).
- `--check` on the merged file -> scale the base `launchRatios` + `ratio` of Menu's own quietest
  gated cell (`update.menu:nitro-ui:50 presented`, 0.69 % within-run MAD) by ⅓ -> exit 1 with
  `- FAIL update.menu:nitro-ui:50 presented: 3.00x, 95% CI 2.95x-3.05x (launch bootstrap over 16
  launches)`; the pristine file returns exit 0.
- Direction matters, recorded so a pass there is not misread: the same forgery the other way (base
  ratio 0.79 → 1.58) stays green, because the gate asks only whether head/base *regressed*.
- Outside-component check, as X14 ran one: forging a founding-run cell (`update:nitro-ui:50
  presentedNs`, switch) stayed **exit 0**, because a narrowed run only compares rows it measured —
  all 146 rows here are Menu's. Showing the founding cells still gate on a merged file needs one
  extra full-plan `--check` run; not run (Follow-ups). The comparator's byte-identity proof is what
  covers those cells here.

## Files changed

- `bench/baselines/maintainer-mac-1/android35-emu-pixel9.json` — +35 Menu cells, schema 2 → 3,
  `components`/`dependencies`/`skippedCells` bookkeeping (commit `b59db14`).
- `bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json` — **unchanged** (refusal).
- `docs/tasks/A6-mac1-menu-cells.report.md`, `docs/tasks/A6-mac1-menu-cells/gates.jsonl` — this
  report and the exported ledger.

## Linked-machine notes

First task run through a T3 link at access level `auto`. What the orchestrator will want:

- **Approvals and sandbox denials: none.** No command in this task needed an interactive approval
  and no tool reported a sandbox denial — not `xcodebuild`, `simctl`, `emulator`, `adb`, `gradle`,
  the lease's file locks, `prettier`, `bun`/`bun install`, or `git`. Everything below was run
  through the OpenCode harness shell on mac-1 and it all worked: builds, device boots, installs,
  ART priming, 280+224 app launches, both gate runners, and `git push`.
- **`git push` worked** — the one approved exception, `git push origin task/A6-mac1-menu-cells`;
  no credential prompt, no remote setup, no `--force`, and nothing else pushed.
- **What I had to work around** was machine policy, not permissions: (a) no `--boot` on a bench
  lease, so the Android device came up by hand outside the lease (see Boot mode) — the first thing
  a linked task should be allowed to do without thinking; (b) `--exclusive` powers off the whole
  pool, so `doctor`'s two unleased booted sims went down with it — expected, but it means a linked
  task always starts the pool's devices itself; (c) the host is the owner's daily driver, so the
  load guard's ceiling is effectively shared with their apps and iOS cannot clear it while they run
  — that is the real blocker here, not the link.
- **Setup cost:** `git worktree add` from the existing checkout ~4 s, `bun install` 5.76 s,
  `doctor.mjs` exit 0 (0 failing, 4 warnings), iOS bench app build ~4 min, Android ~3.5 min (both
  fresh, no warm DerivedData/Gradle cache on this machine for this worktree), first device boot +
  settle ~17 min. Roughly **26 min from clone-equivalent to the first mint**, and that is the
  one-time cost per linked worktree.
- Two housekeeping notes for linked runs: `caffeinate -is` was mine and is stopped; the Gradle
  daemon I started was stopped with `./gradlew --stop`; my emulator was shut down by its own
  `adb -s emulator-5574 emu kill`, never by name, because I had started it outside the lease — so
  the pool's pair-b Android device is off and the next acquire pays that boot, while pair-a's
  simulator is left Booted and unleased, which is the pool's business and not mine to switch off.
  The two other-project simulators and the owner's `emulator-5560` were never touched, and
  `lease.mjs release A6` left everything as it found it.

## Follow-ups

- bench/ios: mac-1's iOS Menu gate still measures nothing until a quiet window is chosen (Question 1).
- bench/lib: `--check` silently compares only the rows its own run measured, so a narrowed mint
  cannot show that a merged file's older cells still gate; a `--check-all` (or a docs note telling a
  mint host to run one full-plan `--check`) would close that.
- bench/docs: neither committed Android baseline records a GPU/boot mode, so every mint has to
  state it by hand; `loadSamples`-style provenance for boot flags would remove the guess.
- lease/docs: an `--exclusive` acquire on a linked machine silently powers off another project's
  booted sims that `doctor` has already flagged; a warning listing what it will switch off would
  help a first run on someone's machine.

## Questions for orchestrator

1. **iOS Menu on mac-1: re-mint window, or leave the file without Menu?** The mint itself is clean
   (224/224, no problems, comparability green) and costs 32 min; only the load guard's 47 %
   over-ceiling blocks it, on load that is mostly the owner's own apps.
   - **(Recommended) Re-mint once, in a window the owner agrees to** — needs ambient load staying
     well under ~5.5 on this 14-core box, i.e. while their apps are quiet or after hours. Same
     command, `--skip-build` is still fresh; I'd add nothing.
   - Or **leave mac-1's iOS file as-is**, with Menu's iOS gate measuring nothing there until the
     next full re-mint (the owner's call either way, per brief item 3).
   - Not on the table: `--force`, or narrowing the plan to reduce the load footprint.
