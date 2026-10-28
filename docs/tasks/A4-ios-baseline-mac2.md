# A4 — Why the iOS mint lost frames, the comparison-cell rule, and the iOS re-mint

**Worktree / branch:** named in your delegation message (from `main`). **Context pack:**
`docs/tasks/A4/context.md`. **Round cap:** 1 implementation round plus at most 2 fix rounds (D19).
Devices only from `node scripts/lease.mjs acquire --task A4`. Use `--exclusive` for parts 1 and 3:
the acquire waits until other leases end. Export `NITRO_UI_MACHINE_LABEL=maintainer-mac-2`.

## Background

A3's iOS run (`docs/tasks/A3-baselines-mac2.report.md`) was quiet and complete except for two cells:
`mount.date-picker` at N=200 on `expo-ui-host-per-control` (55 of 160 `presentedNs` samples) and on
`expo-ui-shared-host` (87 of 160). `baselineBlockers()` (`scripts/bench/lib.mjs:1658-1676`) refuses
the whole baseline when any cell is incomplete. `maintainer-mac-1`'s iOS baseline has both cells
complete. On this machine, iOS mount `presented` sits around 44.5 ms, where mac-1's sits on the
16 ms floor.

The owner's decisions: leave the failing comparison cell out of the iOS baseline, and find out what
went wrong.

## Do

1. **Investigate first (exclusive lease, short runs only).** Find out why those `presentedNs`
   samples never arrived. Hypothesis to test, not assume: `awaitPresentedNs` gives up after 2,000 ms
   (`bench/src/probe.ts:51-55`, native side `bench/modules/bench-probe/ios/HybridBenchProbe.mm`),
   and 200 `@expo/ui` DatePickers take longer than that to present on this simulator.
   - Reproduce with a targeted run of just that scenario and N (all four arms, 8 launches;
     `bun bench --help` lists `--only` and the plan options; add a diagnostic plan only if no flag
     can express it).
   - Measure the real time-to-present distribution per arm with a diagnostic, much longer timeout.
     A local, uncommitted change or an env override is fine for this.
   - Report how close **nitro-ui's own** cells (`mount.date-picker:nitro-ui:200`, and every other
     N=200 mount cell) come to the 2,000 ms limit on this machine. If any of ours is within 25 % of
     it, say so prominently: that's a future refusal or a biased gate on our own rows.
   - State the root cause with the evidence (a per-arm histogram or percentiles of time-to-present,
     and the timeout path in the probe).
2. **The rule, as the owner decided.** In `baselineBlockers()` and the baseline writer, a cell of a
   comparison arm (`expo-ui-host-per-control`, `expo-ui-shared-host`) whose metric is incomplete is
   left out of the baseline, recorded with a `skipReason` naming the metric and its sample counts,
   and listed in the mint's output. An incomplete metric in a gated arm (`nitro-ui`, `nitro-ui-host`)
   or in `rn-core` (every ratio's denominator) still refuses the baseline. Unit tests in
   `scripts/__tests__/`, each shown red: a comparison-arm gap mints with the cell left out, and a
   nitro-ui gap and an `rn-core` gap each refuse. Update `bench/baselines/README.md`'s rules and add
   a dated D9 amendment line to `docs/DECISIONS.md`.
3. **If part 1 proves the timeout is the cause:** raising it is value-neutral (a sample that arrives
   keeps its value; only the waiting changes), so raise it to a level part 1's data supports, state
   the number and why, and make it apply to both platforms or say why not. Then the cells will
   probably be complete and the rule from part 2 becomes the safety net. If part 1 points at
   anything else that could bias **our** cells (a probe bug, a missed frame for nitro-ui), **stop
   before the re-mint** and report it with Questions.
4. **Re-mint iOS** (`--plan full --launches 8 --update-baseline`, exclusive, settled as in A3's brief
   steps 2b/2c, started with `gate.mjs … --background` and waited on with `gate.mjs wait`). If it
   mints: prettier, the `--check` readback, the doctored-copy red, the baseline in its own commit,
   and README Status. If it is refused, record why, with no `--force` and no retry.

If part 3 changed the probe's timeout, also say whether this machine's Android baseline (minted
under the old timeout, all cells complete) needs re-minting for comparability. Recommend only; don't
re-mint it in this task.

## Out of scope

Changing tolerances or load rules, other platforms' baselines, and DatePicker itself.

## Gates

`check`, then `need --for review`. Report: `docs/tasks/A4-ios-baseline-mac2.report.md`
(REPORT-TEMPLATE), with the root cause in its first paragraph and the iOS ratio table if minted
(nitro-ui and nitro-ui-host vs `expo-ui-shared-host`). Ledger exported. Commit on your branch, don't
push.
