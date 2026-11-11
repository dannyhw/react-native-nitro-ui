# X26 — Device leases: first come, first served

**Worktree / branch:** named in your delegation message (`task/X26-lease-fifo`). **Round cap:** 1 round, plus at most
2 fix rounds (D19). **Devices:** none. This is tooling with unit tests only; never acquire a lease or touch a device.

## The problem

`scripts/lease.mjs acquire --wait-minutes N` polls, and a freed pair goes to whichever acquirer polls first, not to
whoever has waited longest. On 2026-11-11, X24 waited about 5 h and X25 about 4.5 h and never got a pair, because each
task that released a pair re-acquired one within seconds for its next gate. The waiting exclusive request already
records a marker that holds back new device leases (`acquire()` in `scripts/lease.mjs`, the waiter marker in
`scripts/lease-core.mjs`); ordinary waiters have nothing like it.

## Do

1. **A queue for every waiter:** a waiting acquire (exclusive or not) records a ticket with the time it started
   waiting, refreshed on every poll and expiring when not refreshed (so a killed waiter drops out, as the exclusive
   marker already does). A free pair is granted only to the **oldest live ticket** that it satisfies (platform: an
   `ios`-only or `android`-only request can take a pair a `both` request can't use yet; say what you chose). An acquire
   with no wait (`--wait-minutes 0`) still succeeds immediately when nothing older is waiting, and is refused (not
   queued) when something older is.
2. **The exclusive rule stays:** a waiting exclusive request still holds back new leases until the machine is quiet,
   and keeps its place in the queue.
3. **`lease.mjs list`** shows the queue (task, waiting since, position).
4. **Unit tests** in `scripts/__tests__/` for: the oldest waiter wins a freed pair over a newer one; a task that just
   released can't jump the queue; an expired ticket drops out; exclusive still drains the machine; a platform-only
   request isn't blocked by a `both` request that can't use the free half (or whatever rule you chose). Each shown red
   first.
5. **The gate ledger:** `scripts/lease.mjs` and `scripts/lease-core.mjs` are machine tooling that ships in no package.
   Add them to the check-only tooling list in `scripts/gate-core.mjs` beside `scripts/gate*.mjs`, so a lease change
   owes `check`, not device gates, with the unit test that guards that list updated.
6. **CONTRIBUTING's "Leasing a device or port"** describes the queue.

## Gates

`check`, then `need --for review` (the tooling list change makes it check-only). Report at
`docs/tasks/X26-lease-fifo.report.md`. Export the ledger with `gate.mjs export --task X26`.
