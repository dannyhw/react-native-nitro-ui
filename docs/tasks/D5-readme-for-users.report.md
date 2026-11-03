# D5 — A README for the people who use the library

**Branch:** `task/D5-readme-for-users` (from `main` at `dc092ef`) · **Round:** 1 of up to 2 (D19) ·
**Lease:** none (docs only, no devices)

## Summary

The README is now written for an app developer: what the library is, the components (table,
screenshots, usage), requirements, installation (from npm and from a clone), sizing, a short
performance section, known limitations, how it works, a contributing pointer and the license.
**1064 lines before, 827 after.** Every Components row, import-block name, screenshot `<img>` and
named ` ```tsx ` block is unchanged, so `readme:check` and `readme-components.test.js` still match.

**Removed from the README** (moved, unless marked dropped):

- the Performance write-up: both per-machine tables, their readings, the `<Host>` on Android tables
  and Baselines and gating, with machine labels, `--plan` flags, shas and `docs/tasks/*` links;
- "What has been tried": the consumer smoke table, the RN 0.86.3 iOS note, the workflow list;
- **dropped**, already in CONTRIBUTING: the Contributing bullet's workflow names (its opening
  paragraph says the same), Usage's screenshot crop widths ("README screenshots"), the
  smoke-route lines and the `docs/research` / `DECISIONS.md` pointers (the layout list);
- **dropped**: `DECISIONS D23/D32/D33` references; the plain-words reason stays where there was one;
- **dropped**, in CHANGELOG and `host.md`: what a Host held in 0.1.0–0.4.0, and an old-layout aside.

**What moved where:**

- README "Performance" (tables, readings, baselines and gating) → `docs/performance.md`, verbatim, with
  headings added and links rewritten relative to `docs/`; the README links it once.
- README "What has been tried" → CONTRIBUTING "Consumer smoke tests" → new "Results" subsection. That
  text says the app mounts ten controls rather than eight, and names `TextField` and `Chip` beside
  `Menu` as not yet seen in a consumer run, because the smoke list now has them.
- `docs/architecture/sizing.md` and `docs/components/host.md` said the quiet-run cells were "in
  `README.md`"; both now point at `docs/performance.md`.

**Stale statements fixed:** the Components table's `Status` column (`next` for five released
components) is now `Since` with each release. Host is described as holding every control except
`Chip`, `TextField` and `BottomSheet` (it said "all eight" and "Chip is the one it does not hold";
`HostChildren.ts` refuses three and hosts both dialogs). `TextField` joins the `fillWidth` list.

The new Performance section quotes the device and OS (iPhone 17 simulator on iOS 27, API 35 Pixel 9
emulator) and gives ranges taken from the moved tables. It names the caveats (simulators, two
machines, the iOS frame floor) and the components with no published comparison.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1711 tests / 67 suites | `7598adaee392` | 2 m 45 s | start 1.8 / med 4.0 / max 5.2 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` (the diff touches no
platform-specific code, so no device gate is asked for beyond `check`).

## Red proofs

No new test or gate. The existing README guards were run against the edit: `readme:check` (13
blocks match) and `readme-components.test.js` (4 pass).

## Files changed

- `README.md` — rewritten as above.
- `docs/performance.md` — new; the README's former Performance section.
- `CONTRIBUTING.md` — smoke "Results" subsection; "eight" → "ten" smoke controls in the same
  section; `docs/performance.md` in the repository layout.
- `docs/architecture/sizing.md`, `docs/components/host.md` — one pointer each, README → performance.md.

## Follow-ups

- docs/components: `host.md`'s headings carry decision ids (`#sizing-d24`, linked from the README's Sizing), and the component docs cite `DECISIONS Dnn`/task ids throughout.
- docs/performance.md: the Menu cells and the 0.6.0 controls (`Chip`, `TextField`, dialogs, `BottomSheet`) have no committed or re-run comparison; the summary says so.
- CONTRIBUTING: the consumer smoke table is still the 0.1.0 run; a re-run on 0.6.0 would let the README say more than "see CONTRIBUTING".
- Release: npm shows the README of the latest published version, so this text reaches npmjs.com only with the next release (no changeset added).
