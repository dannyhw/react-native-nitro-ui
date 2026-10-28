# T18 — TextField spike (one round, report plus go/no-go)

**Machine:** maintainer-mac-1 (`NITRO_UI_MACHINE_LABEL=maintainer-mac-1`). **Worktree / branch:** named
in your delegation message (from `main`). **Round cap:** one round, no fix rounds (spike, D19).
**Devices:** that machine's lease (`node scripts/lease.mjs acquire --task T18`).

The research is done: `docs/tasks/Q2-textfield-research.md` (read all of it, including the
"Orchestrator answers"). This spike builds the prototypes its §7 lists and measures them against its
go/no-go lines. Prototype code lives on this branch only. It is evidence, not a shipped component:
no public export, no `component.json`, no docs page, no changeset.

## Do

1. **The typing oracle first (Q2 §7 P2, answer 2).** Add IME-level typing to the real-input runner:
   `adb -s <leased serial> shell input text …` on Android, and the equivalent real typing on iOS
   (XCUITest `typeText`). Prove it can type into a Compose `BasicTextField` and a SwiftUI
   `TextField`. If Android typing can't be made to work without a test-only hook, stop there. That
   is a no-go by Q2's own rule; report it.
2. **P1–P5 as Q2 §7 describes,** each with its numbers.
   - P1: iOS SwiftUI `TextField` versus a hosted `UITextField`.
   - P2: Android `BasicTextField(TextFieldState)`.
   - P3: the handshake vectors, extending the three twins.
   - P4: sizing, including multiline auto-grow and `sizingStats().cachedSizes` growth.
   - P5: cost against RN `TextInput` (keystroke-to-commit, focus latency, mount and memory, in one
     run).
3. **The report** (`docs/tasks/T18-textfield-spike.report.md`): a table with one row per go/no-go
   line (measured value, threshold, pass/fail), then a **go / no-go for 0.4** with the reason. If
   go, add a draft API (prop list, `T | null` per the perf contract, events, methods) and the G8
   brief's must-haves. The owner decides whether a shipped TextField needs RN keyboard interop
   (`Keyboard.dismiss()`, `TextInput.State`); list what it would take.

## Rules

AGENTS.md applies, including the perf contract and "every new test shown red". Stay on the leased
devices, and never touch `emulator-5560`. Only that machine's orchestrator pushes, and only this
task branch.

## Gates

`check` green. The prototypes' harness tests run on the leased devices; record them with `gate.mjs`.
`need --for review` doesn't apply to a spike, so say what you ran. Commit on your branch, don't push.
