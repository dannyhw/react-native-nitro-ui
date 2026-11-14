---
name: owner-digest
description: Write any message to the nitro-ui owner - a status update, an answer to "what's running" or "where are we", a decision request, or the report after a task event. Use before every message the owner will read.
---

# Owner digest

Write for a reader on a small screen who does not have your context. They should be
able to act on the first screen.

## If they asked a question

Answer it in the first sentence. Then stop, unless something below needs them.

## A status message

Four lines, in this order. Leave a line out when it is empty, except the first.

```
Needs you: <nothing | the decision, your pick, and what you will do if they say nothing>
Shipped: <what users can now do, and the version if released>
Blocked: <what, on what, since when, and what you are doing about it>
Running: <plain name, how long so far against its budget>
```

Under 120 words unless they ask for more.

## Rules

- **Look before you write.** Every line comes from this turn. Run
  `node scripts/watchdog.mjs --status` and `node scripts/lease.mjs list`, read the
  task's thread, and use `gh pr view`. Never write "still running" or "waiting for your
  approval" from memory.
- **Names, not IDs.** "the Stepper layout fix", not "X24". Put the ID in brackets once if
  they may need to search for it. No decision numbers, pair names, gate names or thread
  links unless asked.
- **One ask, once.** A decision gets its own message or the first line. It carries your
  pick and a default: "I'll go with A at 18:00 unless you say otherwise". Then act on
  the default. Never repeat an unanswered ask as a footer.
- **Do not ask what you can decide.** If the choice is reversible and you have a
  recommendation, take it and report it. See the `orchestrate` skill for what is theirs.
- **Say what started, not what will.** "Started the ListItem build", not "next I'll
  pick up ListItem".
- **Estimates come from measurements or not at all.** "Similar components took 15 to 30
  hours brief to merge" is an estimate. A guess is labelled as one.
- **Trade-offs they will see go to them before they ship.** If a control will look or
  behave unlike the platform's own, say so when you decide it, with a screenshot.
- **One message per event.** Not one per step of handling it.
- **Bad news first and plainly.** What broke, since when, what it cost, what you did.
  If you were silent or wrong, say that in the same message.
