# E1 — Material 3 Expressive, pass 1: buttons

**Branch:** `task/E1-expressive-buttons` (from `main` at `ee3197ed`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — no device was used.

## Summary

Round 1 stops before implementation and asks, rather than guessing (AGENTS.md "Asking for help").

The delegation said to branch from `ee3197ed`, and that is done: `task/E1-expressive-buttons` at
`ee3197ed`, `bun install` run, worktree clean. But the worktree I was handed
(`~/.t3/worktrees/react-native-nitro-ui/t3-82014865`) was created at 17:51:07Z from `main` and holds
**no E1 code**: `src/` has no button spec, `docs/tasks/E1-expressive-buttons.report.md` did not
exist, `.gates/` is empty. My thread context instead carries a finished E1 rounds 1–5 history —
head `c5b22f3`, `check` green, both harnesses red on one SegmentedControl handshake claim — against
an API (`ButtonVariant`, `ButtonSize`, `ButtonEventPayload`, `cornerRadius: number |
RoundedRectRadii`) that the brief in front of me does not describe. That work is not on this machine:

- no `task/E1-expressive-buttons` ref anywhere in the clone (700 refs scanned) and none on `origin`
  (`git ls-remote`);
- `c5b22f3`/`b9b86f4`/`b031532` are not objects here; all 99 dangling commits scanned, none contains
  `src/NitroUiButtonEvents.nitro.ts`;
- no worktree for it in `git worktree list`, no `/tmp/nitro-ui-*` clone, no APFS local snapshot to
  restore from;
- no other E1 thread on this machine (`t3_thread_list` / `t3_thread_search`).

The brief at `ee3197ed` is also a different revision: it asks for `shape: 'round' | 'square' | null`
on both platforms, the `shapes: ButtonShapes` / `ChipShapes` overloads, `ButtonDefaults.*For(...)`
size tokens and a Compose `ToggleButton` + `ButtonGroupDefaults` connected group, and says nothing
about `ButtonVariant` or a `cornerRadius` union. Re-implementing the older API blind would either
collide with a recoverable branch or ship Button an API E2 does not expect, so I did not start.

## Gates

None run this round. `node scripts/gate.mjs table` prints "nothing recorded yet" for code tree
`b2384ce43c9f` at HEAD `ee3197e`, so `need --for review` lists `check` and all four device gates as
missing. `bun run check` was attempted once before `bun install` and failed on a missing
`node_modules` (`Cannot find module 'nitro-ui'`); nothing is claimed from it.

## Red proofs

None — no new test in this round.

## Follow-ups

- If the rounds 1–5 branch is unrecoverable, record that E1 restarts from `ee3197ed` so the next
  implementer does not go looking for `c5b22f3`.

## Questions for orchestrator

1. **Which E1 API is authoritative?** Options:
   - (a) **Restore the rounds 1–5 branch first** — recommended if it exists. I cannot read the
     linked machine `INV-0391` from here; one read-only command decides it:
     `git -C ~/Workspace/oss/react-native-nitro-ui for-each-ref | grep -i e1` (plus
     `git log --oneline -3 task/E1-expressive-buttons`). Five rounds of gates and red proofs are
     cheaper to fix than to rebuild, and I would take it as fix round 6.
   - (b) **Confirmed gone** → I implement the `ee3197ed` brief from scratch here, which needs a
     fresh round budget: the brief's "1 round + 2 fix rounds" cannot also re-litigate an API E2 is
     already reading.
   - (c) **Implement the brief, keep the old names where it is silent** (`ButtonEventPayload`,
     `ButtonSize`) — only if you confirm E2 builds on those names.
2. **`shape` vs the old union.** The brief wants `shape: 'round' | 'square' | null`; the lost report
   settled on `ButtonSize` plus `cornerRadius: number | RoundedRectRadii | null`. E2 (menus) reads
   Button's API, so please pick one revision, not a merge of both.
