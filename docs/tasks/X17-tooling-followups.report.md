# X17 — Small tooling follow-ups from X16, G8 and G9

**Branch:** `task/X17-tooling-followups` (from `main` at `cc51a7e`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X17-yr3py` (`pair-a`: iOS `F08675D3-A32B-4F88-BC81-02D7E0CB797E` / `emulator-5574` / Metro `8295`;
both devices were already up and reused, no boot wait), on maintainer-mac-1

## Summary

Seven `FOLLOWUPS.md` lines, one commit each. Each line is removed in the same commit as its fix, and every new test was
shown red first.

1. **Stability WARN only at a named screen scale.** `iosStabilityWarning` asked `firstReadScale`, which also returns a
   raw ratio (`0.800×`), so any uniform first read warned. A new `screenScale` returns the label only for ⅓, ½, ¼, 2× and
   3×. Both the WARN and the note's "another render scale" sentence ask it, so the two still agree. For a uniform ratio
   that is no screen's scale, the note still quotes the ratio but calls it a control that moved. A uniform-0.8 fixture
   was added.
2. **`--exclusive` summary counts a spared device once.** The pool keeps a spared key because this lease holds it, so
   the key came back in `kept`. `lease.mjs` now leaves spared keys out of `kept`. A second case keeps a simulator for a
   live run's claim, so a fix that simply dropped `kept` would go red.
3. **CONTRIBUTING exclusive-boot guard reads wrapped commands.** Extraction moved into `exclusiveBootCommands`. It strips
   each physical line's `# comment`, joins `\` continuations, and only then filters. Words left over from a trailing
   comment no longer become arguments either.
4. **Pool CLI children no longer inherit the shell's lease.** The `cli` helper now starts from
   `withoutLeaseEnv(process.env)`. A new case sets `NITRO_UI_LEASE_BOOT=1` on `process.env` itself, so `check` guards
   this in any shell.
5. **`USAGE`** lists `[--boot]`, and says `--exclusive --boot` needs `--platform` and never boots for
   `NITRO_UI_LEASE_BOOT` alone. The refusal prints the same usage.
6. **`android-calendar.mjs` table** now quotes both 320 dp dumps: header `126 ×6, 20` over day cells `126 ×6, 73`
   before the fix, and `105 ×7` for both rows after it. The rows are separated by accessibility, not geometry. The
   "touch-target expansion lands unevenly" paragraph is gone. A test pins the table to the fixture widths, which now come
   from one `DUMP_320` constant. The dump files themselves are not on this machine, so the numbers come from the G8
   report and the removed FOLLOWUPS line.
7. **`Menu.harness.tsx` comment** names iOS, and says Android measures the popup through the witness's `menu=` rect.
   Both `harness:*` runs are on this tree.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1648 tests / 62 suites | `7c5fc82821e9` | 1 m 56 s | start 1.4 / med 9.6 / max 12.0 |
| `harness:ios` | **PASS** | 233 tests / 16 suites | `7c5fc82821e9` (ios tree) | 3 m 47 s | start 3.3 / med 2.4 / max 3.3 |
| `harness:android` | **PASS** | 284 tests / 16 suites | `7c5fc82821e9` (android tree) | 8 m 00 s | start 2.1 / med 2.2 / max 3.9 |
| `real-input:ios` | **PASS** | — | `7c5fc82821e9` (ios tree) | 13 m 50 s | start 19.0 / med 3.4 / max 30.4 |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` `real-input:android` is left for merge: neither
the brief nor review asks for it.

## Red proofs

- `real-input-a11y-ios · warns nothing for a uniform ratio that is not a screen scale` -> shipped WARN (asks `firstReadScale`) -> `Received: "its first accessibility read was this box at 0.800× scale — a stale snapshot …"`
- `lease-pool-cli · counts a spared device once, not again as held by a lease` -> shipped summary -> `Received string: "… (1 shut down, 2 already off, 1 spared, 1 held by a lease)"`
- `lease-pool-cli · still counts a device kept for somebody else beside a spared one` -> `kept: []` in `lease.mjs` -> `Expected substring: "1 held by a lease"`, got `(0 shut down, 2 already off, 1 spared)`
- `lease-pool-cli · reads a backslash-continued command as one command` / `… drops its trailing comment` -> the shipped per-line filter -> both `✕` (continued command not read; `a`, `bench` left in argv)
- `lease-pool-cli · documents an exclusive boot the CLI actually accepts` -> CONTRIBUTING given a wrapped `--exclusive \` / `--boot` with no `--platform` -> `"status": 2` for that line (restored after)
- `lease-pool-cli · boots nothing when the shell running the suite has NITRO_UI_LEASE_BOOT=1` -> shipped `...process.env` -> `Received string: "  booting android device nitro-ui-a:5574"`. The whole suite under `NITRO_UI_LEASE_BOOT=1` before the fix had 3 failures, the same 3 cases the follow-up names. After the fix it is 49/49 in both shells.
- `lease-pool-cli · lists --boot in its usage, and says an exclusive boot needs --platform` -> shipped `USAGE` -> `Expected pattern: /\[--boot\]/`
- `real-input-calendar · quotes the real dumps' widths in the module's own table` -> shipped table -> `- Expected - 42 / + Received + 1`; after the fix, `73` -> `110` in the table -> `- 73, + 110`
- Item 7 is a comment, with nothing to make red. Both harness runs above cover the file.

## Files changed

- `scripts/real-input/a11y.mjs`, `scripts/__tests__/real-input-a11y-ios.test.js` (item 1)
- `scripts/lease.mjs` (items 2, 5), `scripts/__tests__/lease-pool-cli.test.js` (items 2–5)
- `scripts/real-input/android-calendar.mjs`, `scripts/__tests__/real-input-calendar.test.js` (item 6)
- `example/__tests__/Menu.harness.tsx` (item 7), `docs/tasks/FOLLOWUPS.md` (seven lines removed)

## Follow-ups

- lease: `USAGE` still omits `--no-reap`, which `parseArgs` accepts.
- lease: the exclusive summary counts a device kept for a live run's claim as "held by a lease", next to "every device no other lease holds is off" (seen in item 2's second case).
- tests: `lease.test.js` (812, 836, 1017, 1400) and `lease-metro-port.test.js` (409, 1016) still spread `process.env` into CLI children without `withoutLeaseEnv`; I didn't check whether any case is sensitive to it.
