# F8 — The harness jobs green on GitHub's hosted runners

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task F8 --boot`), for local reproduction only.

Read first: `docs/tasks/F4-ci-green.report.md`, especially "CI dispatch results"; the "CI harness on hosted
runners" line in `docs/tasks/FOLLOWUPS.md`; and `docs/ci-runner-images.md`.

## Why

F4 made both dispatch-only harness jobs load their config. Run `41230848294` was the first time they ran on hosted
runners:
- `Harness (iOS)`: 217 passed, 8 failed, 2 skipped.
- `Harness (Android)`: the emulator never became ready within 900 s.

The local device gates are green on the same tree. A red CI row that everyone has learned to ignore is worse than
no row.

## Do

1. **iOS: the 8 failures.** Classify each one with evidence: download the run's logs and artifacts with
   `gh run view 41230848294 --log` and `gh run download` (read-only).
   - **Environmental** (the runner's timezone has no DST, a cold-cache premise, load on 3 cores): make the test
     state its own precondition and skip or adapt with a printed reason, the way T14 already self-diagnoses.
     Never weaken what it checks on a machine where the premise holds.
   - **A real difference on the runner's iOS runtime** (e.g. DatePicker's declared fallback 103x36.33 vs measured
     107x36.33): that's a product finding. Fix it in product code if the fix is clear, with a patch changeset if
     apps can see it. Otherwise STOP and ask under "Questions for orchestrator".
   - The DatePicker recycle-reset, Menu no-leak-on-drop and Switch default-box failures need a root cause, not a
     skip.
2. **Android: the emulator boot.** Find out why the AVD never became ready on `ubuntu-latest`. Candidates: cold
   snapshot generation, CPU/RAM caps on a 4-core runner, the AVD config the action creates, KVM.
   - Fix it with config: AVD cache, timeout, cores/RAM, boot flags.
   - If hosted Android can't be made reliable, say so with evidence and propose an alternative, such as a larger
     runner or `macos` with HVF. Don't add paid runners.
3. **Prove it in CI.** You can't push. End each round with a "CI to dispatch" list; I push the branch, dispatch
   `ci.yml` on it and send you the results. Done means both harness jobs are green on a dispatch, or every
   remaining red is a decision for me.

Every change needs a red proof (AGENTS.md). Any harness test file you change must run on both platforms locally.

## Not in scope

Changing what triggers the harness jobs, F5, and anything outside the failing tests and the CI harness setup.

## Gates

`check`, both `harness:*`, then `need --for review`. Report at `docs/tasks/F8-ci-harness-hosted.report.md`, with
the ledger exported.
