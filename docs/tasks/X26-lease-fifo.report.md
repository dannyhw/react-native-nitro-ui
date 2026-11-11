# X26 — Device leases: first come, first served

**Branch:** `task/X26-lease-fifo` (from `main` at `c3603bd0`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — tooling only. No lease was acquired, no device gate run, no simulator or
emulator started; the CLI cases run `lease.mjs` against a temporary `NITRO_UI_HOME`, a copied
example pool, a stubbed `lsof` and `--no-boot`.

## Summary

A waiting `acquire` now records a ticket, and a freed pair goes to the oldest ticket that can
use it instead of to whoever polls first.

`waiters` joins `leases.json`: `{task, id, platform, exclusive, iosRuntime, requestedAt,
refreshedAt}`, written when a willing-to-wait request is refused, refreshed on every poll.
`requestedAt` is when the wait **started** — the queue position — and `refreshedAt` is the touch
time, so a killed waiter stops refreshing and is pruned within a minute (the exclusive marker's
own gap). `release` drops a task's ticket with its lease; a grant drops it with the grant.

The rule is read **pair by pair: the oldest live ticket a pair would satisfy owns that pair**
(`pairSatisfiesWaiter` mirrors the filter `decideAcquire` applies to offerable pairs). The choices
it implies:

- a waiter claims only pairs it can use, so an iOS-only waiter does not idle an Android-only
  pair — that pair still goes out;
- a `both` waiter claims every pair the pool could hand it, so an unticketed task is refused even
  with two pairs free. The cost is in the code and the tests: a pair the line is entitled to may
  idle until that waiter's next poll (10 s), or 60 s if the ticket is a corpse. Reserving one
  pair per waiter instead would let an unticketed task take a second free pair from in front of
  somebody who had waited half an hour — this bug, priced as utilization;
- "no ticket" is the **back** of the queue, not the front, which is what stops the task that just
  released a pair (always the one asking again in seconds) taking it back. `--wait-minutes 0`
  never queues: served now if nothing older is waiting, refused if something is;
- same-millisecond tickets are ordered by task name, because two tickets that each see the other
  as "not older" both claim one pair.

`--exclusive` is unchanged and unranked: one free pair does not satisfy it, its drain marker still
holds new leases back until the machine is quiet, and `waitQueue` folds the marker in so it keeps
its place in the line and `list` prints one row for it.

`list` shows the queue (position, task, platform, waited since) and a refusal names who is
in front and for how long. `lease.mjs`/`lease-core.mjs` are check-only tooling now: a lease change
owes `check`, not two device runs — `need --for review` confirms it.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2031 tests / 86 suites | `8ab9110866db` | 2 m 56 s | start 5.0 / med 11.1 / max 20.0 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` — with
`note: the code diff is tooling (check-only) only: … scripts/lease.mjs - no device gate is asked
for beyond check (a device run does not depend on these files)`. That note is item 5's
acceptance: the base for it is `c3603bd`, so the diff it read is this round's whole diff.

## Red proofs

Method: the new tests were run against the tooling as it is on `main` —
`git stash push -- scripts/lease.mjs scripts/lease-core.mjs`, run, `git stash pop` — which is
the mutation for a feature that did not exist: 10 of 11 failed. Every fixture's expected answer
differs from what the old code produced (`pair-b` vs the default `pair-a`; the waits are 240/270/300
minutes, not a round-number fallback that would hide a wrong correction).

- `lease-queue › gives a freed pair to the oldest waiter` -> no queue in `decideAcquire` -> `expect(younger.ok).toBe(false)`, received `true`
- `lease-queue › will not let the task that just released a pair jump back in front` -> same -> `expect(justReleased.ok).toBe(false)`, received `true`
- `lease-queue › drops a ticket that stopped refreshing` -> same -> `TypeError: (0 , _leaseCore.waitQueue) is not a function`
- `lease-queue › keeps a waiting exclusive request in the queue and still drains the machine` -> same -> the same `TypeError`, and `pruneExpired` read a 5-minute-old-but-refreshed marker as expired
- `lease-queue › claims only the pairs a waiter can use` -> same -> `expect(spare.pair.id).toBe('pair-b')`, received `'pair-a'`
- `lease-queue › applies the documented pair/waiter rule` -> same -> `TypeError: (0 , _leaseCore.pairSatisfiesWaiter) is not a function`
- `lease-queue › counts a ticket written in the same millisecond exactly once` -> same -> `expect(second.ok).toBe(false)`, received `true` (both waiters claimed one pair)
- `lease-queue › hands a freed pair to the older ticket and shows the queue in list` -> same -> 5 s jest timeout: `list` printed no `queue 1. X24` row, and the pair went to the polling child
- `lease-queue › records a ticket for a waiting acquire, and forgets one that dies` -> same -> `waitFor: timed out` on `waiters[]` gaining `X24`
- `lease-queue › refuses a no-wait acquire that is not next in line` -> same -> `expect(refused.status).toBe(1)`, received `0`
- `gate-check › scripts/lease.mjs|scripts/lease-core.mjs is check-only tooling` -> `gate-core.mjs` unmodified -> `expect(TOOLING_FILES).toContain('scripts/lease.mjs')` (2 failures)
- `gate.test › keeps every path a device run depends on out of the allow-list` -> the lease pair **added** to `TOOLING_FILES` -> `expect(isToolingPath('scripts/lease-core.mjs')).toBe(false)` at `scripts/__tests__/gate.test.js:1091` — the second guard the list had, updated in this round with the reason written out

Deliberately green on both trees: `lease-queue › changes nothing when nobody is waiting`, which
is the compatibility guard (an empty queue, and a caller that never passes `waiters`, must get
the pre-X26 answer). Two real bugs came out of the red runs, both now covered: `reserved.set(pair.id, …)`
throwing `ReferenceError` where `claim` was meant, and a ticket holder's own `--wait-minutes 0`
retry being refused because the CLI passed `now` instead of its ticket's `requestedAt`.

## Files changed

- `scripts/lease-core.mjs`: `WAITER_TICKET_TTL_MS`, `waiterIsLive`/`waiterRequestedAtMs`/`waiterTouchedAtMs`,
  `compareWaiters`, `waitQueue`, `pairSatisfiesWaiter`, `formatWaited`; `pruneExpired` expires tickets;
  `pendingIsLive` judges the marker by its refresh; `decideAcquire` gained `waiters`/`waitedSince`/`now`
  and the per-pair claim.
- `scripts/lease.mjs`: write/refresh/drop the ticket around the decision, clear it on grant, refuse
  and release; `list` prints the queue (`--json` gained `queue`); usage line says so.
- `scripts/gate-core.mjs`: the lease pair on `TOOLING_FILES`, with the honest exception noted in the
  header comment (the harness config reads two guards from `lease-core.mjs`).
- `scripts/__tests__/lease-queue.test.js`: new, 11 tests — 8 pure-core, 3 driving the real CLI.
- `scripts/__tests__/gate-check.test.js`, `scripts/__tests__/gate.test.js`: the two tests that guard the list.
- `CONTRIBUTING.md`: "Leasing a device or port" — the queue as the second of five enforced rules.

## Follow-ups

- rollout: a task still running `main`'s `lease.mjs` ignores `waiters` and can take a pair from in
  front of a queued task until this merges; nothing in the pool breaks meanwhile, and `list` shows
  its ticket anyway.
- `list`'s text replaced the one-line `wants an exclusive lease, Ns waiting` row with queue rows;
  nothing in the repo parses the text, and `--json`'s `queue` is the parseable answer.
- an exclusive `--wait-minutes 0` acquire no longer leaves its drain marker behind after giving up
  (it used to, for up to 60 s); deliberate, untested — say so if a brief wants it pinned.
- `waiters` is machine state under `~/.nitro-ui`, not repo state: no migration was needed because
  the array is additive and absent means an empty queue.
