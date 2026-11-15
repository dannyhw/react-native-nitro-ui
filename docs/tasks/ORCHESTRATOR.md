# Orchestrating nitro-ui tasks

| What | Where |
| --- | --- |
| The loop: pick, brief, delegate, review, merge, clean up | `.claude/skills/orchestrate/SKILL.md` |
| Writing a brief, and the delegation message | `.claude/skills/brief/SKILL.md` |
| Every message to the owner | `.claude/skills/owner-digest/SKILL.md` |
| A red or intermittent gate | `.claude/skills/flake/SKILL.md` |
| The hourly check from outside the orchestrator | `.claude/skills/watchdog/SKILL.md`, `scripts/watchdog.mjs` |
| Standing agreements | `docs/agents/working-agreements.md` |
| Every rule and what enforces it | `docs/agents/rules.md` |
| Gates, the ledger and logs | `docs/agents/gates.md` |
| Live state | `STATUS.md` (in flight, recently merged, blocked) |
| Which task records are still in git | `node scripts/task-records.mjs` |

## A new machine

Run `node scripts/doctor.mjs`, fix what it reports, then
`node scripts/doctor.mjs --setup` to create that machine's device pairs and
`~/.nitro-ui/devices.json`. Set `NITRO_UI_MACHINE_LABEL` (for example
`maintainer-mac-2`). Committed bench baselines are per machine. A machine
without its own baselines can't use another machine's for regression gates, so
mint them there (`--exclusive`, idle machine, overnight).
