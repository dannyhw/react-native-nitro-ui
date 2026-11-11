# X28 — A device gate refuses to run without a lease

**Worktree / branch:** named in your delegation message (`task/X28-gate-needs-lease`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** none. Tooling with unit tests only; never acquire a lease or touch a device.

## The problem

On 2026-11-11 G30 launched two `real-input:android` runs from shells without the lease environment. With no lease, the
runner resolved a device on its own and drove a stray emulator (`emulator-5554`) over the default adb server. It
didn't reach the human's `emulator-5560`, but nothing stopped it from choosing any attached device. AGENTS.md already
says device gates run under a lease; the tooling doesn't enforce it.

## Do

1. **Every device gate** (`harness:*`, `real-input:*`, and anything else `scripts/gate.mjs` or the runners treat as a
   device gate, filtered runs included) **refuses to start** unless `NITRO_UI_LEASE_ID` names a live lease in the
   lease store whose task, platform and devices match what the run is about to use. The refusal says how to acquire
   one and exits non-zero before any build, Metro, adb or simctl step. An explicit override for the bench host's own
   exclusive runs is acceptable only if those already hold an exclusive lease, so check that rather than adding a flag.
2. **The runners never fall back to "the first attached device"**: an Android run uses only the lease's
   `ANDROID_SERIAL` and `ANDROID_ADB_SERVER_PORT`, an iOS run only the lease's simulator UDID. Find and remove any
   fallback.
3. **Unit tests** for: no lease env refuses; an expired or released lease refuses; a lease for another task or platform
   refuses; a valid lease passes; the Android runner never picks an unleased serial. Each shown red first.
4. AGENTS.md and CONTRIBUTING say the gate enforces it now.

## Gates

`check`, then `need --for review`. Report at `docs/tasks/X28-gate-needs-lease.report.md`. Export the ledger with
`gate.mjs export --task X28`. The merge will be combined with a component merge so its device gates run once.
