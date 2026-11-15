# X36 — The bench compares against the last release, not against committed baselines

**Branch:** `task/X36-bench-compare` (from `origin/task/W3-tooling-removal` at `a13e64d0`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** none — the brief bars a device run in this task, so no
lease was taken and the comparison has never been run on a device.

## Summary

The bench has one comparison mode now. `--compare-release [ref]` measures a ref — by default the
newest release tag — and this tree in one session on one device, and reports per cell the head/base
ratio with its bootstrap interval. It exits non-zero and names the cells that are slower by the rule
D9 already used: ratio over 1.20, interval excluding 1.05, and that cell quiet inside its own run.
`--dry-run` prints the whole plan for such a session without a device.

The one design choice a reviewer has to read is how the older ref gets measured. The base side is
that ref's **whole bench app**: a checkout under `~/.nitro-ui/bench-base/<repo>/<ref>/`, built by
that ref's own `scripts/bench/build.mjs`, scheduled from that ref's own `lib.mjs`. Measuring an old
library inside today's app would compare today's harness with itself and silently mis-measure any
cell the app or the probe changed since the tag. Both sides carry the same app id, so a session
alternates instead of concatenating: install one side, drive its launches for that round, install the
other, in ABBA rounds so each side leads twice. Cost — one extra app build, one `bun install`, six
installs for a four-launch plan, twice the launches — is **not measured**: this task ran no
device.

Gone with their tests: `bench/baselines/maintainer-mac-1/` and `-2/` (44,577 lines of per-machine
data), `scripts/bench/baseline.mjs`, `scripts/bench/format.mjs`, `--check`, `--update-baseline`,
`--force`, the machine labels and `NITRO_UI_MACHINE_LABEL`, per-machine baseline keys, and the
missing-sample rules that existed only to protect a mint. The three removed flags are refused by name
with the sentence that replaces them, so stale muscle memory gets an answer, not a plan
mistaken for a verdict. Kept: `bench/baselines/renders.json` and `perf:renders` untouched; `arm-ratios.mjs`
and the README's `@expo/ui` table; the load sampler, now a recorded number on the run rather than a
pre-start refusal; and `scripts/bench/deps.mjs` — the audit listed it as mint-only, but both sides
still record their own provenance through it, so it stays. `dry-run.mjs` was also on the audit's
removal list; the brief asks `--dry-run` to print the comparison plan, so it was rewritten instead.

Not done, by the brief: no device run. The comparison is proven by unit tests and a printed plan
only, and the first real run is the orchestrator's to schedule. `scripts/bench/lib.mjs` ended at
2,239 lines against the audit's ~2,300 target for the smallest setup that still works.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1965 tests / 88 suites | `e3533d4261b8` | 1 m 34 s | start 5.8 / med 12.6 / max 14.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android` —
deliberate: the brief forbids a device run here ("do not acquire a lease and do not run the bench"),
and the diff is bench tooling and docs — no component code moved — while the ledger mapping
treats an unclaimed path as both platforms, which is why it asks for four device rows. `bun run bench:typecheck` is
green (it is a step of `check`) — and `bun run task-ready` reports those two device gates and nothing else (report paths,
the generated table and conformance coverage all ok). The four device rows are what the first real comparison run
owes.

## Red proofs

Recorded as data in `docs/tasks/X36-bench-compare/mutations.json` (8 mutations: anchor, replacement, run,
the line that went red). Each was applied to the shipped source, its suite run, then reverted.

- `bench-compare · fails, and names the cell, when one is over 1.20x slower` -> `RATIO_FAIL_THRESHOLD = 1.2` -> `1.4` -> `expect(section.exitCode).toBe(1)` received 0 (bench-compare.test.js:176)
- `bench-compare · will not call a slow cell slower when its own interval includes 1.05` -> drop `ci.low > RATIO_CI_EXCLUDES` -> `true` -> `expect(failure.conclusive).toBe(false)` received true (bench-compare.test.js:204)
- `bench-compare · will not call a cell slower when the cell was bouncing inside its own run` -> drop `!noisy` from the rule -> `expect(failure.conclusive).toBe(false)` received true (bench-compare.test.js:223) — the fixture is built so every launch is over 1.25x and the interval excludes 1.05, so only the quiet rule can save it
- `bench-compare · picks the tag that shipped last, not the one a sort of the names gives` -> sort the tags lexically, reversing git's creatordate order -> `expect(answer.ref).toBe('v0.10.0')` received 'v0.9.11' (bench-compare.test.js:413)
- `bench-compare · picks a hotfix that shipped after a bigger version was cut` -> sort by version number descending -> `expect(answer.ref).toBe('v0.9.2')` received 'v0.10.1' (bench-compare.test.js:421)
- `bench-compare · measures each side first the same number of times` -> every round base-first (`pattern[0]`) -> `expect(order).toEqual([...])` all four rounds became `base/head` (bench-compare.test.js:273)
- `bench-compare · pays one install per side switch, not one per launch` -> same mutation -> `expect(four.installs).toBe(6)` received 8 (bench-compare.test.js:293)
- `bench-compare · skips a tag that is the commit under review` -> disable the `sha === headSha` skip -> `expect(answer.skipped).toEqual(['v0.10.0'])` received `[]` (bench-compare.test.js:432)
- `bench-dry-run · refuses a flag the bench no longer has` -> `removedFlagProblem` returns `null` -> `expect(out.all).toContain('--check no longer exists')` — the run printed a plan instead, which is the false green the guard exists to stop (bench-dry-run.test.js:617)

## `--dry-run` for a comparison

`node scripts/bench/run.mjs --platform ios --plan quick --compare-release --dry-run` (exit 2: the
plan prints, and the reason it would not start is named; the two paths are shortened here and are
absolute in the real output):

```text
Platform:  ios
Plan:      quick (31 cells x 4 implementations x 4 launches = 496 launches)
Device:    UNKNOWN
Host:      10 cores, load 15.68 now (quiet under 5.0)
           note:    the machine was busy: load average 15.68 over 10 cores (ceiling 5.0)
Compare:   v0.9.0 (ded5c9b) vs HEAD (126c818c)
  head:    496 launches from /path/to/this-checkout
  base:    496 launches from ~/.nitro-ui/bench-base/this-checkout/v0.9.0 (built there, installed under the same app id)
  device:  UNKNOWN - both sides, one session
  rounds:  4, order base/head head/base head/base base/head
  installs 6 (one per side switch), 992 launches total
  cells:   124 compared, 0 head-only, 0 base-only
Reason:    IOS_SIM_UDID is not set, so no simulator can be resolved - lease one (node scripts/lease.mjs acquire --task <ID>)
Dry run:   1 reason(s) not to start it as asked
```

## Files changed

- `scripts/bench/compare.mjs` — new: tag choice, side order, the plan, and the base-side effects (extract, install, build, read the ref's own schedule).
- `scripts/bench/run.mjs` — the comparison mode, per-side targets/driving/assembly, removed flags refused by name, `--perf-marks`/`--timeout-*` refused for a comparison.
- `scripts/bench/lib.mjs` — keeps the rule constants, `gate()`, statistics and the load sampler; the baseline file format, mint rules and machine keys are out (2,849 lines on the branch this one stacks on, 2,239 here).
- `scripts/bench/render.mjs`, `scripts/bench/report.mjs`, `scripts/bench/dry-run.mjs`, `scripts/bench/machine.mjs` — comparison sections, plan printing, load reported without a hostname or label.
- Deleted: `scripts/bench/baseline.mjs`, `scripts/bench/format.mjs`, `bench/baselines/maintainer-mac-1/`, `bench/baselines/maintainer-mac-2/`, `scripts/__tests__/bench-baseline-format.test.js`, `scripts/__tests__/bench-baseline-machine.test.js`, `scripts/__tests__/bench-machine.test.js`.
- Tests: `scripts/__tests__/bench-compare.test.js` (new, 18 tests), and `bench-dry-run`, `bench-gate`, `bench-missing-samples`, `bench-device-key` cut to what still exists.
- Docs: `docs/performance.md`, `docs/architecture/benchmarks.md`, `CONTRIBUTING.md`, `AGENTS.md`, `bench/baselines/README.md`, `scripts/doctor.mjs` (machine-label item removed). No measured number changed; the only estimate added is the "one to two hours per platform" plan duration in `CONTRIBUTING.md`, labelled as derived from per-launch times.

## Follow-ups

- `scripts/bench/build.mjs`: the Android stale-bundle bug the audit names must be fixed before an Android `--compare-release` verdict is trusted — a head build that reuses the base's bundle would read as "nothing got slower".
- `docs/PLAN.md`: still says regressions are caught against a "committed baseline".
- Four components have bench arms and no cells (`icon-button`, `button-group`, `stepper`, `list-item`), so they can never appear in a comparison.
- Each compared ref keeps a checkout under `~/.nitro-ui/bench-base/<repo>/<ref>/` (135 MB for one tag here) and
  nothing prunes refs a release no longer compares against.
- README Performance numbers: measured at `abe68a1` (2026-10-30), 8 of 23 components, pre-M3-Expressive — the
  owner's decision from the audit, untouched here.
- `AGENTS.md`: it still promises `gate.mjs export` writes a failure excerpt per red run to
  `docs/tasks/<ID>/failures/`; the v6 ledger stopped writing `failureLogPath` and nothing writes that
  directory any more (gone on the branch this one stacks on, not here).
- `scripts/bench/render.mjs` `gateSummary`: it counts head noise only, so a noisy base still reads "every verdict is conclusive"; no test pins `baseNoisy`.
- `--compare-release --component <unknown> --dry-run` ends in a stack trace from `buildSchedule`; a plain dry run prints a reason.
- `scripts/bench/run.mjs`: a comparison resolves its ref only after the head build, so a bad ref costs a build first.
- Base records are aggregated, and base launch strings built, by the head's `lib.mjs`; nothing checks the base's `SCHEMA_VERSION`.
- The two sides' ART states are recorded and not compared: a `verify` base against a `speed-profile` head would read as a speed-up.
- `installBaseDependencies` skips when `node_modules` exists, so an interrupted `bun install` is never repaired.
- The base cache is keyed by the checkout's directory name, so every worktree pays its own extraction, install and build.
- With `--launches 2` or `3`, or after a failure, the release's app is the one left installed.
- A head metric that loses its samples drops out of its comparison row without a word.
- The default tag is the newest one in the local clone; nothing fetches, and the clone has no `v0.9.1` tag.
- `runDependencies` labels the base side `bun.lock in the working tree`, and only the head's install is checked for staleness.

## Questions for orchestrator

1. **What should the first device comparison run?** Options: (a) `--plan quick --compare-release` on
   each platform to prove the mechanism (a plain quick plan is estimated at one to two hours per
   platform, and a comparison asks for both sides plus a second build), then a `full` run before the release;
   (b) go straight to `--plan full`, hours per platform, on the bench host's exclusive lease.
   Recommend (a): the mechanism (six installs, two app builds, one app id) has never been driven on a
   device and a quick plan finds that cheaply. On Android, run it *after* the stale-bundle fix or
   treat a flat result as unproven — the failure mode is a false green, not a false red.
2. **Should the release workflow call `--compare-release` itself?** Recommend not yet: run it by hand
   on the bench host for one release cycle, then automate it once its duration and its base-side
   failure modes (a tag that no longer builds) are known.

## Design changes

`docs/DECISIONS.md` is on this branch (round 1 said it was not, which was wrong). Fix round 1
applied the wording below to D9, D15 and D18 there; it stays here as the record of what changed.

**D9 (T02) Benchmark policy** — replace the committed-baseline bullet and the mint-only parts of the
R4/A4 amendments with:

> - Gate only `nitro-ui` arms, on **launch-paired ratios to `rn-core`** measured in the same run;
>   noise is judged within the run per (scenario, metric), never by absolute drift against a stored
>   number.
> - **X36 amendment - the release is the baseline, measured in the same session.** Before a release,
>   one session on one canonical device measures the newest release tag and the candidate:
>   `--compare-release [ref]`. The base side is that ref's own app, built by that ref's own scripts in
>   a checkout outside the repository, and the two sides alternate in ABBA launch rounds under one app
>   id. A cell fails at ratio over 1.20 whose interval excludes 1.05 and which stayed quiet inside the
>   run - the same verdict rule as before, with a fresh "before" instead of a committed one. No device
>   timing is committed: no mint, no `--check`, no `--update-baseline`, no per-machine file.
>   Wrapper re-render counts stay a hard gate in `bun run check` (`bench/baselines/renders.json` is
>   the one committed measurement, and it is not a device timing).
> - Load is sampled and recorded on every run and printed with the comparison; a busy host is a
>   visible fact, not a pre-start refusal, because the only refusal that ever needed it (a mint) is
>   gone. A cell that was noisy inside its own run is not gated either way.
> - Device keys stay (`platform + OS runtime + device class`) as metadata on a results file, so a
>   reader knows what produced a number; they are no longer a lookup key, because there is nothing
>   committed to look up.

**D15 (T02)** — keep the canonical device and the review targets, drop the recording duty:

> Canonical iOS bench device stays the iPhone 17 simulator (iOS 27). Nothing is recorded "by the first
> task that holds that device": there is no baseline to record. A comparison is run on the canonical
> device so its two halves are comparable with each other, and its machine model/CPU is recorded in
> the results file for the reader. A component's first `nitro-ui` arm is still reviewed against the
> `@expo/ui` and `rn-core` arms in the same run, target unchanged (≤ 1.0× `expo-ui-shared-host`, well
> below `expo-ui-host-per-control`); that target is a review judgement, not a gate against stored
> data.

**D18 (T12)** — the ART rule survives; its baseline clause does not:

> Android bench numbers are only comparable within one ART compilation state, and runs record it
> (`art`). The release comparison is comparable by construction - both sides are measured in the same
> session on the same device - and `--compare-release` refuses a run that would change what is being
> measured mid-session (`--perf-marks`, any `--timeout-*` override). "Baselines are minted only from
> `speed-profile` runs" and "primed Android baselines are recorded during release readiness" are
> withdrawn: readiness *is* the comparison.

## Fix round 1

Lease: none, no device. `check` is green on `e3533d4261b8` (table above).

- **Explicit ref at HEAD.** Both sides are now full commit ids, and the ref is peeled to its commit, so
  an annotated tag is refused too. `--compare-release HEAD --dry-run` now prints the refusal.
- **Failed base side.** A cell the plan measures on both sides that ends without a verdict, because a
  side has no record or no sample of it or of its control, is listed under "Not compared" and fails
  the session; so does a base launch that did not complete. A cell both sides measured and neither can
  quote (a flat leak slope) is left alone.
- **False statements.** D9, D15 and D18 in `docs/DECISIONS.md`, the `run.mjs` header, the 31-cell
  quick plan and two `render.mjs` strings.
- **Nice-to-have, two of them.** `runDependencies` has its two tests again. The launch loop moved to
  `scripts/bench/drive.mjs`: a failed install or stop ends the run with its reason, its records and a
  non-zero exit.

Red proofs: 14 rows appended to `mutations.json`; the first four restore the pre-fix expressions.

Not run on a device, as before. The other review items are one line each under Follow-ups.
