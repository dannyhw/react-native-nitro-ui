# T02 — Benchmark app, BenchProbe, runner and report

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T02` (branch `task/T02-bench`, from `main`)
**Devices:** iOS sim `iPhone Air` `331EF109-21DD-422B-AEF8-DFFFC6998DC3`; Android AVD `nitroui_t02`
on port 5572 (create from `system-images;android-35;google_apis;arm64-v8a`). Release builds. If you need Metro, use `METRO_PORT=8292`.
**Depends on:** T01 (merged). Runs in parallel with T10 (which builds the first component,
Switch) — so build the infrastructure against RN core `Switch` and `@expo/ui` Switch/Toggle now,
and make adding the `nitro-ui` implementation a one-file change. Read `CONTRIBUTING.md`.

## Goal

Implement `docs/research/setup-decisions.md` §6 "Benchmarks and performance guardrails":
architecture, metrics, noise control, commands. This is the perf guardrail every component task
must run, so the developer experience matters: one command, readable output, stable numbers.

## Scope

1. `bench/`: Expo SDK 58 CNG app (native dirs gitignored), release builds, workspace dependency on
   the library. Plan-driven unattended runs (launch arg / intent extra), NDJSON results pulled from
   the device, `NITRO_BENCH` log fallback.
2. `bench/modules/bench-probe`: private local Nitro module (Swift + Kotlin) per the §6 table:
   `now`, mount observer + `lastMountNs`, `nextFrameNs`, `threadCpuNs(main|js)`, `footprintBytes`,
   `gc` (Android), signpost/Trace `begin/end`. Never published.
3. Scenarios: `mount` (N = 1/50/200; JS commit, mounted, presented), `update` (N = 1/50, K flips
   awaited per frame), JS-thread and UI-thread CPU per update, memory per instance, unmount/leak
   slope. Implementations registry: `rn-core`, `expo-ui-host-per-control`, `expo-ui-shared-host`,
   `nitro-ui` (stub that is skipped until a component registers itself; document the one-file
   change to add one).
4. `scripts/bench/run.mjs` + `report.mjs`: fresh process per (scenario, impl), 1 s settle, 5 warmup
   + 20 measured, 4 launches interleaved ABBA, median of medians ± MAD, p95 presented. Writes
   `bench/results/<sha>-<platform>.json` + a markdown table. `--compare <git-ref>` (head vs base
   ratios, rn-core control-drift check → "noisy, inconclusive"), `--check` against
   `bench/baselines/<platform-device>.json` with ratio-vs-rn-core tolerances, `--update-baseline`.
   `bun bench --platform ios|android --plan quick|full`. A `quick` plan should finish in a few
   minutes per platform.
5. Reassure setup for JS wrapper render counts (`bun run perf:renders`) as a hard gate (it will
   have nothing to measure until T10 merges; wire it so components add a `*.perf-test.tsx`).
6. `bench.yml` workflow (on-demand label/comment + nightly, report-only) — write, don't run.
7. `docs/architecture/benchmarks.md`: how to run, read and update baselines, and the per-component
   checklist ("add impl + scenario props, run quick plan on both platforms, paste table in report").

## Acceptance

- `bun bench --platform ios --plan quick` and `--platform android --plan quick` run end to end and
  produce results comparing `rn-core` vs `@expo/ui` Switch (paste the tables into the report).
- Run-to-run variation of the rn-core control between two consecutive runs reported (noise level).
- `bun run check` still passes.

## Notes from the T01 review

- The library's nitrogen only scans `src/`; `bench/modules/bench-probe` must have its own
  `nitro.json`/nitrogen run and must never be generated into or shipped with the library.
- Root configs were prepared to ignore `bench/`; keep `bun run check` green and make sure the bench
  app has its own typecheck (`bun run bench:typecheck` or include it in check if cheap).
- Device selection env: `IOS_SIM_UDID`, `ANDROID_AVD`/serial, `METRO_PORT` — set to the values above.
- Clock base (D1): `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` / `System.nanoTime()`.
- Follow `docs/DECISIONS.md`.
