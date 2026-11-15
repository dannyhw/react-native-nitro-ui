# `bench/baselines/`

One file lives here.

```text
bench/baselines/
  renders.json   # JS render counts (machine-independent)
  README.md
```

## `renders.json`

`scripts/perf/renders.mjs` records JS wrapper render counts in this file, and
`bun run check` gates them. That gate is exact equality, plus Reassure's own checks (no
render right after mount, no redundant commit): a redundant re-render is a defect, not a
latency, so there is no tolerance to negotiate. The counts are React renders of the JS
wrappers, which is why they need no machine directory — whose laptop ran them does not
change how many times a component rendered.

When a wrapper legitimately changes how often it renders:

```sh
bun run perf:renders -- --update-baseline
```

and review the diff. Every changed line is a claim about that wrapper, and the file is
committed with the change that makes it true.

## Device timings are not committed

The device bench measures nothing against a committed number. A "slower than before"
verdict comes from `bun bench --platform <p> --compare-release [ref]`, which builds the
ref's own bench app and this tree's and alternates them on one device in one session:
the base side is measured on the same host, in the same hour, instead of on whatever
machine minted a file months earlier. The protocol, the thresholds and how to read the
table are in [`docs/performance.md`](../../docs/performance.md) and
[`docs/architecture/benchmarks.md`](../../docs/architecture/benchmarks.md).
