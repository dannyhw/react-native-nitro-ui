# D3 — Docs pass for 0.4.0

**Worktree / branch:** named in your delegation message (from `main`). **Round cap:** 1 round plus at most
2 fix rounds (D19). **Runs after** G7b and X4 merge and **before** the 0.4.0 Version Packages pull request
is merged: npm ships the README, so 0.4.0 must not go out describing 0.3.

D2 did the same for 0.3.0 (patch changeset, released as 0.3.1). This time the docs land before the
version, so they ride in 0.4.0.

## Known stale (found 2026-10-30; check for more)

- **README has no `Menu`.**
  - Missing from the Components table, the root `import` list and Usage.
  - Usage needs a `### Menu` section with a `tsx name=menu` block. `bun run check` compares README
    blocks with `example/src/readme-examples.tsx`, so add the region there too.
  - The Host paragraph says `<Host>` "holds every control the library ships". Menu is hostable on
    Android (`src/components/Host/HostChildren.ts`), so name it in that paragraph.
- **"The seven controls"** and the smoke table in "What has been tried":
  - Say what the smoke app mounts after G7b.
  - Don't tick a cell nobody ran. If you can't run the smoke cells, say so and leave the 0.1.0 date on them.
- **"The GitHub workflows are disabled".** README (Contributing) and CONTRIBUTING's opening paragraph
  say this. `CI`, `Release`, `Release tag` and `Changeset status` have been active since X1 and R6;
  only `Bench` and `Smoke` are disabled. Check with `gh workflow list --all`, read-only.
- **`src/index.ts` header comments** are stale. They say "Switch is the only hosted control today" and
  call the surface "v0.1". These are comment-only fixes.
- **Known limitations:** add Menu's iOS splits (D32) where the README lists the other controls'.
- **`docs/components/host.md`:** add Menu to the hosted-controls and popup sections, if G7a/G7b haven't.

## Rules

- Every claim must be checked against the code, a gate or a recorded measurement. Don't copy prose
  from a changeset without checking it.
- Don't touch `docs/research/*`. Don't write home paths, hostnames or emails (D25).
- Patch changeset only if the published package's own files change. The README ships in the
  tarball, so a README change counts.

## Gates

`check`, then `need --for review`. Report: `docs/tasks/D3-docs-0.4.report.md`.
