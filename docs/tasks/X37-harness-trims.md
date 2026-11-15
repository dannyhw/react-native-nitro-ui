# X37 — Remove harness tests that measure or repeat, and the closed dwell probe

**Worktree / branch:** `task/X37-harness-trims` (stacks on `task/W3-tooling-removal`; the pull
request targets that branch).
**Sources:** `~/.nitro-ui/audits/2026-11-15/area-harness.md` (all of it) and
`~/.nitro-ui/audits/2026-11-15/area-real-input.md` (the "Removal list" only).

## Goal

The on-device harness tests keep the behaviour an app developer depends on and lose the ones
that only measure, repeat another suite, or belong to a closed investigation. A full run gets
shorter and nothing a user depends on loses its test.

## Why

An audit classified the 54,800 lines of harness tests: about 67% test user-visible behaviour, 20%
are named regressions, 10% repeat another suite and 3% are leftover measurements. 45 component tests
repeat two rules the Conformance suite already checks for every component. Wall-clock budgets are
never judged (`HARNESS_TIMING` is unset in every gate run), yet their plumbing turned full runs red
in three tasks. A probe built for one closed investigation (the "dwell probe") still ships in the
example app and the iOS UI tests.

## Behaviour when done

1. The audit's confident removals in `area-harness.md` "Removal list" are done: the in-harness bench
   and the cold-batch count in `Sizing.harness.tsx`, the three `mounts many instances at once` tests
   (Switch, Slider, Progress), the Conformance churn rule test, and the two `it.skip` placeholders.
2. Component tests that repeat Conformance rule 1 (fallback) and rule 4 (recycle reset) for the
   default configuration are removed from the component suites (audit section A and decision 1,
   option a). Conformance stays the contract. A component test that checks a non-default
   configuration, or anything Conformance does not, stays. The report lists each removed test beside
   the Conformance rule that covers it.
3. The timing gate's duration half is deleted (audit decision 3): `expectTimingBudget` call sites,
   the duration part of `example/__tests__/timingGate.ts`, `scripts/harness-timing-gate.js` if
   nothing else needs it, and the Metro route. The locale flag it also carries stays and still works.
4. `FormFidelity.harness.tsx` (audit decision 2, option b): its two Android regressions move into
   `Form.harness.tsx`; the iOS comparison goes, together with the reference Form that exists only
   for it (`ios/components/Form/NitroUiFormReference.swift`, its use in `HybridNitroUiForm.swift`,
   and the `show-reference` / `hide-reference` text in the Form spec). This removes test-only code
   from the published package: add a patch changeset that says so in one line, and keep
   `manifest:check` and `api-extractor:check` honest.
5. The closed dwell probe is removed (`area-real-input.md` "Removal list", the rows for
   `NitroUiProbe.swift`, `probeVariant.ts`, the probe parts of `SwitchScreen.tsx`, and the probe
   cases and launch branch in `RealInputTests.swift`, with the Xcode project entries). Keep
   `pressOnce`, `PressOutcome` and `waitForNativeValueToChange`.
6. Comments that point at functions or scripts deleted earlier are corrected:
   `Conformance.harness.tsx` (around lines 35, 638, 1115, 1157), `example/rn-harness.config.mjs`
   (around 256).

## Proof

- `harness:ios` and `harness:android` green on your lease, and `real-input:ios` green (item 5 edits
  its test file). Durations of the full harness runs before and after, per platform, in the report.
- For each test that was moved (item 4), a mutation shown red in its new home.
- `node scripts/gate.mjs check` green, and whatever `node scripts/gate.mjs need --for review` asks
  for.
- The example app builds on both platforms after the Xcode project edit
  (`node scripts/build-app.mjs --platform ios` and `--platform android`).

## Out of scope

The shared-helper refactor across harness files (audit decision 11); ColdSizing; Picker, Menu and
Host overlap (decisions 4 to 10 and 12 to 14); `scripts/real-input/android.mjs` and anything else
under `scripts/real-input/` (another task is replacing the Android driver right now: do not edit
those files); any library behaviour.

## Decided already

- When unsure whether a component test only repeats Conformance, keep it and list it under follow-ups.
- Never loosen an assertion to make a run pass. A red or intermittent test follows
  `.claude/skills/flake/SKILL.md`: read the failure, one rerun, a second identical failure is a bug.
- Any edit to a harness file is run on both platforms before you report.

## Budget

8 hours. At the budget, commit, write the report with what is and is not done, and stop.
