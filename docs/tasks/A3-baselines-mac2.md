# A3 — Mint the second machine's bench baselines (overnight)

**Worktree / branch:** named in your delegation message (from `main`, after X8).
**Machine:** the one labelled `maintainer-mac-2` (`NITRO_UI_MACHINE_LABEL`, which your shell must
export). **Round cap: one attempt per platform, no fix rounds, no `--force`.** Don't push.

X8 keys baselines by machine: this run writes `bench/baselines/maintainer-mac-2/<deviceKey>.json`.
`maintainer-mac-1`'s files stay as they are. This machine has 10 cores, so the load ceiling is 5.0
(D9, judged over the whole run, R4).

1. Set up the worktree: `bun install`, Node 24 via `fnm exec --using 24 --`, and the Android env from
   AGENTS.md. Work from a **clean tree**.
2. Take an **exclusive** lease for both platforms: `node scripts/lease.mjs acquire --task A3
   --exclusive`, sourced as CONTRIBUTING shows. It waits until every other lease has ended. Renew it
   if a run outlives the ttl. Release it at the end, even if a run fails.
3. **iOS:** `bun bench --platform ios --plan full --launches 8 --update-baseline` on the leased
   iPhone 17 (iOS 27.0). Its key must be `ios27-sim-iphone17`. If the runner prints another key,
   stop and report it; don't mint under that key.
4. **Android:** the same command with `--platform android` on the leased API 35 Pixel 9 AVD (key
   `android35-emu-pixel9`).
5. A run that is refused (busy at start, or over the whole run) is not retried and not forced. Record
   the refusal text verbatim and the `machine.loadSamples` summary (`count`, `ceiling`, `median`,
   `p90`, `max`, `over`).
6. For each minted file:
   - run `prettier --write`;
   - show that `--check` reads it back (re-report the run's results file with
     `node scripts/bench/report.mjs <results> --check`) and that a doctored copy (one ratio ×2, in
     `ratio` and every `launchRatios`) goes red;
   - commit **each baseline in its own commit**, with a diff of that one file.

   Then update the Status section of `bench/baselines/README.md`.
7. Shut down the devices you booted and stop the Metro you started, then release the lease.
8. Report in `docs/tasks/A3-baselines-mac2.report.md` (REPORT-TEMPLATE). Per platform, give: the
   result, the results file, the duration, the launch count, problems, the load-sample summary, and
   the ratio table (each component × presented / UI CPU / memory against `expo-ui-shared-host`, with
   the runner's verdict labels; no "n/v" upgraded). Note anything on the machine that loaded it,
   such as Screen Sharing or Spotlight.

Constraints: don't kill or touch any process you didn't start. Use only leased devices, and never
`emulator-5560`. No `pkill`/`killall`. `node scripts/gate.mjs check` must be green before the
docs commit.
