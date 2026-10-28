# A4 context pack: real paths (checked at `main` when the brief was written)

| Item | Files and facts |
|---|---|
| Probe (JS) | `bench/src/probe.ts`: `awaitMountNs(timeoutMs = 1500)` (~line 41) and `awaitPresentedNs(timeoutMs = 2000)` (~line 51); both resolve `null` on timeout |
| Probe (iOS native) | `bench/modules/bench-probe/ios/HybridBenchProbe.mm`: `BenchProbeAwaitStamp(timeoutMs)` (~264-301; a timeout resolves -1), `awaitMount`/`awaitPresented` (~458-462). Android counterpart: `bench/modules/bench-probe/android/src/main/java/com/margelo/nitro/benchprobe/HybridBenchProbe.kt` |
| Caller | `bench/src/runner.ts` ~67-68 (`mountedAt` / `presentedAt` per iteration; a comment at ~63 on the 3.5 s per-iteration cost of two timeouts) |
| Completeness and the baseline rule | `scripts/bench/lib.mjs`: `incompleteMetrics(cell)` (~1133), `baselineBlockers()` (the incomplete-metric block ~1658-1676), the `sanity.missingPresented` counter (~958), and cell `skipReason`/`skipReasons` (~625, ~864, ~940); the writer is reached from `scripts/bench/run.mjs` and `report.mjs` through `scripts/bench/baseline.mjs` (X8) |
| CLI | `scripts/bench/run.mjs`: `--only <impl,impl>` (~540, ~664), `--plan`, `--launches`, and `--dry-run` (X9); plans in `scripts/bench/lib.mjs` `PLANS` |
| A3 evidence | `docs/tasks/A3-baselines-mac2.report.md` ("iOS run — REFUSED", "The two cells, in this run", and mac-1's comparison); mac-1's file `bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json` (cells `mount.date-picker:expo-ui-*:200`, `sanity.missingPresented`) |
| Rules | `bench/baselines/README.md` (minting rules), `docs/DECISIONS.md` D9 |
| Tests | `scripts/__tests__/bench-gate.test.js`, `bench-baseline-machine.test.js` |
