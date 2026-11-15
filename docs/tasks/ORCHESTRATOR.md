# Orchestrating nitro-ui tasks

The playbook moved. It was a 180-line document that grew a paragraph per incident; it is now a set
of short skills an orchestrator loads when it needs them, and the reference text went where it is
used.

| What                                                    | Where                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| The loop: pick, brief, delegate, review, merge, clean up | `.claude/skills/orchestrate/SKILL.md`                       |
| Writing a brief, and the delegation message              | `.claude/skills/brief/SKILL.md`                             |
| Every message to the owner                               | `.claude/skills/owner-digest/SKILL.md`                      |
| A red or intermittent gate                               | `.claude/skills/flake/SKILL.md`                             |
| The hourly check from outside the orchestrator           | `.claude/skills/watchdog/SKILL.md`, `scripts/watchdog.mjs`  |
| Standing agreements                                      | `docs/agents/working-agreements.md`                         |
| Every rule, its enforcer and the incident behind it      | `docs/agents/rules.md`                                      |
| Reusing a `check` at merge (was "The loop" step 5), logs | `docs/agents/gates.md`                                      |
| Live state                                               | `STATUS.md` (in flight, recently merged, blocked)           |
| Which task records are still in git                      | `node scripts/task-records.mjs`                             |

Older briefs and reports cite this file by step number ("The loop" step 1b, 3, 5). Step 1b is the
context pack, now in the `brief` skill; step 3 is the hand-in check, now in `orchestrate`; step 5
is in `docs/agents/gates.md`.

## A new machine

Run `node scripts/doctor.mjs`, fix what it reports, then
`node scripts/doctor.mjs --setup` to create that machine's device pairs and
`~/.nitro-ui/devices.json`. Set `NITRO_UI_MACHINE_LABEL` (for example
`maintainer-mac-2`). Committed bench baselines are per machine. A machine
without its own baselines can't use another machine's for regression gates, so
mint them there (`--exclusive`, idle machine, overnight).
