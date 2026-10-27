# X8 — Bench baselines per machine

**Worktree / branch:** named in your delegation message (from `main`).
**Round cap:** 1 implementation round plus at most 2 fix rounds (D19). **No devices, no lease, no
bench runs:** this is tooling, proven by `check`.

## Why

Committed baselines are keyed by device class only (`bench/baselines/<deviceKey>.json`), so they
are one per class across all machines. A second machine (label `maintainer-mac-2`) is about to mint
its own baselines, which would overwrite the first machine's files. The process review (§5) says a
machine gates only against its own baselines and never against another machine's. Both committed
files record `machine.hostname = maintainer-mac-1`. That value comes from
`NITRO_UI_MACHINE_LABEL` (`scripts/bench/run.mjs:153`), never `os.hostname()` (D25).

## Do

1. **Layout:** a baseline lives at `bench/baselines/<machine-label>/<deviceKey>.json`.
   `git mv` the two existing files to `bench/baselines/maintainer-mac-1/` byte-for-byte unchanged.
   `bench/baselines/renders.json` (render counts, machine-independent) stays where it is, and
   nothing that reads it changes.
2. **Resolution:** `baselinePath` (`scripts/bench/report.mjs`) takes the machine label as well as
   the device key. The label is the run's own `machine.hostname`, so `run.mjs` (live run) and
   `report.mjs` (re-report of a results file) resolve the same file for the same run.
3. **Refusals.** Exit 2 with a message that names the fix, for both `--update-baseline` and `--check`:
   - the label is missing or `unlabelled`. `--update-baseline` must refuse **before** the run starts
     (next to the R4 load fail-fast in `run.mjs`), so an unlabelled machine doesn't spend three hours
     and then fail;
   - the label is not a safe path segment (`^[a-z0-9][a-z0-9-]{0,62}$`);
   - `--check` only: the baseline file's own `machine.hostname` differs from the run's label (a copied
     or moved file). Never fall back to another machine's file or to the old top-level path.
   - `--check` with no baseline for this machine keeps today's "no baseline … create one with
     `--update-baseline`" path, and the message names the per-machine path.
4. **Tests** in `scripts/__tests__/` (extend `bench-gate.test.js` or add a file) covering the path,
   each refusal, the mismatched-hostname `--check` and the pre-run refusal. Each must be shown red
   (AGENTS.md). Fixture labels must not equal the label the code would fall back to.
5. **Docs**, describing the current behaviour and not the history: `bench/baselines/README.md`
   (layout, the per-machine rule, a Status section that says `maintainer-mac-1` has both and
   `maintainer-mac-2` has none yet), `docs/architecture/benchmarks.md`, the `CONTRIBUTING.md` bench
   lines, and the paths in `README.md` "Baselines and gating". Leave `CHANGELOG.md` and
   `docs/tasks/*` alone.

## Out of scope

Minting baselines, changing load or tolerance rules, a bench queue (X5), and the iOS noise
follow-ups.

## Gates

- `node scripts/gate.mjs check` green. `node scripts/gate.mjs need --for review` should then ask
  for nothing more, since `scripts/bench/` and `scripts/__tests__/` are tooling paths. If it asks
  for more, say why in the report.
- The published package is unchanged: `npm pack --dry-run` file list = `etc/package-files.txt`.
- Report in `docs/tasks/X8-baselines-per-machine.report.md` (REPORT-TEMPLATE), ledger exported
  with `node scripts/gate.mjs export --task X8`. Commit on your branch, don't push.
