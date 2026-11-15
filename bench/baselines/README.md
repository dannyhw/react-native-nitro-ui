# `bench/baselines/`

One file lives here.

```text
bench/baselines/
  renders.json   # JS render counts (machine-independent)
  README.md
```

## `renders.json`

`scripts/perf/renders.mjs` records JS wrapper render counts in this file, and
`bun run check` gates them. The gate is exact equality, plus Reassure's own checks (no
render right after mount, no redundant commit). The counts are React renders of the JS
wrappers, so they are the same on every machine.

When a wrapper legitimately changes how often it renders:

```sh
bun run perf:renders -- --update-baseline
```

and review the diff. Every changed line is a claim about that wrapper, and the file is
committed with the change that makes it true.

## Device timings are not committed

The device bench measures nothing against a committed number. A "slower than the last
release" verdict comes from `bun bench --platform <p> --compare-release [ref]`, which builds
the ref's own bench app and this tree's and alternates them on one device in one session, so
both sides are measured on the same host at the same time. The protocol, the thresholds and
how to read the table are in [`docs/performance.md`](../../docs/performance.md) and
[`docs/architecture/benchmarks.md`](../../docs/architecture/benchmarks.md).
